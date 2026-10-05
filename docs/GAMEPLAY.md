# Offside, fair passing and interceptions — report

> **Scope change (5 October 2026).** STREETCAGE is a 5v5 street-cage game only. The 7v7, 9v9 and 11v11 open pitches, with their formations, roles, cameras, venues, out-of-play rules and restarts (throw-ins, corners, goal kicks), have been removed; see commit history for the removal. Offside and the referee (fouls, cards, free kicks, penalties) remain as optional cage rules: off by default (street rules), switched on with the OFFSIDE and FOULS & CARDS settings. Their tests now run in the cage. The open-pitch measurements below are kept as a record.

All of it is tuned in one place, `footballGameplayConfig` in `src/config.js`, with sections for `offside`, `passing`, `interception`, `possession` and `defending`. Difficulty maps onto `[weak, elite]` pairs through `gameplaySkill()` and `byDiff()`. It changes how fast and how well the AI reads the ball. It never changes how far a player can reach.

## Architecture

| System | File | Job |
|---|---|---|
| OffsideSystem | `src/sim/rules/offside.js` | Finds the line. Takes a frozen snapshot at each touch by a team-mate. Calls the offence on involvement and gives the indirect free kick. Logs (`offside.log`). |
| PassingSystem | `src/sim/passing/passing.js` | Turns input into a pass: intent → ideal → quality → read of the run → assist → graded error → launch. Keeps the pass context (`ctx`). |
| PassTargetSelector | `src/sim/passing/targets.js` | `findBestPassTarget`: weighted score over alignment, distance, progression, space, movement and an ETA-based safety check. `inferReceiver` for manual mode. |
| PassTrajectorySolver | `src/sim/passing/trajectory.js` | Pace and launch for each type (short, driven, through, backheel, emergency, lofted, lob, cross, lofted through), and the receiver's reception point. |
| PassAssistSystem | `src/sim/passing/assist.js` | Manual, Semi, Assisted and Arcade, adjusted by context. |
| InterceptionSystem | `src/sim/ai/interception.js` | Per-player reaction to each new ball line. Each side's misread of the path, which shrinks over time. ETA-with-margin intercepts. Reading who a pass is for. |
| DefensivePositioning | `src/sim/ai/director.js` (MARK / PRESS / CUT OUT) | Press the man we read the pass is for; one cutter whose ETA beats the ball; markers shade into the lane. |
| PossessionSystem | `match.gainPossession` + `director.attackThink` | Winning the ball: CONTROL → SCAN → decide. |
| BallContactSystem | `match.interact` / `footReach` / `poke` | Reach by where the ball is, stretch, unread ball, poke and deflection. |
| Debug | `src/render/debugdraw.js`, `src/game/telemetry.js` | 3D overlay and telemetry text (Tab). |

## Baseline: what it did before (measured)

Human passes were measured with the real controller (`tests/diag-passing.mjs`, 5v5).

| | Before | After |
|---|---|---|
| No defender, stick 45–60° off the team-mate | **100%** reach him (the pass bent onto him) | 0%. It goes where it was aimed (into space). |
| No defender, stick 0–30° off | 100% | 100% |
| Defender 5.5 m off the lane | 0% cut out | 0% cut out |
| Defender 1.4 m off the lane, aimed straight | 92–100% **cleanly** intercepted | 42–83% intercepted; some are contested (pokes and deflections) |
| Defender standing in the lane | 67–100% intercepted | 50%, plus 8–25% contested |

AI v AI, 12 matches × 5 minutes, PRO (`tests/diag-flow.mjs`):

| | 5v5 before → after | 7v7 before → after | 11v11 before → after |
|---|---|---|---|
| Passes intercepted | 23% → 11% | 17% → 5% | 12% → 6% |
| Pass completion | 68% → 69% | 62% → 71% | 52% → 66% |
| Winner's first pass/shot, median | 0.42 → 0.59 s | 0.38 → 0.58 s | 0.25 → 0.38 s |
| …within 0.3 s of winning it | 37% → 7% | 44% → 23% | 62% → 36% (all safe passes under pressure) |
| Goals | 15.3 → 11.3 | 7.2 → 4.3 | 3.5 → 1.3 |
| Offsides | — | 0.3 | 0.2 |

