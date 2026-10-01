// Human passing outcomes (real controller) by aim error and defender placement.
//   node tests/diag-passing.mjs [format] [assist] [difficulty]
// ok = the team-mate has it · int = an opponent controlled it · def = an opponent got a touch
import { tally } from './lib/passing.mjs';
const format = process.argv[2] || '5v5', assist = process.argv[3], difficulty = +(process.argv[4] || 0.6);
const pct = x => String(Math.round(100 * x)).padStart(3);
for (const defender of ['none', 'far', 'near', 'lane']) {
  for (const run of [0, 5]) {
    const row = [];
    for (const off of [0, 15, 30, 45, 60]) {
      const a = tally({ format, dist: 8, offDeg: off, defender, receiverRun: run, assist, difficulty }, 6);
      const b = tally({ format, dist: 12, offDeg: off, defender, receiverRun: run, assist, difficulty }, 6);
      const r = k => (a.rate(k) + b.rate(k)) / 2;
      row.push(`${String(off).padStart(2)}°: ${pct(r('received'))}% ok ${pct(r('intercepted'))}% int ${pct(r('deflected'))}% def`);
    }
    console.log(`${format} defender ${defender.padEnd(4)} receiver ${run ? 'running ' : 'standing'} | ${row.join(' | ')}`);
  }
}
