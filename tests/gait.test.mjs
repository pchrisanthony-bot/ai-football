// The foot-planted gait (render side, pure logic): planted feet never move, the feet
// alternate at a running cadence with a flight phase at a sprint, a stop settles both
// feet under the body, turning on the spot is footwork, and a teleport re-plants them.
import { Gait } from '../src/render/gait.js';

const DT = 1 / 60;
// Drive a gait with a body moving at (vx, vz) facing its travel; returns per-frame feet.
function drive(g, frames, body) {
  const rows = [];
  for (let i = 0; i < frames; i++) {
    body.x += body.vx * DT; body.z += body.vz * DT;
    if (body.turn) body.yaw += body.turn * DT;
    const t = g.update({ x: body.x, z: body.z, yaw: body.yaw, s: 1, width: 0.11, dt: DT });
    rows.push({ L: { ...g.feet.L }, R: { ...g.feet.R }, T: t, x: body.x, z: body.z, yaw: body.yaw });
  }
  return rows;
}
const yawOf = (vx, vz) => Math.atan2(vx, vz);     // three.js yaw facing the travel

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 1) Running at 5 m/s: a planted foot never moves; the feet alternate at ~3 steps/s.
  {
    const g = new Gait(), body = { x: 0, z: 0, vx: 5, vz: 0, yaw: yawOf(5, 0) };
    drive(g, 30, body);
    const rows = drive(g, 120, body);
    let slip = 0, lands = [], flight = 0;
    for (let i = 1; i < rows.length; i++) {
      for (const f of ['L', 'R']) {
        const a = rows[i - 1][f], b = rows[i][f];
        if (a.state === 'plant' && b.state === 'plant') slip = Math.max(slip, Math.hypot(b.x - a.x, b.z - a.z));
        if (a.state === 'swing' && b.state === 'plant') lands.push(f);
      }
      if (rows[i].L.state === 'swing' && rows[i].R.state === 'swing') flight++;
    }
    const alternating = lands.every((f, i) => i === 0 || f !== lands[i - 1]);
    const perSec = lands.length / 2;
    check('running: a planted foot never slides (locked to the pitch)', slip < 1e-9, `max planted movement ${slip.toExponential(1)} m`);
    check('running: the feet alternate at a running cadence', alternating && perSec > 2.5 && perSec < 3.6, `${lands.length} landings in 2 s, alternating ${alternating}`);
    check('running at 5 m/s has a flight phase', flight > 5, `${flight} frames with both feet off the ground`);
  }

  // 2) A stop: both feet end planted under the body.
  {
    const g = new Gait(), body = { x: 0, z: 0, vx: 6, vz: 0, yaw: yawOf(6, 0) };
    drive(g, 60, body);
    const rows = [];
    for (let i = 0; i < 40; i++) { body.vx = Math.max(0, body.vx - 18 * DT); rows.push(...drive(g, 1, body)); }
    rows.push(...drive(g, 30, body));
    const last = rows[rows.length - 1];
    const off = Math.max(...['L', 'R'].map(f => Math.hypot(last[f].x - last.x, last[f].z - last.z)));
    check('a stop settles both feet planted under the body', last.L.state === 'plant' && last.R.state === 'plant' && off < 0.3, `feet within ${off.toFixed(2)} m of the hips`);
  }

  // 3) Turning on the spot steps the feet round (no spinning on locked feet).
  {
    const g = new Gait(), body = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0 };
    drive(g, 20, body);
    body.turn = Math.PI / 2 / 0.5;                      // a quarter turn in half a second
    const rows = drive(g, 30, body);
    body.turn = 0;
    rows.push(...drive(g, 30, body));
    let steps = 0;
    for (let i = 1; i < rows.length; i++) for (const f of ['L', 'R']) if (rows[i - 1][f].state === 'plant' && rows[i][f].state === 'swing') steps++;
    const last = rows[rows.length - 1];
    const lx = Math.cos(last.yaw), lz = -Math.sin(last.yaw);
    const sideOk = (last.L.x - last.x) * lx + (last.L.z - last.z) * lz > 0.05 && (last.R.x - last.x) * lx + (last.R.z - last.z) * lz < -0.05;
    check('turning on the spot is footwork (the feet step round)', steps >= 2 && sideOk, `${steps} steps; left foot on the left after the turn: ${sideOk}`);
  }

  // 4) A teleport (a restart placement, a replay cut) re-plants both feet under him.
  {
    const g = new Gait(), body = { x: 0, z: 0, vx: 4, vz: 0, yaw: yawOf(4, 0) };
    drive(g, 40, body);
    body.x += 20; body.vx = 0;
    const r = drive(g, 1, body)[0];
    const nan = ['L', 'R'].some(f => !Number.isFinite(r.T[f].x + r.T[f].y + r.T[f].z));
    check('a teleport re-plants both feet under the body (no stretched legs)', !nan && ['L', 'R'].every(f => Math.hypot(r[f].x - r.x, r[f].z - r.z) < 0.3), 'feet under the new spot');
  }
  return out;
}