Fewer goals in AI v AI is a consequence of the laws, not a regression to tune away. Most of the old open-pitch goals came from attackers waiting beyond the last defender. Measured in 11v11, the mean shot distance went from 12.4 m to 15.3 m, and shots stayed level (6.2 → 6.3). Removing each new behaviour in turn (offside, lane shading, the scan beat, the reaction delay, the pass error) costs about 0.5 goals per 5 minutes each.

The headless sim costs +14% CPU in 11v11 (6.5 ms vs 5.8 ms per simulated second, about 0.1 ms per frame) and +5% in 5v5.

## Changes

### 1. Offside (Law 11)

- **Before:** there was no offside at all.
- **Root cause:** it had never been implemented.
- **Files:** `src/sim/rules/offside.js` (new), `src/sim/match.js`, `src/sim/formats.js`, `src/sim/ai/director.js`, `src/sim/ai/eval.js`, `src/main.js`, `src/render/matchview.js`, `src/ui/menus.js`.
- **Logic:**
  - **The line.** The second-last opponent sets it (the keeper counts as one). With fewer than two opponents, only the halfway line applies.
  - **Offside position.** In the opponents' half, and beyond both the ball and the second-last opponent by more than `offside.tolerance`. Level is onside.
  - **The snapshot.** Every touch by a team-mate takes one: a kick, header, control, chest, block or dribble touch. It is frozen, and records `flagged`, the `line`, the `receiver` and `receiverOffside`.
  - **What counts as involvement.** Playing or touching the ball, including a rebound or deflection. Challenging an opponent for a loose ball (`interfereDist` / `contestDist`). Standing in the keeper's line of vision on a shot that goes in (`screenDist` / `screenKeeper`).
  - **What happens to the snapshot.** Coming back onside doesn't clear it. A defender's deliberate play ends it; his deflection, block or save doesn't. There is no offside straight from a throw-in, corner or goal kick (`noOffsideFrom`).
  - **The penalty.** A new `FREE_KICK` restart (indirect) for the defenders where the player became involved. An indirect free kick that goes straight in gives a goal kick.
  - **AI.** In possession, AI spots are clamped behind the line minus `aiMargin`, and runners curve along the defender's shoulder. AI passers give up `aiPassPenalty` of utility for a man they read as offside; weaker sides misjudge the line by up to `aiTol`.
  - **Rules setting.** `rules.offsideEnabled`: off in the 5v5 cage, on for 7v7, 9v9 and 11v11. The setup menu has OFFSIDE AUTO / ON / OFF.
  - **Feedback.** An "OFFSIDE · FREE KICK · team" banner, and an OFFSIDES row on the full-time sheet.
- **Tests:** `tests/offside.test.mjs`, 12 checks. Tests 1–4 of the brief, plus level, own half, throw-in, deflection vs deliberate play, an uninvolved offside man, challenging for the ball, the rule setting, and AI v AI holding the line.
- **Result:** all pass.
  - In the browser (11v11), a team-mate 2 m beyond the line was flagged at the pass (line x 19.05). He dropped back onside to x 16.4 to take it, and was still called. The free kick was taken from his position.
  - In AI v AI: 0.2–0.3 offsides a match, and 0 of 178 passes went to a man in an offside position.

### 2. Passing: intent, target, assist, quality, error, trajectory

- **Before:**
  - `pickReceiver` picked the team-mate nearest the stick inside a 54° window. Then `fireKick` aimed exactly at his lead point.
  - The only error was uniform noise of ±(1 − pass) × 0.05 rad (under 1° for most players).
  - With no one in the window, the ball went a fixed 10 m into space.
