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
import { COURT, BALL, PLAYER, AI } from '../../config.js';
import { clamp, damp, angleDiff, wrapAngle } from '../../util/math.js';
import { predictPath } from '../ball.js';
import { maxSpeed } from '../players.js';
import { evalShots, evalPasses, evalDribble, frontDefender, pressure, reachTime, threat } from './eval.js';

const TEAM_TICK = 0.3;

export class AIDirector {
  constructor(m) {
    this.m = m;
    this.teamT = 0;
    this.team = [this.blankTeam(), this.blankTeam()];
    this.ballPred = null;
    this.shotSeen = null;
  }
  blankTeam() { return { phase: 'LOOSE', presser: null, presser2: null, marks: new Map(), chasers: new Set(), runners: new Set(), anchors: new Map(), forcePress: false, gkRush: false }; }

  get diff() { return this.m.opts.difficulty; }
  reaction() { return 0.06 + 0.32 * (1 - this.diff); }

  update(dt) {
    const m = this.m;
    this.teamT -= dt;
    if (this.teamT <= 0) {
      this.teamT = TEAM_TICK;
      this.ballPred = m.ball.owner ? null : predictPath(m.ball, 2.5, 1 / 30);
      this.teamThink(0); this.teamThink(1);
    }
    for (const p of m.players) {
      if (!p.active || p.human) continue;
      if (p.frozen) { this.stop(p); p.faceTarget = { x: m.ball.x, z: m.ball.z }; p.ai.label = 'WALL'; continue; }
      const ai = p.ai;
      ai.thinkT -= dt;
      if (ai.pending && (ai.pendingT -= dt) <= 0) { ai.state = ai.pending; ai.pending = null; }
      if (ai.thinkT <= 0) {
        ai.thinkT = AI.thinkInterval * (0.85 + Math.random() * 0.3);
        this.think(p);
      }
      this.act(p, dt);
    }
  }

  // ------------------------------------------------------------------ team brain
  teamThink(t) {
    const m = this.m, T = this.team[t], b = m.ball, o = b.owner;
    T.phase = o ? (o.team === t ? 'ATTACK' : 'DEFEND') : 'LOOSE';
    const mates = m.teamPlayers(t);
    const dir = m.teams[t].dir;

    // Shape anchors: base futsal diamond, shifted by phase and by the ball.
    const bu = (b.x * dir + COURT.halfL) / (2 * COURT.halfL);
    const bv = (b.z + COURT.halfW) / (2 * COURT.halfW);
    T.anchors.clear();
    for (const p of mates) {
      let u = p.baseU, v = p.baseV;
      if (p.role !== 'GK') {
        u += T.phase === 'ATTACK' ? 0.1 : T.phase === 'DEFEND' ? -0.07 : 0;
        u += (bu - 0.5) * 0.5;
        v += (bv - 0.5) * 0.35;
        if (p.role === 'DEF') u = Math.min(u, T.phase === 'ATTACK' ? 0.5 : 0.38);
        u = clamp(u, 0.1, 0.88);
      }
      T.anchors.set(p.id, { x: -dir * COURT.halfL + dir * u * 2 * COURT.halfL, z: (clamp(v, 0.08, 0.92) - 0.5) * 2 * COURT.halfW });
    }

    // Loose ball: the fastest to the ball chases (by predicted intercept time).
    T.chasers.clear();
    if (T.phase === 'LOOSE') {
      const ranked = mates.filter(p => p.role !== 'GK').map(p => [this.intercept(p).t, p]).sort((a, c) => a[0] - c[0]);
      if (ranked[0]) T.chasers.add(ranked[0][1]);
      if (ranked[1] && ranked[1][0] < ranked[0][0] + 0.5) T.chasers.add(ranked[1][1]);
    }

    // Defending: one presser, the rest mark greedily, the leftover covers.
    T.presser = null; T.marks.clear();
    if (T.phase === 'DEFEND') {
      const outfield = mates.filter(p => p.role !== 'GK');
      let best = null, bt = Infinity;
      for (const p of outfield) { const tt = reachTime(p, o.x, o.z, 0); if (tt < bt) { bt = tt; best = p; } }
      T.presser = best;
      // Human asked for teammate pressure (or the human is already pressing and wants help).
      T.presser2 = null;
      if (T.forcePress) {
        let b2 = null, bt2 = Infinity;
        for (const p of outfield) { if (p.human || p === best) continue; const tt = reachTime(p, o.x, o.z, 0); if (tt < bt2) { bt2 = tt; b2 = p; } }
        if (best && best.human) T.presser2 = b2; else if (b2 && !best) T.presser = b2;
      }
      const attackers = m.teamPlayers(1 - t).filter(a => a !== o && a.role !== 'GK');
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
        // The fixo stays as the last man instead of chasing a man upfield.
        if (d.role === 'DEF' && (a.x - m.ownGoalX(t)) * dir > 16) continue;
        T.marks.set(d.id, a); usedD.add(d); usedA.add(a);
      }
    }

