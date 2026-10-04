// =====================================================================
// AI Director — two layers, both inspectable:
//  1) TEAM BRAIN (every 0.3 s): phase (ATTACK/DEFEND/LOOSE), shape anchors,
//     who presses, who marks whom, who chases, who makes the run.
//  2) PLAYER FSM (every ~0.18 s per agent, with a reaction delay):
//       IDLE · SUPPORT · RUN · RECEIVE · CHASE · PRESS · MARK · COVER · ATTACK
//     plus a separate KEEPER FSM: POSITION · SET · DIVE · CLAIM · DISTRIBUTE.
//     ATTACK is utility-scored: shoot / bank shot / pass / through ball /
//     wall pass / dribble / skill / shield.
// Difficulty changes reaction time, decision noise and press intensity only.
// =====================================================================
import { AI, footballGameplayConfig as GP, byDiff } from '../../config.js';
import { clamp } from '../../util/math.js';
import { predictPath } from '../ball.js';
import { maxSpeed } from '../players.js';
import { PITCH, clampToField, inKeeperArea } from '../pitch.js';
import { formationToWorld } from '../formations.js';
import { evalShots, evalPasses, evalDribble, frontDefender, pressure, reachTime, threat } from './eval.js';
import { aiRanges } from './ranges.js';

const TEAM_TICK = 0.3;
// Personal space between team-mates (m) and how hard it steers a run.
const SEPARATION = { radius: 1.5, weight: 1.1 };
// How dangerous a player is in the air (heading at set pieces).
const aerial = p => p.attrs.strength * 0.6 + p.attrs.shot * 0.4;
// The point k metres from a toward b.
const towards = (a, b, k) => { const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1; return { x: a.x + dx / d * k, z: a.z + dz / d * k }; };

export class AIDirector {
  constructor(m) {
    this.m = m;
    this.teamT = 0;
    this.team = [this.blankTeam(), this.blankTeam()];
    this.restartSpots = new Map();   // player id → spot for the set piece being taken
    this.R = aiRanges(m.cfg.rules);  // distances scaled to this match's pitch
  }
  // For telemetry: the scaled ranges in use.
  ranges() { const R = this.R; return { s: R.s, g: R.g, shot: Math.round(R.shot), pass: Math.round(R.groundPass), long: Math.round(R.longPass), threat: Math.round(R.threat) }; }
  blankTeam() { return { phase: 'LOOSE', presser: null, presser2: null, marks: new Map(), chasers: new Set(), runners: new Set(), anchors: new Map(), forcePress: false, gkRush: false, focus: null, cutter: null }; }

  get diff() { return this.m.opts.difficulty; }
  reaction() { return 0.06 + 0.32 * (1 - this.diff); }

  update(dt) {
    const m = this.m;
    this.teamT -= dt;
    if (this.teamT <= 0) {
      this.teamT = TEAM_TICK;
      this.teamThink(0); this.teamThink(1);
    }
    for (const p of m.players) {
      if (!p.active || p.human) continue;
      if (p.frozen) { this.stop(p); p.faceTarget = { x: m.ball.x, z: m.ball.z }; p.ai.label = 'WALL'; continue; }
      const ai = p.ai;
      ai.thinkT -= dt;
      if (ai.pending && (ai.pendingT -= dt) <= 0) { ai.state = ai.pending; ai.pending = null; }
      if (ai.thinkT <= 0) {
        ai.thinkT = AI.thinkInterval * (0.85 + this.m.rand() * 0.3);
        this.think(p);
      }
      this.act(p, dt);
    }
  }

  // ------------------------------------------------------------------ team brain
  teamThink(t) {
    const m = this.m, T = this.team[t], b = m.ball, o = b.owner;
    // A pass on its way is still that side's ball: they attack, the other side defends it.
    const fl = o ? null : m.passing.inFlight();
    const poss = o ? o.team : fl ? fl.passer.team : -1;
    T.phase = poss < 0 ? 'LOOSE' : poss === t ? 'ATTACK' : 'DEFEND';
    // Where the play is going, as this side sees it: the carrier; for our own pass, the man
    // it's for; for theirs, whoever we read it's for (from its line — no one is told).
    if (o) T.focus = { p: o, x: o.x, z: o.z };
    else if (fl && poss === t) T.focus = { p: fl.receiver, x: fl.intended.x, z: fl.intended.z };
    else if (fl) T.focus = m.intercepts.readTarget(t) || { p: null, x: b.x, z: b.z };
    else T.focus = null;
    if (!fl) T.cutter = null;
    const mates = m.teamPlayers(t);
    const dir = m.teams[t].dir;
    // An AI side fires its GAMEBREAKER when it has the ball in the attacking half.
    if (m.teams[t].gbReady && m.opts.humanTeam !== t && o && o.team === t && o.line !== 'GK' && o.x * dir > 1) m.activateGB(t);

    // Shape anchors: each player's formation spot (team-relative), stepped up or
    // dropped by his role for the phase, and the whole shape shifted toward the ball.
    const bu = (b.x * dir + PITCH.halfL) / PITCH.length;
    const bv = 0.5 + dir * b.z / PITCH.width;
    // In possession, the shape stays onside: nobody's spot is beyond the offside line
    // until the ball is played (runners go when it is).
    T.onside = T.phase === 'ATTACK' && m.offside.enabled ? m.offside.limit(t) - GP.offside.aiMargin : Infinity;
    T.anchors.clear();
    for (const p of mates) {
      let u = p.form.x, v = p.form.y;
      if (p.line !== 'GK') {
        const r = p.roleDef;
        u += T.phase === 'ATTACK' ? r.push : T.phase === 'DEFEND' ? -r.drop : 0;
        u += (bu - 0.5) * 0.5;
        // In possession wide roles hold their width (stretch the pitch); out of it the
        // whole shape shifts across with the ball.
        v += (bv - 0.5) * 0.35 * (T.phase === 'ATTACK' ? 1.25 - 0.5 * r.width : 1);
        // The last line holds; full-backs and wing-backs get forward more.
        if (p.line === 'DEF') u = Math.min(u, T.phase === 'ATTACK' ? 0.5 + 0.25 * (1 - r.hold) : 0.38);
        u = clamp(u, 0.1, 0.88);
      }
      const w = formationToWorld(u, clamp(v, 0.08, 0.92), dir);
      if (p.line !== 'GK') w.x = this.onside(t, w.x);
      T.anchors.set(p.id, w);
    }

    // Loose ball: the fastest to the ball chases (by predicted intercept time).
    T.chasers.clear();
    if (T.phase === 'LOOSE') {
      const ranked = mates.filter(p => p.line !== 'GK').map(p => [this.intercept(p).t, p]).sort((a, c) => a[0] - c[0]);
      if (ranked[0]) T.chasers.add(ranked[0][1]);
      if (ranked[1] && ranked[1][0] < ranked[0][0] + 0.5) T.chasers.add(ranked[1][1]);
    }

    // Defending: one presser, the rest mark greedily, the leftover covers.
    T.presser = null; T.marks.clear();
    if (T.phase === 'DEFEND') {
      const outfield = mates.filter(p => p.line !== 'GK');
      const f = T.focus;
      let best = null, bt = Infinity;
      for (const p of outfield) { if (p === T.cutter) continue; const tt = reachTime(p, f.x, f.z, 0); if (tt < bt) { bt = tt; best = p; } }
      // Nobody presses a keeper holding the ball.
      T.presser = o && o.line === 'GK' && b.inHands ? null : best;
      // Human asked for teammate pressure (or the human is already pressing and wants help).
      T.presser2 = null;
      if (T.forcePress) {
        let b2 = null, bt2 = Infinity;
        for (const p of outfield) { if (p.human || p === best) continue; const tt = reachTime(p, f.x, f.z, 0); if (tt < bt2) { bt2 = tt; b2 = p; } }
        if (best && best.human) T.presser2 = b2; else if (b2 && !best) T.presser = b2;
      }
      const attackers = m.teamPlayers(1 - t).filter(a => a !== f.p && a.line !== 'GK');
      const free = outfield.filter(p => p !== best && p !== T.presser2);
      const pairs = [];
      for (const d of free) for (const a of attackers) {
        const anc = T.anchors.get(d.id);
        pairs.push([Math.hypot(d.x - a.x, d.z - a.z) * 0.7 + Math.hypot(anc.x - a.x, anc.z - a.z) * 0.3, d, a]);
      }
      pairs.sort((x, y) => x[0] - y[0]);
      const usedD = new Set(), usedA = new Set();
      for (const [, d, a] of pairs) {
        if (usedD.has(d) || usedA.has(a)) continue;
        // Zonal formats: a man is picked up only when he's in your zone.
        const anc = T.anchors.get(d.id);
        if (Math.hypot(anc.x - a.x, anc.z - a.z) > this.R.markZone) continue;
        // The last line stays as the last line instead of chasing a man upfield.
        if (d.line === 'DEF' && (a.x - m.ownGoalX(t)) * dir > PITCH.halfL) continue;
        T.marks.set(d.id, a); usedD.add(d); usedA.add(a);
      }
    }

    // Attacking: one forward-thinking player makes a run in behind (by role: forwards,
    // wingers and wing-backs — never the back line).
    // (A pass in flight keeps the runs that were on when it was played.)
    if (!fl) T.runners.clear();
    if (T.phase === 'ATTACK' && o) {
      let best = null, bs = -Infinity;
      for (const p of mates) {
        if (p === o || p.line === 'GK' || p.roleDef.runs < 0.3) continue;
        const ahead = (p.x - o.x) * dir;
        if (ahead < -2) continue;
        const s = threat(m, t, p.x + dir * 4, p.z) - Math.max(0, 6 - ahead) * 0.01 + this.m.rand() * 0.05;
        if (s > bs) { bs = s; best = p; }
      }
      if (best && o.possessT > 0.4 && this.m.rand() < 0.55 + 0.3 * this.diff) T.runners.add(best);
    }
  }

