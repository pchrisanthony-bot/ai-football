// =====================================================================
// OffsideSystem (Law 11). Offside is judged at the moment a team-mate plays or touches
// the ball. Everyone of his side in an offside position at that instant is recorded in
// a frozen snapshot. A player is in an offside position when he is in the opponents'
// half and nearer their goal line than both the ball and the second-last opponent;
// level (within a tolerance) is onside.
//
// Being in an offside position is only an offence once that player becomes involved:
//  • he plays or touches the ball (including a rebound or a deflection),
//  • he challenges an opponent for it, or
//  • he blocks the keeper's line of vision on a shot that goes in.
// Coming back onside afterwards changes nothing. A defender's deliberate play ends the
// snapshot; a deflection, a block or a save does not. There is no offside straight from
// a throw-in, a corner or a goal kick.
//
// The offence gives the defending side an indirect free kick where the player became
// involved. On by default on open pitches, off in the street cage (rules.offsideEnabled).
// =====================================================================
import { footballGameplayConfig as GP, byDiff } from '../../config.js';
import { clampToField } from '../pitch.js';
import { segDist2 } from '../../util/math.js';

const C = GP.offside;
// Touches that don't end the attacking side's snapshot when a defender makes them.
const NOT_DELIBERATE = new Set(['deflect', 'block', 'save']);

export class OffsideSystem {
  constructor(m) {
    this.m = m;
    this.enabled = !!m.cfg.rules.offsideEnabled;
    this.byId = new Map(m.players.map(p => [p.id, p]));
    this.snap = null;       // the live snapshot (frozen; replaced at the next touch)
    this.last = null;       // the last offside call (debug / telemetry)
    this.calls = 0;
  }

  reset() { this.snap = null; }

  // Team t's offside line, as u = x·dir: how far toward the goal team t attacks.
  // It is set by the second-last opponent (the keeper counts as one). With fewer than two
  // opponents there is no second-last, and only the halfway line (u = 0) applies.
  line(t) {
    const m = this.m, dir = m.teams[t].dir;
    let u1 = -Infinity, u2 = -Infinity, p1 = null, p2 = null;
    for (const q of m.players) {
      if (!q.active || q.team === t) continue;
      const u = q.x * dir;
      if (u > u1) { u2 = u1; p2 = p1; u1 = u; p1 = q; } else if (u > u2) { u2 = u; p2 = q; }
    }
    const u = p2 ? u2 : 0;
    return { u, x: u * dir, dir, secondLast: p2, last: p1 };
  }

  // How far forward team t's attackers may stand (u): the second-last opponent or the
  // ball, whichever is deeper, and never short of halfway.
  limit(t, ballX = this.m.ball.x) {
    const L = this.line(t);
    return Math.max(L.u, ballX * L.dir, 0);
  }

  // Is p in an offside position with the ball at ballX? extraTol (m) widens the
  // "level" band (the AI's imperfect read of the line).
  inPosition(p, ballX = this.m.ball.x, L = this.line(p.team), extraTol = 0) {
    const u = p.x * L.dir, tol = C.tolerance + extraTol;
    return u > tol && u > ballX * L.dir + tol && u > L.u + tol;
  }

  // The AI passer's read: is receiver r offside? Elite sides see it exactly (a touch
  // cautious); weak ones let marginal ones go.
  aiReadsOffside(r) {
    if (!this.enabled) return false;
    return this.inPosition(r, this.m.ball.x, undefined, byDiff(C.aiTol, this.m.opts.difficulty));
  }

  // p (team t) has just played or touched the ball: freeze who is offside now.
  snapshot(p, kind) {
    if (!this.enabled) return null;
    const m = this.m, b = m.ball;
    // Taken straight from a throw-in, a corner or a goal kick: nobody can be offside.
    if (b.restartTaker === p && C.noOffsideFrom.includes(b.restartKind)) { this.snap = null; return null; }
    const L = this.line(p.team), flagged = new Set();
    for (const q of m.players) if (q.active && q.team === p.team && q !== p && this.inPosition(q, b.x, L)) flagged.add(q.id);
    const recv = b.passTo && b.passTo.team === p.team ? b.passTo : null;
    const s = this.snap = Object.freeze({
      t: m.time, team: p.team, passer: p.id, kind,
      ballX: b.x, ballZ: b.z,
      lineX: L.x,                                           // the second-last opponent's line
      line: Math.max(L.u, b.x * L.dir, 0) * L.dir,          // the effective line (ball / halfway too)
      secondLast: L.secondLast ? L.secondLast.id : -1,
      flagged,
      receiver: recv ? recv.id : -1,
      receiverOffside: recv ? flagged.has(recv.id) : false,
      screen: kind === 'shot' || kind === 'volley' ? this.screening(p, flagged) : -1,
    });
    if (C.log && (flagged.size || kind !== 'dribble')) console.log(`[offside] ${m.time.toFixed(2)}s ${p.name} ${kind}: line x=${s.line.toFixed(2)} (2nd-last ${L.secondLast?.name ?? 'none'})${flagged.size ? ' · offside position: ' + [...flagged].map(id => this.byId.get(id).name).join(', ') : ''}${recv ? ` · to ${recv.name}${s.receiverOffside ? ' (OFFSIDE)' : ''}` : ''}`);
    return s;
  }

