// =====================================================================
// The neighbourhood watching: people on the chawl galleries and balconies, on the
// rooftops and the stairs, at the shop counters, on chairs and doorsteps, along the fence.
// They're real people (MakeHuman, CC0: tools/characters/build_crowd.py), each posed once
// at load on the players' rig and baked into ONE static mesh: one draw call, no skinning.
//
// Alive in the vertex shader:
//   · heads follow the ball (yaw and pitch about the neck, within a comfortable range)
//   · a slow sway from the feet (weight shifts, breathing)
//   · the cheer: a second pose baked per person (arms up, a fist pump, the free hand up
//     while filming) blended in with the crowd's excitement, each with their own delay;
//     the standing ones jump on a goal
// Who stands where comes from the venue's spots (kind: rail · roof · stair · step · counter
// · chair · fence). People are ordered by how much they're seen from the gameplay camera,
// so lower quality levels draw fewer of them from the same buffers (setDrawRange).
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PITCH } from '../../sim/pitch.js';
import { rng, pick, range } from './util.js';

const URL = 'assets/crowd/crowd.glb';
const COUNT = [16, 32, 48, 72];                     // people drawn per quality level

// ------------------------------------------------------------------ the look
// South Asian skin tones (and the odd lighter/darker one), clothes as the street wears them.
const SKIN = ['#d8a882', '#c9946c', '#b98260', '#a87253', '#97654a', '#85563e', '#71482f', '#e2b796'];
const TOPS = ['#f2efe6', '#e8e2d0', '#5b8fd6', '#c62e3a', '#2f6e4f', '#e0a526', '#7b2d52', '#283a6b', '#e87d2b', '#37a3a0', '#efe0b9', '#9b9ea3', '#1d1d20', '#d65c8b', '#6a8f3a'];
const PANTS = ['#2f4a6e', '#2b3d5c', '#1f2124', '#3a3c40', '#6b6250', '#8a7a5c', '#4a4f57', '#24324d'];
const KURTA = [['#c2185b', '#f1e3b1'], ['#ef7f1a', '#5d1a2e'], ['#2e7d32', '#eadfc0'], ['#3949ab', '#e8e6e0'], ['#ad1457', '#283593'], ['#f2b81c', '#8a1538'], ['#00838f', '#f3e0c0'], ['#7b1fa2', '#f5d76e']];
const FROCK = ['#e91e63', '#ffb300', '#26a69a', '#f06292', '#5c6bc0', '#ef5350'];
const HAIR = ['#120e0c', '#17110d', '#1d1510', '#0e0c0b', '#2a1c12'];
const GREY = ['#77736e', '#8f8b86', '#5f5b56'];
const SHOES = ['#3a2a1e', '#1c1c1c', '#2a3f6a', '#6e2420', '#4b3a2a'];                // chappals, sandals
const SNEAKERS = ['#ececec', '#1d1d22', '#d9d9d9', '#3c5fa8'];

