# STREETCAGE: from a 5v5 cage to 11v11 — final report

> **Scope change (5 October 2026).** STREETCAGE is a 5v5 street-cage game only. The 7v7, 9v9 and 11v11 open pitches, with their formations, roles, cameras, venues, out-of-play rules and restarts (throw-ins, corners, goal kicks), have been removed; see commit history for the removal. The numbers below were measured while those formats existed and are kept as a record.

Branch `scale-11v11`, Phases 1–12. Every number below was measured in the real game (headless sim and real Chrome on an Intel Iris Xe laptop). The raw data is in `docs/metrics/*.json` and the tests are under `tests/`.

---

## A. Code changes

| Phase | Commit | What changed |
|---|---|---|
| 1 Instrumentation | `0d496fc` | Profiler (`?profile`), telemetry overlay (Tab), frame-accurate play harness (`window.__tick`), metrics tool, shared scenarios |
| 2 P1 fixes | `aa9e3e0` | Stopping with the ball; a contact-model first touch (cushion / directed / neutral, quality from skill vs pace, angle, height, pressure) |
| 3 P2 notifications | `cb93a72` | One notice system in the top band (nothing over the pitch) |
| 4 Data-driven architecture | `813fc06` | One validated pitch config (`PITCH`); roles, formations, formats and 16-man squads as data; formation kick-off; time-based switching |
| 5 Open-pitch rules | `dec523d` | No invisible walls; swept out-of-play detection with last touch; a restart state machine (kick-off, throw-in, corner, goal kick) |
| 6 AI scaling | `82a72b8` | AI ranges derived from the pitch, goal and roles; long balls; zonal marking; aerial control |
| 7–8 Camera and open pitches | `bd69b75` | Per-format broadcast camera; grass pitch and markings from data; stadium venue; FORMAT/FORMATION setup |
| 9–11 9v9/11v11 and performance | `b9d3cbc` | Set-piece scenarios in the browser; an evidence-backed draw-call cut |
| 12 Report | this commit | Dead code removed; this report |

---

## B. Test report

| Test | Baseline | After fix | Status |
|---|---|---|---|
| Stop with the ball, released at a jog | 0.93 s / 2.92 m | **0.33 s / 0.83 m**, still 2.1 m/s at 0.2 s (smooth) | ✅ |
| Stop with the ball, released at a sprint | never stopped (10.1 m in 2 s) | **0.48 s / 1.72 m**, ball kept | ✅ |
| Stop, released mid-turn | 1.07 s | **0.50 s** | ✅ |
| Stop right after a knock-on | ball ran away | **0.60 s / 2.43 m**, ball kept | ✅ |
| Stop near an opponent | 1.23 s, ball lost | **0.48 s**, ball kept | ✅ |
| First touch, 10 m/s pass into the front, no input | killed dead (0.68 m/s in 0.02 s, magnetic) | **2.8 m/s** off the foot, runs 0.6 m | ✅ |
| First touch, cushioned (control held) | — | **1.2 m/s** (tidier than neutral) | ✅ |
| First touch, directed (stick) | — | takes it **46° into space**, 1.9 m | ✅ |
| First touch, 15 m/s ball from behind | trapped dead | **runs on 2.05 m** before he gathers it | ✅ |
| Better feet = tidier touch | — | control 0.95 → 6.4 m/s left on it; 0.45 → 8.3 m/s | ✅ |
| 90° cut at full sprint, with the ball | never within 1 s, 6.29 m overshoot | **0.40 s**, min speed 4.96 m/s, overshoot 1.35 m | ✅ |
| 90° cut at full sprint, without the ball | 0.35 s | 0.35 s (unchanged, as intended) | ✅ |
| Frame rate, LOW, 1280×720 (Iris Xe) | 5v5: 51 fps, p99 52 ms (noisy run) | **60 fps, p99 ≤ 21 ms in every format** (5v5, 7v7, 11v11) | ✅ |
| Frame rate, MEDIUM | 5v5: 21 fps | 21–55 fps from run to run, in **both** 5v5 and 11v11 (GPU power-state noise) | ⚠️ see E |
| Draw calls per frame | 5v5: 115 | **5v5: 92 · 11v11: 94** (11v11 was 196 before the merge) | ✅ |
| Boundary detection (swept) | cage only (walls) | **0 missed crossings** in 6 AI matches; a 40 m/s strike wide of the post and a ball across the corner are both caught | ✅ |
| Restart correctness | none | **15/15 rules checks**: throw-in where it crossed, corner/goal kick by last touch, the laws' distances, no double touch, human/AI takers, auto-take | ✅ |
| Throw-ins kept (11v11 AI) | 0% (headed straight back out) | **75%** | ✅ |
| Long balls kept, 25–40 m (11v11 AI) | 25% | **68%** | ✅ |
| AI scaling, 11v11 (3-min AI match) | 0 goals, 0–2 shots | **2.3 goals, 3.8 shots**, pass to target 51% | ⚠️ see E |
| AI scaling, 7v7 / 9v9 | 2.5 / 0 goals | **3.9 / 2.9 goals**, 6.9 / 7.8 shots, 65% / 58% passing | ✅ |
| 5v5 unchanged (A/B, 16 seeds) | 8.9 goals, 72.7% passing | **8.9 goals, 74.0%** | ✅ |

**Suites:** `npm test` runs 10 suites (physics, movement, control, gestures, gamebreaker, format, rules, scale, match, drill): 85 checks, all passing.

**Browser scenarios**, all frame-accurate with real keys (`tools/play/scenarios.mjs`): notices, stop-with-ball, first-touch, throw-in, corner, goal-kick and human-run. In the human-run scenario on 11v11 the player and ball were never off-screen (0 of 15 sampled frames).

---

## C. Architecture

