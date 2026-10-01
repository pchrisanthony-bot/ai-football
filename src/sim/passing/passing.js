// =====================================================================
// PassingSystem: a pass goes through the same stages for the human and the AI.
//   1. INTENT (request time, human): stick, button and charge → the pass type and the
//      team-mate it's for (PassTargetSelector), under the assist mode.
//   2. IDEAL (contact time): where it should go. That is the receiver's reception point
//      (PassTrajectorySolver), the space the stick points into, or the AI's chosen spot.
//   3. QUALITY 0..1: the passer's passing, his body shape (across or behind him), his
//      speed, pressure, a first-time ball, distance, over-hitting, and the pass type.
//   4. READ: the passer's read of a moving receiver's run (lead uncertainty), scaled by
//      quality; through balls get a variable weight.
//   5. ASSIST (human): how much of the angle from the stick to the ideal is corrected,
//      and how much of the pace is chosen for him (PassAssistSystem).
//   6. EXECUTION: a graded error is drawn from the quality (excellent … very poor) and
//      bends the direction and the pace. Then the trajectory is launched.
// Every pass leaves a context (this.ctx) with all of it. The debug overlay, the pass
// feedback, the AI's reading of a pass in flight and the tests all use it.
// =====================================================================
import { footballGameplayConfig as GP } from '../../config.js';
import { PITCH, inKeeperArea } from '../pitch.js';
import { clamp, lerp, angleDiff } from '../../util/math.js';
import { findBestPassTarget, inferReceiver } from './targets.js';
import { MODES, correction, assistedPace } from './assist.js';
import { receptionPoint, groundPace, launch, GROUND, LOFTED, ACTION_OF } from './trajectory.js';

const P = GP.passing;

export class PassingSystem {
  constructor(m) {
    this.m = m;
    this.mode = MODES[m.opts.passAssist] ? m.opts.passAssist : P.assist;
    this.ctx = null;           // the last pass (see execute)
  }

  setMode(id) { if (MODES[id]) this.mode = id; }

  // The last pass while it's still travelling untouched (null once anyone has touched it).
  inFlight() {
    const c = this.ctx, b = this.m.ball;
    return c && this.m.phase === 'play' && !b.owner && b.lastTouch === c.passer && b.lastKick && b.lastKick.t === c.t && this.m.time - c.t < 4 ? c : null;
  }

  // ------------------------------------------------------------------ 1. intent (human)
  // it: { dirX, dirZ (stick, world), button: 'pass' | 'through' | 'lob', power (0..1),
  //       flair, lead (a lofted ball into a run), driven }
  // Returns { action, params } for Match.requestKick.
  plan(p, it) {
    const m = this.m, M = MODES[this.mode];
    const hl = Math.hypot(it.dirX, it.dirZ), hasStick = hl > 0.2;
    const ang = hasStick ? Math.atan2(it.dirZ, it.dirX) : p.facing;
    let type = it.button === 'through' ? 'through'
      : it.button === 'lob' ? (it.lead ? 'lobThrough' : 'lofted')
      : it.driven || (it.power ?? 0) >= 0.8 ? 'driven' : 'short';
    // With the stick neutral the pass goes the way he faces: look a little wider.
    const window = M.window > 0 ? (hasStick ? M.window : Math.max(M.window, 0.9)) : 0;
    const pick = findBestPassTarget(m, p, { ang, type, power: it.power, window, usePower: 1 - M.pace });
    type = this.classify(p, type, pick ? pick.R : null, ang);
    // Into space (no one there, or manual): how far, from the charge.
    const spaceDist = lerp(P.space[0], P.space[1], it.power ?? 0.3) * (type === 'through' ? 1.15 : LOFTED.has(type) ? 1.7 : type === 'backheel' ? 0.5 : 1);
    let r = pick ? pick.r : null;
    if (!r && M.window === 0) r = inferReceiver(m, p, ang, spaceDist);
    const intent = {
      ang, hasStick, mode: this.mode, manual: M.window === 0, type, power: it.power ?? null, flair: !!it.flair, spaceDist,
      pick: pick ? { name: pick.r.name, score: +pick.score.toFixed(2), off: +(pick.e * 180 / Math.PI).toFixed(1), parts: pick.parts, rivals: pick.all.length } : null,
    };
    const params = { receiver: r, intent, passType: type, power: it.power ?? null, flair: !!it.flair };
    if (P.contact[type]) params.contact = P.contact[type];
    return { action: ACTION_OF[type], params };
  }

