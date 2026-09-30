// Players: archetypes, rosters, and the kinematic movement model.
// "Responsive root, expressive body": the root reacts to input immediately
// (tapered accel, speed-limited turning); the renderer layers the weight on top.
import { PLAYER, COURT } from '../config.js';
import { clamp, rotateTowards, wrapAngle } from '../util/math.js';

// 0..1 attributes. Archetypes from the GDD roadmap.
export const ARCHETYPES = {
  Keeper:    { pace: 0.62, accel: 0.75, control: 0.6,  pass: 0.7,  shot: 0.6,  tackle: 0.5,  skill: 0.3,  strength: 0.8,  keeping: 0.85 },
  Enforcer:  { pace: 0.74, accel: 0.72, control: 0.62, pass: 0.7,  shot: 0.68, tackle: 0.95, skill: 0.4,  strength: 0.95, keeping: 0 },
  Playmaker: { pace: 0.78, accel: 0.82, control: 0.9,  pass: 0.95, shot: 0.72, tackle: 0.6,  skill: 0.78, strength: 0.6,  keeping: 0 },
  Trickster: { pace: 0.82, accel: 0.92, control: 0.95, pass: 0.76, shot: 0.72, tackle: 0.45, skill: 0.98, strength: 0.45, keeping: 0 },
  Speedster: { pace: 0.97, accel: 0.95, control: 0.72, pass: 0.66, shot: 0.72, tackle: 0.5,  skill: 0.72, strength: 0.55, keeping: 0 },
  Finisher:  { pace: 0.84, accel: 0.8,  control: 0.82, pass: 0.7,  shot: 0.97, tackle: 0.5,  skill: 0.7,  strength: 0.75, keeping: 0 },
};

// Futsal diamond: keeper, fixo (last man), two alas (wings), pivot (target striker).
// u = 0 own goal → 1 opponent goal, v = 0 → 1 across (−z → +z).
export const ROLES = [
  { role: 'GK',  pos: 'Keeper', u: 0.03, v: 0.5 },
  { role: 'DEF', pos: 'Fixo',   u: 0.24, v: 0.5 },
  { role: 'MID', pos: 'Ala',    u: 0.46, v: 0.18 },
  { role: 'MID', pos: 'Ala',    u: 0.46, v: 0.82 },
  { role: 'FWD', pos: 'Pivot',  u: 0.68, v: 0.5 },
];

export const TEAMS = {
  cage:   { id: 'cage',   name: 'CAGE KINGS',   short: 'CGK', kit: { shirt: '#1466FF', trim: '#FFD400', shorts: '#0B1F4D', socks: '#FFD400', gk: '#18C27A' },
            roster: [['Okafor', 1, 'Keeper'], ['Brandt', 4, 'Enforcer'], ['Silva', 7, 'Trickster'], ['Diallo', 11, 'Speedster'], ['Reyes', 10, 'Finisher']] },
  rooftop:{ id: 'rooftop',name: 'ROOFTOP FC',   short: 'RFC', kit: { shirt: '#FF3B3B', trim: '#FFFFFF', shorts: '#1A1A1A', socks: '#FF3B3B', gk: '#FF9F1C' },
            roster: [['Kowal', 1, 'Keeper'], ['Moreau', 5, 'Enforcer'], ['Tanaka', 8, 'Playmaker'], ['Mensah', 17, 'Speedster'], ['Vidal', 9, 'Finisher']] },
  neon:   { id: 'neon',   name: 'NEON STREETS', short: 'NEO', kit: { shirt: '#B84DFF', trim: '#39FF88', shorts: '#140A26', socks: '#39FF88', gk: '#FFE14D' },
            roster: [['Adeyemi', 1, 'Keeper'], ['Kaya', 3, 'Enforcer'], ['Lopes', 10, 'Trickster'], ['Novak', 14, 'Playmaker'], ['Hughes', 9, 'Finisher']] },
  harbour:{ id: 'harbour',name: 'HARBOUR SIDE', short: 'HBS', kit: { shirt: '#F2F2F2', trim: '#0FB5AE', shorts: '#0FB5AE', socks: '#F2F2F2', gk: '#E83F6F' },
            roster: [['Lindqvist', 1, 'Keeper'], ['Osei', 6, 'Enforcer'], ['Costa', 8, 'Playmaker'], ['Park', 7, 'Speedster'], ['Ivanov', 11, 'Trickster']] },
};

