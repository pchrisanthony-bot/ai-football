import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
let shown = 0;
for (let seed = 1; seed <= 6 && shown < 14; seed++) {
  const m = new Match({ humanTeam: null, seconds: 180, seed });
  let open = null;
  while (m.phase !== 'fulltime' && shown < 14) {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && e.kind === 'shot') {
        const p = m.players.find(q => q.id === e.pid);
        open = p.ai.plan && p.ai.plan.kind === 'shoot' && p.ai.plan.bank ? { t: m.time, tz: p.ai.plan.tz, gk0: m.keeper(1 - p.team) && m.keeper(1 - p.team).z.toFixed(2), wallT: null } : null;
      }
      if (open && e.type === 'wall' && open.wallT == null) open.wallT = m.time;
      if (open && e.type === 'save') {
        const gk = m.players.find(q => q.id === e.pid);
        console.log(`tz=${open.tz} gkAtShot z=${open.gk0} | save ${e.kind} after wall ${(m.time - open.wallT).toFixed(2)}s gk z=${gk.z.toFixed(2)} x=${gk.x.toFixed(2)} action=${gk.action?.type}@${gk.action?.t.toFixed(2)} ball(${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)}) state=${gk.ai.state}`);
        shown++; open = null;
      }
      if (e.type === 'goalDone') m.resumeAfterGoal();
    }
    if (open && m.time - open.t > 2.5) open = null;
  }
}