// ------------------------------------------------------------------ poses
// Directions in the body's frame (+x his left, +y up, +z the way he faces); arms and legs
// as [upper, lower]. Right-hand sides are the left mirrored unless given.
const v = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const mirror = d => new THREE.Vector3(-d.x, d.y, d.z);
const STAND_LEGS = { L: [v(0.04, -1, 0), v(0.03, -1, -0.02)] };
const POSES = {
  stand:   { arms: { L: [v(0.13, -1, 0.02), v(0.08, -1, 0.14)] }, legs: STAND_LEGS, lean: 0.02, jump: 1 },
  crossed: { arms: { L: [v(0.16, -0.8, 0.5), v(-0.95, 0.12, 0.22)], R: [v(-0.16, -0.78, 0.55), v(0.95, 0.2, 0.12)] }, legs: STAND_LEGS, lean: -0.04, jump: 1 },
  hips:    { arms: { L: [v(0.72, -0.62, -0.2), v(-0.65, -0.72, 0.18)] }, legs: { L: [v(0.12, -1, 0), v(0.08, -1, -0.02)] }, lean: -0.03, jump: 1 },
  rail:    { arms: { L: [v(0.05, -0.85, 0.52), v(-0.38, -0.05, 0.93)] }, legs: { L: [v(0.03, -1, -0.1), v(0.02, -1, -0.14)], R: [v(-0.05, -1, 0.04), v(-0.03, -1, 0)] }, lean: 0.36, head: -0.28, jump: 0 },
  phone:   { arms: { L: [v(0.14, -0.95, 0.3), v(-0.42, -0.25, 0.87)], R: [v(-0.12, -0.55, 0.82), v(0.22, 0.62, 0.75)] }, legs: STAND_LEGS, lean: 0.03, phone: 1, jump: 0 },
  point:   { arms: { L: [v(0.13, -1, 0.02), v(0.08, -1, 0.14)], R: [v(-0.12, 0.18, 0.98), v(-0.08, 0.22, 0.97)] }, legs: STAND_LEGS, lean: 0.05, jump: 1 },
  fence:   { arms: { L: [v(0.32, -0.12, 0.94), v(0.06, 0.55, 0.83)] }, legs: STAND_LEGS, lean: 0.08, jump: 0 },
  counter: { arms: { L: [v(0.2, -0.78, 0.6), v(0.05, -0.62, 0.78)] }, legs: STAND_LEGS, lean: 0.16, jump: 0 },
  sit:     { arms: { L: [v(0.16, -0.88, 0.42), v(-0.04, -0.48, 0.88)] }, legs: { L: [v(0.13, -0.04, 1), v(0.05, -1, 0.1)] }, lean: 0.12, sit: 0.44, jump: 0 },     // a chair (seat above the floor)
  sitlow:  { arms: { L: [v(0.22, -0.72, 0.65), v(-0.28, -0.2, 0.94)] }, legs: { L: [v(0.17, 0.46, 0.87), v(0.04, -1, -0.12)] }, lean: 0.32, sit: 0, jump: 0 },       // a doorstep (the spot is its top)
};
// The cheer for each pose: both arms up (a V), a fist pump off the rail, the free hand up.
const UP = { L: [v(0.42, 0.88, 0.22), v(0.24, 0.96, 0.16)], sym: true };
const CHEER = {
  stand: { arms: UP }, crossed: { arms: UP }, hips: { arms: UP }, point: { arms: UP }, counter: { arms: UP, lean: 0.02 },
  rail: { arms: { R: [v(-0.3, 0.86, 0.42), v(-0.12, 0.97, 0.2)] } },
  phone: { arms: { L: UP.L } },
  fence: { arms: { L: [v(0.3, 0.55, 0.78), v(0.1, 0.92, 0.38)], sym: true } },
  sit: { arms: UP, lean: -0.04 }, sitlow: { arms: UP, lean: 0.1 },
};
function poseOf(name, cheer, jitter) {
  const P = POSES[name], C = cheer ? CHEER[name] || {} : {};
  // a limb from the cheer if it has one (its left mirrored when it's symmetric), else the pose's
  const limb = (part, s) => {
    const c = C[part], p = P[part];
    const src = (c && (c[s] || (s === 'R' && c.sym ? mirrorPair(c.L) : null))) || p[s] || mirrorPair(p.L);
    return src.map(d => d.clone().add(jitter[part + s]).normalize());
  };
  return { arms: { L: limb('arms', 'L'), R: limb('arms', 'R') }, legs: { L: limb('legs', 'L'), R: limb('legs', 'R') }, lean: (C.lean ?? P.lean) + jitter.lean, head: P.head || 0, sit: P.sit, phone: P.phone };
}
const mirrorPair = pair => pair.map(mirror);

// ------------------------------------------------------------------ a template person
const DOWN = new THREE.Vector3(0, -1, 0);
const ALIGN_DOWN = ['upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r'];
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n = new THREE.Vector3();

