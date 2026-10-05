// =====================================================================
// RefereeSystem (Laws 8, 12, 13, 14): it watches the challenges and the keeper, and stops
// play the way a referee does.
//  • The keeper's protection: with the ball in his hands, nobody may challenge him (no
//    tackle, no slide, no trip); opponents clear his area; after gkHoldMax seconds he
//    concedes an indirect free kick.
//  • Fouls come from the geometry of each challenge, not a dice roll.
//    - A standing tackle sweeps the foot out along the tackler's facing; a slide drives it
//      ahead of the hips. Whichever the foot meets first, ball or man, decides it: the man
//      first is a foul.
//    - So is a challenge from directly behind, judged by the carrier's forward vector
//      against the line from the tackler to him (a dot product).
//    - Severity comes from the tackler's speed, from behind, a slide, and denying an
//      obvious goal-scoring chance. It gives nothing, a yellow or a red; two yellows make a
//      red, and a red sends him off.
//  • The restart is a direct free kick where it happened, or a penalty if it was in the
//    fouling side's own area.
//  • The kick-off: until the taker has played the ball, everyone stays in his own half and
//    the other side stays out of the centre circle.
// Fouls are on in open formats and off in the street cage (rules.foulsEnabled); the
// keeper's protection and the kick-off apply everywhere.
// =====================================================================
import { footballGameplayConfig as GP, byDiff } from '../../config.js';
import { PITCH, inKeeperArea, clampToField } from '../pitch.js';
import { clamp } from '../../util/math.js';

const C = GP.referee;

// Along a ray from (x, z) heading (fx, fz): the distance at which it first touches a circle
// (cx, cz, r), or Infinity if it misses within len. Inside the circle already: 0.
export function rayHit(x, z, fx, fz, cx, cz, r, len) {
  const dx = cx - x, dz = cz - z, proj = dx * fx + dz * fz, perp2 = dx * dx + dz * dz - proj * proj;
  if (dx * dx + dz * dz <= r * r) return 0;
  if (perp2 > r * r || proj < 0) return Infinity;
  const t = proj - Math.sqrt(r * r - perp2);
  return t <= len ? t : Infinity;
}

// Is the tackler coming from behind the carrier? The carrier's forward vector against the
// unit vector from the tackler to him: near 1 means the tackler is right behind him.
export function fromBehind(tackler, carrier) {
  const dx = carrier.x - tackler.x, dz = carrier.z - tackler.z, d = Math.hypot(dx, dz) || 1;
  const dot = Math.cos(carrier.facing) * dx / d + Math.sin(carrier.facing) * dz / d;
  return { dot, behind: dot > C.behindDot };
}

export class RefereeSystem {
  constructor(m) {
    this.m = m;
    this.fouls = !!m.cfg.rules.foulsEnabled;
    this.yellows = new Map();       // player id → yellow cards
    this.reds = [0, 0];             // per team
    this.last = null;               // the last foul (debug / telemetry)
    this.kickoffLive = false;       // kick-off whistled, ball not yet played
    this.holdT = 0;                 // how long the keeper has had it in his hands
  }

  // ------------------------------------------------------------------ the keeper
  // The keeper holding the ball in his hands (in his area), or null.
  keeperHolding() {
    const b = this.m.ball, o = b.owner;
    return o && b.inHands && o.line === 'GK' ? o : null;
  }

  // May p make a challenge right now? Not on a keeper with the ball in his hands.
  canChallenge(p) {
    const k = this.keeperHolding();
    return !(k && k.team !== p.team);
  }

  // Can p be knocked over by a challenge? Not the keeper while he holds the ball.
  protects(q) { return this.keeperHolding() === q; }