- **Root cause:** the target was magnetic, and an off-aim stick still found the man. Execution error didn't depend on the situation, and there were no pass types, modes or feedback.
- **Files:** `src/sim/passing/*` (new), `src/sim/match.js` (`requestPass`, `fireKick`, `leadTarget`, `dinkPass`), `src/game/human.js`.
- **Logic:**
  - The weighted selector picks the target (`passing.weights`).
  - Pass types: short and driven (driven by a side-swipe or a charge of 0.8+), through, lofted, lob (the double-tap dink), lofted through, cross (lofted from wide into the box), backheel (a short ball behind him on the move) and emergency (an opponent within 1 m and the ball only just his).
  - The four assist modes (`passing.modes`), adjusted by context: angle within the window, distance, the passer's attribute, his speed, pressure.
  - Quality (`passing.quality`, `typeQuality`) comes from:
    - the passing attribute
    - body shape (across or behind him)
    - his speed
    - pressure
    - a first-time ball
    - distance
    - over-hitting a ground ball.

    Quality points to one of five grades (`tiers`), with a spread (`tierSpread`). The grade sets the σ of the direction error and the pace error.
  - The read of a moving receiver's run varies (`leadNoise`), and through balls vary in weight (`throughNoise`).
  - The charge weights every pass type now, through and lob included.
  - Passes into space go 7–24 m depending on the charge (`space`).
  - The AI goes through the same quality and error pipeline.
  - Pass feedback: a faint ring where the pass was meant to go, tinted by its grade.
- **Config:** `footballGameplayConfig.passing`. PASS ASSIST is in the setup and pause menus.
- **Tests:** `tests/passing.test.mjs`. Tests 5 and 6, assist modes, graded error.
- **Result:**
  - A stick 45° off goes within 5° of where it was aimed, never pulled onto the man (0/12 targeted).
  - A clear lane aimed ±15° reaches him 100% of the time, standing or running.
  - On the same 12° miss, manual stays 12.5° off him, semi 6.3°, assisted 1.6° and arcade 0°.
  - A settled skilled pass has quality 0.90 (91% excellent or good). A rushed one has quality 0.02 (99% poor or very poor).

### 3. Interceptions: no omniscience, reaction, misread, ETA

- **Before:**
  - Defenders used the exact predicted ball path from the team tick.
  - A marker stepped in whenever `b.passTo === his man`. That read the pass's hidden intent.
  - There was no reaction to the kick beyond the 0.3 s team tick.
  - During any pass, the whole defending side went into LOOSE (chase or support).
