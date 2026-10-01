// Headless physics checks for the protected feature (cage rebounds) and the rest of the ball model.
import { makeBall, stepBall, predictPath, copyBall } from '../src/sim/ball.js';
import { BALL } from '../src/config.js';
import { PITCH } from '../src/sim/pitch.js';
import { bankAim } from '../src/sim/kicks.js';

const R = BALL.r;
const results = [];
const check = (name, ok, info = '') => results.push({ name, ok, info });

function run(b, secs, ev = []) {
  for (let t = 0; t < secs; t += 1 / 120) stepBall(b, 1 / 120, ev);
  return ev;
}

// 1. Perpendicular hit on the side wall at 12 m/s: rebound = 0.70 × incoming (plus a little roll loss).
{
  const b = makeBall(); b.z = 7; b.vz = 12;
  let before = null, after = null;
  for (let i = 0; i < 240 && after === null; i++) {
    const ev = [];
    const v0 = b.vz;
    stepBall(b, 1 / 120, ev);
    if (ev.some(e => e.type === 'wall')) { before = v0; after = b.vz; }
  }
  const ratio = -after / before;
  check('perpendicular rebound ≈ 0.70', Math.abs(ratio - 0.70) < 0.03, `ratio ${ratio.toFixed(3)}`);
}

// 2. Bank shot via the closed-form bank aim (tan θ' = (et/e)·tan θ): a ground strike aimed
//    at the computed bounce point must land on target with no solver help.
for (const [label, sx, sz, tz, wallSide] of [
  ['bank off far wall', 4, -3, 0.6, -1],
  ['bank off near wall', 6, 4, -0.5, 1],
  ['bank from deep', -2, 5, 0.9, 1],
]) {
  const gx = PITCH.halfL;
  const ba = bankAim(sx, sz, gx, tz, wallSide);
  const speed = 24;
  const b = makeBall(); b.x = sx; b.z = sz; b.y = R;
  b.vx = Math.cos(ba.angle) * speed; b.vz = Math.sin(ba.angle) * speed; b.vy = 0;
  const dx = gx - sx, dz = ba.wz - sz;
  const p = predictPath(b, 4, 1 / 120);
  // where does it cross the goal line?
  let crossZ = null;
  for (let i = 1; i < p.pts.length; i++) {
    const a = p.pts[i - 1], c = p.pts[i];
    if (a.x < gx && c.x >= gx) { const t = (gx - a.x) / (c.x - a.x); crossZ = a.z + (c.z - a.z) * t; break; }
  }
  const walls = p.events.filter(e => e.type === 'wall').length;
  const incidence = ba.incidence * 180 / Math.PI;
  check(`${label}: lands on target`, crossZ !== null && Math.abs(crossZ - tz) < 0.3 && walls === 1 && p.goal === 1,
    `target z=${tz} crossed z=${crossZ?.toFixed(3)} walls=${walls} goal=${p.goal} incidence=${incidence.toFixed(1)}°`);
}

// 2b. A bank keeps most of its pace: 30 m/s at 50° off the normal leaves at ≥ 80%.
{
  const b = makeBall(); b.z = 5; b.x = 0; const th = 50 * Math.PI / 180;
  b.vx = Math.sin(th) * 30; b.vz = Math.cos(th) * 30;
  let out = null, before = 0;
  for (let i = 0; i < 240 && !out; i++) { const ev = []; before = Math.hypot(b.vx, b.vz); stepBall(b, 1 / 240, ev); if (ev.some(e => e.type === 'wall')) out = Math.hypot(b.vx, b.vz); }
  check('bank keeps ≥ 80% of its pace', out / before > 0.8, `${(out / before * 100).toFixed(0)}% kept through the bounce`);
}

// 3. Corner: 45° into the corner at 20 m/s must not zero out.
{
  const b = makeBall(); b.x = 12; b.z = 5; b.vx = 14; b.vz = 14;
  const ev = run(b, 0.6);
  const sp = Math.hypot(b.vx, b.vz);
  check('corner keeps velocity', sp > 5 && b.vx < 0 && b.vz < 0 && ev.filter(e => e.type === 'wall').length >= 2, `speed after ${sp.toFixed(2)} vx ${b.vx.toFixed(2)} vz ${b.vz.toFixed(2)}`);
}

// 4. No tunnelling: 35 m/s straight at a post.
{
  const b = makeBall(); b.x = 10; b.z = PITCH.goalHalfW; b.y = 1; b.vx = 35; b.vy = 0;
  const ev = run(b, 0.3);
  check('35 m/s shot rings off the post', ev.some(e => e.type === 'post') && b.vx < 0 && !b.goal, `vx ${b.vx.toFixed(2)} goal ${b.goal}`);
}