export class Person {
  constructor(id, root, meta) {
    this.id = id; this.root = root; this.meta = meta;
    this.meshes = [];
    this.bones = {};
    this.all = [];
    root.traverse(o => {
      if (o.isSkinnedMesh) this.meshes.push(o);
      if (o.isBone) { this.bones[o.name] = o; this.all.push(o); }
    });
    root.updateMatrixWorld(true);
    // calibration (as the players': humanmodel.js): each bone's rest rotation with the
    // limbs brought straight down, so a pose is "rotate the hanging limb to point there".
    // (Rotations are in the frame of the rig's parent: a walker's group moves and turns.)
    this.C = {}; this.restLocal = {};
    const base = this.baseInv();
    for (const b of this.all) {
      this.restLocal[b.name] = b.quaternion.clone();
      const w = base.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
      const align = new THREE.Quaternion();
      if (ALIGN_DOWN.includes(b.name)) align.setFromUnitVectors(_v.set(0, 1, 0).applyQuaternion(w), DOWN);
      this.C[b.name] = align.multiply(w);
    }
    this.hip = this.bones.thigh_l.getWorldPosition(new THREE.Vector3()).y;
    meta.height ??= this.bones.head.getWorldPosition(new THREE.Vector3()).y + 0.13;
    // per region: the baked texture detail, normalised (so recolouring keeps the folds)
    this.regions = this.meshes.map(m => {
      const c = m.geometry.attributes.color, region = m.material.name;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < c.count; i++) { r += c.getX(i); g += c.getY(i); b += c.getZ(i); }
      const n = Math.max(1, c.count);
      return { mesh: m, region, mean: [r / n, g / n, b / n] };
    });
  }

  baseInv() { return this.root.parent ? this.root.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion(); }

  // T: bone → driver rotation (the bone's world rotation is T·C); the rest follow their parents.
  pose(T) {
    const world = this._world || (this._world = {});
    const parentQ = new THREE.Quaternion(), base = this.baseInv();
    for (const b of this.all) {
      const p = b.parent;
      if (p && p.isBone) parentQ.copy(world[p.name]); else parentQ.copy(base).multiply(p.getWorldQuaternion(_q));
      const wq = world[b.name] || (world[b.name] = new THREE.Quaternion());
      if (T[b.name]) wq.copy(T[b.name]).multiply(this.C[b.name]);
      else wq.copy(parentQ).multiply(this.restLocal[b.name]);
      b.quaternion.copy(parentQ.invert()).multiply(wq);
    }
    this.root.updateMatrixWorld(true);
  }

  drive(P, look) {
    const T = {};
    const aim = d => new THREE.Quaternion().setFromUnitVectors(DOWN, d);
    const bend = (a, b, q) => new THREE.Quaternion().setFromUnitVectors(a, b).multiply(q);
    const spine = new THREE.Quaternion().setFromEuler(new THREE.Euler(P.lean, look.twist, look.roll, 'YXZ'));
    T.pelvis = new THREE.Quaternion().setFromEuler(new THREE.Euler(P.lean * 0.3, look.twist * 0.3, look.roll * 0.5, 'YXZ'));
    T.spine_01 = T.pelvis.clone().slerp(spine, 0.45);
    T.spine_02 = T.pelvis.clone().slerp(spine, 0.8);
    T.spine_03 = spine;
    const head = new THREE.Quaternion().setFromEuler(new THREE.Euler(P.head + look.pitch, look.yaw, 0, 'YXZ'));
    T.head = spine.clone().multiply(head);
    T.neck_01 = spine.clone().slerp(T.head, 0.5);
    for (const s of ['L', 'R']) {
      const l = s.toLowerCase(), [ua, la] = P.arms[s], [th, sh] = P.legs[s];
      T['upperarm_' + l] = aim(ua);
      T['lowerarm_' + l] = bend(ua, la, T['upperarm_' + l]);
      T['hand_' + l] = T['lowerarm_' + l];
      T['thigh_' + l] = aim(th);
      T['calf_' + l] = bend(th, sh, T['thigh_' + l]);
      T['foot_' + l] = T['calf_' + l];
      T['ball_' + l] = T['calf_' + l];
    }
    this.pose(T);
  }

  // Skin every vertex (linear blend, as the GPU would) into the given arrays, through xf.
  skin(xf, outP, outN, at) {
    let k = at;
    const nm = new THREE.Matrix3();
    for (const { mesh } of this.regions) {
      const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
      const sk = mesh.skeleton, S = sk.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(xf, mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(b.matrixWorld).multiply(sk.boneInverses[i]).multiply(mesh.bindMatrix));
      const acc = new THREE.Matrix4();
      for (let i = 0; i < pos.count; i++, k++) {
        const e = acc.elements; e.fill(0);
        for (let j = 0; j < 4; j++) {
          const w = sw.getComponent(i, j);
          if (!w) continue;
          const se = S[si.getComponent(i, j)].elements;
          for (let q = 0; q < 16; q++) e[q] += se[q] * w;
        }
        _v.fromBufferAttribute(pos, i).applyMatrix4(acc);
        outP[k * 3] = _v.x; outP[k * 3 + 1] = _v.y; outP[k * 3 + 2] = _v.z;
        nm.setFromMatrix4(acc);
        _n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        outN[k * 3] = _n.x; outN[k * 3 + 1] = _n.y; outN[k * 3 + 2] = _n.z;
      }
    }
    return k;
  }

  // weight of the head (and half the neck) per vertex: what turns to follow the ball
  headWeights(out, at) {
    let k = at;
    for (const { mesh } of this.regions) {
      const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = mesh.skeleton.bones;
      const hw = bones.map(b => b.name === 'head' ? 1 : b.name === 'neck_01' ? 0.55 : 0);
      for (let i = 0; i < g.attributes.position.count; i++, k++) {
        let h = 0;
        for (let j = 0; j < 4; j++) h += hw[si.getComponent(i, j)] * sw.getComponent(i, j);
        out[k] = h;
      }
    }
    return k;
  }

  get vertexCount() { return this.regions.reduce((a, r) => a + r.mesh.geometry.attributes.position.count, 0); }
}

