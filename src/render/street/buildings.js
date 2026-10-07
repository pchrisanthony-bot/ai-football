// =====================================================================
// Buildings from the kit, in the neighbourhood's styles:
//   chawl   long G+3 tenement with open galleries (corridors) on every floor, railings,
//           curtained doorways, laundry on the rails — the court's main grandstand
//   flat    G+n block: grill-cage and open balconies, chajja sunshades, AC units, pipes
//   favela  floors stacked unevenly in different bright paints, an unfinished brick
//           floor, rebar sticking out of the roof, an external stair
//   old     old two/three-storey house: timber balcony, louvres, a clay-tile pitched roof
//   shed    a corrugated-sheet kiosk / lean-to
// Ground floors take shops (shutter, sign, awning, goods, the shopkeeper) or doors.
// Roofs take parapets, black water tanks, tarps, dishes, laundry, a rooftop room.
// Options: { w, depth, floors, gh, fh, style, paint, accent, shops: [kind|null per bay],
//           left / right: true if that side is seen, lod: 0 near … 2 far }
// =====================================================================
import * as THREE from 'three';
import { pick, range, mat } from './util.js';
import { PAINTS } from './kit.js';

const WINDOWS = ['win_grill_g', 'win_grill_b', 'win_grill_w', 'win_grill_r', 'win_slide_pink', 'win_slide_yellow', 'win_slide_blue', 'win_slide_maroon', 'win_open', 'win_louver_teal', 'win_louver_brown'];
const CURTAINS = ['door_curtain_red', 'door_curtain_green', 'door_curtain_purple'];
const POSTERS = ['poster_cup', 'poster_tuition', 'poster_garba', 'poster_gym', 'poster_dance', 'poster_wishes', 'poster_torn', 'poster_blood'];

export function building(K, F, o) {
  const r = K.r, lod = o.lod || 0;
  const w = o.w, depth = o.depth ?? 9, gh = o.gh ?? 3.3, fh = o.fh ?? 3.0, floors = o.floors ?? 3;
  const H = gh + floors * fh;
  const paint = o.paint || pick(PAINTS, r), accent = o.accent || pick(['#2f6b4f', '#2c5f8a', '#7a3b2e', '#3b3f45', '#5b4a8a'], r);
  if (o.style === 'chawl') return chawl(K, F, o, { w, depth, gh, fh, floors, H, paint, accent, lod });
  if (o.style === 'favela') return favela(K, F, o, { w, depth, gh, fh, floors, H, paint, lod });
  if (o.style === 'shed') return shed(K, F, o, { w, depth, paint });
  if (o.style === 'hall') return hall(K, F, o, { w, depth, H, paint, lod });

  // ---- the block
  F.wall(0, 0, w, H, depth, paint);
  F.box(0, 0, 0, w, 0.9, 0.035, 'plaster', o.dado || '#7d6e62');                       // dado band (damp-proof paint)
  for (let i = 1; i <= floors; i++) F.box(-0.02, gh + (i - 1) * fh - 0.07, 0, w + 0.04, 0.13, 0.07, 'concrete', '#c0baac');
  // ---- upper floors
  const bays = Math.max(1, Math.round(w / 2.9)), bw = w / bays;
  for (let i = 1; i <= floors; i++) {
    const y = gh + (i - 1) * fh;
    for (let b = 0; b < bays; b++) {
      const u = b * bw, kind = r();
      if (o.style === 'old' && i === 1) continue;            // the timber balcony runs the width (below)
      if (kind < 0.28 && lod < 2) balcony(K, F, u, y, bw, fh, r, lod);
      else window_(K, F, u + (bw - 1.15) / 2, y + 0.85, 1.15, 1.3, r, lod, kind > 0.82);
    }
    if (lod < 1 && r() < 0.6) F.pipe(bays > 1 ? bw * (1 + Math.floor(r() * (bays - 1))) : w - 0.25, 0.1, H + 0.6, 0.08, 0.05, pick(['#6d7073', '#2a2b2d', '#9a9c9e'], r));
  }
  if (o.style === 'old') timberBalcony(K, F, w, gh, fh, r);
  // ---- ground floor
  groundFloor(K, F, o, w, gh, bays, bw, r, lod, depth);
  // ---- the sides we can see
  for (const side of ['left', 'right']) if (o[side]) sideWall(K, F, side, w, depth, H, gh, fh, floors, paint, r, lod, o);
  // ---- roof
  if (o.style === 'old') tileRoof(K, F, w, depth, H);
  else roof(K, F, w, depth, H, paint, r, lod, o);
  return { H };
}

