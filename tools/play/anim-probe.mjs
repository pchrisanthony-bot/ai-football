// Animation quality probe (frame-accurate, real renderer): for a controlled player doing
// each movement, measure foot skating (a planted foot sliding over the ground), feet
// floating above / sinking into the pitch, body-yaw snaps and pose pops.
//   node tools/play/anim-probe.mjs [label] [--format=N]
import fs from 'fs';
import { harness } from './harness.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const label = process.argv.slice(2).find(a => !a.startsWith('--')) || 'anim';
const H = await harness({});
await H.start(arg('format', null) != null ? { FORMAT: +arg('format') } : {});
await H.step(90);

// Put the human alone in space (others frozen far away), optionally with the ball.
const isolate = (ball) => H.eval((ball) => {
  const m = __G.match, p = m.human;
  m.phase = 'play'; m.restart = null;
  m.players.forEach((q, i) => { if (q !== p) { q.frozen = true; q.speed = 0; if (q.line !== 'GK') { q.x = (q.team === p.team ? -1 : 1) * (m.oppGoalX(0) - 3); q.z = ((i % 5) - 2) * 3.2; } } });
  Object.assign(p, { x: -6, z: 0, speed: 0, vx: 0, vz: 0, heading: 0, facing: 0, stamina: 1, action: null });
  m.loseBall();
  const b = m.ball; Object.assign(b, { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, y: 0.11 });
  if (ball) { b.x = p.x + 0.45; b.z = p.z; m.gainPossession(p, true); } else { b.x = 12; b.z = 7; }
}, ball);

// Run `frames` frames with keys held; per frame record feet, root, yaw and joints.
const record = (frames) => H.eval((frames) => {
  const m = __G.match, p = m.human, A = __G.mview.athletes.get(p.id);
  const V = new A.J.footL.position.constructor();
  // two points of each sole — the heel and the ball of the foot — tracked separately
  const pt = (f, z) => { const w = V.set(0, -0.068, z).applyMatrix4(A.J[f].matrixWorld); return [w.x, w.y, w.z]; };
  const out = [];
  let prev = null;
  for (let i = 0; i < frames; i++) {
    __tick(1 / 60, 1);
    const cur = Array.from(A.out || A.cur);
    out.push({ speed: p.speed, yaw: A.root.rotation.y, Lh: pt('footL', -0.05), Lb: pt('footL', 0.13), Rh: pt('footR', -0.05), Rb: pt('footR', 0.13), pose: cur, act: p.action ? p.action.type : null });
    prev = cur;
  }
  return out;
}, frames);

function analyse(rows) {
  const dt = 1 / 60, CONTACT = 0.035;
  let contactT = 0, skateSum = 0, skateBad = 0, n = 0, minY = 9, maxGroundGap = 0, yawSnap = 0, popMax = 0, popAt = '', bodyDist = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    for (const f of ['Lh', 'Lb', 'Rh', 'Rb']) {
      minY = Math.min(minY, b[f][1]);
      if (a[f][1] < CONTACT && b[f][1] < CONTACT) {
        const s = Math.hypot(b[f][0] - a[f][0], b[f][2] - a[f][2]) / dt;
        contactT += dt; skateSum += s * dt; n++; if (s > 0.6) skateBad += dt;
      }
    }
    // the lower foot should be on the ground whenever the player isn't airborne
    const low = Math.min(b.Lh[1], b.Lb[1], b.Rh[1], b.Rb[1]);
    if (!b.act) maxGroundGap = Math.max(maxGroundGap, low);
    const dyaw = Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw))) / dt;
    if (dyaw > 9) yawSnap++;
    for (let k = 0; k < b.pose.length; k++) {
      const r = Math.abs(b.pose[k] - a.pose[k]) / dt;
      if (r > popMax) { popMax = r; popAt = `${CH[k]} @${i} ${a.pose[k].toFixed(2)}→${b.pose[k].toFixed(2)}`; }
    }
    bodyDist += b.speed * dt;
  }
  const avgSpeed = bodyDist / ((rows.length - 1) * dt);
  return {
    bodySpeed: +avgSpeed.toFixed(2),
    footContact: +(contactT / ((rows.length - 1) * dt) / 4).toFixed(2),          // share of time a sole point is on the ground
    skate: contactT ? +(skateSum / contactT).toFixed(2) : null,                      // m/s a planted foot slides
    skateVsBody: contactT && avgSpeed > 0.3 ? +((skateSum / contactT) / avgSpeed).toFixed(2) : null,
    skatingShare: contactT ? +(skateBad / contactT).toFixed(2) : null,                // planted time sliding > 0.6 m/s
    sink: +(-Math.min(0, minY)).toFixed(3),                                           // m the lowest foot goes under the pitch
    float: +maxGroundGap.toFixed(3),                                                  // m the lower foot hangs above it (no action)
    yawSnaps: yawSnap, popMaxRadS: +popMax.toFixed(1), popAt,
  };
}

const CH = await H.eval(async () => (await import('/src/render/athlete.js')).CHANNELS.map(c => c.join('.')));
const keyDown = (...k) => H.down(...k), keyUp = (...k) => H.up(...k);
const scenarios = {
  'jog': async () => { await isolate(false); await keyDown('KeyD'); await H.step(30); const r = await record(60); await keyUp('KeyD'); return r; },
  'sprint': async () => { await isolate(false); await keyDown('KeyD', 'ShiftLeft'); await H.step(50); const r = await record(60); await keyUp('KeyD', 'ShiftLeft'); return r; },
  'start from still': async () => { await isolate(false); await H.step(20); await keyDown('KeyD', 'ShiftLeft'); const r = await record(50); await keyUp('KeyD', 'ShiftLeft'); return r; },
  'stop from sprint': async () => { await isolate(false); await keyDown('KeyD', 'ShiftLeft'); await H.step(60); await keyUp('KeyD', 'ShiftLeft'); return record(60); },
  '90° cut at sprint': async () => { await isolate(false); await keyDown('KeyD', 'ShiftLeft'); await H.step(60); await keyUp('KeyD'); await keyDown('KeyS'); const r = await record(50); await keyUp('KeyS', 'ShiftLeft'); return r; },
  '180° turn at jog': async () => { await isolate(false); await keyDown('KeyD'); await H.step(50); await keyUp('KeyD'); await keyDown('KeyA'); const r = await record(60); await keyUp('KeyA'); return r; },
  'jockey sideways': async () => { await isolate(false); await keyDown('Space', 'KeyS'); await H.step(20); const r = await record(60); await keyUp('Space', 'KeyS'); return r; },
  'turn on the spot': async () => { await isolate(false); await H.step(20); await keyDown('KeyA'); await H.step(3); await keyUp('KeyA'); const r = await record(50); return r; },
  'dribble jog': async () => { await isolate(true); await keyDown('KeyD'); await H.step(30); const r = await record(60); await keyUp('KeyD'); return r; },
};
const res = {};
for (const [name, fn] of Object.entries(scenarios)) { res[name] = analyse(await fn()); console.log(name.padEnd(18), JSON.stringify(res[name])); }
fs.mkdirSync('docs/metrics', { recursive: true });
fs.writeFileSync(`docs/metrics/anim-${label}.json`, JSON.stringify(res, null, 1));
if (H.errors.length) console.log('PAGE ERRORS', H.errors);
await H.close();
