import { makeBall, predictPath } from '../src/sim/ball.js';
import { bankAim } from '../src/sim/kicks.js';
for (const vy of [0, 0.6, 1.2, 2.2]) {
  const b = makeBall(); b.x = 4.4; b.z = -4.7; b.y = 0.11;
  const ba = bankAim(b.x, b.z, 16, 1.0, -1);
  b.vx = Math.cos(ba.angle) * 29; b.vz = Math.sin(ba.angle) * 29; b.vy = vy;
  const p = predictPath(b, 3, 1 / 120);
  const ev = p.events.map(e => `${e.type}@${e.t.toFixed(2)}s v=${e.speed.toFixed(1)}`).join(' ');
  // speed at arrival
  const g = p.events.find(e => e.type === 'goal');
  console.log(`vy=${vy}: ${ev}  | arrival speed ${g ? g.speed.toFixed(1) : '-'}  path time ${g ? g.t.toFixed(2) : '-'}`);
}