// A window with its chajja (sunshade), maybe an AC unit or a hanging cloth.
function window_(K, F, u, y, w, h, r, lod, ac = false) {
  F.decal(pick(WINDOWS, r), u, y, w, h, { lit: r() < 0.55 ? 1 : 0 });
  if (lod < 2) F.chajja(u, y + h + 0.18, w);
  if (ac && lod < 1) F.ac(u + w + 0.55, y + 0.15);
  if (lod < 1 && r() < 0.18) K.cloth(F, u + 0.15, y - 0.55, 0.06, 0.5, 0.6);       // a towel drying on the grill
  if (lod < 1 && r() < 0.22) F.spot(u + w / 2, y - 0.25, -0.2, 'window', { h: 0.6 });
}

// A balcony: a slab, a grill cage or a railing, a doorway behind, laundry, plants.
function balcony(K, F, u, y, bw, fh, r, lod) {
  const d = 0.95, w = bw - 0.3, u0 = u + 0.15;
  F.slab(u0, y + 0.02, w, d, 0.14);
  F.decal(pick(CURTAINS, r), u0 + w / 2 - 0.45, y, 0.9, 2.1, { lit: r() < 0.6 ? 1 : 0 });
  if (r() < 0.55) {
    // grill cage (very Mumbai): the front and the sides closed with ornamental grill
    F.decal('grill', u0, y, w, 2.3, { n: d, tint: '#cfcfcf' });
    F.box(u0, y, d - 0.04, 0.05, 2.3, 0.05, 'steel', '#2b2f33'); F.box(u0 + w - 0.05, y, d - 0.04, 0.05, 2.3, 0.05, 'steel', '#2b2f33');
    F.box(u0, y + 2.3, 0, w, 0.06, d, 'steel', '#2b2f33');
  } else {
    F.rail(u0, y, d - 0.04, w, 1.0, 0.12, pick(['#2b2f33', '#2c5f8a', '#2f6b4f', '#7a3b2e'], r));
    F.spot(u0 + w * range(0.3, 0.7, r), y, d - 0.35, 'rail');
  }
  if (lod < 1) F.laundry(u0 + 0.1, u0 + w - 0.1, y + 1.95, d * 0.55);
  if (lod < 1 && r() < 0.5) for (let k = 0; k < 3; k++) F.box(u0 + 0.2 + k * 0.32, y, d - 0.3, 0.22, 0.24, 0.22, 'prop', pick(['#b5532e', '#8a5a3a', '#3f6e3f'], r));
}

// The ground floor: shops (by bay) or a doorway, posters, the plinth steps.
function groundFloor(K, F, o, w, gh, bays, bw, r, lod, depth) {
  for (let b = 0; b < bays; b++) {
    const u = b * bw, kind = o.shops ? o.shops[b % o.shops.length] : null;
    if (kind && kind !== 'closed' && kind !== 'door') shopfront(K, F, u, bw, gh, kind, r, lod);
    else if (kind === 'closed') { F.decal(r() < 0.5 ? 'shutter_closed' : 'shutter_ad', u + 0.15, 0.06, bw - 0.3, Math.min(2.6, gh - 0.4)); }
    else {
      F.decal(pick(['door_metal_blue', 'door_metal_green', ...CURTAINS], r), u + bw / 2 - 0.5, 0.18, 1.0, 2.15, { lit: r() < 0.5 ? 1 : 0 });
      F.box(u + bw / 2 - 0.65, 0, 0, 1.3, 0.18, 0.45, 'concrete', '#a8a294');           // the step
      F.spot(u + bw / 2 - 0.35, 0.18, 0.28, 'step');
      window_(K, F, u + bw / 2 + 0.6, 1.0, 0.9, 1.1, r, lod);
    }
    // posters pasted on the pier between bays
    if (lod < 1 && r() < 0.7) for (let k = 0; k < 1 + Math.floor(r() * 3); k++) F.decal(pick(POSTERS, r), u + range(-0.3, 0.05, r) + (b ? 0 : 0.1), range(0.95, 1.8, r), 0.6, 0.85, { n: 0.02 + k * 0.003 });
  }
}

