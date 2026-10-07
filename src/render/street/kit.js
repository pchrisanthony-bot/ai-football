// =====================================================================
// The street kit: modular pieces a neighbourhood is assembled from — Wall, Balcony,
// Gallery (chawl), Window (+ chajja sunshade), Door, Shopfront (+ sign, awning, goods),
// Rooftop (parapet, water tanks, tarp, dish, rebar), Pipe, AC unit, Stair, Laundry,
// UtilityPole, Cable, StreetLamp, Scooter, Chair, Crate… Every piece goes into the Batch
// (one mesh per material at the end). Buildings record spots where people can watch
// (railings, windows, rooftops, steps, shop counters) for the crowd.
//
// A facade frame F works in local coordinates: u along the facade (left → right as you
// look at it), y up, n out of the wall (n < 0 is inside the building).
// =====================================================================
import * as THREE from 'three';
import { pick, range, mat } from './util.js';

export const PAINT = {
  turquoise: '#5fb5ab', sky: '#86b5d9', yellow: '#e8c35e', cream: '#ece0c0', pink: '#e8a3b4', salmon: '#e8906a',
  mint: '#a9d6b8', lavender: '#b8a8d8', offwhite: '#e6e0d2', terracotta: '#c56c4d', ochre: '#d2a149', lime: '#b9d16d',
  blue: '#4d82c9', green: '#5e9e6e', peach: '#f0b68c', grey: '#a6a49d', rose: '#d97a8a', white: '#efece4',
};
export const PAINTS = Object.values(PAINT);
const STEEL = '#3b4045', DARK = '#26282b';

export class Kit {
  // B: Batch; A: atlas (uv rects); r: rng
  constructor(B, A, r) {
    this.B = B; this.A = A; this.r = r;
    this.spots = [];          // { x, y, z, face (yaw toward what he watches), kind: 'rail'|'window'|'roof'|'step'|'counter'|'stand'|'chair', h }
    this.lights = [];         // night lights: { x, y, z, color, kind }
    this.lamps = [];          // lamp heads (for night glow sprites)
  }

