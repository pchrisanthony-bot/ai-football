# STREETCAGE 3D — Game Plan

The 2D Phaser prototype (`legacy/streetcage-2d.html`) proved the core idea: a 5v5 cage where the walls are a weapon, and AI agents running visible state machines. This plan rebuilds it as a proper 3D street-football game, pitched at the feel of **FIFA Street (2012)** and the readability of **First Touch Soccer 15**, running in a browser tab.

---

## 1. Research — what we're taking from where

### FIFA Street (2012) — the feel target
Sourced from EA's official Xbox 360 manual and reviews.

| FIFA Street feature | What it does | STREETCAGE version |
|---|---|---|
| **Street Ball Control** (hold LT) | Player stops and moves the ball under his sole to bait a defender. Holding the stick away shields. | Hold `Space`: close control. The ball stays glued to the foot, the player slows, the stick drags the ball. |
| **Panna** (LT aimed at a defender, release + pull RT) | Ball through the defender's legs. Worth 3 points in Panna Rules. | `Space` held, aim at a defender within 2.5m, tap `Shift`. On success the defender is stunned and a "PANNA!" callout plays. |
| **Skill moves** (right stick flicks) | Stepovers, body feints, ball roll, heel chop, rainbow flick, roulette, flip-flap. Each earns Style Points. | Right stick on gamepad; `Q`/`E`/`F`/`R` on keyboard. Stepover, roulette, drag-back and rainbow flick first. |
| **Flick up / juggling** (RB) | Pop the ball up to volley or beat a man in the air. | `U` / RB. Flick up, then volley with `K`. |
| **Flair modifier** (LB) | Stylish pass or shot, plus a fake shot. | `Ctrl` / LB: finesse (curl) shot, flair pass. |
| **Wall play** | Bounce passes off the arena walls. | The core mechanic. Wall passes (1-2 off the cage) and bank shots. The protected feature from the 2D PRD carries over. |
| **Match types** | Futsal, Last Man Standing (score = lose a player), Panna Rules, First to X, Timed. | Timed, First to 5, Last Man Standing. Panna Rules is a stretch goal. |
| **Style Points** | Every trick scores points. | A style meter fills with tricks, pannas and wall goals. When full, **GAMEBREAKER** triggers (borrowed from FIFA Street 2 and 3). |

Controls follow the FIFA Street layout: A pass, X lob, B shoot, Y through ball, RT sprint, LT street ball control, LB flair, RB flick-up. Defence: X tackle, B slide, LT jockey, LB switch, Y (hold) rush the keeper.

### First Touch Soccer 15 — the readability target
- **Broadcast side camera.** The camera sits high on one touchline and tracks the ball with lag, with gentle zoom. Teams always attack left and right on screen.
- **Few buttons, lots of depth.** How long you hold a button sets the power. Tap is a soft pass, hold is a driven pass or shot. Auto-switch follows the ball.
- **Snappy, readable players.** Silhouettes and kit colours read at a distance, and animation shows intent: plant foot, wind-up, follow-through.

### The reference repos (cloned to `reference/`, git-ignored)
| Repo | What it actually is | What we take |
|---|---|---|
| `wkallhof/football` | American football in Phaser 2 (TypeScript): snaps, downs, WR/DL routes | The `Mind` pattern: a polymorphic brain per role (WR, DL, …). Our AI gets role brains (Keeper, Defender, Playmaker, Forward) that share one FSM runtime. |
| `mertusta1996/Unity-Football-Freekick-Game` | Unity free-kick mechanic | **Contact-point shooting.** Where you strike the ball sets curve (sideways offset) and lift (vertical offset). Also a live trajectory preview. We build both, with the preview run through our real physics instead of a Bézier curve. |
| `ChintanTrivedi/DeepGamingAI_FIFA` | A bot that plays FIFA 18: MobileNet-SSD object detection feeding two LSTMs (movement, action) that press keys | A talking point for the AI class: learned policy (their bot) versus explainable FSM plus utility AI (ours). Our debug overlay shows each agent's state and why it chose it. |
| `sauravhiremath/fifa` | A turn-based player-draft game over sockets (React/Node) | Nothing for gameplay. A possible future for team-draft or multiplayer lobbies. |

### The research doc (motion matching, IK, broadcast camera, DDA)
Motion matching needs a mocap database we don't have. We keep the **principles** and build them procedurally:
- **No foot sliding.** Gait phase advances by *distance travelled / stride length*, never by clock time.
- **Inertialization.** Every joint is driven by a critically-damped spring toward its target pose, so a switch from run to kick keeps its momentum instead of cross-fading.
- **Two-bone IK.** The kicking foot is solved onto the ball at contact, and the keeper's hands onto the ball in a dive.
- **Responsive root, expressive body.** This resolves the research doc's "animation commitment vs. input delay" tension. Gameplay moves the root instantly (FTS-style responsiveness). The body leans, plants and recovers procedurally on top, so the game looks weighty but never feels laggy.
- **Broadcast camera** (Cam 1 wide, dynamic zoom), plus a Cam 2 tight follow for replays.
- **No DDA.** One honest difficulty value that scales reaction time and decision quality, and nothing else.

