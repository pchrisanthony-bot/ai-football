// =====================================================================
// Player roles: what a position means tactically, as data. Formations assign roles;
// the AI reads these weights instead of asking "which slot is this?".
//   line     GK · DEF · MID · ATT — the tactical line
//   hold     how firmly he keeps his position / stays behind the ball (0..1)
//   push     how far up the pitch he steps when his side attacks (fraction of length)
//   drop     how far back he drops when defending (fraction of length)
//   width    how much he holds the width of his channel (0 = drifts central, 1 = touchline)
//   runs     appetite for runs in behind (0..1)
//   overlap  appetite for overlapping the player ahead on his side (0..1)
//   press    willingness to leave shape and press the ball (0..1)
// =====================================================================

const GK = { line: 'GK', hold: 1, push: 0, drop: 0, width: 0, runs: 0, overlap: 0, press: 0 };
const CENTRE_BACK = { line: 'DEF', hold: 1, push: 0.08, drop: 0.07, width: 0.25, runs: 0, overlap: 0, press: 0.35 };
const FULL_BACK = { line: 'DEF', hold: 0.55, push: 0.14, drop: 0.06, width: 0.9, runs: 0.25, overlap: 0.7, press: 0.55 };
const WING_BACK = { line: 'DEF', hold: 0.35, push: 0.2, drop: 0.06, width: 1, runs: 0.35, overlap: 0.9, press: 0.6 };
const HOLDING = { line: 'MID', hold: 0.75, push: 0.08, drop: 0.08, width: 0.3, runs: 0.05, overlap: 0, press: 0.6 };
const CENTRAL = { line: 'MID', hold: 0.45, push: 0.12, drop: 0.08, width: 0.45, runs: 0.3, overlap: 0.15, press: 0.65 };
const ATTACKING_MID = { line: 'MID', hold: 0.25, push: 0.14, drop: 0.07, width: 0.4, runs: 0.55, overlap: 0.1, press: 0.6 };
const WIDE_MID = { line: 'MID', hold: 0.35, push: 0.13, drop: 0.08, width: 0.95, runs: 0.45, overlap: 0.3, press: 0.6 };
const WINGER = { line: 'ATT', hold: 0.15, push: 0.12, drop: 0.06, width: 1, runs: 0.75, overlap: 0, press: 0.5 };
const STRIKER = { line: 'ATT', hold: 0.1, push: 0.1, drop: 0.05, width: 0.35, runs: 1, overlap: 0, press: 0.55 };
const CENTRE_FORWARD = { line: 'ATT', hold: 0.2, push: 0.08, drop: 0.06, width: 0.3, runs: 0.55, overlap: 0, press: 0.5 };

export const ROLES = {
  GK: { ...GK, label: 'Goalkeeper' },
  // futsal / street (5v5 cage)
  FIXO: { line: 'DEF', hold: 0.9, push: 0.1, drop: 0.07, width: 0.3, runs: 0, overlap: 0, press: 0.6, label: 'Fixo' },
  ALA: { line: 'MID', hold: 0.25, push: 0.1, drop: 0.07, width: 0.6, runs: 0.5, overlap: 0.4, press: 0.8, label: 'Ala' },
  PIVO: { line: 'ATT', hold: 0.1, push: 0.1, drop: 0.07, width: 0.4, runs: 0.8, overlap: 0, press: 0.7, label: 'Pivot' },
  // the 11-a-side family (also used by 7v7 / 9v9 formations)
  CB: { ...CENTRE_BACK, label: 'Centre-back' },
  LB: { ...FULL_BACK, label: 'Left-back' },
  RB: { ...FULL_BACK, label: 'Right-back' },
  LWB: { ...WING_BACK, label: 'Left wing-back' },
  RWB: { ...WING_BACK, label: 'Right wing-back' },
  DM: { ...HOLDING, label: 'Defensive midfielder' },
  CM: { ...CENTRAL, label: 'Central midfielder' },
  AM: { ...ATTACKING_MID, label: 'Attacking midfielder' },
  LM: { ...WIDE_MID, label: 'Left midfielder' },
  RM: { ...WIDE_MID, label: 'Right midfielder' },
  LW: { ...WINGER, label: 'Left winger' },
  RW: { ...WINGER, label: 'Right winger' },
  ST: { ...STRIKER, label: 'Striker' },
  CF: { ...CENTRE_FORWARD, label: 'Centre-forward' },
};

export const LINES = ['GK', 'DEF', 'MID', 'ATT'];

export function role(id) {
  const r = ROLES[id];
  if (!r) throw new Error(`Unknown role "${id}"`);
  return r;
}
