// =====================================================================
// The court: what the game plays in, dressed as the neighbourhood's own ground.
//   surface   painted concrete (the cage's 'court' physics: unchanged), worn and patched
//   walls     the 1 m kickboards are a painted brick knee wall — murals, posters and ads
//             on the inside, a concrete coping on top
//   fence     chain-link from the wall to 4.5 m on steel posts: mostly galvanised, some
//             panels replaced in green-coated mesh, a patched hole, a dented panel; the
//             near side (under the camera) see-through. It still ripples when hit.
//   roof      a sagging net at 6 m on taller corner posts
//   goals     welded steel frames, chipped paint and rust, nets with a darned patch
// Every size comes from PITCH: the game's walls, goals and roof are exactly where they were.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PITCH } from '../../sim/pitch.js';
import { chainLink, netTexture } from '../textures.js';
import { addRipple } from '../venue.js';
import { court as courtTex } from './surfaces.js';
import { weatherize } from './materials.js';
import { mat, range, pick } from './util.js';

const ART = ['mural_pattern', 'wall_ad', 'mural_kids', 'wall_clean', 'mural_crest'];
const POSTERS = ['poster_cup', 'poster_tuition', 'poster_garba', 'poster_gym', 'poster_dance', 'poster_wishes', 'poster_torn', 'poster_blood'];

