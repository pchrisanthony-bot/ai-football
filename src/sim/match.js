// =====================================================================
// Match: the whole simulation. Pure logic, fixed 120 Hz, no rendering.
// The renderer and audio read `match` state and drain `match.events`.
// =====================================================================
import { SIM_DT, BALL, PLAYER, KICK, RULES, STYLE, DRIB, TOUCH, RESTART } from '../config.js';
import { makeBall, stepBall, predictPath } from './ball.js';
import { makePlayer, movePlayer, separatePlayers, clampToArea } from './players.js';
import { TEAMS, buildLineup } from './squads.js';
import { createMatchConfig } from './formats.js';
import { formationToWorld } from './formations.js';
import { PITCH, setPitch, inKeeperArea, isCage, lineCrossing, cornerSpot, goalKickSpot } from './pitch.js';
import { groundPassSpeed, solveLob, solveStrike, rollTime } from './kicks.js';
import { clamp, damp, wrapAngle, angleDiff, mulberry32, smooth } from '../util/math.js';
import { AIDirector } from './ai/director.js';
import { prof } from '../util/profiler.js';

const R = BALL.r;
const TAU = Math.PI * 2;

// Timed actions. contact = when the foot meets the ball; lock = movement speed multiplier.
const STRIKES = new Set(['pass', 'through', 'lob', 'shot', 'volley', 'clear']);
const ACTIONS = {
  pass:     { dur: 0.34, contact: KICK.passContact, lock: 0.55 },
  through:  { dur: 0.34, contact: KICK.passContact, lock: 0.55 },
  lob:      { dur: 0.40, contact: KICK.lobContact, lock: 0.45 },
  shot:     { dur: 0.50, contact: KICK.shotContact, lock: 0.3 },
  volley:   { dur: 0.45, contact: 0.08, lock: 0.25 },
  clear:    { dur: 0.45, contact: 0.14, lock: 0.4 },
  throw:    { dur: 0.55, contact: 0.28, lock: 0 },
  throwin:  { dur: 0.6, contact: 0.3, lock: 0 },
  header:   { dur: 0.45, contact: 0.0, lock: 0.6 },
  tackle:   { dur: 0.45, contact: 0.13, lock: 0.35 },
  slide:    { dur: 0.95, contact: 0.06, lock: 1, ghost: true, selfMove: true },
  stepover: { dur: 0.52, contact: 0.22, lock: 0.5, holdBall: true },
  dragback: { dur: 0.46, contact: 0.05, lock: 0.25, holdBall: true },
  roulette: { dur: 0.64, contact: 0.05, lock: 1, holdBall: true, immune: true, selfMove: true },
  rainbow:  { dur: 0.55, contact: 0.16, lock: 0.8 },
  flickup:  { dur: 0.38, contact: 0.10, lock: 0.5 },
  panna:    { dur: 0.40, contact: 0.12, lock: 0.6 },
  dive:     { dur: 1.15, contact: 0.0, lock: 1, ghost: true, selfMove: true },
  stumble:  { dur: 0.6, contact: 99, lock: 0.12 },
  getup:    { dur: 0.45, contact: 99, lock: 0 },
  celebrate:{ dur: 3.5, contact: 99, lock: 1 },
};

// Formation order: furthest forward, then most central, then left before right
// (formation coordinates are compared to the centimetre, so mirrored spots tie).
const cm = v => Math.round(v * 100);
const byShape = (a, c) => cm(c.form.x) - cm(a.form.x) || cm(Math.abs(a.form.y - 0.5)) - cm(Math.abs(c.form.y - 0.5)) || a.form.y - c.form.y;

const RESTART_STAT = { THROW_IN: 'throwIns', CORNER: 'corners', GOAL_KICK: 'goalKicks' };

export const SKILL_NAMES = { stepover: 'STEPOVER', dragback: 'DRAG BACK', roulette: 'ROULETTE', rainbow: 'RAINBOW FLICK', flickup: 'FLICK UP', panna: 'PANNA!' };

export class Match {
  constructor(opts = {}) {
    this.opts = {
      home: 'cage', away: 'rooftop', mode: 'timed', seconds: RULES.matchSeconds, firstTo: RULES.firstTo,
      difficulty: 0.6, humanTeam: 0, seed: 1, format: '5v5', formations: null, ...opts,
    };
    // Format, pitch and formations (validated); the pitch becomes the live PITCH.
    this.cfg = createMatchConfig(this.opts);
    setPitch(this.cfg.pitch);
    this.rng = mulberry32(this.opts.seed);
    const defs = [TEAMS[this.opts.home], TEAMS[this.opts.away]];
    this.teams = defs.map((def, i) => ({
      idx: i, def, dir: i === 0 ? 1 : -1, score: 0, style: 0, gb: 0, gbReady: false, formation: this.cfg.formations[i],
      stats: { shots: 0, onTarget: 0, passes: 0, passesOk: 0, tackles: 0, pannas: 0, cageGoals: 0, skills: 0, saves: 0, possession: 0, corners: 0, throwIns: 0, goalKicks: 0 },
    }));
    this.players = [];
    for (let t = 0; t < 2; t++) buildLineup(defs[t], this.cfg.formations[t]).forEach((L, s) => this.players.push(makePlayer(t, s, L, this.opts.seed)));
    this.ball = Object.assign(makeBall(), {
      owner: null, inHands: false, lastTouch: null, lastKick: null, passTo: null, passUntil: 0,
      flair: null, through: null, wallHits: 0, speedVis: 0,
    });
    this.time = 0;
    this.clock = this.opts.seconds;
    this.phase = 'restart';          // play · restart · goal · fulltime
    this.restart = null;             // the restart state machine (see beginRestart)
    this.phaseT = 0;
    this.events = [];
    this.goalInfo = null;
    this.goalLog = [];               // { team, scorer, name, own, cage, at } — for the lower-thirds and full-time sheet
    this.human = null;
    this.ai = new AIDirector(this);
    this.kickoff(0);
  }

  // ------------------------------------------------------------------ helpers
  rand() { return this.rng(); }
  emit(e) {
    e.time = this.time;
    // Per-player match stats (full-time sheet / man of the match).
    if ((e.type === 'tackle' && e.ok) || e.type === 'save') { const q = this.players.find(p => p.id === e.pid); if (q) q.st[e.type === 'save' ? 'sv' : 'tk']++; }
    this.events.push(e);
  }
  // Elapsed match time in seconds (the clock counts down in timed mode, up otherwise).
  elapsed() { return this.opts.mode === 'timed' ? this.opts.seconds - Math.max(0, this.clock) : this.opts.seconds - this.clock; }
  drainEvents() { const e = this.events; this.events = []; return e; }
  teamPlayers(t) { return this.players.filter(p => p.team === t && p.active); }
  opponents(p) { return this.players.filter(q => q.team !== p.team && q.active); }
  mates(p) { return this.players.filter(q => q.team === p.team && q !== p && q.active); }
  ownGoalX(t) { return -this.teams[t].dir * PITCH.halfL; }
  oppGoalX(t) { return this.teams[t].dir * PITCH.halfL; }
  keeper(t) { return this.players.find(p => p.team === t && p.line === 'GK' && p.active) || null; }
  inOwnBox(p) { return inKeeperArea(p.x, p.z, this.ownGoalX(p.team), 0.3); }
  isGB(t) { return this.teams[t].gb > 0; }

  // ------------------------------------------------------------------ flow
  // Kick-off: everyone in his own half in the shape of his formation (a little narrower);
  // the most advanced central attacker takes it with the next man up beside him, and
  // the side not kicking off stays outside the centre circle.
  kickoff(team) {
    const b = this.ball;
    Object.assign(b, makeBall(), { owner: null, inHands: false, passTo: null, flair: null, through: null, wallHits: 0, lastKick: null, restartTaker: null });
    const taker = this.kickTaker(team), partner = this.kickPartner(team, taker);
    for (const p of this.players) {
      if (!p.active) continue;
      const dir = this.teams[p.team].dir;
      if (p === taker) { p.x = -dir * 0.55; p.z = 0; }
      else if (p === partner) { p.x = -dir * 1.9; p.z = dir * (p.form.y > 0.5 ? 2.6 : -2.6); }
      else {
        const w = formationToWorld(Math.min(p.form.x, 0.42), p.form.y, dir);
        p.x = w.x; p.z = w.z * 0.8;
        const r = Math.hypot(p.x, p.z), out = PITCH.centreR + 0.4;
        if (p.team !== team && r < out) { const k = out / (r || 1); p.x = r ? p.x * k : -dir * out; p.z *= k; }
      }
      p.vx = p.vz = p.speed = 0;
      p.heading = p.facing = dir > 0 ? 0 : Math.PI;
      p.action = null; p.stun = 0; p.noTouch = 0; p.stamina = 1; p.closeControl = false; p.jockey = false;
      p.move.x = p.move.z = p.move.speed = 0; p.faceTarget = null;
      p.ai.state = 'IDLE'; p.ai.pending = null;
    }
    this.gainPossession(taker, true);
    this.beginRestart('KICKOFF', team, { x: 0, z: 0 });
    this.restart.taker = taker;
    this.emit({ type: 'kickoff', team });
  }

  // Kick-off taker: the most advanced central attacker (forwards first).
  kickTaker(t) {
    const order = { ATT: 0, MID: 1, DEF: 2, GK: 3 };
    return this.teamPlayers(t).sort((a, c) => order[a.line] - order[c.line] || byShape(a, c))[0];
  }
  // The next man up: the most advanced outfielder after the taker.
  kickPartner(t, taker) {
    return this.teamPlayers(t).filter(p => p !== taker && p.line !== 'GK').sort(byShape)[0] || null;
  }

