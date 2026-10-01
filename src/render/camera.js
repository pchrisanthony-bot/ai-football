// Cameras. Broadcast (FTS-style side cam: high on the touchline, tracks the ball
// with lag and zooms with the play), plus intro flyover, replay and orbit modes.
import * as THREE from 'three';
import { PITCH } from '../sim/pitch.js';
import { clamp } from '../util/math.js';

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'broadcast';
    this.focus = new THREE.Vector3(0, 0, 0);
    this.fVel = new THREE.Vector3();
    this.dist = 24;
    this.shakeT = 0; this.shakeAmp = 0;
    this.t = 0;
    this.lookAt = new THREE.Vector3();
    this.zoomBias = 0;
  }

  shake(amp = 0.3, dur = 0.4) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, dur); }

  // Critically-damped follow of a target point.
  follow(target, omega, dt) {
    const f = this.focus, v = this.fVel;
    for (const ax of ['x', 'y', 'z']) {
      const x = f[ax], vv = v[ax], tg = target[ax];
      const ff = 1 + 2 * dt * omega, oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo, di = 1 / (ff + hhoo);
      f[ax] = (ff * x + dt * vv + hhoo * tg) * di;
      v[ax] = (vv + hoo * (tg - x)) * di;
    }
  }

  // Where the broadcast camera looks for play around (x, z).
  framing(x, z) { return { x: clamp(x, -PITCH.halfL + 6, PITCH.halfL - 6), y: 0, z: clamp(z * 0.55, -3, 2.5) }; }

  // A broadcast cut (a set piece being placed): straight to the new framing.
  cut(x, z) { const f = this.framing(x, z); this.focus.set(f.x, f.y, f.z); this.fVel.set(0, 0, 0); }

  // ball + controlled player → framing
  broadcast(dt, ball, human, spread) {
    const lead = 0.35;
    let tx = ball.x + ball.vx * lead, tz = ball.z + ball.vz * lead * 0.5;
    if (human) { tx = tx * 0.75 + human.x * 0.25; tz = tz * 0.75 + human.z * 0.25; }
    this.follow(this.framing(tx, tz), 3.2, dt);
    // Zoom: tighter near the goals and when play is compact.
    const nearGoal = clamp((Math.abs(this.focus.x) - 8) / 6, 0, 1);
    // Narrow screens need to sit further back to keep the full width in frame.
    const aspectK = Math.max(1, Math.pow(1.7 / this.cam.aspect, 0.85));
    const want = clamp(20 + spread * 0.12 - nearGoal * 2.5 + this.zoomBias, 16, 25) * aspectK;
    this.dist += (want - this.dist) * (1 - Math.exp(-1.5 * dt));
    // High on the near touchline, looking slightly past the centre so both
    // touchlines stay in frame (FTS / broadcast Cam 1).
    this.cam.position.set(this.focus.x * 0.9, this.dist * 0.52 + 1.6, this.focus.z * 0.3 + this.dist * 0.9 + 1);
    this.lookAt.set(this.focus.x, 0.3, this.focus.z * 0.4 + 1.2);
    this.cam.fov = 34;
  }

  intro(dt, u) {
    // Sweep from the skyline down onto the court.
    const a = -2.2 + u * 2.2;
    const r = 42 - u * 18, h = 22 - u * 9;
    this.cam.position.set(Math.sin(a) * r, h, Math.cos(a) * r);
    this.lookAt.set(0, 0.5 + (1 - u) * 3, 0);
    this.cam.fov = 38;
  }

  orbit(dt, center, t, r = 8, h = 2.4) {
    this.cam.position.set(center.x + Math.cos(t * 0.35) * r, h, center.z + Math.sin(t * 0.35) * r);
    this.lookAt.set(center.x, 1.0, center.z);
    this.cam.fov = 40;
  }

  // Replay cams: low tight follow on the ball, and a behind-the-goal angle.
  replay(dt, ball, kind, goalX) {
    if (kind === 0) {
      this.follow({ x: ball.x, y: ball.y, z: ball.z }, 5, dt);
      this.cam.position.set(this.focus.x - Math.sign(goalX) * 4.5, 1.6 + this.focus.y * 0.4, this.focus.z + 5.5);
      this.lookAt.set(this.focus.x, this.focus.y * 0.6 + 0.5, this.focus.z);
      this.cam.fov = 42;
    } else {
      this.follow({ x: ball.x, y: ball.y, z: ball.z }, 6, dt);
      this.cam.position.set(goalX + Math.sign(goalX) * 5.5, 2.8, Math.sin(this.t * 0.2) * 2.5);
      this.lookAt.set(this.focus.x, 0.8, this.focus.z);
      this.cam.fov = 36;
    }
  }

  apply(dt) {
    this.t += dt;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT) * 2.5;
      this.cam.position.x += (Math.random() - 0.5) * a;
      this.cam.position.y += (Math.random() - 0.5) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    this.cam.lookAt(this.lookAt);
    this.cam.updateProjectionMatrix();
  }
}