---

## 2. Pillars
1. **The cage is a weapon.** Bank shots, wall passes and rebounds must be satisfying, readable and repeatable on command.
2. **Style is rewarded.** Skill moves, pannas and flair feed a meter that pays off.
3. **Feels like a console game.** A 3D broadcast view, animated athletes, floodlit night atmosphere, replays and crowd noise.
4. **Explainable AI.** Every AI player runs an inspectable FSM with utility-scored decisions, and a toggle shows its thinking live.

---

## 3. Tech decisions
- **Three.js r186 + Vite.** ES modules, fast HMR, `npm run dev`. WebGL2 with PCF soft shadows, ACES tone mapping and bloom.
- **No downloaded art.** All geometry and textures are procedural: canvas-generated asphalt, chain-link, graffiti, window-lit skyline and ball panels. Characters are segmented low-poly athletes on a code-built skeleton. Everything is authored in code, so every animation (kicks, slides, dives, skills, celebrations) is under our control.
- **Sim/render split.** `src/sim/` is pure logic (physics, players, AI, rules) at a **fixed 120 Hz** step and runs headless in Node for automated tests (AI-vs-AI matches, bank-shot accuracy). `src/render/` only reads sim state.
- **Units are metres, kg and seconds.** The court is 32 × 18 m, the cage 4.5 m tall with a net roof, the goals 3 × 2 m (futsal).

---

## 4. Systems spec

### 4.1 Ball physics (3D, 120 Hz, substepped)
- Gravity 9.81. Quadratic air drag `a = −k|v|v`, with k ≈ 0.013 (real ball: ρ=1.2, Cd≈0.25, A=0.038 m², m=0.43 kg).
- **Magnus:** `a = S·(ω × v)`, with S tuned so a 25 m/s finesse shot with around 50 rad/s of spin bends about 2–3 m over 20 m. Spin decays over time.
- **Ground:** normal restitution 0.55 with tangential friction on bounce. Rolling uses a constant plus a linear deceleration, and bounce converts into roll.
- **🔒 Cage walls:** `v' = e·(v − 2(v·n)n)`, e = 0.70, carried over from the 2D PRD. The rebound angle equals the incidence angle, so banks are predictable. Walls also flip part of the spin. The fence **visibly ripples** at the impact point (shader) and rattles (synthesized SFX).
- **Posts and crossbar:** capsule colliders, e = 0.75, clang.
- **Nets:** the goal volume absorbs the ball, and the net mesh bulges where it's hit.
- **Roof net:** e = 0.3. The ball never leaves play, just like a real cage.
- **Trajectory preview:** the same integrator runs ahead, drawn as a dotted arc with bounce markers. It turns yellow when the prediction ends in the goal.

### 4.2 Players
- Kinematic root with acceleration taper `a = a_max(1 − v/v_max)`, hard deceleration, and turn rate limited by speed (sharp cuts at a sprint cost speed). Circle-circle body collisions with shoulder pushes.
- Attributes and archetypes (from the GDD roadmap): **Speedster, Playmaker, Trickster, Enforcer, Finisher, Keeper**. Each changes pace, control, shot power, tackling and skill.
- Stamina: sprinting drains it, jogging recovers it.
- **Dribbling:** the ball is "touched" ahead on the gait cycle, not glued on. Close control (`Space`) glues it and slows the player.
- **First touch:** a loose ball inside the control radius is trapped if its relative speed is under the player's control rating. Otherwise it's a heavy touch or deflection. Chest control happens at 1.0–1.5 m and headers at 1.5–2.3 m.
- **Kicks are timed to the animation.** Pressing kick starts the plant-and-swing, and the ball is struck on the contact frame (about 0.12–0.18 s later). The kick direction is locked at press time so input still feels immediate.

### 4.3 Actions
| Action | Keyboard | Pad | Notes |
|---|---|---|---|
| Move | WASD / arrows | L-stick | Relative to the camera |
| Sprint | Shift | RT | Drains stamina |
| Pass | J | A | Hold sets power. Auto-targets the teammate in the stick direction |
| Through ball | L | Y | Leads a teammate into space |
| Lob / cross | I | X | Lofted |
| Shoot | K | B | Hold to charge. The stick picks the post, and aiming at the cage makes it a bank shot |
| Finesse / flair | Ctrl + K / J | LB + B / A | Curl shot (contact offset), flair pass |
| Chip shot | Ctrl + I | LB + X | |
| Street Ball Control | Space (hold) | LT | Close control / shield |
| Panna | Space + Shift toward defender | LT → RT | |
| Skills | Q stepover, E roulette, F drag-back, R rainbow | R-stick flicks | |
| Flick-up | U | RB | Then K to volley |
| **Defence** | | | |
| Switch player | J | LB | |
| Standing tackle | L | X | |
| Slide tackle | K | B | Risky: recovery time on a miss |
| Jockey / contain | Space (hold) | LT | |
| Teammate press | I (hold) | RB | |
| Keeper rush | O (hold) | Y (hold) | |