- **Root cause:** the AI read the sim state rather than the ball.
- **Files:** `src/sim/ai/interception.js` (new), `src/sim/ai/director.js`, `src/sim/match.js` (`emit` hook), `src/game/human.js` (switching on the exact path).
- **Logic:**
  - Each strike, header, deflection, block, save, chest-down or tackle gives every player a reaction delay (`interception.reaction`): elite 0.12–0.18 s, weak 0.35–0.50 s. The delay is shorter for good tacklers, longer when the ball was struck behind him (`facingAway`), and shorter for the passer's side (`sameTeam`).
  - Until his reaction has passed, a player keeps doing what he was doing.
  - Each side reads the path with a direction and pace error (`readAngle`, `readPace`) that decays (`readDecay`).
  - A defender commits to cutting it out only where his ETA beats the ball by `etaMargin`. One CUT OUT player per side at a time.
  - The rest defend the pass rather than chase it:
    - the presser goes to the man the side *reads* the pass is for (`readTarget`, from the ball's line)
    - that man's marker closes him down to arrive with the ball
    - markers shade into the lane (`defending.lane`, by difficulty).
  - The intended receiver's own side still knows who the pass is for (RECEIVE).
- **Tests:** passing tests 7, 8 and 9.
- **Result:**
  - A defender 5.5 m off the lane never cuts it out.
  - Cut-out chance falls with distance from the lane: 63% at 1.4 m, 13% at 2.8 m, 0% at 5.5 m.
  - Right on the line, a legend traps it cleanly 69% of the time against 25% for an amateur. A weak defender mostly just gets in its way.
  - A driven pass (20 m/s) beats a defender who cuts out every tapped one (12 m/s): 25% against 100%.

### 4. Ball contact on an interception

- **Before:** any player within 0.62 m of a ground ball controlled it below a pace limit, whoever he was and whichever way he faced.
- **Root cause:** the contact was a magnet radius.
- **Files:** `src/sim/match.js` (`interact`, `footReach`, `poke`, `firstTouch(extra)`).
- **Logic.** When cutting out the other side's pass:
  - **Foot reach depends on where the ball is.** 0.62 m in front, 0.55 m across, 0.42 m behind (`reach`).
  - **A ball he hasn't reacted to yet just hits him.** That's a deflection.
  - **Stretch is measured by how far the ball's line passes from his body,** not by the distance on the first frame of contact. If it passes beyond `stretch` it's a poke (it keeps `pokeKeep` of its pace) unless it's slow (`stretchCtl`).
  - **A controlled interception is still a first touch,** with a quality penalty that grows with the stretch.
  - **A cutter cushions the ball he wins.**
- **Result (test 10):**
  - A pass played straight at a defender who has read it is controlled with a real first touch (quality 0.26–0.58). Some get away from him.
  - Before this fix, every contact counted as a "stretch" and was poked away.

### 5. After winning the ball: control → scan → decide

- **Before:**
  - The AI winner's first pass or shot came within 0.3 s in 37–62% of turnovers.
  - Its only settle was 0.12–0.28 s.
- **Root cause:** there was no transition state after a turnover.
- **Files:** `src/sim/match.js` (`gainPossession`, `firstTouch`), `src/sim/ai/director.js` (`settleTime`, `attackThink`).
- **Logic:**
  - A turnover gives `wonFor` = control time (`possession.control`, longer after a poor first touch) plus scan time (`possession.scan`).
  - During CONTROL, the winner can only keep the ball: shield it or carry it away from the nearest opponent (PROTECT). Under hard pressure he can also play a safe pass (risk below `safeRisk`).
  - During SCAN, a safe pass is also allowed.
  - No shots and no through balls during the window.
  - The debug labels read CONTROL / SCAN.
- **Result:**
  - The median first action after winning the ball went from 0.42 s to 0.59 s in 5v5, and from 0.38 s to 0.58 s in 7v7.
  - Quick actions are only safe passes.
  - Test 10: 7 of 7 showed CONTROL → SCAN, and none played the ball inside the window.

### 6. Human receive assist

- **Before:** with the stick neutral, the receiver stood still.
- **Why it matters now:** passes now carry real error, so a passive receiver let fair passes roll by.
- **Logic:** like FIFA's receiving, the man the pass is for, with the stick neutral, moves to meet it (`passing.receiveAssist`). His touch stays a neutral one, or a cushion if Street Ball Control is held. Any stick input is his own.

### 7. Chest control bug (found while measuring)

- **Before:** `cushion()` set `noTouch` to 0.05 s and vy to −0.4. The ball was re-cushioned every 0.05 s and floated down over about 1.7 s, with around 20 "chest" events per throw-in.
- **Fix:** the chest knocks the ball down (vy −1) and lets it drop for 0.28 s before the next touch. That's two touches, then a ground control.
- **Effect:** 11v11 chest events per match went from 173 (66 before this work) to 16.

### 8. Debug overlay (Tab, or AI DEBUG in pause)

- **3D drawing:**
  - the ball's actual path (white) and the defending side's read of it (orange)
  - the passing lane (cyan) and the stick's direction (yellow)
  - the receiver's prediction point (cyan ring)
  - the best interception point and the defender's run (red; grey if he can't make it)
  - the live offside line (yellow) and the line frozen at the pass (red), with red rings under the flagged men
- **Telemetry text:**
  - pass: passer, target, type, mode, power, quality and grade, angle and pace error, pace, assist correction, OFFSIDE
  - cut-out: defender, his position, interception point, his ETA vs the ball's, can / cannot, reacted, ball vs read position at +0.5 s
  - offside: the line and second-last defender, the frozen snapshot, the last call

## Tests

