// Kick solvers. Everything is solved against the real ball integrator
// (predictPath), so what the AI aims, what the preview shows and what the
// ball does are the same thing.
import { BALL, COURT } from '../config.js';
import { makeBall, predictPath } from './ball.js';
import { clamp } from '../util/math.js';

const c = BALL.rollDecel, l = BALL.rollLinear;
const F = v => v / l - (c / (l * l)) * Math.log(c + l * v);

// Distance a ball rolls from v0 until it slows to v1.
export const rollDistance = (v0, v1 = 0) => Math.max(0, F(v0) - F(v1));

// Ground pass speed that arrives at distance d with speed `arrive`.
export function groundPassSpeed(d, arrive = 4.5) {
  const target = F(arrive) + d;
  let lo = arrive, hi = 40;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (F(mid) < target) lo = mid; else hi = mid;
  }
  return hi;
}

// Time for a rolling ball to cover distance d starting at v0 (Infinity if it stops first).
export function rollTime(v0, d) {
  if (rollDistance(v0) < d) return Infinity;
  // integrate dt = dx / v numerically (coarse, fine for AI)
  let v = v0, x = 0, t = 0;
  const h = 1 / 60;
  while (x < d && v > 0.05) { v = Math.max(0, v - (c + l * v) * h); x += v * h; t += h; }
  return t;
}

function ballAt(x, y, z, vx, vy, vz, wx = 0, wy = 0, wz = 0) {
  const b = makeBall();
  Object.assign(b, { x, y, z, vx, vy, vz, wx, wy, wz });
  return b;
}

// Where (and when) a predicted path crosses the plane x = X.
export function crossPlaneX(pts, X, dt = 1 / 60) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a.x - X) * (b.x - X) <= 0 && a.x !== b.x) {
      const t = (X - a.x) / (b.x - a.x);
      return { y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, t: (i - 1 + t) * dt };
    }
  }
  return null;
}

// Lofted ball: first bounce lands on (tx, tz). elev = vertical fraction of the launch direction.
// Backspin of magnitude bs (rad/s) for a ball travelling along heading (hx, hz).
export const backspin = (hx, hz, bs) => ({ wx: -hz * bs, wz: hx * bs });

export function solveLob(bx, by, bz, tx, tz, elev = 0.55, bs = 0) {
  const dx = tx - bx, dz = tz - bz, d = Math.hypot(dx, dz) || 1;
  const hx = dx / d, hz = dz / d;
  const cosE = Math.sqrt(1 - elev * elev);
  const w = backspin(hx, hz, bs);
  let lo = 3, hi = 30, best = null;
  for (let i = 0; i < 16; i++) {
    const s = (lo + hi) / 2;
    const b = ballAt(bx, by, bz, hx * s * cosE, s * elev, hz * s * cosE, w.wx, 0, w.wz);
    const p = predictPath(b, 4, 1 / 60);
    const bounce = p.events.find(e => e.type === 'bounce' || e.type === 'wall' || e.type === 'roof');
    const land = bounce ? Math.hypot(bounce.x - bx, bounce.z - bz) : 99;
    best = { vx: hx * s * cosE, vy: s * elev, vz: hz * s * cosE, wx: w.wx, wz: w.wz };
    if (land < d) lo = s; else hi = s;
  }
  return best;
}

