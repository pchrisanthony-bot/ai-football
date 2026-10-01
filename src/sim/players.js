// Players: the match-day player object and the kinematic movement model.
// "Responsive root, expressive body": the root reacts to input immediately
// (tapered accel, speed-limited turning); the renderer layers the weight on top.
import { PLAYER } from '../config.js';
import { rotateTowards } from '../util/math.js';
import { ROLES } from './roles.js';
import { PITCH } from './pitch.js';

let nextId = 0;
// L: a line-up entry (squads.buildLineup) — who he is, his role and his formation spot.
// slot is only his index in the line-up (staggers AI think timers), never his role.
export function makePlayer(teamIdx, slot, L, seedSkin) {
  const rd = ROLES[L.role];
  return {
    id: nextId++, team: teamIdx, slot, name: L.name, number: L.number, arch: L.arch,
    role: L.role, line: rd.line, roleDef: rd, form: { x: L.form.x, y: L.form.y }, attrs: { ...L.attrs },
    look: lookFor(teamIdx, L.squadIdx, seedSkin),
    x: 0, z: 0, vx: 0, vz: 0, speed: 0, heading: 0, facing: 0,
    move: { x: 0, z: 0, speed: 0 },   // desired movement this tick (from human or AI)
    faceTarget: null,                  // optional point to face (jockey, close control, set)
    stamina: 1, sprinting: false,
    st: { g: 0, sh: 0, sk: 0, tk: 0, sv: 0, to: 0 },   // match stats: goals, shots, skills, tackles won, saves, touches
    human: false, active: true,
    action: null,                      // current timed action (kick, tackle, skill, dive, …)
    stun: 0, noTouch: 0, possessT: 0, closeControl: false, jockey: false,
    dribble: { f: 0.45, u: 0, lat: 0, mode: 'slot', lastT: -9 },
    ai: { state: 'IDLE', pending: null, pendingT: 0, thinkT: ((slot * 0.037 + teamIdx * 0.09) % 0.2), label: '', why: '', target: null, commitT: 0 },
  };
}

// Deterministic visual variety per player (skin, hair, build), keyed by his place in
// the squad so he looks the same in every format.
const SKINS = ['#eac3a6', '#d6a488', '#b98064', '#8f5f45', '#6b4533', '#4b3126'];
const HAIRS = ['#1b1410', '#2e2018', '#5a3a22', '#a8722a', '#d8b36a', '#101010'];
const STYLES = ['short', 'buzz', 'afro', 'bun', 'mohawk', 'short'];
function lookFor(team, k0, seed = 0) {
  const k = (team * 7 + k0 * 3 + seed) % 6, k2 = (team * 5 + k0 * 2 + seed) % 6, k3 = (team + k0 * 4 + seed) % 6;
  return { skin: SKINS[k], hair: HAIRS[k2], hairStyle: STYLES[k3], build: 0.94 + ((team * 13 + k0 * 7) % 5) * 0.03 };
}

// Keep a player inside the playing area: the cage, or the pitch plus its run-off.
export function clampToArea(p) {
  const lx = PITCH.halfL + PITCH.runoff - 0.35, lz = PITCH.halfW + PITCH.runoff - 0.35;
  if (p.x > lx) { p.x = lx; if (p.vx > 0) p.vx = 0; }
  if (p.x < -lx) { p.x = -lx; if (p.vx < 0) p.vx = 0; }
  if (p.z > lz) { p.z = lz; if (p.vz > 0) p.vz = 0; }
  if (p.z < -lz) { p.z = -lz; if (p.vz < 0) p.vz = 0; }
}

export const maxSpeed = (p, sprint) => (sprint ? PLAYER.sprint : PLAYER.jog) * (0.82 + 0.22 * p.attrs.pace) * (sprint ? 0.75 + 0.25 * p.stamina : 1);

// Acceleration profiles (FC's AcceleRATE idea): explosive players have a big first
// step that tails off; lengthy ones start slower but keep pulling toward top speed.
const PROFILE = {
  Speedster: { a: 1.14, n: 1.0 }, Trickster: { a: 1.10, n: 1.0 },
  Playmaker: { a: 1.0, n: 1.3 },  Finisher: { a: 1.0, n: 1.3 },
  Enforcer:  { a: 0.86, n: 1.9 }, Keeper: { a: 0.95, n: 1.2 },
};
// How sharply a player can turn and stop (tricksters cut, enforcers lumber).
const agilityOf = p => 0.82 + 0.18 * p.attrs.control + 0.14 * p.attrs.skill - 0.1 * p.attrs.strength;

