// =====================================================================
// PassReceptionSystem + FirstTouchSystem: the man a pass is for sees it coming, picks where
// he'll take it, times his run to be set there as it arrives, opens his body, chooses his
// foot, and plans his first touch — for the AI and for the person playing alike.
//
//   SUPPORTING ─(he has read the pass)→ ANTICIPATING ─(it's ~0.45 s away)→ RECEIVING
//       → FIRST_TOUCH (the contact, Match.firstTouch) → IN_POSSESSION
//
// Where he takes it: every point of the ball's path (as his side reads it; the exact one
// for the person, who sees the ball) that he can get to — and be set at — before it, is
// costed (footballMovementConfig.receiving):
//     waiting for it · running hard into its line · an opponent there first ·
//     the ball's height · its pace
// The cheapest is his receiving point. He then runs at the pace that gets him there just
// as it arrives (never full tilt into it), braking into the spot, and stands so the ball
// runs to his receiving foot. Re-planned every tick: a misplaced pass is chased, a slow one
// met, one from behind turned to.
//
// The first touch (FirstTouchSystem.plan): with nobody near he takes it into the best
// space toward goal; with someone close, a shorter touch away from him; with someone
// tight behind, he kills it and keeps his body between the man and the ball.
// =====================================================================
import { footballMovementConfig as FM, PLAYER } from '../../config.js';
import { PITCH } from '../pitch.js';
import { clamp, angleDiff } from '../../util/math.js';
import { reachTime, threat } from './eval.js';
import { maxSpeed } from '../players.js';

const RC = FM.receiving, FT = FM.firstTouch;
const STEP = 1 / 30;            // the InterceptionSystem's path step

export class PassReceptionSystem {
  constructor(m) {
    this.m = m;
    this.plan = null;           // { passer, receiver, t0, type, from, vel, state, … }
  }

  // A pass meant for a team-mate has been struck (Match.fireKick).
  onPass(passer, receiver, type) {
    const m = this.m, b = m.ball;
    if (this.plan && this.plan.receiver !== receiver) this.clear();
    if (!receiver || receiver.team !== passer.team) { this.plan = null; return; }
    this.plan = {
      passer, receiver, t0: m.time, type,
      from: { x: b.x, z: b.z }, vel: { x: b.vx, y: b.vy, z: b.vz },
      state: 'SUPPORTING', point: null, contact: null,
    };
    receiver.recv = this.plan;
  }

  clear() {
    if (this.plan && this.plan.receiver.recv === this.plan) this.plan.receiver.recv = null;
    this.plan = null;
  }

  // Is the pass still his to take? (untouched since the strike, still meant for him)
  live() {
    const m = this.m, b = m.ball, P = this.plan;
    return !!P && m.phase === 'play' && !b.owner && b.passTo === P.receiver && b.lastTouch === P.passer && m.time - P.t0 < 4;
  }

  // Every tick, before anyone moves: re-plan the receiver's reception.
  update() {
    const m = this.m, P = this.plan;
    if (!P) return;
    if (P.state === 'FIRST_TOUCH' || P.state === 'IN_POSSESSION') {
      // The touch is done: he has it (or it got away). Keep the plan a moment for the
      // renderer (the cushioning foot), then let it go.
      if (m.ball.owner === P.receiver) P.state = 'IN_POSSESSION';
      if (m.time - (P.touchT ?? m.time) > 0.4) this.clear();
      return;
    }
    if (!this.live()) { this.clear(); return; }
    const p = P.receiver;
    // Until he has picked the pass up he carries on with what he was doing (the person
    // playing sees it at once).
    if (!p.human && !m.intercepts.reacted(p)) { P.state = 'SUPPORTING'; return; }
    const pt = this.choosePoint(p);
    P.point = pt;
    // It's still his pass while he can get to it (a slow ball isn't "anyone's" after 2.2 s).
    if (pt.feasible) m.ball.passUntil = Math.max(m.ball.passUntil, pt.tb + 0.4);
    const tLeft = pt.tb - m.time;
    P.state = tLeft < RC.prepTime ? 'RECEIVING' : 'ANTICIPATING';
    // Foot and body: decided as it gets close (and kept, unless the ball changes side).
    this.prepare(p, pt);
  }

  // The touch happened (Match.firstTouch / cushion): FIRST_TOUCH.
  touched(p) {
    const P = this.plan;
    if (!P || P.receiver !== p) return;
    P.state = 'FIRST_TOUCH'; P.touchT = this.m.time;
  }

