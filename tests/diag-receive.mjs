// Reception diagnostic: does the man a pass is for take it, or run past / through it?
//   node tests/diag-receive.mjs
// 1) Human passes (the real controller): after PASS the control switches to the receiver,
//    and what the person does with the stick then decides the run. Stick styles:
//      release  stick let go after the pass (the receive assist walks him onto it)
//      hold     the stick still held the way the pass was aimed (the usual habit)
//      toBall   steering at the ball
//      across   a receiver running across, the stick held on his run
// 2) AI v AI matches: every pass meant for a team-mate.
// Outcomes: received · heavy (bounced off the receiver) · passedBy (it came within reach
// — 1.0 m — and he never touched it) · intercepted · loose (no one).
import { Match, SIM_DT, FakeInput } from './lib/sim.mjs';
import { HumanController } from '../src/game/human.js';

const pct = (a, n) => `${Math.round(100 * a / Math.max(1, n))}%`;

function humanPass({ dist = 11, side = 0.5, stickAfter = 'release', receiverRun = 0, runDir = Math.PI / 2, seed = 1, button = 'pass', hold = 4, defender = null }) {
  const m = new Match({ humanTeam: 0, seconds: 9999, seed });
  m.phase = 'play'; m.restart = null;
  const team0 = m.players.filter(p => p.team === 0 && p.line !== 'GK');
  const carrier = team0[0], mate = team0[1];
  const def = m.players.find(p => p.team === 1 && p.line !== 'GK');
  for (const p of m.players) if (p !== carrier && p !== mate && p !== def && p.line !== 'GK') p.active = false;
  if (!defender) def.active = false;
  Object.assign(carrier, { x: -6, z: 0, speed: 0, vx: 0, vz: 0, heading: 0, facing: 0 });
  const mx = carrier.x + Math.cos(side) * dist, mz = carrier.z + Math.sin(side) * dist;
  Object.assign(mate, { x: mx, z: mz, speed: receiverRun, heading: runDir, facing: runDir, vx: Math.cos(runDir) * receiverRun, vz: Math.sin(runDir) * receiverRun });
  if (defender) { Object.assign(def, { x: mx + defender.x, z: mz + defender.z, speed: 0, vx: 0, vz: 0 }); def.facing = def.heading = Math.atan2(mz - def.z, mx - def.x); }
  m.loseBall();
  Object.assign(m.ball, { x: carrier.x + 0.45, z: carrier.z, y: 0.11, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
  m.gainPossession(carrier, true);
  carrier.possessT = 1;
  const inp = new FakeInput(), h = new HumanController(m, 0, inp);
  for (const q of m.players) q.human = false;
  m.human = null; h.setHuman(carrier);
  // a running receiver keeps running until the ball is played (his run is the scene)
  const act = m.ai.act.bind(m.ai);
  m.ai.act = (q, dt) => { if (q === mate && !kick && receiverRun) { q.move.x = Math.cos(runDir); q.move.z = Math.sin(runDir); q.move.speed = receiverRun; return; } act(q, dt); };
  let kickSpeed = null;
  const aim = side;
  let kick = null, minD = 99, touched = false, res = null, contact = null;
  for (let f = 0; f < 240 && !res; f++) {
    const press = f >= 2 && f < 2 + hold;
    let sx = 0, sy = 0;
    if (!kick || f < 2 + hold + 1) { sx = Math.cos(aim); sy = -Math.sin(aim); }
    else if (stickAfter === 'hold') { sx = Math.cos(aim); sy = -Math.sin(aim); }
    else if (stickAfter === 'toBall') { const b = m.ball, dx = b.x - mate.x, dz = b.z - mate.z, d = Math.hypot(dx, dz) || 1; sx = dx / d; sy = -dz / d; }
    else if (stickAfter === 'across') { sx = Math.cos(runDir); sy = -Math.sin(runDir); }
    // before the kick a running receiver keeps running (the AI has him)
    inp.move.x = sx; inp.move.y = sy;
    inp.set(press ? [button] : []);
    h.update(1 / 60);
    for (let k = 0; k < 2; k++) {
      m.step(SIM_DT);
      if (kick && !touched && !m.ball.owner) minD = Math.min(minD, Math.hypot(m.ball.x - mate.x, m.ball.z - mate.z));
    }
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && !kick) { kick = { f, speed: e.speed, mateSpeed: Math.hypot(mate.vx, mate.vz) }; continue; }
      if (!kick) continue;
      if (e.pid === mate.id && e.type === 'firstTouch') contact = { rel: e.relIn, q: e.quality, mateSpeed: Math.hypot(mate.vx, mate.vz), mode: e.mode };
      if (e.pid === mate.id && (e.type === 'deflect' || e.type === 'block')) { res = 'heavy'; contact = contact || { rel: e.speed, mateSpeed: Math.hypot(mate.vx, mate.vz) }; }
      if (e.pid === mate.id) touched = true;
    }
    if (!kick || res) continue;
    const o = m.ball.owner;
    if (o === mate) res = 'received';
    else if (o && o.team !== 0) res = 'intercepted';
    else if (!touched && minD < 1.0 && Math.hypot(m.ball.x - mate.x, m.ball.z - mate.z) > 2.5) res = 'passedBy';
  }
  return { res: res || (kick ? 'loose' : 'no pass'), minD, contact, kick };
}

