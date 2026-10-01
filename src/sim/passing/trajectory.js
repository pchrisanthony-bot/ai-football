// =====================================================================
// PassTrajectorySolver: how each type of pass travels, and where a receiver will be when
// it reaches him. The pace and launch are solved against the real ball model, so the
// planner, the strike and the ball agree.
//   ground: short · driven · through · backheel · emergency — pace for an arrival speed
//   lofted: lofted · lob (higher, softer) · cross (flatter, whipped) · lobThrough — a lob solve
// =====================================================================
import { KICK, BALL, footballGameplayConfig as GP } from '../../config.js';
import { clampToField } from '../pitch.js';
import { groundPassSpeed, solveLob, rollTime } from '../kicks.js';
import { clamp } from '../../util/math.js';

const P = GP.passing;
export const GROUND = new Set(['short', 'driven', 'through', 'backheel', 'emergency']);
export const LOFTED = new Set(['lofted', 'lob', 'cross', 'lobThrough']);   // lobThrough: a lofted ball into a run
// The strike (wind-up, contact time, animation) each pass type is played with.
export const ACTION_OF = { short: 'pass', driven: 'pass', backheel: 'pass', emergency: 'pass', through: 'through', lofted: 'lob', lob: 'lob', cross: 'lob', lobThrough: 'lob' };

// Ground pace that gets to distance d at the type's arrival speed.
export function groundPace(type, d) {
  const [a0, k] = P.arrive[type] || P.arrive.short;
  return clamp(groundPassSpeed(d, a0 + k * d), KICK.passMin, P.maxPace[type] || KICK.passMax);
}

// A lofted ball of this type onto a spot d metres away: launch and time to its first bounce.
export function loftSolve(type, bx, by, bz, tx, tz) {
  const L = solveLob(bx, Math.max(by, BALL.r), bz, tx, tz, P.loft[type] ?? P.loft.lofted, type === 'cross' ? KICK.lobSpin * 0.5 : KICK.lobSpin);
  return { ...L, flight: Math.max(0.3, 2 * L.vy / BALL.gravity) };
}

// Travel time of a pass of this type over d metres (a lofted ball: to its first bounce,
// closed form with a little allowance for drag — the full solve is for the strike).
export function travelTime(type, d) {
  if (LOFTED.has(type)) {
    const th = Math.asin(P.loft[type] ?? P.loft.lofted), v = Math.sqrt(BALL.gravity * Math.max(d, 1) / Math.sin(2 * th));
    return 1.08 * 2 * v * Math.sin(th) / BALL.gravity;
  }
  return Math.min(rollTime(groundPace(type, d), d), 2.5);
}

// Where receiver r takes a pass of this type played from (bx, bz) now. read scales the
// passer's read of his run (1 = exact). Through balls go into the space ahead of his run,
// bent toward goal; anything else meets him where he'll be.
export function receptionPoint(m, r, bx, bz, type, read = 1) {
  let tx = r.x, tz = r.z;
  const dir = m.teams[r.team].dir;
  const through = type === 'through' || type === 'lobThrough';
  const kind = type === 'lobThrough' ? 'lofted' : type;
  for (let i = 0; i < 3; i++) {
    const d = Math.hypot(tx - bx, tz - bz);
    const t = travelTime(kind, d);
    if (through) {
      let rx = r.speed > 1 ? r.vx / r.speed : dir, rz = r.speed > 1 ? r.vz / r.speed : 0;
      if (r.speed > 1) { rx = rx * 0.7 + dir * 0.3; const l = Math.hypot(rx, rz) || 1; rx /= l; rz /= l; }
      const run = Math.max(r.speed, 5.5) * (t + KICK.throughLead * 0.4) * read;
      tx = r.x + rx * run; tz = r.z + rz * run;
    } else {
      const f = (LOFTED.has(kind) ? 0.8 : 0.85) * read;
      tx = r.x + r.vx * t * f; tz = r.z + r.vz * t * f;
    }
  }
  return clampToField(tx, tz, 0.8);
}

// The ball's launch for a pass of this type along ang, to land / arrive dist away, at
// pace (ground) or with pace scaled by paceK (lofted: the solve sets the pace).
export function launch(type, b, ang, dist, pace, paceK = 1) {
  const c = Math.cos(ang), s = Math.sin(ang);
  if (LOFTED.has(type)) {
    const L = loftSolve(type, b.x, b.y, b.z, b.x + c * dist, b.z + s * dist);
    return { vx: L.vx * paceK, vy: L.vy * paceK, vz: L.vz * paceK, wx: L.wx, wy: 0, wz: L.wz };
  }
  const v = pace * paceK;
  return { vx: c * v, vy: 0, vz: s * v, wy: 0 };
}
