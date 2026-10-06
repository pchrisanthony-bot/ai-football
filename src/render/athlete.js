// =====================================================================
// Athletes: a realistic human body (humanmodel.js: MakeHuman, CC0) driven by a fully
// procedural animation system on an invisible code-built "driver" skeleton.
//  • Locomotion: foot-planted gait (gait.js) + two-bone leg IK — a planted foot is
//    locked to the pitch (no skating), a swinging foot lands where the body will be.
//  • Legs follow the velocity heading, torso follows the facing (jockey, shield).
//  • Actions (kicks, tackles, slides, dives, skills, celebrations) are keyed poses
//    timed to the sim's contact frames.
//  • Every joint is driven by a critically-damped spring toward its target, which
//    gives inertialized transitions instead of cross-fades.
//  • Two-bone IK puts the kicking foot on the ball at contact.
// =====================================================================
import * as THREE from 'three';
import { clamp, lerp, smooth, wrapAngle } from '../util/math.js';
import { PLAYER } from '../config.js';
import { Gait } from './gait.js';
import { HumanBody, humanModel } from './humanmodel.js';

const THIGH = 0.44, SHIN = 0.43;     // bone lengths (local units)
// Which leg an action poses itself (the other stays planted): 'kick' = the kicking leg,
// 'both' = the whole body is keyed (dives, slides…). Anything else: both legs on the gait.
const ACTION_LEGS = {
  pass: 'kick', through: 'kick', shot: 'kick', volley: 'kick', clear: 'kick', lob: 'kick', panna: 'kick',
  tackle: 'kick', dragback: 'kick', rainbow: 'kick', flickup: 'kick', stepover: 'step',
  slide: 'both', dive: 'both', header: 'both', stumble: 'both', getup: 'both', throw: 'both', roulette: 'both',
};
// A celebration runs on the gait, except the knee slide at the end of style 2.
const actionLegs = (a, style) => (a.type === 'celebrate' ? (style === 2 && a.t > 1.5 ? 'both' : null) : ACTION_LEGS[a.type]);
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _hc = new THREE.Vector3();
const LEGS = ['L', 'R'];

const TAU = Math.PI * 2;
// Joint channels: [joint, axis]. Order defines the replay pose layout.
export const CHANNELS = [
  ['body', 'x'], ['body', 'z'], ['hips', 'py'], ['hips', 'y'], ['hips', 'x'],
  ['spine', 'x'], ['spine', 'y'], ['spine', 'z'], ['head', 'x'], ['head', 'y'],
  ['armL', 'x'], ['armL', 'z'], ['armL', 'y'], ['foreL', 'x'], ['armR', 'x'], ['armR', 'z'], ['armR', 'y'], ['foreR', 'x'],
  ['thighL', 'x'], ['thighL', 'y'], ['thighL', 'z'], ['shinL', 'x'], ['footL', 'x'],
  ['thighR', 'x'], ['thighR', 'y'], ['thighR', 'z'], ['shinR', 'x'], ['footR', 'x'],
];
const CH_INDEX = Object.fromEntries(CHANNELS.map((c, i) => [c.join('.'), i]));
// Per-leg channel indices for the IK (looked up once, not per frame).
const LEG = Object.fromEntries(['L', 'R'].map(f => [f, {
  thighX: CH_INDEX[`thigh${f}.x`], thighY: CH_INDEX[`thigh${f}.y`], thighZ: CH_INDEX[`thigh${f}.z`],
  shin: CH_INDEX[`shin${f}.x`], foot: CH_INDEX[`foot${f}.x`], sx: f === 'L' ? 1 : -1,
}]));
const HIPS_Y = CH_INDEX['hips.y'], HIPS_PY = CH_INDEX['hips.py'], BODY_X = CH_INDEX['body.x'];
// The gait's rhythm — arm swing, hip and shoulder twist, the bob — is a layer added on top
// of the sprung pose, in exact time with the feet (through the springs it trailed the legs
// by a quarter of a stride). An action that poses one of these joints takes it over.
const CYC = ['armL.x', 'armR.x', 'hips.y', 'spine.y', 'hips.py'].map(n => CH_INDEX[n]);
const ARM_L = CH_INDEX['armL.x'], ARM_R = CH_INDEX['armR.x'];

