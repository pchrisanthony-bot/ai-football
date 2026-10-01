// =====================================================================
// Foot-planted procedural gait (render side). Each foot is either PLANTED — locked to a
// point on the pitch, so it can never slide — or SWINGING: an arc from where it lifted
// to where it will land, re-aimed every frame at where the body will be by then.
//  • Moving: a cadence-driven phase (steps/s and stance share by speed, with a flight
//    phase when running) decides when each foot lifts and lands; it lands a third of the
//    stance travel ahead of the hip (no overstriding) and pushes off well behind it,
//    heel up.
//  • Slowing to a stand: swings finish, and small settle steps keep the feet under him —
//    turning on the spot or being nudged is footwork, not a slide.
// The athlete solves two-bone IK to these world-space ankle targets.
// =====================================================================
import { clamp, lerp, smooth } from '../util/math.js';

export const ANKLE = 0.068;         // ankle height above the sole (local units)
const BALL = 0.13;                  // ankle → ball of the foot (local units)
const MOVE_ON = 0.7, MOVE_OFF = 0.45;   // m/s: rhythmic gait on / off (hysteresis)
const TOUCHDOWN = 0.35;             // share of the stance travel the foot lands ahead of the hip

// Steps per second, and the share of a cycle each foot is planted, by speed (m/s).
export const cadence = v => 1.75 + 1.85 * Math.pow(clamp(v / 7.4, 0, 1), 0.8);
export const duty = v => lerp(0.6, 0.25, smooth(clamp((v - 1) / 6, 0, 1)));
const swingHeight = v => lerp(0.07, 0.4, Math.pow(clamp(v / 7.4, 0, 1), 1.3));
const maxHeel = v => lerp(0.15, 0.55, clamp(v / 7.4, 0, 1));

const fwd = yaw => ({ x: Math.sin(yaw), z: Math.cos(yaw) });   // three.js yaw → ground direction
const left = yaw => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

export class Gait {
  constructor() {
    this.phase = 0;                 // cycle phase (0..1); the left foot lands at 0, the right at 0.5
    this.moving = false;
    this.feet = { L: null, R: null };
    this.vx = 0; this.vz = 0;       // smoothed ground velocity of the body
    this.last = null;
    this.stance = 0;                // 0..1: how loaded the stance is (drives the hip bob)
  }

  // Plant both feet under the body (spawn, teleports, replays).
  reset(x, z, yaw, s, width) {
    for (const [f, sx] of [['L', 1], ['R', -1]]) {
      const l = left(yaw);
      this.feet[f] = { state: 'plant', x: x + l.x * sx * width * s, z: z + l.z * sx * width * s, yaw, heel: 0, s: 0 };
    }
    this.moving = false; this.vx = this.vz = 0; this.last = { x, z };
  }

  // The leg can't reach this trailing planted foot any more: past mid-stance it pushes
  // off on the next frame (rather than being dragged).
  overreach(f) { if (this.moving) this.feet[f].early = true; }

  // Re-plant one foot where the animation currently has it (handing back from an action).
  adopt(f, x, z, yaw) { this.feet[f] = { state: 'plant', x, z, yaw, heel: 0, s: 0 }; }

