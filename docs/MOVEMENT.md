# Football movement: reception, support and awareness

This doc covers the 5v5 gameplay and movement overhaul: ball reception, first touch,
support triangles, body shape and ball tracking. All tuning lives in
`footballMovementConfig` in `src/config.js`.

## Root causes found

| Symptom | Root cause | Fix |
|---|---|---|
| "My team-mate ran straight past my pass" | Control moves to the receiver as the pass is struck, and the stick the person was still holding to aim the pass drove the receiver away from the ball. Any stick input also turned the receive assist off entirely. Measured: 100% of passes lost when the stick is held. | The stick held at the switch is ignored as the receiver's run until it's let go or turned. While the pass is live the run is assisted, and the stick sets the first-touch direction. |
| AI receivers took the ball at full speed | RECEIVE sprinted to the earliest reachable point on the ball's path. | The receiving point is chosen by cost, and the run is timed to be set there as the ball arrives. |
| A receiver with a defender on his back drifted away and lost it | The opponent-risk term compared the defender with the *ball*, not with the receiver, so every point scored maximum risk. | Risk is a race to the point: whoever gets there and is set first. He now comes short, in front of his man. |
| Long passes "stopped being his" | `ball.passTo` expired after a fixed 2.2 s. | The reception plan owns the pass's lifetime while he can still reach it. |
| The touch happened with the ball still 0.6 m from the boot | Control triggered on a 0.62 m radius around the body. | A planned reception takes the ball at the receiving foot. It still never lets a ball slip by, and doesn't wait with an opponent at the ball. |
| Team-mates "standing around" | Support spots were a 12-point search around each player's formation spot, with no idea of angles, triangles or the carrier. | SupportPositioningSystem and PassingTriangleSystem (below). |
| Black, dead eyes | The eyes' cornea shell maps to a transparent spot in the texture, and was drawn opaque. | Alpha cut-out. |
| Test harness | A stale `human` flag left the team-mate frozen in every pass scene. | Flag cleared; pass scenes script the team-mate's run explicitly. |

## Systems

**PassReceptionSystem** (`src/sim/ai/reception.js`)
- States: SUPPORTING → ANTICIPATING (the pass is read) → RECEIVING (about 0.45 s out) → FIRST_TOUCH → IN_POSSESSION.
- Every point of the ball's path he can reach in time is scored on:
  - how long he'd wait for it;
  - how hard he'd run into its line;
  - how much he'd have to change his run (a runner takes it in his stride);
  - an opponent there and set first;
  - the ball's height and pace;
  - coming back on top of the passer.
- His run is paced to arrive just in time, braking into the spot. A ball travelling his way is run onto.
- He stands so the ball runs to his receiving foot, with his body opened toward his touch.
- Foot choice: the ball's side of him, or the back foot to take it across his body.
- Contact happens at that foot.

**FirstTouchSystem** (same file)
- Nobody near: a positive touch into the most open direction toward goal.
- A man close: a shorter touch, away from him.
- A man tight behind: kill it and shield.
- The person's stick does the same job: it sets the direction, and sprint makes the touch bigger.
- Directed touches turn the ball's pace onto the chosen line, in proportion to touch quality.

**SupportPositioningSystem + PassingTriangleSystem** (`src/sim/ai/support.js`)
- Roles: forward option, diagonal, safety, weak side. Each is re-dealt every team tick, and at once on a pass or a change of possession, with hysteresis.
- Spots are scored on:
  - an ETA-race pass lane (the contested last 1.2 m excluded);
  - space;
  - angle from the other options;
  - forward progress;
  - spacing;
  - goal danger;
  - the team's shape;
  - travel time;
  - staying out of the carrier's dribbling lane.
- Distances shrink when the carrier is pressed and stretch when he has space.
- Spots ride with the ball, and with the receiving point while a pass travels.
- Triangles are graded Excellent / Good / Neutral / Poor / Blocked.
- Third-man runs go beyond the receiver of a short pass. Supporters keep pace with the ball, and the carrier gets room.

