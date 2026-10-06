// =====================================================================
// SupportPositioningSystem + PassingTriangleSystem: when a side has the ball, the men
// around it make themselves options — a forward option, one on the diagonal, a safety
// ball behind, the weak side — so the carrier usually has two or three passes on, in
// triangles rather than in a line.
//
// Every team tick (and at once when the ball changes hands or a pass is played) the
// support is re-planned around the FOCUS: the carrier, or — with a pass on its way —
// where the receiver will take it, so the next triangle is forming before he has it.
//   1. Candidate spots ring the focus at each role's distance (closer when the carrier is
//      pressed, wider when he has space; footballMovementConfig.support).
//   2. Each spot is scored (footballMovementConfig.triangle): the pass gets there (an ETA
//      race against every opponent, not a line test) · space · forward progress · goal
//      danger · apart from team-mates · a different angle from the other options.
//   3. Roles are dealt out (every order tried; the best total, travel time counted) with
//      hysteresis, so nobody flickers between jobs.
// Spots are kept relative to the focus: the triangle moves with the ball between ticks.
// The triangles themselves are graded (Excellent … Blocked) for the debug view and tests.
// =====================================================================
import { footballMovementConfig as FM } from '../../config.js';
import { PITCH } from '../pitch.js';
import { clamp, lerp, angleDiff } from '../../util/math.js';
import { laneRisk, reachTime, threat } from './eval.js';
import { groundPassSpeed } from '../kicks.js';

const S = FM.support, TW = FM.triangle;
const ROLES = ['FORWARD', 'DIAGONAL', 'SAFETY', 'WEAK'];
export const ROLE_LABEL = { FORWARD: 'FWD OPTION', DIAGONAL: 'DIAGONAL', SAFETY: 'SAFETY', WEAK: 'WEAK SIDE', THIRD: 'THIRD MAN' };
const ANGLES = 16;

// How much each role cares about each part of a spot's score (× the triangle weights).
const ROLE_W = {
  FORWARD:  { lane: 1, space: 1, angle: 1, fwd: 2.4, spacing: 1, goal: 1.6 },
  DIAGONAL: { lane: 1.2, space: 1.1, angle: 1.3, fwd: 0.9, spacing: 1, goal: 0.9 },
  SAFETY:   { lane: 1.6, space: 1.3, angle: 1, fwd: -0.6, spacing: 1, goal: 0 },
  WEAK:     { lane: 0.9, space: 1.3, angle: 1.2, fwd: 0.5, spacing: 1.4, goal: 0.6 },
};

export class SupportSystem {
  constructor(m, ai) {
    this.m = m; this.ai = ai;
  }

  // Where the support forms around for team t: the carrier, or the receiving point of our
  // pass on its way. → { x, z, p (who'll have it), inFlight } or null.
  focus(t) {
    const m = this.m, b = m.ball, o = b.owner;
    if (o) return o.team === t ? { x: o.x, z: o.z, p: o, inFlight: false } : null;
    const P = m.reception.plan;
    if (P && P.receiver.team === t && m.reception.live()) {
      const pt = P.point || P.receiver;
      return { x: pt.x, z: pt.z, p: P.receiver, inFlight: true };
    }
    return null;
  }

  // How much room the carrier has: 0 pressed tight … 1 all the time in the world.
  freedom(t, f) {
    let d = 99;
    for (const q of this.m.players) if (q.active && q.team !== t) d = Math.min(d, Math.hypot(q.x - f.x, q.z - f.z));
    return clamp((d - S.pressureNear) / (S.pressureFar - S.pressureNear), 0, 1);
  }