function shopfront(K, F, u, bw, gh, kind, r, lod) {
  const w = Math.min(2.8, bw - 0.25), u0 = u + (bw - w) / 2;
  F.decal('shop_' + kind, u0, 0.05, w, 2.25, { lit: 1, n: 0.01 });
  F.decal('shutter_top', u0, 2.3, w, 0.42, { n: 0.03 });
  // the sign: a board on the wall above the shutter
  F.box(u0 - 0.05, 2.78, 0, w + 0.1, 0.62, 0.07, 'prop', '#3a3a3a');
  F.decal('sign_' + (kind === 'kirana' || kind === 'vadapav' || kind === 'tea' || kind === 'mobile' || kind === 'sports' || kind === 'barber' ? kind : 'tea'), u0, 2.79, w, 0.6, { n: 0.075, lit: 1 });
  // the awning: a sloped sheet (tin or striped cloth) over the front
  const tin = r() < 0.5;
  const g = new THREE.BoxGeometry(w + 0.3, 0.03, 1.15);
  K.B.add(tin ? 'metal' : 'cloth', g, F.m(u0 + w / 2, 2.55, 0.56, 0, 1, 1, 1, 0.32), tin ? pick(['#4d82c9', '#5e9e6e', '#9aa0a3', '#c56c4d'], r) : '#ffffff', tin ? null : { aSway: 0, aPhase: 0 });
  if (!tin) { const R = K.A.uv[pick(['stripes_rw', 'stripes_by', 'stripes_gw'], r)]; const uv = K.B.parts.get('cloth').at(-1).attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, R.u0 + (R.u1 - R.u0) * (i % 2), R.v0 + (R.v1 - R.v0) * ((i >> 1) % 2)); }
  // the goods hanging along the front edge (snack strips, bags, balls in a net)
  if (lod < 1) for (let k = 0; k < 7; k++) K.cloth(F, u0 + 0.15 + k * (w - 0.3) / 6 - 0.07, 1.65 + r() * 0.2, 1.05, 0.14, 0.55 + r() * 0.3, 'print');
  // a counter / goods outside, the shopkeeper inside
  if (kind === 'tea' || kind === 'vadapav') {
    F.box(u0 + 0.2, 0, 0.42, w - 0.4, 0.95, 0.55, 'prop', '#8d9599');                    // the counter, the stall-keeper behind it
    K.B.add('steel', new THREE.CylinderGeometry(0.17, 0.2, 0.3, 12), F.m(u0 + 0.6, 1.1, 0.72), '#b8bec2');
  } else if (kind === 'kirana') {
    for (let k = 0; k < 4; k++) K.crate(F.w(u0 + 0.4 + k * 0.5, 0, 0.45).x, (k % 2) * 0.28, F.w(u0 + 0.4 + k * 0.5, 0, 0.45).z, F.ry, pick(['#d94848', '#3f74c8', '#f2c335', '#2e9a6a'], r));
    F.box(u0 + w - 0.9, 0, 0.1, 0.7, 1.6, 0.6, 'prop', '#c62828');                       // a cold-drinks fridge (no brand)
  } else if (kind === 'sports') {
    for (let k = 0; k < 6; k++) K.B.add('prop', new THREE.SphereGeometry(0.11, 10, 8), F.m(u0 + 0.4 + (k % 3) * 0.24, 1.9 - Math.floor(k / 3) * 0.24, 1.0), k % 2 ? '#f2f2f2' : '#f2c335');
  }
  const counter = kind === 'tea' || kind === 'vadapav';
  F.spot(u0 + w * 0.6, 0, counter ? 0.17 : kind === 'kirana' ? 0.12 : 0.45, 'counter', { counter });
}

// The side wall we can see: a few windows/vents, pipes, a wall painting now and then.
function sideWall(K, F, side, w, depth, H, gh, fh, floors, paint, r, lod, o) {
  const right = side === 'right';
  const o0 = F.w(right ? w : 0, 0, right ? 0 : -depth);
  const S = K.frame(o0.x, o0.z, F.ry + (right ? Math.PI / 2 : -Math.PI / 2));
  for (let i = 1; i <= floors; i++) {
    const y = gh + (i - 1) * fh;
    if (r() < 0.7) S.decal(r() < 0.3 ? 'vent' : pick(WINDOWS, r), depth * range(0.25, 0.65, r), y + 0.9, r() < 0.3 ? 0.6 : 1.0, r() < 0.3 ? 0.45 : 1.2, { lit: r() < 0.4 ? 1 : 0 });
  }
  if (o[side + 'Art']) S.decal(o[side + 'Art'], 0.6, o[side + 'ArtY'] ?? 1.2, Math.min(depth - 1.2, o[side + 'ArtW'] ?? 4.5), (Math.min(depth - 1.2, o[side + 'ArtW'] ?? 4.5)) * (K.A.uv[o[side + 'Art']].h / K.A.uv[o[side + 'Art']].w));
  if (lod < 1) S.pipe(depth * 0.85, 0.1, H + 0.5, 0.08, 0.05, '#2a2b2d');
  if (lod < 1 && r() < 0.6) S.decal('meters', depth * 0.12, 1.4, 1.1, 0.8);
}