function run(label, opts, seeds = 16) {
  const t = {}, rel = [], spd = [], k0 = [];
  for (let s = 1; s <= seeds; s++) {
    const r = humanPass({ ...opts, seed: s });
    t[r.res] = (t[r.res] || 0) + 1;
    if (r.contact) { rel.push(r.contact.rel); spd.push(r.contact.mateSpeed); }
    if (r.kick) k0.push(r.kick.mateSpeed);
  }
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
  console.log(`${label.padEnd(44)} ${Object.entries(t).map(([k, v]) => `${k} ${pct(v, seeds)}`).join(' · ')}   rel ${avg(rel)} m/s · receiver ${avg(k0)} → ${avg(spd)} m/s (kick → contact)`);
  return t;
}

console.log('== human passes (receiver under the person\'s control after the pass) ==');
for (const stickAfter of ['release', 'hold', 'toBall']) {
  run(`standing 11 m · stick ${stickAfter}`, { stickAfter });
  run(`standing 16 m driven-ish · stick ${stickAfter}`, { stickAfter, dist: 16 });
  run(`running across 5 m/s · stick ${stickAfter}`, { stickAfter, receiverRun: 5 });
}
run('running across 5 m/s · stick on his run', { stickAfter: 'across', receiverRun: 5 });
run('running away 6 m/s (ball from behind) · release', { stickAfter: 'release', receiverRun: 6, runDir: 0.5 });
run('running at the passer 4 m/s · release', { stickAfter: 'release', receiverRun: 4, runDir: Math.PI + 0.5 });
run('through ball, runner 6 m/s · release', { stickAfter: 'release', receiverRun: 6, runDir: 0.3, button: 'through' });
run('through ball, runner 6 m/s · hold', { stickAfter: 'hold', receiverRun: 6, runDir: 0.3, button: 'through' });

// ---- AI v AI
console.log('\n== AI v AI: passes meant for a team-mate ==');
const agg = {};
const add = k => agg[k] = (agg[k] || 0) + 1;
let relSum = 0, relN = 0;
for (let seed = 1; seed <= 6; seed++) {
  const m = new Match({ humanTeam: null, seconds: 180, seed });
  let open = null;
  while (m.phase !== 'fulltime') {
    m.step(SIM_DT);
    if (open && !open.touched && !m.ball.owner && open.to) {
      const d = Math.hypot(m.ball.x - open.to.x, m.ball.z - open.to.z);
      open.minD = Math.min(open.minD, d);
      if (open.minD < 1.0 && d > 2.5) { add('passedBy'); open = null; }
    }
    for (const e of m.drainEvents()) {
      if (e.type === 'goalDone') m.resumeAfterGoal();
      if (e.type === 'kick' && ['pass', 'through', 'lob'].includes(e.kind)) { open = { t: m.time, team: m.byId.get(e.pid).team, to: m.ball.passTo, minD: 99 }; continue; }
      if (!open) continue;
      if (e.type === 'firstTouch' && open.to && e.pid === open.to.id) { relSum += e.relIn; relN++; }
      if (e.type === 'control' || e.type === 'claim') { const q = m.byId.get(e.pid); add(q.team !== open.team ? 'intercepted' : q === open.to ? 'received' : 'other mate'); open = null; }
      else if (e.type === 'deflect' || e.type === 'block') { const q = m.byId.get(e.pid); add(q.team !== open.team ? 'deflected by opp' : q === open.to ? 'heavy' : 'mate deflect'); open = null; }
      else if (['tackle', 'goal', 'save'].includes(e.type)) { add('other'); open = null; }
    }
    if (open && m.time - open.t > 3) { add('loose'); open = null; }
  }
}
const n = Object.values(agg).reduce((a, b) => a + b, 0);
console.log(Object.entries(agg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${pct(v, n)})`).join(' · '), `· mean rel speed at the receiver's touch ${(relSum / Math.max(1, relN)).toFixed(1)} m/s`);