  // ------------------------------------------------------------------ the plan (team tick)
  plan(t, T, exclude = new Set()) {
    const m = this.m, f = this.focus(t);
    const prev = T.support || new Map();
    T.support = new Map(); T.triangles = []; T.supportFocus = f;
    if (!f) return;
    const dir = m.teams[t].dir, k = this.freedom(t, f);
    T.freedom = k;
    const players = m.teamPlayers(t).filter(p => p !== f.p && p.line !== 'GK' && !exclude.has(p));
    if (!players.length) return;
    const roles = ROLES.slice(0, Math.min(ROLES.length, players.length));
    const mates = m.teamPlayers(t).filter(q => q.line !== 'GK');
    // Candidate spots per role, with everything about them that doesn't depend on who goes.
    const cands = {};
    for (const role of roles) cands[role] = this.candidates(t, f, role, k, dir);
    // each man's current spot stays a candidate for his current job (so he keeps it unless
    // something is clearly better — no flickering between jobs)
    for (const p of players) {
      const pr = prev.get(p.id);
      if (!pr || !cands[pr.role]) continue;
      const ex = PITCH.halfL - S.edge, ez = PITCH.halfW - S.edge;
      const c = this.spot(t, f, this.ai.onside(t, clamp(f.x + pr.off.x, -ex, ex)), clamp(f.z + pr.off.z, -ez, ez), pr.role, dir);
      if (c) cands[pr.role].push(c);
    }
    // Every way of dealing the roles out; each man takes his best spot for his role given
    // the spots already taken (angles, spacing). Best total wins.
    let best = null, keep = null;
    const prevOrder = roles.map(r => players.find(p => prev.get(p.id) && prev.get(p.id).role === r));
    const samePlayers = prevOrder.every(Boolean) && new Set(prevOrder).size === roles.length;
    for (const order of permutations(players)) {
      const chosen = [];
      let total = 0;
      for (let i = 0; i < roles.length; i++) {
        const p = order[i], role = roles[i];
        let pick = null;
        for (const c of cands[role]) {
          const sc = this.score(p, role, c, chosen, f, prev.get(p.id), T.anchors.get(p.id), mates);
          if (!pick || sc > pick.sc) pick = { ...c, sc, p, role };
        }
        if (pick) { chosen.push(pick); total += pick.sc; }
      }
      // the men without a role (more players than roles) aren't in a 5-a-side
      if (!best || total > best.total) best = { total, chosen };
      if (samePlayers && order.every((p, i) => i >= roles.length || p === prevOrder[i])) keep = { total, chosen };
    }
    // The jobs are only re-dealt when that's clearly better for the side as a whole.
    if (keep && best.total - keep.total < S.roleSwap) best = keep;
    for (const c of best.chosen) {
      T.support.set(c.p.id, { role: c.role, label: ROLE_LABEL[c.role], off: { x: c.x - f.x, z: c.z - f.z }, x: c.x, z: c.z, lane: c.lane, score: c.sc });
    }
    T.triangles = this.triangles(t, f, best.chosen);
  }

  candidates(t, f, role, k, dir) {
    const m = this.m, out = [];
    const band = role === 'FORWARD' ? S.forwardSupportDistance : role === 'SAFETY' ? S.safetyDistance : role === 'DIAGONAL' ? S.mediumSupportDistance : S.mediumSupportDistance;
    const r0 = lerp(band[0], band[1], k);
    const opp = m.players.filter(q => q.active && q.team !== t);
    for (const r of [r0, r0 * 0.78]) {
      for (let i = 0; i < ANGLES; i++) {
        const a = (i / ANGLES) * Math.PI * 2;
        const fwd = Math.cos(a);                 // relative to the attacking direction
        // the role's sector: forward ahead, safety behind, diagonals in between, weak side across
        if (role === 'FORWARD' && fwd < 0.35) continue;
        if (role === 'SAFETY' && fwd > -0.1) continue;
        if (role === 'DIAGONAL' && (fwd < -0.2 || fwd > 0.9)) continue;
        let x = f.x + dir * Math.cos(a) * r, z = f.z + Math.sin(a) * r;
        const ex = PITCH.halfL - S.edge, ez = PITCH.halfW - S.edge;
        if (Math.abs(z) > ez) continue;
        x = this.ai.onside(t, clamp(x, -ex, ex));
        const c = this.spot(t, f, x, z, role, dir, opp);
        if (c) out.push(c);
      }
    }
    return out;
  }

