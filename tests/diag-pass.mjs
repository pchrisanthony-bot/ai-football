import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
const agg = {};
const add = (k) => agg[k] = (agg[k] || 0) + 1;
for (let seed = 1; seed <= 6; seed++) {
  const m = new Match({ humanTeam: null, seconds: 180, seed });
  let open = null;
  while (m.phase !== 'fulltime') {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'goalDone') m.resumeAfterGoal();
      if (e.type === 'kick' && ['pass', 'through', 'lob'].includes(e.kind)) {
        const p = m.players.find(q => q.id === e.pid);
        open = { t: m.time, team: p.team, kind: e.kind + (p.ai.plan?.kind === 'wallpass' ? '(wall)' : ''), to: m.ball.passTo, d: m.ball.passTo ? Math.hypot(m.ball.passTo.x - e.x, m.ball.passTo.z - e.z) : 0 };
        continue;
      }
      if (!open) continue;
      if (e.type === 'control' || e.type === 'claim') {
        const q = m.players.find(x => x.id === e.pid);
        const k = q.team !== open.team ? 'intercepted' : q === open.to ? 'completed' : 'teammate-other';
        add(open.kind + ':' + k); open = null;
      } else if (e.type === 'deflect' || e.type === 'block') {
        const q = m.players.find(x => x.id === e.pid);
        add(open.kind + ':' + (q.team !== open.team ? 'deflected-by-opp' : 'miscontrol-by-mate')); open = null;
      } else if (e.type === 'tackle' || e.type === 'goal' || e.type === 'save') { add(open.kind + ':other-' + e.type); open = null; }
    }
    if (open && m.time - open.t > 3) { add(open.kind + ':dead'); open = null; }
  }
}
console.log(Object.entries(agg).sort().map(([k, v]) => `${k.padEnd(34)} ${v}`).join('\n'));