// The roof: parapet, slab, water tanks on stands, a tarp, a dish, laundry, a rooftop room.
function roof(K, F, w, depth, H, paint, r, lod, o) {
  F.box(0, H, -depth, w, 0.06, depth, 'concrete', '#8e897e');
  F.wall(0, H, w, 0.9, 0.18, paint);                                            // front parapet
  F.box(0, H, -depth, 0.18, 0.9, depth, 'plaster', paint); F.box(w - 0.18, H, -depth, 0.18, 0.9, depth, 'plaster', paint);
  if (lod < 2) {
    const nT = 1 + Math.floor(r() * (w > 8 ? 3 : 2));
    for (let k = 0; k < nT; k++) { const p = F.w(range(1, w - 1, r), H + 0.06, -range(depth * 0.45, depth - 1, r)); K.tank(p.x, p.y, p.z, range(0.85, 1.25, r)); }
  }
  if (lod < 1 && r() < 0.5) { const p = F.w(range(0.8, w - 0.8, r), H + 0.9, -0.6); K.B.add('prop', new THREE.CylinderGeometry(0.32, 0.32, 0.04, 14), mat(p.x, p.y + 0.45, p.z, F.ry, -0.9), '#d9d9d4'); K.B.add('steel', new THREE.BoxGeometry(0.03, 0.6, 0.03), mat(p.x, p.y + 0.15, p.z), '#555'); }
  if (lod < 1 && r() < 0.55) {                                                    // a blue tarp over a frame
    const u0 = range(0.5, Math.max(0.6, w - 4), r), tw = Math.min(3.5, w - u0 - 0.3), p = F.w(u0 + tw / 2, H + 2.1, -depth * 0.4);
    const g = new THREE.PlaneGeometry(tw, 2.6, 6, 4), pos = g.attributes.position, sway = new Float32Array(pos.count), ph = new Float32Array(pos.count).fill(r());
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / tw, y = pos.getY(i) / 2.6; pos.setZ(i, -0.25 * (1 - 4 * x * x) * (1 - 4 * y * y)); sway[i] = 0.25 * (1 - 4 * x * x) * (1 - 4 * y * y); }
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    K.B.add('cloth', g, mat(p.x, p.y, p.z, F.ry, -Math.PI / 2 + 0.12), pick(['#2f6fd6', '#2f6fd6', '#d6862f', '#3d9a54'], r));
    for (const du of [0.05, tw - 0.05]) for (const dn of [-depth * 0.4 + 1.2, -depth * 0.4 - 1.2]) F.box(u0 + du, H, dn, 0.06, 2.1, 0.06, 'steel', '#555');
  }
  if (lod < 1 && r() < 0.6) { F.box(0.4, H + 0.06, -depth + 0.5, 0.05, 1.7, 0.05, 'steel', '#444'); F.box(w - 0.45, H + 0.06, -depth + 0.5, 0.05, 1.7, 0.05, 'steel', '#444'); const L = K.frame(F.w(0, 0, -depth + 0.52).x, F.w(0, 0, -depth + 0.52).z, F.ry); L.laundry(0.45, w - 0.45, H + 1.75, 0); }
  if (lod < 2 && r() < 0.35) {                                                     // a rooftop room in tin sheet
    const u0 = range(0.3, Math.max(0.4, w - 3.2), r), rw = Math.min(3, w - u0 - 0.3);
    F.box(u0, H, -depth + 0.3, rw, 2.3, 2.6, 'metal', pick(['#9aa0a3', '#4d82c9', '#a5603e'], r));
    F.box(u0 - 0.1, H + 2.3, -depth + 0.2, rw + 0.2, 0.05, 2.8, 'metal', '#8a8f92');
  }
  if (r() < (o.rebar ?? 0.3)) for (let k = 0; k < 4; k++) {                       // columns waiting for the next floor
    const p = F.w(k < 2 ? 0.25 : w - 0.25, H, k % 2 ? -0.25 : -depth + 0.25);
    K.B.add('concrete', new THREE.BoxGeometry(0.3, 0.6, 0.3), mat(p.x, p.y + 0.3, p.z), '#9b968b');
    for (let j = 0; j < 4; j++) K.B.add('steel', new THREE.CylinderGeometry(0.01, 0.01, 1.1, 4), mat(p.x + (j % 2 - 0.5) * 0.18, p.y + 1.1, p.z + (j > 1 ? 0.09 : -0.09), 0, (r() - 0.5) * 0.25), '#5a3a26');
  }
  if (lod < 2 && r() < 0.45) F.spot(range(1, w - 1, r), H, -0.5, 'roof');
}

