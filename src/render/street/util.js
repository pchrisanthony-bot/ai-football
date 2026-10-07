// =====================================================================
// Street kit utilities: seeded randomness, tileable noise painted in JS, normal maps
// from height, and the Batch that merges every piece of the neighbourhood into one mesh
// per material (draw calls are what a phone's CPU pays for).
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const rng = seed => { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
export const pick = (a, r) => a[Math.min(a.length - 1, Math.floor(r() * a.length))];
export const range = (a, b, r) => a + (b - a) * r();
export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export function texOf(c, { srgb = true, repeat = false, aniso = 8, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = mip;
  return t;
}

// Tileable value noise: n(x, y, period) in cells; fbm sums octaves (each period doubled).
export function noise2(seed) {
  const r = rng(seed), P = 256, grid = new Float32Array(P * P);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const n = (x, y, per) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per, y0 = ((yi % per) + per) % per, y1 = (y0 + 1) % per;
    const a = grid[y0 * P + x0], b = grid[y0 * P + x1], c = grid[y1 * P + x0], d = grid[y1 * P + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  n.fbm = (u, v, base = 4, oct = 5, gain = 0.5) => {       // u, v in 0..1 (tileable)
    let s = 0, amp = 0.5, per = base, norm = 0;
    for (let o = 0; o < oct; o++) { s += amp * n(u * per, v * per, per); norm += amp; amp *= gain; per *= 2; }
    return s / norm;
  };
  return n;
}

// A height field (Float32Array w×h, 0..1) → tangent-space normal map canvas (wraps at edges).
export function normalFromHeight(h, w, hh, strength = 2) {
  const c = canvas(w, hh), g = c.getContext('2d'), img = g.createImageData(w, hh), d = img.data;
  const at = (x, y) => h[((y + hh) % hh) * w + ((x + w) % w)];
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- geometry
const _c = new THREE.Color();
// Give a geometry the attribute set every batch shares: position, normal, uv, color (+ the
// batch's extras, defaulted). tint: a colour (sRGB hex/string or THREE.Color).
export function prep(geo, tint = 0xffffff, extras = null) {
  const n = geo.attributes.position.count;
  if (geo.index === null) { const ix = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) ix[i] = i; geo.setIndex(new THREE.BufferAttribute(ix, 1)); }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k) && !(extras && k in extras)) geo.deleteAttribute(k);
  if (!geo.attributes.color) {
    _c.set(tint);                        // (hex → linear working space: that's what vertex colours are)
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  if (extras) for (const [k, [size, def]] of Object.entries(extras)) {
    if (geo.attributes[k]) continue;
    const a = new Float32Array(n * size);
    if (typeof def === 'function') { for (let i = 0; i < n; i++) { const v = def(i, geo); if (size === 1) a[i] = v; else a.set(v, i * size); } }
    else if (def) a.fill(def);
    geo.setAttribute(k, new THREE.BufferAttribute(a, size));
  }
  return geo;
}

// World-space box projection: uv from the world position along the face's dominant axis
// (metres / scale), so tiling textures line up across every wall in the city.
export function worldUV(geo, scale = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) uv.setXY(i, x / scale, z / scale);
    else if (ax >= az) uv.setXY(i, z / scale, y / scale);
    else uv.setXY(i, x / scale, y / scale);
  }
  uv.needsUpdate = true;
  return geo;
}

// Pieces collected per material key and merged at the end (one mesh per material).
export class Batch {
  constructor() { this.parts = new Map(); this.opts = new Map(); }
  // opts per key: { extras: { name: [size, default] }, worldUV: scale }
  define(key, opts = {}) { this.opts.set(key, opts); return this; }
  add(key, geo, matrix = null, tint = 0xffffff, attrs = null) {
    const o = this.opts.get(key) || {};
    if (matrix) geo.applyMatrix4(matrix);
    geo = prep(geo, tint, o.extras);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      const a = geo.attributes[k];
      if (a) for (let i = 0; i < a.count; i++) { if (a.itemSize === 1) a.array[i] = typeof v === 'function' ? v(i, geo) : v; else a.array.set(typeof v === 'function' ? v(i, geo) : v, i * a.itemSize); }
    }
    if (o.worldUV) worldUV(geo, o.worldUV);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
    return geo;
  }
  count(key) { return (this.parts.get(key) || []).length; }
  // → { key: mesh }
  build(parent, materials, { cast = () => true, receive = () => true } = {}) {
    const out = {};
    for (const [key, list] of this.parts) {
      if (!list.length || !materials[key]) continue;
      const g = mergeGeometries(list, false);
      list.forEach(x => x.dispose());
      if (!g) { console.warn('street batch: could not merge', key); continue; }
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materials[key]);
      m.castShadow = cast(key); m.receiveShadow = receive(key);
      m.name = 'street:' + key;
      parent.add(m);
      out[key] = m;
    }
    this.parts.clear();
    return out;
  }
}

// Handy matrices
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
export function mat(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
