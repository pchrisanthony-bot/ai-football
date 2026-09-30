// GAMEBREAKER rules (from the FIFA Street research): the meter banks it, the player
// chooses when to fire it, and it's a boost — never a guaranteed goal.
import { Match } from '../src/sim/match.js';
import { SIM_DT, STYLE } from '../src/config.js';

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 1. A full meter is banked, not fired.
  {
    const m = new Match({ humanTeam: 0, seconds: 180, seed: 1 });
    m.phase = 'play';
    m.addStyle(0, STYLE.meterMax, 'TEST');
    const ev = m.drainEvents().map(e => e.type);
    check('a full meter banks a GAMEBREAKER (no auto-fire)', m.teams[0].gbReady && m.teams[0].gb === 0 && ev.includes('gbReady') && !ev.includes('gamebreaker'));
    const fired = m.activateGB(0);
    check('the player fires it on their own timing', fired && m.teams[0].gb === STYLE.gamebreakerSecs && !m.teams[0].gbReady && m.teams[0].style === 0);
    check('it can only be fired once per fill', !m.activateGB(0));
  }
  // 2. An AI side fires its own when it's attacking.
  {
    const m = new Match({ humanTeam: null, seconds: 180, seed: 2 });
    let t = 0, when = null;
    while (t < 60 && !when) {
      if (m.phase === 'play' && !m.teams[1].gbReady && m.teams[1].gb === 0) { m.teams[1].style = STYLE.meterMax; m.teams[1].gbReady = true; }
      m.step(SIM_DT); t += SIM_DT;
      for (const e of m.drainEvents()) {
        if (e.type === 'goalDone') m.resumeAfterGoal();
        if (e.type === 'gamebreaker' && e.team === 1) { const o = m.ball.owner; when = { t, attacking: !!o && o.team === 1 && o.x * m.teams[1].dir > 0 }; }
      }
    }
    check('an AI side fires it with the ball in the attacking half', when && when.attacking, when ? `after ${when.t.toFixed(1)} s` : 'never fired');
  }
  // 3. A real boost, never a lock: identical strikes from the same spots at a set
  //    keeper, with and without a GAMEBREAKER running.
  {
    // A realistic mix: clean looks, tight angles and long range (FIFA Street: 'more often
    // than not' a goal, but a poor angle can still be saved).
    const spots = [[8, 0], [10, -2], [6, 0.5], [7.5, -1], [14, 6], [14.5, -5.5], [13, 5], [2, 0], [0, -4], [12, -6.5]];
    const trial = (gbOn) => {
      let goals = 0, n = 0;
      for (const [sx, sz] of spots) for (let seed = 1; seed <= 3; seed++) {
        const m = new Match({ humanTeam: 0, mode: 'drill', seconds: 9999, seed, difficulty: 0.6 });
        m.phase = 'play';
        for (const p of m.players) p.active = false;
        const s = m.players.find(p => p.team === 0 && p.slot === 4), gk = m.keeper(1) || m.players.find(p => p.team === 1 && p.role === 'GK');
        Object.assign(s, { active: true, x: sx, z: sz, human: true }); m.human = s;
        s.facing = s.heading = Math.atan2(-sz, 16 - sx);
        Object.assign(gk, { active: true, x: 15.1, z: sz * 0.2 });
        m.ball.x = s.x + Math.cos(s.facing) * 0.45; m.ball.z = s.z + Math.sin(s.facing) * 0.45; m.gainPossession(s, true);
        if (gbOn) m.teams[0].gb = 99;
        for (let i = 0; i < 40; i++) m.step(SIM_DT);
        m.requestShot(s, { mode: 'assist', tz: gk.z > 0 ? -1.2 : 1.2, ty: 0.7, power: 0.92 });
        n++;
        for (let i = 0; i < 360; i++) {
          m.step(SIM_DT);
          const ev = m.drainEvents();
          if (ev.some(e => e.type === 'goal')) { goals++; break; }
          if (ev.some(e => e.type === 'save')) break;
        }
      }
      return { goals, n };
    };
    const base = trial(false), gb = trial(true);
    check('GAMEBREAKER strike: a real boost, never a lock', gb.goals > base.goals && gb.goals < gb.n * 0.9,
      `GB ${gb.goals}/${gb.n} vs normal ${base.goals}/${base.n} identical strikes`);
  }
  return out;
}