// Old house: a timber balcony across the first floor, a clay-tile pitched roof.
function timberBalcony(K, F, w, gh, fh, r) {
  const y = gh;
  F.box(0.1, y - 0.12, 0, w - 0.2, 0.12, 1.1, 'prop', '#6d4c33');
  F.box(0.1, y + 1.0, 1.02, w - 0.2, 0.08, 0.08, 'prop', '#5a3c26');
  for (let u = 0.15; u < w - 0.1; u += 0.22) F.box(u, y, 1.03, 0.06, 1.0, 0.06, 'prop', '#6d4c33');
  for (let u = 0.1; u < w; u += 2.4) F.box(u, y, 1.0, 0.12, fh - 0.1, 0.12, 'prop', '#5a3c26');
  for (let b = 0; b < Math.round(w / 2.4); b++) F.decal(r() < 0.5 ? 'win_louver_brown' : pick(CURTAINS, r), b * 2.4 + 0.75, y, 1.0, 2.0, { lit: r() < 0.5 ? 1 : 0 });
  F.spot(w * 0.4, y, 0.6, 'rail'); F.laundry(0.3, w - 0.3, y + 1.9, 0.75);
}
function tileRoof(K, F, w, depth, H) {
  const rise = 2.2, half = depth / 2 + 0.6, len = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  for (const s of [1, -1]) {
    const g = new THREE.BoxGeometry(w + 0.6, 0.06, len);
    K.B.add('metal', g, F.m(w / 2, H + rise / 2, -depth / 2 + s * half / 2, 0, 1, 1, 1, s * ang), '#a5512f');
  }
  F.wall(0, H, w, 0.2, depth, '#b9a98e');
}

// Favela-style stack: each floor its own box, set in or out, in its own paint.
function favela(K, F, o, { w, depth, gh, fh, floors, H, lod }) {
  const r = K.r;
  let y = 0;
  for (let i = 0; i <= floors; i++) {
    const h = i === 0 ? gh : fh, n1 = i === 0 ? 0 : range(-0.35, 0.45, r);
    const a = i === 0 ? 0 : range(0, 0.9, r), b = i === 0 ? w : w - range(0, 0.9, r);
    const bare = i > 1 && r() < 0.18;                    // an unfinished floor: bare brick
    const paint = i === 0 ? (o.paint || pick(PAINTS, r)) : pick(PAINTS, r);
    F.wall(a, y, b - a, h, depth, bare ? '#ffffff' : paint, bare ? 'brick' : 'plaster', n1);
    // windows on this floor's face
    const n = Math.max(1, Math.floor((b - a) / 1.75));
    const L = K.frame(F.w(0, 0, n1).x, F.w(0, 0, n1).z, F.ry);       // this floor's own face
    for (let k = 0; k < n; k++) {
      const u = a + (k + 0.5) * (b - a) / n;
      if (i === 0) continue;
      if (r() < 0.3 && lod < 2 && k < n - 1) { balcony(K, L, u - 0.7, y, 2.4, fh, r, lod); k++; }
      else window_(K, L, u - 0.55, y + 0.85, 1.1, 1.25, r, lod, r() < 0.2);
    }
    if (i > 0 && lod < 1 && r() < 0.5) L.pipe(range(a + 0.3, b - 0.3, r), y, y + fh, 0.08, 0.045, pick(['#6d7073', '#2a2b2d', '#9a9c9e'], r));
    if (i > 0) F.box(a - 0.02, y - 0.06, n1, b - a + 0.04, 0.12, 0.08, 'concrete', '#bdb7aa');
    y += h;
  }
  groundFloor(K, F, o, w, gh, Math.max(1, Math.round(w / 2.9)), w / Math.max(1, Math.round(w / 2.9)), r, lod, depth);
  for (const side of ['left', 'right']) if (o[side]) sideWall(K, F, side, w, depth, H, gh, fh, floors, o.paint || '#e0c08a', r, lod, o);
  if (o.stair) exteriorStair(K, F, o.stair === 'left' ? 0 : w, depth, gh, fh, floors, o.stair === 'left' ? -1 : 1, r);
  roof(K, F, w, depth, H, o.paint || pick(PAINTS, r), r, lod, { rebar: 0.65 });
  return { H };
}