  // ---------------------------------------------------------------- frames
  frame(ox, oz, ry, y0 = 0) {
    const kit = this, c = Math.cos(ry), s = Math.sin(ry);
    const F = {
      ox, oz, ry, y0,
      // local → world
      w(u, y, n) { return { x: ox + u * c + n * s, y: y0 + y, z: oz - u * s + n * c }; },
      m(u, y, n, rot = 0, sx = 1, sy = 1, sz = 1, rx = 0) { const p = F.w(u, y, n); return mat(p.x, p.y, p.z, ry + rot, rx, 0, sx, sy, sz); },
      yawOut: ry,            // world yaw of the facade normal (for people facing out of it)
      // a solid block behind the facade plane: u0..u0+w, y0..y0+h, n from -d to n1
      wall(u0, yb, w, h, d, tint, key = 'plaster', n1 = 0) {
        const g = new THREE.BoxGeometry(w, h, d + n1);
        kit.B.add(key, g, F.m(u0 + w / 2, yb + h / 2, n1 - (d + n1) / 2), tint);
      },
      box(u0, yb, n0, w, h, d, key, tint, rot = 0) {
        const g = new THREE.BoxGeometry(w, h, d);
        kit.B.add(key, g, F.m(u0 + w / 2, yb + h / 2, n0 + d / 2, rot), tint);
      },
      // a decal from the atlas, facing out: bottom-left at (u, y)
      decal(name, u, y, w, h, { n = 0.015, tint = 0xffffff, lit = 0, flip = false } = {}) {
        const R = kit.A.uv[name]; if (!R) return;
        const g = new THREE.PlaneGeometry(w, h);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) { const a = flip ? 1 - uv.getX(i) : uv.getX(i); uv.setXY(i, R.u0 + (R.u1 - R.u0) * a, R.v0 + (R.v1 - R.v0) * uv.getY(i)); }
        kit.B.add('decal', g, F.m(u + w / 2, y + h / 2, n), tint, { aLit: lit });
      },
      // a slab sticking out of the wall (balcony floor, gallery, sunshade)
      slab(u0, y, w, d, t = 0.14, tint = '#bdb7aa', key = 'concrete') { F.box(u0, y - t, 0, w, t, d, key, tint); },
      chajja(u, y, w) {
        // the thin concrete sunshade over a window, tipped down at the front
        const g = new THREE.BoxGeometry(w + 0.3, 0.07, 0.55);
        kit.B.add('concrete', g, F.m(u + w / 2, y, 0.27, 0, 1, 1, 1, 0.1), '#b4ae9f');
      },
      // vertical bars + top rail along u at depth n (a railing) — y is the floor it stands on
      rail(u0, y, n, w, h = 1.0, gap = 0.13, tint = STEEL) {
        const top = new THREE.BoxGeometry(w, 0.05, 0.06);
        kit.B.add('steel', top, F.m(u0 + w / 2, y + h, n), tint);
        const mid = new THREE.BoxGeometry(w, 0.03, 0.03);
        kit.B.add('steel', mid, F.m(u0 + w / 2, y + 0.12, n), tint);
        for (let x = u0 + gap / 2; x < u0 + w; x += gap) kit.B.add('steel', new THREE.BoxGeometry(0.022, h, 0.022), F.m(x, y + h / 2, n), tint);
      },
      pipe(u, ya, yb, n = 0.08, r = 0.045, tint = '#7a7d80') {
        const g = new THREE.CylinderGeometry(r, r, yb - ya, 8);
        kit.B.add('steel', g, F.m(u, (ya + yb) / 2, n), tint);
      },
      ac(u, y) {
        F.box(u - 0.4, y, 0.04, 0.8, 0.52, 0.32, 'prop', '#d6d4cc');
        F.decal('ac_front', u - 0.4, y, 0.8, 0.52, { n: 0.365 });
        F.box(u - 0.42, y - 0.06, 0.04, 0.84, 0.04, 0.34, 'steel', '#555');
        kit.B.add('steel', new THREE.BoxGeometry(0.03, 0.03, 0.4), F.m(u - 0.3, y - 0.2, 0.2, 0, 1, 1, 1, -0.6), '#555');
        kit.B.add('steel', new THREE.BoxGeometry(0.03, 0.03, 0.4), F.m(u + 0.3, y - 0.2, 0.2, 0, 1, 1, 1, -0.6), '#555');
      },
      // laundry on a line between u0 and u1 at height y, n out
      laundry(u0, u1, y, n, k = null) {
        const P0 = F.w(u0, y, n), P1 = F.w(u1, y, n);
        kit.wire([P0, P1], { sag: 0.06, r: 0.006, color: '#d8d8d8' });
        const count = k ?? Math.max(1, Math.floor((u1 - u0) / 0.55));
        for (let i = 0; i < count; i++) {
          const u = u0 + (i + 0.5) * (u1 - u0) / count + range(-0.06, 0.06, kit.r);
          const w = range(0.35, 0.6, kit.r), h = range(0.45, 0.95, kit.r);
          kit.cloth(F, u - w / 2, y - h, n + range(-0.02, 0.02, kit.r), w, h);
        }
      },
      // a person-spot facing out of the facade
      spot(u, y, n, kind, extra = {}) { const p = F.w(u, y, n); kit.spots.push({ ...p, face: ry, kind, ...extra }); },
    };
    return F;
  }

  // A hanging garment / towel / saree from the cloth patterns, tinted, swaying at its hem.
  cloth(F, u, y, n, w, h, pattern = null) {
    const r = this.r;
    const name = 'cloth_' + (pattern || pick(['plain', 'plain', 'stripe', 'check', 'floral', 'border', 'print'], r));
    const R = this.A.uv[name];
    const g = new THREE.PlaneGeometry(w, h, 2, 3);
    const uv = g.attributes.uv, pos = g.attributes.position;
    const sway = new Float32Array(pos.count), ph = new Float32Array(pos.count), p0 = r();
    for (let i = 0; i < uv.count; i++) { uv.setXY(i, R.u0 + (R.u1 - R.u0) * uv.getX(i), R.v0 + (R.v1 - R.v0) * uv.getY(i)); sway[i] = (0.5 - pos.getY(i) / h); ph[i] = p0; }
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const tint = pick(['#ffffff', '#e8e8e8', '#d94848', '#3f74c8', '#f2c335', '#2e9a6a', '#e46aa6', '#7a4fb8', '#ff8a3d', '#35b5c9', '#202020', '#c9b28a'], r);
    this.B.add('cloth', g, F.m(u + w / 2, y + h / 2, n), tint);
  }

  // A cable from point to point (or along points): a catenary, a few metres of sag per span.
  wire(pts, { sag = 0.35, r = 0.012, color = '#151515', seg = 14, sway = true } = {}) {
    const P = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], span = Math.hypot(b.x - a.x, b.z - a.z);
      const s = sag * span / 10;
      for (let k = i ? 1 : 0; k <= seg; k++) { const t = k / seg; P.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - 4 * s * t * (1 - t), a.z + (b.z - a.z) * t)); }
    }
    const curve = new THREE.CatmullRomCurve3(P);
    const g = new THREE.TubeGeometry(curve, Math.max(8, P.length * 2), r, 4, false);
    const n = g.attributes.position.count, swayA = new Float32Array(n), ph = new Float32Array(n), p0 = this.r();
    // sway weight: 0 at the ends, 1 mid-span (approximate from the tube's u)
    const uv = g.attributes.uv;
    for (let i = 0; i < n; i++) { const t = uv.getX(i); swayA[i] = sway ? Math.sin(Math.PI * ((t * (pts.length - 1)) % 1)) : 0; ph[i] = p0; }
    g.setAttribute('aSway', new THREE.BufferAttribute(swayA, 1)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.B.add('wire', g, null, color);
  }

  // A bundle of cables (the Mumbai kind): n wires between two points, slightly spread, some looped.
  bundle(a, b, n = 4, { sag = 0.4, spread = 0.12 } = {}) {
    for (let i = 0; i < n; i++) {
      const o = () => (this.r() - 0.5) * spread;
      this.wire([{ x: a.x + o(), y: a.y + o(), z: a.z + o() }, { x: b.x + o(), y: b.y + o(), z: b.z + o() }], { sag: sag * range(0.8, 1.35, this.r), r: range(0.009, 0.016, this.r) });
    }
  }

  // ---------------------------------------------------------------- street furniture
  // A utility pole: a tapered concrete pole, cross-arms with insulators. → its head (for wires)
  pole(x, z, h = 9, { lamp = false, lampYaw = 0, transformer = false } = {}) {
    const B = this.B;
    const g = new THREE.CylinderGeometry(0.11, 0.17, h, 8);
    B.add('concrete', g, mat(x, h / 2, z), '#a7a399');
    for (const yy of [h - 0.4, h - 1.1]) {
      B.add('steel', new THREE.BoxGeometry(1.6, 0.08, 0.08), mat(x, yy, z, this.r() * 0.3), '#2f3134');
      for (const dx of [-0.7, -0.25, 0.25, 0.7]) B.add('prop', new THREE.CylinderGeometry(0.035, 0.035, 0.12, 6), mat(x + dx, yy + 0.09, z), '#d9d4c4');
    }
    // the meter-box clutter and a tangle of service wires near the top
    B.add('prop', new THREE.BoxGeometry(0.3, 0.42, 0.22), mat(x, h - 2.2, z + 0.18), '#8a9093');
    if (transformer) {
      B.add('steel', new THREE.BoxGeometry(1.6, 0.1, 1.0), mat(x, 4.2, z), '#3a3c3e');
      B.add('prop', new THREE.BoxGeometry(1.0, 1.1, 0.8), mat(x, 4.8, z), '#6f7a72');
      for (const dx of [-0.3, 0, 0.3]) B.add('prop', new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6), mat(x + dx, 5.55, z), '#7b5a3a');
    }
    if (lamp) this.streetLamp(x, z, h - 1.6, lampYaw);
    return { x, y: h - 0.4, z };
  }
  streetLamp(x, z, y, yaw) {
    const B = this.B, dx = Math.cos(yaw), dz = Math.sin(yaw);
    B.add('steel', new THREE.BoxGeometry(1.4, 0.06, 0.06), mat(x + dx * 0.7, y, z + dz * 0.7, -yaw), '#2f3134');
    B.add('prop', new THREE.BoxGeometry(0.5, 0.12, 0.24), mat(x + dx * 1.35, y - 0.06, z + dz * 1.35, -yaw), '#3a3c3e');
    const lp = { x: x + dx * 1.35, y: y - 0.14, z: z + dz * 1.35 };
    this.lampHead(lp, 0.42, 0.18, -yaw);
    this.lights.push({ ...lp, color: 0xffa646, kind: 'sodium' });
  }
  lampHead(p, w, d, yaw) {
    const R = this.A.uv.lamp, g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, R.u0 + (R.u1 - R.u0) * uv.getX(i), R.v0 + (R.v1 - R.v0) * uv.getY(i));
    this.B.add('decal', g, mat(p.x, p.y, p.z, yaw, Math.PI / 2), 0xffffff, { aLit: 1 });
    this.lamps.push(p);
  }

  scooter(x, z, yaw, tint) {
    const B = this.B, M = (dx, dy, dz) => { const c = Math.cos(yaw), s = Math.sin(yaw); return mat(x + dx * c + dz * s, dy, z - dx * s + dz * c, yaw); };
    for (const dx of [-0.62, 0.62]) { const w = new THREE.TorusGeometry(0.2, 0.07, 6, 14); B.add('prop', w, M(dx, 0.27, 0), '#151515'); }
    B.add('prop', new THREE.BoxGeometry(1.0, 0.18, 0.32), M(0, 0.42, 0), tint);                         // floorboard / body
    B.add('prop', new THREE.BoxGeometry(0.62, 0.32, 0.36), M(-0.32, 0.62, 0), tint);                    // rear body
    B.add('prop', new THREE.BoxGeometry(0.58, 0.09, 0.3), M(-0.3, 0.83, 0), '#1c1c1c');                 // seat
    B.add('prop', new THREE.BoxGeometry(0.16, 0.62, 0.3), M(0.5, 0.68, 0, ), tint);                       // front apron
    B.add('steel', new THREE.BoxGeometry(0.06, 0.06, 0.62), M(0.58, 1.05, 0), '#222');                  // handlebar
    B.add('prop', new THREE.BoxGeometry(0.1, 0.12, 0.18), M(0.63, 0.98, 0), '#e8e8e0');                 // headlamp
  }
  bicycle(x, z, yaw) {
    const B = this.B, M = (dx, dy, dz, rx = 0) => { const c = Math.cos(yaw), s = Math.sin(yaw); return mat(x + dx * c + dz * s, dy, z - dx * s + dz * c, yaw, 0, rx); };
    for (const dx of [-0.52, 0.52]) B.add('steel', new THREE.TorusGeometry(0.34, 0.02, 4, 18), M(dx, 0.34, 0), '#1a1a1a');
    B.add('steel', new THREE.BoxGeometry(1.0, 0.035, 0.035), M(0, 0.62, 0), '#1f3d7a');
    B.add('steel', new THREE.BoxGeometry(0.035, 0.42, 0.035), M(-0.2, 0.55, 0, -0.35), '#1f3d7a');
    B.add('prop', new THREE.BoxGeometry(0.22, 0.05, 0.1), M(-0.26, 0.82, 0), '#111');
  }
  // the monobloc plastic chair
  chair(x, z, yaw, tint = '#e9e9e6') {
    const B = this.B, M = (dx, dy, dz, rx = 0) => { const c = Math.cos(yaw), s = Math.sin(yaw); return mat(x + dx * c + dz * s, dy, z - dx * s + dz * c, yaw, rx); };
    B.add('prop', new THREE.BoxGeometry(0.44, 0.04, 0.42), M(0, 0.44, 0), tint);
    B.add('prop', new THREE.BoxGeometry(0.44, 0.42, 0.04), M(0, 0.68, -0.2, -0.16), tint);
    for (const [dx, dz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) B.add('prop', new THREE.BoxGeometry(0.04, 0.44, 0.04), M(dx, 0.22, dz), tint);
    this.spots.push({ x, y: 0.0, z, face: yaw, kind: 'chair' });
  }
  crate(x, y, z, yaw, tint) { this.B.add('prop', new THREE.BoxGeometry(0.42, 0.28, 0.32), mat(x, y + 0.14, z, yaw), tint); }
  drum(x, z, tint = '#2b5fbf') { this.B.add('prop', new THREE.CylinderGeometry(0.29, 0.29, 0.88, 12), mat(x, 0.44, z), tint); }
  bucket(x, z, tint) { this.B.add('prop', new THREE.CylinderGeometry(0.15, 0.12, 0.28, 10), mat(x, 0.14, z), tint); }
  tyre(x, y, z) { this.B.add('prop', new THREE.TorusGeometry(0.3, 0.1, 6, 14), mat(x, y + 0.1, z, 0, Math.PI / 2), '#141414'); }
  // A street dog asleep, curled up (the gully's own: tan, brown, cream, patched).
  dog(x, z, yaw, tint = '#b07a45') {
    const B = this.B, c = Math.cos(yaw), s = Math.sin(yaw);
    const M = (dx, dy, dz, ry = 0, sx = 1, sy = 1, sz = 1) => mat(x + dx * c + dz * s, dy, z - dx * s + dz * c, yaw + ry, 0, 0, sx, sy, sz);
    const ball = r => new THREE.SphereGeometry(r, 10, 7);
    B.add('prop', ball(0.5), M(0, 0.13, 0, 0, 0.62, 0.27, 0.34), tint);                          // the body, curled
    B.add('prop', ball(0.5), M(0.22, 0.11, 0.12, 0.6, 0.3, 0.22, 0.26), tint);                    // haunch
    B.add('prop', ball(0.1), M(-0.24, 0.09, 0.16, 0, 1.3, 0.95, 1), tint);                       // head on the paws
    B.add('prop', ball(0.05), M(-0.37, 0.07, 0.2), '#2a1f18');                                   // muzzle
    for (const dz of [0.1, 0.22]) B.add('prop', new THREE.ConeGeometry(0.035, 0.08, 5), M(-0.2, 0.18, dz, 0, 1, 1, 0.5), tint);
    B.add('prop', new THREE.CylinderGeometry(0.025, 0.018, 0.34, 5), mat(x + 0.1 * c + 0.2 * s, 0.05, z - 0.1 * s + 0.2 * c, yaw + 1.2, 0, Math.PI / 2), tint);   // tail round the paws
  }
  // A house crow (grey nape) or a pigeon, perched (fence rails, parapets).
  bird(x, y, z, yaw, crow = true) {
    const B = this.B, c = Math.cos(yaw), s = Math.sin(yaw), col = crow ? '#17171a' : '#6f747c';
    const M = (dx, dy, dz, sx = 1, sy = 1, sz = 1, rx = 0) => mat(x + dx * c + dz * s, y + dy, z - dx * s + dz * c, yaw, rx, 0, sx, sy, sz);
    B.add('prop', new THREE.SphereGeometry(0.5, 7, 5), M(0, 0.09, 0, 0.11, 0.12, 0.22), col);
    B.add('prop', new THREE.SphereGeometry(0.05, 6, 5), M(0, 0.19, 0.09), crow ? '#55585c' : '#5d6670');
    B.add('prop', new THREE.ConeGeometry(0.018, 0.07, 4), M(0, 0.19, 0.15, 1, 1, 1, Math.PI / 2), crow ? '#111' : '#c9a07a');
    B.add('prop', new THREE.BoxGeometry(0.07, 0.015, 0.14), M(0, 0.07, -0.15, 1, 1, 1, 0.5), col);
  }
  // a black plastic water tank on a stand (rooftops)
  tank(x, y, z, size = 1) {
    const B = this.B, r = 0.55 * size, h = 1.15 * size;
    B.add('prop', new THREE.CylinderGeometry(r, r * 0.96, h, 16, 4), mat(x, y + 0.35 + h / 2, z), '#151618');
    B.add('prop', new THREE.CylinderGeometry(r * 0.45, r * 0.5, 0.14, 12), mat(x, y + 0.35 + h + 0.07, z), '#1b1c1f');
    B.add('steel', new THREE.BoxGeometry(r * 2.2, 0.35, r * 2.2), mat(x, y + 0.17, z), '#4a4b4c');
  }
}
