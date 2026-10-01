// Trick-shot drill set-ups (shared by the game and the headless test).
// Found by a headless search over shooter positions with the real keeper AI:
// a bank off the FAR wall comes back across the box and sneaks in at the near
// post, behind a keeper who is covering the direct angle. A defender blocks
// the direct lane so the cage is the only way.
import { BALL } from '../config.js';
import { PITCH } from '../sim/pitch.js';

// Shooter spots: `back` metres out from the goal line, `sz` across. The cage drill
// needs the cage (it's a bank off the side wall), so these assume the 5v5 cage.
const SPOTS = [
  { back: 13, sz: 1.5 },
  { back: 11, sz: 2.5 },
  { back: 13, sz: 4.5 },
  { back: 12, sz: -1.5 },
];
// The variants on the live pitch: the shooter, a blocker 42% of the way to goal, the
// keeper's start, which wall to bank off and which post to aim inside.
export function drillVariants() {
  const t = 0.42, gx = PITCH.halfL, post = PITCH.goalHalfW - 0.45;
  return SPOTS.map(({ back, sz }) => {
    const sx = gx - back;
    return { sx, sz, dx: sx + (gx - sx) * t, dz: sz * (1 - t), gz: Math.max(-1.1, Math.min(1.1, sz * 0.18)), wall: -Math.sign(sz), post: Math.sign(sz) * post };
  });
}

export function setupDrill(m, v) {
  m.phase = 'play'; m.goalInfo = null;
  // The cast (by role): our most advanced attacker, their first defender, their keeper.
  for (const p of m.players) p.active = true;
  const shooter = m.kickTaker(0);
  const def = m.players.find(p => p.team === 1 && p.line === 'DEF');
  const gk = m.keeper(1);
  for (const p of m.players) { p.active = false; p.frozen = false; p.action = null; p.stun = 0; p.speed = 0; p.vx = p.vz = 0; p.human = false; }
  Object.assign(shooter, { active: true, x: v.sx, z: v.sz });
  shooter.facing = shooter.heading = Math.atan2(-v.sz, PITCH.halfL - v.sx);
  Object.assign(def, { active: true, frozen: true, x: v.dx, z: v.dz });
  def.facing = def.heading = Math.atan2(v.sz - v.dz, v.sx - v.dx);
  Object.assign(gk, { active: true, x: PITCH.halfL - 0.9, z: v.gz });
  gk.ai.state = 'POSITION'; gk.ai.diveFor = null; gk.ai.setZ = v.gz;
  Object.assign(m.ball, { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, goal: 0, wallHits: 0, passTo: null, flair: null, through: null, redirectT: 0, lastKick: null });
  m.gainPossession(shooter, true);
  m.ball.x = shooter.x + Math.cos(shooter.facing) * 0.45;
  m.ball.z = shooter.z + Math.sin(shooter.facing) * 0.45;
  m.ball.y = BALL.r;
  return { shooter, def, gk };
}