Run `npm test`. Every suite passes, including the new `offside` (12 checks) and `passing` (12 checks).

- **Changed test:** `tests/scale.test.mjs` now runs its open-format AI-v-AI smoke matches for 3 minutes instead of 2, with the same thresholds. With fair interceptions, offside and the turnover beat, a big pitch sees fewer stoppages and chances per minute. 11v11 over 5 minutes produces 1–6 restarts and 5–8 shots.
- **Diagnostics:**
  - `tests/diag-passing.mjs`: human passing table
  - `tests/diag-flow.mjs`: AI-v-AI flow, `--offside=off`
  - `tests/diag-choices.mjs`: carrier decisions
  - `tests/diag-shots2.mjs`: shot outcomes
  - `tests/diag-cost.mjs`: sim CPU cost
- **Browser:** `tools/play/gameplay.mjs`. Frame-stepped: the offside flow with the overlay, a pass near a defender, and the setup menu.

## The referee (`src/sim/rules/referee.js`)

Tuned in `footballGameplayConfig.referee`. Fouls are off in the 5v5 cage, which has no refs, and on in the open formats; the FOULS & CARDS setting overrides that. The keeper's protection and the kick-off rule apply everywhere.

### Keeper protection

- **Before:**
  - A slide that clipped a keeper holding the ball tripped him and knocked it out of his hands.
  - AI pressers crowded him.
- **Now:**
  - `canChallenge` refuses any tackle or slide on him (human or AI), and slides can't clip him.
  - Opponents in his area switch to RETREAT, out of it by `gkClear`; nobody presses him.
  - After `gkHoldMax` (6 s) holding it, he concedes an indirect free kick, taken from the edge of the goal area.

### Fouls from the geometry of the challenge

- **Standing tackle.** The foot sweeps `footReach` along the tackler's facing. A ray-vs-circle test gives the first contact with the ball (`ballHit`) and with the man (`bodyHit`).
- **Slide.** The first thing the slide meets is recorded on the action.
- **The call.** The man first is a foul. So is a challenge from directly behind that makes contact: the carrier's forward vector · the unit vector from the tackler to him > `behindDot`.
- **Severity.** (speed − 3)/5, plus `sevBehind`, `sevSlide`, and `sevDogso` for denying an obvious goal-scoring chance. Above `yellow` it's a yellow; above `red` it's a red.
  - A DOGSO is a red, except in the area after a genuine attempt at the ball, where it's a yellow (the penalty punishes it).
  - Two yellows make a red, and a red sends him off (at most two per side).
- **The restart.** A direct free kick where it happened, or a PENALTY if it was in the fouling side's area.
- **The AI** only commits when the ball is the first thing in its foot's path and the carrier isn't facing away. Sometimes it's reckless anyway (`aiReckless`, more often at lower levels).

### Set pieces

- **Direct free kick in range.** A wall of 2, 3 or 4 by team size, on the ball–goal line at the laws' distance (the centre-circle radius), shifted toward the near post and held exactly, with no personal-space steering. The AI taker usually shoots over it, often with curl.
- **Penalty.** The ball goes on the spot. Everyone but the taker and the keeper stands outside the area and the arc; the keeper stays on his line. The AI shoots for a corner; a human aims with the stick and presses SHOOT. Play goes on after it, so rebounds count.
- **Kick-off.** After the whistle, and until the taker has played the ball, everyone is held in his own half and the other side stays out of the centre circle.

### Results

- **AI v AI** (`tests/diag-referee.mjs`, PRO, 5 minutes):
  - 11v11 has 0.5–0.9 fouls a match (the real game is about 1.2 per 5 minutes), cards are rare, and no stoppage lasts more than 2.7 s.
  - 7v7 has about 3 fouls, with occasional penalties and free-kick shots.
- **Browser:** a human slide through the back of a carrier gave a yellow card and a free kick. A foul at the edge of the area set a 4-man wall at 9.15 m, and the penalty set-up and kick worked (it was parried).
- **Tests:** `tests/referee.test.mjs`, 12 checks.
