// =====================================================================
// SITARA GULLY — the first street court (fictional, Mumbai-inspired).
// The court sits in the middle of the neighbourhood: buildings close on three sides (the
// far side and both ends), the near side — under the gameplay camera — stays low (a lane
// and kiosks) so nothing blocks the view. One alley runs off the far side, between the
// tea-stall house and the stacked block.
//
//            far lane / drain  ·  A: favela · CHAWL · flats · tea house │alley│ stacked
//   B (left end)  ┌──────── court 32 × 18 ────────┐  C (right end)
//                 └───────────────────────────────┘
//            near lane · kiosks · scooters · poles (the camera is up here)
//
// Coordinates: x along the court (±16), z across (far side −9, near +9), y up.
// Every placement is deterministic (seeded): the same neighbourhood every match.
// =====================================================================
import * as THREE from 'three';
import { PITCH } from '../../sim/pitch.js';
import { building } from './buildings.js';
import { PAINT } from './kit.js';
import { mat, range, pick } from './util.js';

export const FAR = -13.4;            // the far row's facades
export const SIDE = 19.6;            // the end rows' facades (|x|)

export function buildLayout(K) {
  const { halfL, halfW } = PITCH, r = K.r;
  const out = { floods: [], poles: {} };

  // ---------------------------------------------------------------- far row (A), facing the court
  const A = (x0, x1, o) => building(K, K.frame(x0, FAR, 0), { w: x1 - x0, ...o });
  A(-34, -24, { style: 'favela', floors: 4, depth: 9, paint: PAINT.yellow, shops: ['closed', 'door'], right: false, stair: 'right' });
  A(-24, -6.5, { style: 'chawl', floors: 3, depth: 11, paint: PAINT.cream, accent: '#2c6a75', pillar: '#e4dcc4', shops: ['door', 'kirana', 'door', 'closed', 'door', 'mobile'], rebar: 0 });
  A(-6.5, 2.4, { style: 'flat', floors: 4, depth: 10, paint: PAINT.turquoise, shops: ['barber', 'door', 'closed'] });
  A(2.4, 6.0, { style: 'old', floors: 2, depth: 9, paint: PAINT.ochre, shops: ['tea'], right: true, rightArt: 'mural_crest', rightArtW: 2.4, rightArtY: 3.6 });
  A(9.0, 19.6, { style: 'favela', floors: 5, depth: 10, paint: PAINT.pink, shops: ['vadapav', 'sports', 'door'], left: true });

  // the alley between the tea house and the stacked block, running back from the far lane
  for (let k = 0; k < 4; k++) {
    const z1 = FAR - 10 - k * 8.5;
    // left side of the alley (facing +x) and right side (facing −x)
    building(K, K.frame(6.0, z1, Math.PI / 2), { w: 8.5, depth: 6, style: k % 2 ? 'favela' : 'flat', floors: 2 + (k % 3), paint: pick(Object.values(PAINT), r), shops: [k === 0 ? 'kirana' : 'door'], lod: k > 1 ? 1 : 0 });
    building(K, K.frame(9.0, z1 - 8.5, -Math.PI / 2), { w: 8.5, depth: 6, style: k % 2 ? 'flat' : 'favela', floors: 3 + (k % 2), paint: pick(Object.values(PAINT), r), shops: ['door'], lod: k > 1 ? 1 : 0 });
  }

  // ---------------------------------------------------------------- end rows (B left, C right)
  const B = (z0, z1, o) => building(K, K.frame(-SIDE, z0, Math.PI / 2), { w: z0 - z1, ...o });      // u runs toward −z
  B(10.5, 3.5, { style: 'old', floors: 2, depth: 9, paint: PAINT.sky, shops: ['door', 'closed'], left: true });
  B(3.5, -4.5, { style: 'favela', floors: 3, depth: 9, paint: PAINT.salmon, shops: ['door', 'door'], stair: 'left' });
  B(-4.5, FAR, { style: 'flat', floors: 4, depth: 9, paint: PAINT.mint, shops: ['closed', 'door', 'door'] });
  const C = (z0, z1, o) => building(K, K.frame(SIDE, z0, -Math.PI / 2), { w: z1 - z0, ...o });       // u runs toward +z
  C(FAR, -4.4, { style: 'favela', floors: 4, depth: 9, paint: PAINT.blue, shops: ['door', 'closed', 'door'] });
  C(-4.4, 2.6, { style: 'hall', floors: 2, depth: 9, paint: PAINT.lavender, art: 'mural_player', artW: 6.4, artY: 1.25 });     // the community hall, painted
  C(2.6, 10.5, { style: 'old', floors: 2, depth: 9, paint: PAINT.terracotta, shops: ['door', 'closed'], right: true });

  // ---------------------------------------------------------------- behind: the second row (vertical density)
  const back = (x0, z, w, floors, style, ry = 0) => building(K, K.frame(x0, z, ry), { w, depth: 9, style, floors, paint: pick(Object.values(PAINT), r), shops: ['door'], lod: 2 });
  for (const [x0, w, f, st] of [[-36, 9, 6, 'favela'], [-27, 8, 7, 'flat'], [-19, 10, 5, 'favela'], [-9, 9, 6, 'flat'], [0, 6, 7, 'favela'], [10, 9, 6, 'flat'], [19, 10, 5, 'favela'], [29, 9, 7, 'flat']])
    back(x0, FAR - 12 - (x0 % 3 + 3) * 0.6, w, f, st);
  for (const s of [-1, 1]) for (const [z0, w, f] of [[12, 9, 5], [3, 9, 6], [-6, 9, 5], [-15, 9, 6]])
    building(K, K.frame(s * (SIDE + 10.5), s < 0 ? z0 : z0 - w, s < 0 ? Math.PI / 2 : -Math.PI / 2), { w, depth: 8, style: pick(['favela', 'flat'], r), floors: f, paint: pick(Object.values(PAINT), r), shops: ['door'], lod: 2 });

  // ---------------------------------------------------------------- the near side (under the camera): low
  // (single storey only: the gameplay camera looks over these — nothing may rise into its frame)
  const near = (x0, x1, o) => building(K, K.frame(x1, 15.4, Math.PI), { w: x1 - x0, ...o });           // facing the court (−z)
  near(-19, -14.2, { style: 'shed', depth: 3, paint: '#4d82c9', shop: 'kirana', h: 2.8 });
  near(-14.2, -5, { style: 'flat', floors: 0, depth: 6, paint: PAINT.peach, shops: ['door', 'closed', 'door'], lod: 1 });
  near(-5, 4, { style: 'flat', floors: 0, depth: 6, paint: PAINT.cream, shops: ['closed', 'mobile', 'door'], lod: 1 });
  near(4, 12, { style: 'flat', floors: 0, depth: 6, paint: PAINT.lime, shops: ['door', 'vadapav'], lod: 1 });
  near(12, 19.6, { style: 'shed', depth: 3.2, paint: '#a5603e', shop: 'tea', h: 2.8 });

  // ---------------------------------------------------------------- ground: lanes, drains, curbs
  const lane = (x0, x1, z0, z1) => K.B.add('paver', new THREE.BoxGeometry(x1 - x0, 0.04, z1 - z0), mat((x0 + x1) / 2, 0.02, (z0 + z1) / 2), '#ffffff');
  lane(-36, 36, FAR, FAR + 1.9); lane(6.0, 9.0, FAR - 44, FAR); lane(-36, 36, 12.0, 15.2);
  lane(-SIDE, -SIDE + 1.6, FAR, 12); lane(SIDE - 1.6, SIDE, FAR, 12);
  // the drain along the far lane: a dark channel with a grate
  K.B.add('prop', new THREE.BoxGeometry(70, 0.03, 0.34), mat(0, 0.035, FAR + 2.05), '#191a1a');
  for (let x = -34; x < 34; x += 0.35) K.B.add('steel', new THREE.BoxGeometry(0.05, 0.02, 0.36), mat(x, 0.055, FAR + 2.05), '#3a3633');
  for (const z of [FAR + 2.25, 11.9]) K.B.add('concrete', new THREE.BoxGeometry(70, 0.14, 0.18), mat(0, 0.07, z), '#a8a294');

  // ---------------------------------------------------------------- poles, wires, lamps, floodlights
  const P = {
    nl: K.pole(-halfL - 1.7, halfW + 2.4, 9.6, { lamp: true, lampYaw: -0.6 }),
    nr: K.pole(halfL + 1.7, halfW + 2.4, 9.6, { lamp: true, lampYaw: Math.PI + 0.6, transformer: true }),
    fl: K.pole(-halfL - 1.6, -halfW - 2.2, 9.6),
    fm: K.pole(-1.0, -halfW - 2.3, 9.2, { lamp: true, lampYaw: Math.PI / 2 }),
    fr: K.pole(halfL + 1.6, -halfW - 2.2, 9.6),
    al: K.pole(7.5, FAR - 14, 8.6, { lamp: true, lampYaw: Math.PI / 2 }),
  };
  out.poles = P;
  const bun = (a, b, n, sag) => K.bundle(a, b, n, { sag });
  // (none across the court or along its near side: from the gameplay camera they'd cut
  // through the play)
  bun(P.fl, P.fm, 5, 0.5); bun(P.fm, P.fr, 5, 0.5);
  bun(P.nl, P.fl, 2, 0.4); bun(P.nr, P.fr, 2, 0.4);
  bun(P.fm, P.al, 3, 0.6);
  // service drops from the poles to every facade on the far lane, and across the alley
  for (const x of [-30, -22, -16, -11, -7, -3, 1, 4, 11, 15, 18]) K.wire([x < -1 ? (x < -16 ? P.fl : P.fm) : (x > 12 ? P.fr : P.fm), { x, y: range(4.2, 7.5, r), z: FAR + 0.02 }], { sag: 0.6 });
  for (let k = 0; k < 9; k++) { const z = FAR - range(2, 40, r), y = range(4, 8.5, r); K.wire([{ x: 6.0, y, z }, { x: 9.0, y: y + range(-0.5, 0.5, r), z: z + range(-1.5, 1.5, r) }], { sag: 0.9 }); }
  for (const x of [-SIDE, SIDE]) for (const z of [-8, -2, 4, 9]) K.wire([x < 0 ? P.nl : P.nr, { x, y: range(4, 7, r), z }], { sag: 0.5 });
  // kites caught in the wires
  for (const [x, y, z] of [[-8.2, 8.75, -halfW - 2.25], [-halfL - 1.66, 9.05, 3.2], [7.2, 6.9, FAR - 9]]) { const R = K.A.uv.kite, g = new THREE.PlaneGeometry(0.42, 0.42); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, R.u0 + (R.u1 - R.u0) * uv.getX(i), R.v0 + (R.v1 - R.v0) * uv.getY(i)); K.B.add('cloth', g, mat(x, y, z, r() * 3, 0, 0.7), '#ffffff', { aSway: 0.4, aPhase: r() }); }

  // community floodlights: two heads on each corner pole, aimed in
  for (const [p, aimX, aimZ] of [[P.nl, -4, 2], [P.nr, 4, 2], [P.fl, -4, -2], [P.fr, 4, -2]]) {
    const yaw = Math.atan2(aimX - p.x, aimZ - p.z);
    for (const k of [-0.35, 0.35]) {
      const hx = p.x + Math.cos(yaw) * k * 0.6, hz = p.z - Math.sin(yaw) * k * 0.6, hy = p.y - 0.9;
      K.B.add('prop', new THREE.BoxGeometry(0.55, 0.42, 0.22), mat(hx, hy, hz, yaw, -0.6), '#2c2e31');
      K.lampHead({ x: hx + Math.sin(yaw) * 0.12, y: hy - 0.08, z: hz + Math.cos(yaw) * 0.12 }, 0.46, 0.34, yaw);
    }
    out.floods.push({ x: p.x, y: p.y - 0.95, z: p.z, aim: new THREE.Vector3(aimX, 0, aimZ) });
  }

  // ---------------------------------------------------------------- street things
  // scooters and bikes along the lanes
  for (const [x, z, yaw] of [[3.2, FAR + 0.9, 0.1], [4.6, FAR + 0.9, -0.08], [10.6, FAR + 0.8, 0.05], [-9.4, 13.2, Math.PI + 0.1], [-7.9, 13.25, Math.PI - 0.06], [8.6, 13.3, Math.PI], [7.5, FAR - 6, Math.PI / 2 + 0.05]])
    K.scooter(x, z, yaw, pick(['#c62828', '#1f4fa8', '#e8e8e0', '#2e2e2e', '#2e7d32', '#e0a020'], r));
  K.bicycle(-14.6, FAR + 0.7, 0.05); K.bicycle(15.4, 13.4, Math.PI);
  // the tea stall's chairs and benches, crates, drums, buckets
  for (const [x, z, yaw, c] of [[1.6, FAR + 0.75, 0.4, '#e9e9e6'], [2.4, FAR + 0.8, -0.2, '#c62828'], [5.2, FAR + 0.78, 0.1, '#e9e9e6'], [-17.3, 7.2, Math.PI / 2, '#1f4fa8'], [-17.4, 6.1, Math.PI / 2 + 0.2, '#e9e9e6'], [17.4, -6.3, -Math.PI / 2, '#2e7d32'], [17.3, 5.6, -Math.PI / 2, '#e9e9e6'], [-11.5, 10.6, Math.PI, '#c62828'], [6.2, 10.7, Math.PI + 0.3, '#e9e9e6']])
    K.chair(x, z, yaw, c);
  K.B.add('prop', new THREE.BoxGeometry(3.0, 0.08, 0.36), mat(-17.4, 0.45, -3.0, Math.PI / 2), '#7b5a3a');        // the subs' bench
  for (const [x, z] of [[-17.3, -1.7], [-17.3, -4.3]]) K.B.add('prop', new THREE.BoxGeometry(0.08, 0.45, 0.3), mat(x, 0.22, z), '#5a3c26');
  for (let k = 0; k < 5; k++) K.crate(-4.6 + (k % 3) * 0.45, Math.floor(k / 3) * 0.28, FAR + 0.6, 0.05 * k, pick(['#d94848', '#3f74c8', '#f2c335'], r));
  K.drum(-21.6, FAR + 0.6); K.drum(-20.9, FAR + 0.55, '#2e8b57'); K.bucket(-20.3, FAR + 0.5, '#e46aa6'); K.bucket(12.6, FAR + 0.45, '#3f74c8');
  K.tyre(17.8, 0, FAR + 0.9); K.tyre(17.8, 0.2, FAR + 0.9);
  // cones and a cooler by the near corner, a handcart in the alley mouth
  for (const [x, z] of [[-15.2, 10.3], [-14.9, 10.4], [-15.0, 10.1]]) K.B.add('prop', new THREE.ConeGeometry(0.12, 0.3, 8), mat(x, 0.15, z), '#ff7a1a');
  K.B.add('prop', new THREE.BoxGeometry(0.5, 0.38, 0.34), mat(-13.8, 0.19, 10.5, 0.3), '#2b6fbf');
  K.B.add('prop', new THREE.BoxGeometry(1.5, 0.07, 0.8), mat(7.5, 0.62, FAR - 2.5, 0.2), '#7b5a3a');
  for (const dz of [-0.35, 0.35]) K.B.add('prop', new THREE.TorusGeometry(0.28, 0.05, 6, 12), mat(7.5 - 0.3, 0.3, FAR - 2.5 + dz), '#3b2a1c');

  // street dogs asleep in the shade; crows on the fence's top rail, pigeons on the parapets
  K.dog(4.9, FAR + 0.45, 0.3, '#b07a45'); K.dog(-19.0, -0.6, 1.9, '#4a3a2c'); K.dog(6.5, FAR - 1.6, -0.9, '#d9c6a5'); K.dog(-11.2, FAR + 0.5, 2.8, '#8c5a32');
  for (const [x, n] of [[-12.6, 3], [-3.9, 2], [6.1, 4], [13.2, 2]]) for (let k = 0; k < n; k++) K.bird(x + k * range(0.25, 0.6, r), PITCH.wallH + 0.03, -halfW, range(-0.6, 0.6, r) + (r() < 0.5 ? Math.PI : 0), r() < 0.75);

  // people who stand round the fence: along the far side and the corners (spots for the crowd)
  for (let x = -14.5; x <= 14.5; x += range(1.1, 2.4, r)) K.spots.push({ x, y: 0, z: -halfW - 0.62 - r() * 0.4, face: 0, kind: 'fence' });
  for (const s of [-1, 1]) for (const z of [-7.5, -5.8, 5.2, 7.1]) K.spots.push({ x: s * (halfL + 0.85 + r() * 0.5), y: 0, z, face: -s * Math.PI / 2, kind: 'fence' });
  for (const x of [-12, -6, 3, 9.5]) K.spots.push({ x, y: 0, z: halfW + 0.9 + r() * 0.6, face: Math.PI, kind: 'fence' });
  return out;
}
