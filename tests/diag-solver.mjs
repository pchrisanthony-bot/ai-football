import { solveStrike, bankAngle, crossPlaneX } from '../src/sim/kicks.js';
import { makeBall, predictPath } from '../src/sim/ball.js';
for (const [sx, sz, tz, w] of [[7, -4.6, -1.05, -1], [7.2, 1.4, 1.05, 1], [-5.5, -2.6, 1.05, 1], [2, 5, 1.05, 1]]) {
  const b = makeBall(); b.x = sx; b.z = sz; b.y = 0.11;
  const ba = bankAngle(sx, sz, 16, tz, w);
  const s = solveStrike(b, 16, 0.5, tz, 25, { angle0: ba.angle, iters: 6 });
  const bb = makeBall(); Object.assign(bb, { x: sx, y: 0.11, z: sz, vx: s.vx, vy: s.vy, vz: s.vz });
  const p = predictPath(bb, 3, 1 / 60);
  const c = crossPlaneX(p.pts, 16);
  console.log(`from (${sx},${sz}) tz=${tz} mirrorAng=${(ba.angle*57.3).toFixed(1)} solved=${(s.angle*57.3).toFixed(1)} vy=${s.vy.toFixed(2)} cross=${c ? c.z.toFixed(2) + ',' + c.y.toFixed(2) : 'none'} walls=${p.events.filter(e => e.type === 'wall').map(e => e.x.toFixed(1)+','+e.z.toFixed(1)).join(' ')} goal=${p.goal}`);
}