  // ------------------------------------------------------------------ every tick in play
  step(dt) {
    const m = this.m, b = m.ball;
    // the keeper's six seconds
    const k = this.keeperHolding();
    this.holdT = k && m.restart == null ? this.holdT + dt : 0;
    if (k && this.holdT > C.gkHoldMax) {
      this.holdT = 0;
      m.emit({ type: 'foul', kind: 'handling', pid: k.id, team: k.team, x: k.x, z: k.z, card: null });
      m.beginRestart('FREE_KICK', 1 - k.team, this.outOfGoalArea(k), 'keeper held it too long');
      return;
    }
    // the kick-off: in your own half (and out of the circle) until the ball is played
    if (this.kickoffLive) {
      if (!b.owner || Math.hypot(b.x, b.z) > 0.6 || (b.lastKick && b.lastKick.t > m.time - 2)) { this.kickoffLive = false; return; }
      const taking = b.owner.team, R = PITCH.centreR;
      for (const p of m.players) {
        if (!p.active || p === b.owner) continue;
        const dir = m.teams[p.team].dir;
        if (p.x * dir > -0.05) { p.x = -0.05 * dir; if (p.vx * dir > 0) p.vx = 0; }
        const d = Math.hypot(p.x, p.z);
        if (p.team !== taking && d < R) { const s = R / (d || 1); p.x = d ? p.x * s : -dir * R; p.z *= s; }
      }
    }
  }

  // The kick-off whistle has gone.
  kickoff() { this.kickoffLive = true; this.holdT = 0; }

  // The keeper's free kick is taken from the edge of his area.
  outOfGoalArea(k) {
    const gx = this.m.ownGoalX(k.team), dx = k.x - gx, d = Math.hypot(dx, k.z) || 1, r = PITCH.boxR + 0.3;
    return clampToField(gx + dx / d * r, k.z / d * r, 0.5);
  }

  // ------------------------------------------------------------------ challenges
  // A standing tackle by p on the carrier o: the foot sweeps out along p's facing. What does
  // it meet first? → { foul, ballFirst, behind, tBall, tBody }.
  judgeTackle(p, o) {
    const b = this.m.ball, fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const tBall = rayHit(p.x, p.z, fx, fz, b.x, b.z, C.ballHit, C.footReach);
    const tBody = rayHit(p.x, p.z, fx, fz, o.x, o.z, C.bodyHit, C.footReach);
    const { behind } = fromBehind(p, o);
    const ballFirst = tBall < tBody;
    const foul = this.fouls && tBody < Infinity && (!ballFirst || (C.behindIsFoul && behind));
    return { foul, ballFirst, behind, tBall, tBody };
  }

  // A slide that has just met something: 'ball' or the man q. The first thing a slide meets
  // is remembered on the action; the man first — or from behind into the carrier — is a foul.
  judgeSlide(p, a, what, q) {
    if (!a.first) a.first = what;
    if (!this.fouls || what !== 'man') return null;
    const carrier = a.target || q;
    const behind = q === carrier && fromBehind(p, q).behind;
    if (a.first === 'man' || (C.behindIsFoul && behind)) return { foul: true, ballFirst: a.first === 'ball', behind };
    return null;
  }

  // Would stopping q here deny an obvious goal-scoring chance? He has the ball (or it's at
  // his feet) in range of goal, going toward it, with nobody but the keeper goal-side of him.
  dogso(fouler, q) {
    const m = this.m, gx = m.oppGoalX(q.team), dir = m.teams[q.team].dir;
    const b = m.ball;
    if (b.owner !== q) return false;                                            // his ball
    const dg = Math.hypot(gx - q.x, q.z);
    if (dg > m.ai.R.shot * C.dogsoRange) return false;                          // in range of goal
    if ((q.vx * (gx - q.x) - q.vz * q.z) / (dg || 1) < 3) return false;          // running at it
    for (const d of m.players) {
      if (!d.active || d.team === q.team || d.line === 'GK' || d === fouler) continue;
      if ((d.x - q.x) * dir > 0 && Math.abs(d.z - q.z) < Math.abs(d.x - q.x) + 2) return false;   // someone covering
    }
    return true;
  }

