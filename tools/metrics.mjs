// Gameplay metrics: the numbers every fix is judged by. Runs the real sim + human
// controller headless and prints/saves a report.
//   node tools/metrics.mjs [label] [--only=stop,touch,cut,match] [--format=5v5]
// Results are written to docs/metrics/<label>.json so before/after can be compared.
import fs from 'fs';
import { Match, SIM_DT } from '../tests/lib/sim.mjs';
import { stopTest, touchTest, cutTest } from '../tests/lib/scenarios.mjs';

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || 'current';
const only = (args.find(a => a.startsWith('--only=')) || '--only=stop,touch,cut,match').slice(7).split(',');
const format = (args.find(a => a.startsWith('--format=')) || '').slice(9) || undefined;
const matchOpts = format ? { format } : {};
const out = { label, date: new Date().toISOString(), format: format || 'default' };
const f2 = v => (v == null ? '—' : typeof v === 'number' ? +v.toFixed(2) : v);

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
    stopTest('jog dribble → release', { matchOpts }),
    stopTest('sprint dribble → release', { sprint: true, matchOpts }),
    stopTest('release mid-turn', { sprint: true, turn: true, matchOpts }),
    stopTest('release right after a knock-on', { sprint: true, afterKnock: true, matchOpts }),
    stopTest('release after first touch', { afterTouch: true, matchOpts }),
    stopTest('release near an opponent', { sprint: true, opponent: true, matchOpts }),
  ];
  console.log('\nSTOPPING WITH THE BALL (release the stick)');
  console.log('  scenario                         v0   t→stop  dist   v@0.2  v@0.4  owned  gap   ballV');
  for (const r of out.stop) console.log(`  ${r.name.padEnd(32)} ${f2(r.v0)}`.padEnd(40) + `${f2(r.tStop)}`.padEnd(8) + `${f2(r.dist)}`.padEnd(7) + `${f2(r.v02)}`.padEnd(7) + `${f2(r.v04)}`.padEnd(7) + `${r.owned}`.padEnd(7) + `${f2(r.ballGap)}`.padEnd(6) + f2(r.ballSpeedEnd) + (r.error ? '  ' + r.error : ''));
}
if (only.includes('touch')) {
  out.touch = [];
  for (const run of [0, 5]) for (const from of ['front', 'side', 'behind']) for (const speed of [6, 10, 15]) for (const input of ['none', 'side', 'forward'])
    out.touch.push(touchTest({ run, from, speed, input, matchOpts }));
  console.log('\nFIRST TOUCH (in → out speed, direction change, control time, ball travel in 0.5 s)');
  console.log('  run from   v   input    | inV   outV  turn°  ctl   travel gap   owned@1s');
  for (const r of out.touch) console.log(`  ${String(r.run).padEnd(3)} ${r.from.padEnd(6)} ${String(r.speed).padEnd(3)} ${r.input.padEnd(8)} | ` + (r.contact ? `${f2(r.inV)}`.padEnd(6) + `${f2(r.outV)}`.padEnd(6) + `${f2(r.turnDeg)}`.padEnd(7) + `${f2(r.controlT)}`.padEnd(6) + `${f2(r.travel05)}`.padEnd(7) + `${f2(r.gap05)}`.padEnd(6) + r.owned1 : 'no contact (ball never reached him)'));
}
if (only.includes('cut')) {
  out.cut = [cutTest(false, matchOpts), cutTest(true, matchOpts)];
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
