// Headless trick-shot drill: real keeper AI, frozen defender, human-style manual bank shot.
import { Match } from '../src/sim/match.js';
import { SIM_DT, COURT, BALL } from '../src/config.js';
import { bankAim } from '../src/sim/kicks.js';
import { predictPath, makeBall } from '../src/sim/ball.js';

import { DRILL_VARIANTS as VARIANTS, setupDrill as setupDrillCore } from '../src/game/drill.js';
export { VARIANTS };
export function setupDrill(m, v) { const r = setupDrillCore(m, v); m.human = r.shooter; r.shooter.human = true; return r; }

// Find the manual angle whose preview ends in the goal (like a player watching the dotted line).
function aimFor(m, p, tz, w, power) {
  // Like a player watching the preview: find the window of angles that end in the
  // goal off the cage, then aim at the middle of it.
  const b = m.ball;
  const base = bankAim(b.x, b.z, COURT.halfL, tz, w).angle;
  const ok = [];
  for (let da = -0.12; da <= 0.12; da += 0.002) {
    const ang = base + da;
    const v = m.planShot(p, { mode: 'manual', angle: ang, power }, true);
    const bb = makeBall(); Object.assign(bb, { x: b.x, y: BALL.r, z: b.z, vx: v.vx, vy: v.vy, vz: v.vz });
    const pr = predictPath(bb, 2, 1 / 60);
    if (pr.goal === 1 && pr.events.some(e => e.type === 'wall') && !pr.events.some(e => e.type === 'post')) ok.push(ang);
  }
  return ok.length ? ok[Math.floor(ok.length / 2)] : null;
}

export function runDrill(v, tz, w, seed = 1, power = 0.95) {
  const m = new Match({ humanTeam: 0, mode: 'drill', seconds: 9999, seed, difficulty: 0.6 });
  const { shooter } = setupDrill(m, v);
  for (let i = 0; i < 20; i++) m.step(SIM_DT);
  const ang = aimFor(m, shooter, tz, w, power);
  if (ang == null) return { res: 'noaim' };
  m.requestShot(shooter, { mode: 'manual', angle: ang, power });
  const log = [];
  for (let i = 0; i < 360; i++) {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'goal') return { res: 'GOAL', cage: e.cage, log };
      if (e.type === 'save') return { res: 'save:' + e.kind, log };
      if (['wall', 'block', 'deflect', 'post'].includes(e.type)) log.push(e.type + '@' + (e.speed || 0).toFixed(0));
    }
  }
  return { res: 'miss', log };
}

export default function () {
  const results = [];
  let total = 0, goals = 0;
  VARIANTS.forEach((v, i) => {
    const outs = [];
    for (let seed = 1; seed <= 6; seed++) { const r = runDrill(v, v.post, v.wall, seed); outs.push(r.res); total++; if (r.res === 'GOAL') goals++; }
    console.log(`variant ${i} shooter(${v.sx},${v.sz}) far-wall bank → near post: ${outs.join(', ')}`);
  });
  results.push({ name: 'drill: far-wall bank beats the keeper on command (≥ 50%)', ok: goals / total >= 0.5, info: `${goals}/${total}` });
  return results;
}
