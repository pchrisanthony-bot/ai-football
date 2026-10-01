// Gameplay measurement scenarios shared by tools/metrics.mjs and the regression tests:
// stopping with the ball, the first touch, and the 90° cut — all through the real
// HumanController, driven like a player's stick.
import { scenario } from './sim.mjs';

const R = 0.11;

// ---------------------------------------------------------------- stopping with the ball
export function stopTest(name, { sprint = false, turn = false, afterKnock = false, opponent = false, afterTouch = false, matchOpts = {} } = {}) {
  const s = scenario({ ball: !afterTouch, x: afterTouch ? -4 : -13, matchOpts, others: opponent || afterTouch ? (q => (opponent && q.team === 1 && q.line === 'DEF') || (afterTouch && q.team === 0 && q.line === 'MID')) : null });
  const btn = sprint ? ['sprint'] : [];
  if (opponent) { const o = s.m.players.find(q => q.team === 1 && q.line === 'DEF'); Object.assign(o, { x: -1.5, z: 0.3 }); }
  if (afterTouch) {
    // a teammate plays it into the receiver's run from behind and to the side
    const mate = s.m.players.find(q => q.team === 0 && q.active && q !== s.p);
    for (let i = 0; i < 20; i++) s.frame(1, 0, btn);
    // a real pass from a teammate behind the runner (the game's own pass, with its lead)
    Object.assign(mate, { x: s.p.x - 7, z: s.p.z + 1.5, facing: 0, heading: 0 });
    const b = s.ball;
    b.x = mate.x + 0.45; b.z = mate.z; s.m.gainPossession(mate, true);
    s.m.requestKick(mate, 'pass', { receiver: s.p });
    let n = 0;
    while (n++ < 150 && b.owner !== s.p) s.frame(1, 0, btn);
    if (b.owner !== s.p) return { name, error: 'pass never controlled' };
  } else {
    for (let i = 0; i < 84; i++) s.frame(1, 0, btn);   // 1.4 s run with the ball
  }
  if (turn) for (let i = 0; i < 9; i++) s.frame(0, 1, btn);   // 0.15 s into a cut
  if (afterKnock) {
    const n0 = s.events.length; let n = 0;
    while (n++ < 90 && !s.events.slice(n0).some(e => e.type === 'touch' && e.power > 0.3)) s.frame(1, 0, btn);
  }
  const v0 = s.p.speed, x0 = s.p.x, z0 = s.p.z;
  let tStop = null, peak = 0;
  const at = {};
  for (let i = 1; i <= 120; i++) {
    s.frame(0, 0, []);
    if (i > 12) peak = Math.max(peak, s.p.speed);
    if (tStop == null && s.p.speed < 0.3) tStop = i / 60;
    if (i === 12) at.v02 = s.p.speed;
    if (i === 24) at.v04 = s.p.speed;
  }
  const b = s.ball;
  return {
    name, v0, tStop, dist: Math.hypot(s.p.x - x0, s.p.z - z0), v02: at.v02, v04: at.v04, peakAfter02: peak,
    owned: b.owner === s.p, ballGap: Math.hypot(b.x - s.p.x, b.z - s.p.z), ballSpeedEnd: Math.hypot(b.vx, b.vz),
  };
}