// Momentum locomotion. The player's velocity is a vector; each tick it moves toward
// the wanted velocity limited by propulsion (tapering with speed), braking, and
// sideways grip, all inside one friction circle. Turning at pace therefore costs
// speed — a 90° cut at a sprint brakes into a plant — while slow turns stay crisp.
// p.heading/p.speed stay the source of truth, so actions can still set them directly.
export function movePlayer(p, dt, lockMove = 1) {
  const m = p.steer || p.move;     // steer: a one-tick override (running onto a knocked-on ball)
  const mag = Math.hypot(m.x, m.z);
  const want = mag > 0.01 && m.speed > 0.05;
  const vmax = want ? m.speed * lockMove : 0;
  const dx = want ? m.x / mag : 0, dz = want ? m.z / mag : 0;

  const sp = p.speed;
  // Current direction of travel (or the wanted one when standing still).
  let ux = Math.cos(p.heading), uz = Math.sin(p.heading);
  if (sp < 0.35 && want) { ux = dx; uz = dz; }
  const vdx = dx * vmax, vdz = dz * vmax;
  const along = vdx * ux + vdz * uz;          // wanted speed along the run
  const lat = -vdx * uz + vdz * ux;           // wanted sideways speed

  const ag = agilityOf(p);
  const top = PLAYER.sprint * (0.82 + 0.22 * p.attrs.pace);
  const prof = PROFILE[p.arch] || PROFILE.Playmaker;
  const r = Math.min(1, sp / top);
  const aF = PLAYER.accel * prof.a * (0.8 + 0.35 * p.attrs.accel) * Math.max(0.1, 1 - Math.pow(r, prof.n));
  const aB = PLAYER.brake * ag * (p.carrying ? PLAYER.carryBrake : 1);
  const aL = (PLAYER.gripSlow + (PLAYER.grip - PLAYER.gripSlow) * r) * ag;

  // Along the run: accelerate or brake toward the wanted speed (never below zero —
  // reversing means stopping first).
  const tgt = Math.max(0, along);
  let dv = tgt > sp ? Math.min(tgt - sp, aF * dt) : -Math.min(sp - tgt, aB * dt);
  // Sideways: build lateral velocity (this is what turns the run).
  let dl = Math.max(-aL * dt, Math.min(aL * dt, lat));
  // Friction circle: total acceleration can't exceed what the studs can hold.
  const cap = PLAYER.gripMax * ag * dt, tot = Math.hypot(dv, dl);
  if (tot > cap) { dv *= cap / tot; dl *= cap / tot; }

  let vx = ux * (sp + dv) - uz * dl, vz = uz * (sp + dv) + ux * dl;
  let ns = Math.hypot(vx, vz);
  if (ns > 0.02) p.heading = Math.atan2(vz, vx);
  else if (want) p.heading = Math.atan2(dz, dx);
  if (!want && ns < 0.05) { ns = 0; vx = vz = 0; }
  p.speed = ns;

  p.vx = Math.cos(p.heading) * p.speed;
  p.vz = Math.sin(p.heading) * p.speed;
  p.x += p.vx * dt;
  p.z += p.vz * dt;

  clampToArea(p);

  // Body facing: toward a target when set (jockey, shielding), else along the run.
  if (p.faceTarget) {
    const f = Math.atan2(p.faceTarget.z - p.z, p.faceTarget.x - p.x);
    p.facing = rotateTowards(p.facing, f, 14 * dt);
  } else if (p.speed > 0.4) {
    p.facing = rotateTowards(p.facing, p.heading, 14 * dt);
  } else if (want) {
    p.facing = rotateTowards(p.facing, Math.atan2(dz, dx), 10 * dt);   // turn on the spot
  }

  // Stamina.
  if (p.sprinting && p.speed > PLAYER.jog) p.stamina = Math.max(0, p.stamina - PLAYER.staminaDrain * dt);
  else p.stamina = Math.min(1, p.stamina + PLAYER.staminaRegen * dt);
}

// Add a velocity change to a player, keeping heading/speed (the source of truth) in step.
function bump(p, dvx, dvz) {
  const vx = p.vx + dvx, vz = p.vz + dvz, sp = Math.hypot(vx, vz);
  // A shove slows the run and nudges its line; it never turns someone round.
  if (sp > 0.05 && (vx * p.vx + vz * p.vz) > 0) { p.heading = Math.atan2(vz, vx); p.speed = sp; }
  else p.speed = Math.max(0, p.speed - Math.hypot(dvx, dvz));
  p.vx = Math.cos(p.heading) * p.speed; p.vz = Math.sin(p.heading) * p.speed;
}

// Circle-vs-circle body separation, weighted by strength (the Enforcer shoves).
export function separatePlayers(players) {
  const r2 = PLAYER.radius * 2;
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.active) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b.active) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= r2 || d < 1e-6) continue;
      // Sliding or diving bodies pass through standing ones (tackles resolve separately).
      if ((a.action && a.action.ghost) || (b.action && b.action.ghost)) continue;
      const pen = r2 - d, nx = dx / d, nz = dz / d;
      const wa = b.attrs.strength / (a.attrs.strength + b.attrs.strength);
      a.x -= nx * pen * wa; a.z -= nz * pen * wa;
      b.x += nx * pen * (1 - wa); b.z += nz * pen * (1 - wa);
      // Momentum: running into someone costs the closing speed, shared by strength
      // (a shoulder from the Enforcer stops a trickster; the other way round, it doesn't).
      const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vn < 0) {
        const j = -vn * 0.8;
        bump(a, -nx * j * wa, -nz * j * wa);
        bump(b, nx * j * (1 - wa), nz * j * (1 - wa));
      }
    }
  }
}
