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
  drag: 0.013,        // a = −k|v|v   (ρ=1.2, Cd≈0.25, A=0.038 m², m=0.43 kg)
  magnus: 0.0042,     // a = S·(ω × v)
  spinDecayAir: 0.35, // 1/s
  spinDecayGround: 3.0,
  groundE: 0.55,      // vertical restitution on bounce
  groundGrip: 0.82,   // tangential velocity kept on a bounce
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

export const PLAYER = {
  radius: 0.36,
  height: 1.8,
  jog: 5.0,
  sprint: 7.4,
  accel: 22,          // m/s² at standstill — tapers a = a_max·(1 − v/v_max)
  decel: 32,
  turnSlow: 22,       // rad/s at walking pace
  turnFast: 8,        // rad/s at full sprint (sharp cuts cost speed)
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