// 5. Crossbar
{
  const b = makeBall(); b.x = 14; b.z = 0; b.y = PITCH.goalH - 0.04; b.vx = 25; b.vy = 0.45;
  const ev = run(b, 0.4);
  check('crossbar hit', ev.some(e => e.type === 'post' && e.kind === 'bar'), '');
}

// 6. Straight shot into the goal counts and is swallowed by the net.
{
  const b = makeBall(); b.x = 8; b.z = 0.4; b.y = 0.5; b.vx = 25; b.vy = 1.5;
  const ev = run(b, 2.0);
  check('goal detected + net absorbs', b.goal === 1 && ev.some(e => e.type === 'goal') && Math.hypot(b.vx, b.vz) < 2 && b.x > PITCH.halfL && b.x < PITCH.halfL + PITCH.goalD,
    `goal ${b.goal} ball x ${b.x.toFixed(2)} speed ${Math.hypot(b.vx, b.vz).toFixed(2)}`);
}

// 7. Wide shot hits the end fence, not a goal.
{
  const b = makeBall(); b.x = 8; b.z = 4; b.vx = 20;
  const ev = run(b, 1.0);
  check('wide shot rebounds off end fence', !b.goal && ev.some(e => e.type === 'wall' && e.nx === -1), `x ${b.x.toFixed(2)}`);
}

// 8. Curl: finesse shot with side spin bends 1.5–4 m over ~20 m.
{
  const b = makeBall(); b.x = -4; b.z = 0; b.y = 0.3; b.vx = 24; b.vy = 2.4; b.wy = 55;
  let zAt = null;
  for (let i = 0; i < 400; i++) { stepBall(b, 1 / 120); if (b.x >= 15 && zAt === null) zAt = b.z; }
  check('finesse curl 1.5–4 m over 19 m', zAt !== null && Math.abs(zAt) > 1.5 && Math.abs(zAt) < 4, `bend ${zAt?.toFixed(2)} m`);
}

// 9. Rolling pass at 12 m/s travels a sensible distance (10–25 m) before stopping.
{
  const b = makeBall(); b.x = -15; b.vx = 12; b.wz = -12 / R;   // struck through the middle: rolling
  run(b, 8);
  check('12 m/s pass rolls 15–22 m', b.x + 15 > 15 && b.x + 15 < 22 && b.vx === 0, `travelled ${(b.x + 15).toFixed(1)} m`);
}

// 10. Lob lands and bounces, doesn't hit the roof at lob speed.
{
  const b = makeBall(); b.x = -10; b.vx = 13 * 0.83; b.vy = 13 * 0.55;
  const ev = run(b, 3);
  const firstBounce = ev.find(e => e.type === 'bounce');
  check('lob lands 12–20 m out, under the roof', firstBounce && firstBounce.x + 10 > 12 && firstBounce.x + 10 < 20 && !ev.some(e => e.type === 'roof'),
    `first bounce at ${(firstBounce?.x + 10).toFixed(1)} m`);
}

// 11. Spin at the bounce: backspin checks a chip up, topspin skids it on.
{
  const land = (wz) => {
    const b = makeBall(); b.x = -10; b.y = 2; b.vx = 9; b.vy = -6; b.wz = wz;
    const ev = [];
    let after = null;
    for (let t = 0; t < 2 && after === null; t += 1 / 120) { stepBall(b, 1 / 120, ev); if (ev.some(e => e.type === 'bounce')) after = b.vx; }
    return after;
  };
  const back = land(40), none = land(0), top = land(-40);
  check('backspin checks up on landing, topspin skids on', back < none && none < top && back < 6, `vx after bounce: backspin ${back.toFixed(1)}, none ${none.toFixed(1)}, topspin ${top.toFixed(1)} (in 9.0)`);
}
// 12. A ball landing without spin grips and ends up rolling (spin matches the roll).
{
  const b = makeBall(); b.x = -10; b.y = 0.6; b.vx = 8;
  run(b, 1.2);
  const slip = Math.abs(b.vx + b.wz * R);
  check('a spinless landing grips into a true roll', slip < 0.1 && b.vx > 2, `vx ${b.vx.toFixed(2)}, slip ${slip.toFixed(3)} m/s`);
}
// 13. Drag crisis: a slow ball loses a bigger share of its speed in the air than a fast one.
{
  const lossPerMetre = (v) => { const b = makeBall(); b.x = -15; b.y = 3; b.vx = v; b.vy = 0; const h = 1 / 240; const x0 = b.x; for (let i = 0; i < 12; i++) stepBall(b, h); return (1 - b.vx / v) / (b.x - x0); };
  const slow = lossPerMetre(7), fast = lossPerMetre(28);
  check('drag crisis: slow balls die, hard shots carry', slow > fast * 1.4, `speed lost per metre: 7 m/s ${(slow * 100).toFixed(2)}%, 28 m/s ${(fast * 100).toFixed(2)}%`);
}

export default results;
