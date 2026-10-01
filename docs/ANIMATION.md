# Locomotion animation — against a reference

The reference is a realistic footballer jogging. It was sampled frame by frame with `tools/play/video-frames.mjs` and compared side-on with our player using `tools/play/anim-film.mjs`. The numbers come from `tools/play/anim-probe.mjs`, in `docs/metrics/anim-before-ref.json` and `docs/metrics/anim-after-ref.json`.

The game has no GLTF clips and no `AnimationMixer`. The players are a code-built skeleton animated procedurally: `src/render/athlete.js`, with the gait in `src/render/gait.js`. So the four standard requirements are met natively, as below.

## 1. No snapping between states (the cross-fade)

Every joint is driven by a critically damped spring toward its target pose. That gives an *inertialized* transition: velocity carries through and nothing pops, unlike a linear cross-fade.

A critically damped spring reaches 95% of a change in about 4.74 / ω:

| Situation | ω | 95% blend |
|---|---|---|
| Normal | 24 | 0.2 s (walk → run) |
| Braking (smoothed deceleration below −3 m/s²) | 12 | 0.4 s (run → stand; the body eases out of a run) |
| Actions | 34 | 0.14 s |

The gait's rhythm (arm swing, hip and shoulder twist, bob) is **not** sent through the springs. A spring following a running rhythm lags it: here the arms trailed the legs by 167 ms, a quarter of a stride. The rhythm is a layer added after the springs, in exact time with the feet. An action that poses one of those joints takes it over, eased.

## 2. No foot skating (the stride–velocity sync)

In a clip-based system you would set `timeScale = v_world / v_clip`, where `v_clip = clipStrideLength / clipCycleDuration` is the speed the clip was authored at.

Here the sync holds by construction:

- The gait phase advances at `cadence(v) / 2` cycles a second, with `cadence(v) = 1.75 + 1.85·(v / 7.4)^0.8` steps a second.
- So the step length is always `v / cadence(v)`: 1.6 m at a 5 m/s jog, 3.1 steps a second.
- A foot in stance (a share `duty(v)` of each cycle) is **planted at a point on the pitch** and the leg reaches it with two-bone IK. The foot is never animated across the ground, so it cannot slide.
- A swinging foot lands where the body will be, `TOUCHDOWN` × the stance travel ahead of the hip.

## 3. Weight: leaning into acceleration, sitting back when braking

- `body.x` (pitch from the ankles) = 0.012 × the smoothed forward acceleration, clamped to −0.15…+0.2 rad, plus a small lean with speed.
- The torso (`spine.x`) stays tall at a jog (about 10–12° in total), like the reference, and leans more at a sprint (about 14°).

## 4. Banking into turns

- `body.z` = 0.75 × atan(v·ω / g), where ω is the turn rate of the running direction, eased in and out and clamped to ±0.42 rad. That is the physical lean of a runner on a curve, tan θ = v² / (r·g) = v·ω / g, scaled down because players also turn their feet in.
- The body's facing turns through a damped spring capped at 630°/s.

## Running form, before → after (probe, jogging at 5 m/s)

| | Before | After | Reference |
|---|---|---|---|
| Heel lift behind in the swing | 0.32 m | 0.57 m | about knee height |
| Knee fold in the swing | low, a dragging leg | 122° | about 110–125° |
| Hip height (standing 0.942) | 0.853 | 0.877 | tall |
| Elbows | 75° | 93° | about 90° |
| Torso lean | 21° | 12.5° | slight |
| Arm swing behind the legs | 167 ms | 17 ms, contralateral | 0 |
| Foot skate, sprint / 90° cut | 1.28 / 1.12 m/s | 0.75 / 0.58 m/s | — |
| Bank in a sprint cut | 18° | 22° | — |

What changed in the gait:

- **Heel recovery.** The swing foot rises behind first (about knee height at a jog, higher at a sprint), then comes through under the hip by mid-swing (the knee drive), then reaches for the landing.
- **Push-off.** The heel lifts higher (the ankle pivots over the ball of the foot), so the trailing leg reaches without the hips sinking.
- **Swing ankle.** In the air the foot hangs off the shin with the toes pointed, then levels for the landing.