  // The nearest spot just outside the keeper's area (goal at gx), clear by gkClear.
  outOfArea(p, gx) {
    const ka = PITCH.keeperArea, s = Math.sign(gx), c = GP.referee.gkClear + 0.6;
    if (ka.kind === 'arc') { const dx = p.x - gx, dz = p.z, d = Math.hypot(dx, dz) || 1, r = ka.radius + c; return { x: gx + dx / d * r, z: dz / d * r }; }
    const outX = gx - s * (ka.depth + c), outZ = Math.sign(p.z || 1) * (ka.width / 2 + c);
    // out the front, or out the side, whichever is nearer
    return Math.abs(p.x - outX) <= Math.abs(p.z - outZ) ? { x: outX, z: p.z } : { x: p.x, z: outZ };
  }

  // Keep a spot (world x) behind team t's offside line while it has the ball.
  onside(t, x) {
    const lim = this.team[t].onside, dir = this.m.teams[t].dir;
    return lim === Infinity || lim === undefined ? x : Math.min(x * dir, Math.max(lim, 0)) * dir;
  }

  // Where a player can meet the free ball, no higher than maxY (2.2 m: a header): from
  // his side's read of its path and after his reaction (see InterceptionSystem); exact
  // for the human's switching.
  intercept(p, maxY = 2.2, exact = false) { return this.m.intercepts.intercept(p, maxY, exact); }

  // After winning the ball back: the time to get it under control (worse with a poorer
  // touch) and look up before deciding (s).
  settleTime(p, touch = 0.6) {
    const d = this.diff, P = GP.possession;
    return byDiff(P.control, d) * (1.4 - 0.8 * touch) + byDiff(P.scan, d) * (1.15 - 0.3 * p.attrs.pass);
  }

  setState(p, s, immediate = false) {
    const ai = p.ai;
    if (ai.state === s) { ai.pending = null; return; }
    if (immediate) { ai.state = s; ai.pending = null; return; }
    if (ai.pending !== s) { ai.pending = s; ai.pendingT = this.reaction() * (0.7 + this.m.rand() * 0.6); }
  }

  // ------------------------------------------------------------------ player FSM
  think(p) {
    const m = this.m, b = m.ball, T = this.team[p.team], ai = p.ai;
    if (m.phase === 'restart') return this.restartThink(p);
    if (m.phase !== 'play') return;
    if (p.line === 'GK') return this.keeperThink(p);

    if (b.owner === p) { this.setState(p, 'ATTACK', true); return this.attackThink(p); }
    if (b.passTo === p) { this.setState(p, 'RECEIVE', true); return; }
    // Nobody re-thinks before he has picked up the last strike: until then he carries on.
    if (!m.intercepts.reacted(p)) { ai.label = ai.state; return; }
    // Their keeper has it in his hands: out of his area, nobody goes near him.
    const gk = m.referee.keeperHolding();
    if (gk && gk.team !== p.team) {
      const gx = m.ownGoalX(gk.team);
      if (inKeeperArea(p.x, p.z, gx, GP.referee.gkClear)) { this.setState(p, 'RETREAT', true); ai.spot = this.outOfArea(p, gx); ai.label = 'RETREAT'; return; }
      if (ai.state === 'PRESS' || ai.state === 'RETREAT') { this.setState(p, 'COVER', true); ai.label = 'COVER'; return; }
    }
    m.referee.aiTemper(p);

    if (T.phase === 'DEFEND' && !b.owner) {
      // An opponent's pass in flight: one man goes to cut it out where he can beat the
      // ball to its line (by his read of it); a better-placed one can take over.
      const ic = m.intercepts.intercept(p);
      if (ic.feasible && ic.t < 1.8) {
        const cur = T.cutter && T.cutter !== p ? m.intercepts.intercept(T.cutter) : null;
        if (!cur || !cur.feasible || ic.t < cur.t - 0.15) T.cutter = p;
      } else if (T.cutter === p) T.cutter = null;
      if (T.cutter === p) { this.setState(p, 'CHASE', true); ai.label = 'CUT OUT'; return; }
    }

    if (T.phase === 'LOOSE') {
      if (T.chasers.has(p)) this.setState(p, 'CHASE', b.lastKick && b.lastKick.team !== p.team);
      else this.setState(p, 'SUPPORT');
    } else if (T.phase === 'ATTACK') {
      this.setState(p, T.runners.has(p) ? 'RUN' : 'SUPPORT');
      if (ai.state === 'SUPPORT' || ai.pending === 'SUPPORT') ai.spot = this.supportSpot(p);
      if (ai.state === 'RUN' || ai.pending === 'RUN') ai.spot = this.runSpot(p);
    } else {
      if (T.presser === p || T.presser2 === p) this.setState(p, 'PRESS', T.presser2 === p);
      else if (T.marks.has(p.id)) { this.setState(p, 'MARK'); ai.mark = T.marks.get(p.id); }
      else this.setState(p, 'COVER');
    }
    ai.label = ai.state;
  }

