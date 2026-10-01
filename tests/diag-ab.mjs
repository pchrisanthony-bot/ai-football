// A/B helper: AI-vs-AI match averages over many seeds for one format (compare runs
// before/after a change).   node tests/diag-ab.mjs [format] [seeds]
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
const format = process.argv[2] || '5v5', seeds = +(process.argv[3] || 12);
const tot = { goals: 0, shots: 0, passes: 0, ok: 0, kicks: 0 };
for (let seed = 1; seed <= seeds; seed++) {
  const m = new Match({ format, humanTeam: null, seconds: 180, seed });
  for (let i = 0; i < 180 * 120 * 3 && m.phase !== 'fulltime'; i++) {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) { if (e.type === 'goalDone') m.resumeAfterGoal(); if (e.type === 'kick') tot.kicks++; }
  }
  for (const T of m.teams) { tot.goals += T.score; tot.shots += T.stats.shots; tot.passes += T.stats.passes; tot.ok += T.stats.passesOk; }
}
console.log(`${format} × ${seeds}: goals ${(tot.goals / seeds).toFixed(2)}  shots ${(tot.shots / seeds).toFixed(1)}  kicks ${(tot.kicks / seeds).toFixed(1)}  pass ${(100 * tot.ok / tot.passes).toFixed(1)}%`);
