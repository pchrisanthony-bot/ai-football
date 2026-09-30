// Trick-shot drill set-ups (shared by the game and the headless test).
// Found by a headless search over shooter positions with the real keeper AI:
// a bank off the FAR wall comes back across the box and sneaks in at the near
// post, behind a keeper who is covering the direct angle. A defender blocks
// the direct lane so the cage is the only way.
import { COURT, BALL } from '../config.js';

export const DRILL_VARIANTS = [
  { sx: 3, sz: 1.5 },
  { sx: 5, sz: 2.5 },
  { sx: 3, sz: 4.5 },
  { sx: 4, sz: -1.5 },
].map(v => {
  const t = 0.42, gx = COURT.halfL;
  return { ...v, dx: v.sx + (gx - v.sx) * t, dz: v.sz * (1 - t), gz: Math.max(-1.1, Math.min(1.1, v.sz * 0.18)), wall: -Math.sign(v.sz), post: Math.sign(v.sz) * 1.05 };
});

export function setupDrill(m, v) {
  m.phase = 'play'; m.goalInfo = null;
  for (const p of m.players) { p.active = false; p.frozen = false; p.action = null; p.stun = 0; p.speed = 0; p.vx = p.vz = 0; p.human = false; }
  const shooter = m.players.find(p => p.team === 0 && p.slot === 4);
  const def = m.players.find(p => p.team === 1 && p.slot === 1);
  const gk = m.players.find(p => p.team === 1 && p.slot === 0);
  Object.assign(shooter, { active: true, x: v.sx, z: v.sz });
  shooter.facing = shooter.heading = Math.atan2(-v.sz, COURT.halfL - v.sx);
  Object.assign(def, { active: true, frozen: true, x: v.dx, z: v.dz });
  def.facing = def.heading = Math.atan2(v.sz - v.dz, v.sx - v.dx);
  Object.assign(gk, { active: true, x: COURT.halfL - 0.9, z: v.gz });
  gk.ai.state = 'POSITION'; gk.ai.diveFor = null; gk.ai.setZ = v.gz;
  Object.assign(m.ball, { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, goal: 0, wallHits: 0, passTo: null, flair: null, through: null, redirectT: 0, lastKick: null });
  m.gainPossession(shooter, true);
  m.ball.x = shooter.x + Math.cos(shooter.facing) * 0.45;
  m.ball.z = shooter.z + Math.sin(shooter.facing) * 0.45;
  m.ball.y = BALL.r;
  return { shooter, def, gk };
}