// Aim a strike so its predicted path crosses the goal line at (goalX, ty, tz).
// Works for direct shots, bank shots (pass the mirror angle as `angle0`) and
// curled shots (spin wy) — the solver corrects angle and lift against the real sim.
export function solveStrike(ball, goalX, ty, tz, speed, { wy = 0, angle0 = null, iters = 5, bs = 0 } = {}) {
  let ang = angle0 ?? Math.atan2(tz - ball.z, goalX - ball.x);
  // Flight-time guess. A bank's path is as long as the line to the mirror image,
  // and the second leg runs at ~0.7× after the cage restitution.
  const hd = Math.hypot(goalX - ball.x, tz - ball.z);
  let tGuess = hd / (speed * 0.9);
  if (angle0 != null) {
    const dirX = Math.cos(ang), dirZ = Math.sin(ang);
    const wz = Math.sign(dirZ) * (COURT.halfW - BALL.r);
    const leg1 = Math.abs(dirZ) > 1e-3 ? Math.abs((wz - ball.z) / dirZ) : hd;
    const total = Math.abs((goalX - ball.x) / (dirX || 1e-3));
    tGuess = leg1 / (speed * 0.9) + Math.max(0, total - leg1) / (speed * 0.9 * 0.85);
  }
  let vy = clamp((ty - ball.y + 0.5 * BALL.gravity * tGuess * tGuess) / tGuess, -2, 12);
  let prevAng = null, prevErr = null, cross = null;
  for (let i = 0; i < iters; i++) {
    const w = backspin(Math.cos(ang), Math.sin(ang), bs);
    const b = ballAt(ball.x, ball.y, ball.z, Math.cos(ang) * speed, vy, Math.sin(ang) * speed, w.wx, wy, w.wz);
    const p = predictPath(b, 3, 1 / 60);
    // Measure just in front of the end fence: a ball aimed wide rebounds off it
    // before ever reaching the goal line, but it still crosses this plane.
    cross = crossPlaneX(p.pts, goalX - Math.sign(goalX) * (BALL.r + 0.02));
    if (!cross) {
      // Never reached the line (cleared the bar into the fence, or died short): adjust lift and retry.
      const end = p.pts[p.pts.length - 1];
      vy = end.y > 1 || p.events.some(e => e.type === 'wall' && Math.abs(Math.abs(e.x) - COURT.halfL) < 0.05) ? vy * 0.6 : vy * 1.2 + 0.5;
      continue;
    }
    const errZ = cross.z - tz, errY = cross.y - ty;
    if (Math.abs(errZ) < 0.04 && Math.abs(errY) < 0.06) break;
    vy = clamp(vy - errY / Math.max(cross.t, 0.15), -3, 14);
    // Secant step on the angle. The first step is a small probe so the solver
    // learns the slope — a bank shot mirrors the error, so no fixed sign works.
    let next;
    if (prevAng !== null && Math.abs(errZ - prevErr) > 1e-5) next = ang - errZ * (ang - prevAng) / (errZ - prevErr);
    else next = ang + (errZ > 0 ? -0.004 : 0.004);
    prevAng = ang; prevErr = errZ; ang = next;
  }
  const w = backspin(Math.cos(ang), Math.sin(ang), bs);
  return { vx: Math.cos(ang) * speed, vy, vz: Math.sin(ang) * speed, wx: w.wx, wy, wz: w.wz, cross, angle: ang };
}

// Bank geometry off a side wall. With normal restitution e and tangential
// retention et, the rebound leaves at tan θ' = (et / e)·tan θ (a little wider
// than it came in). Distances d1 (ball→wall) and d2 (wall→target) then give the
// bounce point in closed form:  L = d1·tan θ + d2·(et/e)·tan θ.
// (With et = e this reduces to the classic mirror-image method.)
export function bankAim(bx, bz, tx, tz, wallSide) {
  const wz = wallSide * (COURT.halfW - BALL.r);
  const d1 = Math.abs(wz - bz), d2 = Math.abs(wz - tz);
  const L = tx - bx;
  const k = BALL.wallT / BALL.wallE;
  const tanT = Math.abs(L) / Math.max(d1 + k * d2, 1e-3);
  const bounceX = bx + Math.sign(L) * d1 * tanT;
  const theta = Math.atan(tanT);
  // speed kept through the bounce
  const keep = Math.hypot(BALL.wallE * Math.cos(theta), BALL.wallT * Math.sin(theta));
  return { angle: Math.atan2(wz - bz, bounceX - bx), bounceX, wz, incidence: theta, keep };
}
export const bankAngle = bankAim;
