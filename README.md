# STREETCAGE

A 3D 5-a-side street football game that runs in the browser. It's played in a floodlit rooftop cage at night, and the walls are part of your attack.

It draws on **FIFA Street** for skills, pannas, wall play and the player-fired GAMEBREAKER, and on **First Touch Soccer 15** for the broadcast camera, hold-to-power controls and broadcast presentation: line-ups, the crest score bug, goal lower-thirds, R replays and the full-time sheet. Everything is built with Three.js: characters, animation, the venue, textures and audio are all procedural. No art or sound files are downloaded.

**Play:** https://ai-football-flame.vercel.app. It works on desktop (keyboard or gamepad) and on phones (touch, landscape).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. A gamepad (Xbox or PlayStation layout) works too.

```bash
npm test
```

`npm test` runs the headless checks: ball physics, player movement and dribbling, touch gestures, full AI-vs-AI matches, and the trick-shot drill against the real keeper AI.

## Online leaderboards (Supabase)
Set a **PLAYER TAG** on the title screen. Finished matches and trick-shot drill runs are then posted to **LEADERBOARDS**, which show top players, the best drill runs and the latest results.

- **Config:** the client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env.local` locally, or from project environment variables on Vercel. Without them the game runs fully offline.
- **Tables:** `match_results` and `drill_runs`, plus the views `player_leaderboard` and `drill_leaderboard`.
- **Security:** row-level security is on. Anyone can read, anonymous clients can only **insert**, and check constraints reject impossible values and bad tags. Updates and deletes are refused.
- **Limitation:** there are no accounts, so a tag isn't protected. Anyone can post under any tag. That's fine for a class demo, but add Supabase Auth if it ever needs to be trustworthy.

## Modes
- **Play Match**: 5v5 against the AI. Choose timed (2, 3 or 5 min), First to 5, or Last Man Standing (every goal you score costs you a player).
- **Watch AI (class demo)**: AI vs AI with the debug overlay on. Every AI player shows its FSM state, its chosen action and the utility scores behind it.
- **Trick-Shot Drill**: the direct lane is blocked by a defender. Bank a shot off the cage and past the keeper. The best route is off the **far** wall, back in at the near post.

**Venues** (chosen in MATCH SETUP, each with **CLEAR** or **RAIN** weather):
- **Rooftop Cage**: a night rooftop on asphalt. It has a hand-painted bedsheet banner, spray tags, a dying floodlight and a lo-fi boombox playing on the roof.
- **Stadium Cage**: a floodlit turf pitch with stands on three sides, about 1,200 fans in the two teams' colours who jump on goals, a canopy, an LED ribbon and sponsor boards.
- **The surface changes the ball**: turf rolls slower and bounces lower than the court, and rain makes either surface skid and stay low.
- **Big moments light it up**: goals flare the floodlights and paint the venue in the scorer's colours.

## Controls
| | Keyboard | Gamepad |
|---|---|---|
| Move | WASD / arrows | Left stick |
| Sprint | Shift | RT |
| Pass (hold = harder) | J | A |
| Shoot (hold for power) | K | B |
| Through ball | L | Y |
| Lob · chip | I · Ctrl+I | X · LB+X |
| Finesse curl | Ctrl+K | LB+B |
| Fire **GAMEBREAKER** (meter full) | G | L3 / R3 |
| Street Ball Control | Space (hold) | LT |
| **Panna** | Space + Shift near a defender | LT → RT |
| Stepover · roulette · drag-back · rainbow · flick-up | Q · E · F · R · U | Right-stick flicks, RB |
| *Defending:* switch player · tackle · slide | J · L · K | A · Y · B |
| Jockey · teammate press · rush keeper | Space · I (hold) · O (hold) | LT · X · Y |
| AI debug overlay · pause | Tab · Esc | Back · Start |

**On a phone:** turn it sideways, and the first tap goes full-screen.
- **Moving:** drag anywhere on the left half for the joystick.
- **Buttons on the right:** SHOOT (hold for power), PASS, THRU, LOB and SPRINT.
- **SKILL:** tap for a stepover. Swipe ↑ for a rainbow, ↓ for a drag-back, or ←/→ for a stepover. Long-press near a defender for a panna.
- **Defending:** the same buttons become SLIDE, SWITCH, TACKLE, PRESS and JOCKEY.
- **Gamebreaker:** when your meter is full, a gold **GB** button appears. Tap it to fire.
- **Home screen:** "Add to Home Screen" installs it as a full-screen landscape app.

**Shooting:** aim roughly at the goal and the stick picks the post (assisted). Aim anywhere else, such as at the cage, and the ball goes exactly where you point (manual). The dotted preview shows the path, including any rebound, and turns yellow when it's going in.

Skills, pannas, wall passes and cage goals fill the **STYLE** meter. A full meter banks a **GAMEBREAKER**, and **you choose when to fire it**, as in FIFA Street. It gives 20 seconds of harder, more precise strikes, each in slow motion, against a heavy-footed keeper. It's a boost, never a lock: about 60% of Gamebreaker strikes score in AI matches, against about 33% normally, and bad angles still get saved. AI sides fire theirs when they're attacking.

## How it's built
```
src/
  config.js            every tuning number (metres, seconds)
  sim/                 pure simulation: fixed 120 Hz, no rendering, runs in Node
    ball.js            3D ball: gravity, drag, Magnus curl, bounce→roll, cage/post/net/roof collisions
    kicks.js           solvers: pass pace, lobs, strike aiming, closed-form bank aim
    players.js         archetypes, rosters, movement (tapered accel, speed-limited turning)
    match.js           possession, touch dribbling, first touch, headers, keepers, tackles,
                       skills and pannas, style meter/GAMEBREAKER, goals, modes
    ai/director.js     team brain + player FSMs + keeper FSM
    ai/eval.js         interception, xG, keeper intercept, pass/dribble utilities
  render/              Three.js: venue, athletes (skinned, procedural animation), ball, FX, cameras
  game/                human controller (same API as the AI), trick-shot drill
  ui/  audio/  input/  HUD and menus (DOM), synthesized WebAudio, keyboard and Gamepad API