export function buildCourt(group, K, venue, maxAniso) {
  const { halfL, halfW, wallH, boardH, goalHalfW, goalH, goalD, roofH } = PITCH;
  const r = K.r;

  // ---------------------------------------------------------------- surface
  const T = courtTex();
  T.map.anisotropy = maxAniso;
  const courtMat = weatherize(new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.normal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.84, metalness: 0 }), 'ground');
  const court = new THREE.Mesh(new THREE.PlaneGeometry(halfL * 2, halfW * 2), courtMat);
  court.rotation.x = -Math.PI / 2; court.receiveShadow = true; court.name = 'street:court';
  group.add(court);
  for (const s of [-1, 1]) K.B.add('concrete', new THREE.BoxGeometry(goalD, 0.02, goalHalfW * 2), mat(s * (halfL + goalD / 2), 0.012, 0), '#5e5c56');

  // ---------------------------------------------------------------- knee wall (the boards)
  const t = 0.22, paintHi = '#e9e2cf', paintLo = '#3d6b55';
  const seg = (F, u0, len) => {
    F.wall(u0, 0, len, boardH, t, paintHi, 'plaster');
    F.box(u0, 0, 0, len, 0.32, 0.012, 'plaster', paintLo);                       // the painted base band
    F.box(u0 - 0.01, boardH, -t, len + 0.02, 0.06, t + 0.02, 'concrete', '#b9b2a2');   // coping
    // art on the inside face: a mural / painted ad per few metres, posters between
    for (let u = u0 + 0.3; u < u0 + len - 1.2; ) {
      if (r() < 0.55) {
        // a painting at its own proportions, as tall as the wall allows
        const name = pick(ART, r), A = K.A.uv[name];
        let w = range(2.4, 4.2, r), h = w * A.h / A.w;
        if (h > boardH - 0.12) { h = boardH - 0.12; w = h * A.w / A.h; }
        if (u + w > u0 + len - 0.3) { u += 0.5; continue; }
        F.decal(name, u, (boardH - h) / 2 + 0.02, w, h, { n: 0.012 });
        u += w + range(0.3, 1.0, r);
      } else {
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) F.decal(pick(POSTERS, r), u + k * 0.55, 0.12, 0.55, 0.78, { n: 0.014 + k * 0.002 });
        u += n * 0.55 + range(0.4, 1.2, r);
      }
    }
  };
  seg(K.frame(-halfL - t, -halfW, 0), 0, halfL * 2 + t * 2);                          // far side
  for (const s of [-1, 1]) {
    // ends: the goal mouth is open; a frame per end, u runs along the inside face
    const F = s < 0 ? K.frame(-halfL, halfW, Math.PI / 2) : K.frame(halfL, -halfW, -Math.PI / 2);
    seg(F, 0, halfW - goalHalfW);
    seg(F, halfW + goalHalfW, halfW - goalHalfW);
  }
  // the near wall (between the camera and the play): see-through
  {
    const g = new THREE.BoxGeometry(halfL * 2 + t * 2, boardH, t); g.translate(0, boardH / 2, halfW + t / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#d9cfb6', roughness: 0.9, transparent: true, opacity: 0.16, depthWrite: false }));
    m.name = 'street:nearwall'; group.add(m);
  }

  // ---------------------------------------------------------------- fence
  const chain = chainLink(); chain.anisotropy = maxAniso;
  const fenceBase = { color: 0xffffff, vertexColors: true, metalness: 0.65, roughness: 0.42, alphaMap: chain, side: THREE.DoubleSide, transparent: true, depthWrite: false };
  const fenceMat = new THREE.MeshStandardMaterial({ ...fenceBase, opacity: 1 });
  addRipple(fenceMat, venue.fence.U, { freq: 8, speed: 22, falloff: 1.4, decay: 3.2 });
  const nearMat = new THREE.MeshStandardMaterial({ ...fenceBase, opacity: 0.26 });
  addRipple(nearMat, venue.fence.U, { freq: 8, speed: 22, falloff: 1.4, decay: 3.2 });
  const panels = [], nearPanels = [], posts = [];
  const GALV = new THREE.Color('#b9c1cb'), GREEN = new THREE.Color('#3f7a54'), NEW = new THREE.Color('#dfe5ea');
  // a run of panels from (x0, z0) to (x1, z1), y from ya to yb
  const run = (x0, z0, x1, z1, ya, yb, near, postEvery = 2.7) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / postEvery)), ang = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const pl = len / n, cx = x0 + (x1 - x0) * (i + 0.5) / n, cz = z0 + (z1 - z0) * (i + 0.5) / n, h = yb - ya;
      const kind = near ? 0 : r();
      const cell = kind > 0.93 ? 0.07 : 0.11;                                                     // a patched hole: finer mesh
      const g = new THREE.PlaneGeometry(pl, h, Math.max(2, Math.round(pl * 3)), Math.max(2, Math.round(h * 3)));
      const uv = g.attributes.uv, pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      const tint = kind > 0.84 && kind <= 0.93 ? GREEN : kind > 0.93 ? NEW : GALV, dent = !near && r() < 0.12 ? range(0.08, 0.2, r) : 0;
      for (let k = 0; k < pos.count; k++) {
        uv.setXY(k, uv.getX(k) * pl / cell, uv.getY(k) * h / cell);
        const fx = pos.getX(k) / pl, fy = pos.getY(k) / h;
        if (dent) pos.setZ(k, -dent * Math.max(0, 1 - Math.hypot(fx * 2.2, (fy + 0.1) * 2.2)));   // a ball's worth of dent
        const v = 0.9 + 0.1 * Math.sin(k * 1.7);
        col[k * 3] = tint.r * v; col[k * 3 + 1] = tint.g * v; col[k * 3 + 2] = tint.b * v;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      g.applyMatrix4(mat(cx, ya + h / 2, cz, ang));
      (near ? nearPanels : panels).push(g);
      if (!near) posts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
    }
    if (!near) posts.push([x1, z1]);
  };
  run(-halfL, -halfW, halfL, -halfW, boardH, wallH, false);
  run(-halfL, halfW, halfL, halfW, boardH, wallH, true);
  for (const s of [-1, 1]) {
    const x = s * halfL;
    run(x, -halfW, x, -goalHalfW, boardH, wallH, false, 2.2); run(x, goalHalfW, x, halfW, boardH, wallH, false, 2.2);
    run(x, -goalHalfW, x, goalHalfW, goalH, wallH, false, 3);
  }
  const fence = new THREE.Mesh(mergeGeometries(panels), fenceMat); fence.name = 'street:fence'; group.add(fence);
  const nearF = new THREE.Mesh(mergeGeometries(nearPanels), nearMat); nearF.name = 'street:nearfence'; group.add(nearF);
  panels.concat(nearPanels).forEach(g => g.dispose());
  // posts (galvanised pipe; the corners taller for the roof net) and the top rail
  const seen = new Set();
  for (const [x, z] of posts) {
    const key = `${x.toFixed(2)},${z.toFixed(2)}`; if (seen.has(key)) continue; seen.add(key);
    const corner = Math.abs(Math.abs(x) - halfL) < 0.01 && Math.abs(Math.abs(z) - halfW) < 0.01;
    const h = corner ? roofH + 0.25 : wallH + 0.1;
    K.B.add('steel', new THREE.CylinderGeometry(0.045, 0.05, h, 8), mat(x + Math.sign(x) * 0.03, h / 2, z - 0.03), '#9aa3ab');
  }
  for (const [x0, z0, x1, z1] of [[-halfL, -halfW, halfL, -halfW], [-halfL, -halfW, -halfL, halfW], [halfL, -halfW, halfL, halfW]]) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    K.B.add('steel', new THREE.CylinderGeometry(0.03, 0.03, len, 6), mat((x0 + x1) / 2, wallH, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0), 0, Math.PI / 2), '#9aa3ab');
  }
  // the near corner posts carry the roof net too
  for (const s of [-1, 1]) K.B.add('steel', new THREE.CylinderGeometry(0.045, 0.05, roofH + 0.25, 8), mat(s * (halfL + 0.03), (roofH + 0.25) / 2, halfW + 0.03), '#9aa3ab');

  // banners zip-tied to the fence, and the club's things hung on it
  const banner = (name, x, y, z, w, ry) => {
    const R = K.A.uv[name], h = w * R.h / R.w, g = new THREE.PlaneGeometry(w, h, 8, 2);
    const uv = g.attributes.uv, pos = g.attributes.position, sway = new Float32Array(pos.count), ph = new Float32Array(pos.count).fill(r());
    for (let i = 0; i < uv.count; i++) { uv.setXY(i, R.u0 + (R.u1 - R.u0) * uv.getX(i), R.v0 + (R.v1 - R.v0) * uv.getY(i)); const fx = pos.getX(i) / w; sway[i] = 0.25 * (1 - 4 * fx * fx) * (0.5 - pos.getY(i) / h); pos.setY(i, pos.getY(i) - 0.12 * (1 - 4 * fx * fx)); }
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    K.B.add('cloth', g, mat(x, y, z, ry), 0xffffff);
  };
  banner('banner_cup', -3, wallH - 0.9, -halfW + 0.05, 6.2, 0);
  banner('banner_club', -halfL + 0.05, wallH - 1.1, 4.6, 3.6, Math.PI / 2);
  // a pair of old boots hung by the laces, a net bag of spare balls
  for (const k of [0, 1]) {
    const x = 11.5 + k * 0.18, y = wallH - 0.75 - k * 0.1;
    K.wire([{ x: 11.6, y: wallH, z: -halfW + 0.06 }, { x, y: y + 0.12, z: -halfW + 0.08 }], { sag: 0, r: 0.004, color: '#e8e8e8', sway: false });
    K.B.add('prop', new THREE.BoxGeometry(0.28, 0.1, 0.1), mat(x, y, -halfW + 0.1, 0.3, 0, 1.2), k ? '#1e1e1e' : '#e2e2e2');
  }
  for (let k = 0; k < 5; k++) K.B.add('prop', new THREE.SphereGeometry(0.11, 10, 8), mat(-halfL + 0.25, boardH + 0.5 + Math.floor(k / 2) * 0.2, -halfW + 0.5 + (k % 2) * 0.2), k % 2 ? '#f2f2f2' : '#f2c335');

  // ---------------------------------------------------------------- roof net (sagging)
  {
    // (its own copy of the net texture: the repeat is per texture, and the goal nets use the
    // shared one at 1:1 — set here, it shrank their mesh to nothing)
    const rn = netTexture().clone(); rn.needsUpdate = true; rn.repeat.set(halfL * 2 / 0.12, halfW * 2 / 0.12); rn.anisotropy = maxAniso;
    const g = new THREE.PlaneGeometry(halfL * 2, halfW * 2, 32, 18), pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / halfL, y = pos.getY(i) / halfW; pos.setZ(i, 0.75 * (1 - x * x) * (1 - y * y)); }    // (+z: down, once laid flat)
    g.computeVertexNormals();
    // (unlit and dark: a net against a bright sky reads dark, not as a white grid)
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: rn, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.rotation.x = Math.PI / 2; m.position.y = roofH; m.name = 'street:roofnet';
    group.add(m);
    // edge cables (not the near one: it would cross the gameplay camera's view of the court)
    for (const [a, b] of [[[-halfL, -halfW], [halfL, -halfW]], [[-halfL, -halfW], [-halfL, halfW]], [[halfL, -halfW], [halfL, halfW]]])
      K.wire([{ x: a[0], y: roofH, z: a[1] }, { x: b[0], y: roofH, z: b[1] }], { sag: 0.25, r: 0.01, color: '#2b2b2b', sway: false });
  }

  // ---------------------------------------------------------------- goals
  const nets = [];
  for (const s of [-1, 1]) {
    const x = s * halfL;
    const bar = (len, w, cx, cy, cz, ax) => K.B.add('steel', new THREE.BoxGeometry(ax === 'x' ? len : w, ax === 'y' ? len : w, ax === 'z' ? len : w), mat(cx, cy, cz), '#ecebe6');
    for (const z of [-goalHalfW, goalHalfW]) {
      bar(goalH, 0.08, x, goalH / 2, z, 'y');
      bar(goalH, 0.045, x + s * goalD, goalH / 2, z, 'y');
      bar(goalD, 0.045, x + s * goalD / 2, goalH, z, 'x');
      bar(goalD, 0.045, x + s * goalD / 2, 0.025, z, 'x');
    }
    bar(goalHalfW * 2 + 0.08, 0.08, x, goalH, 0, 'z');
    bar(goalHalfW * 2, 0.045, x + s * goalD, goalH, 0, 'z');
    bar(goalHalfW * 2, 0.045, x + s * goalD, 0.025, 0, 'z');
    // nets: back, sides, roof — a darned patch in the back one
    const panel = (w, h, m4, patch) => {
      const g = new THREE.PlaneGeometry(w, h, Math.round(w * 8), Math.round(h * 8)), uv = g.attributes.uv, pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * w / 0.12, uv.getY(i) * h / 0.12);
        const inPatch = patch && Math.hypot(pos.getX(i) / w - 0.2, pos.getY(i) / h + 0.15) < 0.16;
        const v = inPatch ? [0.55, 0.6, 0.7] : [0.92, 0.92, 0.9];
        col.set(v, i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.applyMatrix4(m4); nets.push(g);
    };
    panel(goalHalfW * 2, goalH, mat(x + s * goalD, goalH / 2, 0, Math.PI / 2), s < 0);
    for (const z of [-goalHalfW, goalHalfW]) panel(goalD, goalH, mat(x + s * goalD / 2, goalH / 2, z), false);
    panel(goalD, goalHalfW * 2, mat(x + s * goalD / 2, goalH, 0, 0, Math.PI / 2), false);
  }
  const netTex = netTexture().clone(); netTex.needsUpdate = true; netTex.repeat.set(1, 1);       // (its own: other venues set the shared one's repeat)
  const netMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, alphaMap: netTex, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.85 });
  netMat.alphaMap.anisotropy = maxAniso;
  addRipple(netMat, venue.nets.U, { freq: 5, speed: 10, falloff: 2.2, decay: 2.4, bulge: 0.9 });
  const netMesh = new THREE.Mesh(mergeGeometries(nets), netMat); netMesh.name = 'street:nets';
  nets.forEach(g => g.dispose());
  group.add(netMesh);
  venue.goals = [netMesh];
  return { court, courtMat };
}
