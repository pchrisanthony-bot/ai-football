// Gameplay metrics: the numbers every fix is judged by. Runs the real sim + human
// controller headless and prints/saves a report.
//   node tools/metrics.mjs [label] [--only=stop,touch,cut,match] [--format=5v5]
// Results are written to docs/metrics/<label>.json so before/after can be compared.
import fs from 'fs';
import { scenario, lineOf, Match, SIM_DT } from '../tests/lib/sim.mjs';

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'current';
const only = (args.find(a => a.startsWith('--only=')) || '--only=stop,touch,cut,match').slice(7).split(',');
const format = (args.find(a => a.startsWith('--format=')) || '').slice(9) || undefined;
const matchOpts = format ? { format } : {};
const R = 0.11;
const out = { label, date: new Date().toISOString(), format: format || 'default' };
const f2 = v => (v == null ? '—' : typeof v === 'number' ? +v.toFixed(2) : v);

// ---------------------------------------------------------------- stopping with the ball
function stopTest(name, { sprint = false, turn = false, afterKnock = false, opponent = false, afterTouch = false } = {}) {
  const s = scenario({ ball: !afterTouch, x: afterTouch ? -4 : -13, matchOpts, others: opponent || afterTouch ? (q => (opponent && q.team === 1 && lineOf(q) === 'DEF') || (afterTouch && q.team === 0 && lineOf(q) === 'MID')) : null });
  const btn = sprint ? ['sprint'] : [];
  if (opponent) { const o = s.m.players.find(q => q.team === 1 && lineOf(q) === 'DEF'); Object.assign(o, { x: -1.5, z: 0.3 }); }
  if (afterTouch) {
    // a teammate plays it into the receiver's run from behind and to the side
    const mate = s.m.players.find(q => q.team === 0 && q.active && q !== s.p);
    for (let i = 0; i < 20; i++) s.frame(1, 0, btn);
    // a real pass from a teammate behind the runner (the game's own pass, with its lead)
    Object.assign(mate, { x: s.p.x - 7, z: s.p.z + 1.5, facing: 0, heading: 0 });
    const b = s.ball;
    b.x = mate.x + 0.45; b.z = mate.z; s.m.gainPossession(mate, true);
    s.m.requestKick(mate, 'pass', { receiver: s.p });
    let n = 0;
    while (n++ < 150 && b.owner !== s.p) s.frame(1, 0, btn);
    if (b.owner !== s.p) return { name, error: 'pass never controlled' };
  } else {
    for (let i = 0; i < 84; i++) s.frame(1, 0, btn);   // 1.4 s run with the ball
  }
  if (turn) for (let i = 0; i < 9; i++) s.frame(0, 1, btn);   // 0.15 s into a cut
  if (afterKnock) {
    const n0 = s.events.length; let n = 0;
    while (n++ < 90 && !s.events.slice(n0).some(e => e.type === 'touch' && e.power > 0.3)) s.frame(1, 0, btn);
  }
  const v0 = s.p.speed, x0 = s.p.x, z0 = s.p.z;
  let tStop = null, peak = 0;
  const at = {};
  for (let i = 1; i <= 120; i++) {
    s.frame(0, 0, []);
    if (i > 12) peak = Math.max(peak, s.p.speed);
    if (tStop == null && s.p.speed < 0.3) tStop = i / 60;
    if (i === 12) at.v02 = s.p.speed;
    if (i === 24) at.v04 = s.p.speed;
  }
  const b = s.ball;
  return {
    name, v0, tStop, dist: Math.hypot(s.p.x - x0, s.p.z - z0), v02: at.v02, v04: at.v04, peakAfter02: peak,
    owned: b.owner === s.p, ballGap: Math.hypot(b.x - s.p.x, b.z - s.p.z), ballSpeedEnd: Math.hypot(b.vx, b.vz),
  };
}