  // Everything about a spot that doesn't depend on who goes there (null: not a spot).
  spot(t, f, x, z, role, dir, opp = this.m.players.filter(q => q.active && q.team !== t)) {
    const m = this.m;
    if (Math.hypot(x - f.x, z - f.z) < 2.2) return null;
    // a defender standing on it isn't a spot
    let space = 99;
    for (const o of opp) space = Math.min(space, Math.hypot(o.x - x, o.z - z));
    if (space < 0.9) return null;
    // the pass from the focus: who gets to its line first (ETA race, not a line test)
    const lane = passLane(m, t, f, { x, z });
    // the weak side: across from where the ball is, wide
    const weak = role === 'WEAK' ? clamp(Math.abs(z - f.z) / (PITCH.halfW * 1.2), 0, 1) : 0;
    return {
      x, z, ang: Math.atan2(z - f.z, x - f.x),
      lane, space: clamp(space / 5, 0, 1),
      fwd: clamp(0.5 + (x - f.x) * dir / 14, 0, 1), goal: threat(m, t, x, z), weak,
    };
  }

  // One man's score for a spot in a role, given the options already taken.
  score(p, role, c, chosen, f, prev, anchor, mates = []) {
    const w = ROLE_W[role];
    // angle: a different line from the carrier than the other options (one doesn't screen the other)
    let sep = Math.PI;
    for (const o of chosen) sep = Math.min(sep, Math.abs(angleDiff(c.ang, o.ang)));
    const angle = sep < TW.minAngle ? -1 : clamp(sep / TW.preferredAngle, 0, 1);
    // spacing from the other supporters' spots, and from where team-mates (the carrier
    // too) actually are
    let gap = 99;
    for (const o of chosen) gap = Math.min(gap, Math.hypot(o.x - c.x, o.z - c.z));
    for (const q of mates) if (q !== p) gap = Math.min(gap, Math.hypot(q.x - c.x, q.z - c.z) + (q === f.p ? 0 : 0.8));
    const spacing = clamp(gap / S.minimumSpacing, 0, 1) - (gap < S.minimumSpacing * 0.6 ? 0.6 : 0);
    let s = TW.openLaneWeight * w.lane * c.lane + TW.spaceWeight * w.space * c.space + TW.angleWeight * w.angle * angle
      + TW.forwardWeight * w.fwd * c.fwd + TW.spacingWeight * w.spacing * spacing + TW.goalWeight * w.goal * c.goal
      + (role === 'WEAK' ? 0.15 * c.weak : 0);
    // a lane that's shut is barely an option at all
    if (c.lane < TW.laneOk * 0.6) s -= 0.15;
    // not in the carrier's way: off the line he's dribbling along for the next second and a half
    if (f.p && f.p.speed > 2 && !f.inFlight) {
      const ex = f.x + f.p.vx * 1.5, ez = f.z + f.p.vz * 1.5;
      const dx = ex - f.x, dz = ez - f.z, l2 = dx * dx + dz * dz;
      const u = clamp(((c.x - f.x) * dx + (c.z - f.z) * dz) / l2, 0, 1);
      const off = Math.hypot(c.x - (f.x + dx * u), c.z - (f.z + dz * u));
      if (off < 2.5) s -= 0.25 * (1 - off / 2.5);
    }
    // getting there takes time (and the ball moves on); and the team keeps its shape
    s -= S.travelWeight * reachTime(p, c.x, c.z, 0);
    if (anchor) s -= S.shapeWeight * Math.hypot(c.x - anchor.x, c.z - anchor.z);
    // hysteresis: his current job / spot is worth keeping unless something is clearly better
    if (prev && prev.role === role) {
      const px = f.x + prev.off.x, pz = f.z + prev.off.z;
      s += S.hysteresis * (0.5 + (Math.hypot(px - c.x, pz - c.z) < 1.5 ? 0.5 : 0));
    }
    return s;
  }