  // Set pieces: the team-mate the stick picks out for a short (or long) ball, if any.
  receiverFor(p, dirX, dirZ, long) {
    const M = MODES[this.mode], hl = Math.hypot(dirX, dirZ);
    const ang = hl > 0.2 ? Math.atan2(dirZ, dirX) : p.facing, type = long ? 'lofted' : 'short';
    if (M.window === 0) return inferReceiver(this.m, p, ang, long ? 30 : 12);
    const pick = findBestPassTarget(this.m, p, { ang, type, power: null, window: Math.max(M.window, hl > 0.2 ? 0 : 0.9), usePower: 0 });
    return pick ? pick.r : null;
  }

  // The pass type the situation makes of it: a lofted ball from wide into the box is a cross;
  // a short one behind him on the move is a backheel; one under heavy pressure with the
  // ball only just his is hurried (emergency).
  classify(p, type, R, ang) {
    const m = this.m, b = m.ball, dir = m.teams[p.team].dir;
    if (type === 'lofted' && R) {
      const wide = Math.abs(b.z) > PITCH.halfW * 0.5 && b.x * dir > PITCH.halfL * 0.4;
      if (wide && inKeeperArea(R.x, R.z, m.oppGoalX(p.team), 3)) return 'cross';
    }
    if (type === 'short' || type === 'driven') {
      const to = R ? Math.atan2(R.z - b.z, R.x - b.x) : ang, d = R ? Math.hypot(R.x - b.x, R.z - b.z) : 99;
      if (type === 'short' && p.speed > 2 && d < P.backheel.maxDist && Math.abs(angleDiff(p.facing, to)) > P.backheel.behind) return 'backheel';
      if (m.nearestOpponent(p) < P.emergency && p.possessT < 0.6) return 'emergency';
    }
    return type;
  }

  // ------------------------------------------------------------------ 3. quality
  // f: { held (s he'd had it), rel (m/s of the ball against him before the kick) }
  quality(p, type, ang, dist, power, f) {
    const Q = P.quality, m = this.m;
    let q = Q.base + Q.attr * p.attrs.pass;
    if (type !== 'backheel') q -= Q.facing * clamp((Math.abs(angleDiff(p.facing, ang)) - 0.6) / 2.2, 0, 1);
    q -= Q.speed * clamp((p.speed - 3) / 4.4, 0, 1);
    q -= Q.pressure * clamp((2.2 - m.nearestOpponent(p)) / 1.6, 0, 1);
    if (f.held < 0.2) q -= Q.oneTouch * clamp(f.rel / 12, 0.25, 1);
    q -= Q.distance * clamp((dist - 15) / 25, 0, 1);
    if (power != null && GROUND.has(type)) q -= Q.overhit * clamp((power - 0.85) / 0.15, 0, 1);   // over-hitting a ball along the ground
    q += P.typeQuality[type] ?? -0.05;
    return clamp(q, 0.02, 0.98);
  }

  // The grade a pass of quality q comes off as: centred on its quality, with a spread.
  grade(q) {
    const c = (1 - q) * (P.tiers.length - 0.5);
    return clamp(Math.round(c + this.gauss() * P.tierSpread), 0, P.tiers.length - 1);
  }

