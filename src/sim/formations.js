// =====================================================================
// Formations as data. Each slot is a role plus a normalized, team-relative position:
//   x  depth: 0 = own goal line … 1 = opponent's goal line (the neutral shape;
//      the team brain shifts it with the ball and the phase of play)
//   y  width: 0 = the team's left touchline … 1 = its right touchline
// World positions come from the active pitch and the team's attacking direction
// (formationToWorld), so one formation works on any pitch size.
// =====================================================================
import { ROLES } from './roles.js';
import { PITCH } from './pitch.js';

const S = (role, x, y) => ({ role, x, y });

export const FORMATIONS = {
  // ---- 5v5 street cage (futsal shapes)
  '1-2-1': { size: 5, name: 'Diamond 1-2-1', slots: [S('GK', 0.03, 0.5), S('FIXO', 0.24, 0.5), S('ALA', 0.46, 0.18), S('ALA', 0.46, 0.82), S('PIVO', 0.68, 0.5)] },
  '2-1-1': { size: 5, name: 'Box 2-1-1', slots: [S('GK', 0.03, 0.5), S('FIXO', 0.22, 0.3), S('FIXO', 0.22, 0.7), S('ALA', 0.45, 0.5), S('PIVO', 0.68, 0.5)] },
  '1-1-2': { size: 5, name: 'Twin pivots 1-1-2', slots: [S('GK', 0.03, 0.5), S('FIXO', 0.24, 0.5), S('ALA', 0.42, 0.5), S('PIVO', 0.64, 0.3), S('PIVO', 0.64, 0.7)] },
  // ---- 7v7
  '2-3-1': { size: 7, name: '2-3-1', slots: [S('GK', 0.03, 0.5), S('CB', 0.2, 0.32), S('CB', 0.2, 0.68), S('LM', 0.42, 0.13), S('CM', 0.4, 0.5), S('RM', 0.42, 0.87), S('ST', 0.66, 0.5)] },
  '3-2-1': { size: 7, name: '3-2-1', slots: [S('GK', 0.03, 0.5), S('LB', 0.22, 0.18), S('CB', 0.19, 0.5), S('RB', 0.22, 0.82), S('CM', 0.42, 0.35), S('CM', 0.42, 0.65), S('ST', 0.66, 0.5)] },
  '2-2-2': { size: 7, name: '2-2-2', slots: [S('GK', 0.03, 0.5), S('CB', 0.2, 0.32), S('CB', 0.2, 0.68), S('CM', 0.42, 0.32), S('CM', 0.42, 0.68), S('ST', 0.64, 0.36), S('ST', 0.64, 0.64)] },
  // ---- 9v9
  '3-3-2': { size: 9, name: '3-3-2', slots: [S('GK', 0.03, 0.5), S('LB', 0.2, 0.16), S('CB', 0.18, 0.5), S('RB', 0.2, 0.84), S('LM', 0.42, 0.15), S('CM', 0.4, 0.5), S('RM', 0.42, 0.85), S('ST', 0.64, 0.37), S('ST', 0.64, 0.63)] },
  '3-2-3': { size: 9, name: '3-2-3', slots: [S('GK', 0.03, 0.5), S('LB', 0.2, 0.18), S('CB', 0.18, 0.5), S('RB', 0.2, 0.82), S('CM', 0.38, 0.35), S('CM', 0.38, 0.65), S('LW', 0.6, 0.15), S('ST', 0.65, 0.5), S('RW', 0.6, 0.85)] },
  '4-3-1': { size: 9, name: '4-3-1', slots: [S('GK', 0.03, 0.5), S('LB', 0.22, 0.12), S('CB', 0.18, 0.38), S('CB', 0.18, 0.62), S('RB', 0.22, 0.88), S('CM', 0.4, 0.25), S('DM', 0.36, 0.5), S('CM', 0.4, 0.75), S('ST', 0.64, 0.5)] },
  // ---- 11v11
  '4-3-3': { size: 11, name: '4-3-3', slots: [S('GK', 0.03, 0.5), S('LB', 0.22, 0.12), S('CB', 0.17, 0.37), S('CB', 0.17, 0.63), S('RB', 0.22, 0.88), S('CM', 0.38, 0.28), S('DM', 0.32, 0.5), S('CM', 0.38, 0.72), S('LW', 0.6, 0.13), S('ST', 0.66, 0.5), S('RW', 0.6, 0.87)] },
  '4-2-3-1': { size: 11, name: '4-2-3-1', slots: [S('GK', 0.03, 0.5), S('LB', 0.22, 0.12), S('CB', 0.17, 0.37), S('CB', 0.17, 0.63), S('RB', 0.22, 0.88), S('DM', 0.32, 0.38), S('DM', 0.32, 0.62), S('LW', 0.52, 0.14), S('AM', 0.5, 0.5), S('RW', 0.52, 0.86), S('ST', 0.66, 0.5)] },
  '4-4-2': { size: 11, name: '4-4-2', slots: [S('GK', 0.03, 0.5), S('LB', 0.22, 0.12), S('CB', 0.17, 0.37), S('CB', 0.17, 0.63), S('RB', 0.22, 0.88), S('LM', 0.42, 0.12), S('CM', 0.38, 0.38), S('CM', 0.38, 0.62), S('RM', 0.42, 0.88), S('ST', 0.64, 0.38), S('ST', 0.64, 0.62)] },
  '3-5-2': { size: 11, name: '3-5-2', slots: [S('GK', 0.03, 0.5), S('CB', 0.18, 0.25), S('CB', 0.16, 0.5), S('CB', 0.18, 0.75), S('LWB', 0.36, 0.08), S('CM', 0.36, 0.32), S('DM', 0.3, 0.5), S('CM', 0.36, 0.68), S('RWB', 0.36, 0.92), S('ST', 0.64, 0.38), S('ST', 0.64, 0.62)] },
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
