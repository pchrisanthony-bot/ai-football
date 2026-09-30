// =====================================================================
// STREETCAGE — tuning. Units: metres, seconds, kg. Radians for angles.
// World axes: x = along the court (home attacks +x), z = across (camera sits at +z), y = up.
// =====================================================================

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

export const COURT = {
  halfL: 16,          // 32 m long
  halfW: 9,           // 18 m wide
  wallH: 4.5,         // cage fence height (visual)
  roofH: 6.0,         // roof net — the ball never leaves play
  boardH: 1.0,        // solid kickboards at the base of the fence
  goalHalfW: 1.5,     // 3 m wide futsal goal
  goalH: 2.0,
  goalD: 1.2,
  postR: 0.05,
  boxR: 5.0,          // keeper area (quarter-circle arcs, futsal style)
  centreR: 3.0,
};

export const BALL = {
  r: 0.11,
  gravity: 9.81,
  drag: 0.012,        // a = −k|v|v above the drag crisis (ρ=1.2, Cd≈0.22, A=0.038 m², m=0.43 kg)
  dragLow: 0.02,      // …and below it (Cd≈0.4): slow balls die, a hard shot "dips" as it slows
  crisisLo: 8,        // m/s: the drag crisis (boundary layer goes turbulent) happens
  crisisHi: 14,       //      between these speeds for a modern panelled ball
  magnus: 0.0042,     // a = S·(ω × v)
  spinDecayAir: 0.35, // 1/s
  spinDecayGround: 3.0,
  groundE: 0.55,      // vertical restitution on bounce
  bounceMu: 0.45,     // friction on a bounce: spin and speed trade at the contact point
  slideMu: 0.3,       // kinetic friction while a ball skids before it rolls
  rollDecel: 1.2,     // m/s² constant rolling resistance
  rollLinear: 0.35,   // 1/s speed-proportional damping while rolling
  bounceMinVy: 0.7,   // below this the ball settles into a roll
  wallE: 0.70,        // 🔒 cage restitution (normal component) — research-validated (e > 0.85 is unrealistic)
  wallT: 0.92,        // tangential speed kept along the mesh (friction)
  postE: 0.75,
  roofE: 0.30,
  netE: 0.08,
  netDamp: 6.0,       // 1/s extra damping inside the goal
};

// Knock-on dribbling: at pace the ball is touched ahead and rolls FREE (real ball
// physics) until the next touch. Turning means reaching the ball and touching it the
// new way; a heavy touch can be nicked. Slow play / close control keep it at the feet.
export const DRIB = {
  knockMin: 3.3,      // m/s: faster than this (no close control) -> knock-on touches
  touchGap: 0.2,      // s: fastest touch cadence
  reach: 0.62,        // m ahead of the body where the foot can play it
  lunge: 0.55,        // m of extra reach when stretching to cut the ball a new way
  lose: 3.4,          // m: further than this it's a loose ball
  steal: 0.5,         // m: a defender's foot this close to a free-rolling dribble can nick it
};

// Playing surfaces change how the ball behaves (FIFA Street 2012 did this per venue):
// smooth sport court vs artificial turf, and rain makes either skid and stay low.
const SURFACE_BASE = { ...BALL };
export const SURFACES = {
  court: {},
  turf: { rollDecel: 1.5, rollLinear: 0.42, groundE: 0.5, bounceMu: 0.55, slideMu: 0.38 },
};
export function setSurface(kind = 'court', wet = false) {
  Object.assign(BALL, SURFACE_BASE, SURFACES[kind] || {});
  if (wet) {
    BALL.rollDecel *= 0.8; BALL.rollLinear *= 0.85;   // a wet ball runs on
    BALL.bounceMu *= 0.6; BALL.slideMu *= 0.55;       // …and skids instead of gripping
    BALL.groundE *= 0.9;                              // …and stays low
  }
}

export const PLAYER = {
  radius: 0.36,
  height: 1.8,
  jog: 5.0,
  sprint: 7.4,
  // Momentum locomotion: velocity is a vector steered by three grip limits, so a cut
  // at full sprint has to brake before it turns (measured before this: 90° at 7 m/s
  // in 0.2 s with no speed loss ≈ 6 g — now ≈ 0.4 s with a plant and a speed dip).
  accel: 15,          // m/s² propulsion from standstill (× archetype profile × accel attr)
  brake: 17,          // m/s² braking along the run
  grip: 15,           // m/s² sideways grip at full sprint…
  gripSlow: 30,       // …and at walking pace (tight turns are cheap when slow)
  gripMax: 27,        // friction circle: cap on total horizontal acceleration
  controlRadius: 0.62,
  staminaDrain: 0.09, // per second of sprinting
  staminaRegen: 0.05,
  kickReach: 0.95,    // ball must be within this of the player at contact
};

export const KICK = {
  passContact: 0.11,      // s from press to foot-on-ball
  shotContact: 0.16,
  lobContact: 0.14,
  passMin: 8, passMax: 19,
  chipSpin: 38,       // rad/s backspin on a chip (floats, then checks up)
  lobSpin: 24,        // rad/s backspin on a lofted pass
  throughLead: 0.75,      // s of receiver run to lead a through ball by
  shotMin: 12, shotMax: 29,
  chargeTime: 0.9,        // s to full power
  finesseSpin: 55,        // rad/s side spin on a finesse shot
  finessePower: 0.85,     // finesse trades pace for curl
  lobSpeed: 13,
  lobUp: 0.55,            // vertical fraction of lob velocity
};

export const RULES = {
  matchSeconds: 180,
  firstTo: 5,
};

export const TEAM_SIZE = 5;

export const STYLE = {
  meterMax: 1000,
  gamebreakerSecs: 20,
  points: {
    stepover: 20, dragback: 50, roulette: 100, rainbow: 100, flickup: 20,
    panna: 300, beat: 50, wallpass: 60, cagegoal: 250, goal: 100, finesse: 40,
  },
};

// Difficulty scales reaction time, decision noise and press intensity ONLY. No stat cheats, no DDA.
export const AI = {
  difficulty: 0.6,
  thinkInterval: 0.18,
};
