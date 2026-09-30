import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
const agg = { direct: { n: 0, goal: 0, save: 0, other: 0 }, bank: { n: 0, goal: 0, save: 0, other: 0 } };
for (let seed = 1; seed <= 8; seed++) {
  const m = new Match({ humanTeam: null, seconds: 180, seed });
  let open = null;
  while (m.phase !== 'fulltime') {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && e.kind === 'shot') {
        if (open) agg[open.k].other++;
        const p = m.players.find(q => q.id === e.pid);
        const k = p.ai.plan && p.ai.plan.kind === 'shoot' && p.ai.plan.bank ? 'bank' : 'direct';
        agg[k].n++; open = { k, t: m.time };
      }
      if (open && e.type === 'goal') { agg[open.k].goal++; open = null; }
      if (open && e.type === 'save') { agg[open.k].save++; open = null; }
      if (e.type === 'goalDone') m.resumeAfterGoal();
    }
    if (open && m.time - open.t > 3) { agg[open.k].other++; open = null; }
  }
}
console.log(JSON.stringify(agg));
