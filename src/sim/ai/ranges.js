// =====================================================================
// AI ranges: the distances the AI plays with, derived from the live pitch.
// The cage (32 × 18 m, 3 m goals) is the reference: there every value is the one the
// 5v5 AI was tuned with. Tactical distances grow with the pitch (s) and shooting with
// the goal (g); body-scale distances (tackle reach, jockeying, how tight a marker
// stands) never scale — a stride is a stride on any pitch.
// =====================================================================
import { PITCH } from '../pitch.js';
import { KICK } from '../../config.js';
import { rollDistance } from '../kicks.js';

export function aiRanges(rules = {}) {
  const s = Math.min(2.2, Math.max(1, PITCH.length / 32));       // tactical scale (1 in the cage)
  const g = Math.min(1.6, Math.max(1, PITCH.goalHalfW / 1.5));   // goal scale (1 for a 3 m goal)
  const r1 = v => Math.round(v * 10) / 10;
  return {
    s: r1(s), g: r1(g),
    threat: PITCH.length * 0.9375,              // a spot's threat fades to nothing this far from goal
    shot: 19 * g,                               // furthest an AI shoots from
    shotFade: 11 * g,                           // how quickly a shot's chance falls with distance
    shotZ: [-0.7, -0.3, 0.3, 0.7].map(k => k * PITCH.goalHalfW),   // where in the goal it aims
    keeperBox: { x: 4.5 * g, z: PITCH.goalHalfW + 2 },             // where a keeper can get to a shot
    saveMax: 0.95 - 0.17 * (g - 1),             // a big goal: even a shot he reaches can beat him
    minXg: 0.07 / (g * g),                      // a shot worth taking (chances are rarer on a big pitch)
    groundPass: Math.min(24 * s, rollDistance(KICK.passMax, 4.5)), // longest pass along the ground
    longPass: 0.55 * PITCH.length,              // longest lofted pass (only big pitches use them)
    support: [2.5 * s, 4.5 * s],                // support-spot search radii
    lane: [3.5 * s, 16 * s],                    // a useful distance from the carrier
    run: 7 * s,                                 // a run in behind
    markZone: rules.marking === 'zonal' ? 0.2 * PITCH.length : Infinity,   // pick up men in your zone
    keeperSet: Math.max(14, 1.5 * PITCH.boxR),  // the ball this close: the keeper gets set
    keeperOut: [1.6 * g, 2.4 * g],              // furthest off his line (set / not set)
    rush: 0.3 * PITCH.boxR + 3.5,               // a 1v1 this close to the line: he comes out
    clear: { x: 0.1875 * PITCH.length, z: 0.667 * PITCH.width },
    space: [10 * s, 14 * s],                    // a pass into space with nobody there (ground / lofted)
  };
}
