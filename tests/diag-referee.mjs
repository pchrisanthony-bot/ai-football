// The referee in AI v AI: fouls, cards, penalties, free kicks (and that every restart is
// taken). node tests/diag-referee.mjs [format] [seconds] [seeds] [difficulty]
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
const format = process.argv[2] || '11v11', secs = +(process.argv[3] || 300), seeds = +(process.argv[4] || 8), difficulty = +(process.argv[5] || 0.6);
const t = { fouls: 0, yellow: 0, red: 0, pens: 0, penGoals: 0, fks: 0, fkShots: 0, goals: 0, behind: 0, slide: 0, handling: 0, longestRestart: 0, gkPressed: 0 };
for (let seed = 1; seed <= seeds; seed++) {
  const m = new Match({ format, humanTeam: null, seconds: secs, seed, difficulty });
  let rT = 0, pen = null;
  while (m.phase !== 'fulltime') {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'goalDone') m.resumeAfterGoal();
      if (e.type === 'goal') { t.goals++; if (pen && m.time - pen < 4) t.penGoals++; }
      if (e.type === 'foul') { if (e.kind === 'handling') t.handling++; else { t.fouls++; if (e.behind) t.behind++; if (e.kind === 'slide') t.slide++; } if (e.card === 'yellow') t.yellow++; if (e.card && e.card !== 'yellow') t.red++; }
      if (e.type === 'restart' && e.kind === 'PENALTY') t.pens++;
      if (e.type === 'restart' && e.kind === 'FREE_KICK' && e.reason === 'foul') t.fks++;
      if (e.type === 'kick' && e.kind === 'shot' && m.ball.restartTaker && m.players.find(q => q.id === e.pid) === m.ball.restartTaker) { if (m.ball.restartKind === 'PENALTY') pen = m.time; else t.fkShots++; }
    }
    if (m.phase === 'restart' && m.restart.type !== 'KICKOFF') { rT += SIM_DT; t.longestRestart = Math.max(t.longestRestart, rT); } else rT = 0;
    // anyone within 2 m of a keeper holding the ball?
    const k = m.referee.keeperHolding();
    if (k && m.players.some(q => q.active && q.team !== k.team && Math.hypot(q.x - k.x, q.z - k.z) < 2)) t.gkPressed += SIM_DT;
  }
}
const per = k => (t[k] / seeds).toFixed(2);
console.log(`${format} diff ${difficulty} · ${seeds} × ${secs}s per match: fouls ${per('fouls')} (from behind ${per('behind')}, slides ${per('slide')}) · yellow ${per('yellow')} · red ${per('red')} · penalties ${per('pens')} (scored ${t.penGoals}/${t.pens}) · direct FKs ${per('fks')} (shots ${t.fkShots}) · keeper 6 s ${per('handling')} · goals ${per('goals')} · longest restart ${t.longestRestart.toFixed(1)} s · opponents within 2 m of a keeper holding it ${per('gkPressed')} s`);
