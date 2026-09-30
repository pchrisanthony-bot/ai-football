# STREETCAGE

A 3D 5-a-side street football game that runs in the browser. It's played in a floodlit rooftop cage at night, and the walls are part of your attack.

It draws on **FIFA Street (2012)** for skills, pannas, wall play and the style meter, and on **First Touch Soccer 15** for the broadcast camera and hold-to-power controls. Everything is built with Three.js: characters, animation, the venue, textures and audio are all procedural. No art or sound files are downloaded.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. A gamepad (Xbox or PlayStation layout) works too.

```bash
npm test
```

`npm test` runs the headless checks: ball physics, full AI-vs-AI matches, and the trick-shot drill against the real keeper AI.

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
| Street Ball Control | Space (hold) | LT |
| **Panna** | Space + Shift near a defender | LT → RT |
| Stepover · roulette · drag-back · rainbow · flick-up | Q · E · F · R · U | Right-stick flicks, RB |
| *Defending:* switch player · tackle · slide | J · L · K | A · Y · B |
| Jockey · teammate press · rush keeper | Space · I (hold) · O (hold) | LT · X · Y |
| AI debug overlay · pause | Tab · Esc | Back · Start |

**Shooting:** aim roughly at the goal and the stick picks the post (assisted). Aim anywhere else, such as at the cage, and the ball goes exactly where you point (manual). The dotted preview shows the path, including any rebound, and turns yellow when it's going in.

Skills, pannas, wall passes and cage goals fill the **STYLE** meter. When it's full, **GAMEBREAKER** triggers: 20 seconds of boosted shots and a stunned keeper.

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
- **Graphics scale to the machine.** Quality auto-scales (LOW, MEDIUM, HIGH, ULTRA) from measured frame times, and you can set it manually under GRAPHICS in setup or pause.

See `PLAN.md` for the research and design plan. The original 2D prototype is in `legacy/`.
