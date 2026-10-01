// Shot outcomes AI v AI: on target, saved, scored, and from how far / what preceded them.
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
const format = process.argv[2] || '11v11', secs = +(process.argv[3] || 300), seeds = +(process.argv[4] || 8);
const t = { shots: 0, onT: 0, saves: 0, goals: 0, dist: 0, headers: 0, hGoals: 0, from: {} };
for (let seed = 1; seed <= seeds; seed++) {
  const m = new Match({ format, humanTeam: null, seconds: secs, seed });
  let lastKind = null;
  while (m.phase !== 'fulltime') {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'goalDone') m.resumeAfterGoal();
      if (e.type === 'kick' && (e.kind === 'shot' || e.kind === 'volley')) { t.shots++; const p = m.players.find(q => q.id === e.pid); t.dist += Math.hypot(m.oppGoalX(p.team) - e.x, e.z); const k = lastKind || '?'; t.from[k] = (t.from[k] || 0) + 1; }
      if (e.type === 'kick' && e.pass) lastKind = e.pass.type;
      if (e.type === 'header') t.headers++;
      if (e.type === 'save') t.saves++;
      if (e.type === 'goal') t.goals++;
    }
  }
  t.onT += m.teams[0].stats.onTarget + m.teams[1].stats.onTarget;
}
console.log(`${format} per match: shots ${(t.shots / seeds).toFixed(1)} · on target ${(t.onT / seeds).toFixed(1)} · saves ${(t.saves / seeds).toFixed(1)} · goals ${(t.goals / seeds).toFixed(1)} · mean shot distance ${(t.dist / t.shots).toFixed(1)} m · headers ${(t.headers / seeds).toFixed(1)} · last pass before shots ${JSON.stringify(t.from)}`);