  step(dt = SIM_DT) {
    if (PITCH.id !== this.cfg.pitch.id) setPitch(this.cfg.pitch);
    this.time += dt;
    for (const t of this.teams) if (t.gb > 0) { t.gb = Math.max(0, t.gb - dt); if (!t.gb) this.emit({ type: 'gbEnd', team: t.idx }); }

    if (this.phase === 'restart') { this.stepRestart(dt); return; }
    if (this.phase === 'fulltime') {
      for (const p of this.players) { p.move.speed = 0; this.updateAction(p, dt); movePlayer(p, dt, 0); }
      if (!this.ball.owner) stepBall(this.ball, dt);
      return;
    }
    if (this.phase === 'goal') {
      this.phaseT -= dt;
      this.ai.celebrate(dt);
      for (const p of this.players) { this.updateAction(p, dt); movePlayer(p, dt, p.action ? ACTIONS[p.action.type].lock : 1); }
      separatePlayers(this.players);
      stepBall(this.ball, dt);
      if (this.phaseT <= 0 && !this.goalInfo.done) { this.goalInfo.done = true; this.emit({ type: 'goalDone' }); }
      return;
    }

    // ---- play
    this.clock -= dt;
    if (this.opts.mode === 'timed' && this.clock <= 0) { this.clock = 0; this.fullTime(); return; }

    for (const p of this.players) {
      p.noTouch = Math.max(0, p.noTouch - dt);
      if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
    }
    const o = this.ball.owner;
    if (o) { o.possessT += dt; this.teams[o.team].stats.possession += dt; }

    let t0 = prof.now();
    this.ai.update(dt);
    prof.add('ai', t0);

    t0 = prof.now();
    const own = this.ball.owner;
    const knocking = own && own.dribble.mode === 'knock';
    for (const p of this.players) {
      if (!p.active) continue;
      this.updateAction(p, dt);
      const a = p.action;
      let lock = a ? ACTIONS[a.type].lock : 1;
      // A strike on a knocked-on ball: keep running onto it until the foot arrives.
      if (knocking && p === own && a && !a.fired) lock = 1;
      if (p.stun > 0) lock = Math.min(lock, 0.15);
      if (p.closeControl) lock = Math.min(lock, 0.55);
      if (this.isGB(p.team)) lock *= 1.08;
      p.carrying = p === own;
      if (knocking && p === own) this.steerToBall(p);
      if (!(a && ACTIONS[a.type].selfMove)) movePlayer(p, dt, lock);
      p.steer = null;
    }
    separatePlayers(this.players);
    prof.add('players', t0);
    t0 = prof.now();
    this.updateBall(dt);
    prof.add('ball', t0);
  }

  fullTime() {
    this.phase = 'fulltime';
    this.ball.owner = null;
    this.emit({ type: 'whistle', kind: 'end' });
    this.emit({ type: 'fulltime' });
  }

  // Man of the match: goals first, then the rest of a good game; the winners get a nudge.
  manOfTheMatch() {
    const w = this.winner();
    let best = null, bs = -1;
    for (const p of this.players) {
      const st = p.st;
      const sc = st.g * 4 + st.sh * 0.4 + st.sk * 0.35 + st.tk * 0.7 + st.sv * 1.1 + (p.team === w ? 1.5 : 0);
      if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }

  winner() {
    const [a, b] = this.teams;
    return a.score > b.score ? 0 : b.score > a.score ? 1 : -1;
  }

  // ------------------------------------------------------------------ possession & dribbling
  gainPossession(p, silent = false) {
    const b = this.ball;
    const prev = b.lastTouch;
    if (b.passTo && b.passTo.team === p.team && b.lastKick && b.lastKick.team === p.team && b.lastKick.kind !== 'shot') {
      this.teams[p.team].stats.passesOk++;
      if (b.wallHits > 0 && b.lastKick.kind !== 'shot') this.addStyle(p.team, STYLE.points.wallpass, 'WALL PASS', p);
    }
    b.owner = p; b.inHands = false; b.passTo = null; b.flair = null; b.through = null;
    b.lastTouch = p; b.vy = 0; b.y = R;
    p.possessT = 0; p.st.to++;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const rx = b.x - p.x, rz = b.z - p.z;
    p.dribble.f = clamp(rx * fx + rz * fz, 0.3, 1.2);
    p.dribble.lat = -rx * fz + rz * fx;
    p.dribble.u = 0;
    p.dribble.mode = 'slot';
    if (!silent) this.emit({ type: 'control', pid: p.id, team: p.team, prevTeam: prev ? prev.team : -1 });
  }

  // Touch-based dribble: the ball is pushed ahead on a cadence and rolls back to
  // the feet (relative frame), rather than being glued on. Close control glues it.
  dribble(p, dt) {
    const b = this.ball;
    if (!p) return;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const d = p.dribble;
    const ox = b.x, oz = b.z;
    if (b.inHands) {
      // A throw-in is held over the head; a keeper holds it to his chest.
      const over = this.phase === 'restart' && this.restart.type === 'THROW_IN' || (p.action && p.action.type === 'throwin');
      const k = over ? -0.06 : 0.32;
      b.x = p.x + fx * k; b.z = p.z + fz * k; b.y = over ? 2.12 : 1.05;
      b.vx = p.vx; b.vz = p.vz; b.vy = 0;
      return;
    }
    const a = p.action;
    if (a && !a.fired && STRIKES.has(a.type)) {
      // Winding up: the player plants beside the ball and strikes it where it is —
      // it doesn't swing round as he turns into the shot (so the aim preview is true).
      b.x += p.vx * dt; b.z += p.vz * dt; b.vx = p.vx; b.vz = p.vz; b.y = R; b.vy = 0;
      return;
    }
    const close = p.closeControl || (a && ACTIONS[a.type].holdBall);
    if (!close && !a && this.phase === 'play' && p.speed > DRIB.knockMin - 0.4 && p.move.speed > DRIB.knockMin
        && Math.hypot(b.x - p.x, b.z - p.z) < 1.1) { this.knockTouch(p); return; }
    const ctl = p.attrs.control;
    const minF = close ? 0.34 : 0.42;
    if (p.speed > 1.2 && !close) {
      const sp = p.speed / PLAYER.sprint;
      const touchLen = (0.14 + 0.85 * sp * sp) * (1.25 - 0.4 * ctl);
      d.u -= 6.5 * dt;
      d.f += d.u * dt;
      if (d.f <= minF && d.u <= 0) {
        d.u = Math.sqrt(2 * 6.5 * touchLen);
        d.f = minF;
        this.emit({ type: 'touch', pid: p.id, power: sp });
      }
    } else {
      d.u = 0;
      d.f = damp(d.f, minF, 10, dt);
    }
    if (a && a.type === 'dragback') d.f = a.t < 0.3 ? damp(d.f, -0.15, 14, dt) : d.f;
    d.f = clamp(d.f, -0.3, 1.7);
    d.lat = damp(d.lat, 0, close ? 22 : 9 + 10 * ctl, dt);
    const tx = p.x + fx * d.f - fz * d.lat, tz = p.z + fz * d.f + fx * d.lat;
    // The ball swings toward its slot (so sharp turns drag it round the foot).
    const k = 1 - Math.exp(-(close ? 30 : 16 + 10 * ctl) * dt);
    b.x += (tx - b.x) * k; b.z += (tz - b.z) * k;
    b.y = R; b.vy = 0;
    b.vx = (b.x - ox) / dt; b.vz = (b.z - oz) / dt;
    // keep inside the cage
    if (isCage()) { const lx = PITCH.halfL - R, lz = PITCH.halfW - R; b.x = clamp(b.x, -lx, lx); b.z = clamp(b.z, -lz, lz); }
  }

  loseBall() {
    const b = this.ball;
    if (b.owner) { b.owner.possessT = 0; b.owner = null; }
    b.inHands = false;
  }

  // ---- knock-on dribbling (the ball rolls free between touches)
  knockTouch(p, heavy = 1) {
    const b = this.ball, d = p.dribble, mv = p.move;
    const ml = Math.hypot(mv.x, mv.z);
    const hx = Math.cos(p.heading), hz = Math.sin(p.heading);
    const dx = ml > 0.01 ? mv.x / ml : hx, dz = ml > 0.01 ? mv.z / ml : hz;
    const cosA = dx * hx + dz * hz;
    const s = Math.min(1, p.speed / PLAYER.sprint), ctl = p.attrs.control;
    // How far the touch runs ahead of the stride: longer at pace, shorter with good feet.
    let lead = (0.15 + 0.55 * s * s) * (1.25 - 0.45 * ctl) * (p.sprinting ? 1.12 : 1) * heavy;
    let base = Math.max(0, p.speed * cosA);
    if (cosA < 0.4) {
      // A cut: a small touch across the body. Planting to do it costs pace.
      lead = 0.3; base = p.speed * 0.35 + 1.0; p.speed *= 0.72;
    }
    const v = base + Math.sqrt(2 * (BALL.rollDecel + BALL.rollLinear * (base + 1.5)) * lead);
    b.vx = dx * v; b.vz = dz * v; b.vy = 0; b.y = R;
    b.wx = b.vz / R; b.wz = -b.vx / R; b.wy = 0;          // struck along the ground: rolling spin
    d.mode = 'knock'; d.lastT = this.time; d.u = 0;
    b.lastTouch = p;
    this.emit({ type: 'touch', pid: p.id, power: s });
  }

  // Run onto a knocked-on ball; the stick's direction is applied at the next touch.
  // Wanting to stop (stick released), he never speeds up after it: he holds his pace
  // (or eases off as the ball slows) just long enough to get a foot on it.
  steerToBall(p) {
    const b = this.ball, mv = p.move;
    const tx = b.x + b.vx * 0.12, tz = b.z + b.vz * 0.12;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.2) return;
    let speed;
    if (this.wantsStop(p)) {
      const along = (b.vx * dx + b.vz * dz) / d;               // ball pace away from him
      speed = Math.min(Math.max(p.speed, Math.min(2.5, d * 3)), Math.max(0, along) + 1.2 + d * 1.2);
    } else speed = Math.max(mv.speed, Math.min(PLAYER.jog, d * 3));
    p.steer = { x: dx / d, z: dz / d, speed };
  }

  wantsStop(p) { return p.move.speed < DRIB.knockMin * 0.75; }

