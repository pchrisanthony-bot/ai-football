// =====================================================================
// The street going about its day around the match:
//   walkers   people from the crowd's set (skinned, one draw call each) on their errands
//             along the far lane, out of the alley, down the end lanes — a procedural walk
//             (legs, counter-swinging arms, a bob), each at their own pace
//   scooter   now and then a scooter with its rider puts along the far lane
//   pigeons   a flock wheeling over the rooftops by day (one instanced draw, animated in
//             the vertex shader; they roost at night)
// The sleeping dogs and the crows on the fence are static scenery (layout.js).
// Nothing here touches the game: it's all outside the court.
// =====================================================================
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PITCH } from '../../sim/pitch.js';
import { Person, tint, paletteFor } from './crowd.js';
import { FAR, SIDE } from './layout.js';
import { rng, pick, range } from './util.js';
import { W } from './materials.js';

const WALKERS = [2, 4, 6, 6];                       // per quality level
const v = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

// ------------------------------------------------------------------ a skinned clone, coloured
function dress(tpl, pal) {
  const root = SkeletonUtils.clone(tpl.root);
  const regions = [];
  root.traverse(o => { if (o.isSkinnedMesh) regions.push(o); });
  const col = new THREE.Color();
  const geos = regions.map(m => {
    const src = m.geometry, region = m.material.name, c = src.attributes.color;
    const mean = tpl.regions.find(q => q.region === region)?.mean || [0.5, 0.5, 0.5];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position);
    g.setAttribute('normal', src.attributes.normal);
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from(src.attributes.skinIndex.array), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: src.attributes.skinWeight.count * 4 }, (_, i) => src.attributes.skinWeight.getComponent(Math.floor(i / 4), i % 4)), 4));
    const out = new Float32Array(c.count * 3);
    for (let i = 0; i < c.count; i++) { tint(region, mean, c.getX(i), c.getY(i), c.getZ(i), pal, col); out[i * 3] = col.r; out[i * 3 + 1] = col.g; out[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(out, 3));
    g.setIndex(src.index);
    return g;
  });
  const mesh = new THREE.SkinnedMesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  const first = regions[0];
  first.parent.add(mesh);
  mesh.bind(first.skeleton, first.bindMatrix);
  for (const m of regions) m.parent.remove(m);
  mesh.castShadow = true; mesh.frustumCulled = false;
  mesh.name = 'street:walker';
  return { root, mesh };
}

