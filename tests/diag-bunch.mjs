// How often team-mates crowd each other in AI play: the share of play time with two
// team-mates within 1.2 m (and within 0.8 m), per format.   node tests/diag-bunch.mjs
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
for (const format of ['5v5', '11v11']) {
  let t = 0, near = 0, touching = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const m = new Match({ format, humanTeam: null, seconds: 120, seed });
    for (let i = 0; i < 120 * 120 * 3 && m.phase !== 'fulltime'; i++) {
      m.step(SIM_DT);
      for (const e of m.drainEvents()) if (e.type === 'goalDone') m.resumeAfterGoal();
      if (m.phase !== 'play' || i % 12) continue;
      t++;
      let n12 = false, n08 = false;
      for (let a = 0; a < m.players.length; a++) for (let b = a + 1; b < m.players.length; b++) {
        const p = m.players[a], q = m.players[b];
        if (p.team !== q.team || !p.active || !q.active) continue;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < 1.2) n12 = true; if (d < 0.8) n08 = true;
      }
      if (n12) near++; if (n08) touching++;
    }
  }
  console.log(`${format}: team-mates within 1.2 m ${(100 * near / t).toFixed(1)}% of play, within 0.8 m ${(100 * touching / t).toFixed(1)}%`);
}
