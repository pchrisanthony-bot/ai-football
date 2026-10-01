// An open grass pitch, drawn from the live PITCH: tiled turf with mown stripes (in the
// shader, so it's crisp at any size) and the markings as flat geometry — touch and goal
// lines, halfway line, centre circle and spot, penalty and goal areas, penalty spots and
// arcs, corner arcs. Everything comes from the pitch data; nothing is drawn per format.
import * as THREE from 'three';
import { PITCH } from '../sim/pitch.js';
import { grassTile } from './textures.js';

const LINE = 0.12;   // m: line width (Law 1: no more than 12 cm)

// Flat quads for every marking, merged into one geometry (one draw call).
function markingGeometry() {
  const P = PITCH, pos = [], idx = [];
  const quad = (ax, az, bx, bz, w = LINE) => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2, i = pos.length / 3;
    pos.push(ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx - nx, 0, bz - nz, bx + nx, 0, bz + nz);
    idx.push(i, i + 2, i + 1, i, i + 3, i + 2);   // wound to face up (+y)
  };
  // Lines are drawn inside the field: the outer edge of a boundary line is the boundary.
  const L = P.halfL - LINE / 2, W = P.halfW - LINE / 2;
  const line = (ax, az, bx, bz) => quad(ax, az, bx, bz);
  const arc = (cx, cz, r, a0, a1, keep = () => true) => {
    const n = Math.max(8, Math.ceil(r * Math.abs(a1 - a0) * 3));
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
      const x0 = cx + Math.cos(t0) * r, z0 = cz + Math.sin(t0) * r, x1 = cx + Math.cos(t1) * r, z1 = cz + Math.sin(t1) * r;
      if (keep((x0 + x1) / 2, (z0 + z1) / 2)) line(x0, z0, x1, z1);
    }
  };
  const spot = (x, z, r = 0.22) => quad(x - r / 2, z, x + r / 2, z, r);
  // boundary, halfway line, centre
  line(-L, -W, L, -W); line(-L, W, L, W); line(-L, -W, -L, W); line(L, -W, L, W);
  line(0, -W, 0, W);
  arc(0, 0, P.centreR, 0, Math.PI * 2);
  spot(0, 0);
  for (const s of [-1, 1]) {
    const gx = s * L;
    const ka = P.keeperArea;
    if (ka.kind === 'rect') {
      const bx = gx - s * ka.depth, hw = ka.width / 2;
      line(gx, -hw, bx, -hw); line(gx, hw, bx, hw); line(bx, -hw, bx, hw);
    }
    if (P.goalArea) {
      const ax = gx - s * P.goalArea.depth, hw = P.goalArea.width / 2;
      line(gx, -hw, ax, -hw); line(gx, hw, ax, hw); line(ax, -hw, ax, hw);
    }
    if (P.penaltySpot) {
      const px = s * (P.halfL - P.penaltySpot);
      spot(px, 0);
      // The arc ("D") outside the area: the centre-circle radius round the spot.
      if (ka.kind === 'rect') arc(px, 0, P.centreR, 0, Math.PI * 2, (x) => (s * x) < P.halfL - ka.depth);
    }
    // corner arcs
    if (P.cornerArc) for (const zs of [-1, 1]) {
      const a = Math.atan2(-zs, -s);
      arc(gx, zs * W, P.cornerArc, a - Math.PI / 4, a + Math.PI / 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// The turf (pitch + run-off) and its markings. Returns { group, setWet }.
export function buildOpenPitch(maxAniso) {
  const P = PITCH, group = new THREE.Group();
  const tile = grassTile().clone();   // own repeat; the image is shared
  tile.needsUpdate = true;
  tile.anisotropy = maxAniso;
  const fullL = P.length + 2 * P.runoff, fullW = P.width + 2 * P.runoff;
  tile.repeat.set(fullL / 3, fullW / 3);
  const stripeW = P.length / Math.max(10, Math.round(P.length / 5.5) & ~1);   // an even number of mown bands
  const turf = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.95, metalness: 0 });
  turf.onBeforeCompile = (sh) => {
    sh.uniforms.uStripe = { value: stripeW };
    sh.uniforms.uHalf = { value: new THREE.Vector2(P.halfL, P.halfW) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld; uniform float uStripe; uniform vec2 uHalf;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // Mown bands across the pitch (lighter / darker), softer in the run-off.
          float band = step(0.5, fract((vWorld.x + uHalf.x) / (2.0 * uStripe)));
          float inField = step(abs(vWorld.x), uHalf.x) * step(abs(vWorld.z), uHalf.y);
          diffuseColor.rgb *= mix(0.94, 1.0 + 0.09 * (band * 2.0 - 1.0), inField);
          // Wear: the goalmouths and the centre.
          vec2 g = vec2(abs(vWorld.x) - uHalf.x + 4.0, vWorld.z);
          float wear = exp(-dot(g, g) / 18.0) * 0.18 + exp(-dot(vWorld.xz, vWorld.xz) / 30.0) * 0.08;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.38, 0.24), wear);
        }`);
  };
  turf.customProgramCacheKey = () => `turf${stripeW.toFixed(2)}`;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(fullL, fullW), turf);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  group.add(ground);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd6d6d0, roughness: 0.8, emissive: 0x000000, polygonOffset: true, polygonOffsetFactor: -2 });
  const lines = new THREE.Mesh(markingGeometry(), lineMat);
  lines.position.y = 0.004; lines.receiveShadow = true;
  group.add(lines);
  // Rain: the grass goes glossy and darker so the floodlights streak on it.
  const setWet = on => { turf.roughness = on ? 0.5 : 0.95; turf.color.setScalar(on ? 0.82 : 1); lineMat.roughness = on ? 0.35 : 0.7; };
  return { group, setWet };
}
