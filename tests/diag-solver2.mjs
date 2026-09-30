import { solveStrike, bankAngle, crossPlaneX } from '../src/sim/kicks.js';
import { makeBall, predictPath } from '../src/sim/ball.js';
const b = makeBall(); b.x = 2.1; b.z = -1.3; b.y = 0.11;
const ba = bankAngle(2.1, -1.3, 16, 1.05, 1);
console.log('mirror', (ba.angle * 57.3).toFixed(1), 'bounceX', ba.bounceX.toFixed(2));
for (const speed of [25, 28]) {
  const s = solveStrike(b, 16, 0.4, 1.05, speed, { angle0: ba.angle, iters: 6 });
  const bb = makeBall(); Object.assign(bb, { x: 2.1, y: 0.11, z: -1.3, vx: s.vx, vy: s.vy, vz: s.vz });
  const p = predictPath(bb, 3, 1 / 60);
  console.log(speed, 'solved', (s.angle * 57.3).toFixed(2), 'vy', s.vy.toFixed(2), 'cross', JSON.stringify(s.cross), p.events.filter(e => e.type !== 'bounce').map(e => `${e.type}(${e.x.toFixed(1)},${e.y.toFixed(2)},${e.z.toFixed(1)})`).join(' '));
}
