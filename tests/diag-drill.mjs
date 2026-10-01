import { Match } from '../src/sim/match.js';
import { SIM_DT, BALL } from '../src/config.js';
import { PITCH } from '../src/sim/pitch.js';
import { VARIANTS, setupDrill } from './drill.test.mjs';
import { bankAim } from '../src/sim/kicks.js';
import { predictPath, makeBall } from '../src/sim/ball.js';
const v = VARIANTS[0], w = 1, tz = -1.05;
const m = new Match({ humanTeam: 0, mode: 'drill', seconds: 9999, seed: 1 });
const { shooter, gk } = setupDrill(m, v);
for (let i = 0; i < 20; i++) m.step(SIM_DT);
const b = m.ball;
let ang = null;
const base = bankAim(b.x, b.z, 16, tz, w).angle;
for (let da = 0; da <= 0.1 && ang == null; da += 0.002) for (const s of [1, -1]) { const a = base + s * da; const vv = m.planShot(shooter, { mode: 'manual', angle: a, power: 0.95 }, true); const bb = makeBall(); Object.assign(bb, { x: b.x, y: 0.11, z: b.z, vx: vv.vx, vy: vv.vy, vz: vv.vz }); const pr = predictPath(bb, 2, 1/60); if (pr.goal === 1) { ang = a; console.log('aim', (a*57.3).toFixed(1), 'pred cross', pr.events.map(e=>e.type+'@'+e.t.toFixed(2)+'('+e.x.toFixed(1)+','+e.z.toFixed(1)+')').join(' ')); break; } }
m.requestShot(shooter, { mode: 'manual', angle: ang, power: 0.95 });
for (let i = 0; i < 200; i++) {
  m.step(SIM_DT);
  const ev = m.drainEvents().filter(e => !['touch'].includes(e.type)).map(e => e.type + (e.kind ? ':' + e.kind : ''));
  if (i % 6 === 0 || ev.length) console.log(`t=${(i/120).toFixed(3)} ball(${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}) v=${Math.hypot(b.vx,b.vz).toFixed(1)} gk(${gk.x.toFixed(2)},${gk.z.toFixed(2)}) ${gk.ai.state} ${gk.action?.type || ''} ${ev.join(' ')}`);
  if (ev.some(e => e.startsWith('save') || e === 'goal')) break;
}
