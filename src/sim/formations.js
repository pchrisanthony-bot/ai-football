// =====================================================================
// Formations as data. Each slot is a role plus a normalized, team-relative position:
//   x  depth: 0 = own goal line … 1 = opponent's goal line (the neutral shape;
//      the team brain shifts it with the ball and the phase of play)
//   y  width: 0 = the team's left touchline … 1 = its right touchline
// World positions come from the pitch and the team's attacking direction (formationToWorld).
// =====================================================================
import { ROLES } from './roles.js';
import { PITCH } from './pitch.js';

const S = (role, x, y) => ({ role, x, y });

export const FORMATIONS = {
  // the street five's futsal shapes
  '1-2-1': { size: 5, name: 'Diamond 1-2-1', slots: [S('GK', 0.03, 0.5), S('FIXO', 0.24, 0.5), S('ALA', 0.46, 0.18), S('ALA', 0.46, 0.82), S('PIVO', 0.68, 0.5)] },
  '2-1-1': { size: 5, name: 'Box 2-1-1', slots: [S('GK', 0.03, 0.5), S('FIXO', 0.22, 0.3), S('FIXO', 0.22, 0.7), S('ALA', 0.45, 0.5), S('PIVO', 0.68, 0.5)] },
  '1-1-2': { size: 5, name: 'Twin pivots 1-1-2', slots: [S('GK', 0.03, 0.5), S('FIXO', 0.24, 0.5), S('ALA', 0.42, 0.5), S('PIVO', 0.64, 0.3), S('PIVO', 0.64, 0.7)] },
};

export function formation(id) {
  const f = FORMATIONS[id];
  if (!f) throw new Error(`Unknown formation "${id}"`);
  return f;
}

// Sanity-check every formation once (fails loudly on bad data).
for (const [id, f] of Object.entries(FORMATIONS)) {
  if (f.slots.length !== f.size) throw new Error(`Formation ${id}: ${f.slots.length} slots for size ${f.size}`);
  if (f.slots.filter(s => s.role === 'GK').length !== 1) throw new Error(`Formation ${id} needs exactly one GK`);
  for (const s of f.slots) {
    if (!ROLES[s.role]) throw new Error(`Formation ${id}: unknown role ${s.role}`);
    if (!(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1)) throw new Error(`Formation ${id}: ${s.role} outside 0..1`);
  }
}

// Team-relative (depth x, width y) → world (x, z) for a team attacking `dir` (±1).
// A team attacking +x has its right touchline at +z.
export function formationToWorld(fx, fy, dir) {
  return { x: dir * (fx * PITCH.length - PITCH.halfL), z: dir * (fy - 0.5) * PITCH.width };
}