// ------------------------------------------------------------------ Athlete
export class Athlete {
  constructor(p, kit) {
    this.p = p;
    const gk = p.line === 'GK';
    // The body: a realistic human in the team's kit (see humanmodel.js).
    this.body = new HumanBody(p, {
      shirt: gk ? kit.gk : kit.shirt, shorts: gk ? '#1b1b1f' : kit.shorts, socks: gk ? '#1b1b1f' : kit.socks,
      trim: kit.trim, number: gk ? '#111111' : kit.trim,
    });
    // The driver skeleton (bones only, never drawn): the gait, the leg IK and the actions
    // pose it; the body copies its rotations. Its legs are scaled to be exactly the
    // body's, so a foot the IK plants is planted on the body too.
    const R = humanModel().rest, hs = this.body.scale;
    this.s = (R.thigh + R.shin) * hs / (THIGH + SHIN);
    const J = this.J = {};
    const bone = (name, parent, x = 0, y = 0, z = 0) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); J[name] = b; return b; };
    this.root = new THREE.Group();
    this.driver = new THREE.Group();
    this.driver.scale.setScalar(this.s);
    this.root.add(this.driver);
    this.root.add(this.body.group);
    bone('body', this.driver);
    bone('hips', J.body, 0, 0.95, 0);
    bone('spine', J.hips, 0, 0.08, 0);
    bone('neck', J.spine, 0, 0.47, 0);
    bone('head', J.neck, 0, 0.07, 0.01);
    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const arm = bone('arm' + side, J.spine, sx * 0.205, 0.405, -0.01);
      bone('fore' + side, arm, 0, -0.3, 0);
      const thigh = bone('thigh' + side, J.hips, sx * 0.095, -0.02, 0);
      const shin = bone('shin' + side, thigh, 0, -THIGH, 0);
      bone('foot' + side, shin, 0, -SHIN, 0);
    }
    for (const k of ['armL', 'armR', 'thighL', 'thighR']) J[k].rotation.order = 'ZXY';
    this.root.updateMatrixWorld(true);

    // State
    this.phase = Math.random();
    this.cur = new Float32Array(CHANNELS.length);
    this.vel = new Float32Array(CHANNELS.length);
    this.tgt = new Float32Array(CHANNELS.length);
    this.out = new Float32Array(CHANNELS.length);   // the pose shown: springs + rhythm + leg IK
    this.cyc = new Float32Array(CHANNELS.length);   // the gait's rhythm layer (see CYC)
    this.cycW = new Float32Array(CHANNELS.length).fill(1);
    this.base = new Float32Array(CHANNELS.length);  // the locomotion pose, before any action
    this.accS = 0;                                   // smoothed forward acceleration (m/s²)
    this.relax = { L: 0, R: 0 };                     // how far each foot hangs off the shin (in the air)
    this.gait = new Gait({ ankle: R.ankle * hs / this.s, ball: R.ball * hs / this.s });
    this.ikW = { L: 1, R: 1 };
    this.hipDrop = 0;                                // m (local) the hips sink so a planted leg reaches
    this.yaw = { x: Math.PI / 2 - p.facing, v: 0 };
    this.lastHeading = p.heading;
    this.lastSpeed = 0;
    this.lean = 0; this.pitch = 0;
    this.touchT = 1;
    this.touchLeg = 1;
    this.kickFoot = 1;
    this.lastActionRef = null;
    this.celebrateStyle = 0;
    this.t = 0;
    this.lookYaw = 0;
  }

  set(j, axis, v) { this.tgt[CH_INDEX[j + '.' + axis]] = v; }
  cy(j, axis, v) { this.cyc[CH_INDEX[j + '.' + axis]] = v; }
  add(j, axis, v) { this.tgt[CH_INDEX[j + '.' + axis]] += v; }
  get(j, axis) { return this.tgt[CH_INDEX[j + '.' + axis]]; }

  // Called when the sim emits a dribble touch for this player.
  touch(power) { this.touchT = 0; this.touchLeg = -this.touchLeg; this.touchPow = power; this.touchFoot = null; }

  update(dt, match, ball) {
    const p = this.p;
    this.t += dt;
    const a = p.action;
    if (a !== this.lastActionRef) {
      this.lastActionRef = a;
      if (a) this.onActionStart(a, ball);
    }

    // ---- root transform (position from the sim; yaw spring-smoothed)
    this.root.position.set(p.x, 0, p.z);
    const targetYaw = Math.PI / 2 - p.facing;
    const dy = wrapAngle(targetYaw - this.yaw.x);
    if (a && a.type === 'roulette') { this.yaw.x += dy * (1 - Math.exp(-60 * dt)); this.yaw.v = 0; }
    else {
      // critically damped spring on the body's turn: it eases in and out instead of snapping
      // (capped at a human turn rate: ~630°/s)
      const w = 15, f = 1 + 2 * dt * w, di = 1 / (f + dt * dt * w * w);
      this.yaw.v = clamp((this.yaw.v + dt * w * w * dy) * di, -11, 11);
      this.yaw.x += this.yaw.v * dt;
    }
    this.yaw.x = wrapAngle(this.yaw.x);
    this.root.rotation.y = this.yaw.x;

    // ---- the upper body swings with the gait (the legs are planted by the gait + IK)
    const speed = p.speed;
    const rel = wrapAngle(p.heading - p.facing);      // travel direction relative to body
    const back = Math.abs(rel) > 2.0;
    this.phase = this.gait.phase;

    // turn lean & accel pitch
    const dh = wrapAngle(p.heading - this.lastHeading) / Math.max(dt, 1e-3);
    this.lastHeading = p.heading;
    const acc = (speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = speed;
    this.accS += (acc - this.accS) * (1 - Math.exp(-6 * dt));
    // Banking: a runner on a curve leans in from the feet, tan θ = v·ω / g (a share of it —
    // he also turns his feet in), eased in and out.
    const bank = Math.atan(speed * dh / 9.81) * 0.75;
    this.lean += (clamp(-bank, -0.42, 0.42) - this.lean) * (1 - Math.exp(-8 * dt));
    // Weight: he leans into a burst of acceleration and sits back against braking.
    this.pitch += (clamp(this.accS * 0.012, -0.15, 0.2) - this.pitch) * (1 - Math.exp(-6 * dt));

    this.tgt.fill(0); this.cyc.fill(0);
    this.locomotion(speed, rel, back, p, match, ball);
    this.base.set(this.tgt);
    if (this.touchT < 0.2) { this.touchT += dt; this.touchPose(); }
    if (a) this.actionPose(a, p, ball, match);
    else if (ball.owner === p && ball.inHands) this.holdPose();

    // ---- springs (inertialized blend toward the target pose). Slowing down, the body
    // eases out of the run more gently than it goes into one (inertia).
    const omega = a ? 34 : this.accS < -3 ? 12 : 24;     // settles (95%) in ~0.2 s, ~0.4 s when braking
    for (let i = 0; i < this.cur.length; i++) {
      const x = this.cur[i], v = this.vel[i], tg = this.tgt[i];
      const f = 1 + 2 * dt * omega, oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo, di = 1 / (f + hhoo);
      this.cur[i] = (f * x + dt * v + hhoo * tg) * di;
      this.vel[i] = (v + hoo * (tg - x)) * di;
    }
    this.out.set(this.cur);
    // the rhythm layer on top, in step with the feet (eased off joints an action has taken)
    const kc = 1 - Math.exp(-dt * 14);
    for (const i of CYC) {
      this.cycW[i] += ((this.tgt[i] !== this.base[i] ? 0 : 1) - this.cycW[i]) * kc;
      this.out[i] += this.cyc[i] * this.cycW[i];
    }
    this.plantLegs(dt, a, ball);
    this.syncBody();
  }

  // Copy the driver's pose onto the human body.
  syncBody() {
    const J = this.J;
    this.driver.updateMatrixWorld(true);
    // the centre of the hip joints, in root space (metres)
    const hc = _hc.set(0, -0.02, 0);
    J.hips.localToWorld(hc); this.root.worldToLocal(hc);
    const F = this.gait.feet;
    this.body.update(J, this.root, hc, { L: F.L ? F.L.heel || 0 : 0, R: F.R ? F.R.heel || 0 : 0 });
  }

  // ------------------------------------------------------------------ planted legs
  // The gait gives world-space ankle targets; two-bone IK bends each leg to reach them
  // from where the hip really is this frame. Actions that pose a leg take it over (the
  // other stays planted — a kick's support foot doesn't skate), and hand it back softly.
  plantLegs(dt, a, ball) {
    const p = this.p, s = this.s, out = this.out, J = this.J;
    const legs = a ? actionLegs(a, this.celebrateStyle) : null;
    const kickLeg = a && a.type === 'stepover' ? ((a.side || 1) > 0 ? 'R' : 'L') : (this.kickFoot > 0 ? 'R' : 'L');
    const k = 1 - Math.exp(-dt * 14);
    for (const f of ['L', 'R']) {
      const want = legs === 'both' || ((legs === 'kick' || legs === 'step') && f === kickLeg) ? 0 : 1;
      this.ikW[f] += (want - this.ikW[f]) * k;
    }
    // Pelvis yaw on the ground: the body's turn plus the hips' own turn toward travel.
    const pelvisYaw = this.yaw.x + out[HIPS_Y];
    const crouch = p.jockey || (p.line === 'GK' && p.speed < 2.5) ? 1 : 0;
    const T = this.gait.update({ x: p.x, z: p.z, yaw: pelvisYaw, s, width: 0.11 + 0.05 * crouch, dt });
    // A dribble touch: the foot in the air reaches out to the ball as it comes through
    // (decided once per touch). A planted foot is never pulled off the pitch, and a foot
    // that has only just pushed off behind him can't play a ball in front of him.
    if (this.touchT < 0.2 && !a && ball.owner === p && !ball.inHands) {
      const through = f => !T[f].planted && this.gait.feet[f].s > 0.4;
      if (this.touchFoot == null) this.touchFoot = through('L') ? 'L' : through('R') ? 'R' : '';
      const t = T[this.touchFoot];
      if (t && !t.planted) {
        const kk = Math.sin(Math.PI * this.touchT / 0.2) * 0.65;
        t.x += (ball.x - t.x) * kk; t.z += (ball.z - t.z) * kk; t.y += 0.05 * s * kk;
      }
    }
    // Hips: the gait's bob, then low enough that each planted leg can reach its foot —
    // measured from where the hip joints really are this frame (the running lean puts
    // them ahead of the feet). Down at once when a foot needs it, back up gently.
    const py = HIPS_PY, w = Math.min(this.ikW.L, this.ikW.R);
    this.apply(out);
    J.hips.updateWorldMatrix(true, false);         // root → body → hips only (the legs are about to be set)
    const reach = 0.97 * (THIGH + SHIN) * s;
    let need = 0;
    for (const [f, sx] of [['L', 1], ['R', -1]]) {
      const t = T[f];
      if (!t.planted || this.ikW[f] < 0.5) continue;
      J.hips.localToWorld(_v.set(sx * 0.095, -0.02, 0));
      const dh = Math.min(reach * 0.99, Math.hypot(t.x - _v.x, t.z - _v.z));
      need = Math.max(need, (_v.y - t.y - Math.sqrt(reach * reach - dh * dh)) / s);
    }
    need = Math.min(need, 0.15);                     // a stride's worth; further than that the foot steps instead
    this.hipDrop = need > this.hipDrop ? need : this.hipDrop + (need - this.hipDrop) * (1 - Math.exp(-dt * 8));
    out[py] -= this.hipDrop * w;
    J.hips.position.y = 0.95 + out[py];
    J.hips.updateWorldMatrix(false, false);

    const inv = _m.copy(J.hips.matrixWorld).invert();
    for (const f of LEGS) {
      const wf = this.ikW[f], L = LEG[f], sx = L.sx;
      if (wf < 0.02) {
        // posed by the action: keep the gait's foot where the animation has it, so the hand-back is seamless
        J['foot' + f].getWorldPosition(_v);
        this.gait.adopt(f, _v.x, _v.z, pelvisYaw);
        continue;
      }
      const t = T[f];
      _v.set(t.x, t.y, t.z).applyMatrix4(inv);               // ankle target in hip space
      let dx = _v.x - sx * 0.095, dy = _v.y + 0.02, dz = _v.z;
      // Never ask for more than the leg has: a far target keeps a soft knee, not a locked
      // one. A planted foot about to overreach pushes off now instead (it never slides).
      const far = Math.hypot(dx, dy, dz), most = 0.97 * (THIGH + SHIN);
      if (far > most) {
        if (t.planted && dz < 0) this.gait.overreach(f);      // (trailing behind the hip only)
        const kf = most / far; dx *= kf; dy *= kf; dz *= kf;
      }
      const thZ = clamp(Math.atan2(dx, -dy), -0.95, 0.95);     // abduction: tilt the leg's plane to the target
      const r = Math.hypot(dx, dy);
      const D = clamp(Math.hypot(r, dz), 0.25, THIGH + SHIN - 1e-4);
      const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - D * D) / (2 * THIGH * SHIN), -1, 1));
      const alpha = Math.acos(clamp((THIGH * THIGH + D * D - SHIN * SHIN) / (2 * THIGH * D), -1, 1));
      const thX = Math.atan2(-dz, r) - alpha;
      // the foot: flat on the pitch (heel up late in stance, toe up for the landing); in
      // the air it hangs off the shin, toes pointed after the push-off, until it reaches
      // for the landing
      let footX = t.pitch - (out[BODY_X] + thX + knee);
      const rw = t.planted ? 0 : 0.85 * Math.sin(Math.PI * clamp((t.s || 0) / 0.75, 0, 1));
      this.relax[f] += (rw - this.relax[f]) * (1 - Math.exp(-dt * 30));   // (eased: a swing cut short by a stop doesn't pop)
      footX += (0.3 - footX) * this.relax[f];
      out[L.thighX] += (thX - out[L.thighX]) * wf;
      out[L.thighZ] += (thZ - out[L.thighZ]) * wf;
      out[L.thighY] += (0 - out[L.thighY]) * wf;
      out[L.shin] += (knee - out[L.shin]) * wf;
      out[L.foot] += (footX - out[L.foot]) * wf;
      J['thigh' + f].rotation.set(out[L.thighX], out[L.thighY], out[L.thighZ]);
      J['shin' + f].rotation.x = out[L.shin];
      J['foot' + f].rotation.x = out[L.foot];
    }
  }

  apply(c) {
    const J = this.J;
    for (let i = 0; i < CHANNELS.length; i++) {
      const [j, ax] = CHANNELS[i];
      if (ax === 'py') J[j].position.y = 0.95 + c[i];
      else J[j].rotation[ax] = c[i];
    }
  }

  // ------------------------------------------------------------------ locomotion layer
  locomotion(speed, rel, back, p, match, ball) {
    const sp = clamp(speed / PLAYER.sprint, 0, 1);
    const moving = smooth(clamp(speed / 1.2, 0, 1));
    const w = this.phase * TAU + Math.PI / 2;     // sin(w) = 1: the left leg forward, at its touchdown
    const sL = Math.sin(w), sR = Math.sin(w + Math.PI);
    // The arms and the hip/shoulder twist peak with the thighs, which reach furthest just
    // before touchdown (late swing), not at it.
    const wa = w + TAU * 0.15, aL = Math.sin(wa), aR = Math.sin(wa + Math.PI);
    const cL = Math.cos(w), cR = Math.cos(w + Math.PI);
    const thighAmp = lerp(0.3, 1.0, sp) * moving;
    const kneeAmp = lerp(0.55, 1.9, sp) * moving;
    const crouch = p.jockey || (p.line === 'GK' && speed < 2.5) ? 0.45 : p.closeControl ? 0.2 : 0;
    // standing still a player is never upright: an athletic ready stance (knees soft, hips
    // back, chest over the toes), breathing — harder and faster when he's tired
    const ready = 1 - moving, tired = 1 - clamp(p.stamina ?? 1, 0, 1);
    const breath = Math.sin(this.t * (1.7 + 1.5 * tired)) * (0.5 + 1.6 * tired);

    // Lower body turns toward travel, upper body keeps the facing.
    let hipYaw = 0;
    if (speed > 0.6) hipYaw = back ? wrapAngle(rel - Math.PI) : rel;
    hipYaw = clamp(hipYaw, -1.2, 1.2) * moving * (crouch ? 0.35 : 1);   // a jockey / keeper shuffles square
    this.set('hips', 'y', hipYaw); this.cy('hips', 'y', 0.12 * sp * aL);
    this.set('spine', 'y', -hipYaw * 0.85); this.cy('spine', 'y', -0.18 * sp * aL);

    // legs
    this.set('thighL', 'x', -thighAmp * sL - crouch * 0.6 - 0.1 * ready);
    this.set('thighR', 'x', -thighAmp * sR - crouch * 0.6 - 0.1 * ready);
    this.set('shinL', 'x', 0.12 + kneeAmp * Math.pow(Math.max(0, cL), 1.4) + 0.2 * moving + crouch * 1.1 + 0.16 * ready);
    this.set('shinR', 'x', 0.12 + kneeAmp * Math.pow(Math.max(0, cR), 1.4) + 0.2 * moving + crouch * 1.1 + 0.16 * ready);
    this.set('footL', 'x', 0.2 * Math.sin(w - 0.6) * moving - crouch * 0.4);
    this.set('footR', 'x', 0.2 * Math.sin(w + Math.PI - 0.6) * moving - crouch * 0.4);
    this.set('thighL', 'z', 0.03 + crouch * 0.15);
    this.set('thighR', 'z', -0.03 - crouch * 0.15);

    // hips bob: lowest at mid-stance, highest in the flight phase of a run
    const bob = lerp(0.01, 0.042, sp) * moving;
    const idle = 1 - moving;
    this.set('hips', 'py', -crouch * 0.17 - 0.012 * moving - 0.05 * idle);
    this.cy('hips', 'py', -bob * this.gait.stance);

    // torso: tall and only slightly forward at a jog (more at a sprint), plus the weight
    // pitch from acceleration; banked into turns
    this.set('spine', 'x', 0.03 + 0.13 * sp + crouch * 0.35 + (p.closeControl ? 0.15 : 0) + 0.07 * ready + 0.012 * breath * (0.4 + ready) + 0.05 * tired * ready);
    this.set('body', 'x', this.pitch + 0.08 * sp * moving);       // a runner leans from the ankles
    // standing: the weight shifts slowly from foot to foot
    this.set('body', 'z', this.lean + 0.025 * idle * Math.sin(this.t * 1.1 + this.p.id));

    // arms swing opposite the legs, elbows bent to ~90° from a jog up
    const armAmp = lerp(0.2, 0.95, sp) * moving;
    this.cy('armL', 'x', armAmp * aL * 0.9);
    this.cy('armR', 'x', armAmp * aR * 0.9);
    this.set('armL', 'z', 0.1 + crouch * 0.5 + ready * (0.05 + 0.012 * breath));
    this.set('armR', 'z', -0.1 - crouch * 0.5 - ready * (0.05 + 0.012 * breath));
    this.set('armL', 'x', -0.14 * ready); this.set('armR', 'x', -0.14 * ready);
    const elbow = lerp(0.5, 1.55, smooth(clamp(speed / 4.2, 0, 1))) + 0.12 * sp;
    this.set('foreL', 'x', -elbow - crouch * 0.4);
    this.set('foreR', 'x', -elbow - crouch * 0.4);
    if (p.line === 'GK' && speed < 3 && !(ball.owner === p)) {
      // keeper ready: hands up and out
      this.cyc[ARM_L] = this.cyc[ARM_R] = 0;
      this.set('armL', 'x', -0.55); this.set('armR', 'x', -0.55);
      this.set('armL', 'z', 0.55); this.set('armR', 'z', -0.55);
      this.set('foreL', 'x', -0.9); this.set('foreR', 'x', -0.9);
    }

    // head: counter the lean, look at the ball
    const bx = ball.x - p.x, bz = ball.z - p.z;
    const toBall = Math.atan2(bz, bx);
    const look = clamp(wrapAngle(p.facing - toBall), -1.1, 1.1);
    this.lookYaw += (look - this.lookYaw) * 0.15;
    this.set('head', 'y', this.lookYaw - this.get('spine', 'y') * 0.5);
    const dist = Math.hypot(bx, bz);
    this.set('head', 'x', -this.get('spine', 'x') * 0.6 + clamp(0.9 / Math.max(dist, 0.5), 0, 0.5) * 0.6);
  }

  // Small dribble tap on the swinging leg.
  touchPose() {
    const k = Math.sin(clamp(this.touchT / 0.2, 0, 1) * Math.PI);
    const leg = this.touchLeg > 0 ? 'R' : 'L';
    this.add('thigh' + leg, 'x', -0.35 * k);
    this.add('shin' + leg, 'x', -0.3 * k);
    this.add('foot' + leg, 'x', -0.3 * k);
  }

  holdPose() {
    this.set('armL', 'x', -1.1); this.set('armR', 'x', -1.1);
    this.set('armL', 'z', 0.25); this.set('armR', 'z', -0.25);
    this.set('foreL', 'x', -0.9); this.set('foreR', 'x', -0.9);
    this.set('armL', 'y', -0.3); this.set('armR', 'y', 0.3);
  }

  onActionStart(a, ball) {
    const p = this.p;
    // Kick with the foot on the side the ball is on.
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const lat = -(ball.x - p.x) * fz + (ball.z - p.z) * fx;   // + = ball on the player's left
    this.kickFoot = Math.abs(lat) > 0.08 ? (lat > 0 ? -1 : 1) : (Math.random() < 0.75 ? 1 : -1);
    if (a.type === 'celebrate') this.celebrateStyle = Math.floor(Math.random() * 3);
    if (a.type === 'getup' || a.type === 'stumble') this.getupFrom = this.cur.slice();
  }

  // ------------------------------------------------------------------ action layer
  actionPose(a, p, ball, match) {
    const t = a.t, c = a.contact;
    const K = this.kickFoot;               // 1 = right foot kicks, −1 = left
    const kick = K > 0 ? 'R' : 'L', plant = K > 0 ? 'L' : 'R';
    const armK = K > 0 ? 'R' : 'L', armP = K > 0 ? 'L' : 'R';
    const sgn = K > 0 ? -1 : 1;           // lateral mirror for z/y rotations
    const env = (t0, t1) => smooth(clamp((t - t0) / (t1 - t0), 0, 1));
    const bell = (tc, w) => Math.exp(-((t - tc) * (t - tc)) / (w * w));

    switch (a.type) {
      case 'pass': case 'through': case 'shot': case 'volley': case 'clear': case 'lob': case 'panna': {
        const power = a.type === 'shot' || a.type === 'clear' ? 1 : a.type === 'volley' ? 0.9 : a.type === 'lob' ? 0.8 : a.type === 'panna' ? 0.3 : 0.6;
        const back = env(0, Math.max(c - 0.03, 0.02)) * (1 - env(c - 0.03, c));      // backswing
        const swing = env(c - 0.05, c + 0.02);                                       // strike
        const follow = env(c, c + 0.16) * (1 - env(a.dur - 0.12, a.dur));            // follow-through
        const recover = 1 - env(a.dur - 0.15, a.dur);
        const thigh = back * (0.45 + 0.5 * power) + swing * (-0.35) + follow * -(0.45 + 0.75 * power);
        const knee = back * (1.1 + 0.8 * power) + swing * 0.25 + follow * 0.15;
        this.set('thigh' + kick, 'x', thigh);
        this.set('shin' + kick, 'x', knee);
        this.set('foot' + kick, 'x', back * 0.5 - swing * 0.35 - follow * 0.3);
        if (a.type === 'pass' || a.type === 'through' || a.type === 'panna') this.set('thigh' + kick, 'y', sgn * -0.5 * recover); // side-foot
        this.set('thigh' + plant, 'x', -0.18 * recover); this.set('shin' + plant, 'x', 0.45 * recover);
        this.set('spine', 'x', (0.08 + 0.18 * swing + 0.1 * follow - (a.type === 'lob' ? 0.2 : 0)) * recover + 0.05);
        this.set('spine', 'y', sgn * (-0.25 * back + 0.2 * follow) * recover);
        this.set('arm' + armP, 'z', (K > 0 ? 1 : -1) * (0.3 + 0.8 * power) * recover);
        this.set('arm' + armP, 'x', -0.5 * power * recover);
        this.set('arm' + armK, 'z', -(K > 0 ? 1 : -1) * 0.5 * recover);
        this.set('arm' + armK, 'x', 0.4 * recover);
        this.set('body', 'z', sgn * -0.12 * power * swing * recover);
        this.set('hips', 'py', -0.05 * recover);
        if (a.type === 'volley') { this.set('body', 'z', sgn * -0.55 * recover); this.set('thigh' + kick, 'z', sgn * 0.8 * swing * recover); }
        this.kickIK(kick, ball, p, bell(c, 0.05));
        break;
      }
      case 'throw': {
        const u = clamp(t / a.dur, 0, 1);
        const wind = env(0, c) * (1 - env(c, c + 0.08));
        const rel = env(c - 0.02, c + 0.1);
        this.set('armR', 'x', -2.6 * wind - 1.3 * rel * (1 - u)); this.set('armL', 'x', -1.2 * (1 - u));
        this.set('foreR', 'x', -0.6); this.set('spine', 'x', -0.2 * wind + 0.35 * rel);
        this.set('thighL', 'x', -0.5 * rel); this.set('shinL', 'x', 0.4);
        break;
      }
      case 'header': {
        const u = clamp(t / a.dur, 0, 1), jump = Math.sin(u * Math.PI);
        this.set('hips', 'py', 0.3 * jump);
        this.set('spine', 'x', -0.35 + 0.8 * env(0.05, 0.18));
        this.set('armL', 'x', -1.0 * jump); this.set('armR', 'x', -1.0 * jump);
        this.set('armL', 'z', 0.6); this.set('armR', 'z', -0.6);
        this.set('shinL', 'x', 0.9 * jump); this.set('shinR', 'x', 0.7 * jump);
        break;
      }
      case 'tackle': {
        const lunge = env(0, c) * (1 - env(a.dur - 0.12, a.dur));
        this.set('thigh' + kick, 'x', -1.05 * lunge); this.set('shin' + kick, 'x', 0.15 * lunge);
        this.set('foot' + kick, 'x', -0.3 * lunge);
        this.set('thigh' + plant, 'x', 0.35 * lunge); this.set('shin' + plant, 'x', 1.0 * lunge);
        this.set('hips', 'py', -0.2 * lunge); this.set('spine', 'x', 0.45 * lunge);
        this.set('armL', 'z', 0.7 * lunge); this.set('armR', 'z', -0.7 * lunge);
        break;
      }
      case 'slide': {
        const down = env(0, 0.14);
        this.set('hips', 'py', -0.72 * down);
        this.set('body', 'x', -1.05 * down);
        this.set('thigh' + kick, 'x', -1.45 * down); this.set('shin' + kick, 'x', 0.05);
        this.set('thigh' + plant, 'x', -0.55 * down); this.set('shin' + plant, 'x', 1.55 * down);
        this.set('spine', 'x', 0.45 * down); this.set('spine', 'y', 0);
        this.set('armL', 'x', 0.7 * down); this.set('armR', 'x', 0.7 * down);
        this.set('armL', 'z', 0.9 * down); this.set('armR', 'z', -0.9 * down);
        this.set('head', 'x', 0.5 * down);
        break;
      }
      case 'dive': {
        const side = -(a.side || 1);    // roll direction (toward the dive)
        const load = env(0, 0.08), fly = env(0.06, 0.2), land = env(0.45, 0.7);
        const u = clamp((t - 0.06) / 0.45, 0, 1), arc = Math.sin(u * Math.PI) * (a.high ? 0.65 : 0.25);
        this.set('hips', 'py', -0.15 * load * (1 - fly) + arc * (1 - land) - 0.62 * land);
        this.set('body', 'z', side * 1.35 * fly);
        this.set('armL', 'x', -2.9 * fly); this.set('armR', 'x', -2.9 * fly);
        this.set('armL', 'z', 0.2); this.set('armR', 'z', -0.2);
        this.set('foreL', 'x', -0.2); this.set('foreR', 'x', -0.2);
        this.set('thighL', 'x', -0.2 * fly); this.set('thighR', 'x', 0.15 * fly);
        this.set('shinL', 'x', 0.3); this.set('shinR', 'x', 0.5);
        this.set('spine', 'z', side * 0.25 * fly);
        this.set('head', 'y', 0);
        break;
      }
      case 'stepover': {
        // Leg circles over the ball + shoulder drop sells the feint.
        const side = a.side || 1;
        const leg = side > 0 ? 'R' : 'L', sg = side > 0 ? -1 : 1;
        const u = clamp(t / 0.4, 0, 1);
        const circ = Math.sin(u * Math.PI);
        this.set('thigh' + leg, 'x', -0.55 * circ);
        this.set('thigh' + leg, 'z', sg * (-0.35 + 0.8 * u) * circ);
        this.set('thigh' + leg, 'y', sg * 0.5 * circ);
        this.set('shin' + leg, 'x', 0.7 * circ);
        this.set('body', 'z', sg * 0.28 * Math.sin(u * TAU));
        this.set('spine', 'z', -sg * 0.2 * circ);
        this.set('hips', 'py', -0.08);
        this.set('arm' + (side > 0 ? 'L' : 'R'), 'z', (side > 0 ? 1 : -1) * 0.8 * circ);
        break;
      }
      case 'dragback': {
        const sole = env(0, 0.12) * (1 - env(0.28, 0.4));
        this.set('thigh' + kick, 'x', -0.35 * sole + 0.25 * env(0.12, 0.28) * (1 - env(0.3, 0.42)));
        this.set('shin' + kick, 'x', 0.8 * sole);
        this.set('foot' + kick, 'x', 0.55 * sole);
        this.set('spine', 'x', -0.1 * sole);
        this.set('armL', 'z', 0.5); this.set('armR', 'z', -0.5);
        break;
      }
      case 'roulette': {
        const u = clamp(t / 0.58, 0, 1);
        const step = Math.sin(u * TAU * 2);
        this.set('thighL', 'x', -0.4 * step); this.set('thighR', 'x', 0.4 * step);
        this.set('shinL', 'x', 0.5 + 0.3 * step); this.set('shinR', 'x', 0.5 - 0.3 * step);
        this.set('hips', 'py', -0.12); this.set('spine', 'x', 0.3);
        this.set('armL', 'z', 0.9); this.set('armR', 'z', -0.9);
        this.set('body', 'z', 0.15 * Math.sin(u * TAU));
        break;
      }
      case 'rainbow': case 'flickup': {
        const rb = a.type === 'rainbow';
        const u = env(0, c + 0.05) * (1 - env(a.dur - 0.12, a.dur));
        if (rb) {
          // heel flick up behind
          this.set('thigh' + kick, 'x', 0.35 * u); this.set('shin' + kick, 'x', 2.3 * u);
          this.set('foot' + kick, 'x', 0.8 * u); this.set('spine', 'x', 0.45 * u);
          this.set('armL', 'z', 0.9 * u); this.set('armR', 'z', -0.9 * u);
        } else {
          this.set('thigh' + kick, 'x', -0.5 * u); this.set('shin' + kick, 'x', 0.35 * u); this.set('foot' + kick, 'x', -0.6 * u);
          this.set('spine', 'x', 0.15);
        }
        break;
      }
      case 'stumble': {
        const u = clamp(t / a.dur, 0, 1), s = Math.sin(u * Math.PI);
        this.set('spine', 'x', -0.3 * s); this.set('spine', 'z', 0.25 * s * Math.sin(this.t * 9));
        this.set('armL', 'x', -1.4 * s); this.set('armR', 'x', -0.8 * s);
        this.set('armL', 'z', 1.1 * s); this.set('armR', 'z', -1.3 * s);
        this.set('body', 'z', 0.18 * s);
        this.set('hips', 'py', -0.1 * s);
        break;
      }
      case 'getup': {
        // Blend from wherever we ended up back to the locomotion pose.
        const u = smooth(clamp(t / a.dur, 0, 1));
        if (this.getupFrom) for (let i = 0; i < this.tgt.length; i++) this.tgt[i] = this.getupFrom[i] * (1 - u) + this.tgt[i] * u;
        break;
      }
      case 'celebrate': {
        const st = this.celebrateStyle;
        if (st === 0) { // arms aloft
          this.set('armL', 'x', -2.9); this.set('armR', 'x', -2.9); this.set('armL', 'z', 0.35); this.set('armR', 'z', -0.35);
          this.set('foreL', 'x', -0.2); this.set('foreR', 'x', -0.2);
        } else if (st === 1) { // airplane
          this.set('armL', 'z', 1.45); this.set('armR', 'z', -1.45); this.set('foreL', 'x', 0); this.set('foreR', 'x', 0);
          this.set('body', 'z', 0.3 * Math.sin(this.t * 2.5));
        } else { // knee slide at the end
          const sl = env(1.6, 1.9);
          this.set('hips', 'py', -0.5 * sl); this.set('body', 'x', -0.35 * sl);
          this.set('thighL', 'x', 0.2 * sl); this.set('thighR', 'x', 0.2 * sl);
          this.set('shinL', 'x', 1.8 * sl); this.set('shinR', 'x', 1.8 * sl);
          this.set('armL', 'x', -2.5 * sl - 0.5); this.set('armR', 'x', -2.5 * sl - 0.5);
          this.set('armL', 'z', 0.6); this.set('armR', 'z', -0.6);
          this.set('spine', 'x', -0.4 * sl);
        }
        break;
      }
    }
  }

  // Two-bone IK: bend the kicking leg so the foot meets the ball at contact.
  kickIK(side, ball, p, w) {
    if (w < 0.02) return;
    const s = this.s;
    // Ball in the hips' local frame (ignoring hip yaw, which is small during kicks).
    const yaw = this.yaw.x;
    const dx = ball.x - p.x, dz = ball.z - p.z;
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);    // forward
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);    // left
    const hipX = (side === 'R' ? -0.095 : 0.095) * s;
    const hipY = (0.93 + this.get('hips', 'py')) * s;
    const tx = lx - hipX, ty = Math.max(ball.y, 0.08) - hipY, tz = lz - 0.12;
    const a = THIGH * s, b = (SHIN + 0.04) * s;
    const d = clamp(Math.hypot(tx, ty, tz), 0.25, a + b - 0.01);
    const knee = Math.PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    const alpha = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const pitchT = Math.atan2(tz, -ty);
    const thighX = -(pitchT + alpha * 0.9);
    const thighZ = clamp(Math.atan2(tx, -ty), -0.6, 0.6);
    const lerpSet = (j, ax, v) => this.set(j, ax, this.get(j, ax) * (1 - w) + v * w);
    lerpSet('thigh' + side, 'x', thighX);
    lerpSet('thigh' + side, 'z', thighZ);
    lerpSet('shin' + side, 'x', knee);
  }

  // Replay support.
  snapshot() { return this.out.slice(); }
  applySnapshot(arr, x, z, yaw) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    this.apply(arr);
    this.syncBody();
  }
}
