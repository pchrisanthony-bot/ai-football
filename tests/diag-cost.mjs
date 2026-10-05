// Sim cost: ms of CPU per simulated second, AI v AI (headless).
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
const format = '5v5', secs = +(process.argv[3] || 120);
let best = Infinity;
for (let r = 0; r < 3; r++) {
  const m = new Match({ humanTeam: null, seconds: secs, seed: 5 });
  const t0 = performance.now();
  while (m.phase !== 'fulltime') { m.step(SIM_DT); for (const e of m.drainEvents()) if (e.type === 'goalDone') m.resumeAfterGoal(); }
  best = Math.min(best, (performance.now() - t0) / secs);
}
console.log(`${format}: ${best.toFixed(2)} ms CPU per simulated second`);