  // Advance one frame. b: { x, z, yaw (pelvis, three.js), s (build), width, dt }.
  // Returns per foot { x, y, z, pitch } ankle targets (world) and the swing/stance info.
  update(b) {
    const { x, z, yaw, s, width, dt } = b;
    if (!this.last || Math.hypot(x - this.last.x, z - this.last.z) > 1.5) this.reset(x, z, yaw, s, width);
    // The body's actual ground velocity (it includes shoves), lightly smoothed.
    const k = 1 - Math.exp(-dt * 18);
    this.vx += ((x - this.last.x) / dt - this.vx) * k;
    this.vz += ((z - this.last.z) / dt - this.vz) * k;
    this.last.x = x; this.last.z = z;
    const v = Math.hypot(this.vx, this.vz);
    const l = left(yaw);
    const rest = sx => ({ x: x + l.x * sx * width * s, z: z + l.z * sx * width * s });

    if (!this.moving && v > MOVE_ON) this.startMoving(x, z);
    else if (this.moving && v < MOVE_OFF) this.moving = false;

    const F = this.feet, out = {};
    if (this.moving) {
      // Moving sideways to the hips (a jockey's shuffle) takes quicker, shorter steps.
      const side = v > 0.1 ? Math.abs(this.vx * Math.cos(yaw) - this.vz * Math.sin(yaw)) / v : 0;
      const cad = cadence(v) * (1 + 0.6 * side), cyc = 2 / cad, D = duty(v);
      this.phase = (this.phase + dt / cyc) % 1;
      let stance = 0;
      for (const [f, sx, off] of [['L', 1, 0], ['R', -1, 0.5]]) {
        const ft = F[f], u = (this.phase + off) % 1;
        if (ft.state === 'plant' && ((u >= D && u < 0.98) || (ft.early && u > 0.5 * D))) {
          ft.early = false;
          const a = this.ankle(ft, s);
          ft.state = 'swing'; ft.rx = a.x - x; ft.rz = a.z - z; ft.fh = a.y - ANKLE * s; ft.fp = ft.heel; ft.D = Math.min(D, u); ft.dur = 0; ft.s = 0;   // (an early push-off swings from where it is)
        }
        if (ft.state === 'swing') {
          if (ft.dur) {                          // a settle step still finishing: time-based
            ft.s = Math.min(1, ft.s + dt / ft.dur);
          } else {
            // phase-based: from lift-off (u = D) round to touchdown (u = 1 ≡ 0)
            const uu = u < ft.D ? u + 1 : u;
            ft.s = clamp((uu - ft.D) / (1 - ft.D), ft.s, 1);
          }
          // The swing is plotted relative to the body (so it never falls out of reach): from
          // where it pushed off, behind the hip, to its landing spot a third of the stance
          // travel ahead of the hip.
          const r = rest(sx), lead = D * cyc * TOUCHDOWN;
          const ex = r.x - x + this.vx * lead, ez = r.z - z + this.vz * lead;
          const e = smooth(ft.s);
          ft.x = x + lerp(ft.rx, ex, e); ft.z = z + lerp(ft.rz, ez, e); ft.yaw = yaw;
          const tx = x + ex, tz = z + ez;
          // an early peak (the heel kicks up behind) that still leaves the ground smoothly,
          // starting from the lift-off height
          ft.h = (ft.fh || 0) * (1 - e) + swingHeight(v) * s * Math.sin(Math.PI * (ft.s + 0.35 * ft.s * (1 - ft.s)));
          ft.pitch = (ft.fp || 0) * (1 - e) - 0.12 * Math.sin(Math.PI * e);     // toe-off → toe up → flat on landing
          if (ft.s >= 1) { ft.state = 'plant'; ft.heel = 0; ft.h = 0; ft.x = tx; ft.z = tz; }
        } else {
          // planted: the heel comes up late in stance (the foot pivots on its ball)
          const su = u < D ? u / D : 1;
          ft.heel = maxHeel(v) * smooth(clamp((su - 0.55) / 0.45, 0, 1));
          stance = Math.max(stance, Math.sin(Math.PI * clamp(su, 0, 1)));
        }
      }
      this.stance = stance;
    } else {
      // Standing / creeping: finish any swing, then step a foot back under the hip when
      // the body has moved or turned away from it.
      let swinging = false;
      for (const [f, sx] of [['L', 1], ['R', -1]]) {
        const ft = F[f];
        if (ft.state !== 'swing') continue;
        swinging = true;
        if (!ft.dur) { ft.dur = 0.18; ft.fx = ft.x; ft.fz = ft.z; ft.fh = ft.h || 0; ft.fp = ft.pitch || 0; ft.s = 0; }
        ft.s = Math.min(1, ft.s + dt / ft.dur);
        const r = rest(sx), e = smooth(ft.s);
        ft.x = lerp(ft.fx, r.x, e); ft.z = lerp(ft.fz, r.z, e); ft.yaw = yaw;
        ft.h = (ft.fh || 0) * (1 - e) + 0.05 * s * Math.sin(Math.PI * ft.s); ft.pitch = (ft.fp || 0) * (1 - e);
        if (ft.s >= 1) { ft.state = 'plant'; ft.h = 0; ft.heel = 0; }
      }
      if (!swinging) {
        let worst = null, we = 0;
        for (const [f, sx] of [['L', 1], ['R', -1]]) {
          const ft = F[f], r = rest(sx);
          const err = Math.hypot(ft.x - r.x, ft.z - r.z) / s + Math.abs(wrapYaw(ft.yaw - yaw)) * 0.25;
          ft.heel *= Math.exp(-dt * 12);         // settle flat
          if (err > we) { we = err; worst = f; }
        }
        if (worst && we > 0.2) { const ft = F[worst], a = this.ankle(ft, s); ft.state = 'swing'; ft.dur = 0.2; ft.fx = a.x; ft.fz = a.z; ft.fh = a.y - ANKLE * s; ft.fp = ft.heel; ft.s = 0; }
      }
      this.stance = 1;
    }

    for (const f of ['L', 'R']) {
      const ft = F[f];
      out[f] = ft.state === 'plant' ? { ...this.ankle(ft, s), pitch: ft.heel || 0, planted: true }
        : { x: ft.x, y: ANKLE * s + (ft.h || 0), z: ft.z, pitch: ft.pitch || 0, planted: false };
    }
    return out;
  }

  // A planted foot's ankle: above the planted point when flat; with the heel up the foot
  // pivots on its ball, so the ankle rises and comes forward.
  ankle(ft, s) {
    const h = ft.heel || 0, d = fwd(ft.yaw);
    const along = (BALL - BALL * Math.cos(h) + ANKLE * Math.sin(h)) * s, up = (ANKLE * Math.cos(h) + BALL * Math.sin(h)) * s;
    return { x: ft.x + d.x * along, y: up, z: ft.z + d.z * along };
  }

  // From a stand into a stride: the foot further back (against the travel) lifts first.
  startMoving(x, z) {
    this.moving = true;
    const v = Math.hypot(this.vx, this.vz) || 1, ux = this.vx / v, uz = this.vz / v;
    const proj = f => (this.feet[f].x - x) * ux + (this.feet[f].z - z) * uz;
    const D = duty(v);
    // left lifts at u = D; the right is then at D + 0.5 (planted while D ≥ 0.5, as when starting)
    this.phase = proj('L') <= proj('R') ? D : (D + 0.5) % 1;
    for (const f of ['L', 'R']) {
      const ft = this.feet[f];
      if (ft.state === 'swing') { ft.dur = ft.dur || 0.18; ft.rx = ft.x - x; ft.rz = ft.z - z; ft.fh = ft.h || 0; ft.fp = ft.pitch || 0; }
    }
  }
}

function wrapYaw(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