### 4.4 AI (the AI-class centrepiece)
- **Team brain:** works out the phase (attack / defend / transition), anchor points of the 1-2-1 shape shifted by the ball, and marking assignment (greedy nearest-attacker matching). It also sets the press trigger.
- **Player FSM** with role-specific brains (the wkallhof `Mind` pattern):
  `IDLE (shape) · SUPPORT (find space) · RUN (in behind) · CHASE (loose ball) · PRESS / TACKLE · MARK · COVER · ATTACK (on the ball)`
- **ATTACK uses utility scoring** over SHOOT (direct or **bank via the mirror-image method**), PASS, THROUGH BALL, **WALL PASS (1-2 off the cage)**, DRIBBLE, SKILL MOVE and SHIELD. The debug overlay shows the scores.
- **Keeper FSM:** POSITION (on the ball-goal bisector) · SET · DIVE (intercept prediction plus reaction time) · CLAIM · DISTRIBUTE.
- **Perception delay:** one `difficulty` value scales reaction time, decision noise and press intensity only. There is no stat cheating and no DDA.
- **Debug overlay (`Tab`):** state tags above every AI player, the chosen action with utility scores, marking lines and support-spot heatmap samples.

### 4.5 Presentation
- **Camera:** broadcast side cam with ball-tracking lag and dynamic zoom (it tightens near the box and on breakaways). The near fence fades out.
- **Kickoff intro:** a flyover of the cage and skyline.
- **Replays:** a ring buffer records every transform, joint rotation and the ball at 60 Hz. Each goal gets an automatic replay from a low tight cam and an orbit cam, skippable.
- **Venue:** a floodlit rooftop cage at night. Painted asphalt court, chain-link fence on steel posts with kickboards, 4 floodlight masts with light cones and real shadows. City skyline with lit windows, rooftop clutter (AC units, water tank), a handful of spectators along the fence, graffiti panels.
- **FX:** fence ripple, sparks on hard wall hits, ball trail on power shots, net bulge, camera shake on goals, bloom.
- **HUD (DOM):** a broadcast score bug (teams, score, clock) and a controlled-player marker with power bar. Style and GAMEBREAKER meters, a radar, and street-style callouts (PANNA!, CAGE GOAL!, skill names with points).
- **Audio (synthesized, no files):** crowd bed plus swells, kick thumps scaled by power, fence rattle, post clang, net swish, whistle, and a hip-hop menu loop.
- **Menus:** Title → Match setup (teams, mode, length, difficulty) → Match → Full-time stats (score, shots, possession, pannas, cage goals) → Rematch. There's also a pause menu, the **Trick-Shot Drill** (bank-shot practice on command) and a controls screen.

---

## 5. Build phases and acceptance checks
| # | Phase | Done when |
|---|---|---|
| P0 | Scaffold: Vite, renderer, post FX, fixed-step loop, input (keyboard + Gamepad API) | Page runs at 60 fps with an empty scene and the input debug works |
| P1 | Venue | Court, cage, goals, lights, skyline and shadows all render and look like night at a rooftop cage |
| P2 | Athletes: rig, kits and procedural animation (idle, jog, sprint, kick, pass, slide, dive, skills, celebrate) | The animation viewer cycles through every action cleanly with no foot sliding |
| P3 | Ball physics + collisions + trajectory preview | Headless test: bank shots land within 0.3 m of the mirror-predicted target, corners never zero out velocity, no tunnelling at 35 m/s |
| P4 | Player control: move, dribble, pass/through/lob, shoot (power/finesse/chip), first touch, headers, volleys, tackles, switching | You can play solo against static opponents and every action works |
| P5 | Skills, panna, style meter, GAMEBREAKER | Each skill works on command and beats a defender at a sensible rate |
| P6 | AI: team brain, player FSMs, keeper | Headless AI-vs-AI matches produce goals (including bank shots) with no stuck states |
| P7 | Match flow, modes, HUD, menus, camera, replays, audio | A full match plays from title to stats screen |
| P8 | Polish and performance | 60 fps on a mid laptop, the drill works on command, a demo run-through passes |

---

## 6. Risks
- **Procedural characters looking cheap.** Mitigations: a strong silhouette, proportion tuning, kit detail (numbers, socks, boots), good lighting and animation quality over polygon count.
- **Physics tuning time.** Mitigation: headless test harness from P3 onward.
- **Perf with 4 shadow-casting floodlights.** Fallback: a single key shadow plus blob shadows.
- **Scope.** P0–P4 plus basic P6/P7 is the minimum playable game. Skills, GAMEBREAKER, replays and the crowd layer come after, in that order.