  gauss() {
    const u = Math.max(1e-9, this.m.rand()), v = this.m.rand();
    return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), -2.5, 2.5);
  }

  // ------------------------------------------------------------------ 2–6. the strike
  // a: the kick action ({ type, receiver, target, intent, passType, power, angle, speed }).
  // f: { held, rel } (see quality). Returns the ball's launch { vx, vy, vz, wx, wy, wz }.
  execute(p, a, f) {
    const m = this.m, b = m.ball, it = a.intent || null, r = a.receiver || null;
    const modeId = it ? it.mode : 'ai';
    const toward = T => ({ ang: Math.atan2(T.z - b.z, T.x - b.x), dist: Math.max(1, Math.hypot(T.x - b.x, T.z - b.z)), at: T });
    let type = a.passType || (a.angle != null ? 'driven'
      : this.classify(p, a.type === 'through' ? 'through' : a.type === 'lob' ? 'lofted' : 'short', r || a.target || null, p.facing));
    if (!it && type === 'short' && r && Math.hypot(r.x - b.x, r.z - b.z) > 20) type = 'driven';
    // 2) the ideal
    const leadsRun = r && a.angle == null && !(it && it.manual) && !(!it && a.target && LOFTED.has(type));
    let ideal;
    if (a.angle != null) ideal = { ang: a.angle, dist: 14 };
    else if (leadsRun) ideal = toward(receptionPoint(m, r, b.x, b.z, type));
    else if (it) ideal = { ang: it.ang, dist: it.spaceDist };
    else ideal = toward(a.target || { x: b.x + Math.cos(p.facing) * 10, z: b.z + Math.sin(p.facing) * 10 });
    // 3) quality
    const power = it ? it.power : a.power ?? null;
    const q = this.quality(p, type, ideal.ang, ideal.dist, it ? power : null, f);
    // 4) the read of his run
    let read = 1;
    if (leadsRun && r.speed > 0.8) {
      const sd = type === 'through' || type === 'lobThrough' ? lerp(P.throughNoise[0], P.throughNoise[1], 1 - q) : P.leadNoise * (1 - q);
      read = clamp(1 + this.gauss() * sd, 0.4, 1.6);
      ideal = toward(receptionPoint(m, r, b.x, b.z, type, read));
    }
    // 5) assist: the stick against the ideal
    let aim = ideal.ang, corr = 1, dist = ideal.dist;
    const M = MODES[modeId];
    if (it) {
      if (leadsRun) {
        // The stick is "on him" if it points at the man or at where he'll take it: the
        // part of the error the assist doesn't correct is measured from the nearer one.
        const eMan = angleDiff(Math.atan2(r.z - b.z, r.x - b.x), it.ang), eLead = angleDiff(ideal.ang, it.ang);
        const off = Math.abs(eMan) < Math.abs(eLead) ? eMan : eLead;
        corr = correction(modeId, { e: Math.abs(off), window: Math.max(M.window, it.hasStick ? 0 : 0.9), d: ideal.dist, attr: p.attrs.pass, speed: p.speed, near: m.nearestOpponent(p) });
        aim = ideal.ang + off * (1 - corr);
      } else { corr = 0; aim = it.ang; }
    }
    // …and the pace
    let pace = null;
    if (a.angle != null) pace = a.speed ?? 14;
    else if (GROUND.has(type)) {
      const auto = groundPace(type, dist);
      if (it) pace = assistedPace(modeId, auto, lerp(7, (P.maxPace[type] || 19) + 3, power ?? 0.3), power);
      else pace = power != null ? auto * (0.92 + 0.2 * power) : auto;
    } else if (it) dist = lerp(lerp(12, 45, power ?? 0.4), dist, M.pace);
    // 6) execution error, graded by quality
    const g = this.grade(q), T = P.tiers[g], k = it ? M.error : 1;
    const angErr = this.gauss() * T.ang * k, paceErr = this.gauss() * T.pace * k;
    const v = launch(type, b, aim + angErr, dist, pace, 1 + paceErr);
    this.ctx = {
      t: m.time, passer: p, receiver: r, type, action: a.type, mode: modeId, human: !!it,
      from: { x: b.x, z: b.z }, intended: ideal.at || { x: b.x + Math.cos(ideal.ang) * ideal.dist, z: b.z + Math.sin(ideal.ang) * ideal.dist },
      stickAng: it ? it.ang : null, idealAng: ideal.ang, aimAng: aim, correction: corr, read,
      dist, pace: Math.hypot(v.vx, v.vy, v.vz), quality: q, grade: g, tier: T.name, angErr, paceErr, power,
      pick: it ? it.pick : null, receiverOffside: false,
    };
    return v;
  }
}