  knockDribble(p, dt) {
    const b = this.ball, d = p.dribble;
    const ev = [];
    stepBall(b, dt, ev);
    for (const e of ev) {
      if (e.type === 'goal') { this.loseBall(); b.lastTouch = p; }   // dribbled it in
      this.onBallEvent(e);
    }
    if (b.owner !== p) return;
    const dx = b.x - p.x, dz = b.z - p.z, dist = Math.hypot(dx, dz);
    // A defender who gets a foot to the free ball before the dribbler can nick it.
    for (const q of this.players) {
      if (q.team === p.team || !q.active || q.stun > 0 || q.noTouch > 0 || q.frozen || (q.action && q.action.ghost)) continue;
      const dq = Math.hypot(b.x - q.x, b.z - q.z);
      if (dq > DRIB.steal || dq > dist - 0.05 || b.y > 0.7) continue;
      const win = 0.4 + 0.45 * q.attrs.tackle - 0.35 * p.attrs.control + (q.jockey ? 0.1 : 0);
      this.loseBall();
      if (q.line === 'GK' || this.rand() < win) {
        this.gainPossession(q);
        this.teams[q.team].stats.tackles++;
        this.emit({ type: 'tackle', ok: true, pid: q.id, victim: p.id, x: b.x, z: b.z });
      } else {
        const ang = Math.atan2(b.z - q.z, b.x - q.x) + (this.rand() - 0.5) * 1.2;
        const sp = 2.5 + Math.hypot(b.vx, b.vz) * 0.4;
        b.vx = Math.cos(ang) * sp; b.vz = Math.sin(ang) * sp; b.vy = 0.5;
        b.lastTouch = q; q.noTouch = 0.2; p.noTouch = 0.15; b.redirectT = this.time;
        this.emit({ type: 'deflect', pid: q.id, x: b.x, y: b.y, z: b.z, speed: sp });
      }
      return;
    }
    if (dist > DRIB.lose) { this.loseBall(); b.lastTouch = p; return; }
    const a = p.action;
    // Close control, a skill, or a stoppage: settle it back at the feet.
    if ((p.closeControl || (a && ACTIONS[a.type].holdBall) || this.phase !== 'play') && dist < 0.9) { this.settle(p); return; }
    const hx = Math.cos(p.heading), hz = Math.sin(p.heading);
    const f = dx * hx + dz * hz, lat = -dx * hz + dz * hx;
    if (a && !a.fired) {
      // A strike is coming: the player stretches to meet it.
      const k = 1 - Math.exp(-5 * dt);
      const sx = p.x + Math.cos(p.facing) * 0.45, sz = p.z + Math.sin(p.facing) * 0.45;
      b.x += (sx - b.x) * k; b.z += (sz - b.z) * k;
      return;
    }
    // Wanting to cut or to stop: he stretches a stride to get a foot on it rather than
    // waiting for the ball to come back into his stride.
    const ml = Math.hypot(p.move.x, p.move.z);
    const stop = this.wantsStop(p);
    const cut = ml > 0.01 && (p.move.x * hx + p.move.z * hz) / ml < 0.77;
    const lunge = DRIB.lunge * (0.7 + 0.6 * Math.min(1, p.speed / PLAYER.sprint));   // longer stride at pace
    const inReach = f > -0.2 && f < DRIB.reach + (cut || stop ? lunge : 0) && Math.abs(lat) < 0.55 + (stop ? 0.15 : 0) && b.y < 0.5;
    if (!inReach || this.time - d.lastT < (stop ? DRIB.trapGap : DRIB.touchGap)) return;
    if (stop || p.speed < 2.2) {
      // Sole on it — but only a slow ball dies under the foot; a quick one needs a cushion.
      if (Math.hypot(b.vx - p.vx, b.vz - p.vz) > TOUCH.trapFree) this.firstTouch(p, 'cushion');
      else this.settle(p);
    } else this.knockTouch(p);
  }

  // Back to the feet (slot dribbling): a trap or a settle.
  settle(p) {
    const b = this.ball, d = p.dribble;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const rx = b.x - p.x, rz = b.z - p.z;
    d.mode = 'slot'; d.u = 0;
    d.f = clamp(rx * fx + rz * fz, 0.3, 1.2);
    d.lat = clamp(-rx * fz + rz * fx, -0.5, 0.5);
    b.lastTouch = p;
    this.emit({ type: 'touch', pid: p.id, power: 0.1 });
  }

