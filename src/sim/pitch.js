// =====================================================================
// The pitch: ONE authoritative description of the playing area.
// Coordinates: x along the length (team 0 attacks +x), z across (the broadcast camera
// sits at +z), y up; origin on the centre spot. It's a walled street cage: 5v5.
//
// PITCH is the live object every subsystem reads at use time (never copy its fields
// at module load). setPitch() validates a spec and rewrites PITCH in place, so a new
// match with a different pitch updates physics, AI, camera, rendering and UI at once.
// =====================================================================

// The street cage (metres): walled, so the ball never leaves play. The keeper's area is
// the futsal quarter-circle "D"; the penalty mark (used when fouls are on) sits on its edge,
// as futsal's does.
export const PITCHES = {
  cage5: {
    name: 'Street cage', length: 32, width: 18,
    goal: { width: 3, height: 2, depth: 1.2, postR: 0.05 },
    keeperArea: { radius: 5 },
    penaltySpot: 5, centreRadius: 3,
    cage: { wallHeight: 4.5, boardHeight: 1, roofHeight: 6 },
  },
};

export const PITCH = {};

function fail(id, msg) { throw new Error(`Invalid pitch "${id}": ${msg}`); }

// Validate a spec and derive everything the game reads.
export function buildPitch(spec, id = spec.id || 'custom') {
  const num = (v, what, min = 0) => { if (!Number.isFinite(v) || v <= min) fail(id, `${what} must be a number > ${min} (got ${v})`); return v; };
  const length = num(spec.length, 'length'), width = num(spec.width, 'width');
  if (width >= length) fail(id, `width (${width}) must be less than length (${length})`);
  const g = spec.goal || fail(id, 'goal is required');
  num(g.width, 'goal.width'); num(g.height, 'goal.height'); num(g.depth, 'goal.depth'); num(g.postR, 'goal.postR');
  if (g.width >= width) fail(id, 'goal is wider than the pitch');
  const ka = spec.keeperArea || fail(id, 'keeperArea is required');
  num(ka.radius, 'keeperArea.radius');
  if (ka.radius >= length / 2) fail(id, 'keeper area reaches halfway');
  num(spec.centreRadius, 'centreRadius');
  const c = spec.cage || fail(id, 'a cage needs { wallHeight, boardHeight, roofHeight }');
  num(c.wallHeight, 'cage.wallHeight'); num(c.boardHeight, 'cage.boardHeight'); num(c.roofHeight, 'cage.roofHeight');
  if (c.roofHeight <= g.height) fail(id, 'roof is lower than the crossbar');
  if (spec.penaltySpot != null && (num(spec.penaltySpot, 'penaltySpot') >= length / 2)) fail(id, 'penalty spot past halfway');
  const halfL = length / 2, halfW = width / 2;
  return {
    id, name: spec.name || id,
    length, width, halfL, halfW,
    goalHalfW: g.width / 2, goalH: g.height, goalD: g.depth, postR: g.postR,
    keeperArea: { radius: ka.radius },
    boxR: ka.radius,                       // the keeper's area along the length
    penaltySpot: spec.penaltySpot ?? ka.radius * 1.2,
    centreR: spec.centreRadius,
    wallH: c.wallHeight, boardH: c.boardHeight, roofH: c.roofHeight,
  };
}

let version = 0;
// Make `spec` (an id in PITCHES or a spec object) the active pitch.
export function setPitch(spec = 'cage5') {
  const id = typeof spec === 'string' ? spec : spec.id || 'custom';
  const s = typeof spec === 'string' ? PITCHES[spec] : spec;
  if (!s) throw new Error(`Unknown pitch "${spec}"`);
  const built = buildPitch(s, id);
  for (const k of Object.keys(PITCH)) delete PITCH[k];
  Object.assign(PITCH, built, { version: ++version });
  return PITCH;
}

// ---- geometry helpers (all read the live PITCH)
// Inside the keeper's area (the "D") in front of the goal at goalX (±halfL)?
export function inKeeperArea(x, z, goalX, margin = 0) {
  return Math.hypot(x - goalX, z) < PITCH.keeperArea.radius + margin;
}
// Clamp a point to the field (with an inset), e.g. AI targets.
export function clampToField(x, z, inset = 0.5) {
  const lx = PITCH.halfL - inset, lz = PITCH.halfW - inset;
  return { x: Math.max(-lx, Math.min(lx, x)), z: Math.max(-lz, Math.min(lz, z)) };
}

setPitch('cage5');