**DefensiveResponse** (`director.js`)
- One man presses and the others mark, shading into the lane (unchanged).
- The spare man now covers the most dangerous open lane from the ball.

**FootballMovementSystem** (`players.js`, `director.js`)
- Off the ball, a player's chest turns toward the ball while he runs: fully at a jog, up to about 70° at pace.
- Running side-on is slower, and backpedalling slower still.
- Positional runs brake into the spot at a constant deceleration.

**LookIK** (`src/render/lookik.js`)
- Target priority: the pass target while winding up a pass, the goal before a shot, a man closing him down, the ball (with look-ahead), and short scans off the ball (his man, a team-mate, an opponent).
- The eyes jump first (±35° / ±20°). The head follows (±60° / ±35°), the neck takes half of the head's turn, and the upper spine takes 12%.
- The eyes turn in their sockets via a vertex shader, since the rig has no eye bones.

**Receive animation** (`athlete.js`)
- Timed to the contact the sim predicts: the receiving foot reaches the ball with the inside of the foot open, then cushions it.

## Debug view (AI debug overlay, Tab)

- **Triangles:** lines from the ball to each supporter's spot (green open, amber contested, red shut), plus the best triangle's third side. Role dots: forward cyan, diagonal violet, safety white, weak side grey.
- **Reception:** a blue ring where the ball will arrive, a green ring for his reach round where he'll stand, and a dot on the receiving foot.
- **Movement:** a line from each AI player to his target.
- **Look:** head → target (yellow ball, pink scan).
- **Text panel:**
  - the receiver's state, time to the ball, receiving point, foot, touch plan and risk;
  - each supporter's role and lane, the freedom value and the best triangle's grade.

## Tests

| Brief test | Where | Result |
|---|---|---|
| A direct pass | `tests/reception.test.mjs` | 100% received whatever the stick does; receiver set (about 1 m/s) |
| B moving receiver | same | 100%; touch with his run about 32° off it; through balls run onto (relative pace about 3 m/s) |
| C misaligned | same | 100%, none run past |
| D under pressure | same | 96% of touches go away from a side defender; with a man behind he keeps it 100% |
| E fast pass | same | 100%, set, no bounce-offs |
| J ball behind | same | 100%, he turns back to it |
| F triangle | `tests/support.test.mjs` | 93–100% of looks show a triangle; pass after holding: 8% → 50–84% |
| G carrier moves | same | the support shifts about a third of his move (the weak side keeps its width) |
| H defender into the lane | same | the supporter moves out of it within 1.6 s (7–8 of 9) |
| I eyes | `tests/look.test.mjs` | eyes lead the head, limits held, fastest head turn 475°/s |

AI v AI, 12 × 300 s (`tests/diag-flow.mjs`):

| | Before | After |
|---|---|---|
| Passes | 75 | 94 |
| Completion | 65% | 65% |
| Intercepted | 17% | 15% |
| Goals | 11.4 | 8–9 |

Goals per match went down. That's accepted: it's the cost of more passing and of defenders covering lanes, as with the offside change.

Visual checks:
- `tools/play/look.mjs`: eyes and head.
- `tools/play/receive-film.mjs`: the foot meets the ball.
- `tools/play/support-view.mjs`: the debug view in play.

## Remaining issues

- **Bunching.** Players within 2 m of a team-mate are about 0.8 pairs per sample, against 0.38 before. Mostly it's defenders doubling up near the ball, carried into the first moments after a turnover.
- **Cut-outs under pressure.** With the person standing still under pressure in midfield, the defending AI (man-marking, shaded into the lanes) still cuts out most passes. The triangles give angles, not guarantees.
- **No facial expressions.** The face rig has no expression shapes.
- **Moving receivers.** A receiver on the run takes the ball in his stride with the dribble-touch reach; only a set receiver gets the full reach-and-cushion pose.