```
formats.js ──createMatchConfig──▶ { teamSize, pitch, formations, rules, camera }
   │                                   │
pitch.js  ◀── setPitch ────────────────┘  ONE live PITCH, validated (dimensions, goal,
   │                                      keeper area, goal area, spots, run-off…)
   │   read at use time by: ball physics · AI · camera · renderer · HUD · rules
roles.js       role → line + behaviour weights (hold, push, drop, width, runs, press)
formations.js  13 formations in normalized team-relative coordinates → formationToWorld()
squads.js      16-man squads → buildLineup(team, formation) (maximises fit and quality)
ai/ranges.js   every tactical AI distance from the pitch (s) and the goal (g);
               in the cage these equal the hand-tuned 5v5 constants exactly
match.js       restart state machine: DEAD → SETUP → READY → live
               (KICKOFF · THROW_IN · CORNER · GOAL_KICK)
render/        venue per (kind, pitch); markings.js draws open pitches from PITCH;
               camera.js takes its framing from the format's camera config
```

- **One source of truth.** Nothing copies pitch dimensions at load time. A new match calls `setPitch()` and every subsystem follows it. Textures and venues are cached per pitch id.
- **No identity by index.** Players carry `role`, `line`, `roleDef` and `form`. `slot` is only a line-up index (it staggers AI think timers). The kick-off taker, drill cast, starting human, throw-in/corner/goal-kick takers and last-man-standing drops all come from roles and formation data.
- **Restarts are explicit.** Out of play is detected geometrically: the whole ball over a line, swept so no speed can skip it. The rules choose the restart from the last touch, the AI places players for the set piece, and the laws' distances are enforced. A restart goes live only when the taker plays it, through human input or an AI decision.
- **Cage vs open is data,** not branching per format: `boundary: 'cage' | 'open'`, a `marking` rule, and the camera config. The 5v5 behaviour is reproduced exactly in three places, each verified: the AI ranges (test), the camera (0 m difference) and the cage physics (identical test output).

---

## D. Scaling table

| System | 5v5 cage | 7v7 | 9v9 | 11v11 | Notes |
|---|---|---|---|---|---|
| Team creation | 5 from 16 | 7 from 16 | 9 from 16 | 11 from 16 | `buildLineup`: stars start; the 5v5 street five are unchanged |
| Formation | 1-2-1, 2-1-1, 1-1-2 | 2-3-1, 3-2-1, 2-2-2 | 3-3-2, 3-2-3, 4-3-1 | 4-3-3, 4-2-3-1, 4-4-2, 3-5-2 | Normalized and team-relative; validated at load |
| Kick-off | taker on the spot, partner beside him | ← same | ← same | ← same | Other side outside the centre circle (`centreR`) |
| Switching | intercept-time scoring | ← | ← | ← | Seconds, not metres, so it scales; hysteresis tested |
| Passing | ground passes ≤ 24 m, wall passes | ground ≤ 31 m + long balls | ← | ← (long ≤ 58 m) | 74% / 65% / 58% / 51% to target |
| Shooting | ≤ 19 m, banks off the cage | ≤ 23 m | ≤ 30 m | ≤ 30 m | Targets scale with goal width; no banks on open pitches |
| Defending | man-marking | zonal (zone 11 m) | zonal (15 m) | zonal (21 m) | Format rule; role weights shape the block |
| Goalkeeping | box arc 5 m | box 9.1 m | box 12.8 m | box 16.5 m | Set distance, distance off the line and rush depth all scale |
| Ball boundaries | walls and roof | out of play + boards | ← | ← | Swept; the net is solid from outside |
| Throw-ins | — | ✅ | ✅ | ✅ | 2 m distance; human or AI; 75% kept |
| Corners | — | ✅ | ✅ | ✅ | Box spots vs markers; `centreR` distance |
| Goal kicks | — | ✅ | ✅ | ✅ | Opponents kept out of the area |
| Camera | tuned cage framing | gantry, roi 16 m | roi 19 m | roi 22 m | The zoom follows the play near the ball, clamped per format |
| AI | tuned | ranges × 1.7 | × 2.2 (cap) | × 2.2 | `ai/ranges.js`; telemetry shows the live ranges |
| Performance (LOW) | 60 fps | 60 fps | — | 60 fps | 9v9 wasn't profiled separately (it sits between 7v7 and 11v11); 11v11 draw calls 196 → 94 |

---

## E. Remaining issues (not claimed as solved)

1. **11v11 AI quality.** The build-up is slow (most possession is more than 45 m from goal), only 51% of passes reach the intended man, and there are 3.8 shots per 3-minute AI match. It plays recognisable football with restarts, long balls, crosses and headers, but it isn't yet at the FTS/FIFA bar on a full pitch.
2. **Laws not implemented:** offside, fouls, free kicks, penalties and cards. A goal straight from a throw-in currently counts.
3. **Performance evidence is limited to this laptop.** Real-time MEDIUM results swing between 21 and 55 fps from run to run (GPU power states) in 5v5 and 11v11 alike. No real phone was measured: with 4× CPU throttling as a stand-in, 11v11 LOW runs at about 38 fps, limited by render submission.
4. **Allocation is about 6 MB/s,** every format alike. It causes no measured long frames, so it wasn't optimised.
5. **The open-pitch stadium is basic:** no dugouts, benches or corner flags, and the crowd is billboards.
6. **Human set pieces** aim at the team-mate in the stick's direction, with no on-screen aim line.
7. **The trick-shot drill needs the cage,** so it always runs 5v5. Last-man-standing on big pitches is untested.
8. **The camera** was tuned by eye at 1280×720 and 740×360 only.
9. **The 5v5 opponent now picks a random formation** for variety. Stats are unchanged within noise, but it's no longer always the diamond.
