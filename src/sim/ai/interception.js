// =====================================================================
// InterceptionSystem: what each player knows about a moving ball. Nobody sees a pass's
// line the instant it is struck:
//  • every player reacts after his own delay. It depends on the AI level ([weak, elite]
//    from footballGameplayConfig.interception), his reading of the game, and whether
//    the ball was struck behind him. The passer's side reacts sooner.
//  • each side then reads the ball's line with an error (direction and pace) that
//    shrinks as they watch it travel.
//  • a player commits to cutting it out only at a point he can reach before the ball
//    (his ETA beats the ball's by a margin). Otherwise he holds his job: press, block a
//    lane, track a runner.
// The human's own side uses the exact path for switching and receiving (the person
// playing sees the ball). Paths are cached and refreshed at readHz.
// =====================================================================
import { footballGameplayConfig as GP, byDiff } from '../../config.js';
import { copyBall, predictPath } from '../ball.js';
import { reachTime } from './eval.js';
import { clamp } from '../../util/math.js';

const C = GP.interception;
const STEP = 1 / 30, HORIZON = 2.5;

export class InterceptionSystem {
  constructor(m) {
    this.m = m;
    this.kick = null;                       // { t, team, x, z, pid }: the last strike, header or deflection
    this.react = new Map();                 // player id → his reaction delay to it (s)
    this.err = [{ a: 0, s: 0 }, { a: 0, s: 0 }];   // each side's misread (unit normal draws)
    this.pred = [null, null]; this.predT = [-9, -9];
    this.exact = null; this.exactT = -9;
  }

  get diff() { return this.m.opts.difficulty; }

  // The reaction window [lo, hi] (s) at this AI level.
  window() {
    const d = this.diff;
    return [byDiff([C.reaction.weak[0], C.reaction.elite[0]], d), byDiff([C.reaction.weak[1], C.reaction.elite[1]], d)];
  }

  // A strike, a header, a block or a deflection: everyone's read of the ball starts again.
  onKick(by) {
    const m = this.m, b = m.ball;
    const team = by ? by.team : -1;
    this.kick = { t: m.time, team, x: b.x, z: b.z, pid: by ? by.id : -1 };
    const [lo, hi] = this.window();
    for (const q of m.players) {
      if (!q.active) continue;
      // A defender's reading of the game: a good tackler is on it a beat sooner.
      let r = (lo + m.rand() * (hi - lo)) * (1.12 - 0.24 * q.attrs.tackle);
      // Struck behind him: he has to turn to pick it up.
      const dx = b.x - q.x, dz = b.z - q.z, dl = Math.hypot(dx, dz) || 1;
      if ((dx * Math.cos(q.facing) + dz * Math.sin(q.facing)) / dl < -0.2) r += C.facingAway;
      if (q.team === team) r *= C.sameTeam;
      this.react.set(q.id, r);
    }
    for (const t of [0, 1]) this.err[t] = { a: this.gauss(), s: this.gauss() };
    this.pred = [null, null]; this.exact = null;
  }

  gauss() {
    const u = Math.max(1e-9, this.m.rand()), v = this.m.rand();
    return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), -2.5, 2.5);
  }

  // Time p still needs before he has picked up the last strike (0 once he has).
  waitFor(p) {
    const k = this.kick;
    if (!k) return 0;
    return Math.max(0, (this.react.get(p.id) ?? 0) - (this.m.time - k.t));
  }
  reacted(p) { return this.waitFor(p) <= 0; }

  // The ball's path as team t reads it now (null while someone has it).
  perceived(t) {
    const m = this.m, b = m.ball;
    if (b.owner) return null;
    if (this.pred[t] && m.time - this.predT[t] < 1 / C.readHz) return this.pred[t];
    const k = this.kick, d = this.diff;
    // The misread is at its worst when they first react, then shrinks as they watch it.
    const [lo, hi] = this.window();
    const since = k ? m.time - k.t - (lo + hi) / 2 : 9;
    const fade = Math.exp(-Math.max(0, since) / C.readDecay) * (k && k.team === t ? C.readSameTeam : 1);
    const ea = this.err[t].a * byDiff(C.readAngle, d) * fade, es = this.err[t].s * byDiff(C.readPace, d) * fade;
    const g = copyBall(b), c = Math.cos(ea), s = Math.sin(ea);
    g.vx = (b.vx * c - b.vz * s) * (1 + es); g.vz = (b.vx * s + b.vz * c) * (1 + es); g.vy = b.vy * (1 + es);
    this.pred[t] = predictPath(g, HORIZON, STEP); this.predT[t] = m.time;
    return this.pred[t];
  }

  // The ball's true path (what the person playing sees).
  exactPath() {
    const m = this.m;
    if (m.ball.owner) return null;
    if (this.exact && m.time - this.exactT < 1 / C.readHz) return this.exact;
    this.exact = predictPath(m.ball, HORIZON, STEP); this.exactT = m.time;
    return this.exact;
  }

  // Where p can meet the ball: the first point of its path (as his side reads it, or the
  // exact one) he gets to before it by the margin, no higher than maxY. Before he has
  // reacted, the time he still needs comes first.
  // → { t (s from now), x, z, feasible, eta (his), ballT (the ball's) }
  intercept(p, maxY = 2.2, exact = false) {
    const m = this.m, b = m.ball;
    if (b.owner) return { t: reachTime(p, b.x, b.z, 0), x: b.x, z: b.z, feasible: true, eta: 0, ballT: 0 };
    const path = exact ? this.exactPath() : this.perceived(p.team);
    const age = m.time - (exact ? this.exactT : this.predT[p.team]);
    const wait = exact ? 0 : this.waitFor(p);
    const pts = path.pts;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], tb = i * STEP - age;
      if (tb < 0 || q.y > maxY) continue;
      const tp = wait + reachTime(p, q.x, q.z, 0);
      if (tp + C.etaMargin <= tb) return { t: tb, x: q.x, z: q.z, feasible: true, eta: tp, ballT: tb };
    }
    const e = pts[pts.length - 1];
    const tp = wait + reachTime(p, e.x, e.z, 0);
    return { t: tp, x: e.x, z: e.z, feasible: false, eta: tp, ballT: Math.max(0, (pts.length - 1) * STEP - age) };
  }

  // Team t's best chance to cut the ball out (by its own read, after reactions): the
  // outfielder who gets to its path first. → { p, ic } or null. (Debug / telemetry.)
  bestCut(t) {
    if (this.m.ball.owner) return null;
    let best = null;
    for (const q of this.m.players) {
      if (!q.active || q.team !== t || q.line === 'GK') continue;
      const ic = this.intercept(q);
      if (!best || ic.t < best.ic.t) best = { p: q, ic };
    }
    return best;
  }

  // Team t's read of who an opponent's ball is for: the man nearest its (perceived) path,
  // allowing for how far he can move by then. → { p, x, z, t } or null.
  readTarget(t) {
    const m = this.m, path = this.perceived(t);
    if (!path) return null;
    let best = null, bs = Infinity;
    for (const a of m.players) {
      if (!a.active || a.team === t) continue;
      for (let i = 2; i < path.pts.length; i += 2) {
        const q = path.pts[i], tb = i * STEP;
        if (q.y > 2.2) continue;
        const s = Math.hypot(q.x - a.x, q.z - a.z) - Math.min(a.speed + 2, 6) * tb * 0.6;
        if (s < bs) { bs = s; best = { p: a, x: q.x, z: q.z, t: tb }; }
      }
    }
    return best && bs < 2.5 ? best : null;
  }
}