// An external steel/concrete stair zig-zagging up the side of a building.
function exteriorStair(K, F, u, depth, gh, fh, floors, s, r) {
  const o0 = F.w(u, 0, s > 0 ? 0 : -depth);
  const S = K.frame(o0.x, o0.z, F.ry + s * Math.PI / 2);
  // S: u runs into the depth of the building along its side wall, n out from that side
  let y = 0, dir = 1;
  for (let i = 0; i < floors; i++) {
    const rise = i === 0 ? gh : fh, steps = Math.round(rise / 0.18), run = steps * 0.26;
    const u0 = dir > 0 ? 0.6 : 0.6 + run;
    for (let k = 0; k < steps; k++) S.box(dir > 0 ? u0 + k * 0.26 : u0 - (k + 1) * 0.26, y + k * (rise / steps), 0.05, 0.27, 0.06, 1.0, 'concrete', '#a9a397');
    S.rail(Math.min(u0, u0 + dir * run), y + rise / 2, 1.0, run, 1.0, 0.3, '#2b2f33');
    S.box(dir > 0 ? u0 + run : u0 - run - 1.1, y + rise - 0.06, 0.05, 1.1, 0.06, 1.05, 'concrete', '#a9a397');   // landing
    if (r() < 0.5) S.spot(u0 + dir * run * 0.5, y + rise * 0.5, 0.55, 'stair');
    y += rise; dir = -dir;
  }
}

// A shed / kiosk: corrugated walls, a sloping tin roof, an opening at the front.
function shed(K, F, o, { w, depth, paint }) {
  const r = K.r, h = o.h ?? 2.7;
  F.box(0, 0, -depth, w, h, 0.05, 'metal', paint);                          // back
  F.box(0, 0, -depth, 0.05, h, depth, 'metal', paint); F.box(w - 0.05, 0, -depth, 0.05, h, depth, 'metal', paint);
  const g = new THREE.BoxGeometry(w + 0.5, 0.04, depth + 0.9);
  K.B.add('metal', g, F.m(w / 2, h + 0.18, -depth / 2 + 0.3, 0, 1, 1, 1, 0.12), o.roof || '#9aa0a3');
  for (const u of [0.05, w - 0.1]) F.box(u, 0, 0.35, 0.06, h + 0.15, 0.06, 'prop', '#5a3c26');
  if (o.shop) {
    F.decal('shop_' + o.shop, 0.15, 0.05, w - 0.3, Math.min(2.25, h - 0.3), { lit: 1, n: -depth + 0.07 });
    F.box(0.1, h - 0.15, 0.25, w - 0.2, 0.55, 0.06, 'prop', '#3a3a3a');
    F.decal('sign_' + o.shop, 0.1, h - 0.14, w - 0.2, 0.53, { n: 0.315, lit: 1 });
    F.box(0.25, 0, -0.3, w - 0.5, 0.95, 0.55, 'prop', '#8d9599');
    F.spot(w * 0.5, 0, -0.62, 'counter', { counter: true });
  }
  return { H: h };
}