// ---------------------------------------------------------------- first touch
export function touchTest({ run = 0, from = 'front', speed = 10, input = 'none', control = null, cushion = false, matchOpts = {} }) {
  const s = scenario({ x: 0, z: 0, matchOpts, others: q => q.team === 0 && q.line === 'MID' });
  const p = s.p, b = s.ball;
  if (control != null) p.attrs = { ...p.attrs, control };
  const btn = cushion ? ['control'] : [];
  const mate = s.m.players.find(q => q.team === 0 && q.active && q !== p);
  Object.assign(mate, { x: -20, z: 8 });
  const stickRun = run > 0 ? [1, 0] : [0, 0];
  // get up to running speed first
  if (run > 0) { Object.assign(p, { x: -6 }); for (let i = 0; i < 70 && p.speed < run - 0.05; i++) s.frame(1, 0, []); }
  // ball approach: start 3.2 m from where the receiver will be, aimed at him
  const dirs = { front: [-1, 0], side: [0, 1], behind: [1, 0] };   // ball travel direction
  const [ux, uz] = dirs[from];
  const v0 = speed + (1.2 + 0.35 * speed) * (3.2 / speed);   // rolls down to ≈speed at contact
  const lead = run > 0 ? p.vx * (3.2 / ((v0 + speed) / 2)) : 0;   // where he'll be when it arrives
  const cx = p.x + lead, cz = p.z;
  Object.assign(b, { owner: null, x: cx - ux * 3.2, z: cz - uz * 3.2, y: R, vx: ux * v0, vz: uz * v0, vy: 0, wx: uz * v0 / R, wy: 0, wz: -ux * v0 / R });
  b.passTo = p; b.passUntil = s.m.time + 3; b.lastKick = { pid: mate.id, team: 0, kind: 'pass', t: s.m.time };
  // The receiver keeps his run (or stands) until the ball is ~0.2 s away, then gives the
  // input for the touch: none (stick neutral), side (directs it across) or forward.
  const stick = input === 'side' ? [0, 1] : input === 'forward' ? [1, 0] : [0, 0];
  let contact = -1, inV = null, inDir = null, n = 0;
  const hist = [];
  while (n < 200) {
    const pre = { vx: b.vx, vz: b.vz, own: b.owner };
    const near = Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(b.vx - p.vx, b.vz - p.vz) * 0.2 + 0.6;
    const [sx, sy] = contact >= 0 || near ? stick : stickRun;
    s.frame(sx, sy, btn);
    n++;
    hist.push({ x: b.x, z: b.z, vx: b.vx, vz: b.vz, px: p.x, pz: p.z, pvx: p.vx, pvz: p.vz, own: b.owner === p });
    if (contact < 0 && (b.owner === p || s.events.some(e => (e.type === 'deflect' || e.type === 'firstTouch') && e.pid === p.id))) {
      contact = hist.length - 1; inV = Math.hypot(pre.vx, pre.vz); inDir = Math.atan2(pre.vz, pre.vx);
    }
    if (contact >= 0 && hist.length - 1 - contact >= 60) break;
  }
  if (contact < 0) return { run, from, speed, input, contact: false };
  const at = k => hist[Math.min(hist.length - 1, contact + k)];
  const o1 = at(2), o6 = at(6);
  const outV = Math.hypot(o6.vx, o6.vz);
  const outDir = Math.atan2(o6.vz, o6.vx);
  let turn = Math.abs(((outDir - inDir) * 180 / Math.PI + 540) % 360 - 180);
  // control time: until the ball moves with the receiver (relative speed < 0.6 m/s)
  let ctl = null;
  for (let k = 1; k < 60; k++) { const h = at(k); if (Math.hypot(h.vx - h.pvx, h.vz - h.pvz) < 0.6) { ctl = k / 60; break; } }
  let travel = 0;
  for (let k = 1; k <= 30; k++) { const a = at(k - 1), c = at(k); travel += Math.hypot(c.x - a.x, c.z - a.z); }
  const e = at(30);
  return {
    run, from, speed, input, contact: true, inV, outV, outV2: Math.hypot(o1.vx, o1.vz), turnDeg: turn, controlT: ctl,
    travel05: travel, gap05: Math.hypot(e.x - e.px, e.z - e.pz), owned1: at(59).own,
  };
}

// ---------------------------------------------------------------- 90° cut at full sprint
export function cutTest(withBall, matchOpts = {}) {
  const s = scenario({ ball: withBall, x: -14, matchOpts });
  for (let i = 0; i < 96; i++) s.frame(1, 0, ['sprint']);
  const v0 = s.p.speed, x0 = s.p.x;
  let tTurn = null, vMin = 99;
  for (let i = 1; i <= 60; i++) {
    s.frame(0, 1, ['sprint']);
    vMin = Math.min(vMin, s.p.speed);
    if (tTurn == null && Math.abs(((s.p.heading * 180 / Math.PI + 90) + 540) % 360 - 180) < 15) tTurn = i / 60;
  }
  return { withBall, v0, tTurn, vMin, overshoot: s.p.x - x0, owned: withBall ? s.ball.owner === s.p : null };
}