// ---------------------------------------------------------------- first touch
function touchTest({ run = 0, from = 'front', speed = 10, input = 'none' }) {
  const s = scenario({ x: 0, z: 0, matchOpts, others: q => q.team === 0 && lineOf(q) === 'MID' });
  const p = s.p, b = s.ball;
  const mate = s.m.players.find(q => q.team === 0 && q.active && q !== p);
  Object.assign(mate, { x: -20, z: 8 });
  const stickRun = run > 0 ? [1, 0] : [0, 0];
  // get up to running speed first
  if (run > 0) { Object.assign(p, { x: -6 }); for (let i = 0; i < 70 && p.speed < run - 0.05; i++) s.frame(1, 0, []); }
  // ball approach: start 3.2 m from where the receiver will be, aimed at him
  const dirs = { front: [-1, 0], side: [0, 1], behind: [1, 0] };   // ball travel direction
  const [ux, uz] = dirs[from];
  const v0 = speed + (1.2 + 0.35 * speed) * (3.2 / speed);   // rolls down to ≈speed at contact
  const lead = run > 0 ? p.vx * (3.2 / ((v0 + speed) / 2)) : 0;   // where he'll be when it arrives
  const cx = p.x + lead, cz = p.z;
  Object.assign(b, { owner: null, x: cx - ux * 3.2, z: cz - uz * 3.2, y: R, vx: ux * v0, vz: uz * v0, vy: 0, wx: uz * v0 / R, wy: 0, wz: -ux * v0 / R });
  b.passTo = p; b.passUntil = s.m.time + 3; b.lastKick = { pid: mate.id, team: 0, kind: 'pass', t: s.m.time };
  // The receiver keeps his run (or stands) until the ball is ~0.2 s away, then gives the
  // input for the touch: none (stick neutral), side (directs it across) or forward.
  const stick = input === 'side' ? [0, 1] : input === 'forward' ? [1, 0] : [0, 0];
  let contact = -1, inV = null, inDir = null, n = 0;
  const hist = [];
  while (n < 200) {
    const pre = { vx: b.vx, vz: b.vz, own: b.owner };
    const near = Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(b.vx - p.vx, b.vz - p.vz) * 0.2 + 0.6;
    const [sx, sy] = contact >= 0 || near ? stick : stickRun;
    s.frame(sx, sy, []);
    n++;
    hist.push({ x: b.x, z: b.z, vx: b.vx, vz: b.vz, px: p.x, pz: p.z, pvx: p.vx, pvz: p.vz, own: b.owner === p });
    if (contact < 0 && (b.owner === p || s.events.some(e => (e.type === 'deflect' || e.type === 'firstTouch') && e.pid === p.id))) {
      contact = hist.length - 1; inV = Math.hypot(pre.vx, pre.vz); inDir = Math.atan2(pre.vz, pre.vx);
    }
    if (contact >= 0 && hist.length - 1 - contact >= 60) break;
  }
  if (contact < 0) return { run, from, speed, input, contact: false };
  const at = k => hist[Math.min(hist.length - 1, contact + k)];
  const o1 = at(2), o6 = at(6);
  const outV = Math.hypot(o6.vx, o6.vz);
  const outDir = Math.atan2(o6.vz, o6.vx);
  let turn = Math.abs(((outDir - inDir) * 180 / Math.PI + 540) % 360 - 180);
  // control time: until the ball moves with the receiver (relative speed < 0.6 m/s)
  let ctl = null;
  for (let k = 1; k < 60; k++) { const h = at(k); if (Math.hypot(h.vx - h.pvx, h.vz - h.pvz) < 0.6) { ctl = k / 60; break; } }
  let travel = 0;
  for (let k = 1; k <= 30; k++) { const a = at(k - 1), c = at(k); travel += Math.hypot(c.x - a.x, c.z - a.z); }
  const e = at(30);
  return {
    run, from, speed, input, contact: true, inV, outV, outV2: Math.hypot(o1.vx, o1.vz), turnDeg: turn, controlT: ctl,
    travel05: travel, gap05: Math.hypot(e.x - e.px, e.z - e.pz), owned1: at(59).own,
  };
}

// ---------------------------------------------------------------- 90° cut at full sprint
function cutTest(withBall) {
  const s = scenario({ ball: withBall, x: -14, matchOpts });
  for (let i = 0; i < 96; i++) s.frame(1, 0, ['sprint']);
  const v0 = s.p.speed, x0 = s.p.x;
  let tTurn = null, vMin = 99;
  for (let i = 1; i <= 60; i++) {
    s.frame(0, 1, ['sprint']);
    vMin = Math.min(vMin, s.p.speed);
    if (tTurn == null && Math.abs(((s.p.heading * 180 / Math.PI + 90) + 540) % 360 - 180) < 15) tTurn = i / 60;
  }
  return { withBall, v0, tTurn, vMin, overshoot: s.p.x - x0, owned: withBall ? s.ball.owner === s.p : null };
}

