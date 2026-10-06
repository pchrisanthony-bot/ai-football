// Look IK (the movement brief's test I): eyes lead, the head follows, the neck and spine
// take part of it — never past human limits, never snapping. Headless: LookIK has no
// three.js in it.
import { LookIK } from '../src/render/lookik.js';
import { footballMovementConfig as FM } from '../src/config.js';

const L = FM.lookIK, deg = r => r * 180 / Math.PI;

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });
  const dt = 1 / 60;

  // The ball jumps 50° to his left: in the first frames the eyes have moved and the head
  // hasn't caught up; a second later the head has turned and the eyes recentre.
  {
    const k = new LookIK(3);
    for (let i = 0; i < 60; i++) k.step(dt, 0, 0.3);
    const target = 50 * Math.PI / 180;
    const early = [];
    for (let i = 0; i < 6; i++) { k.step(dt, target, 0.3); early.push({ eye: k.eye.yaw, head: k.head.yaw }); }
    const e3 = early[2];
    check('I · eyes lead: 3 frames after the ball moves the eyes have turned further than the head', e3.eye > e3.head && e3.eye > 0.3, `eyes ${deg(e3.eye).toFixed(0)}° · head ${deg(e3.head).toFixed(0)}°`);
    for (let i = 0; i < 60; i++) k.step(dt, target, 0.3);
    check('…then the head follows and the eyes recentre (head ≥ 40°, eyes ≤ 10° after a second)', deg(k.head.yaw) >= 40 && Math.abs(deg(k.eye.yaw)) <= 10, `head ${deg(k.head.yaw).toFixed(0)}° · eyes ${deg(k.eye.yaw).toFixed(0)}°`);
  }

  // Limits: a ball right behind him — the head stops at its limit, the eyes at theirs.
  {
    const k = new LookIK(5);
    let maxEye = 0, maxHead = 0, maxEyeP = 0, maxHeadP = 0;
    for (let i = 0; i < 180; i++) {
      k.step(dt, 2.9 * Math.sin(i / 20), 1.4 * Math.cos(i / 15));
      maxEye = Math.max(maxEye, Math.abs(k.eye.yaw)); maxHead = Math.max(maxHead, Math.abs(k.head.yaw));
      maxEyeP = Math.max(maxEyeP, Math.abs(k.eye.pitch)); maxHeadP = Math.max(maxHeadP, Math.abs(k.head.pitch));
    }
    check('…never past human limits (eyes ±35°/±20°, head ±60°/±35°)', maxEye <= L.eyeYawLimit + 1e-6 && maxHead <= L.headYawLimit + 1e-6 && maxEyeP <= L.eyePitchLimit + 1e-6 && maxHeadP <= L.headPitchLimit + 1e-6,
      `eyes ${deg(maxEye).toFixed(0)}°/${deg(maxEyeP).toFixed(0)}° · head ${deg(maxHead).toFixed(0)}°/${deg(maxHeadP).toFixed(0)}°`);
  }

  // No snapping: the head's turn rate stays human however the ball moves (< 700°/s).
  {
    const k = new LookIK(7);
    let prev = 0, fastest = 0;
    for (let i = 0; i < 240; i++) {
      const tgt = (i % 40 < 20 ? 1 : -1) * 1.0;     // the ball flicking side to side
      k.step(dt, tgt, 0.2);
      fastest = Math.max(fastest, Math.abs(k.head.yaw - prev) / dt); prev = k.head.yaw;
    }
    check('…and no snapping: the head turns at a human rate (< 700°/s) even when the ball flicks side to side', deg(fastest) < 700, `fastest ${deg(fastest).toFixed(0)}°/s`);
  }

  // Off the ball he scans: over 10 s his target isn't always the ball.
  {
    const k = new LookIK(11);
    const p = { team: 0, line: 'MID', id: 1, x: 0, z: 0, facing: 0, heading: 0, speed: 0, action: null, ai: { state: 'SUPPORT' } };
    const opp = { team: 1, active: true, x: 4, z: 2, line: 'MID' }, mate = { team: 0, active: true, x: -3, z: -4, line: 'MID', id: 2 };
    const m = { phase: 'play', players: [p, opp, mate], teams: [{ dir: 1 }, { dir: -1 }], oppGoalX: () => 16 };
    p.active = true;
    const b = { x: 6, y: 0.11, z: -2, vx: 0, vy: 0, vz: 0, owner: null };
    const whys = {};
    for (let i = 0; i < 600; i++) { const T = k.pick(p, m, b, i * dt); whys[T.why] = (whys[T.why] || 0) + 1; }
    const scans = Object.entries(whys).filter(([w]) => w.startsWith('scan')).reduce((a, [, n]) => a + n, 0);
    check('…off the ball he mostly watches the ball, with short scans of who\'s around (5–30% of the time)', whys.ball > 400 && scans / 600 >= 0.05 && scans / 600 <= 0.3, JSON.stringify(whys));
  }
  return out;
}