  supportSpot(p) {
    const m = this.m, b = m.ball, T = this.team[p.team];
    const anc = T.anchors.get(p.id) || { x: p.x, z: p.z };
    const carrier = b.owner;
    let best = anc, bs = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = this.R.support[i % 2 ? 0 : 1];
      const x = clamp(anc.x + Math.cos(a) * r, -PITCH.halfL + 1.2, PITCH.halfL - 1.2);
      const z = clamp(anc.z + Math.sin(a) * r, -PITCH.halfW + 1.2, PITCH.halfW - 1.2);
      let open = 99;
      for (const o of m.opponents(p)) open = Math.min(open, Math.hypot(o.x - x, o.z - z));
      let spacing = 99;
      for (const q of m.mates(p)) if (q !== carrier) spacing = Math.min(spacing, Math.hypot(q.x - x, q.z - z));
      let lane = 1;
      if (carrier) {
        const dc = Math.hypot(x - carrier.x, z - carrier.z);
        if (dc < this.R.lane[0] || dc > this.R.lane[1]) lane = 0.3;
        for (const o of m.opponents(p)) {
          const dx = x - carrier.x, dz = z - carrier.z, l2 = dx * dx + dz * dz;
          const tt = clamp(((o.x - carrier.x) * dx + (o.z - carrier.z) * dz) / l2, 0, 1);
          const dd = Math.hypot(o.x - (carrier.x + dx * tt), o.z - (carrier.z + dz * tt));
          if (dd < 1.2) lane *= 0.4;
        }
      }
      const s = clamp(open / 5, 0, 1) * 0.5 + threat(m, p.team, x, z) * 0.9 + lane * 0.4 + clamp(spacing / 5, 0, 1) * 0.25 - Math.hypot(x - anc.x, z - anc.z) * 0.02;
      if (s > bs) { bs = s; best = { x, z }; }
    }
    return { x: this.onside(p.team, best.x), z: best.z };
  }

  runSpot(p) {
    const m = this.m, dir = m.teams[p.team].dir, ai = p.ai;
    const x = clamp(p.x + dir * this.R.run, -PITCH.halfL + 3, PITCH.halfL - 3);
    let z = clamp(p.z * 0.6, -PITCH.halfW + 2, PITCH.halfW - 2);
    const ox = this.onside(p.team, x);
    if (ox !== x) {
      // Held by the offside line: on the shoulder of the last man, curving across it rather
      // than standing on it — so he's already going when the ball is played.
      if (!ai.runSide || Math.abs(p.z - ai.runZ) < 1.2) {
        ai.runSide = -(ai.runSide || Math.sign(p.z) || 1);
        ai.runZ = clamp(p.z + ai.runSide * 6, -PITCH.halfW + 3, PITCH.halfW - 3);
      }
      z = ai.runZ;
    } else ai.runSide = 0;
    return { x: ox, z };
  }

  // Utility-scored decision for the ball carrier.
  attackThink(p) {
    const m = this.m, b = m.ball, ai = p.ai, T = this.team[p.team];
    if (b.inHands) return;
    if (p.action) return;
    const press = pressure(m, p);
    const opts = [];
    const shot = evalShots(m, p);
    if (shot) opts.push(shot);
    const passes = evalPasses(m, p, T.runners);
    opts.push(...passes.slice(0, 3));
    const drib = evalDribble(m, p);
    if (drib) opts.push(drib);

    // Skill moves when a defender is square in front.
    const fd = frontDefender(m, p, 2.6);
    if (fd && (ai.skillCD || 0) <= 0) {
      const sk = p.attrs.skill;
      const choices = [];
      if (fd.dist < 2.4 && fd.dist > 1.0) choices.push(['panna', sk * 0.3 - 0.06]);
      choices.push(['stepover', 0.04 + sk * 0.2]);
      if (fd.dist < 1.6) choices.push(['roulette', sk * 0.24]);
      if (fd.dist < 1.3) choices.push(['dragback', 0.04 + sk * 0.14]);
      if (fd.dist > 1.3) choices.push(['rainbow', sk * 0.2 - 0.08]);
      for (const [name, u] of choices) opts.push({ kind: 'skill', name, u: u + (drib ? Math.max(0, drib.u) * 0.3 : 0), label: name.toUpperCase() });
    }
    // Shielding buys a moment, not a strategy: it gets less attractive the longer it
    // lasts, and a turn out of it (roulette / drag-back) gets more attractive.
    const shieldT = ai.shieldAt != null ? m.time - ai.shieldAt : 0;
    if (press < 1.3) opts.push({ kind: 'shield', u: 0.02 - 0.05 * shieldT, label: 'SHIELD' });
    if (shieldT > 0.8 && (ai.skillCD || 0) <= 0) {
      const sk = p.attrs.skill;
      opts.push({ kind: 'skill', name: 'roulette', u: 0.04 + sk * 0.12 + 0.04 * shieldT, label: 'ROULETTE' });
      opts.push({ kind: 'skill', name: 'dragback', u: 0.03 + sk * 0.08 + 0.04 * shieldT, label: 'DRAG BACK' });
    }

    // Just won it back: get it under control and look up before deciding (no instant
    // counter). Until then he keeps it — carries it, shields it — or, pressed hard, plays a
    // safe pass.
    if (ai.wonAt != null && m.time - ai.wonAt < ai.wonFor) {
      const scanning = m.time - ai.wonAt > ai.wonFor * 0.45;
      const keep = opts.filter(o => o.kind === 'dribble' || o.kind === 'shield' || ((scanning || press < 1.2) && o.kind === 'pass' && o.risk < GP.possession.safeRisk));
      // Carry it away from the nearest opponent (protect it) rather than stand on it.
      let near = null, nd = 99;
      for (const o of m.opponents(p)) { const dd = Math.hypot(o.x - p.x, o.z - p.z); if (dd < nd) { nd = dd; near = o; } }
      if (near && nd < 4) keep.push({ kind: 'dribble', angle: Math.atan2(p.z - near.z, p.x - near.x), u: 0.06, label: 'PROTECT' });
      opts.length = 0; opts.push(...keep);
      ai.label = scanning ? 'SCAN' : 'CONTROL';
    } else ai.wonAt = null;

    // Decision noise scales with difficulty (lower difficulty = sloppier choices).
    const noise = 0.1 * (1 - this.diff);
    for (const o of opts) o.score = o.u + (this.m.rand() - 0.5) * 2 * noise;
    opts.sort((a, c) => c.score - a.score);
    ai.options = opts.slice(0, 4).map(o => ({ label: o.label, u: +o.u.toFixed(2) }));
    const best = opts[0];
    if (!best) return;

    // Carriers need a beat to settle unless under pressure (first-time play).
    const settle = press < 1.8 ? 0.12 : 0.28;
    if (p.possessT < settle && best.kind !== 'dribble') return;

    ai.why = best.label;
    ai.plan = best;
    p.closeControl = false;
    if (best.kind === 'shield') { if (ai.shieldAt == null) ai.shieldAt = m.time; }
    else ai.shieldAt = null;
    switch (best.kind) {
      case 'shoot': {
        const aim = best.bank
          ? { mode: 'assist', bank: true, angle: best.angle, tz: best.tz, ty: 0.4, power: 0.85 + 0.12 * this.diff }
          : m.isGB(p.team)
            ? { mode: 'assist', tz: Math.sign(best.tz || 1) * 1.2, ty: 0.5 + this.m.rand() * 0.9, power: 0.95 }   // GAMEBREAKER: into the corner
            : { mode: 'assist', tz: best.tz, ty: 0.4 + this.m.rand() * 0.8, power: 0.8 + 0.18 * this.diff, finesse: p.attrs.shot > 0.9 && this.m.rand() < 0.3 && Math.abs(best.tz) > 1 };
        if (m.requestShot(p, aim)) ai.pop = { text: best.label, t: 1.2 };
        break;
      }
      case 'pass': case 'through':
        if (m.requestKick(p, best.kind, { receiver: best.r })) ai.pop = { text: best.label, t: 1 };
        break;
      case 'lob':
        if (m.requestKick(p, 'lob', { receiver: best.r, target: best.lead })) ai.pop = { text: best.label, t: 1 };
        break;
      case 'wallpass':
        if (m.requestKick(p, 'pass', { receiver: best.r, angle: best.angle, speed: best.speed })) ai.pop = { text: 'WALL PASS', t: 1.2 };
        break;
      case 'skill':
        if (m.requestSkill(p, best.name, this.m.rand() - 0.5, this.m.rand() - 0.5)) { ai.skillCD = 2.2 + this.m.rand() * 2; ai.pop = { text: best.label, t: 1 }; }
        break;
      case 'shield':
        p.closeControl = true;
        break;
      default:
        ai.dribbleAngle = best.angle;
    }
  }

  // ------------------------------------------------------------------ steering (every tick)
  act(p, dt) {
    const m = this.m, b = m.ball, ai = p.ai;
    if (ai.pop) { ai.pop.t -= dt; if (ai.pop.t <= 0) ai.pop = null; }
    if (ai.skillCD > 0) ai.skillCD -= dt;
    p.faceTarget = null; p.jockey = false; p.sprinting = false;
    if (m.phase === 'restart') return this.restartAct(p);
    if (m.phase !== 'play') { this.stop(p); return; }
    if (p.line === 'GK') return this.keeperAct(p, dt);
    const T = this.team[p.team];
    const d = this.diff;

    switch (ai.state) {
      case 'ATTACK': {
        if (b.owner !== p) { this.stop(p); break; }
        const ang = ai.dribbleAngle ?? Math.atan2(-p.z, m.oppGoalX(p.team) - p.x);
        const press = pressure(m, p);
        if (p.closeControl) {
          // Shield: turn the back on the nearest defender.
          let near = null, nd = 99;
          for (const o of m.opponents(p)) { const dd = Math.hypot(o.x - p.x, o.z - p.z); if (dd < nd) { nd = dd; near = o; } }
          if (near) p.faceTarget = { x: p.x * 2 - near.x, z: p.z * 2 - near.z };
          this.go(p, Math.cos(ang), Math.sin(ang), 1.5);
        } else {
          const sprint = press > 2.5 && p.stamina > 0.3;
          p.sprinting = sprint;
          this.go(p, Math.cos(ang), Math.sin(ang), maxSpeed(p, sprint) * 0.95);
        }
        break;
      }
      case 'RECEIVE': {
        // A lofted ball with nobody near him: wait for it to drop to chest height.
        const ic = this.intercept(p, m.nearestOpponent(p) > 3 ? 1.3 : 2.2);
        this.goTo(p, ic.x, ic.z, maxSpeed(p, true), 0.2);
        p.sprinting = true;
        this.planTouch(p, ic);
        break;
      }
      case 'CHASE': {
        const ic = this.intercept(p);
        p.sprinting = true;
        this.goTo(p, ic.x, ic.z, maxSpeed(p, true) * (0.85 + 0.15 * d), 0.1);
        // Cutting out their pass: kill it (cushion) — get it under control first. A loose
        // ball: the usual first-touch plan.
        if (T.cutter === p) { p.cushion = true; p.touchDir = null; } else this.planTouch(p, ic);
        break;
      }
      case 'SUPPORT': case 'RUN': {
        const s = ai.spot || T.anchors.get(p.id);
        const far = Math.hypot(s.x - p.x, s.z - p.z) > 5;
        p.sprinting = ai.state === 'RUN' || far;
        this.goTo(p, s.x, s.z, maxSpeed(p, p.sprinting) * (ai.state === 'RUN' ? 1 : 0.8), 0.6);
        if (!p.speed || p.speed < 0.5) p.faceTarget = { x: b.x, z: b.z };
        break;
      }
      case 'PRESS': {
        // The carrier — or, with a pass on its way, the man we read it's for: get to him as
        // it arrives. (Before he's read it, he carries on as he was.)
        const o = b.owner || (T.focus && T.focus.p && T.focus.p.team !== p.team ? T.focus.p : null);
        if (!o) break;
        const g = { x: m.ownGoalX(p.team), z: 0 };
        const gx = g.x - o.x, gz = g.z - o.z, gl = Math.hypot(gx, gz) || 1;
        const dist = Math.hypot(o.x - p.x, o.z - p.z);
        const standoff = 1.05;
        let tx = o.x + gx / gl * standoff + o.vx * 0.15, tz = o.z + gz / gl * standoff + o.vz * 0.15;
        // Tight press time builds patience into commitment.
        ai.pressT = dist < 1.8 ? (ai.pressT || 0) + dt : 0;
        if (o.closeControl && dist < 2.2) {
          // He's shielding: work round his body to the ball side instead of waiting.
          const bx = b.x - o.x, bz = b.z - o.z, bl = Math.hypot(bx, bz) || 1;
          const side = ((p.x - o.x) * -bz + (p.z - o.z) * bx) >= 0 ? 1 : -1;
          tx = b.x + (-bz / bl * side) * 0.55 + (bx / bl) * 0.15;
          tz = b.z + (bx / bl * side) * 0.55 + (bz / bl) * 0.15;
        }
        if (dist < 3.2) { p.jockey = true; p.faceTarget = { x: b.x, z: b.z }; }
        p.sprinting = dist > 3;
        const sp = maxSpeed(p, dist > 3) * (0.75 + 0.3 * d);
        this.goTo(p, tx, tz, p.jockey ? sp * 0.8 : sp, 0.15);
        // Tackle when the ball is exposed or on a timer scaled by difficulty.
        const bd = Math.hypot(b.x - p.x, b.z - p.z);
        const exposed = Math.hypot(b.x - o.x, b.z - o.z) > 0.62;
        // (Never on a keeper's ball, and not through the back of a man unless he's reckless.)
        const may = b.owner === o && m.referee.aiWillChallenge(p, o);
        if (may && (bd < 1.25 || (dist < 1.3 && ai.pressT > 1.2)) && !p.action && p.stun <= 0) {
          const rate = (exposed ? 3.5 : 0.8) * (0.4 + 0.9 * d) * (1 + Math.max(0, ai.pressT - 1));
          if (this.m.rand() < rate * dt) m.requestTackle(p);
        }
        // Last-ditch slide when the carrier is getting away toward goal.
        const away = Math.hypot(o.x - g.x, o.z) < Math.hypot(p.x - g.x, p.z);
        if (may && away && bd < 2.4 && bd > 1.2 && o.speed > 4 && !p.action && this.m.rand() < 0.9 * d * dt * p.attrs.tackle) {
          p.facing = p.heading = Math.atan2(b.z + b.vz * 0.2 - p.z, b.x + b.vx * 0.2 - p.x);
          m.requestSlide(p);
        }
        break;
      }
      case 'MARK': {
        const a = T.marks.get(p.id) || ai.mark;
        if (!a || !a.active) { this.stop(p); break; }
        // Goal-side of the man, shaded into the lane between him and the ball (more so on
        // a higher level).
        const g = { x: m.ownGoalX(p.team), z: 0 };
        const gx = g.x - a.x, gz = g.z - a.z, gl = Math.hypot(gx, gz) || 1;
        const lx = b.x - a.x, lz = b.z - a.z, ll = Math.hypot(lx, lz) || 1;
        const lane = Math.min(GP.defending.laneMax, ll * byDiff(GP.defending.lane, d));
        let tx = a.x + gx / gl * 1.5 * (1 - lane / 4) + lx / ll * lane, tz = a.z + gz / gl * 1.5 * (1 - lane / 4) + lz / ll * lane;
        // We read the ball as his: close him down to meet it with him (not a magic step
        // into a lane we can't reach — cutting it out is the CUT OUT state's job).
        if (!b.owner && T.focus && T.focus.p === a) {
          tx = a.x + gx / gl * 0.9; tz = a.z + gz / gl * 0.9; p.sprinting = true;
        }
        this.goTo(p, tx, tz, maxSpeed(p, p.sprinting || Math.hypot(tx - p.x, tz - p.z) > 4), 0.3);
        if (p.speed < 1) p.faceTarget = { x: b.x, z: b.z };
        break;
      }
      case 'RETREAT': {
        const s = ai.spot || T.anchors.get(p.id);
        this.goTo(p, s.x, s.z, maxSpeed(p, false), 0.3);
        p.faceTarget = { x: b.x, z: b.z };
        break;
      }
      case 'COVER': {
        const g = { x: m.ownGoalX(p.team), z: 0 };
        const k = 0.38;
        const tx = g.x + (b.x - g.x) * k, tz = (b.z - g.z) * k * 0.8;
        const minOut = PITCH.boxR + 0.8;
        const dg = Math.hypot(tx - g.x, tz);
        const s = dg < minOut ? minOut / (dg || 1) : 1;
        this.goTo(p, g.x + (tx - g.x) * s, tz * s, maxSpeed(p, false), 0.4);
        if (p.speed < 1) p.faceTarget = { x: b.x, z: b.z };
        break;
      }
      default: {
        const s = T.anchors.get(p.id);
        if (s) this.goTo(p, s.x, s.z, maxSpeed(p, false) * 0.8, 0.5);
        else this.stop(p);
        if (p.speed < 1) p.faceTarget = { x: b.x, z: b.z };
      }
    }
  }

  // First-touch plan for a receiver: cushion it under pressure, otherwise take it
  // forward into the space toward goal.
  planTouch(p, ic) {
    const m = this.m;
    let near = 99;
    for (const o of m.opponents(p)) near = Math.min(near, Math.hypot(o.x - ic.x, o.z - ic.z));
    p.cushion = near < 2.6;
    if (p.cushion) { p.touchDir = null; return; }
    const gx = m.oppGoalX(p.team), dx = gx - ic.x, dz = -ic.z * 0.6, d = Math.hypot(dx, dz) || 1;
    p.touchDir = { x: dx / d, z: dz / d };
  }

  go(p, dx, dz, speed) { p.move.x = dx; p.move.z = dz; p.move.speed = speed; }
  stop(p) { p.move.x = 0; p.move.z = 0; p.move.speed = 0; }
  // spaced: steer off team-mates in his personal space (not on a set-piece spot: a wall
  // stands shoulder to shoulder).
  goTo(p, x, z, speed, tol = 0.3, spaced = true) {
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    const sep = spaced ? this.separation(p) : { x: 0, z: 0, m: 0 };
    if (d < tol) {
      // At his spot, but crowding a team-mate: ease out of the way.
      if (sep.m > 0.25) this.go(p, sep.x / sep.m, sep.z / sep.m, 1.2 * sep.m); else this.stop(p);
      return;
    }
    // Head for the spot, steered off any team-mate in his personal space.
    const hx = dx / d + sep.x * SEPARATION.weight, hz = dz / d + sep.z * SEPARATION.weight, hl = Math.hypot(hx, hz) || 1;
    this.go(p, hx / hl, hz / hl, Math.min(speed, 0.6 + d * 2.6));
  }

  // Reynolds separation: a push away from each team-mate inside the personal-space radius,
  // stronger the closer he is. Opponents are left alone (marking is meant to be tight).
  separation(p) {
    let x = 0, z = 0;
    const R = SEPARATION.radius;
    for (const q of this.m.players) {
      if (q === p || q.team !== p.team || !q.active) continue;
      const ox = p.x - q.x, oz = p.z - q.z, dd = Math.hypot(ox, oz);
      if (dd >= R || dd < 1e-4) continue;
      const w = (R - dd) / R / dd;
      x += ox * w; z += oz * w;
    }
    return { x, z, m: Math.hypot(x, z) };
  }

  // ------------------------------------------------------------------ keeper FSM
  keeperThink(p) {
    const m = this.m, b = m.ball, ai = p.ai;
    const gx = m.ownGoalX(p.team), dir = m.teams[p.team].dir;
    if (b.owner === p) {
      ai.state = 'DISTRIBUTE';
      if (p.possessT > 0.9 && !p.action) {
        const passes = evalPasses(m, p).filter(o => o.kind === 'pass' && o.risk < 0.35);
        if (passes.length && passes[0].u > -0.4) {
          if (b.inHands) m.requestKick(p, 'throw', { receiver: passes[0].r });
          else m.requestKick(p, 'pass', { receiver: passes[0].r });
          ai.pop = { text: 'DISTRIBUTE', t: 1 };
        } else if (p.possessT > 1.8) {
          m.requestKick(p, 'clear', { target: { x: dir * this.R.clear.x, z: (this.m.rand() - 0.5) * this.R.clear.z } });
          ai.pop = { text: 'CLEAR', t: 1 };
        }
      }
      ai.label = ai.state;
      return;
    }
    // Loose ball near goal and we'd get there first: claim it.
    if (!b.owner) {
      const inBox = Math.hypot(b.x - gx, b.z) < PITCH.boxR + 1;
      if (inBox && Math.hypot(b.vx, b.vz) < 9) {
        const mine = this.intercept(p).t;
        let theirs = Infinity;
        for (const o of m.opponents(p)) theirs = Math.min(theirs, this.intercept(o).t);
        if (mine < theirs - 0.05) { ai.state = 'CLAIM'; ai.label = ai.state; return; }
      }
    }
    if (ai.state !== 'DIVE') ai.state = b.owner && b.owner.team !== p.team && Math.hypot(b.x - gx, b.z) < this.R.keeperSet ? 'SET' : 'POSITION';
    ai.label = ai.state;
  }

  keeperAct(p, dt) {
    const m = this.m, b = m.ball, ai = p.ai;
    const gx = m.ownGoalX(p.team), dir = m.teams[p.team].dir;
    p.faceTarget = { x: b.x, z: b.z };
    if (p.action && p.action.type === 'dive') { ai.state = 'DIVE'; ai.label = 'DIVE'; return; }
    if (ai.state === 'DIVE') ai.state = 'POSITION';

    // Shot detection → dive or step across.
    if (!b.owner && this.shotIncoming(p)) return;

    if (ai.state === 'DISTRIBUTE') {
      this.goTo(p, gx + dir * 1.2, p.z * 0.5, 2, 0.3);
      p.faceTarget = { x: 0, z: 0 };
      return;
    }
    if (ai.state === 'CLAIM') {
      const ic = this.intercept(p);
      this.goTo(p, ic.x, ic.z, maxSpeed(p, true), 0.05);
      return;
    }
    // Position on the ball–goal line; come out further when the ball is far.
    // While a strike is in flight he only half-follows it (no perfect tracking).
    const inFlight = !b.owner && Math.hypot(b.vx, b.vz) > 12;
    const bx = b.x - gx, bz = inFlight ? b.z * 0.45 + (ai.setZ ?? b.z) * 0.55 : b.z, bl = Math.hypot(bx, bz) || 1;
    if (!inFlight) ai.setZ = b.z;
    const out = clamp(0.5 + bl * 0.09, 0.6, this.R.keeperOut[ai.state === 'SET' ? 0 : 1]);
    let tx = gx + bx / bl * out, tz = bz / bl * out;
    tz = clamp(tz, -PITCH.goalHalfW + 0.25, PITCH.goalHalfW - 0.25);
    // 1v1: rush to narrow the angle.
    const o = b.owner;
    if (o && o.team !== p.team && this.team[p.team].gkRush) {
      // Human held "rush keeper": come off the line at the carrier.
      this.goTo(p, o.x, o.z, maxSpeed(p, true), 0.2); ai.label = 'RUSH'; return;
    }
    if (o && o.team !== p.team && Math.hypot(o.x - gx, o.z) < PITCH.boxR && (o.x - gx) * dir < this.R.rush) {
      tx = gx + (o.x - gx) * 0.55; tz = o.z * 0.55; ai.label = 'RUSH';
    }
    const sp = ai.state === 'SET' ? 3.5 : 5;
    this.goTo(p, tx, tz, sp, 0.08);
  }

  shotIncoming(p) {
    const m = this.m, b = m.ball, ai = p.ai;
    const gx = m.ownGoalX(p.team), dir = m.teams[p.team].dir;
    const vTo = -b.vx * dir;                     // speed toward our goal
    if (vTo < 5 || Math.hypot(b.vx, b.vz) < 7) return false;
    const kick = b.lastKick;
    // A redirected ball (off the cage, a post, a deflection) is a new read for the keeper.
    const t0 = Math.max(kick ? kick.t : -1, b.redirectT || -1);
    const key = t0;
    if (ai.diveFor === key) return true;
    const pred = predictPath(b, 1.4, 1 / 60);
    // Where does it cross the keeper's line (his x)?
    let cross = null;
    for (let i = 1; i < pred.pts.length; i++) {
      const A = pred.pts[i - 1], B = pred.pts[i];
      if ((A.x - p.x) * (B.x - p.x) <= 0 && A.x !== B.x) {
        const t = (p.x - A.x) / (B.x - A.x);
        cross = { y: A.y + (B.y - A.y) * t, z: A.z + (B.z - A.z) * t, t: (i - 1 + t) / 60 };
        break;
      }
    }
    const onTarget = pred.goal === -dir || (cross && Math.abs(cross.z) < PITCH.goalHalfW + 0.3 && cross.y < PITCH.goalH + 0.2);
    if (!onTarget || !cross) return false;
    // A keeper reads the line the ball is on, not the physics engine: if it's going
    // to hit the cage first, he can't know the rebound until he's seen it.
    if (pred.events.some(e => (e.type === 'wall' || e.type === 'post') && e.t < cross.t)) return false;
    // Reaction time: difficulty + keeping, slower against a GAMEBREAKER team.
    // Deflections and cage rebounds are notoriously hard for keepers: he's already
    // moving for the original line, so the re-read costs an extra beat.
    const redirected = (b.redirectT || -1) > (kick ? kick.t : -1);
    // A GAMEBREAKER strike leaves the keeper a beat late and heavy-footed.
    const gbShot = m.isGB(1 - p.team) && kick && kick.team !== p.team;
    const react = 0.1 + 0.18 * (1 - this.diff) + (1 - p.attrs.keeping) * 0.12 + (gbShot ? 0.07 : 0) + (redirected ? 0.2 : 0);
    const since = m.time - (t0 > 0 ? t0 : m.time);
    ai.label = 'SET';
    if (since < react) { this.stop(p); return true; }
    // Keepers read a rebound off the mesh like a mirror bounce, but the cage sends it
    // off flatter (tan θ' = (et/e)·tan θ), so it arrives nearer the wall side than he
    // expects. Better keepers (and higher difficulty) misread it less.
    let readZ = cross.z;
    if (redirected && b.wallHits > 0) {
      const err = (0.75 - 0.3 * this.diff) * (1.2 - 0.6 * p.attrs.keeping);
      readZ += Math.sign(b.vz || 1) * err;
    }
    const lateral = readZ - p.z;
    if (Math.abs(lateral) < 0.45 && cross.y < 1.9) {
      // Right at him: shuffle across and let the hands do it.
      this.goTo(p, p.x, readZ, 4, 0.02);
      return true;
    }
    // Don't commit early: a keeper who dives with the ball still 0.7 s out is on the
    // floor when it arrives. Shuffle across, get set, and dive when it's close.
    const diveAt = 0.34 + Math.min(0.22, Math.abs(lateral) * 0.09);
    if (cross.t > diveAt && Math.abs(lateral) < 3.2) {
      this.goTo(p, p.x, readZ, 3.2, 0.05);
      return true;
    }
    if (Math.abs(lateral) < 3.2 && cross.t > 0.05) {
      ai.diveFor = key;
      // Caught still moving across: the push-off is weaker.
      const planted = p.speed < 1.2 ? 1 : 0.88;
      m.requestDive(p, p.x - dir * 0.1, readZ + Math.sign(lateral) * 0.25, cross.y > 1.1, (redirected ? 0.8 : 1) * planted * (gbShot ? 0.86 : 1));
      ai.state = 'DIVE'; ai.label = 'DIVE';
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ set pieces
  // Where everyone stands for a restart, decided once when the ball is placed (and the
  // broadcast cut puts them there). Anyone without a set-piece job keeps his shape —
  // his anchor, with the ball on its spot and the taker in possession.
  planRestart(r) {
    const m = this.m, spots = this.restartSpots;
    spots.clear();
    this.teamThink(0); this.teamThink(1);
    if (r.type === 'THROW_IN') this.throwInSpots(r, spots);
    else if (r.type === 'CORNER') this.cornerSpots(r, spots);
    else if (r.type === 'GOAL_KICK') this.goalKickSpots(r, spots);
    else if (r.type === 'PENALTY') this.penaltySpots(r, spots);
    else if (r.type === 'FREE_KICK' && r.direct) this.wallSpots(r, spots);
    for (const p of m.players) {
      if (!p.active || p === r.taker) continue;
      const s = spots.get(p.id) || this.team[p.team].anchors.get(p.id);
      p.x = s.x; p.z = s.z;
      p.vx = p.vz = p.speed = 0; p.action = null; p.stun = 0;
      p.heading = p.facing = Math.atan2(m.ball.z - p.z, m.ball.x - p.x);
      p.ai.state = p.line === 'GK' ? 'POSITION' : 'IDLE'; p.ai.pending = null; p.ai.diveFor = null;
      p.ai.label = r.wall && spots.has(p.id) && p.team !== r.team && r.type === 'FREE_KICK' ? 'WALL' : 'SET PIECE';
    }
  }

  // Throw-in: two team-mates show for it — one down the line, one inside — and the
  // nearest opponents pick them up goal-side.
  throwInSpots(r, spots) {
    const m = this.m, sp = r.spot, side = Math.sign(sp.z), dir = m.teams[r.team].dir;
    const near = q => Math.hypot(q.x - sp.x, q.z - sp.z);
    const mates = m.teamPlayers(r.team).filter(q => q !== r.taker && q.line !== 'GK').sort((a, c) => near(a) - near(c));
    const offers = [{ x: sp.x + dir * 7, z: sp.z - side * 3 }, { x: sp.x - dir * 2, z: sp.z - side * 9 }].map(o => clampToField(o.x, o.z, 1.5));
    const opps = m.teamPlayers(1 - r.team).filter(q => q.line !== 'GK');
    const gx = m.ownGoalX(1 - r.team);
    offers.forEach((o, i) => {
      const q = mates[i];
      if (!q) return;
      spots.set(q.id, o);
      const mk = opps.filter(d => !spots.has(d.id)).sort((a, c) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(c.x - o.x, c.z - o.z))[0];
      if (mk) spots.set(mk.id, towards(o, { x: gx, z: 0 }, 1.3));
    });
  }

  // Corner: the attackers best in the air go to the near post, far post, penalty spot,
  // the front of the six-yard box and the edge of the area; the deepest one or two stay
  // back. Defenders mark them goal-side, one guards the near post, one stays up.
  cornerSpots(r, spots) {
    const m = this.m, sp = r.spot, s = Math.sign(sp.x), zs = Math.sign(sp.z) || 1;
    const gx = s * PITCH.halfL, box = PITCH.boxR, gw = PITCH.goalHalfW;
    const ga = PITCH.goalArea || { depth: box * 0.5, width: PITCH.keeperArea.width * 0.5 };
    const at = (d, z) => ({ x: gx - s * d, z });
    const atk = m.teamPlayers(r.team).filter(q => q !== r.taker && q.line !== 'GK');
    const back = atk.slice().sort((a, c) => a.form.x - c.form.x).slice(0, atk.length > 5 ? 2 : 1);
    const fwd = atk.filter(q => !back.includes(q)).sort((a, c) => aerial(c) - aerial(a));
    const boxSpots = [
      at(Math.min(2.2, ga.depth * 0.5), zs * (gw - 0.4)),        // near post
      at(ga.depth * 0.9, -zs * (gw + 0.6)),                       // far post
      at(PITCH.penaltySpot ?? box * 0.65, -zs * 0.8),             // penalty spot
      at(ga.depth * 1.15, zs * 1.2),                              // front of the six-yard box
      at(box + 1.5, zs * 2.5),                                    // edge of the area: the second ball
    ];
    const inBox = fwd.slice(0, boxSpots.length);
    inBox.forEach((q, i) => spots.set(q.id, boxSpots[i]));
    // Defenders: one stays up for the counter; the rest mark (best markers on the
    // biggest threats), then the near post, then the edge of the area.
    const defs = m.teamPlayers(1 - r.team).filter(q => q.line !== 'GK');
    const up = defs.slice().sort((a, c) => c.form.x - a.form.x)[0];
    const pool = defs.filter(q => q !== up || defs.length < 3).sort((a, c) => (c.attrs.tackle + c.attrs.strength) - (a.attrs.tackle + a.attrs.strength));
    for (const q of inBox) {
      const d = pool.shift();
      if (!d) break;
      spots.set(d.id, towards(spots.get(q.id), { x: gx, z: 0 }, 0.9));
    }
    const zonal = [at(0.5, zs * (gw - 0.3)), at(ga.depth, 0), at(box + 1, -zs * 1.5)];
    for (const z of zonal) { const d = pool.shift(); if (!d) break; spots.set(d.id, z); }
  }

  // Goal kick: the centre-backs split to the corners of the area to take it short;
  // everyone else holds his shape (opponents are kept out of the area by the laws).
  goalKickSpots(r, spots) {
    const m = this.m, gx = m.ownGoalX(r.team), s = Math.sign(gx), ka = PITCH.keeperArea;
    const w = ka.kind === 'rect' ? ka.width / 2 - 1.5 : ka.radius;
    const cbs = m.teamPlayers(r.team).filter(q => q.line === 'DEF' && q.roleDef.width < 0.5).sort((a, c) => a.form.y - c.form.y);
    // team-left and team-right corners of the area
    const dir = m.teams[r.team].dir;
    const corners = [{ x: gx - s * (PITCH.boxR - 1), z: -dir * w }, { x: gx - s * (PITCH.boxR - 1), z: dir * w }];
    if (cbs.length === 1) spots.set(cbs[0].id, corners[r.spot.z * dir > 0 ? 1 : 0]);
    else cbs.slice(0, 2).forEach((q, i) => spots.set(q.id, corners[i]));
  }

  // A penalty: everyone but the taker and the keeper on the edge of the area, out of the arc,
  // a team-mate and an opponent side by side for the rebound.
  penaltySpots(r, spots) {
    const m = this.m, gx = m.oppGoalX(r.team), s = Math.sign(gx), ka = PITCH.keeperArea;
    const depth = ka.kind === 'rect' ? ka.depth : ka.radius;
    const edge = gx - s * (depth + 0.9), spotX = r.spot.x;
    const arcZ = Math.sqrt(Math.max(0, PITCH.centreR ** 2 - (edge - spotX) ** 2)) + 0.8;
    // (the taker's keeper stays in his own goal: his anchor)
    const others = m.players.filter(q => q.active && q !== r.taker && q.line !== 'GK')
      .sort((a, c) => (a.team - c.team) || Math.abs(a.x - gx) - Math.abs(c.x - gx));
    const atk = others.filter(q => q.team === r.team), def = others.filter(q => q.team !== r.team);
    const order = [];
    for (let i = 0; i < Math.max(atk.length, def.length); i++) { if (def[i]) order.push(def[i]); if (atk[i]) order.push(atk[i]); }
    order.forEach((q, i) => {
      const k = Math.floor(i / 2), side = i % 4 < 2 ? 1 : -1, row = Math.floor(k / 2);
      const z = side * Math.min(PITCH.halfW - 1.5, arcZ + (k % 2) * 1.6 + row * 3.2);
      spots.set(q.id, { x: edge - s * row * 2.5, z });
    });
    const gk = m.keeper(1 - r.team);
    if (gk) spots.set(gk.id, { x: gx - s * 0.15, z: 0 });
  }

  // A direct free kick within shooting range: a wall on the line from the ball to the goal,
  // the laws' distance from the ball (the centre-circle radius), shifted a touch toward the
  // near post; the men nearest it make it.
  wallSpots(r, spots) {
    const m = this.m, W = GP.referee.wall, sp = r.spot;
    const gx = m.oppGoalX(r.team);
    const d = Math.hypot(gx - sp.x, sp.z);
    if (d > this.R.shot * W.range) return;
    const ux = (gx - sp.x) / d, uz = -sp.z / d, px = -uz, pz = ux;
    const size = m.cfg.teamSize, n = Math.min(W.men[size <= 7 ? 0 : size <= 9 ? 1 : 2], Math.max(1, Math.round(d / 6)));
    const R = PITCH.centreR + 0.1;
    // shifted half a man toward the near post (the ball's side of the goal)
    const toNear = (Math.sign(sp.z) || 1) * (Math.sign(pz) || 1);
    const cx = sp.x + ux * R, cz = sp.z + uz * R;
    const pool = m.teamPlayers(1 - r.team).filter(q => q.line !== 'GK').sort((a, c) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(c.x - cx, c.z - cz));
    for (let i = 0; i < n && pool[i]; i++) {
      const off = (i - (n - 1) / 2 + toNear * 0.5) * GP.referee.wallGap;
      spots.set(pool[i].id, { x: cx + px * off, z: cz + pz * off });
    }
    r.wall = { n, x: cx, z: cz };
  }

  restartThink(p) {
    const r = this.m.restart;
    if (r && r.state === 'READY' && p === r.taker && r.readyT >= r.aiAt) this.decideRestart(p);
  }

  restartAct(p) {
    const m = this.m, r = m.restart, b = m.ball;
    if (!r || r.state === 'DEAD' || p === r.taker) { this.stop(p); return; }
    p.faceTarget = { x: b.x, z: b.z };
    if (p.line === 'GK' && p !== r.taker) {
      // On his line, shading to the ball's side.
      const gx = m.ownGoalX(p.team), dir = m.teams[p.team].dir;
      this.goTo(p, gx + dir * 0.7, clamp(b.z * 0.15, -PITCH.goalHalfW * 0.6, PITCH.goalHalfW * 0.6), 3, 0.15);
      return;
    }
    const s = this.restartSpots.get(p.id) || this.team[p.team].anchors.get(p.id);
    if (s) this.goTo(p, s.x, s.z, maxSpeed(p, false) * 0.7, 0.35, !this.restartSpots.has(p.id)); else this.stop(p);
  }

  // The taker's choice (also used when a human taker runs out of time).
  decideRestart(p) {
    const m = this.m, r = m.restart, dir = m.teams[p.team].dir;
    if (!r) return false;
    if (r.type === 'THROW_IN') {
      const reach = 22;
      const best = evalPasses(m, p).find(o => o.kind === 'pass' && Math.hypot(o.lead.x - p.x, o.lead.z - p.z) < reach);
      if (best) return m.takeRestart(p, 'throwin', { receiver: best.r });
      return m.takeRestart(p, 'throwin', { target: clampToField(p.x + dir * 12, p.z - Math.sign(p.z) * 4, 2) });
    }
    if (r.type === 'CORNER') {
      // Into the box toward the best header of the ball who isn't tightly marked; now and
      // then a short one to the nearest man.
      const gx = Math.sign(r.spot.x) * PITCH.halfL;
      let best = null, bs = -Infinity;
      for (const q of m.mates(p)) {
        if (q.line === 'GK' || !inKeeperArea(q.x, q.z, gx, 2)) continue;
        let mark = 99;
        for (const o of m.opponents(p)) mark = Math.min(mark, Math.hypot(o.x - q.x, o.z - q.z));
        const sc = aerial(q) + Math.min(mark, 3) * 0.15 + m.rand() * 0.25;
        if (sc > bs) { bs = sc; best = q; }
      }
      if (best && m.rand() > 0.12) return m.takeRestart(p, 'lob', { target: { x: best.x, z: best.z }, receiver: best });
      const short = m.mates(p).filter(q => q.line !== 'GK').sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0];
      return m.takeRestart(p, 'pass', { receiver: short });
    }
    if (r.type === 'PENALTY') {
      // Low into a corner, or high; the keeper reads it after the strike like any shot.
      const tz = (m.rand() < 0.5 ? -1 : 1) * (PITCH.goalHalfW - 0.4 - m.rand() * 0.8);
      return m.takeRestart(p, 'shot', { aim: { mode: 'assist', tz, ty: 0.3 + m.rand() * 1.3, power: 0.8 + 0.12 * this.diff } });
    }
    if (r.type === 'FREE_KICK' && r.direct) {
      // In range: over the wall and curled toward the far post — most of the time.
      const gx = m.oppGoalX(p.team), d = Math.hypot(gx - p.x, p.z);
      if (d < this.R.shot * 1.25 && Math.abs(p.z) < d * 0.9 && m.rand() < 0.7) {
        const tz = -(Math.sign(p.z) || 1) * (PITCH.goalHalfW - 0.5);
        return m.takeRestart(p, 'shot', { aim: { mode: 'assist', tz, ty: 1.5 + m.rand() * 0.6, power: 0.86 + 0.08 * this.diff, finesse: m.rand() < 0.6 } });
      }
    }
    if (r.type === 'FREE_KICK') {
      // Play it to someone: a safe one if there is one, else long.
      const opts = evalPasses(m, p).filter(o => (o.kind === 'pass' || o.kind === 'lob') && o.risk < 0.35);
      if (opts.length && opts[0].u > -0.4) {
        const o = opts[0];
        return m.takeRestart(p, o.kind === 'lob' ? 'lob' : 'pass', o.kind === 'lob' ? { receiver: o.r, target: o.lead } : { receiver: o.r });
      }
    }
    // Goal kick (and a free kick with nothing on): short to a free centre-back, or long
    // toward the most advanced man (on his side of the offside line).
    const short = evalPasses(m, p).filter(o => o.kind === 'pass' && o.risk < 0.3);
    if (short.length && short[0].u > -0.3 && m.rand() < 0.7) return m.takeRestart(p, 'pass', { receiver: short[0].r });
    const fwd = m.mates(p).filter(q => q.line !== 'GK').sort((a, c) => (c.x - a.x) * dir)[0];
    const tgt = fwd ? clampToField(this.onside(p.team, fwd.x - dir * 3), fwd.z, 2) : { x: 0, z: 0 };
    return m.takeRestart(p, 'lob', { target: tgt, receiver: fwd || null });
  }

  // ------------------------------------------------------------------ goal celebration
  celebrate(dt) {
    const m = this.m, g = m.goalInfo;
    if (!g) return;
    const scorer = g.scorer;
    const dir = m.teams[g.team].dir;
    const corner = { x: dir * (PITCH.halfL - 2), z: scorer && scorer.z > 0 ? PITCH.halfW - 2 : -PITCH.halfW + 2 };
    const chasers = scorer ? m.teamPlayers(g.team).filter(p => p !== scorer && p.line !== 'GK') : [];
    for (const p of m.players) {
      if (!p.active) continue;
      p.faceTarget = null;
      const k = chasers.indexOf(p);
      if (p === scorer && !g.own) { p.sprinting = true; this.goTo(p, corner.x, corner.z, 6.5, 0.8); }
      else if (k >= 0) { this.goTo(p, scorer.x - dir * 1.2, scorer.z + (k - (chasers.length - 1) / 2) * 0.9, 5.5, 1.2); }
      else this.goTo(p, p.x - m.teams[p.team].dir * 0.8, p.z * 0.98, 1.3, 0.1);
    }
  }
}
