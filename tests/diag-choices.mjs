// What AI carriers choose (decisions per match by kind) and how long they keep the ball.
//   node tests/diag-choices.mjs [format] [seconds] [seeds]
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
const format = process.argv[2] || '5v5', secs = +(process.argv[3] || 120), seeds = +(process.argv[4] || 3);
const tally = {}, labels = {};
let poss = 0, possN = 0, ev = {};
for (let seed = 1; seed <= seeds; seed++) {
  const m = new Match({ humanTeam: null, seconds: secs, seed });
  const orig = m.ai.attackThink.bind(m.ai);
  m.ai.attackThink = p => { const before = p.ai.plan; orig(p); if (p.ai.plan !== before && p.ai.plan) tally[p.ai.plan.kind] = (tally[p.ai.plan.kind] || 0) + 1; labels[p.ai.label] = (labels[p.ai.label] || 0) + 1; };
  let owner = null, since = 0;
  while (m.phase !== 'fulltime') {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) { if (e.type === 'goalDone') m.resumeAfterGoal(); ev[e.type] = (ev[e.type] || 0) + 1; }
    const o = m.ball.owner;
    if (o !== owner) { if (owner) { poss += m.time - since; possN++; } owner = o; since = m.time; }
  }
}
const per = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / seeds).toFixed(1)]));
console.log(format, 'decisions/match', JSON.stringify(per(tally)));
console.log('labels', JSON.stringify(per(labels)));
console.log('events', JSON.stringify(per(ev)));
console.log('mean spell on the ball', (poss / possN).toFixed(2), 's');
