// Laws on the open pitches: out of play (swept, last touch), the restart state machine
// (throw-ins, corners, goal kicks), the laws' distances, the double touch, the goal net
// from outside, and human/AI takers. The cage never goes out of play.
import { Match, SIM_DT, FakeInput } from './lib/sim.mjs';
import { HumanController } from '../src/game/human.js';
import { PITCH } from '../src/sim/pitch.js';
import { RESTART } from '../src/config.js';
import { makeBall, stepBall } from '../src/sim/ball.js';

const R = 0.11;
// A fresh open-pitch match in play with the ball loose at (x, z) and moving at v.
// spec is a function of the live pitch (it's read after the match has set it).
function loose(format, spec) {
  const m = new Match({ format, humanTeam: spec.humanTeam ?? null, seconds: 9999, seed: 5 });
  const { x, z, y = R, vx = 0, vy = 0, vz = 0, touch = 1 } = spec(PITCH);
  m.phase = 'play'; m.restart = null;
  m.loseBall();
  Object.assign(m.ball, { x, y, z, vx, vy, vz, wx: 0, wy: 0, wz: 0, out: false, net: 0, goal: 0 });
  const last = m.players.find(p => p.team === touch && p.line !== 'GK');
  m.ball.lastTouch = last;
  // everyone well away from the ball so nobody touches it on its way out
  for (const p of m.players) if (Math.hypot(p.x - x, p.z - z) < 12) { p.x = -Math.sign(x || 1) * 10; p.z = 0; }
  return m;
}
// Step until the predicate holds (or n steps); returns the events seen.
function run(m, n, until = () => false) {
  const ev = [];
  for (let i = 0; i < n && !until(); i++) { m.step(SIM_DT); ev.push(...m.drainEvents()); }
  return ev;
}

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 1) Throw-in: over the touch line off team 1 → team 0 throws in where it crossed.
  {
    const m = loose('11v11', P => ({ x: 10, z: P.halfW - 1, vx: 2, vz: 6, touch: 1 }));
    const ev = run(m, 240, () => m.restart?.state === 'READY');
    const r = m.restart, call = ev.find(e => e.type === 'restart');
    const crossX = call ? call.x : NaN;
    const near = r && m.players.filter(p => p.team !== r.team).every(p => Math.hypot(p.x - r.spot.x, p.z - r.spot.z) >= RESTART.throwDist - 1e-6);
    check('touch line: throw-in to the other side, where it crossed (swept)', r && r.type === 'THROW_IN' && r.team === 0 && Math.abs(r.spot.z) === PITCH.halfW && Math.abs(crossX - 10.33) < 0.4 && r.taker.team === 0 && m.ball.inHands && near,
      r ? `${r.type} team ${r.team} at x ${r.spot.x.toFixed(2)} (crossed ${crossX.toFixed(2)}), taker ${r.taker.name}` : 'no restart');
  }

  // 2) Corner and goal kick from the last touch over the goal line.
  {
    const a = loose('11v11', P => ({ x: P.halfL - 3, z: 12, vx: 7, touch: 1 }));   // team 1 defends +x
    const gx = PITCH.halfL;
    run(a, 240, () => a.restart?.state === 'READY');
    const ra = a.restart;
    check('over the goal line off a defender: corner, on that side', ra && ra.type === 'CORNER' && ra.team === 0 && ra.spot.x > 0 && ra.spot.z > 0 && ra.taker.team === 0,
      ra ? `${ra.type} team ${ra.team} at (${ra.spot.x.toFixed(1)}, ${ra.spot.z.toFixed(1)}) taker ${ra.taker.name} (${ra.taker.role})` : 'none');
    const defClear = ra && a.players.filter(p => p.team === 1).every(p => Math.hypot(p.x - ra.spot.x, p.z - ra.spot.z) >= PITCH.centreR - 1e-6);
    check('corner: the defending side stays the centre-circle radius off the ball', defClear, `${PITCH.centreR} m`);
    const inBox = ra ? a.players.filter(p => p.team === 0 && p !== ra.taker && Math.abs(p.x - gx) < PITCH.boxR && Math.abs(p.z) < PITCH.keeperArea.width / 2).length : 0;
    check('corner: attackers go into the box for it', inBox >= 3, `${inBox} attackers in the area`);

    const b = loose('11v11', P => ({ x: P.halfL - 3, z: -6, vx: 8, touch: 0 }));
    run(b, 240, () => b.restart?.state === 'READY');
    const rb = b.restart;
    const outOfBox = rb && b.players.filter(p => p.team === 0).every(p => !(Math.abs(p.x - gx) < PITCH.boxR && Math.abs(p.z) < PITCH.keeperArea.width / 2));
    check('over the goal line off an attacker: goal kick, taken by the keeper', rb && rb.type === 'GOAL_KICK' && rb.team === 1 && rb.taker.line === 'GK' && rb.spot.z < 0,
      rb ? `${rb.type} team ${rb.team} taker ${rb.taker.role} at (${rb.spot.x.toFixed(1)}, ${rb.spot.z.toFixed(1)})` : 'none');
    check('goal kick: opponents stay out of the penalty area', outOfBox);
  }

  // 3) The goal mouth: in between the posts is a goal; over the bar is out.
  {
    const g = loose('11v11', P => ({ x: P.halfL - 6, z: 0.5, y: 1, vx: 24, vy: 0.5, touch: 0 }));
    const ev = run(g, 120, () => g.phase !== 'play');
    const over = loose('11v11', P => ({ x: P.halfL - 6, z: 0.5, y: 3.4, vx: 24, vy: 1.5, touch: 0 }));
    const ev2 = run(over, 120, () => over.phase !== 'play');
    check('between the posts = goal (not out); over the bar = out', ev.some(e => e.type === 'goal') && !ev.some(e => e.type === 'restart') && ev2.some(e => e.type === 'restart' && e.kind === 'GOAL_KICK') && !ev2.some(e => e.type === 'goal'),
      `goal: ${ev.some(e => e.type === 'goal')} · over the bar: ${ev2.find(e => e.type === 'restart')?.kind || 'no restart'}`);
  }

  // 4) Swept detection: a 40 m/s strike just wide of the post, and a ball across the
  //    corner, are out where they crossed — never missed, never a goal.
  {
    const w = loose('11v11', P => ({ x: P.halfL - 2, z: P.goalHalfW + 0.4, y: 0.5, vx: 40, vz: 0.5, touch: 0 }));
    const ev = run(w, 60, () => w.phase !== 'play');
    const c = loose('11v11', P => ({ x: P.halfL - 1, z: P.halfW - 1, vx: 30, vz: 30.5, touch: 0 }));
    const ev2 = run(c, 60, () => c.phase !== 'play');
    const rw = ev.find(e => e.type === 'restart'), rc = ev2.find(e => e.type === 'restart');
    check('a 40 m/s strike wide of the post, and a ball across the corner, are caught going out', rw && !ev.some(e => e.type === 'goal') && rc,
      `${rw ? rw.kind : 'missed'} · corner diagonal: ${rc ? rc.kind : 'missed'}`);
  }

  // 5) The outside of the net: a ball rolled along behind the goal line into the side
  //    netting stops against it — it doesn't pass through into the goal.
  {
    new Match({ format: '11v11', humanTeam: null });          // the live pitch: full size
    const gx = PITCH.halfL, gw = PITCH.goalHalfW;
    const b = Object.assign(makeBall(), { x: gx + 0.8, z: gw + 3, vz: -6, out: true });
    const ev = [];
    for (let i = 0; i < 120; i++) stepBall(b, SIM_DT, ev);
    const inside = Math.abs(b.z) < gw && b.x > gx;
    check('the side netting is solid from outside (no goal, no passing through)', !inside && !ev.some(e => e.type === 'goal') && ev.some(e => e.type === 'net' && e.outside), `ball z ${b.z.toFixed(2)} (post at ${gw})`);
  }

  // 6) Last touch decides, not the last kick: our shot, deflected out over their goal
  //    line by their defender = our corner.
  {
    const m = loose('11v11', P => ({ x: P.halfL - 1, z: 6, vx: 9, touch: 1 }));
    const shooter = m.players.find(p => p.team === 0 && p.line === 'ATT');
    m.ball.lastKick = { pid: shooter.id, team: 0, kind: 'shot', t: m.time };   // the shot was ours…
    run(m, 240, () => m.restart?.state === 'READY');                            // …their defender touched it last
    check('last touch decides: our shot off their defender and out = our corner', m.restart && m.restart.type === 'CORNER' && m.restart.team === 0, m.restart ? `${m.restart.type} to team ${m.restart.team}` : 'none');
  }

  // 7) Carried over: a dribbler running over the touch line gives a throw-in away.
  {
    const m = new Match({ format: '9v9', humanTeam: null, seconds: 9999, seed: 7 });
    m.phase = 'play'; m.restart = null;
    const p = m.players.find(q => q.team === 0 && q.line === 'MID');
    for (const q of m.players) if (q !== p) q.frozen = true;
    p.human = true;                                  // driven by this test, not the AI
    Object.assign(p, { x: 0, z: PITCH.halfW - 1.5, heading: Math.PI / 2, facing: Math.PI / 2, speed: 2 });
    m.loseBall(); Object.assign(m.ball, { x: p.x, z: p.z + 0.45, vx: 0, vz: 0 }); m.gainPossession(p, true);
    p.closeControl = true;
    let r = null;
    for (let i = 0; i < 240 && !r; i++) { p.move.x = 0; p.move.z = 1; p.move.speed = 2.5; p.closeControl = true; m.step(SIM_DT); if (m.phase === 'restart') r = m.restart; }
    check('dribbled over the touch line: throw-in to the opponents', r && r.type === 'THROW_IN' && r.team === 1, r ? `${r.type} to team ${r.team}` : 'never called');
  }

  // 8) An AI throw-in is taken quickly, and the thrower can't touch it again first.
  {
    const m = loose('11v11', P => ({ x: -5, z: -P.halfW + 1, vz: -5, touch: 0 }));
    const ev = run(m, 6 * 120, () => m.phase === 'play' && m.ball.lastKick?.kind === 'throwin');
    const took = m.phase === 'play' && m.ball.lastKick?.kind === 'throwin';
    const thrower = took ? m.players.find(p => p.id === m.ball.lastKick.pid) : null;
    const tCall = ev.find(e => e.type === 'restart')?.time, tTook = m.time;
    let again = false;
    for (let i = 0; i < 240; i++) { m.step(SIM_DT); m.drainEvents(); if (m.ball.lastTouch !== thrower) break; if (m.ball.owner === thrower) again = true; }
    check('AI takes a throw-in in under 3.5 s; the thrower can\'t play it twice', took && tTook - tCall < 3.5 && !again, took ? `${(tTook - tCall).toFixed(2)} s, by ${thrower.name}` : 'not taken');
  }

  // 9) A human taker: PASS throws it short to the team-mate the stick points at; doing
  //    nothing, it's taken for him after the time limit.
  {
    const m = loose('11v11', Object.assign(P => ({ x: 5, z: P.halfW - 1, vz: 5, touch: 1 }), { humanTeam: 0 }));
    const inp = new FakeInput();
    const h = new HumanController(m, 0, inp);
    let i = 0;
    for (; i < 400 && !(m.restart?.state === 'READY'); i++) { inp.set([]); h.update(1 / 60); m.step(SIM_DT); m.step(SIM_DT); m.drainEvents(); }
    const r = m.restart, human = m.human;
    const mate = m.players.filter(p => p.team === 0 && p !== human && p.line !== 'GK').sort((a, c) => Math.hypot(a.x - human.x, a.z - human.z) - Math.hypot(c.x - human.x, c.z - human.z))[0];
    const sx = mate.x - human.x, sz = mate.z - human.z, sl = Math.hypot(sx, sz);
    inp.move.x = sx / sl; inp.move.y = -sz / sl;
    for (let k = 0; k < 6; k++) { inp.set(['pass']); h.update(1 / 60); m.step(SIM_DT); m.step(SIM_DT); }
    inp.set([]); h.update(1 / 60);
    const ev = run(m, 90);
    const kick = ev.find(e => e.type === 'kick');
    const reached = m.ball.passTo === mate || m.ball.lastTouch === mate;
    check('human taker: control goes to him; PASS throws it to the man the stick points at', r && r.taker === human && kick && kick.kind === 'throwin' && reached,
      kick ? `${kick.kind} by ${human.name} toward ${mate.name}` : `no throw (taker ${r?.taker?.name}, human ${human?.name})`);

    const m2 = loose('11v11', Object.assign(P => ({ x: 5, z: P.halfW - 1, vz: 5, touch: 1 }), { humanTeam: 0 }));
    const inp2 = new FakeInput();
    const h2 = new HumanController(m2, 0, inp2);
    let taken = false, t = 0;
    for (; t < (RESTART.dead + RESTART.setup + RESTART.autoTake + 2) * 60; t++) { inp2.set([]); h2.update(1 / 60); m2.step(SIM_DT); m2.step(SIM_DT); if (m2.drainEvents().some(e => e.type === 'kick' && e.kind === 'throwin')) { taken = true; break; } }
    check('a human taker who waits too long has it taken for him', taken, taken ? `after ${(t / 60).toFixed(1)} s` : 'never taken');
  }

  // 10) The cage never goes out of play: a whole 5v5 match has no restarts but kick-offs.
  {
    const m = new Match({ humanTeam: null, seconds: 90, seed: 3 });
    const kinds = new Set();
    for (let i = 0; i < 90 * 120 * 2 && m.phase !== 'fulltime'; i++) { m.step(SIM_DT); for (const e of m.drainEvents()) { if (e.type === 'restart' || e.type === 'out') kinds.add(e.type); if (e.type === 'goalDone') m.resumeAfterGoal(); } }
    check('5v5 cage: never out of play', kinds.size === 0, kinds.size ? [...kinds].join(',') : 'none in 90 s');
  }
  return out;
}