    // Attacking: one forward-thinking player makes a run in behind.
    T.runners.clear();
    if (T.phase === 'ATTACK') {
      let best = null, bs = -Infinity;
      for (const p of mates) {
        if (p === o || p.role === 'GK' || p.role === 'DEF') continue;
        const ahead = (p.x - o.x) * dir;
        if (ahead < -2) continue;
        const s = threat(m, t, p.x + dir * 4, p.z) - Math.max(0, 6 - ahead) * 0.01 + Math.random() * 0.05;
        if (s > bs) { bs = s; best = p; }
      }
      if (best && o.possessT > 0.4 && Math.random() < 0.55 + 0.3 * this.diff) T.runners.add(best);
    }
  }

  // Predicted intercept point/time for a player on the free ball.
  intercept(p) {
    const b = this.m.ball;
    if (b.owner) return { t: reachTime(p, b.x, b.z, 0), x: b.x, z: b.z };
    const pred = this.ballPred;
    if (!pred) return { t: reachTime(p, b.x, b.z, 0), x: b.x, z: b.z };
    for (let i = 0; i < pred.pts.length; i++) {
      const q = pred.pts[i];
      const tb = i / 30;
      if (q.y > 2.2) continue;
      if (reachTime(p, q.x, q.z, 0.1) <= tb) return { t: tb, x: q.x, z: q.z };
    }
    const e = pred.pts[pred.pts.length - 1];
    return { t: reachTime(p, e.x, e.z, 0.1), x: e.x, z: e.z };
  }

  setState(p, s, immediate = false) {
    const ai = p.ai;
    if (ai.state === s) { ai.pending = null; return; }
    if (immediate) { ai.state = s; ai.pending = null; return; }
    if (ai.pending !== s) { ai.pending = s; ai.pendingT = this.reaction() * (0.7 + Math.random() * 0.6); }
  }

  // ------------------------------------------------------------------ player FSM
  think(p) {
    const m = this.m, b = m.ball, T = this.team[p.team], ai = p.ai;
    if (m.phase !== 'play') return;
    if (p.role === 'GK') return this.keeperThink(p);

    if (b.owner === p) { this.setState(p, 'ATTACK', true); return this.attackThink(p); }
    if (b.passTo === p) { this.setState(p, 'RECEIVE', true); return; }

    if (T.phase === 'LOOSE') {
      if (T.chasers.has(p)) this.setState(p, 'CHASE', b.lastKick && b.lastKick.team !== p.team);
      else this.setState(p, 'SUPPORT');
    } else if (T.phase === 'ATTACK') {
      this.setState(p, T.runners.has(p) ? 'RUN' : 'SUPPORT');
      if (ai.state === 'SUPPORT' || ai.pending === 'SUPPORT') ai.spot = this.supportSpot(p);
      if (ai.state === 'RUN' || ai.pending === 'RUN') ai.spot = this.runSpot(p);
    } else {
      if (T.presser === p || T.presser2 === p) this.setState(p, 'PRESS', T.presser2 === p);
      else if (T.marks.has(p.id)) this.setState(p, 'MARK');
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
      const a = (i / 12) * Math.PI * 2, r = i % 2 ? 2.5 : 4.5;
      const x = clamp(anc.x + Math.cos(a) * r, -COURT.halfL + 1.2, COURT.halfL - 1.2);
      const z = clamp(anc.z + Math.sin(a) * r, -COURT.halfW + 1.2, COURT.halfW - 1.2);
      let open = 99;
      for (const o of m.opponents(p)) open = Math.min(open, Math.hypot(o.x - x, o.z - z));
      let spacing = 99;
      for (const q of m.mates(p)) if (q !== carrier) spacing = Math.min(spacing, Math.hypot(q.x - x, q.z - z));
      let lane = 1;
      if (carrier) {
        const dc = Math.hypot(x - carrier.x, z - carrier.z);
        if (dc < 3.5 || dc > 16) lane = 0.3;
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
    return best;
  }

  runSpot(p) {
    const m = this.m, dir = m.teams[p.team].dir;
    const x = clamp(p.x + dir * 7, -COURT.halfL + 3, COURT.halfL - 3);
    const z = clamp(p.z * 0.6, -COURT.halfW + 2, COURT.halfW - 2);
    return { x, z };
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
    if (press < 1.3) opts.push({ kind: 'shield', u: 0.02, label: 'SHIELD' });

    // Decision noise scales with difficulty (lower difficulty = sloppier choices).
    const noise = 0.1 * (1 - this.diff);
    for (const o of opts) o.score = o.u + (Math.random() - 0.5) * 2 * noise;
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
    switch (best.kind) {
      case 'shoot': {
        const aim = best.bank
          ? { mode: 'assist', bank: true, angle: best.angle, tz: best.tz, ty: 0.4, power: 0.85 + 0.12 * this.diff }
          : { mode: 'assist', tz: best.tz, ty: 0.4 + Math.random() * 0.8, power: 0.8 + 0.18 * this.diff, finesse: p.attrs.shot > 0.9 && Math.random() < 0.3 && Math.abs(best.tz) > 1 };
        if (m.requestShot(p, aim)) ai.pop = { text: best.label, t: 1.2 };
        break;
      }
      case 'pass': case 'through':
        if (m.requestKick(p, best.kind, { receiver: best.r })) ai.pop = { text: best.label, t: 1 };
        break;
      case 'wallpass':
        if (m.requestKick(p, 'pass', { receiver: best.r, angle: best.angle, speed: best.speed })) ai.pop = { text: 'WALL PASS', t: 1.2 };
        break;
      case 'skill':
        if (m.requestSkill(p, best.name, Math.random() - 0.5, Math.random() - 0.5)) { ai.skillCD = 2.2 + Math.random() * 2; ai.pop = { text: best.label, t: 1 }; }
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
    if (m.phase !== 'play') { this.stop(p); return; }
    if (p.role === 'GK') return this.keeperAct(p, dt);
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
        const ic = this.intercept(p);
        this.goTo(p, ic.x, ic.z, maxSpeed(p, true), 0.2);
        p.sprinting = true;
        break;
      }
      case 'CHASE': {
        const ic = this.intercept(p);
        p.sprinting = true;
        this.goTo(p, ic.x, ic.z, maxSpeed(p, true) * (0.85 + 0.15 * d), 0.1);
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
        const o = b.owner;
        if (!o) { this.stop(p); break; }
        const g = { x: m.ownGoalX(p.team), z: 0 };
        const gx = g.x - o.x, gz = g.z - o.z, gl = Math.hypot(gx, gz) || 1;
        const dist = Math.hypot(o.x - p.x, o.z - p.z);
        const standoff = 1.05;
        const tx = o.x + gx / gl * standoff + o.vx * 0.15, tz = o.z + gz / gl * standoff + o.vz * 0.15;
        if (dist < 3.2) { p.jockey = true; p.faceTarget = { x: b.x, z: b.z }; }
        p.sprinting = dist > 3;
        const sp = maxSpeed(p, dist > 3) * (0.75 + 0.3 * d);
        this.goTo(p, tx, tz, p.jockey ? sp * 0.8 : sp, 0.15);
        // Tackle when the ball is exposed or on a timer scaled by difficulty.
        const bd = Math.hypot(b.x - p.x, b.z - p.z);
        const exposed = Math.hypot(b.x - o.x, b.z - o.z) > 0.62;
        if (bd < 1.25 && !p.action && p.stun <= 0) {
          const rate = (exposed ? 3.5 : 0.8) * (0.4 + 0.9 * d);
          if (Math.random() < rate * dt) m.requestTackle(p);
        }
        // Last-ditch slide when the carrier is getting away toward goal.
        const away = Math.hypot(o.x - g.x, o.z) < Math.hypot(p.x - g.x, p.z);
        if (away && bd < 2.4 && bd > 1.2 && o.speed > 4 && !p.action && Math.random() < 0.9 * d * dt * p.attrs.tackle) {
          p.facing = p.heading = Math.atan2(b.z + b.vz * 0.2 - p.z, b.x + b.vx * 0.2 - p.x);
          m.requestSlide(p);
        }
        break;
      }
      case 'MARK': {
        const a = T.marks.get(p.id);
        if (!a) { this.stop(p); break; }
        // Goal-side of the man, shaded toward the ball; step in if a pass is coming to him.
        const g = { x: m.ownGoalX(p.team), z: 0 };
        const gx = g.x - a.x, gz = g.z - a.z, gl = Math.hypot(gx, gz) || 1;
        let tx = a.x + gx / gl * 1.5 + (b.x - a.x) * 0.12, tz = a.z + gz / gl * 1.5 + (b.z - a.z) * 0.12;
        if (b.passTo === a) { const ic = this.intercept(p); tx = ic.x; tz = ic.z; p.sprinting = true; }
        this.goTo(p, tx, tz, maxSpeed(p, p.sprinting || Math.hypot(tx - p.x, tz - p.z) > 4), 0.3);
        if (p.speed < 1) p.faceTarget = { x: b.x, z: b.z };
        break;
      }
      case 'COVER': {
        const g = { x: m.ownGoalX(p.team), z: 0 };
        const k = 0.38;
        const tx = g.x + (b.x - g.x) * k, tz = (b.z - g.z) * k * 0.8;
        const minOut = COURT.boxR + 0.8;
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

  go(p, dx, dz, speed) { p.move.x = dx; p.move.z = dz; p.move.speed = speed; }
  stop(p) { p.move.x = 0; p.move.z = 0; p.move.speed = 0; }
  goTo(p, x, z, speed, tol = 0.3) {
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < tol) { this.stop(p); return; }
    this.go(p, dx / d, dz / d, Math.min(speed, 0.6 + d * 2.6));
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
          m.requestKick(p, 'clear', { target: { x: dir * 6, z: (Math.random() - 0.5) * 12 } });
          ai.pop = { text: 'CLEAR', t: 1 };
        }
      }
      ai.label = ai.state;
      return;
    }
    // Loose ball near goal and we'd get there first: claim it.
    if (!b.owner) {
      const inBox = Math.hypot(b.x - gx, b.z) < COURT.boxR + 1;
      if (inBox && Math.hypot(b.vx, b.vz) < 9) {
        const mine = this.intercept(p).t;
        let theirs = Infinity;
        for (const o of m.opponents(p)) theirs = Math.min(theirs, this.intercept(o).t);
        if (mine < theirs - 0.05) { ai.state = 'CLAIM'; ai.label = ai.state; return; }
      }
    }
    if (ai.state !== 'DIVE') ai.state = b.owner && b.owner.team !== p.team && Math.hypot(b.x - gx, b.z) < 14 ? 'SET' : 'POSITION';
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
    const out = clamp(0.5 + bl * 0.09, 0.6, ai.state === 'SET' ? 1.6 : 2.4);
    let tx = gx + bx / bl * out, tz = bz / bl * out;
    tz = clamp(tz, -COURT.goalHalfW + 0.25, COURT.goalHalfW - 0.25);
    // 1v1: rush to narrow the angle.
    const o = b.owner;
    if (o && o.team !== p.team && this.team[p.team].gkRush) {
      // Human held "rush keeper": come off the line at the carrier.
      this.goTo(p, o.x, o.z, maxSpeed(p, true), 0.2); ai.label = 'RUSH'; return;
    }
    if (o && o.team !== p.team && Math.hypot(o.x - gx, o.z) < COURT.boxR && (o.x - gx) * dir < 5) {
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
    const onTarget = pred.goal === -dir || (cross && Math.abs(cross.z) < COURT.goalHalfW + 0.3 && cross.y < COURT.goalH + 0.2);
    if (!onTarget || !cross) return false;
    // Reaction time: difficulty + keeping, slower against a GAMEBREAKER team.
    // Deflections and cage rebounds are notoriously hard for keepers: he's already
    // moving for the original line, so the re-read costs an extra beat.
    const redirected = (b.redirectT || -1) > (kick ? kick.t : -1);
    const react = 0.1 + 0.18 * (1 - this.diff) + (1 - p.attrs.keeping) * 0.12 + (m.isGB(1 - p.team) ? 0.14 : 0) + (redirected ? 0.2 : 0);
    const since = m.time - (t0 > 0 ? t0 : m.time);
    ai.label = 'SET';
    if (since < react) { this.stop(p); return true; }
    const lateral = cross.z - p.z;
    if (Math.abs(lateral) < 0.45 && cross.y < 1.9) {
      // Right at him: shuffle across and let the hands do it.
      this.goTo(p, p.x, cross.z, 4, 0.02);
      return true;
    }
    if (Math.abs(lateral) < 3.2 && cross.t > 0.05) {
      ai.diveFor = key;
      m.requestDive(p, p.x - dir * 0.1, cross.z + Math.sign(lateral) * 0.25, cross.y > 1.1, redirected ? 0.8 : 1);
      ai.state = 'DIVE'; ai.label = 'DIVE';
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ goal celebration
  celebrate(dt) {
    const m = this.m, g = m.goalInfo;
    if (!g) return;
    const scorer = g.scorer;
    const dir = m.teams[g.team].dir;
    const corner = { x: dir * (COURT.halfL - 2), z: scorer && scorer.z > 0 ? COURT.halfW - 2 : -COURT.halfW + 2 };
    for (const p of m.players) {
      if (!p.active) continue;
      p.faceTarget = null;
      if (p === scorer && !g.own) { p.sprinting = true; this.goTo(p, corner.x, corner.z, 6.5, 0.8); }
      else if (p.team === g.team && scorer && p.role !== 'GK') { this.goTo(p, scorer.x - dir * 1.2, scorer.z + (p.slot - 2) * 0.9, 5.5, 1.2); }
      else this.goTo(p, p.x - m.teams[p.team].dir * 0.8, p.z * 0.98, 1.3, 0.1);
    }
  }
}
