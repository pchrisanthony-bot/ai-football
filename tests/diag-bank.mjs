import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
for (let seed = 1; seed <= 6; seed++) {
  const m = new Match({ humanTeam: null, seconds: 180, seed });
  let open = null;
  while (m.phase !== 'fulltime') {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && e.kind === 'shot') {
        if (open) console.log(open.log.join(' '));
        const p = m.players.find(q => q.id === e.pid);
        open = p.ai.plan && p.ai.plan.kind === 'shoot' && p.ai.plan.bank ? { t: m.time, log: [`BANK from (${e.x.toFixed(1)},${e.z.toFixed(1)}) tz=${p.ai.plan.tz} xg=${p.ai.plan.xg.toFixed(2)} v=${e.speed.toFixed(1)}:`] } : null;
        continue;
      }
      if (open && !['touch', 'windup', 'bounce'].includes(e.type)) open.log.push(`${e.type}${e.speed ? '@' + e.speed.toFixed(1) : ''}${e.x !== undefined ? `(${e.x.toFixed(1)},${(e.z ?? 0).toFixed(1)})` : ''}`);
      if (e.type === 'goalDone') m.resumeAfterGoal();
    }
    if (open && m.time - open.t > 2.5) { console.log(open.log.join(' ')); open = null; }
  }
}
