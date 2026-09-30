// Diagnostic: sweep seeds, report kicks, goals, and the longest single-player possession.
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
const rows = [];
for (let seed = 1; seed <= +(process.argv[2] || 12); seed++) {
  const m = new Match({ humanTeam: null, home: seed % 2 ? 'cage' : 'neon', away: seed % 2 ? 'rooftop' : 'harbour', seconds: 180, seed });
  let kicks = 0, cur = null, run = 0, worst = { t: 0 }, steps = 0;
  while (m.phase !== 'fulltime' && steps++ < 180 * 120 * 3) {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) { if (e.type === 'kick') kicks++; if (e.type === 'goalDone') m.resumeAfterGoal(); }
    const o = m.ball.owner;
    if (o && o === cur && m.phase === 'play') run += SIM_DT; else { cur = o; run = 0; }
    if (run > worst.t) worst = { t: run, who: `${o.name}/${o.role}/${o.ai.state}/${o.ai.label}/${o.dribble.mode} hands=${m.ball.inHands} sp=${o.speed.toFixed(1)} at(${o.x.toFixed(1)},${o.z.toFixed(1)})` };
  }
  rows.push(`seed ${seed}: ${m.teams.map(t => t.score).join('-')} kicks ${kicks} longest ${worst.t.toFixed(1)}s ${worst.who || ''}`);
}
console.log(rows.join('\n'));