// ------------------------------------------------------------------ the crowd
export class Crowd {
  constructor(group, spots, { quality = () => 2 } = {}) {
    this.group = group; this.spots = spots; this.quality = quality;
    this.U = { uTime: { value: 0 }, uCheer: { value: 0 }, uBall: { value: new THREE.Vector3(0, 0, 0) } };
    this.excite = 0; this.goalT = 0; this.level = -1;
    window.__crowd = this;                            // (tools/play/crowd-shots.mjs)
    this.ready = new GLTFLoader().loadAsync(URL).then(g => this.build(g), e => { console.warn('crowd: not loaded', e); });
  }

  build(gltf) {
    const P_ = gltf.parser;
    gltf.scene.traverse(o => { const a = P_.associations.get(o); if (a && a.nodes != null && P_.json.nodes[a.nodes].name) o.name = P_.json.nodes[a.nodes].name; });
    const people = {};
    for (const root of gltf.scene.children) {
      const id = root.name.replace(/_rig$/, '');
      people[id] = new Person(id, root, {});
    }
    this.people = people;
    const r = rng(7041), t0 = performance.now();
    const plan = this.plan(r).slice(0, COUNT[COUNT.length - 1]);
    // buffers
    let nv = 0, ni = 0;
    for (const p of plan) { const t = people[p.who]; nv += t.vertexCount + (p.pose === 'phone' ? 24 : 0); ni += t.regions.reduce((a, q) => a + q.mesh.geometry.index.count, 0) + (p.pose === 'phone' ? 36 : 0); }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), P2 = new Float32Array(nv * 3), N2 = new Float32Array(nv * 3);
    const Col = new Uint8Array(nv * 3), Neck = new Float32Array(nv * 4), Anim = new Float32Array(nv * 4), Head = new Float32Array(nv);
    const I = new Uint32Array(ni);
    let k = 0, ii = 0;
    this.ends = [];
    this.fans = [];
    const xf = new THREE.Matrix4(), col = new THREE.Color();
    for (const p of plan) {
      const t = people[p.who], base = k;
      const jitter = { lean: range(-0.04, 0.04, r) };
      for (const s of ['armsL', 'armsR', 'legsL', 'legsR']) jitter[s] = new THREE.Vector3(range(-0.07, 0.07, r), range(-0.05, 0.05, r), range(-0.07, 0.07, r)).multiplyScalar(s.startsWith('legs') ? 0.3 : 1);
      const look = { twist: range(-0.12, 0.12, r), roll: range(-0.04, 0.04, r), yaw: range(-0.2, 0.2, r), pitch: range(-0.05, 0.1, r) };
      // pose A, then where the person goes (sitting: the hips onto the seat)
      const A = poseOf(p.pose, false, jitter);
      t.drive(A, look);
      const hip = t.bones.thigh_l.getWorldPosition(new THREE.Vector3()).add(t.bones.thigh_r.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
      let lift = 0, back = 0;
      if (A.sit != null) { lift = A.sit + 0.09 - hip.y; back = -hip.z - 0.02; }
      xf.makeRotationY(p.face).setPosition(p.x, p.y + lift, p.z);
      xf.multiply(_m.makeTranslation(0, 0, back));
      t.skin(xf, P, N, base);
      const neck = t.bones.neck_01.getWorldPosition(new THREE.Vector3()).applyMatrix4(xf);
      let phoneAt = null;
      if (A.phone) {
        const hand = t.bones.hand_r.getWorldPosition(new THREE.Vector3());
        const fore = hand.clone().sub(t.bones.lowerarm_r.getWorldPosition(new THREE.Vector3())).normalize();
        phoneAt = hand.addScaledVector(fore, 0.07).applyMatrix4(xf);
      }
      // pose B: the cheer
      t.drive(poseOf(p.pose, true, jitter), look);
      t.skin(xf, P2, N2, base);
      let end = t.headWeights(Head, base);
      // colours
      const pal = this.palette(p, r);
      for (const { mesh, region, mean } of t.regions) {
        const c = mesh.geometry.attributes.color;
        for (let i = 0; i < c.count; i++) {
          const j = k + i;
          const br = c.getX(i), bg = c.getY(i), bb = c.getZ(i);
          tint(region, mean, br, bg, bb, pal, col);
          Col[j * 3] = Math.round(clamp(col.r, 0, 1) * 255); Col[j * 3 + 1] = Math.round(clamp(col.g, 0, 1) * 255); Col[j * 3 + 2] = Math.round(clamp(col.b, 0, 1) * 255);
        }
        // the indices
        const idx = mesh.geometry.index;
        for (let i = 0; i < idx.count; i++) I[ii++] = k + idx.getX(i);
        if (p.fan && region === 'top') this.fans.push({ from: k, count: c.count, team: p.fan - 1, mesh, mean });
        k += c.count;
      }
      // the phone (filming the match)
      if (phoneAt) {
        const box = new THREE.BoxGeometry(0.075, 0.15, 0.012);
        const rot = new THREE.Matrix4().makeRotationY(p.face).setPosition(phoneAt), nm = new THREE.Matrix3().setFromMatrix4(rot);
        const bp = box.attributes.position, bn = box.attributes.normal;
        for (let i = 0; i < 24; i++) {
          _v.fromBufferAttribute(bp, i).applyMatrix4(rot); _n.fromBufferAttribute(bn, i).applyMatrix3(nm);
          for (const [arr, src] of [[P, _v], [P2, _v], [N, _n], [N2, _n]]) { arr[(k + i) * 3] = src.x; arr[(k + i) * 3 + 1] = src.y; arr[(k + i) * 3 + 2] = src.z; }
          Col[(k + i) * 3] = 22; Col[(k + i) * 3 + 1] = 22; Col[(k + i) * 3 + 2] = 26;
        }
        for (let i = 0; i < 36; i++) I[ii++] = k + box.index.getX(i);
        k += 24;
      }
      end = k;
      // per person: the neck (head pivot) and facing; the head weight, phase, jump, feet
      const phase = r();
      for (let j = base; j < end; j++) {
        Neck[j * 4] = neck.x; Neck[j * 4 + 1] = neck.y; Neck[j * 4 + 2] = neck.z; Neck[j * 4 + 3] = p.face;
        Anim[j * 4] = Head[j]; Anim[j * 4 + 1] = phase; Anim[j * 4 + 2] = POSES[p.pose].jump * (t.meta.kid ? 1.3 : 1); Anim[j * 4 + 3] = p.y;
      }
      this.ends.push(ii);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('position2', new THREE.BufferAttribute(P2, 3));
    g.setAttribute('normal2', new THREE.BufferAttribute(N2, 3));
    g.setAttribute('color', new THREE.BufferAttribute(Col, 3, true));
    g.setAttribute('aNeck', new THREE.BufferAttribute(Neck, 4));
    g.setAttribute('aAnim', new THREE.BufferAttribute(Anim, 4));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingSphere();
    this.colors = g.attributes.color;
    const mat = crowdMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }), this.U);
    const mesh = this.mesh = new THREE.Mesh(g, mat);
    mesh.name = 'street:crowd';
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.customDepthMaterial = crowdMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), this.U, true);
    this.group.add(mesh);
    this.count = plan.length;
    console.info(`crowd: ${plan.length} baked (${k} vertices, ${ii / 3} triangles) in ${Math.round(performance.now() - t0)} ms`);
    this.applyLevel(true);
    if (this.kits) this.setKits(...this.kits);
    return this;
  }

  // Who goes where, most-seen first.
  plan(r) {
    const { halfW, halfL } = PITCH, used = [];
    const free = (s, d = 0.7) => !used.some(u => Math.abs(u.y - s.y) < 1 && Math.hypot(u.x - s.x, u.z - s.z) < d);
    const ADULTS = ['man_tee', 'man_shirt', 'man_slim', 'worker', 'woman_kurta', 'woman_young', 'man_long', 'woman_older', 'old_man'];
    const KIDS = ['boy', 'girl', 'teen'];
    const FANS = ['man_tee', 'man_slim', 'teen', 'boy', 'boy', 'teen', 'man_long', 'woman_young', 'girl', 'man_shirt'];
    for (const t of Object.values(this.people)) t.meta.kid = KIDS.includes(t.id);
    const out = [];
    const towardPitch = (s) => {
      // turn a little toward the court's centre (they're watching), within 35°
      const want = Math.atan2(-s.x, -s.z);
      let d = want - s.face; d = Math.atan2(Math.sin(d), Math.cos(d));
      return s.face + Math.max(-0.6, Math.min(0.6, d));
    };
    const score = (s) => {
      // seen from the gameplay camera: low, near the court, the far side
      const dist = Math.hypot(Math.max(0, Math.abs(s.x) - halfL), Math.max(0, Math.abs(s.z) - halfW));
      return -dist * 0.6 - s.y * 0.3 + (s.z < 0 ? 2 : 0) + r() * 2;
    };
    // Each kind of place gets its share, interleaved so every quality level's first N
    // people are a mix: the fence, the galleries and balconies, the shops, chairs, steps.
    // (None on the near side: they'd stand between the gameplay camera and the play.)
    const SHARE = { fence: 0.3, rail: 0.36, roof: 0.06, stair: 0.04, step: 0.08, counter: 0.1, chair: 0.06 };
    const byKind = {};
    for (const s of this.spots) {
      if (!SHARE[s.kind] || (s.z > halfW && Math.abs(s.x) < halfL + 4)) continue;
      (byKind[s.kind] || (byKind[s.kind] = [])).push({ ...s, score: score(s) });
    }
    for (const k in byKind) byKind[k].sort((a, b) => b.score - a.score);
    const spots = [], taken = {};
    for (;;) {
      let best = null, need = -Infinity;
      for (const k in byKind) {
        if (!byKind[k].length) continue;
        const d = SHARE[k] * (spots.length + 1) - (taken[k] || 0);
        if (d > need) { need = d; best = k; }
      }
      if (!best) break;
      spots.push(byKind[best].shift()); taken[best] = (taken[best] || 0) + 1;
    }
    for (const s of spots) {
      if (!free(s)) continue;
      let who, pose, x = s.x, z = s.z, y = s.y, face = s.face;
      const kidOK = s.kind === 'fence' || s.kind === 'step' || s.kind === 'chair' || (s.kind === 'rail' && s.y < 8);
      const kid = kidOK && r() < (s.kind === 'fence' ? 0.4 : 0.22);
      if (s.kind === 'fence') {
        who = kid ? pick(KIDS, r) : pick(FANS, r);
        pose = pick(kid ? ['fence', 'fence', 'stand', 'point', 'hips'] : ['fence', 'crossed', 'stand', 'phone', 'hips', 'point', 'crossed'], r);
        if (pose === 'fence') {
          // close enough to hold the chain-link: 0.55 m off the fence's plane
          const fx = Math.abs(s.x) > halfL + 0.3, plane = (fx ? halfL : halfW) + 0.22 + 0.38;
          if (fx) x = Math.sign(s.x) * plane; else z = Math.sign(s.z) * plane;
        } else face = towardPitch(s);
      } else if (s.kind === 'rail' || s.kind === 'roof' || s.kind === 'stair') {
        who = kid ? pick(KIDS, r) : pick(ADULTS, r);
        pose = kid ? pick(['stand', 'point', 'crossed'], r) : pick(['rail', 'rail', 'rail', 'crossed', 'phone', 'hips', 'stand'], r);
        if (pose !== 'rail') face = towardPitch(s);
      } else if (s.kind === 'step') {
        who = kid ? pick(KIDS, r) : pick(['woman_kurta', 'woman_older', 'old_man', 'man_shirt', 'woman_young', 'worker'], r);
        pose = r() < 0.6 ? 'sitlow' : pick(['crossed', 'stand', 'hips'], r);
        if (pose === 'sitlow') { y = s.y; } else face = towardPitch(s);
      } else if (s.kind === 'counter') {
        who = pick(['man_shirt', 'old_man', 'worker', 'woman_older', 'man_tee'], r);
        pose = s.counter ? pick(['counter', 'counter', 'crossed'], r) : pick(['crossed', 'stand', 'hips', 'phone'], r);
      } else if (s.kind === 'chair') {
        who = kid ? pick(KIDS, r) : pick(['old_man', 'man_shirt', 'woman_older', 'old_man', 'man_tee', 'woman_kurta'], r);
        pose = 'sit';
      } else continue;
      if (this.people[who].meta.kid && (pose === 'rail' || pose === 'counter')) pose = 'stand';
      used.push(s);
      out.push({ who, pose, x, y, z, face, kind: s.kind, fan: s.kind === 'fence' && r() < 0.3 ? 1 + (r() < 0.5 ? 1 : 0) : 0 });
    }
    console.info(`crowd: ${out.length} people from ${this.spots.length} spots`, out.reduce((a, p) => { a[p.pose] = (a[p.pose] || 0) + 1; return a; }, {}));
    return out;
  }

  palette(p, r) {
    const id = p.who, t = this.people[id];
    return paletteFor(id, t.meta.kid, r);
  }


  applyLevel(force) {
    const lvl = Math.max(0, Math.min(3, this.quality()));
    if (!this.mesh || (lvl === this.level && !force)) return;
    this.level = lvl;
    const n = Math.min(this.count, COUNT[lvl]);
    this.mesh.geometry.setDrawRange(0, n ? this.ends[n - 1] : 0);
  }

  // Fans in the teams' colours (a few kids and young men at the fence in replica shirts).
  setKits(a, b) {
    this.kits = [a, b];
    if (!this.colors) return;
    const C = this.colors.array, col = new THREE.Color();
    for (const f of this.fans) {
      col.set((f.team ? b : a).shirt);
      const c = f.mesh.geometry.attributes.color, m = f.mean, ml = m[0] * 0.3 + m[1] * 0.59 + m[2] * 0.11;
      for (let i = 0; i < f.count; i++) {
        const lum = clamp((c.getX(i) * 0.3 + c.getY(i) * 0.59 + c.getZ(i) * 0.11) / Math.max(1e-4, ml), 0.55, 1.3);
        const j = (f.from + i) * 3;
        C[j] = Math.round(clamp(col.r * lum, 0, 1) * 255); C[j + 1] = Math.round(clamp(col.g * lum, 0, 1) * 255); C[j + 2] = Math.round(clamp(col.b * lum, 0, 1) * 255);
      }
    }
    this.colors.needsUpdate = true;
  }
  setExcite(x) { this.excite = x; }
  goal() { this.goalT = 4.5; }
  watch(x, y, z) { this.U.uBall.value.set(x, y, z); }
  update(t, dt) {
    this.U.uTime.value = t;
    this.goalT = Math.max(0, this.goalT - dt);
    const want = this.goalT > 0 ? 1 : Math.min(0.45, Math.max(0, this.excite - 0.35) * 0.6);
    const c = this.U.uCheer;
    c.value += (want - c.value) * Math.min(1, dt * (want > c.value ? 5 : 1.4));
    this.applyLevel(false);
  }
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const _tone = new THREE.Color();
// A vertex's colour: the region's colour from the palette, carrying the baked texture's
// detail (folds, seams; on the skin, lips and brows) as a ratio to the region's mean.
export function tint(region, mean, br, bg, bb, pal, col) {
  if (region === 'eyes') return col.setRGB(br, bg, bb);
  if (region === 'skin') return col.set(pal.skin).multiply(_tone.setRGB(clamp(br / mean[0], 0.6, 1.35), clamp(bg / mean[1], 0.6, 1.35), clamp(bb / mean[2], 0.6, 1.35)));
  const lum = (br * 0.3 + bg * 0.59 + bb * 0.11) / Math.max(1e-4, mean[0] * 0.3 + mean[1] * 0.59 + mean[2] * 0.11);
  return col.set(pal[region] || '#888888').multiplyScalar(clamp(lum, 0.55, 1.3));
}