tests/                 headless physics / match / drill suites and diagnostics
```

### The AI (for the class)
Two layers, and both are inspectable:
1. **Team brain** (every 0.3 s). It works out the phase (attack / defend / loose ball) and shifts the futsal diamond with the ball. It then picks one presser, assigns man-marking by greedy matching, sends the fastest player (by predicted intercept time) to a loose ball, and chooses who makes the run in behind.
2. **Player FSM** (about every 0.18 s, with a reaction delay). The states are IDLE, SUPPORT (it samples candidate spots and scores them on openness, passing lane, threat and spacing), RUN, RECEIVE, CHASE, PRESS, MARK, COVER and ATTACK.
   - **ATTACK is utility-scored.** The player on the ball rates every option: a direct shot or a **bank shot off the cage**, pass, through ball, wall pass, dribble, skill move or shield. It then picks the best, with a little noise that scales with difficulty.
   - **The keeper has its own FSM.** Its states are POSITION, SET, DIVE, CLAIM, DISTRIBUTE and RUSH. It predicts the ball's crossing point and has to re-read any deflection or wall rebound.

Difficulty changes reaction time, decision noise and pressing intensity only. There are no stat boosts and no dynamic difficulty adjustment.

Compare this with `ChintanTrivedi/DeepGamingAI_FIFA` (see `PLAN.md`), which learns a FIFA 18 policy from pixels using SSD plus LSTMs. Ours is explicit and explainable. Press **Tab** to watch each agent's reasoning live.

### Physics notes
- **Cage walls** use the research-validated restitution e = 0.70 on the **normal** component of the ball's velocity, with light friction along the wall. A 30 m/s strike keeps about 84% of its pace through a bank. This is why the bank is a weapon.
- **The AI aims banks in closed form.** For a rebound, tan θ′ = (e_t/e)·tan θ, which gives the bounce point exactly: L = d₁·tan θ + d₂·(e_t/e)·tan θ. The strike solver then refines the aim against the real integrator, so the AI's aim, the human's aim preview and the actual ball flight all come from the same physics.
- **Spin is real.** The ball carries a full spin vector. On each bounce, friction at the contact point trades spin for speed (the ball is modelled as a hollow shell, I = ⅔mR²). A backspun chip checks up, topspin skids on, and a spinless ball grips and then rolls. Walls mirror the spin as well as the velocity, so banks stay precise.
- **Drag crisis.** Drag drops from Cd ≈ 0.4 to ≈ 0.22 between 8 and 14 m/s. Slow floated balls die, and hard shots carry and then dip as they slow.
- **Players have momentum.** Velocity is a vector, limited by propulsion (which tapers toward top speed), braking and sideways grip inside one friction circle. A 90° cut at full sprint brakes into a plant (0.4 s, 7.4 → 4.2 m/s) while a jogging cut stays sharp (0.2 s). Acceleration differs by archetype, so Speedsters are explosive and Enforcers build up. Collisions cost closing speed, weighted by strength.
- **Knock-on dribbling.** At pace the ball is touched ahead and rolls free under real physics until the next touch. Turning means reaching the ball (or lunging for it) and touching it the new way. A heavy touch can be nicked by a defender. Close control (Space / JOCKEY hold) keeps it at the feet, and a first touch on the move goes into space.
- **Keepers read what they can see.** A keeper tracks the ball's current line, not the physics engine, so he can't read a cage rebound until it happens. He also tends to misjudge it as a mirror bounce, when the mesh actually sends it off flatter. He shuffles across, sets, and dives late.
- **Graphics scale to the machine.** Quality auto-scales (LOW, MEDIUM, HIGH, ULTRA) from measured frame times, and you can set it manually under GRAPHICS in setup or pause.

### Deploying
The GitHub repo `pchrisanthony-bot/ai-football` is connected to the Vercel project `ai-football`. **Every push to `main` deploys to production automatically.** The two Supabase variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) are set on the Vercel project.

See `PLAN.md` for the research and design plan. The original 2D prototype is in `legacy/`.