  // First touch on a moving ball (see TOUCH in config). The ball comes off the foot
  // with a velocity built from the player's own motion, a push where he wants it,
  // and whatever of the incoming pace the touch didn't take off; then it's free
  // (knock-on dribbling) until he collects it. Returns the touch quality.
  firstTouch(p, force = null) {
    const b = this.ball;
    const inV = Math.hypot(b.vx, b.vz);
    const rvx = b.vx - p.vx, rvz = b.vz - p.vz, rel = Math.hypot(rvx, rvz) || 1e-6;
    const ux = rvx / rel, uz = rvz / rel;                       // incoming, relative to him
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const front = -(ux * fx + uz * fz);                         // 1 = straight at his front
    // Intent: a human's stick, an AI's plan, or a cushion (close control held).
    let intent = null;
    if (p.human) { const ml = Math.hypot(p.move.x, p.move.z); if (ml > 0.1 && p.move.speed > 0.3) intent = { x: p.move.x / ml, z: p.move.z / ml }; }
    else if (p.touchDir) intent = p.touchDir;
    const mode = force || (p.cushion ? 'cushion' : intent ? 'directed' : 'neutral');
    let near = 99;
    for (const o of this.opponents(p)) near = Math.min(near, Math.hypot(o.x - p.x, o.z - p.z));
    const q = clamp(TOUCH.base + TOUCH.skill * p.attrs.control
      - Math.max(0, rel - TOUCH.freePace) * TOUCH.pacePenalty
      - (front > 0.45 ? 0 : front > -0.35 ? TOUCH.side : TOUCH.behind)
      - (b.y > 0.3 ? TOUCH.airborne : 0) - (near < 1.6 ? TOUCH.pressure : 0)
      + (mode === 'cushion' ? TOUCH.cushionBonus : 0), 0.05, 0.97);
    // What survives of the incoming pace; into his body, it bounces back off him.
    const keep = TOUCH.keep[mode] + (1 - q) * TOUCH.keepPoor;
    let resX = rvx * keep, resZ = rvz * keep;
    if (front > 0.45) { resX *= -TOUCH.rebound; resZ *= -TOUCH.rebound; }
    // Where he puts it.
    const pace = Math.min(1, p.speed / PLAYER.sprint);
    let dx = fx, dz = fz, push = TOUCH.push.neutral;
    if (mode === 'directed' && intent) { dx = intent.x; dz = intent.z; push = TOUCH.push.directedStill + (TOUCH.push.directedRun - TOUCH.push.directedStill) * pace; }
    else if (mode === 'cushion') push = TOUCH.push.cushion;
    else if (p.speed > 1) { dx = p.vx / p.speed; dz = p.vz / p.speed; }
    const err = (this.rand() - 0.5) * 2 * TOUCH.scatter * (1 - q);
    let ox = p.vx + dx * push + resX - dz * err, oz = p.vz + dz * push + resZ + dx * err;
    // The ball keeps rolling: spin to match.
    b.vx = ox; b.vz = oz; b.vy = b.y > 0.3 ? (1 - q) * 1.2 : 0;
    b.wx = oz / R; b.wz = -ox / R; b.wy = 0;
    const outV = Math.hypot(ox, oz);
    const turnDeg = Math.abs(((Math.atan2(oz, ox) - Math.atan2(rvz, rvx) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
    const relOut = Math.hypot(ox - p.vx, oz - p.vz);
    this.lastFirstTouch = { pid: p.id, name: p.name, inV, relIn: rel, outV, relOut, quality: q, turnDeg, mode, t: this.time };
    this.emit({ type: 'firstTouch', ...this.lastFirstTouch });
    if (q < TOUCH.miscontrol && relOut > 3.5) {
      // Miscontrol: it's away from him — a loose ball.
      b.lastTouch = p; b.passTo = null; p.noTouch = 0.2; b.redirectT = this.time;
      this.emit({ type: 'deflect', pid: p.id, x: b.x, y: b.y, z: b.z, speed: relOut });
      return q;
    }
    this.gainPossession(p);
    p.dribble.mode = 'knock'; p.dribble.lastT = this.time;
    b.lastTouch = p;
    this.emit({ type: 'touch', pid: p.id, power: Math.min(1, relOut / 6) });
    return q;
  }

  // ------------------------------------------------------------------ ball update & interactions
  updateBall(dt) {
    const b = this.ball;
    if (b.owner) {
      if (b.owner.dribble.mode === 'knock' && !b.inHands) { this.knockDribble(b.owner, dt); return; }
      const x0 = b.x, z0 = b.z;
      this.dribble(b.owner, dt);
      if (!isCage()) this.carriedOver(x0, z0);
      return;
    }
    const ev = [];
    stepBall(b, dt, ev);
    for (const e of ev) this.onBallEvent(e);
    if (this.phase !== 'play') return;
    if (b.passTo && this.time > b.passUntil) b.passTo = null;
    if (b.flair && this.time > b.flair.until) b.flair = null;
    if (b.through && this.time > b.through.until) b.through = null;
    this.interact();
  }

  onBallEvent(e) {
    const b = this.ball;
    if (e.type === 'wall') { b.wallHits++; if (e.speed > 4) b.redirectT = this.time; }
    if (e.type === 'post') b.redirectT = this.time;
    if (e.type === 'post') this.emit({ ...e, type: 'post' });
    else if (e.type === 'goal') { if (this.phase === 'play') this.onGoal(e); }
    else if (e.type === 'out') { if (this.phase === 'play') this.onOut(e); }
    else this.emit(e);
  }

  // A ball at a player's feet (or in his hands) taken over a line: out of play — or a
  // goal, if it went over the goal line between the posts.
  carriedOver(x0, z0) {
    const b = this.ball;
    if (this.phase !== 'play') return;
    const c = lineCrossing(x0, z0, b.x, b.z, R);
    if (!c) return;
    if (c.line === 'goal' && Math.abs(c.z) < PITCH.goalHalfW && b.y < PITCH.goalH) {
      b.goal = c.side; b.net = c.side;
      this.onGoal({ type: 'goal', side: c.side, x: b.x, y: b.y, z: b.z, speed: Math.hypot(b.vx, b.vz) });
      return;
    }
    b.out = true;
    this.onOut({ type: 'out', line: c.line, side: c.side, x: c.x, z: c.z, y: b.y });
  }

  interact() {
    const b = this.ball;
    const bsp = Math.hypot(b.vx, b.vz);
    // After a restart the taker can't play it again until someone else has touched it.
    if (b.restartTaker && b.lastTouch !== b.restartTaker) b.restartTaker = null;
    // closest first
    const cands = [];
    for (const p of this.players) {
      if (!p.active || p.noTouch > 0 || p.stun > 0) continue;
      const hd = Math.hypot(b.x - p.x, b.z - p.z);
      if (hd < 1.9) cands.push([hd, p]);
    }
    cands.sort((a, c) => a[0] - c[0]);
    for (const [hd, p] of cands) {
      if (p === b.restartTaker) continue;
      if (b.flair && b.flair.pid !== p.id && b.y > 0.5) continue;
      if (b.through && b.through.pid === p.id) continue;
      const a = p.action;
      if (a && a.type === 'slide') continue;                  // resolved by the slide itself
      if (p.line === 'GK' && (a?.type === 'dive' || this.inOwnBox(p))) {
        if (this.keeperTouch(p, hd, bsp)) return;
        if (a?.type === 'dive') continue;
      }
      const rvx = b.vx - p.vx, rvz = b.vz - p.vz;
      const rel = Math.hypot(rvx, rvz, b.vy * 0.5);
      if (b.y < 0.6 && hd < PLAYER.controlRadius) {
        const ctlMax = 8 + 9 * p.attrs.control;
        if (rel < ctlMax || (b.passTo === p && rel < ctlMax + 4)) { this.firstTouch(p); return; }
        // Heavy touch: it bounces off the shin.
        const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
        b.vx = b.vx * 0.28 + fx * 2.2 + p.vx * 0.5; b.vz = b.vz * 0.28 + fz * 2.2 + p.vz * 0.5;
        b.vy = Math.max(b.vy, 0.8);
        b.lastTouch = p; p.noTouch = 0.18; b.passTo = null; b.redirectT = this.time;
        this.emit({ type: 'deflect', pid: p.id, x: b.x, y: b.y, z: b.z, speed: rel });
        return;
      }
      if (b.y >= 0.6 && b.y < 1.5 && hd < 0.5) {
        if (rel < 15) {
          // Chest / thigh control: kill it and drop it at the feet.
          b.vx = p.vx * 0.7 + Math.cos(p.facing) * 0.6; b.vz = p.vz * 0.7 + Math.sin(p.facing) * 0.6; b.vy = -0.4;
          b.lastTouch = p; b.passTo = null; p.noTouch = 0.05;
          this.emit({ type: 'chest', pid: p.id, x: b.x, y: b.y, z: b.z });
        } else this.bodyBlock(p, hd);
        return;
      }
      if (b.y >= 1.5 && b.y < 2.35 && hd < 0.48) { this.header(p); return; }
      if (bsp > 9 && hd < PLAYER.radius + R && b.y < 1.9) { this.bodyBlock(p, hd); return; }
    }
  }

  bodyBlock(p, hd) {
    const b = this.ball;
    const nx = (b.x - p.x) / (hd || 1), nz = (b.z - p.z) / (hd || 1);
    const vn = (b.vx - p.vx) * nx + (b.vz - p.vz) * nz;
    if (vn < 0) { b.vx -= 1.35 * vn * nx; b.vz -= 1.35 * vn * nz; }
    b.x = p.x + nx * (PLAYER.radius + R + 0.01); b.z = p.z + nz * (PLAYER.radius + R + 0.01);
    b.lastTouch = p; b.passTo = null; p.noTouch = 0.12; b.redirectT = this.time;
    this.emit({ type: 'block', pid: p.id, x: b.x, y: b.y, z: b.z, speed: Math.abs(vn) });
  }

  header(p) {
    const b = this.ball;
    const t = p.team, gx = this.oppGoalX(t);
    const toGoal = Math.hypot(gx - p.x, p.z);
    let vx, vy, vz;
    if (toGoal < 12 && (p.human ? p.wantShoot : true)) {
      const tz = (this.rand() - 0.5) * 2.2;
      const d = Math.hypot(gx - b.x, tz - b.z), s = 13 + 3 * p.attrs.shot;
      vx = (gx - b.x) / d * s; vz = (tz - b.z) / d * s; vy = -1.5 + d * 0.25;
    } else {
      // Nod it on toward the attacking direction, biased by facing.
      const f = p.facing, dir = this.teams[t].dir;
      const hx = Math.cos(f) * 0.5 + dir * 0.5, hz = Math.sin(f) * 0.5, hl = Math.hypot(hx, hz) || 1;
      vx = hx / hl * 9; vz = hz / hl * 9; vy = 3.5;
    }
    b.vx = vx; b.vy = vy; b.vz = vz; b.wx = b.wy = b.wz = 0;
    b.lastTouch = p; b.passTo = null; b.lastKick = { pid: p.id, team: t, kind: 'header', t: this.time };
    b.wallHits = 0; p.noTouch = 0.25;
    this.startAction(p, 'header', {});
    this.emit({ type: 'header', pid: p.id, x: b.x, y: b.y, z: b.z });
  }

  keeperTouch(p, hd, bsp) {
    const b = this.ball;
    const a = p.action;
    let reach = 0.75, maxH = 2.35;
    let bodyDist = hd;
    if (a && a.type === 'dive') {
      // Stretched body: a segment from the hips toward the dive direction that
      // EXTENDS over ~0.3 s — a keeper can't be full length the instant he reacts.
      // The hips themselves travel with the dive (~1.7 m), so the segment is only
      // the torso and arms: fingertip reach ends up ≈ 3.2 m from where he stood.
      if (a.t < 0.03 || a.t > 0.8) return false;
      const ext = smooth(clamp((a.t - 0.03) / 0.3, 0, 1));
      const len = 0.3 + 0.82 * ext;
      const ex = p.x + a.dx * len, ez = p.z + a.dz * len;
      const dx = ex - p.x, dz = ez - p.z, l2 = dx * dx + dz * dz;
      const t = clamp(((b.x - p.x) * dx + (b.z - p.z) * dz) / l2, 0, 1);
      bodyDist = Math.hypot(b.x - (p.x + dx * t), b.z - (p.z + dz * t));
      reach = 0.3 + 0.12 * ext; maxH = a.high ? 2.5 : 1.4;
    }
    if (bodyDist > reach || b.y > maxH) return false;
    const keeping = p.attrs.keeping * (this.isGB(1 - p.team) ? 0.72 : 1);   // a GAMEBREAKER strike is hard to hold
    // Fast balls get parried, not held; rebounds off the cage are harder to hold still.
    const redirected = b.redirectT && this.time - b.redirectT < 1.2;
    const catchMax = 9 + 11 * keeping - (a?.type === 'dive' ? 4 : 0) - (redirected ? 3 : 0);
    const shotSpeed = Math.hypot(b.vx, b.vy, b.vz);
    const wasShot = b.lastKick && b.lastKick.team !== p.team && ['shot', 'volley', 'header'].includes(b.lastKick.kind);
    if (shotSpeed < catchMax) {
      this.gainPossession(p, true);
      b.inHands = true;
      p.faceTarget = null;
      if (wasShot) { this.teams[p.team].stats.saves++; this.emit({ type: 'save', kind: 'catch', pid: p.id, x: b.x, y: b.y, z: b.z }); }
      else this.emit({ type: 'claim', pid: p.id });
      return true;
    }
    // Parry: push it away from goal and wide.
    const away = this.teams[p.team].dir;
    const side = b.z >= p.z ? 1 : -1;
    b.vx = away * shotSpeed * (0.25 + this.rand() * 0.15);
    b.vz = side * shotSpeed * (0.2 + this.rand() * 0.25);
    b.vy = 1.5 + this.rand() * 3;
    b.wx = b.wy = b.wz = 0;
    b.lastTouch = p; b.passTo = null; p.noTouch = 0.35;
    this.teams[p.team].stats.saves++;
    this.emit({ type: 'save', kind: 'parry', pid: p.id, x: b.x, y: b.y, z: b.z, speed: shotSpeed });
    return true;
  }

  onGoal(e) {
    const b = this.ball;
    // Ball in the +x goal = a goal for the team attacking +x.
    const scoringTeam = this.teams[0].dir === e.side ? 0 : 1;
    const kick = b.lastKick;
    const touch = b.lastTouch;
    // A deflection off a defender still counts for the shooter; it's only an own goal
    // if the scoring side didn't make the last deliberate kick.
    const own = !!touch && touch.team !== scoringTeam && (!kick || kick.team !== scoringTeam);
    const scorer = own ? touch : (kick && kick.team === scoringTeam ? this.players.find(p => p.id === kick.pid) : touch);
    const cage = b.wallHits > 0 && !own;
    const T = this.teams[scoringTeam];
    T.score++;
    if (cage) T.stats.cageGoals++;
    if (scorer && !own) scorer.st.g++;
    this.goalLog.push({ team: scoringTeam, scorer: scorer ? scorer.id : -1, name: scorer ? scorer.name : '', own, cage, at: this.elapsed() });
    this.addStyle(scoringTeam, cage ? STYLE.points.cagegoal : STYLE.points.goal, null, scorer);
    this.goalInfo = { team: scoringTeam, scorer, own, cage, wallHits: b.wallHits, t: this.time, done: false, gamebreaker: this.isGB(scoringTeam) };
    this.loseBall();
    this.phase = 'goal';
    this.phaseT = 2.6;
    for (const p of this.players) { p.closeControl = false; p.jockey = false; p.faceTarget = null; }
    if (scorer && scorer.team === scoringTeam) this.startAction(scorer, 'celebrate', {});
    this.emit({ type: 'goal', team: scoringTeam, scorer: scorer ? scorer.id : -1, own, cage, wallHits: b.wallHits, speed: e.speed });

    // Modes
    const m = this.opts.mode;
    if (m === 'firstto' && T.score >= this.opts.firstTo) this.goalInfo.final = true;
    if (m === 'lms') {
      const left = this.teamPlayers(scoringTeam).filter(p => p.line !== 'GK');
      if (left.length <= 1) this.goalInfo.final = true;
      else {
        // Score a goal, lose a player: the scorer's team drops its least-involved
        // outfielder (ties: the deepest goes first).
        const inv = p => p.st.g * 4 + p.st.sh + p.st.sk + p.st.tk + p.st.to * 0.5;
        const drop = left.filter(p => p !== scorer).sort((a, c) => inv(a) - inv(c) || a.form.x - c.form.x)[0];
        this.goalInfo.dropped = drop.id;
      }
    }
  }

  // Called by the game layer after the replay.
  resumeAfterGoal() {
    const g = this.goalInfo;
    if (!g) return;
    if (g.dropped != null) {
      const p = this.players.find(q => q.id === g.dropped);
      p.active = false; p.x = 0; p.z = PITCH.halfW + 3;
      this.emit({ type: 'playerOut', pid: p.id });
    }
    if (g.final) { this.fullTime(); return; }
    this.goalInfo = null;
    this.kickoff(1 - g.team);
  }

  // ------------------------------------------------------------------ out of play & restarts
  // One explicit state machine for every restart — KICKOFF · THROW_IN · CORNER · GOAL_KICK:
  //   DEAD   the ball is out: it runs on (to the boards), players pull up, the call is made
  //   SETUP  the ball is placed, the taker stands at it, everyone takes his spot
  //   READY  live the moment the taker plays it (the human's input or the AI's choice)
  // Who restarts, and from where, comes from the last touch and the pitch; the distance
  // opponents keep comes from the laws (the pitch's centre-circle radius).
  onOut(e) {
    const b = this.ball, lt = b.lastTouch;
    const last = lt ? lt.team : b.lastKick ? b.lastKick.team : 0;
    if (e.line === 'touch') {
      const x = clamp(e.x, -PITCH.halfL + 0.3, PITCH.halfL - 0.3);
      this.beginRestart('THROW_IN', 1 - last, { x, z: e.side * PITCH.halfW });
      return;
    }
    const defending = this.teams[0].dir === -e.side ? 0 : 1;      // whose goal line it crossed
    const zs = Math.sign(e.z) || 1;
    if (last === defending) this.beginRestart('CORNER', 1 - defending, cornerSpot(e.side, zs));
    else this.beginRestart('GOAL_KICK', defending, goalKickSpot(e.side, zs));
  }

  beginRestart(type, team, spot) {
    const b = this.ball;
    if (b.owner && type !== 'KICKOFF') this.loseBall();
    b.passTo = null; b.flair = null; b.through = null; b.restartTaker = null;
    for (const p of this.players) { p.closeControl = false; p.jockey = false; p.cushion = false; p.touchDir = null; }
    this.restart = { type, team, spot, taker: null, state: type === 'KICKOFF' ? 'SETUP' : 'DEAD', t: 0, readyT: 0, aiAt: 0 };
    this.phase = 'restart';
    if (type === 'KICKOFF') return;
    this.teams[team].stats[RESTART_STAT[type]]++;
    this.emit({ type: 'whistle', kind: 'out' });
    this.emit({ type: 'restart', kind: type, team, x: spot.x, z: spot.z });
  }

  // Who takes it: the keeper takes goal kicks; the best crosser among the wide and
  // attacking players takes corners; the nearest man (wide players first) throws in.
  restartTaker(r) {
    const team = this.teamPlayers(r.team), out = team.filter(p => p.line !== 'GK');
    const d = p => Math.hypot(p.x - r.spot.x, p.z - r.spot.z);
    if (r.type === 'GOAL_KICK') return this.keeper(r.team) || out.sort((a, c) => d(a) - d(c))[0];
    if (r.type === 'CORNER') {
      const crossers = out.filter(p => p.line !== 'DEF' || p.roleDef.width >= 0.9);
      return (crossers.length ? crossers : out).sort((a, c) => (c.attrs.pass * 2 + c.attrs.skill) - (a.attrs.pass * 2 + a.attrs.skill) || d(a) - d(c))[0];
    }
    return out.sort((a, c) => (d(a) - (a.roleDef.width >= 0.9 ? 6 : 0)) - (d(c) - (c.roleDef.width >= 0.9 ? 6 : 0)))[0];
  }

  // SETUP: the ball on its spot and the taker at it — a broadcast cut — then the AI puts
  // everyone on his spot for this set piece.
  placeRestart() {
    const r = this.restart, b = this.ball;
    const taker = r.taker = this.restartTaker(r);
    const sp = r.spot;
    // The taker faces into the field: square from the touch line, at the goal from a
    // corner flag, upfield from a goal kick.
    const ang = r.type === 'THROW_IN' ? Math.atan2(-Math.sign(sp.z), 0)
      : r.type === 'CORNER' ? Math.atan2(-sp.z, Math.sign(sp.x) * (PITCH.halfL - PITCH.boxR * 0.6) - sp.x)
      : Math.atan2(-sp.z * 0.3, -sp.x);
    const fx = Math.cos(ang), fz = Math.sin(ang);
    if (r.type === 'THROW_IN') { taker.x = sp.x; taker.z = sp.z + Math.sign(sp.z) * 0.25; }
    else { taker.x = sp.x - fx * 0.45; taker.z = sp.z - fz * 0.45; }
    Object.assign(taker, { vx: 0, vz: 0, speed: 0, heading: ang, facing: ang, action: null, stun: 0, noTouch: 0 });
    Object.assign(b, { x: sp.x, z: sp.z, y: R, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, goal: 0, net: 0, out: false, wallHits: 0, redirectT: 0 });
    this.gainPossession(taker, true);
    b.inHands = r.type === 'THROW_IN';
    b.x = sp.x; b.z = sp.z;
    r.state = 'SETUP'; r.t = 0;
    this.ai.planRestart(r);
    this.keepDistance(r);
    this.emit({ type: 'restartSet', kind: r.type, team: r.team, x: sp.x, z: sp.z });
  }

  stepRestart(dt) {
    const r = this.restart, b = this.ball;
    r.t += dt;
    if (r.type === 'KICKOFF') {
      // Everyone set and still; the whistle goes after a beat and the taker has it.
      for (const p of this.players) { p.move.speed = 0; movePlayer(p, dt, 0); }
      this.dribble(b.owner, dt);
      if (r.t >= RESTART.kickoff) { this.restart = null; this.phase = 'play'; this.emit({ type: 'whistle', kind: 'start' }); }
      return;
    }
    // The clock runs through stoppages (no time-wasting at throw-ins).
    if (this.opts.mode === 'timed') { this.clock -= dt; if (this.clock <= 0) { this.clock = 0; this.fullTime(); return; } }
    if (r.state === 'DEAD') for (const p of this.players) { if (!p.human) { p.move.speed = 0; p.sprinting = false; } }
    else {
      this.ai.update(dt);
      if (this.restart !== r) return;          // the AI took it this tick
    }
    for (const p of this.players) {
      if (!p.active) continue;
      this.updateAction(p, dt);
      const a = p.action;
      const lock = a ? ACTIONS[a.type].lock : p === r.taker && r.state !== 'DEAD' ? 0 : 1;
      if (!(a && ACTIONS[a.type].selfMove)) movePlayer(p, dt, lock);
      p.steer = null;
    }
    separatePlayers(this.players);
    if (r.state === 'DEAD') {
      // The dead ball runs on into the run-off (boards); no goals, no new restarts.
      const ev = [];
      stepBall(b, dt, ev);
      for (const e of ev) if (e.type === 'board' || e.type === 'bounce' || e.type === 'net') this.emit(e);
      if (r.t >= RESTART.dead) this.placeRestart();
      return;
    }
    this.keepDistance(r);
    this.dribble(b.owner, dt);
    if (r.state === 'SETUP' && r.t >= RESTART.setup) {
      r.state = 'READY'; r.readyT = 0;
      r.aiAt = RESTART.aiThink[0] + this.rand() * (RESTART.aiThink[1] - RESTART.aiThink[0]);
      this.emit({ type: 'restartReady', kind: r.type, team: r.team, pid: r.taker.id });
    } else if (r.state === 'READY') {
      r.readyT += dt;
      // A human taker gets time to pick his ball; then it's taken for him.
      if (r.taker.human && r.readyT > RESTART.autoTake) this.ai.decideRestart(r.taker);
    }
  }

  // The laws' distances while a restart is set: opponents stand off the ball (2 m at a
  // throw-in, the centre-circle radius at a corner) and outside the penalty area at a
  // goal kick. Applies to the human's man too.
  keepDistance(r) {
    const gx = this.ownGoalX(r.team), s = Math.sign(gx), ka = PITCH.keeperArea;
    const dist = r.type === 'THROW_IN' ? RESTART.throwDist : PITCH.centreR;
    for (const p of this.players) {
      if (!p.active || p.team === r.team) continue;
      if (r.type === 'GOAL_KICK') {
        if (!inKeeperArea(p.x, p.z, gx, 0.6)) continue;
        if (ka.kind === 'arc') { const dx = p.x - gx, dz = p.z, d = Math.hypot(dx, dz) || 1, k = (ka.radius + 0.6) / d; p.x = gx + dx * k; p.z = dz * k; }
        else {
          const inX = ka.depth + 0.6 - (gx - p.x) * s, inZ = ka.width / 2 + 0.6 - Math.abs(p.z);
          if (inX < inZ) p.x -= s * inX; else p.z = Math.sign(p.z || 1) * (ka.width / 2 + 0.6);
        }
        continue;
      }
      const dx = p.x - r.spot.x, dz = p.z - r.spot.z, d = Math.hypot(dx, dz);
      if (d < dist) { const k = dist / (d || 1); p.x = r.spot.x + (d ? dx * k : -s * dist); p.z = r.spot.z + dz * k; }
    }
  }

  // The taker plays it: the ball is live, and he can't touch it again until someone else has.
  // kind: 'throwin' at a throw-in, else a kick ('pass' / 'lob' / 'clear').
  takeRestart(p, kind, params = {}) {
    const r = this.restart;
    if (this.phase !== 'restart' || !r || r.state !== 'READY' || p !== r.taker || p.action) return false;
    this.restart = null; this.phase = 'play';
    let ok;
    if (r.type === 'THROW_IN') {
      const target = params.receiver ? this.leadTarget(p, params.receiver, false) : params.target;
      this.startAction(p, 'throwin', { target, receiver: params.receiver || null });
      ok = true;
    } else ok = this.requestKick(p, kind, params);
    if (!ok) { this.restart = r; this.phase = 'restart'; return false; }
    this.ball.restartTaker = p;
    return true;
  }

  // ------------------------------------------------------------------ style & GAMEBREAKER
  // Style fills the meter; a full meter is a GAMEBREAKER in the bank. Like FIFA
  // Street, the player chooses the moment to fire it (activateGB) — it never
  // triggers on its own, and it's a boost, not a win button.
  addStyle(team, pts, label, p) {
    const T = this.teams[team];
    if (label) this.emit({ type: 'style', team, pts, label, pid: p ? p.id : -1 });
    if (T.gb > 0 || T.gbReady) return;
    T.style = Math.min(STYLE.meterMax, T.style + pts);
    if (T.style >= STYLE.meterMax) {
      T.gbReady = true;
      this.emit({ type: 'gbReady', team });
    }
  }

  activateGB(team) {
    const T = this.teams[team];
    if (!T.gbReady || T.gb > 0 || this.phase !== 'play') return false;
    T.gbReady = false; T.style = 0; T.gb = STYLE.gamebreakerSecs;
    this.emit({ type: 'gamebreaker', team });
    return true;
  }

  // ------------------------------------------------------------------ actions
  startAction(p, type, params = {}) {
    const def = ACTIONS[type];
    p.action = { type, t: 0, dur: params.dur ?? def.dur, contact: params.contact ?? def.contact, fired: false, ghost: !!def.ghost, ...params };
    const b = this.ball;
    if (b.owner === p && p.dribble.mode === 'knock' && def.contact < 1) {
      // The ball is a stride ahead: time the strike for when the foot gets there.
      const gap = Math.hypot(b.x - p.x, b.z - p.z) - 0.5;
      const along = b.vx * Math.cos(p.heading) + b.vz * Math.sin(p.heading);
      const extra = gap > 0 ? clamp(gap / Math.max(1.5, p.speed - along + 1.5), 0, 0.35) : 0;
      p.action.contact += extra; p.action.dur += extra;
    }
    if (['pass', 'through', 'lob', 'shot', 'volley', 'clear', 'throw', 'throwin'].includes(type)) this.emit({ type: 'windup', pid: p.id, kind: type });
    return p.action;
  }

  canAct(p) {
    return p.active && p.stun <= 0 && (!p.action || ['celebrate'].includes(p.action.type) === false && p.action.t >= p.action.dur * 0.7);
  }

  updateAction(p, dt) {
    const a = p.action;
    if (!a) return;
    a.t += dt;
    if (!a.fired && a.t >= a.contact) { a.fired = true; this.fireAction(p, a); }
    this.actionTick(p, a, dt);
    if (a.t >= a.dur && p.action === a) {
      p.action = null;
      if (a.type === 'slide') this.startAction(p, 'getup');
      if (a.type === 'dive' && !(this.ball.owner === p)) this.startAction(p, 'getup', { dur: 0.35 });
    }
  }

  // Continuous per-tick behaviour of an action.
  actionTick(p, a, dt) {
    if (a.type === 'slide') {
      const s = a.t < 0.55 ? 9.2 * (1 - a.t / 0.62) + 1.2 : 0;
      p.speed = s; p.heading = p.facing;
      p.vx = Math.cos(p.facing) * s; p.vz = Math.sin(p.facing) * s;
      p.x += p.vx * dt; p.z += p.vz * dt;
      clampToArea(p);
      if (a.t > 0.06 && a.t < 0.62 && !a.hit) this.slideContact(p, a);
    } else if (a.type === 'roulette') {
      // Spin 360 while carrying the ball sideways; can't be tackled mid-spin.
      const s = a.t < 0.55 ? 3.6 : 0.5;
      p.vx = a.sx * s + Math.cos(a.base) * 1.2; p.vz = a.sz * s + Math.sin(a.base) * 1.2;
      p.x += p.vx * dt; p.z += p.vz * dt; p.speed = Math.hypot(p.vx, p.vz);
      p.facing = a.base + clamp(a.t / 0.58, 0, 1) * TAU * a.spinDir;
      clampToArea(p);
      if (a.t >= a.dur - dt) { p.facing = a.base; p.heading = a.base; }
    } else if (a.type === 'dive') {
      const s = a.t > 0.05 && a.t < 0.5 ? a.speed * (1 - (a.t - 0.05) / 0.5) : 0;
      p.vx = a.dx * s; p.vz = a.dz * s; p.speed = s;
      p.x += p.vx * dt; p.z += p.vz * dt;
      clampToArea(p);
    } else if (a.type === 'dragback' && !a.turned && a.t > 0.28) {
      a.turned = true;
      p.facing = wrapAngle(p.facing + Math.PI); p.heading = p.facing; p.speed = 0.5;
      p.dribble.f = 0.4; p.dribble.lat = 0;
    } else if (a.type === 'celebrate') {
      // handled by AI celebrate()
    }
  }

  fireAction(p, a) {
    switch (a.type) {
      case 'pass': case 'through': case 'lob': case 'shot': case 'volley': case 'clear': case 'throw': case 'throwin':
        return this.fireKick(p, a);
      case 'tackle': return this.fireTackle(p, a);
      case 'stepover': return this.fireStepover(p, a);
      case 'rainbow': case 'flickup': return this.fireFlick(p, a);
      case 'panna': return this.firePanna(p, a);
      case 'dragback': case 'roulette':
        this.skillDone(p, a.type);
        return;
    }
  }

  ballReachable(p, maxH = 1.0) {
    const b = this.ball;
    if (b.owner === p) return true;
    if (b.owner) return false;
    return Math.hypot(b.x - p.x, b.z - p.z) < PLAYER.kickReach && b.y < maxH;
  }

  // ------------------------------------------------------------------ kicks
  fireKick(p, a) {
    const b = this.ball;
    const maxH = a.type === 'volley' ? 1.5 : 1.0;
    if (!this.ballReachable(p, maxH)) { this.emit({ type: 'whiff', pid: p.id }); return; }
    const wasOwner = b.owner === p;
    if (wasOwner) this.loseBall();
    b.inHands = false;
    const T = this.teams[p.team];
    let v;
    const noise = (s) => (this.rand() - 0.5) * 2 * s;

    if (a.type === 'shot' || a.type === 'volley') {
      v = this.planShot(p, a.aim, false);
      let near = 99;
      for (const o of this.opponents(p)) near = Math.min(near, Math.hypot(o.x - p.x, o.z - p.z));
      // A manually aimed strike (the player lined it up with the preview) is honoured
      // closely; assisted shots carry the usual error and can be over-hit.
      const manual = a.aim.mode === 'manual';
      const err = manual
        ? 0.004 + (1 - p.attrs.shot) * 0.02 + (near < 1.5 ? 0.01 : 0)
        : 0.016 + (1 - p.attrs.shot) * 0.07 + Math.max(0, a.aim.power - 0.9) * 0.25 + (a.type === 'volley' ? 0.04 : 0) + (p.stamina < 0.3 ? 0.02 : 0) + (near < 1.5 ? 0.025 : 0);
      // Banks aim at a big target (the cage), so the strike itself is more forgiving.
      const e = (this.isGB(p.team) ? err * 0.25 : err) * (a.aim.bank ? 0.55 : 1);
      const ang = noise(e), c = Math.cos(ang), s = Math.sin(ang);
      const vx = v.vx * c - v.vz * s, vz = v.vx * s + v.vz * c;
      v.vx = vx; v.vz = vz; v.vy += noise(e * 12) + (manual ? 0 : Math.max(0, a.aim.power - 0.92) * 3);
      T.stats.shots++; p.st.sh++;
    } else if (a.type === 'throwin') {
      // Both hands, from over the head: it loops, and only goes so far.
      b.y = 2.12;
      const L = solveLob(b.x, b.y, b.z, a.target.x, a.target.z, KICK.throwElev, 0);
      const k = Math.min(1, KICK.throwMax / Math.hypot(L.vx, L.vy, L.vz));
      v = { vx: L.vx * k, vy: L.vy * k, vz: L.vz * k, wy: 0 };
      T.stats.passes++;
    } else if (a.type === 'throw') {
      const d = Math.hypot(a.target.x - b.x, a.target.z - b.z) || 1;
      const s = groundPassSpeed(d, 5);
      b.y = 0.5;
      v = { vx: (a.target.x - b.x) / d * s, vy: 0.6, vz: (a.target.z - b.z) / d * s, wy: 0 };
    } else if (a.type === 'lob' || a.type === 'clear') {
      const L = solveLob(b.x, Math.max(b.y, R), b.z, a.target.x, a.target.z, a.type === 'clear' ? 0.5 : 0.58, a.type === 'clear' ? KICK.lobSpin * 0.5 : KICK.lobSpin);
      const e = (1 - p.attrs.pass) * 0.06;
      const ang = noise(e), c = Math.cos(ang), s = Math.sin(ang);
      v = { vx: L.vx * c - L.vz * s, vy: L.vy * (1 + noise(e)), vz: L.vx * s + L.vz * c, wx: L.wx * c - L.wz * s, wy: 0, wz: L.wx * s + L.wz * c };
      if (a.type === 'lob') T.stats.passes++;          // clearances aren't passes
    } else if (a.angle != null) {
      // Played at an explicit angle (wall pass off the cage).
      const e = (1 - p.attrs.pass) * 0.03;
      const ang = a.angle + noise(e), s = a.speed ?? 14;
      v = { vx: Math.cos(ang) * s, vy: 0, vz: Math.sin(ang) * s, wy: 0 };
      T.stats.passes++;
    } else {
      // Ground pass / through ball, aimed at the receiver's predicted run.
      const tgt = a.receiver ? this.leadTarget(p, a.receiver, a.type === 'through') : a.target;
      const dx = tgt.x - b.x, dz = tgt.z - b.z, d = Math.hypot(dx, dz) || 1;
      let s = a.speed ?? clamp(groundPassSpeed(d, a.type === 'through' ? 7 : 6 + d * 0.2), KICK.passMin, KICK.passMax);
      if (a.power != null) s = clamp(s * (0.85 + 0.5 * a.power), KICK.passMin, KICK.passMax + 6);
      const e = (1 - p.attrs.pass) * 0.05 + (a.flair ? 0.02 : 0);
      const ang = Math.atan2(dz, dx) + noise(e);
      v = { vx: Math.cos(ang) * s, vy: 0, vz: Math.sin(ang) * s, wy: 0 };
      T.stats.passes++;
    }

    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
    b.wx = v.wx || 0; b.wy = v.wy || 0; b.wz = v.wz || 0;
    // Passes along the ground are struck through the middle: they leave rolling, not skidding.
    if (v.vy === 0 && !v.wx && !v.wz) { b.wx = b.vz / R; b.wz = -b.vx / R; }
    if (b.y < R) b.y = R;
    b.lastTouch = p;
    b.lastKick = { pid: p.id, team: p.team, kind: a.type === 'volley' ? 'shot' : a.type === 'shot' ? 'shot' : a.type, t: this.time, power: a.aim?.power ?? 0.5 };
    b.wallHits = 0;
    b.passTo = a.receiver || null;
    b.passUntil = this.time + 2.2;
    p.noTouch = 0.24;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    if (a.type === 'shot' || a.type === 'volley') {
      const onT = predictPath(b, 3, 1 / 60).goal === T.dir;
      if (onT) T.stats.onTarget++;
      // A GAMEBREAKER strike gets the slow-motion treatment (it can still be saved).
      if (this.isGB(p.team)) this.emit({ type: 'gbStrike', pid: p.id, team: p.team, x: b.x, z: b.z, onTarget: onT });
      if (a.aim.finesse) this.addStyle(p.team, STYLE.points.finesse, null, p);
    }
    this.emit({ type: 'kick', pid: p.id, kind: a.type, speed, x: b.x, y: b.y, z: b.z, finesse: !!a.aim?.finesse, flair: !!a.flair });
  }

  // Receiver lead: aim where the receiver will be when the ball arrives.
  leadTarget(p, r, through) {
    const b = this.ball;
    let tx = r.x, tz = r.z;
    for (let i = 0; i < 3; i++) {
      const d = Math.hypot(tx - b.x, tz - b.z);
      const s = clamp(groundPassSpeed(d, through ? 7 : 6 + d * 0.2), KICK.passMin, KICK.passMax);
      const t = Math.min(rollTime(s, d), 2.5);
      if (through) {
        // lead into space toward goal along the run
        const dir = this.teams[r.team].dir;
        const rx = r.speed > 1 ? r.vx : dir * 5, rz = r.speed > 1 ? r.vz : 0;
        const rl = Math.hypot(rx, rz) || 1;
        const runS = Math.max(r.speed, 5.5);
        tx = r.x + rx / rl * runS * (t + KICK.throughLead * 0.4);
        tz = r.z + rz / rl * runS * (t + KICK.throughLead * 0.4);
      } else {
        tx = r.x + r.vx * t * 0.85; tz = r.z + r.vz * t * 0.85;
      }
    }
    return { x: clamp(tx, -PITCH.halfL + 0.8, PITCH.halfL - 0.8), z: clamp(tz, -PITCH.halfW + 0.8, PITCH.halfW - 0.8) };
  }

  // Shot planning — shared by the human preview, the human strike and the AI.
  // aim: { mode: 'assist'|'manual', tz, ty, angle, power, finesse, chip, bank }
  planShot(p, aim, forPreview = true) {
    const b = forPreview && this.ball.owner === p ? this.ball : this.ball;
    const gb = this.isGB(p.team);
    const gx = this.oppGoalX(p.team);
    const power = clamp(aim.power, 0, 1);
    let speed = (KICK.shotMin + (KICK.shotMax - KICK.shotMin) * power) * (0.86 + 0.16 * p.attrs.shot) * (gb ? 1.15 : 1);
    const start = { x: b.x, y: Math.max(b.y, R), z: b.z };

    if (aim.mode === 'manual') {
      // Straight where you point it — the cage-bank shot. Low and driven (a
      // lofted ball would bounce mid-path and die before the rebound).
      const vy = 0.25 + power * 0.55;
      return { vx: Math.cos(aim.angle) * speed, vy, vz: Math.sin(aim.angle) * speed, wy: 0 };
    }
    if (aim.chip) {
      // Scooped under the ball: heavy backspin floats it and checks it on landing.
      speed = 10 + 5 * power;
      const s = solveStrike(start, gx, 1.55, aim.tz, speed, { iters: 5, bs: KICK.chipSpin });
      return { vx: s.vx, vy: s.vy, vz: s.vz, wx: s.wx, wy: 0, wz: s.wz };
    }
    if (aim.finesse) {
      speed *= KICK.finessePower;
      const dirX = Math.sign(gx - start.x) || 1;
      const wy = Math.sign(aim.tz - start.z || 1) * dirX * KICK.finesseSpin * (0.7 + 0.3 * p.attrs.shot);
      const s = solveStrike(start, gx, aim.ty ?? 0.9, aim.tz, speed, { wy, iters: 6 });
      return { vx: s.vx, vy: s.vy, vz: s.vz, wy };
    }
    const s = solveStrike(start, gx, aim.ty ?? 0.7, aim.tz, speed, { angle0: aim.bank ? aim.angle : null, iters: 6 });
    return { vx: s.vx, vy: s.vy, vz: s.vz, wy: 0 };
  }

  // Build the aim for a human shot from stick + power + modifiers.
  // Stick within ~40° of the goal = assisted (stick picks the post).
  // Stick pointed elsewhere (at the cage) = manual — the ball goes exactly there.
  humanAim(p, stickX, stickZ, power, finesse, chip) {
    const b = this.ball;
    const gx = this.oppGoalX(p.team);
    const toGoal = Math.atan2(-b.z, gx - b.x);
    const hasStick = Math.hypot(stickX, stickZ) > 0.2;
    const sAng = hasStick ? Math.atan2(stickZ, stickX) : toGoal;
    const off = angleDiff(toGoal, sAng);
    if (hasStick && Math.abs(off) > 0.7 && !chip && !finesse) {
      return { mode: 'manual', angle: sAng, power };
    }
    // Assisted: stick lateral picks the post; neutral = the side away from the keeper.
    // Post targets sit 0.45 m inside the posts (whatever the goal's size).
    let tz;
    const post = PITCH.goalHalfW - 0.45;
    if (hasStick && Math.abs(off) > 0.12) tz = Math.sign(off) * Math.sign(gx) * post;
    else {
      const gk = this.keeper(1 - p.team);
      tz = (gk ? (gk.z > 0 ? -1 : 1) : (b.z > 0 ? -1 : 1)) * (post - 0.05);
    }
    return { mode: 'assist', tz, ty: finesse ? 0.95 : 0.55 + power * 0.5, power, finesse, chip };
  }

  // ------------------------------------------------------------------ tackles
  fireTackle(p, a) {
    const b = this.ball;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const footX = p.x + fx * 0.55, footZ = p.z + fz * 0.55;
    const dBall = Math.hypot(b.x - footX, b.z - footZ);
    const o = b.owner;
    this.teams[p.team].stats.tackles++;
    if (!o) {
      if (dBall < 0.8 && b.y < 0.6) this.gainPossession(p);
      return;
    }
    if (o.team === p.team || b.inHands) return;
    if (dBall > 0.95 || (o.action && ACTIONS[o.action.type].immune)) {
      this.emit({ type: 'tackle', ok: false, pid: p.id, x: b.x, z: b.z });
      return;
    }
    // From the front is cleaner than from behind.
    const toTackler = Math.atan2(p.z - o.z, p.x - o.x);
    const front = Math.cos(angleDiff(o.facing, toTackler));
    let chance = 0.32 + 0.55 * p.attrs.tackle - 0.32 * o.attrs.control + 0.14 * front + (o.closeControl ? -0.12 : 0) + (o.possessT < 0.3 ? 0.1 : 0);
    if (this.isGB(o.team)) chance -= 0.15;
    if (this.rand() < clamp(chance, 0.08, 0.9)) {
      if (this.rand() < 0.55) this.gainPossession(p);
      else {
        this.loseBall();
        b.vx = fx * 4 + (this.rand() - 0.5) * 3; b.vz = fz * 4 + (this.rand() - 0.5) * 3; b.vy = 0.6;
        b.lastTouch = p; p.noTouch = 0.1;
      }
      o.stun = 0.3; this.startAction(o, 'stumble', { dur: 0.45 });
      o.noTouch = 0.35;
      this.emit({ type: 'tackle', ok: true, pid: p.id, victim: o.id, x: b.x, z: b.z });
    } else {
      p.stun = 0.22;
      this.emit({ type: 'tackle', ok: false, pid: p.id, x: b.x, z: b.z });
    }
  }

  slideContact(p, a) {
    const b = this.ball;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const footX = p.x + fx * 0.75, footZ = p.z + fz * 0.75;
    const o = b.owner;
    if (!(o && o.team === p.team) && !b.inHands && b.y < 0.55 && Math.hypot(b.x - footX, b.z - footZ) < 0.6) {
      if (o && o.action && ACTIONS[o.action.type].immune) return;
      a.hit = true;
      if (o) { this.loseBall(); o.noTouch = 0.45; this.startAction(o, 'stumble', { dur: 0.7 }); o.stun = 0.5; }
      const side = (this.rand() - 0.5) * 4;
      b.vx = fx * 6.5 - fz * side; b.vz = fz * 6.5 + fx * side; b.vy = 1.0;
      b.lastTouch = p; b.passTo = null;
      this.teams[p.team].stats.tackles++;
      this.emit({ type: 'tackle', ok: true, slide: true, pid: p.id, victim: o ? o.id : -1, x: b.x, z: b.z });
      return;
    }
    // Clip a player without the ball — no fouls in the cage, but he goes down.
    for (const q of this.opponents(p)) {
      if (q.action && (q.action.type === 'stumble' || q.action.type === 'getup')) continue;
      if (Math.hypot(q.x - footX, q.z - footZ) < 0.55) {
        a.hit = true;
        this.startAction(q, 'stumble', { dur: 0.75 }); q.stun = 0.55;
        if (b.owner === q) { this.loseBall(); b.vx = fx * 3; b.vz = fz * 3; }
        this.emit({ type: 'trip', pid: p.id, victim: q.id });
        return;
      }
    }
  }

  // ------------------------------------------------------------------ skills
  skillDone(p, name) {
    const pts = STYLE.points[name] || 20;
    this.teams[p.team].stats.skills++; p.st.sk++;
    this.addStyle(p.team, pts, SKILL_NAMES[name], p);
  }

  fireStepover(p, a) {
    // Defenders in front may "bite" on the feint and lurch the wrong way.
    for (const d of this.opponents(p)) {
      const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > 3.4) continue;
      const ang = Math.abs(angleDiff(p.facing, Math.atan2(dz, dx)));
      if (ang > 1.1) continue;
      const chance = 0.22 + 0.6 * p.attrs.skill - 0.3 * d.attrs.tackle + (this.isGB(p.team) ? 0.2 : 0);
      if (this.rand() < chance) {
        const side = a.side || 1;
        d.heading = p.facing + side * Math.PI / 2; d.speed = 2.5;
        d.stun = 0.55; this.startAction(d, 'stumble', { dur: 0.55 });
        this.emit({ type: 'beaten', pid: d.id, by: p.id });
      }
    }
    this.skillDone(p, 'stepover');
    p.speed = Math.max(p.speed, 4);
  }

  fireFlick(p, a) {
    const b = this.ball;
    if (b.owner !== p) return;
    this.loseBall();
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    if (a.type === 'rainbow') {
      b.vx = fx * 6.2 + p.vx * 0.35; b.vz = fz * 6.2 + p.vz * 0.35; b.vy = 6.4;
      b.flair = { pid: p.id, until: this.time + 1.25 };
    } else {
      b.vx = fx * 0.6 + p.vx * 0.9; b.vz = fz * 0.6 + p.vz * 0.9; b.vy = 4.3;
      b.flair = { pid: p.id, until: this.time + 0.95 };
    }
    b.x = p.x + fx * 0.35; b.z = p.z + fz * 0.35; b.y = 0.2;
    b.wx = b.wy = b.wz = 0;
    b.lastTouch = p; b.lastKick = { pid: p.id, team: p.team, kind: 'flick', t: this.time };
    p.noTouch = a.type === 'rainbow' ? 0.5 : 0.28;
    this.skillDone(p, a.type);
    this.emit({ type: 'kick', pid: p.id, kind: a.type, speed: 5, x: b.x, y: b.y, z: b.z });
  }

  firePanna(p, a) {
    const b = this.ball;
    const d = this.players.find(q => q.id === a.target);
    if (b.owner !== p || !d) return;
    const dx = d.x - b.x, dz = d.z - b.z, dist = Math.hypot(dx, dz) || 1;
    const chance = 0.3 + 0.58 * p.attrs.skill - 0.32 * d.attrs.tackle + (d.speed > 2.5 ? 0.12 : 0) + (d.jockey ? -0.1 : 0) + (this.isGB(p.team) ? 0.25 : 0);
    this.loseBall();
    const s = 7.2;
    b.vx = dx / dist * s; b.vz = dz / dist * s; b.vy = 0;
    b.lastTouch = p; b.lastKick = { pid: p.id, team: p.team, kind: 'panna', t: this.time };
    p.noTouch = 0.3;
    if (this.rand() < clamp(chance, 0.1, 0.85)) {
      // Through the legs: the defender can't touch it and is left turning.
      b.through = { pid: d.id, until: this.time + 0.8 };
      b.flair = { pid: p.id, until: this.time + 0.9 };
      d.stun = 0.85; this.startAction(d, 'stumble', { dur: 0.85 });
      this.teams[p.team].stats.pannas++;
      this.skillDone(p, 'panna');
      this.emit({ type: 'panna', pid: p.id, victim: d.id, x: d.x, z: d.z });
    } else {
      this.emit({ type: 'pannaFail', pid: p.id, victim: d.id });
    }
    this.emit({ type: 'kick', pid: p.id, kind: 'panna', speed: s, x: b.x, y: b.y, z: b.z });
  }

  // ------------------------------------------------------------------ public requests (human + AI)
  // All return true if the action started.
  requestKick(p, type, params) {
    if (!this.canAct(p) || this.phase !== 'play') return false;
    const b = this.ball;
    const mine = b.owner === p;
    if (!mine && b.restartTaker === p) return false;
    if (!mine && !this.ballReachableSoon(p, type === 'volley' ? 1.6 : 1.0)) return false;
    if (b.inHands && mine) { type = type === 'shot' ? 'clear' : type === 'lob' ? 'clear' : 'throw'; }
    if (type === 'clear' && !params.target) params.target = { x: this.oppGoalX(p.team) * 0.4, z: (this.rand() - 0.5) * 10 };
    if (type === 'throw' && params.receiver) params.target = { x: params.receiver.x, z: params.receiver.z };
    if (type === 'throw' && !params.target) return false;
    this.startAction(p, type, params);
    p.closeControl = false;
    return true;
  }

  ballReachableSoon(p, maxH) {
    const b = this.ball;
    if (b.owner) return false;
    const fx = b.x + b.vx * 0.12, fz = b.z + b.vz * 0.12;
    return Math.min(Math.hypot(b.x - p.x, b.z - p.z), Math.hypot(fx - p.x, fz - p.z)) < PLAYER.kickReach + 0.25 && b.y < maxH;
  }

  // opts.lead: a lofted through ball (lob into the receiver's run); opts.contact: longer wind-up.
  requestPass(p, dirX, dirZ, kind = 'pass', power = null, flair = false, opts = {}) {
    const extra = opts.contact != null ? { contact: opts.contact } : {};
    const r = this.pickReceiver(p, dirX, dirZ, opts.lead ? 'through' : kind);
    if (!r) {
      // No one there: play it into space in that direction.
      const hl = Math.hypot(dirX, dirZ);
      const ang = hl > 0.2 ? Math.atan2(dirZ, dirX) : p.facing;
      const dist = kind === 'lob' ? 14 : 10;
      const target = { x: clamp(p.x + Math.cos(ang) * dist, -PITCH.halfL + 1, PITCH.halfL - 1), z: clamp(p.z + Math.sin(ang) * dist, -PITCH.halfW + 1, PITCH.halfW - 1) };
      return this.requestKick(p, kind, { target, power, flair, ...extra });
    }
    const target = kind === 'lob' ? (opts.lead ? this.leadTarget(p, r, true) : { x: r.x + r.vx * 1.1, z: r.z + r.vz * 1.1 }) : null;
    return this.requestKick(p, kind, { receiver: r, target, power, flair, ...extra });
  }

  // Double-tap pass: a ground pass still winding up becomes a dinked (lofted) pass.
  dinkPass(p) {
    const a = p.action, b = this.ball;
    if (!a || a.type !== 'pass' || a.fired || a.angle != null || b.owner !== p || b.inHands) return false;
    const r = a.receiver;
    a.type = 'lob';
    if (r) a.target = { x: r.x + r.vx * 1.1, z: r.z + r.vz * 1.1 };
    a.contact = Math.max(a.t + 0.04, ACTIONS.lob.contact);
    a.dur = ACTIONS.lob.dur + (a.contact - ACTIONS.lob.contact);
    this.emit({ type: 'windup', pid: p.id, kind: 'lob' });
    return true;
  }

  // The defender a panna would go through (close, in front, not the keeper), or null.
  pannaTarget(p) {
    let target = null, bd = 3.0;
    for (const d of this.opponents(p)) {
      const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz);
      const ang = Math.abs(angleDiff(p.facing, Math.atan2(dz, dx)));
      if (dist < bd && ang < 0.8 && d.line !== 'GK') { bd = dist; target = d; }
    }
    return target;
  }

  pickReceiver(p, dirX, dirZ, kind) {
    const hl = Math.hypot(dirX, dirZ);
    const ang = hl > 0.2 ? Math.atan2(dirZ, dirX) : p.facing;
    let best = null, bestS = Infinity;
    for (const m of this.mates(p)) {
      if (m.line === 'GK' && kind !== 'pass') continue;
      const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz);
      if (d < 2) continue;
      const diff = Math.abs(angleDiff(ang, Math.atan2(dz, dx)));
      if (diff > (hl > 0.2 ? 0.95 : 1.4)) continue;
      const s = d * 0.35 + diff * 9 + (m.line === 'GK' ? 8 : 0);
      if (s < bestS) { bestS = s; best = m; }
    }
    return best;
  }