export function paletteFor(id, kid, r) {
  const pal = { skin: pick(SKIN, r), hair: pick(HAIR, r), shoes: pick(SHOES, r), top: pick(TOPS, r), bottom: pick(PANTS, r) };
  if (id === 'man_slim' || id === 'woman_young' || id === 'boy' || id === 'teen') pal.shoes = pick(SNEAKERS, r);
  if (id === 'woman_kurta' || id === 'woman_older') { const [a, b] = pick(KURTA, r); pal.top = a; pal.bottom = b; }
  if (id === 'girl') { pal.top = pick(FROCK, r); pal.bottom = pal.top; }
  if (id === 'old_man') { pal.top = pick(['#f2efe6', '#e8e2d0', '#cfd8dc', '#efe0b9'], r); pal.bottom = pick(['#e8e2d0', '#6b6250', '#3a3c40'], r); }
  if (id === 'woman_older' || id === 'old_man') pal.hair = pick(GREY, r);
  if (id === 'worker') { pal.bottom = pick(['#2b4f7a', '#3f5f3a', '#6b4a2a'], r); }
  if (kid && r() < 0.35) pal.bottom = pick(['#1f2124', '#24324d', '#3a3c40'], r);
  return pal;
}

// The pose blend, the head turning to the ball, the sway and the jump — in the vertex
// shader of the crowd's material and of its shadow (depth) material alike.
function crowdMaterial(m, U, depth = false) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 position2; attribute vec3 normal2; attribute vec4 aNeck; attribute vec4 aAnim;
        uniform float uTime, uCheer; uniform vec3 uBall;
        vec3 cRotY(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
        vec3 cRotK(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
        // each person cheers with their own delay and gusto
        float cCheer(){ return clamp(uCheer * (1.35 - aAnim.y * 0.6) - aAnim.y * 0.08, 0.0, 1.0); }
        // the head: yaw toward the ball, pitch down to it (rails high up look down)
        void cHead(out vec3 kOut, out float yawOut, out float pitchOut){
          vec3 tb = uBall - aNeck.xyz;
          float want = atan(tb.x, tb.z) - aNeck.w; want = atan(sin(want), cos(want));
          yawOut = clamp(want, -1.15, 1.15) * aAnim.x;
          pitchOut = clamp(atan(-tb.y, length(tb.xz)), -0.3, 0.75) * aAnim.x;
          kOut = vec3(cos(aNeck.w), 0.0, -sin(aNeck.w));
        }`)
      .replace('#include <beginnormal_vertex>', depth ? '#include <beginnormal_vertex>' : `
        float cCh = cCheer();
        vec3 cK; float cYaw, cPitch; cHead(cK, cYaw, cPitch);
        vec3 objectNormal = normalize(mix(normal, normal2, cCh));
        objectNormal = cRotY(cRotK(objectNormal, cK, cPitch), cYaw);`)
      .replace('#include <begin_vertex>', `
        ${depth ? 'float cCh = cCheer(); vec3 cK; float cYaw, cPitch; cHead(cK, cYaw, cPitch);' : ''}
        vec3 transformed = mix(position, position2, cCh);
        transformed = aNeck.xyz + cRotY(cRotK(transformed - aNeck.xyz, cK, cPitch), cYaw);
        {
          float ph = aAnim.y * 6.2832, up = max(0.0, transformed.y - aAnim.w);
          // weight shift: a slow lean from the feet, side to side
          transformed += vec3(cos(aNeck.w), 0.0, -sin(aNeck.w)) * sin(uTime * 0.55 + ph) * 0.012 * up;
          // jumping for joy (the standing ones), heads bobbing on the rest
          transformed.y += abs(sin(uTime * 6.8 + ph)) * 0.13 * cCh * cCh * aAnim.z;
        }`);
  };
  m.customProgramCacheKey = () => 'street-crowd' + (depth ? '-depth' : '');
  return m;
}