// ------------------------------------------------------------------ a walker
class Walker {
  constructor(parent, tpl, pal, path, { speed, at, r }) {
    const { root, mesh } = dress(tpl, pal);
    this.group = new THREE.Group();
    this.group.add(root);
    parent.add(this.group);
    this.person = new Person(tpl.id, root, tpl.meta);
    this.person.regions = [];                   // (only the crowd's bake reads these)
    this.mesh = mesh;
    this.path = path.map(p => new THREE.Vector3(p[0], 0, p[1]));
    this.cum = [0];
    for (let i = 1; i < this.path.length; i++) this.cum.push(this.cum[i - 1] + this.path[i].distanceTo(this.path[i - 1]));
    this.len = this.cum.at(-1);
    this.s = at * this.len;
    this.speed = speed;
    this.ph = r() * 6.28;
    this.stride = 0.62 * tpl.meta.height + 0.25;       // metres per step
    this.look = { twist: 0, roll: 0, yaw: 0, pitch: 0.05 };
    this.legLen = 0.5 * tpl.meta.height;
  }
  at(s, out) {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const a = this.path[i - 1], b = this.path[i], t = (s - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    out.lerpVectors(a, b, Math.min(1, Math.max(0, t)));
    return Math.atan2(b.x - a.x, b.z - a.z);
  }
  update(t, dt) {
    this.s = (this.s + this.speed * dt) % this.len;
    const yaw = this.at(this.s, this.group.position);
    // turn smoothly at the path's corners
    let d = yaw - this.group.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.group.rotation.y += d * Math.min(1, dt * 6);
    this.ph += dt * this.speed / this.stride * Math.PI;
    const s = Math.sin(this.ph), c = Math.cos(this.ph), sw = 0.4;
    const knee = k => 0.08 + 0.75 * Math.max(0, k);
    const leg = (sg, side) => {
      const a = sw * s * sg, kb = knee(c * sg);
      return [v(0.04 * side, -1, Math.tan(a)), v(0.03 * side, -1, Math.tan(a - kb))];
    };
    const arm = (sg, side) => [v(0.1 * side, -1, -0.36 * s * sg), v(0.07 * side, -1, -0.36 * s * sg + 0.45)];
    this.person.drive({ arms: { L: arm(1, 1), R: arm(-1, -1) }, legs: { L: leg(1, 1), R: leg(-1, -1) }, lean: 0.06, head: 0 }, this.look);
    // keep the planted foot on the ground: the hips drop as the legs open, bob each step
    this.group.position.y = -this.legLen * (1 - Math.cos(sw * s)) + 0.012 * Math.abs(c);
  }
  set visible(on) { this.group.visible = on; }
}

// ------------------------------------------------------------------ the scooter and its rider
function scooterGeometry(tint) {
  const parts = [];
  const add = (g, x, y, z, col, ry = 0) => {
    g.rotateY(ry); g.translate(x, y, z);
    const c = new THREE.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  for (const dx of [-0.62, 0.62]) add(new THREE.TorusGeometry(0.2, 0.07, 6, 14), dx, 0.27, 0, '#151515');
  add(new THREE.BoxGeometry(1.0, 0.18, 0.32), 0, 0.42, 0, tint);
  add(new THREE.BoxGeometry(0.62, 0.32, 0.36), -0.32, 0.62, 0, tint);
  add(new THREE.BoxGeometry(0.58, 0.09, 0.3), -0.3, 0.83, 0, '#1c1c1c');
  add(new THREE.BoxGeometry(0.16, 0.62, 0.3), 0.5, 0.68, 0, tint);
  add(new THREE.BoxGeometry(0.06, 0.06, 0.62), 0.58, 1.05, 0, '#222');
  add(new THREE.BoxGeometry(0.1, 0.12, 0.18), 0.63, 0.98, 0, '#f4f1e2');
  return mergeGeometries(parts);
}

class Scooter {
  constructor(parent, tpl, pal, r) {
    this.group = new THREE.Group();
    const body = new THREE.Mesh(scooterGeometry(pick(['#c62828', '#1f4fa8', '#e8e8e0', '#2e7d32'], r)), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 }));
    body.castShadow = true; body.name = 'street:scooter';
    this.group.add(body);
    // the rider: seated, feet on the floorboard, hands on the bars (faces the scooter's +x)
    const { root, mesh } = dress(tpl, pal);
    const seat = new THREE.Group(); seat.rotation.y = Math.PI / 2; seat.add(root);
    this.group.add(seat);
    const p = new Person(tpl.id, root, tpl.meta);
    p.drive({ arms: { L: [v(0.22, -0.72, 0.65), v(-0.05, -0.3, 0.95)], R: [v(-0.22, -0.72, 0.65), v(0.05, -0.3, 0.95)] }, legs: { L: [v(0.15, -0.12, 1), v(0.06, -1, 0.3)], R: [v(-0.15, -0.12, 1), v(-0.06, -1, 0.3)] }, lean: 0.24, head: -0.2 }, { twist: 0, roll: 0, yaw: 0, pitch: 0 });
    // the hips onto the seat (in the seat's frame, where the rider's z is the scooter's x)
    const hip = seat.worldToLocal(p.bones.thigh_l.getWorldPosition(new THREE.Vector3()).add(p.bones.thigh_r.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5));
    seat.position.set(-0.18 - hip.z, 0.88 + 0.09 - hip.y, 0);
    mesh.castShadow = true;
    this.lamp = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff2c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lamp.position.set(0.7, 0.98, 0); this.lamp.scale.set(0.6, 0.6, 1);
    this.group.add(this.lamp);
    parent.add(this.group);
    this.t = range(4, 12, r);
    this.dir = 1;
    this.group.visible = false;
  }
  update(t, dt, night) {
    // a pass every 20-40 s, one way then the other, along the far lane
    this.t -= dt;
    if (!this.group.visible) {
      if (this.t <= 0) { this.group.visible = true; this.x = -36 * this.dir; this.speed = 3.2 + Math.random() * 1.6; }
      return;
    }
    this.x += this.dir * this.speed * dt;
    this.group.position.set(this.x, 0, FAR + (this.dir > 0 ? 1.55 : 1.25));
    this.group.rotation.set(0, this.dir > 0 ? 0 : Math.PI, Math.sin(t * 1.3) * 0.015);
    this.lamp.material.opacity = night ? 0.9 : 0;
    if (Math.abs(this.x) > 36) { this.group.visible = false; this.dir = -this.dir; this.t = 20 + Math.random() * 20; }
  }
}

