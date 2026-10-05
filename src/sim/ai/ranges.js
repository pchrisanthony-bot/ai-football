// =====================================================================
// AI ranges: the distances the AI plays with in the cage (32 × 18 m, 3 m goals),
// derived from the live pitch so a re-sized cage stays consistent.
// =====================================================================
import { PITCH } from '../pitch.js';
import { KICK } from '../../config.js';
import { rollDistance } from '../kicks.js';

export function aiRanges() {
  return {
    threat: PITCH.length * 0.9375,              // a spot's threat fades to nothing this far from goal
    shot: 19,                                   // furthest an AI shoots from
    shotFade: 11,                               // how quickly a shot's chance falls with distance
    shotZ: [-0.7, -0.3, 0.3, 0.7].map(k => k * PITCH.goalHalfW),   // where in the goal it aims
    keeperBox: { x: 4.5, z: PITCH.goalHalfW + 2 },                 // where a keeper can get to a shot
    saveMax: 0.95,                              // the best a keeper's chance gets
    minXg: 0.07,                                // a shot worth taking
    groundPass: Math.min(24, rollDistance(KICK.passMax, 4.5)),     // longest pass along the ground
    support: [2.5, 4.5],                        // support-spot search radii
    lane: [3.5, 16],                            // a useful distance from the carrier
    run: 7,                                     // a run in behind
    keeperSet: 14,                              // the ball this close: the keeper gets set
    keeperOut: [1.6, 2.4],                      // furthest off his line (set / not set)
    rush: 0.3 * PITCH.boxR + 3.5,               // a 1v1 this close to the line: he comes out
    clear: { x: 0.1875 * PITCH.length, z: 0.667 * PITCH.width },
    space: [10, 14],                            // a pass into space with nobody there (ground / lofted)
  };
}