  requestShot(p, aim) {
    const type = this.ball.owner === p ? 'shot' : (this.ball.y > 0.45 ? 'volley' : 'shot');
    return this.requestKick(p, type, { aim });
  }

  requestTackle(p) {
    if (!this.canAct(p) || this.phase !== 'play') return false;
    this.startAction(p, 'tackle', {});
    return true;
  }

  requestSlide(p) {
    if (!this.canAct(p) || this.phase !== 'play' || p.speed < 2) return false;
    p.facing = p.heading;
    this.startAction(p, 'slide', {});
    return true;
  }

  requestSkill(p, name, stickX = 0, stickZ = 0) {
    if (!this.canAct(p) || this.phase !== 'play' || this.ball.owner !== p || this.ball.inHands) return false;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    if (name === 'panna') {
      // Needs a defender close in front.
      const target = this.pannaTarget(p);
      if (!target) return false;
      this.startAction(p, 'panna', { target: target.id });
      return true;
    }
    const params = {};
    if (name === 'roulette') {
      const side = (stickX * -fz + stickZ * fx) >= 0 ? 1 : -1;
      params.sx = -fz * side; params.sz = fx * side; params.base = p.facing; params.spinDir = side;
    }
    if (name === 'stepover') params.side = (stickX * -fz + stickZ * fx) >= 0 ? 1 : -1;
    this.startAction(p, name, params);
    return true;
  }

  // Keeper dive toward a lateral intercept point.
  requestDive(p, tx, tz, high, k = 1) {
    if (p.action && p.action.type === 'dive') return false;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1;
    const speed = clamp(d / 0.32, 2, 6.8) * (0.8 + 0.3 * p.attrs.keeping) * k;
    this.startAction(p, 'dive', { dx: dx / d, dz: dz / d, speed, high: !!high, side: Math.sign(dz) || 1 });
    return true;
  }
}