  // ------------------------------------------------------------------ where he takes it
  choosePoint(p) {
    const m = this.m, IS = m.intercepts;
    const exact = !!p.human;
    const path = exact ? IS.exactPath() : IS.perceived(p.team);
    const age = m.time - (exact ? IS.exactT : IS.predT[p.team]);
    const wait = exact ? 0 : IS.waitFor(p);
    const pts = path.pts, opp = m.opponents(p);
    const near = Math.min(3, ...opp.map(o => Math.hypot(o.x - p.x, o.z - p.z)));
    const maxY = near > 3 ? 1.35 : 2.2;
    let best = null, fallback = null;
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i], tb = i * STEP - age;
      if (tb < 0.02 || q.y > maxY) continue;
      const tReach = wait + reachTime(p, q.x, q.z, 0);
      const slack = tb - tReach;
      // the ball here: its direction and pace
      const q0 = pts[i - 1], vx = (q.x - q0.x) / STEP, vz = (q.z - q0.z) / STEP, vb = Math.hypot(vx, vz) || 1e-3;
      const dist = Math.max(0, Math.hypot(q.x - p.x, q.z - p.z) - 0.45);
      if (!fallback || dist - tb * 3 < fallback.score) fallback = { score: dist - tb * 3, x: q.x, z: q.z, y: q.y, tb, vx, vz, vb, feasible: false };
      if (slack < RC.setTime) continue;
      // pace of the run he needs, and how much of it goes straight into the ball's line
      const vNeed = dist / Math.max(0.15, tb - wait);
      const ux = (q.x - p.x) / (dist + 0.45), uz = (q.z - p.z) / (dist + 0.45);
      const into = Math.max(0, -(ux * vx + uz * vz) / vb);
      // an opponent who gets there before him (after his own reaction to the strike): the
      // man who's there and set first takes it — so with a defender on his back he comes
      // short, in front of him, rather than waiting where the defender can step across
      let risk = 0;
      const mine = Math.min(tb, tReach + RC.setTime);
      for (const o of opp) {
        const to = IS.waitFor(o) + reachTime(o, q.x, q.z, 0);
        risk = Math.max(risk, clamp(0.5 + (mine - to) / 0.3, 0, 1) * (o.line === 'GK' ? 0.7 : 1));
      }
      // how much his run has to change (pace and line) to be there then
      const T = Math.max(0.15, tb - wait), chg = Math.hypot((q.x - p.x) / T - p.vx, (q.z - p.z) / T - p.vz);
      const cost = RC.wTime * tb + RC.wInto * Math.max(0, vNeed * into - RC.comfortInto)
        + RC.wRunChange * Math.max(0, chg - RC.comfortChange)
        + RC.wRisk * risk + RC.wHeight * Math.max(0, q.y - RC.groundY) + RC.wBallPace * vb;
      if (!best || cost < best.cost) best = { cost, x: q.x, z: q.z, y: q.y, tb, vx, vz, vb, risk, feasible: true, vRun: dist / T, stride: chg < RC.comfortChange && dist / T > 2.5 };
    }
    const pt = best || fallback || { x: m.ball.x, z: m.ball.z, y: m.ball.y, tb: 0, vx: 0, vz: 0, vb: 0, feasible: false };
    pt.tb = m.time + pt.tb;              // absolute
    pt.wait = wait;
    return pt;
  }

  // Foot, body shape and the first-touch plan for the point.
  prepare(p, pt) {
    const m = this.m, P = this.plan;
    const bx = -pt.vx / (pt.vb || 1), bz = -pt.vz / (pt.vb || 1);       // toward where the ball comes from
    // First touch: the AI plans it; the person's stick is his (HumanController sets touchDir).
    if (!p.human) FirstTouchSystem.plan(m, p, pt, P);
    const td = p.touchDir;
    // Foot: the ball's side of him, unless he's taking it across his body (then the back
    // foot opens it up). Side relative to the line the ball comes in on.
    const lat = -(p.x - pt.x) * bz + (p.z - pt.z) * bx;                  // + : he's to the ball line's left
    let foot = lat >= 0 ? 'R' : 'L';
    if (td) {
      const across = td.x * -bz + td.z * bx;                               // touch to the line's left (+) / right
      if (Math.abs(across) > 0.35) foot = across > 0 ? 'R' : 'L';          // inside of the far foot pushes it across
    }
    if (!P.foot || P.state === 'ANTICIPATING') P.foot = foot;
    // Where his body stands: just off the ball's line, so it runs onto the receiving foot.
    const side = P.foot === 'R' ? 1 : -1;
    const off = RC.footOffset * side;
    P.stand = clampIn({ x: pt.x - bz * off, z: pt.z + bx * off });
    // Body shape: open to the ball, turned toward where the touch goes (but he keeps the
    // ball in sight); with a man tight behind, square to the ball (protect it).
    let fa = Math.atan2(bz, bx);
    if (td && !P.protect) {
      const want = Math.atan2(td.z, td.x), d = angleDiff(fa, want);
      fa += clamp(d * 0.5, -RC.openMax, RC.openMax);
    }
    P.face = fa;
  }

  // The run to the receiving point (AI, and the person's receive assist). → { x, z, speed, sprint }
  steer(p) {
    const m = this.m, P = this.plan;
    if (!P || P.receiver !== p || !P.point) return null;
    const pt = P.point, s = P.stand || pt;
    const dx = s.x - p.x, dz = s.z - p.z, d = Math.hypot(dx, dz);
    const left = pt.tb - m.time - RC.setTime;
    if (d < RC.setRadius) return { x: 0, z: 0, speed: 0, set: true };
    // Pace: be there just in time. Brake into the spot — except when the ball's going his
    // way (a ball into his run): then he can run onto it.
    const vNeed = d / Math.max(0.08, left);
    const with_ = pt.vb > 0.5 ? Math.max(0, (dx * pt.vx + dz * pt.vz) / (d * pt.vb)) : 0;
    // arriving on the move: a ball going his way he runs onto; one he meets in his stride
    // (the plan needs little change to his run) he takes on the move
    const vArrive = Math.max(with_ * Math.min(pt.vb, 5.5), pt.stride ? Math.min(pt.vRun, 5.5) : 0);
    const vCap = Math.sqrt(vArrive * vArrive + 2 * RC.brake * d);
    const top = maxSpeed(p, true);
    // (a runner meeting it on his run keeps going; one with time to spare eases off)
    const want = pt.feasible ? Math.max(vNeed * 1.08, Math.min(RC.minStep, d * 3), vArrive * 0.85) : top;
    const speed = Math.min(top, vCap, want);
    return { x: dx / d, z: dz / d, speed, sprint: speed > maxSpeed(p, false) * 0.98 };
  }
}