// ---------------------------------------------------------------- AI matches
function matchStats(seeds = 6) {
  const rows = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const m = new Match({ humanTeam: null, seconds: 180, seed, home: seed % 2 ? 'cage' : 'neon', away: seed % 2 ? 'rooftop' : 'harbour', ...matchOpts });
    let kicks = 0, changes = 0, lastTeam = -1, cur = null, run = 0, longest = 0, steps = 0, nan = false;
    const t0 = performance.now();
    while (m.phase !== 'fulltime' && steps++ < 180 * 120 * 3) {
      m.step(SIM_DT);
      for (const e of m.drainEvents()) { if (e.type === 'kick') kicks++; if (e.type === 'goalDone') m.resumeAfterGoal(); }
      const o = m.ball.owner;
      if (o && o.team !== lastTeam) { if (lastTeam >= 0) changes++; lastTeam = o.team; }
      if (o && o === cur && m.phase === 'play') run += SIM_DT; else { cur = o; run = 0; }
      longest = Math.max(longest, run);
      if (!Number.isFinite(m.ball.x + m.ball.z)) { nan = true; break; }
    }
    const ms = (performance.now() - t0) / steps;
    const st = m.teams.map(t => t.stats);
    rows.push({ seed, score: m.teams.map(t => t.score).join('-'), goals: m.teams[0].score + m.teams[1].score, kicks, shots: st[0].shots + st[1].shots,
      passPct: Math.round(100 * (st[0].passesOk + st[1].passesOk) / Math.max(1, st[0].passes + st[1].passes)), changesPerMin: +(changes / 3).toFixed(1), longest: +longest.toFixed(1), msPerStep: +ms.toFixed(3), nan });
  }
  return rows;
}

// ---------------------------------------------------------------- run
if (only.includes('stop')) {
  out.stop = [
    stopTest('jog dribble → release'),
    stopTest('sprint dribble → release', { sprint: true }),
    stopTest('release mid-turn', { sprint: true, turn: true }),
    stopTest('release right after a knock-on', { sprint: true, afterKnock: true }),
    stopTest('release after first touch', { afterTouch: true }),
    stopTest('release near an opponent', { sprint: true, opponent: true }),
  ];
  console.log('\nSTOPPING WITH THE BALL (release the stick)');
  console.log('  scenario                         v0   t→stop  dist   v@0.2  v@0.4  owned  gap   ballV');
  for (const r of out.stop) console.log(`  ${r.name.padEnd(32)} ${f2(r.v0)}`.padEnd(40) + `${f2(r.tStop)}`.padEnd(8) + `${f2(r.dist)}`.padEnd(7) + `${f2(r.v02)}`.padEnd(7) + `${f2(r.v04)}`.padEnd(7) + `${r.owned}`.padEnd(7) + `${f2(r.ballGap)}`.padEnd(6) + f2(r.ballSpeedEnd) + (r.error ? '  ' + r.error : ''));
}
if (only.includes('touch')) {
  out.touch = [];
  for (const run of [0, 5]) for (const from of ['front', 'side', 'behind']) for (const speed of [6, 10, 15]) for (const input of ['none', 'side', 'forward'])
    out.touch.push(touchTest({ run, from, speed, input }));
  console.log('\nFIRST TOUCH (in → out speed, direction change, control time, ball travel in 0.5 s)');
  console.log('  run from   v   input    | inV   outV  turn°  ctl   travel gap   owned@1s');
  for (const r of out.touch) console.log(`  ${String(r.run).padEnd(3)} ${r.from.padEnd(6)} ${String(r.speed).padEnd(3)} ${r.input.padEnd(8)} | ` + (r.contact ? `${f2(r.inV)}`.padEnd(6) + `${f2(r.outV)}`.padEnd(6) + `${f2(r.turnDeg)}`.padEnd(7) + `${f2(r.controlT)}`.padEnd(6) + `${f2(r.travel05)}`.padEnd(7) + `${f2(r.gap05)}`.padEnd(6) + r.owned1 : 'no contact (ball never reached him)'));
}
if (only.includes('cut')) {
  out.cut = [cutTest(false), cutTest(true)];
  console.log('\n90° CUT AT FULL SPRINT');
  for (const r of out.cut) console.log(`  ${r.withBall ? 'with ball   ' : 'without ball'}  v0 ${f2(r.v0)}  turned in ${f2(r.tTurn)} s  min speed ${f2(r.vMin)}  overshoot ${f2(r.overshoot)} m${r.withBall ? '  owned ' + r.owned : ''}`);
}
if (only.includes('match')) {
  out.match = matchStats();
  console.log('\nAI MATCHES (180 s)');
  for (const r of out.match) console.log(`  seed ${r.seed}: ${r.score}  kicks ${r.kicks}  shots ${r.shots}  pass ${r.passPct}%  turnovers/min ${r.changesPerMin}  longest possession ${r.longest}s  sim ${r.msPerStep} ms/step${r.nan ? '  NaN!' : ''}`);
}
fs.mkdirSync('docs/metrics', { recursive: true });
fs.writeFileSync(`docs/metrics/${label}.json`, JSON.stringify(out, null, 1));
console.log(`\nsaved docs/metrics/${label}.json`);