  // ------------------------------------------------------------------ the whistle
  // fouler brought down victim at (x, z). j: { slide, behind, ballFirst }.
  // → the card shown ('yellow' | 'red' | null).
  callFoul(fouler, victim, x, z, j) {
    const m = this.m;
    const speed = Math.max(fouler.speed, Math.hypot(fouler.vx, fouler.vz));
    const inBox = inKeeperArea(x, z, m.ownGoalX(fouler.team), 0);
    const dogso = this.dogso(fouler, victim);
    const sev = clamp((speed - 3) / 5, 0, 1) + (j.behind ? C.sevBehind : 0) + (j.slide ? C.sevSlide : 0) + (dogso ? C.sevDogso : 0);
    let card = sev >= C.red ? 'red' : sev >= C.yellow ? 'yellow' : null;
    // Denying an obvious chance: a red — but in the area, a genuine attempt at the ball is
    // only a yellow (the penalty is the punishment).
    if (dogso) card = inBox && j.ballFirst !== false && !j.behind ? 'yellow' : 'red';
    if (card === 'yellow') {
      const n = (this.yellows.get(fouler.id) || 0) + 1;
      this.yellows.set(fouler.id, n);
      if (n >= 2) card = 'second yellow';
    }
    const T = m.teams[fouler.team].stats;
    T.fouls++;
    if (card === 'yellow') T.yellows++;
    if (card === 'red' || card === 'second yellow') { T.reds++; if (card === 'second yellow') T.yellows++; }
    this.last = { t: m.time, fouler: fouler.name, victim: victim.name, team: fouler.team, x, z, speed: +speed.toFixed(1), behind: !!j.behind, ballFirst: j.ballFirst, slide: !!j.slide, dogso, severity: +sev.toFixed(2), card, penalty: inBox };
    m.emit({ type: 'foul', kind: j.slide ? 'slide' : 'tackle', pid: fouler.id, victim: victim.id, team: fouler.team, x, z, card, penalty: inBox, behind: !!j.behind });
    victim.stun = Math.max(victim.stun, 0.4);
    // the restart: a penalty, or a direct free kick where it happened
    const to = victim.team;
    if (inBox) {
      const gx = m.oppGoalX(to), s = Math.sign(gx);
      m.beginRestart('PENALTY', to, { x: gx - s * (PITCH.penaltySpot ?? PITCH.boxR * 0.65), z: 0 }, 'foul');
    } else m.beginRestart('FREE_KICK', to, clampToField(x, z, 0.5), 'foul', { direct: true });
    if (card === 'red' || card === 'second yellow') this.sendOff(fouler);
    return card;
  }

  // Off he goes (a side keeps at least all but two of its outfielders).
  sendOff(p) {
    const m = this.m;
    if (this.reds[p.team] >= 2 || p.line === 'GK') return;
    this.reds[p.team]++;
    p.active = false; p.sentOff = true;
    p.x = 0; p.z = PITCH.halfW + 3; p.vx = p.vz = p.speed = 0;
    if (m.ball.owner === p) m.loseBall();
    m.emit({ type: 'sentOff', pid: p.id, team: p.team });
  }

  // ------------------------------------------------------------------ the AI's judgment
  // Should an AI defender go into this challenge? Not on the keeper's ball, and not through
  // the back of a man — unless he's reckless (weaker sides are, sometimes).
  aiWillChallenge(p, o) {
    if (!this.canChallenge(p)) return false;
    if (!this.fouls || !o) return true;
    if (p.ai.reckless) return true;
    if (fromBehind(p, o).behind) return false;
    // Only when the ball is the first thing in the way of his foot (not the man's legs).
    const b = this.m.ball, dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz) || 1;
    return rayHit(p.x, p.z, dx / d, dz / d, b.x, b.z, C.ballHit, C.footReach + 0.6) < rayHit(p.x, p.z, dx / d, dz / d, o.x, o.z, C.bodyHit, C.footReach + 0.6);
  }

  // Decided once per think (not every tick, or he'd be reckless in a few frames).
  aiTemper(p) { p.ai.reckless = this.fouls && this.m.rand() < byDiff(C.aiReckless, this.m.opts.difficulty) * 0.2; }
}