let nextId = 0;
export function makePlayer(teamIdx, slot, teamDef, seedSkin) {
  const [name, number, arch] = teamDef.roster[slot];
  const r = ROLES[slot];
  const a = { ...ARCHETYPES[arch] };
  return {
    id: nextId++, team: teamIdx, slot, name, number, arch, role: r.role, posName: r.pos,
    baseU: r.u, baseV: r.v, attrs: a,
    look: lookFor(teamIdx, slot, seedSkin),
    x: 0, z: 0, vx: 0, vz: 0, speed: 0, heading: 0, facing: 0,
    move: { x: 0, z: 0, speed: 0 },   // desired movement this tick (from human or AI)
    faceTarget: null,                  // optional point to face (jockey, close control, set)
    stamina: 1, sprinting: false,
    human: false, active: true,
    action: null,                      // current timed action (kick, tackle, skill, dive, …)
    stun: 0, noTouch: 0, possessT: 0, closeControl: false, jockey: false,
    dribble: { f: 0.45, u: 0, lat: 0 },
    ai: { state: 'IDLE', pending: null, pendingT: 0, thinkT: Math.random() * 0.2, label: '', why: '', target: null, commitT: 0 },
  };
}

// Deterministic visual variety per player (skin, hair, build).
const SKINS = ['#eac3a6', '#d6a488', '#b98064', '#8f5f45', '#6b4533', '#4b3126'];
const HAIRS = ['#1b1410', '#2e2018', '#5a3a22', '#a8722a', '#d8b36a', '#101010'];
const STYLES = ['short', 'buzz', 'afro', 'bun', 'mohawk', 'short'];
function lookFor(team, slot, seed = 0) {
  const k = (team * 7 + slot * 3 + seed) % 6, k2 = (team * 5 + slot * 2 + seed) % 6, k3 = (team + slot * 4 + seed) % 6;
  return { skin: SKINS[k], hair: HAIRS[k2], hairStyle: STYLES[k3], build: 0.94 + ((team * 13 + slot * 7) % 5) * 0.03 };
}

export const maxSpeed = (p, sprint) => (sprint ? PLAYER.sprint : PLAYER.jog) * (0.82 + 0.22 * p.attrs.pace) * (sprint ? 0.75 + 0.25 * p.stamina : 1);

// Kinematic movement: tapered acceleration, hard deceleration, turn rate that
// falls with speed. Returns nothing; mutates p.
export function movePlayer(p, dt, lockMove = 1) {
  const m = p.move;
  const want = Math.hypot(m.x, m.z) > 0.01 && m.speed > 0.05;
  const vmax = m.speed * lockMove;

  if (want) {
    const target = Math.atan2(m.z, m.x);
    const turnRate = PLAYER.turnSlow + (PLAYER.turnFast - PLAYER.turnSlow) * clamp(p.speed / PLAYER.sprint, 0, 1);
    const diff = Math.abs(wrapAngle(target - p.heading));
    // Sharp cut at pace: bleed speed first (plant & cut), then turn.
    if (diff > 1.9 && p.speed > 3.2) p.speed = Math.max(0, p.speed - PLAYER.decel * 0.9 * dt);
    p.heading = p.speed < 0.6 ? target : rotateTowards(p.heading, target, turnRate * dt);
    const acc = PLAYER.accel * (0.7 + 0.45 * p.attrs.accel);
    if (p.speed > vmax) p.speed = Math.max(vmax, p.speed - PLAYER.decel * dt);
    else p.speed = Math.min(vmax, p.speed + acc * Math.max(0.12, 1 - p.speed / Math.max(vmax, 0.1)) * dt);
  } else {
    p.speed = Math.max(0, p.speed - PLAYER.decel * dt);
  }

  p.vx = Math.cos(p.heading) * p.speed;
  p.vz = Math.sin(p.heading) * p.speed;
  p.x += p.vx * dt;
  p.z += p.vz * dt;

  // Stay inside the cage.
  const lx = COURT.halfL - 0.35, lz = COURT.halfW - 0.35;
  if (p.x > lx) { p.x = lx; if (p.vx > 0) p.vx = 0; }
  if (p.x < -lx) { p.x = -lx; if (p.vx < 0) p.vx = 0; }
  if (p.z > lz) { p.z = lz; if (p.vz > 0) p.vz = 0; }
  if (p.z < -lz) { p.z = -lz; if (p.vz < 0) p.vz = 0; }

  // Body facing: toward a target when set (jockey, shielding), else along the run.
  if (p.faceTarget) {
    const f = Math.atan2(p.faceTarget.z - p.z, p.faceTarget.x - p.x);
    p.facing = rotateTowards(p.facing, f, 14 * dt);
  } else if (p.speed > 0.4) {
    p.facing = rotateTowards(p.facing, p.heading, 18 * dt);
  }

  // Stamina.
  if (p.sprinting && p.speed > PLAYER.jog) p.stamina = Math.max(0, p.stamina - PLAYER.staminaDrain * dt);
  else p.stamina = Math.min(1, p.stamina + PLAYER.staminaRegen * dt);
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
    }
  }
}