const clampIn = q => ({ x: clamp(q.x, -PITCH.halfL + 0.4, PITCH.halfL - 0.4), z: clamp(q.z, -PITCH.halfW + 0.4, PITCH.halfW - 0.4) });

// =====================================================================
// FirstTouchSystem: where the AI receiver takes his first touch, by the pressure on him.
//   nobody near         into the best space toward goal, a positive touch
//   someone close       shorter, away from him
//   someone tight       away from him across the body — or, from behind, kill it and
//                       shield (body between him and the ball)
// Sets p.touchDir / p.touchPush / p.cushion (Match.firstTouch reads them) and plan.protect.
// =====================================================================
export const FirstTouchSystem = {
  plan(m, p, at, P = null) {
    const opp = m.opponents(p);
    let near = null, nd = Infinity;
    for (const o of opp) {
      // where he'll be as the ball arrives (a defender closing in)
      const t = Math.max(0, (at.tb ?? m.time) - m.time);
      const ox = o.x + o.vx * Math.min(t, 0.5), oz = o.z + o.vz * Math.min(t, 0.5);
      const dd = Math.hypot(ox - at.x, oz - at.z);
      if (dd < nd) { nd = dd; near = { o, x: ox, z: oz }; }
    }
    const bx = at.vb ? -at.vx / at.vb : -Math.cos(p.facing), bz = at.vb ? -at.vz / at.vb : -Math.sin(p.facing);
    if (P) P.protect = false;
    p.cushion = false;
    if (near && nd < FT.tight) {
      // From behind (on the far side of him from the ball): kill it, body in the way.
      const ox = near.x - at.x, oz = near.z - at.z, ol = Math.hypot(ox, oz) || 1;
      const behind = -(ox * bx + oz * bz) / ol;          // 1 = straight behind him
      if (behind > 0.5) { p.cushion = true; p.touchDir = null; p.touchPush = FT.pushTight; if (P) P.protect = true; return; }
      // Otherwise across him, away from the man.
      const away = bestDir(m, p, at, Math.atan2(-oz, -ox), 1.3);
      p.touchDir = away; p.touchPush = FT.pushTight;
      return;
    }
    const goal = Math.atan2(-at.z * 0.6, m.oppGoalX(p.team) - at.x);
    if (near && nd < FT.close) {
      const away = Math.atan2(at.z - near.z, at.x - near.x);
      // between away-from-him and toward goal
      const mid = goal + clamp(angleDiff(goal, away), -1.2, 1.2) * 0.6;
      p.touchDir = bestDir(m, p, at, mid, 1.0); p.touchPush = FT.pushClose;
      return;
    }
    p.touchDir = bestDir(m, p, at, goal, 1.6); p.touchPush = FT.pushFree;
  },
};

// The most open direction within ±spread of ang from the ball's arrival point, scored by
// space (the nearest opponent to a short ray) and progress toward goal.
function bestDir(m, p, at, ang, spread) {
  const opp = m.opponents(p), n = FT.rays;
  let best = null, bs = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = ang + (n > 1 ? (i / (n - 1) - 0.5) * 2 * spread : 0);
    const ex = at.x + Math.cos(a) * FT.ray, ez = at.z + Math.sin(a) * FT.ray;
    if (Math.abs(ex) > PITCH.halfL - 0.6 || Math.abs(ez) > PITCH.halfW - 0.6) continue;
    let space = 9;
    for (const o of opp) {
      const dx = ex - at.x, dz = ez - at.z, l2 = dx * dx + dz * dz;
      const t = clamp(((o.x - at.x) * dx + (o.z - at.z) * dz) / l2, 0, 1);
      space = Math.min(space, Math.hypot(o.x - (at.x + dx * t), o.z - (at.z + dz * t)));
    }
    const s = clamp(space / 3, 0, 1) + 0.6 * threat(m, p.team, ex, ez) - 0.15 * Math.abs(angleDiff(ang, a));
    if (s > bs) { bs = s; best = { x: Math.cos(a), z: Math.sin(a) }; }
  }
  return best || { x: Math.cos(ang), z: Math.sin(ang) };
}