  // ------------------------------------------------------------------ triangles
  // Every triangle the carrier makes with two options: the angle between them seen from the
  // carrier, the lanes along its three sides, the distances → quality 0..1 and its grade.
  triangles(t, f, chosen) {
    const m = this.m, out = [];
    for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
      const A = chosen[i], B = chosen[j];
      const ang = Math.abs(angleDiff(A.ang, B.ang));
      const angQ = ang < TW.minAngle ? 0 : 1 - clamp(Math.abs(ang - TW.preferredAngle) / 1.6, 0, 1);
      const ab = passLane(m, t, A, B, 0.35);
      const fwd = A.role === 'FORWARD' || B.role === 'FORWARD', safe = A.role === 'SAFETY' || B.role === 'SAFETY';
      const q = clamp(0.3 * Math.min(A.lane, B.lane) + 0.15 * ab + 0.25 * angQ + 0.1 * (A.space + B.space) / 2 + 0.1 * (fwd ? 1 : 0) + 0.1 * (safe ? 1 : 0), 0, 1);
      out.push({ a: f, b: A, c: B, q, lanes: { ab: A.lane, ac: B.lane, bc: ab }, grade: grade(q, Math.max(A.lane, B.lane)) });
    }
    out.sort((x, y) => y.q - x.q);
    return out;
  }

  // The live spot for a supporter: his offset from where the focus is now.
  spotFor(p, T) {
    const s = T.support && T.support.get(p.id), f = this.focus(p.team);
    if (!s) return null;
    if (!f) return { x: s.x, z: s.z };
    const ex = PITCH.halfL - S.edge, ez = PITCH.halfW - S.edge;
    return { x: this.ai.onside(p.team, clamp(f.x + s.off.x, -ex, ex)), z: clamp(f.z + s.off.z, -ez, ez) };
  }

  // Options the carrier really has now: team-mates whose lane is open (ETA race).
  openOptions(t) {
    const m = this.m, o = m.ball.owner;
    if (!o || o.team !== t) return [];
    const out = [];
    for (const r of m.mates(o)) {
      if (r.line === 'GK') continue;
      const d = Math.hypot(r.x - o.x, r.z - o.z);
      if (d < 2 || d > 22) continue;
      const lane = passLane(m, t, o, r);
      if (lane >= TW.laneOk) out.push({ r, lane });
    }
    return out;
  }
}

// Is the pass from a to b on? 1 − the risk that someone cuts it out on the way (an ETA race
// along the ball's path, PassingSystem-style). The last metre or so — a marker contesting it
// as it arrives at b's feet — is a contested reception, not a lane that's shut: that's the
// spot's space, scored separately.
export const CONTEST = 1.2;
export function passLane(m, team, a, b, reaction = 0.2) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  if (d < 0.5) return 1;
  const k = Math.max(0.5, d - CONTEST) / d, end = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  const sp = clamp(groundPassSpeed(d, 6 + d * 0.2), 8, 19);
  return 1 - laneRisk(m, team, [{ x: a.x, z: a.z }, end], s => s / Math.max(sp * 0.8, 3), null, 0.6, reaction).risk;
}

export function grade(q, bestLane) {
  if (bestLane < 0.35) return 'Blocked';
  return q > 0.72 ? 'Excellent' : q > 0.58 ? 'Good' : q > 0.44 ? 'Neutral' : 'Poor';
}

function permutations(a) {
  if (a.length <= 1) return [a.slice()];
  const out = [];
  a.forEach((x, i) => { for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...rest]); });
  return out;
}
