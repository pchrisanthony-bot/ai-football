// Headless AI matches on the open formats: out of play, restarts and their timing,
// and the invariants (the ball is never in play beyond a line; nothing goes NaN).
//   node tests/diag-open.mjs [format] [seconds] [seeds]
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
import { PITCH, lineCrossing } from '../src/sim/pitch.js';

export function playOpen(format, seconds = 180, seed = 1, verbose = false) {
  const m = new Match({ format, humanTeam: null, seconds, seed });
  const R = 0.11;
  const t = { goals: 0, restarts: {}, outs: 0, illegal: 0, nan: false, kicks: 0, shots: 0, longestRestart: 0, stuckRestart: 0, maxLoose: 0, passes: 0, passesOk: 0, headers: 0, saves: 0 };
  let loose = 0, rT = 0, steps = 0;
  const maxSteps = seconds * 120 * 4;
  while (m.phase !== 'fulltime' && steps++ < maxSteps) {
    const x0 = m.ball.x, z0 = m.ball.z, live = m.phase === 'play';
    m.step(SIM_DT);
    // Every crossing of a line in play must stop play that same tick (no tunnelling, no
    // ball carried or dribbled over unnoticed) — unless it went in through the goal mouth.
    if (live && m.phase === 'play' && !m.ball.net && lineCrossing(x0, z0, m.ball.x, m.ball.z, R)) t.illegal++;
    for (const e of m.drainEvents()) {
      if (e.type === 'goal') t.goals++;
      if (e.type === 'goalDone') m.resumeAfterGoal();
      if (e.type === 'restart') { t.restarts[e.kind] = (t.restarts[e.kind] || 0) + 1; if (verbose) console.log(`${m.elapsed().toFixed(1)}s ${e.kind} team ${e.team} at (${e.x.toFixed(1)}, ${e.z.toFixed(1)})`); }
      if (e.type === 'kick') { t.kicks++; if (e.kind === 'shot') t.shots++; }
      if (e.type === 'header') t.headers++;
      if (e.type === 'save') t.saves++;
    }
    const b = m.ball;
    if (m.phase === 'restart' && m.restart.type !== 'KICKOFF') { rT += SIM_DT; t.longestRestart = Math.max(t.longestRestart, rT); } else rT = 0;
    if (m.phase === 'play') {
      if (!b.owner && Math.hypot(b.vx, b.vz) < 0.05) loose += SIM_DT; else loose = 0;
      t.maxLoose = Math.max(t.maxLoose, loose);
    }
    if (!Number.isFinite(b.x + b.y + b.z) || m.players.some(p => !Number.isFinite(p.x + p.z))) { t.nan = true; break; }
  }
  t.score = m.teams.map(T => T.score).join('-');
  t.passes = m.teams[0].stats.passes + m.teams[1].stats.passes;
  t.passesOk = m.teams[0].stats.passesOk + m.teams[1].stats.passesOk;
  t.finished = m.phase === 'fulltime';
  t.longestRestart = +t.longestRestart.toFixed(1); t.maxLoose = +t.maxLoose.toFixed(1);
  return t;
}

if (process.argv[1].endsWith('diag-open.mjs')) {
  const format = process.argv[2] || '11v11', secs = +(process.argv[3] || 180), seeds = +(process.argv[4] || 2);
  for (let s = 1; s <= seeds; s++) {
    const t0 = performance.now();
    const r = playOpen(format, secs, s, process.argv.includes('-v'));
    console.log(`${format} seed ${s}: ${JSON.stringify(r)}  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
