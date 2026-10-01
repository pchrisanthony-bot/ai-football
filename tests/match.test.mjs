// Headless AI-vs-AI matches: the whole sim + AI with no renderer.
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';

export function playMatch(opts = {}, verbose = false) {
  const m = new Match({ humanTeam: null, seconds: 180, ...opts });
  const tally = { bankShots: 0, kicks: 0, walls: 0, saves: 0, goals: [], skills: {}, pannas: 0, tackles: 0, stuck: 0, nan: false, maxLoose: 0, gb: 0, headers: 0, states: {} };
  let loose = 0, steps = 0;
  const maxSteps = (opts.seconds ?? 180) * 120 * 3;
  while (m.phase !== 'fulltime' && steps < maxSteps) {
    m.step(SIM_DT);
    steps++;
    for (const e of m.drainEvents()) {
      if (e.type === 'kick') { tally.kicks++; const k = m.players.find(q => q.id === e.pid); if (e.kind === 'shot' && k && k.ai.plan && k.ai.plan.kind === 'shoot' && k.ai.plan.bank) tally.bankShots++; }
      if (e.type === 'wall') tally.walls++;
      if (e.type === 'save') tally.saves++;
      if (e.type === 'header') tally.headers++;
      if (e.type === 'panna') tally.pannas++;
      if (e.type === 'tackle' && e.ok) tally.tackles++;
      if (e.type === 'gamebreaker') tally.gb++;
      if (e.type === 'style') tally.skills[e.label] = (tally.skills[e.label] || 0) + 1;
      if (e.type === 'goal') { tally.goals.push({ team: e.team, cage: e.cage, own: e.own, t: +m.clock.toFixed(1) }); if (verbose) console.log('GOAL', e); }
      if (e.type === 'goalDone') m.resumeAfterGoal();
    }
    if (m.phase === 'play') {
      if (!m.ball.owner && Math.hypot(m.ball.vx, m.ball.vz) < 0.05) loose += SIM_DT; else loose = 0;
      tally.maxLoose = Math.max(tally.maxLoose, loose);
      if (steps % 60 === 0) for (const p of m.players) if (p.active && !p.human) tally.states[p.ai.state] = (tally.states[p.ai.state] || 0) + 1;
    }
    const b = m.ball;
    if (!Number.isFinite(b.x + b.y + b.z) || m.players.some(p => !Number.isFinite(p.x + p.z))) { tally.nan = true; break; }
  }
  tally.score = m.teams.map(t => t.score);
  tally.stats = m.teams.map(t => ({ ...t.stats, possession: +t.stats.possession.toFixed(0) }));
  tally.finished = m.phase === 'fulltime';
  return tally;
}

export default function () {
  const results = [];
  const all = [];
  for (let seed = 1; seed <= 4; seed++) {
    const r = playMatch({ seed, home: seed % 2 ? 'cage' : 'neon', away: seed % 2 ? 'rooftop' : 'harbour' });
    all.push(r);
    console.log(`seed ${seed}: ${r.score.join('-')}  goals ${JSON.stringify(r.goals)}  kicks ${r.kicks} walls ${r.walls} saves ${r.saves} tackles ${r.tackles} pannas ${r.pannas} headers ${r.headers} gb ${r.gb} maxLoose ${r.maxLoose.toFixed(1)}s`);
    console.log('   skills', JSON.stringify(r.skills));
    console.log('   stats', JSON.stringify(r.stats));
    console.log('   states', JSON.stringify(r.states));
  }
  const goals = all.reduce((s, r) => s + r.goals.length, 0);
  const cage = all.reduce((s, r) => s + r.goals.filter(g => g.cage).length, 0);
  results.push({ name: 'matches finish', ok: all.every(r => r.finished) });
  results.push({ name: 'no NaN', ok: all.every(r => !r.nan) });
  results.push({ name: 'goals happen (avg 2–12 per match)', ok: goals / all.length >= 2 && goals / all.length <= 12, info: `${goals} goals in ${all.length} matches` });
  const banks = all.reduce((s, r) => s + r.bankShots, 0);
  results.push({ name: 'AI uses the cage (bank-shot attempts)', ok: banks >= 4, info: `${banks} bank shots, ${cage} cage goals` });
  results.push({ name: 'keepers make saves', ok: all.reduce((s, r) => s + r.saves, 0) > 4 });
  results.push({ name: 'ball never dead for >6 s', ok: all.every(r => r.maxLoose < 6), info: all.map(r => r.maxLoose.toFixed(1)).join(', ') });
  const ok = all.reduce((s, r) => s + r.stats[0].passesOk + r.stats[1].passesOk, 0), tot = all.reduce((s, r) => s + r.stats[0].passes + r.stats[1].passes, 0);
  results.push({ name: 'passing works (≥ 55% completion overall)', ok: ok / tot >= 0.55, info: `${ok}/${tot} = ${(ok / tot * 100).toFixed(0)}%` });
  return results;
}
