// An open grass pitch, drawn from the live PITCH: tiled turf with mown stripes (in the
// shader, so it's crisp at any size) and the markings — touch and goal lines, halfway
// line, centre circle and spot, penalty and goal areas, penalty spots and arcs, corner
// arcs. Everything comes from the pitch data; nothing is drawn per format.
import * as THREE from 'three';
import { PITCH } from '../sim/pitch.js';
import { grassTile } from './textures.js';

const LINE = 0.12;   // m: line width (Law 1: no more than 12 cm)
const MARGIN = 1;    // m of canvas round the field (the boundary lines' outer edge is the field's edge)

// The markings painted onto a transparent canvas laid over the turf. A mipmapped texture
// (rather than geometry) keeps 12 cm lines smooth far down the pitch: they fade with
// distance instead of breaking up into dashes when they're narrower than a pixel.
function markingTexture(maxAniso) {
  const P = PITCH;
  const PPM = Math.min(24, Math.floor(2048 / (P.length + 2 * MARGIN)));   // ≥ 19 px/m on a full pitch
  const c = document.createElement('canvas');
  c.width = Math.round((P.length + 2 * MARGIN) * PPM); c.height = Math.round((P.width + 2 * MARGIN) * PPM);
  const g = c.getContext('2d');
  const X = x => (x + P.halfL + MARGIN) * PPM, Z = z => (z + P.halfW + MARGIN) * PPM;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = LINE * PPM;
  const line = (ax, az, bx, bz) => { g.beginPath(); g.moveTo(X(ax), Z(az)); g.lineTo(X(bx), Z(bz)); g.stroke(); };
  const arc = (cx, cz, r, a0, a1) => { g.beginPath(); g.arc(X(cx), Z(cz), r * PPM, a0, a1); g.stroke(); };
  const spot = (x, z) => { g.beginPath(); g.arc(X(x), Z(z), 0.11 * PPM, 0, Math.PI * 2); g.fill(); };
  // Lines sit inside the field: the outer edge of a boundary line is the boundary.
  const L = P.halfL - LINE / 2, W = P.halfW - LINE / 2;
  line(-L, -W, L, -W); line(L, -W, L, W); line(L, W, -L, W); line(-L, W, -L, -W);
  line(0, -W, 0, W);
  arc(0, 0, P.centreR, 0, Math.PI * 2);
  spot(0, 0);
  for (const s of [-1, 1]) {
    const gx = s * L, ka = P.keeperArea;
    if (ka.kind === 'rect') {
      const bx = gx - s * ka.depth, hw = ka.width / 2;
      line(gx, -hw, bx, -hw); line(bx, -hw, bx, hw); line(bx, hw, gx, hw);
    }
    if (P.goalArea) {
      const ax = gx - s * P.goalArea.depth, hw = P.goalArea.width / 2;
      line(gx, -hw, ax, -hw); line(ax, -hw, ax, hw); line(ax, hw, gx, hw);
    }
    if (P.penaltySpot) {
      const px = s * (P.halfL - P.penaltySpot);
      spot(px, 0);
      // The arc (the "D") outside the area: the centre-circle radius round the spot.
      if (ka.kind === 'rect' && P.centreR > ka.depth - P.penaltySpot) {
        const a = Math.acos((ka.depth - P.penaltySpot) / P.centreR), base = s > 0 ? Math.PI : 0;
        arc(px, 0, P.centreR, base - a, base + a);
      }
    }
    // corner arcs, into the field
    if (P.cornerArc) for (const zs of [-1, 1]) {
      const mid = Math.atan2(-zs, -s);
      arc(gx, zs * W, P.cornerArc, mid - Math.PI / 4, mid + Math.PI / 4);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
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
  const lineMat = new THREE.MeshStandardMaterial({ map: markingTexture(maxAniso), color: 0xd6d6d0, roughness: 0.8, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const lines = new THREE.Mesh(new THREE.PlaneGeometry(P.length + 2 * MARGIN, P.width + 2 * MARGIN), lineMat);
  lines.rotation.x = -Math.PI / 2; lines.position.y = 0.004; lines.receiveShadow = true;
  group.add(lines);
  // Rain: the grass goes glossy and darker so the floodlights streak on it.
  const setWet = on => { turf.roughness = on ? 0.5 : 0.95; turf.color.setScalar(on ? 0.82 : 1); lineMat.roughness = on ? 0.35 : 0.7; };
  return { group, setWet };
}
