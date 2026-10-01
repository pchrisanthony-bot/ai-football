// =====================================================================
// STREETCAGE — tuning. Units: metres, seconds, kg. Radians for angles.
// World axes: x = along the court (home attacks +x), z = across (camera sits at +z), y = up.
// =====================================================================

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

// Pitch dimensions (cage and open pitches) live in ONE place: src/sim/pitch.js.

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
  trapGap: 0.12,      // s: a sole trap can follow a touch sooner than another push
  reach: 0.62,        // m ahead of the body where the foot can play it
  lunge: 0.55,        // m of extra reach when stretching to cut/stop the ball (at jogging pace;
                      //   a sprinting stride reaches further — see knockDribble)
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

// First touch: the receiving foot is a soft contact, not a magnet. Touch quality
// (control attribute vs the pace, angle and height of the ball, and pressure)
// decides how much of the incoming relative velocity survives the touch.
// Intent: 'cushion' (close control held) kills it, 'directed' (stick / AI plan) takes
// it into space, 'neutral' (no input) deflects it and lets it run on.
export const TOUCH = {
  base: 0.3,            // quality before the control attribute
  skill: 0.62,          // weight of attrs.control
  freePace: 6,          // m/s of relative pace that costs no quality
  pacePenalty: 0.032,   // quality lost per m/s above that
  side: 0.1,            // ball across the body
  behind: 0.22,         // ball from behind
  airborne: 0.15,       // bouncing / at shin height
  pressure: 0.1,        // an opponent within 1.6 m
  cushionBonus: 0.12,
  keep: { cushion: 0.05, directed: 0.14, neutral: 0.34 },   // residual of incoming relative speed at a perfect touch…
  keepPoor: 0.5,        // …plus this much more at the worst touch
  push: { cushion: 0.3, directedStill: 1.4, directedRun: 2.4, neutral: 0.15 },   // m/s placed in the touch direction
  rebound: 0.55,        // residual that would go through the body bounces back off it
  scatter: 1.2,         // m/s of sideways error at the worst touch
  miscontrol: 0.17,     // below this quality, with pace left on it, it's a loose ball
  trapFree: 3.0,        // m/s: a ball slower than this (relative) can be stopped dead under the sole;
                        //   anything quicker needs a proper (quality-limited) cushion touch
};

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
  carryBrake: 0.82,   // braking with the ball at your feet is a little softer than without
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
  throwMax: 16,           // m/s: a long throw-in (≈ 25 m)
  throwElev: 0.32,        // throw-ins loop from over the head
};

export const RULES = {
  matchSeconds: 180,
  firstTo: 5,
};

// Restarts on open pitches (seconds). The ball is dead for a beat while it runs on and
// the restart is given, the set-up lets players take their spots, and a human taker
// gets a while to choose before it's taken for him.
export const RESTART = {
  dead: 0.7,
  setup: 0.8,
  kickoff: 1.1,           // the kick-off freeze before the whistle
  aiThink: [0.35, 1.0],   // an AI taker's pause before he plays it
  autoTake: 8,
  throwDist: 2,           // m opponents keep from a throw-in (the laws)
};

// Player switching (seconds: time to win the ball, so it scales with any pitch).
export const SWITCH = {
  goalSide: 0.2,      // credit for being goal-side of the ball
  onChange: 0.12,     // margin to switch right after the ball changes hands
  margin: 0.8,        // …and at any other time
};

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
