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
export const ROLES = {
  GK: { ...GK, label: 'Goalkeeper' },
  // futsal: the fixo (last man), the alas (wide, both ways), the pivot (target man)
  FIXO: { line: 'DEF', hold: 0.9, push: 0.1, drop: 0.07, width: 0.3, runs: 0, overlap: 0, press: 0.6, label: 'Fixo' },
  ALA: { line: 'MID', hold: 0.25, push: 0.1, drop: 0.07, width: 0.6, runs: 0.5, overlap: 0.4, press: 0.8, label: 'Ala' },
  PIVO: { line: 'ATT', hold: 0.1, push: 0.1, drop: 0.07, width: 0.4, runs: 0.8, overlap: 0, press: 0.7, label: 'Pivot' },
};
