import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
import { makeBall, predictPath } from '../src/sim/ball.js';
import { crossPlaneX } from '../src/sim/kicks.js';
let n = 0;
for (let seed = 1; seed <= 4 && n < 10; seed++) {
  const m = new Match({ humanTeam: null, seconds: 180, seed });
  const orig = m.planShot.bind(m);
  m.planShot = (p, aim, prev) => {
    const v = orig(p, aim, prev);
    if (aim.bank && !prev) {
      const b = makeBall(); Object.assign(b, { x: m.ball.x, y: Math.max(m.ball.y, 0.11), z: m.ball.z, vx: v.vx, vy: v.vy, vz: v.vz });
      const pr = predictPath(b, 3, 1 / 60); const c = crossPlaneX(pr.pts, m.oppGoalX(p.team));
      console.log(`bank tz=${aim.tz} ball(${m.ball.x.toFixed(1)},${m.ball.z.toFixed(1)}) aimAng=${(aim.angle*57.3).toFixed(1)} → planned cross ${c ? c.z.toFixed(2) + '@y' + c.y.toFixed(2) : 'none'} walls=${pr.events.filter(e=>e.type==='wall').length} goal=${pr.goal}`);
      n++;
    }
    return v;
  };
  while (m.phase !== 'fulltime' && n < 10) { m.step(SIM_DT); for (const e of m.drainEvents()) if (e.type === 'goalDone') m.resumeAfterGoal(); }
}
