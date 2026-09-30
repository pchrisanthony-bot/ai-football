// Small math helpers on plain {x, y, z} / {x, z} objects so the sim stays
// dependency-free, serialisable (replays) and runnable headless in Node.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
export const angleDiff = (a, b) => wrapAngle(b - a);
export const rand = (a, b) => a + Math.random() * (b - a);
export const sign = v => (v < 0 ? -1 : 1);

export function rotateTowards(cur, target, maxStep) {
  const d = wrapAngle(target - cur);
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
}

// Frame-rate independent exponential approach.
export const damp = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const len2 = (x, z) => Math.hypot(x, z);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Distance from point P to segment AB in the x-z plane, plus the projection parameter t.
export function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return { d: Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t };
}

// Critically-damped spring (used for inertialized pose blending and camera).
export function spring(state, target, omega, dt) {
  // state = { x, v }
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo, hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const detX = f * state.x + dt * state.v + hhoo * target;
  const detV = state.v + hoo * (target - state.x);
  state.x = detX * detInv;
  state.v = detV * detInv;
  return state.x;
}

// Seeded RNG so headless tests are reproducible.
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
