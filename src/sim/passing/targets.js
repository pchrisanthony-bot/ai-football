// =====================================================================
// PassTargetSelector: which team-mate a pass is meant for.
// findBestPassTarget scores every team-mate inside the assist window around the stick on
// (weights in footballGameplayConfig.passing.weights):
//   alignment    how closely the stick points at him, or at where he's going
//   distance     how well his range suits this pass (and the charge, when it counts)
//   progression  how much ground the pass gains toward goal
//   space        how free he is where he'll take it
//   movement     whether he's moving to take it (showing for it / running in behind)
//   safety       how safe the lane is: an opponent race along the ball's path (ETA-based,
//                not a straight-line overlap test); for a lofted ball, the landing spot
// No one in the window: no target (the pass goes into space where the stick says).
// =====================================================================
import { footballGameplayConfig as GP } from '../../config.js';
import { clamp, angleDiff } from '../../util/math.js';
import { laneRisk, reachTime } from '../ai/eval.js';
import { receptionPoint, groundPace, travelTime, LOFTED } from './trajectory.js';

const W = GP.passing.weights;
// The distances (m) each type of pass is meant for.
const RANGE = { short: [4, 18], driven: [8, 30], through: [8, 34], backheel: [2, 9], emergency: [3, 20], lofted: [14, 48], lob: [8, 30], cross: [10, 40], lobThrough: [12, 40] };

// it: { ang (stick, rad), type, power (0..1 or null), window (rad), usePower (0..1) }
export function findBestPassTarget(m, p, it) {
  const b = m.ball, dir = m.teams[p.team].dir;
  const lofted = LOFTED.has(it.type) || it.type === 'lobThrough';
  const range = RANGE[it.type] || RANGE.short;
  const cands = [];
  if (!(it.window > 0)) return null;
  for (const r of m.mates(p)) {
    if (r.line === 'GK' && it.type !== 'short') continue;
    if (Math.hypot(r.x - b.x, r.z - b.z) < 2) continue;
    const R = receptionPoint(m, r, b.x, b.z, it.type);
    const d = Math.hypot(R.x - b.x, R.z - b.z);
    const e = Math.min(Math.abs(angleDiff(it.ang, Math.atan2(r.z - b.z, r.x - b.x))), Math.abs(angleDiff(it.ang, Math.atan2(R.z - b.z, R.x - b.x))));
    if (e > it.window) continue;
    const align = 1 - e / it.window;
    let dist = d < range[0] ? d / range[0] : d > range[1] ? clamp(1 - (d - range[1]) / range[1], 0, 1) : 1;
    // A charged pass says roughly how far: count it as much as the mode lets the charge count.
    if (it.power != null && it.usePower > 0) {
      const want = range[0] + (range[1] - range[0]) * it.power;
      dist = dist * (1 - 0.4 * it.usePower) + 0.4 * it.usePower * clamp(1 - Math.abs(d - want) / 15, 0, 1);
    }
    const prog = clamp(0.5 + (R.x - b.x) * dir / 30, 0, 1);
    let open = 99;
    for (const o of m.opponents(p)) open = Math.min(open, Math.hypot(o.x - R.x, o.z - R.z));
    const space = clamp(open / 5, 0, 1);
    // Movement: running in behind for a through ball or a long one; otherwise showing for it
    // (coming toward the ball) or holding still is better than drifting away.
    let move;
    if (it.type === 'through' || lofted) move = clamp(0.5 + (r.vx * dir) / 8, 0, 1);
    else { const tx = (b.x - r.x) / (Math.hypot(b.x - r.x, b.z - r.z) || 1), tz = (b.z - r.z) / (Math.hypot(b.x - r.x, b.z - r.z) || 1); move = clamp(0.6 + (r.vx * tx + r.vz * tz) / 10, 0, 1); }
    // Safety: who gets to the ball's path first (or to where a lofted ball lands).
    let risk;
    if (lofted) {
      const tb = travelTime(it.type === 'lobThrough' ? 'lofted' : it.type, d);
      let tOpp = Infinity;
      for (const o of m.opponents(p)) tOpp = Math.min(tOpp, reachTime(o, R.x, R.z, 0.25));
      risk = clamp(0.5 + (Math.max(tb, reachTime(r, R.x, R.z, 0.1)) - tOpp) / 0.5, 0, 1);
    } else {
      const s = groundPace(it.type, d);
      risk = laneRisk(m, p.team, [{ x: b.x, z: b.z }, R], x => x / Math.max(s * 0.8, 3), null, 0.6, 0.2).risk;
    }
    const safety = 1 - risk;
    const score = W.alignment * align + W.distance * dist + W.progression * prog + W.space * space + W.movement * move + W.safety * safety;
    cands.push({ r, R, d, e, score, parts: { align, dist, prog, space, move, safety } });
  }
  if (!cands.length) return null;
  cands.sort((a, c) => c.score - a.score);
  return { ...cands[0], all: cands };
}

// Manual passing: the stick is the pass. Whom is it for? The team-mate nearest the line of
// the ball within reach of it (for the receiver's runs and the player switch), or no one.
export function inferReceiver(m, p, ang, dist) {
  const b = m.ball, c = Math.cos(ang), s = Math.sin(ang);
  let best = null, bs = Infinity;
  for (const r of m.mates(p)) {
    if (r.line === 'GK') continue;
    const dx = r.x - b.x, dz = r.z - b.z, along = dx * c + dz * s, off = Math.abs(-dx * s + dz * c);
    if (along < 2 || along > dist + 8 || off > 2.5 + along * 0.06) continue;
    const sc = off + Math.abs(along - dist) * 0.08;
    if (sc < bs) { bs = sc; best = r; }
  }
  return best;
}
