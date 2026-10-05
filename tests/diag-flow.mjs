// AI v AI match flow: goals, shots, passing (completed / intercepted / deflected), how
// quickly a side that wins the ball back shoots (counter speed), offsides.
//   node tests/diag-flow.mjs _ [seconds] [seeds] [difficulty] [--offside=on] [--fouls=on]
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';

export function flow(format = '5v5', seconds = 180, seed = 1, difficulty = 0.6, extra = {}) {
  const m = new Match({ humanTeam: null, seconds, seed, difficulty, ...extra });
  const s = { goals: 0, shots: 0, passes: 0, completed: 0, intercepted: 0, deflected: 0, mateOther: 0, offsides: 0, turnovers: 0, toShot: [], quickShots: 0, firstAct: [] };
  let open = null, turn = null, won = null, steps = 0;
  while (m.phase !== 'fulltime' && steps++ < seconds * 120 * 4) {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'goalDone') m.resumeAfterGoal();
      if (e.type === 'goal') s.goals++;
      if (e.type === 'offside') s.offsides++;
      // The man who just won it back: how long before he passes or shoots?
      if (won && (e.type === 'windup' || e.type === 'kick') && e.pid === won.pid) { s.firstAct.push(m.time - won.t); won = null; }
      if (e.type === 'kick') {
        const p = m.players.find(q => q.id === e.pid);
        if (e.kind === 'shot' || e.kind === 'volley') {
          s.shots++;
          if (turn && turn.team === p.team) { const dt = m.time - turn.t; s.toShot.push(dt); if (dt < 4) s.quickShots++; turn = null; }
        }
        if (['pass', 'through', 'lob'].includes(e.kind)) { s.passes++; open = { t: m.time, team: p.team, to: m.ball.passTo }; }
        continue;
      }
      if (e.type === 'control' && e.prevTeam >= 0) {
        const q = m.players.find(x => x.id === e.pid);
        if (e.prevTeam !== q.team && q.line !== 'GK') { s.turnovers++; turn = { t: m.time, team: q.team }; won = { t: m.time, pid: q.id }; }
      }
      if (!open) continue;
      if (e.type === 'control' || e.type === 'claim') {
        const q = m.players.find(x => x.id === e.pid);
        if (q.team !== open.team) s.intercepted++; else if (q === open.to || !open.to) s.completed++; else s.mateOther++;
        open = null;
      } else if (e.type === 'deflect' || e.type === 'block') {
        const q = m.players.find(x => x.id === e.pid);
        if (q.team !== open.team) s.deflected++;
        open = null;
      } else if (['tackle', 'goal', 'save', 'restart'].includes(e.type)) open = null;
    }
    if (open && m.time - open.t > 3) open = null;
    if (turn && m.time - turn.t > 12) turn = null;
    if (won && m.ball.owner?.id !== won.pid && m.time - won.t > 0.05) won = null;   // lost it / gave it away
  }
  return s;
}

if (process.argv[1].endsWith('diag-flow.mjs')) {
  const format = process.argv[2] || '5v5', secs = +(process.argv[3] || 180), seeds = +(process.argv[4] || 4), diff = +(process.argv[5] || 0.6);
  const extra = { offside: process.argv.includes('--offside=on'), fouls: process.argv.includes('--fouls=on') };
  const tot = {};
  const all = [], acts = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const r = flow(format, secs, seed, diff, extra);
    all.push(...r.toShot); acts.push(...r.firstAct);
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') tot[k] = (tot[k] || 0) + v;
  }
  const per = k => (tot[k] / seeds).toFixed(1);
  const med = all.sort((a, b) => a - b)[Math.floor(all.length / 2)];
  acts.sort((a, b) => a - b);
  const actMed = acts[Math.floor(acts.length / 2)], actFast = acts.filter(x => x < 0.3).length / Math.max(1, acts.length);
  console.log(`${format}${extra.offside ? ' (offside on)' : ''}${extra.fouls ? ' (fouls on)' : ''} diff ${diff} · ${seeds} × ${secs}s: goals ${per('goals')} · shots ${per('shots')} · passes ${per('passes')} · completed ${(100 * tot.completed / tot.passes).toFixed(0)}% · intercepted ${(100 * tot.intercepted / tot.passes).toFixed(0)}% · deflected ${(100 * tot.deflected / tot.passes).toFixed(0)}% · turnovers ${per('turnovers')} · turnover→shot median ${med?.toFixed(2)} s, <4 s: ${(100 * tot.quickShots / Math.max(1, tot.turnovers)).toFixed(0)}% of turnovers · offsides ${per('offsides')} · after winning it: first pass/shot median ${actMed?.toFixed(2)} s, within 0.3 s ${(100 * actFast).toFixed(0)}%`);
}