// The chawl: rooms behind open galleries on every floor — pillars, railings, curtained
// doorways and windows on the inner wall, laundry on lines and over the rails, the
// residents at the railings. Its plate on a pillar: चाळ क्र. ३ (chawl no. 3).
function chawl(K, F, o, { w, depth, gh, fh, floors, H, paint, accent, lod }) {
  const r = K.r, gd = 1.8;
  F.wall(0, 0, w, H, depth, paint, 'plaster', -gd);                              // the rooms
  F.wall(0, 0, w, gh, gd, paint);                                                 // ground-floor rooms out to the front
  F.box(0, 0, 0, w, 0.9, 0.035, 'plaster', o.dado || '#6e5e52');
  groundFloor(K, F, o, w, gh, Math.max(1, Math.round(w / 2.9)), w / Math.max(1, Math.round(w / 2.9)), r, lod, depth);
  const pil = Math.max(2, Math.round(w / 3.2)), pw = w / pil;
  for (let i = 1; i <= floors; i++) {
    const y = gh + (i - 1) * fh;
    F.box(0, y - 0.16, -gd, w, 0.16, gd + 0.12, 'concrete', '#c7c0b1');                // the gallery floor
    for (let k = 0; k <= pil; k++) F.box(Math.min(w - 0.26, k * pw), y, -0.3, 0.26, fh - 0.16, 0.26, 'plaster', o.pillar || '#e9e2cf');
    F.rail(0, y, -0.06, w, 1.0, 0.12, accent);
    // the inner wall: doorways (curtains) and windows, alternating
    for (let u = 0.45; u < w - 1; u += range(1.5, 1.9, r)) {
      if (r() < 0.55) F.decal(pick(CURTAINS, r), u, y, 0.9, 2.1, { n: -gd + 0.015, lit: r() < 0.7 ? 1 : 0 });
      else F.decal(pick(WINDOWS, r), u, y + 0.9, 1.0, 1.15, { n: -gd + 0.015, lit: r() < 0.6 ? 1 : 0 });
    }
    // tube lights on the gallery ceiling (lit at night)
    for (let k = 0; k < pil; k += 2) { const p = F.w(k * pw + pw / 2, y + fh - 0.2, -gd + 0.25); K.lampHead(p, 0.6, 0.06, F.ry); if (i === floors || k % 4 === 0) K.lights.push({ ...p, color: 0xdfeaff, kind: 'tube' }); }
    if (lod < 1) {
      for (let k = 0; k < 3; k++) { const a = range(0.3, w - 3.5, r); F.laundry(a, a + range(1.8, 3.2, r), y + 2.15, -gd * 0.55); }
      for (let k = 0; k < Math.round(w / 2.5); k++) K.cloth(F, range(0.2, w - 0.8, r), y + 0.45, 0.02, range(0.4, 0.7, r), range(0.5, 0.75, r));   // over the rail
    }
    for (let k = 0; k < Math.round(w / 2.2); k++) F.spot(range(0.4, w - 0.4, r), y, -0.42, 'rail');
  }
  F.box(-0.1, H - 0.16, -gd, w + 0.2, 0.16, gd + 0.22, 'concrete', '#bdb6a6');          // eaves
  F.decal('plate_chawl', pw * Math.floor(pil / 2) - 0.03, gh + 1.6, 0.6, 0.35, { n: -0.035 });
  F.decal('scoreboard', 0.6, 1.0, 1.6, 1.0, { n: 0.05 });
  for (const side of ['left', 'right']) if (o[side]) sideWall(K, F, side, w, depth, H, gh, fh, floors, paint, r, lod, o);
  roof(K, F, w, depth, H, paint, r, lod, o);
  return { H };
}

// A community hall / gym: a blank wall the neighbourhood has painted (the mural), a door,
// high vents, its name over the door.
function hall(K, F, o, { w, depth, H, paint, lod }) {
  const r = K.r;
  F.wall(0, 0, w, H, depth, paint);
  F.box(0, 0, 0, w, 0.9, 0.035, 'plaster', o.dado || '#6e5e52');
  const A = K.A.uv[o.art], aw = Math.min(w - 0.5, o.artW || w - 0.5), ah = aw * A.h / A.w;
  F.decal(o.art, (w - aw) / 2, o.artY ?? 1.2, aw, ah, { n: 0.02 });
  F.decal('door_metal_green', w - 1.4, 0, 1.0, 2.1, { n: 0.022 });
  F.decal('plate_nivas', w - 1.55, 2.3, 1.3, 0.48, { n: 0.022 });
  for (let u = 0.6; u < w - 0.8; u += 1.6) F.decal('vent', u, H - 1.4, 0.6, 0.45, { n: 0.02 });
  for (const side of ['left', 'right']) if (o[side]) sideWall(K, F, side, w, depth, H, o.gh ?? 3.3, o.fh ?? 3.0, o.floors ?? 2, paint, r, lod, o);
  roof(K, F, w, depth, H, paint, r, lod, o);
  return { H };
}