  // p touched the ball. how: 'kick' · 'control' · 'header' · 'chest' · 'tackle' · 'dribble'
  // (deliberate) or 'deflect' · 'block' · 'save' (not). Returns true when the touch was an
  // offside offence; the free kick has then been given and the caller drops the touch.
  touch(p, how) {
    if (!this.enabled || this.m.phase !== 'play') return false;
    const s = this.snap;
    if (s && p.team === s.team && s.flagged.has(p.id)) { this.call(p, how === 'block' || how === 'deflect' ? 'the ball came off him' : 'played the ball'); return true; }
    // A defender's deflection, block or save leaves the attacking side's snapshot alive.
    if (s && p.team !== s.team && NOT_DELIBERATE.has(how)) return false;
    // Anyone else's touch is a new moment to judge from: his side, positions now.
    this.snapshot(p, how);
    return false;
  }

  // Every tick in play: a man in an offside position who goes for a loose ball that an
  // opponent is also playing for is challenging him for it.
  step() {
    const s = this.snap, m = this.m, b = m.ball;
    if (!s || !s.flagged.size || m.phase !== 'play' || b.owner || b.y > 2.3) return;
    for (const id of s.flagged) {
      const q = this.byId.get(id);
      if (!q.active) continue;
      const dx = b.x - q.x, dz = b.z - q.z, d = Math.hypot(dx, dz);
      if (d > C.interfereDist) continue;
      const going = (dx * q.vx + dz * q.vz) / (d || 1) > 0.5 || q.ai.state === 'CHASE' || q.ai.state === 'RECEIVE';
      if (!going) continue;
      for (const o of m.players) {
        if (!o.active || o.team === q.team) continue;
        if (Math.hypot(b.x - o.x, b.z - o.z) < C.contestDist) { this.call(q, 'challenged an opponent for the ball'); return; }
      }
    }
  }

  // At a shot: is a man in an offside position standing in the keeper's line of vision?
  screening(p, flagged) {
    const m = this.m, b = m.ball, gk = m.keeper(1 - p.team);
    if (!gk || !flagged.size) return -1;
    const gx = m.oppGoalX(p.team);
    for (const id of flagged) {
      const q = this.byId.get(id);
      if (segDist2(q.x, q.z, b.x, b.z, gx, 0).d < C.screenDist && Math.hypot(q.x - gk.x, q.z - gk.z) < C.screenKeeper) return q.id;
    }
    return -1;
  }

  // A goal for scoringTeam: disallowed if a man in an offside position was blocking the
  // keeper's view of the shot (and nobody has touched it since). Returns true if called.
  goal(scoringTeam) {
    const s = this.snap;
    if (!this.enabled || !s || s.team !== scoringTeam || s.screen < 0) return false;
    this.call(this.byId.get(s.screen), "blocked the keeper's line of vision");
    return true;
  }

  // The flag goes up: indirect free kick to the defending side where he became involved.
  call(p, how) {
    const m = this.m, s = this.snap;
    this.snap = null; this.calls++;
    const spot = clampToField(p.x, p.z, 0.5);
    const passer = s ? this.byId.get(s.passer) : null;
    this.last = { t: m.time, pid: p.id, name: p.name, team: p.team, how, x: spot.x, z: spot.z, line: s ? s.line : null, passer: passer ? passer.name : null, at: s ? s.t : null };
    m.teams[p.team].stats.offsides++;
    if (C.log) console.log(`[offside] ${m.time.toFixed(2)}s OFFSIDE ${p.name}: ${how} (in an offside position when ${passer?.name ?? '?'} played it at ${s?.t.toFixed(2)}s; line x=${s?.line.toFixed(2)})`);
    m.emit({ type: 'offside', pid: p.id, team: p.team, x: spot.x, z: spot.z, line: s ? s.line : 0, how });
    m.beginRestart('FREE_KICK', 1 - p.team, spot, 'offside');
  }
}