// ------------------------------------------------------------------ pigeons
function flock(group, n, r) {
  // a bird: a body and two wings (the wingtips flap in the shader)
  const g = new THREE.BufferGeometry();
  const P = [
    0, 0, 0.16, -0.04, 0, -0.12, 0.04, 0, -0.12,               // body
    0, 0, 0.06, 0, 0, -0.06, 0.32, 0.02, -0.02,                // left wing
    0, 0, 0.06, -0.32, 0.02, -0.02, 0, 0, -0.06,               // right wing
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const info = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const ring = i % 2;
    info[i * 4] = ring ? 12 : 9 + r() * 4;                      // radius
    info[i * 4 + 1] = 17 + r() * 7;                             // height
    info[i * 4 + 2] = (ring ? -1 : 1) * (0.32 + r() * 0.06);    // angular speed (rad/s)
    info[i * 4 + 3] = r() * 6.283;                              // phase
  }
  g.setAttribute('aBird', new THREE.InstancedBufferAttribute(info, 4));
  const centre = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { centre[i * 2] = i % 2 ? 9 : -13; centre[i * 2 + 1] = i % 2 ? FAR - 12 : FAR - 8; }
  g.setAttribute('aCentre', new THREE.InstancedBufferAttribute(centre, 2));
  const m = new THREE.MeshBasicMaterial({ color: 0x4a4d55, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = W.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aBird; attribute vec2 aCentre; uniform float uTime;`)
      .replace('#include <begin_vertex>', `
        float a = aBird.w + uTime * aBird.z;
        float flap = sin(uTime * (11.0 + aBird.w) + aBird.w * 3.0);
        vec3 transformed = position;
        transformed.y += abs(transformed.x) * flap * 0.9;
        // fly round the circle, banked into the turn, bobbing
        vec2 tg = vec2(-sin(a), 0.7 * cos(a)) * sign(aBird.z);
        float heading = atan(tg.x, tg.y);
        float c = cos(heading), s = sin(heading);
        transformed = vec3(c * transformed.x + s * transformed.z, transformed.y, -s * transformed.x + c * transformed.z);
        transformed += vec3(aCentre.x + cos(a) * aBird.x, aBird.y + sin(a * 2.0 + aBird.w) * 0.8, aCentre.y + sin(a) * aBird.x * 0.7);`);
  };
  m.customProgramCacheKey = () => 'street-pigeons';
  const mesh = new THREE.InstancedMesh(g, m, n);
  mesh.frustumCulled = false; mesh.name = 'street:pigeons';
  group.add(mesh);
  return mesh;
}

// ------------------------------------------------------------------ the street
export class StreetLife {
  constructor(group, crowd, { quality = () => 2 } = {}) {
    this.group = group; this.quality = quality;
    this.walkers = []; this.level = -1;
    const r = rng(9091);
    this.birds = flock(group, 26, r);
    crowd.ready.then(() => {
      if (!crowd.people) return;
      const { halfL } = PITCH, P = crowd.people;
      const lane = FAR + 1.75;                                  // the far lane's walkway
      const routes = [
        // along the far lane, both ways (round the electricity pole at x = -1)
        { who: 'woman_kurta', path: [[-36, lane], [-2.2, lane], [-1, lane - 0.35], [0.2, lane], [36, lane]], speed: 1.15 },
        { who: 'man_shirt', path: [[36, lane + 0.3], [0.2, lane + 0.3], [-1, lane - 0.15], [-2.2, lane + 0.3], [-36, lane + 0.3]], speed: 1.3 },
        // out of the alley and along the lane
        { who: 'boy', path: [[7.5, FAR - 40], [7.5, lane - 0.2], [-36, lane - 0.2]], speed: 1.6 },
        // the end lanes
        { who: 'worker', path: [[-SIDE + 1.3, FAR + 1], [-SIDE + 1.3, 12.5], [-SIDE + 1.3, FAR + 1]], speed: 1.2 },
        { who: 'woman_young', path: [[SIDE - 1.3, 12.5], [SIDE - 1.3, FAR + 1], [SIDE - 1.3, 12.5]], speed: 1.25 },
        { who: 'old_man', path: [[-36, lane + 0.15], [36, lane + 0.15]], speed: 0.85 },
      ];
      for (const [i, w] of routes.entries()) {
        const tpl = P[w.who];
        if (!tpl) continue;
        this.walkers.push(new Walker(group, tpl, paletteFor(w.who, tpl.meta.kid, r), w.path, { speed: w.speed, at: (i * 0.37) % 1, r }));
      }
      if (P.man_slim) this.scooter = new Scooter(group, P.man_slim, paletteFor('man_slim', false, r), r);
      this.applyLevel(true);
    });
  }
  applyLevel(force) {
    const lvl = Math.max(0, Math.min(3, this.quality()));
    if (lvl === this.level && !force) return;
    this.level = lvl;
    this.walkers.forEach((w, i) => { w.visible = i < WALKERS[lvl]; });
  }
  update(t, dt) {
    this.applyLevel(false);
    const night = W.uNight.value > 0.5;
    this.birds.visible = !night;
    for (const w of this.walkers) if (w.group.visible) w.update(t, dt);
    this.scooter?.update(t, dt, night);
  }
}
