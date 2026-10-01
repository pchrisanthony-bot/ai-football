// Cameras. Broadcast (FTS-style side cam: high on the touchline, tracks the ball
// with lag and zooms with the play), plus intro flyover, replay and orbit modes.
import * as THREE from 'three';
import { PITCH } from '../sim/pitch.js';
import { FORMATS } from '../sim/formats.js';
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
    this.cfg = FORMATS['5v5'].camera;   // framing for the current format (setFraming)
  }

  setFraming(cfg) { this.cfg = cfg; }

  // How spread out the play is (the zoom follows it): the x-extent of the players in
  // the play — everyone in the cage; on a big pitch those near the ball, and the human.
  playSpread(m) {
    const roi = this.cfg.roi, b = m.ball;
    let minX = Infinity, maxX = -Infinity;
    for (const p of m.players) {
      if (!p.active || (p !== m.human && Math.hypot(p.x - b.x, p.z - b.z) > roi)) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    }
    return maxX > minX ? maxX - minX : 0;
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
  framing(x, z) {
    const C = this.cfg, hw = PITCH.halfW;
    return { x: clamp(x, -PITCH.halfL + C.edge, PITCH.halfL - C.edge), y: 0, z: clamp(z * C.zFollow, C.zRange[0] * hw, C.zRange[1] * hw) };
  }

  // A broadcast cut (a set piece being placed): straight to the new framing.
  cut(x, z) { const f = this.framing(x, z); this.focus.set(f.x, f.y, f.z); this.fVel.set(0, 0, 0); }

  // ball + controlled player → framing (parameters: the format's camera config)
  broadcast(dt, ball, human, spread) {
    const C = this.cfg;
    let tx = ball.x + ball.vx * C.lead, tz = ball.z + ball.vz * C.lead * 0.5;
    if (human) { tx = tx * (1 - C.humanBias) + human.x * C.humanBias; tz = tz * (1 - C.humanBias) + human.z * C.humanBias; }
    this.follow(this.framing(tx, tz), C.omega, dt);
    // Zoom: tighter near the goals and when play is compact.
    const nearGoal = clamp((Math.abs(this.focus.x) - (PITCH.halfL - C.goalBand[0])) / C.goalBand[1], 0, 1);
    // Narrow screens need to sit further back to keep the full width in frame.
    const aspectK = Math.max(1, Math.pow(1.7 / this.cam.aspect, 0.85));
    const want = clamp(C.base + spread * C.spreadK - nearGoal * C.goalZoom + this.zoomBias, C.dist[0], C.dist[1]) * aspectK;
    this.dist += (want - this.dist) * (1 - Math.exp(-1.5 * dt));
    // High beyond the near touch line (FTS / broadcast Cam 1), looking across the play.
    this.cam.position.set(this.focus.x * C.xFollow, this.dist * C.rise + C.lift, PITCH.halfW * C.gantry + this.focus.z * C.zCam + this.dist * C.back + C.backOff);
    this.lookAt.set(this.focus.x, 0.3, this.focus.z * C.lookZ + C.lookOff);
    this.cam.fov = C.fov;
  }

  intro(dt, u) {
    // Sweep from the skyline down onto the pitch.
    const k = Math.min(2.6, Math.max(1, PITCH.length / 32));
    const a = -2.2 + u * 2.2;
    const r = (42 - u * 18) * k, h = (22 - u * 9) * k;
    this.cam.position.set(Math.sin(a) * r, h, Math.cos(a) * r);
    this.lookAt.set(0, 0.5 + (1 - u) * 3, 0);
    this.cam.fov = 38;
  }

  orbit(dt, center, t, r = 8, h = 2.4) {
    const k = Math.min(2.6, Math.max(1, PITCH.length / 32));
    this.cam.position.set(center.x + Math.cos(t * 0.35) * r * k, h * k, center.z + Math.sin(t * 0.35) * r * k);
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
