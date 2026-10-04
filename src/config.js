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

// =====================================================================
// Football gameplay — offside, passing, interception, the turnover. One place to tune
// the rules and the fairness of the ball game. Difficulty (0..1) maps onto [weak, elite]
// pairs through gameplaySkill(); it changes how quickly and how well the AI reads the
// ball, never how far a player can reach it.
// =====================================================================
export const footballGameplayConfig = {
  offside: {
    tolerance: 0.15,            // m: within this of the line is level — onside
    noOffsideFrom: ['THROW_IN', 'CORNER', 'GOAL_KICK'],   // no offside straight from these
    interfereDist: 1.0,         // m: an offside man this close to a loose ball, going for it…
    contestDist: 1.6,           // …with an opponent this close to it, is challenging him for it
    screenDist: 0.8,            // m off the line of a shot and within screenKeeper m of the
    screenKeeper: 2.5,          //   keeper: blocking his line of vision
    aiMargin: 0.6,              // m AI attackers hold behind the line until the ball is played
    aiTol: [0.6, -0.2],         // m the AI passer misjudges the line by [weak, elite] (+ = lenient)
    aiPassPenalty: 0.6,         // utility an AI passer gives up for a man in an offside position
    log: false,                 // console-log snapshots and calls
  },
  passing: {
    assist: 'assisted',         // default: manual · semi · assisted · arcade
    // window: rad either side of the stick a team-mate is looked for in · correct: share of
    // the angle to him that is corrected · pace: share of the pace chosen for you (the rest
    // comes from the charge) · error: execution error multiplier.
    modes: {
      manual:   { window: 0,    correct: 0,    pace: 0,    error: 1 },
      semi:     { window: 0.35, correct: 0.55, pace: 0.5,  error: 1 },
      assisted: { window: 0.62, correct: 0.92, pace: 0.85, error: 1 },
      arcade:   { window: 1.0,  correct: 1,    pace: 1,    error: 0.55 },
    },
    // findBestPassTarget: how much each reason to pick a team-mate counts
    weights: { alignment: 0.35, distance: 0.12, progression: 0.12, space: 0.14, movement: 0.09, safety: 0.18 },
    // Pass quality 0..1: base + attr·pass, minus the situation
    quality: { base: 0.22, attr: 0.72, facing: 0.24, speed: 0.12, pressure: 0.18, oneTouch: 0.14, distance: 0.12, overhit: 0.25 },
    typeQuality: { short: 0, driven: -0.04, through: -0.05, lofted: -0.05, lob: -0.06, cross: -0.06, backheel: -0.16, emergency: -0.2 },
    // Graded execution error: σ of the direction (rad) and of the pace (fraction) per grade.
    // A pass's grade scatters (tierSpread) around the one its quality points to.
    tiers: [
      { name: 'excellent', ang: 0.014, pace: 0.03 },
      { name: 'good',      ang: 0.035, pace: 0.06 },
      { name: 'average',   ang: 0.07,  pace: 0.1 },
      { name: 'poor',      ang: 0.13,  pace: 0.16 },
      { name: 'very poor', ang: 0.23,  pace: 0.25 },
    ],
    tierSpread: 0.8,
    leadNoise: 0.3,             // σ (share) of a receiver's run misread, at the worst quality
    throughNoise: [0.06, 0.3],  // σ of a through ball's weight, best → worst quality
    // Ground pace per type: arrival speed at the target [m/s, + per m], and the cap
    arrive: { short: [6, 0.2], driven: [10.5, 0.25], through: [7, 0], backheel: [4, 0.1], emergency: [7, 0.25] },
    maxPace: { short: 19, driven: 25, through: 19, backheel: 11, emergency: 19 },
    loft: { lofted: 0.58, lob: 0.7, cross: 0.42 },   // launch elevation of lofted types
    space: [7, 24],             // m: a pass into space, tapped → full power
    backheel: { behind: 2.2, maxDist: 9 },   // rad off his facing / m
    emergency: 1.0,             // m: an opponent this close (and the ball only just his) — hurried
    contact: { backheel: 0.07, emergency: 0.07 },   // s to foot-on-ball (quicker, scrappier)
    receiveAssist: true,        // a human receiver with the stick neutral moves to meet the ball
  },
  interception: {
    // Reaction to a kick (s), [weak, elite] ranges.
    reaction: { weak: [0.35, 0.5], elite: [0.12, 0.18] },
    sameTeam: 0.55,             // the passer's side reads it sooner (they saw it coming)
    facingAway: 0.08,           // s more when the kick is behind him
    // Reading the ball's line: σ of the misread (rad / share of pace) [weak, elite] when he
    // first reacts, shrinking as he watches it travel (τ s).
    readAngle: [0.16, 0.04], readPace: [0.18, 0.05], readDecay: 0.35, readSameTeam: 0.5,
    readHz: 10,                 // perceived-path refresh
    etaMargin: 0.06,            // s a defender must beat the ball by to commit to cutting it out
    laneReach: 2.4,             // m: a marker reads a ball passing this close as his to cut out
    // Contact: how far from the body a foot can play the ball, by where it is
    reach: { front: 0.62, side: 0.55, back: 0.42 },
    stretch: 0.47,              // m: beyond this an interception is a stretch — a poke unless slow
    stretchCtl: 0.55,           // …which controls it only below this share of the normal pace
    fastCtl: 0,                 // m/s taken off the control limit for a defender cutting it out (read and in reach)
    pokeKeep: [0.25, 0.55],     // share of pace a poke keeps
  },
  possession: {
    // Winning the ball back: control it, look up, then decide (s) [weak, elite]
    control: [0.3, 0.12],
    scan: [0.4, 0.2],
    safeRisk: 0.3,              // once he's looked up (or pressed hard), only a pass this safe
  },
  defending: {
    lane: [0.12, 0.38],         // share of the way into the passing lane a marker shades [weak, elite]
    laneMax: 2.6,               // m
  },
  // The referee (Laws 8, 12, 13, 14): fouls and cards, free kicks and penalties, the
  // keeper's protection, the kick-off. Fouls are off in the street cage (no refs).
  referee: {
    footReach: 0.95,            // m a standing tackle's foot sweeps out along his facing
    slideReach: 0.75,           // m ahead of a slider's hips his foot is
    ballHit: 0.2,               // m: the sweep touches the ball this close to its centre
    bodyHit: 0.3,               // m: …and the man this close to his centre
    behindDot: 0.75,            // carrier's forward · (tackler → carrier) above this: from behind
    behindIsFoul: true,         // a tackle from directly behind that makes contact is a foul
    // Card severity: (speed − 3)/5 + behind + slide (+ denying an obvious goal-scoring chance)
    sevBehind: 0.5, sevSlide: 0.3, sevDogso: 0.9,
    yellow: 0.75, red: 1.6,
    dogsoRange: 1.0,            // × the AI's shooting range: a clear run on goal from here
    aiReckless: [0.25, 0.04],   // chance an AI goes through the back of a man anyway [weak, elite]
    gkHoldMax: 6,               // s a keeper may hold it (then an indirect free kick)
    gkClear: 1.0,               // m opponents keep beyond the area while the keeper has it in his hands
    wall: { range: 1.35, men: [2, 3, 4] },   // × shooting range: a wall; men by team size (≤7, 9, 11)
    wallGap: 0.62,              // m between men in the wall
  },
};
// AI difficulty (0.35 amateur · 0.6 pro · 0.88 legend) → 0..1 along [weak, elite].
export const gameplaySkill = diff => Math.max(0, Math.min(1, (diff - 0.2) / 0.7));
export const byDiff = (pair, diff) => pair[0] + (pair[1] - pair[0]) * gameplaySkill(diff);
