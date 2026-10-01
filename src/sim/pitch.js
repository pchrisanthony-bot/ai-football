// =====================================================================
// The pitch: ONE authoritative description of the playing area.
// Coordinates: x along the length (team 0 attacks +x), z across (the broadcast camera
// sits at +z), y up; origin on the centre spot.
//
// PITCH is the live object every subsystem reads at use time (never copy its fields
// at module load). setPitch() validates a spec and rewrites PITCH in place, so a new
// match with a different pitch updates physics, AI, camera, rendering and UI at once.
// =====================================================================

// Pitch specs (metres). Small-sided sizes follow FA youth guidance; 11v11 the Laws
// of the Game. 'cage' pitches are walled street courts: the ball never leaves play.
export const PITCHES = {
  cage5: {
    name: 'Street cage', length: 32, width: 18, boundary: 'cage',
    goal: { width: 3, height: 2, depth: 1.2, postR: 0.05 },
    keeperArea: { kind: 'arc', radius: 5 },          // futsal quarter-circle "D"
    centreRadius: 3,
    cage: { wallHeight: 4.5, boardHeight: 1, roofHeight: 6 },
  },
  open7: {
    name: '7-a-side pitch', length: 55, width: 36, boundary: 'open',
    goal: { width: 3.66, height: 1.83, depth: 1.5, postR: 0.05 },
    keeperArea: { kind: 'rect', depth: 9.14, width: 16.46 },   // 10 × 18 yd
    penaltySpot: 7.32, centreRadius: 5.5, cornerArc: 1, runoff: 4,
  },
  open9: {
    name: '9-a-side pitch', length: 73, width: 46, boundary: 'open',
    goal: { width: 4.88, height: 1.83, depth: 1.6, postR: 0.06 },
    keeperArea: { kind: 'rect', depth: 12.8, width: 29.26 },    // 14 × 32 yd
    goalArea: { depth: 4.57, width: 13.72 },                    // 5 × 15 yd
    penaltySpot: 9.14, centreRadius: 7.32, cornerArc: 1, runoff: 4.5,
  },
  full11: {
    name: 'Full-size pitch', length: 105, width: 68, boundary: 'open',
    goal: { width: 7.32, height: 2.44, depth: 2.0, postR: 0.06 },
    keeperArea: { kind: 'rect', depth: 16.5, width: 40.32 },    // the penalty area
    goalArea: { depth: 5.5, width: 18.32 },
    penaltySpot: 11, centreRadius: 9.15, cornerArc: 1, runoff: 5,
  },
};

export const PITCH = {};

function fail(id, msg) { throw new Error(`Invalid pitch "${id}": ${msg}`); }

// Validate a spec and derive everything the game reads.
export function buildPitch(spec, id = spec.id || 'custom') {
  const num = (v, what, min = 0) => { if (!Number.isFinite(v) || v <= min) fail(id, `${what} must be a number > ${min} (got ${v})`); return v; };
  const length = num(spec.length, 'length'), width = num(spec.width, 'width');
  if (width >= length) fail(id, `width (${width}) must be less than length (${length})`);
  if (spec.boundary !== 'cage' && spec.boundary !== 'open') fail(id, `boundary must be 'cage' or 'open'`);
  const g = spec.goal || fail(id, 'goal is required');
  num(g.width, 'goal.width'); num(g.height, 'goal.height'); num(g.depth, 'goal.depth'); num(g.postR, 'goal.postR');
  if (g.width >= width) fail(id, 'goal is wider than the pitch');
  const ka = spec.keeperArea || fail(id, 'keeperArea is required');
  if (ka.kind === 'arc') { num(ka.radius, 'keeperArea.radius'); if (ka.radius >= length / 2) fail(id, 'keeper arc reaches halfway'); }
  else if (ka.kind === 'rect') {
    num(ka.depth, 'keeperArea.depth'); num(ka.width, 'keeperArea.width');
    if (ka.depth >= length / 2) fail(id, 'penalty area reaches halfway');
    if (ka.width > width) fail(id, 'penalty area is wider than the pitch');
    if (ka.width <= g.width) fail(id, 'penalty area must be wider than the goal');
  } else fail(id, `keeperArea.kind must be 'arc' or 'rect'`);
  if (spec.goalArea) {
    num(spec.goalArea.depth, 'goalArea.depth'); num(spec.goalArea.width, 'goalArea.width');
    if (ka.kind === 'rect' && (spec.goalArea.depth >= ka.depth || spec.goalArea.width >= ka.width)) fail(id, 'goal area must sit inside the penalty area');
  }
  num(spec.centreRadius, 'centreRadius');
  if (spec.boundary === 'cage') {
    const c = spec.cage || fail(id, 'cage pitches need cage { wallHeight, boardHeight, roofHeight }');
    num(c.wallHeight, 'cage.wallHeight'); num(c.boardHeight, 'cage.boardHeight'); num(c.roofHeight, 'cage.roofHeight');
    if (c.roofHeight <= g.height) fail(id, 'roof is lower than the crossbar');
  }
  const halfL = length / 2, halfW = width / 2;
  return {
    id, name: spec.name || id, boundary: spec.boundary,
    length, width, halfL, halfW,
    goalHalfW: g.width / 2, goalH: g.height, goalD: g.depth, postR: g.postR,
    keeperArea: { ...ka },
    // keeper-area "size" along the length (arc radius or box depth) — used for keeper ranges
    boxR: ka.kind === 'arc' ? ka.radius : ka.depth,
    goalArea: spec.goalArea ? { ...spec.goalArea } : null,
    penaltySpot: spec.penaltySpot ?? null,
    centreR: spec.centreRadius,
    cornerArc: spec.cornerArc ?? 0,
    runoff: spec.boundary === 'open' ? (spec.runoff ?? 4) : 0,
    // cage-only
    wallH: spec.cage?.wallHeight ?? 0,
    boardH: spec.cage?.boardHeight ?? 0,
    roofH: spec.cage?.roofHeight ?? Infinity,
    // derived scale: 1 on the 32 m cage; used to size things that grow with the pitch
    scale: length / 32,
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
export const isCage = () => PITCH.boundary === 'cage';
// Inside the keeper's area in front of the goal at goalX (±halfL)?
export function inKeeperArea(x, z, goalX, margin = 0) {
  const ka = PITCH.keeperArea, s = Math.sign(goalX) || 1;
  if (ka.kind === 'arc') return Math.hypot(x - goalX, z) < ka.radius + margin;
  const d = (goalX - x) * s;   // distance in from the goal line
  return d > -margin && d < ka.depth + margin && Math.abs(z) < ka.width / 2 + margin;
}
// Clamp a point to the field (with an inset), e.g. AI targets.
export function clampToField(x, z, inset = 0.5) {
  const lx = PITCH.halfL - inset, lz = PITCH.halfW - inset;
  return { x: Math.max(-lx, Math.min(lx, x)), z: Math.max(-lz, Math.min(lz, z)) };
}

setPitch('cage5');
