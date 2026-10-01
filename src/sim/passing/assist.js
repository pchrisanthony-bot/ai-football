// =====================================================================
// PassAssistSystem: how much the game helps a human pass, by mode.
//   Manual    the stick is the direction, the charge is the pace — no help.
//   Semi      a narrow window; about half the angle to the team-mate is corrected; half
//             the pace is chosen for you.
//   Assisted  (default) a wider window; most of the angle is corrected and most of the
//             pace chosen, but the charge still weights it and aim still matters.
//   Arcade    the widest window, full correction, the least execution error.
// Inside a mode the help is contextual: less at the edge of the window, for long passes,
// for a sprinting or pressed passer, and for weaker passers (they don't see it as well).
// Assist only decides the intended direction and pace; the execution error comes after it,
// from the pass quality — no mode makes a pass perfect.
// =====================================================================
import { footballGameplayConfig as GP } from '../../config.js';
import { clamp, lerp, smooth } from '../../util/math.js';

export const MODES = GP.passing.modes;
export const MODE_IDS = Object.keys(MODES);
export const MODE_LABELS = { manual: 'MANUAL', semi: 'SEMI-ASSISTED', assisted: 'ASSISTED', arcade: 'ARCADE' };

// Share of the angle from the stick to the target that is corrected.
// c: { e (rad off), window, d (m), attr (pass 0..1), speed (m/s), near (m to the nearest opponent) }
export function correction(modeId, c) {
  const M = MODES[modeId] || MODES.assisted;
  if (!M.correct || !(c.window > 0)) return 0;
  if (modeId === 'arcade') return 1;
  const angF = 1 - 0.6 * smooth(clamp((c.e / c.window - 0.55) / 0.45, 0, 1));
  const distF = 1 - 0.3 * clamp((c.d - 20) / 25, 0, 1);
  const attrF = 0.82 + 0.18 * c.attr;
  const speedF = 1 - 0.12 * clamp((c.speed - 4) / 3.4, 0, 1);
  const pressF = 1 - 0.15 * clamp((2 - c.near) / 1.2, 0, 1);
  return clamp(M.correct * angF * distF * attrF * speedF * pressF, 0, 1);
}

// Pace: the mode's share chosen for you (auto, weighted a little by the charge), the rest
// straight from the charge (manual).
export function assistedPace(modeId, auto, manual, power) {
  const M = MODES[modeId] || MODES.assisted;
  const p = power ?? 0.3;
  return lerp(manual, auto * (0.92 + 0.2 * p), M.pace);
}
