// =====================================================================
// 🔒 BALL PHYSICS — 3D, substepped, frame-rate independent.
// Gravity + quadratic drag + Magnus curl in the air; bounce → roll on the ground.
// Cage walls: reflect about the normal (v' = v − 2(v·n)n) with the research-
// validated restitution e = 0.70 applied to the NORMAL component (that's what a
// coefficient of restitution is) and light friction on the tangential component.
// A 30 m/s strike at 50° leaves the mesh at ~26 m/s — that's why cage banks bite.
// =====================================================================
import { BALL, COURT } from '../config.js';

const R = BALL.r;
const { halfL, halfW, roofH, goalHalfW, goalH, goalD, postR, boardH } = COURT;

export function makeBall() {
  return {
    x: 0, y: R, z: 0,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,       // spin (rad/s)
    goal: 0,                   // +1 = in the +x goal, −1 = in the −x goal
  };
}

export function copyBall(b) {
  return { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, wx: b.wx, wy: b.wy, wz: b.wz, goal: b.goal };
}

export const ballSpeed = b => Math.hypot(b.vx, b.vy, b.vz);
export const ballSpeed2 = b => Math.hypot(b.vx, b.vz);
export const onGround = b => b.y <= R + 0.02 && Math.abs(b.vy) < 0.3;

// Reflect about unit normal n: normal component × −e, tangential component × et.
function reflect(b, nx, ny, nz, e, et = e) {
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return 0;
  const tx = b.vx - vn * nx, ty = b.vy - vn * ny, tz = b.vz - vn * nz;
  b.vx = tx * et - vn * e * nx;
  b.vy = ty * et - vn * e * ny;
  b.vz = tz * et - vn * e * nz;
  return -vn;
}

// Sphere vs capsule segment (posts / crossbar).
function collideSegment(b, ax, ay, az, bx, by, bz, ev, kind) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = ((b.x - ax) * dx + (b.y - ay) * dy + (b.z - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
  let nx = b.x - px, ny = b.y - py, nz = b.z - pz;
  const d = Math.hypot(nx, ny, nz), rr = R + postR;
  if (d >= rr || d < 1e-9) return;
  nx /= d; ny /= d; nz /= d;
  b.x = px + nx * rr; b.y = py + ny * rr; b.z = pz + nz * rr;
  const imp = reflect(b, nx, ny, nz, BALL.postE, 0.95);
  if (imp > 0.5) {
    b.wx *= 0.5; b.wy *= 0.5; b.wz *= 0.5;
    ev && ev.push({ type: 'post', x: px, y: py, z: pz, speed: imp, kind });
  }
}

function integrate(b, h, ev) {
  const grounded = b.y <= R + 1e-4 && Math.abs(b.vy) < BALL.bounceMinVy;

  if (grounded) {
    // Rolling: constant + linear resistance, no Magnus.
    b.y = R; b.vy = 0;
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const dec = (BALL.rollDecel + BALL.rollLinear * sp) * h;
      const k = sp > dec ? (sp - dec) / sp : 0;
      b.vx *= k; b.vz *= k;
    }
    const sd = Math.exp(-BALL.spinDecayGround * h);
    b.wx *= sd; b.wy *= sd; b.wz *= sd;
  } else {
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const kd = BALL.drag * sp;
    const S = BALL.magnus;
    // ω × v
    const mx = b.wy * b.vz - b.wz * b.vy;
    const my = b.wz * b.vx - b.wx * b.vz;
    const mz = b.wx * b.vy - b.wy * b.vx;
    b.vx += (-kd * b.vx + S * mx) * h;
    b.vy += (-BALL.gravity - kd * b.vy + S * my) * h;
    b.vz += (-kd * b.vz + S * mz) * h;
    const sd = Math.exp(-BALL.spinDecayAir * h);
    b.wx *= sd; b.wy *= sd; b.wz *= sd;
  }

  b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;

  // --- ground
  if (b.y < R) {
    b.y = R;
    if (b.vy < 0) {
      const vy = -b.vy;
      if (vy > BALL.bounceMinVy) {
        b.vy = vy * BALL.groundE;
        b.vx *= BALL.groundGrip; b.vz *= BALL.groundGrip;
        b.wx *= 0.7; b.wy *= 0.7; b.wz *= 0.7;
        ev && ev.push({ type: 'bounce', x: b.x, y: 0, z: b.z, speed: vy });
      } else b.vy = 0;
    }
  }

  // --- roof net
  if (b.y > roofH - R) {
    b.y = roofH - R;
    const imp = reflect(b, 0, -1, 0, BALL.roofE, 0.8);
    if (imp > 1) ev && ev.push({ type: 'roof', x: b.x, y: roofH, z: b.z, speed: imp });
  }

  // --- side walls (full length, full height) 🔒
  if (b.z > halfW - R) {
    b.z = halfW - R;
    const imp = reflect(b, 0, 0, -1, BALL.wallE, BALL.wallT);
    if (imp > 0.3) { b.wy *= 0.4; ev && ev.push({ type: 'wall', x: b.x, y: b.y, z: halfW, nx: 0, nz: -1, speed: imp, board: b.y < boardH }); }
  } else if (b.z < -halfW + R) {
    b.z = -halfW + R;
    const imp = reflect(b, 0, 0, 1, BALL.wallE, BALL.wallT);
    if (imp > 0.3) { b.wy *= 0.4; ev && ev.push({ type: 'wall', x: b.x, y: b.y, z: -halfW, nx: 0, nz: 1, speed: imp, board: b.y < boardH }); }
  }

  // --- end walls, goals, posts
  for (let s = -1; s <= 1; s += 2) {
    const lineX = s * halfL;
    const past = (b.x - lineX) * s;                 // >0 = centre beyond the goal line
    const inMouthZ = Math.abs(b.z) < goalHalfW;
    const inGoal = past > 0 && Math.abs(b.z) < goalHalfW + R && b.y < goalH + R;

    if (inGoal) {
      // Goal counts once the whole ball is over the line inside the frame.
      if (!b.goal && past > R && inMouthZ && b.y < goalH) {
        b.goal = s;
        ev && ev.push({ type: 'goal', side: s, x: b.x, y: b.y, z: b.z, speed: Math.hypot(b.vx, b.vy, b.vz) });
      }
      // Net box: back, sides, top — soft and absorbing.
      let hit = 0;
      if (past > goalD - R) { b.x = s * (halfL + goalD - R); hit = Math.max(hit, reflect(b, -s, 0, 0, BALL.netE)); }
      if (b.z > goalHalfW - R) { b.z = goalHalfW - R; hit = Math.max(hit, reflect(b, 0, 0, -1, BALL.netE)); }
      if (b.z < -goalHalfW + R) { b.z = -goalHalfW + R; hit = Math.max(hit, reflect(b, 0, 0, 1, BALL.netE)); }
      if (b.y > goalH - R) { b.y = goalH - R; hit = Math.max(hit, reflect(b, 0, -1, 0, BALL.netE)); }
      if (past > R) {
        const d = Math.exp(-BALL.netDamp * h);
        b.vx *= d; b.vz *= d;
      }
      if (hit > 0.8) ev && ev.push({ type: 'net', side: s, x: b.x, y: b.y, z: b.z, speed: hit });
    } else if (past > -R) {
      // End wall (fence) everywhere except the goal mouth.
      const inMouth = inMouthZ && b.y < goalH;
      if (!inMouth) {
        b.x = s * (halfL - R);
        const imp = reflect(b, -s, 0, 0, BALL.wallE, BALL.wallT);
        if (imp > 0.3) { b.wy *= 0.4; ev && ev.push({ type: 'wall', x: lineX, y: b.y, z: b.z, nx: -s, nz: 0, speed: imp, board: b.y < boardH }); }
      }
    }

    // Posts and crossbar (only test when close — cheap early-out).
    if (Math.abs(b.x - lineX) < 0.5 && Math.abs(b.z) < goalHalfW + 0.5 && b.y < goalH + 0.5) {
      collideSegment(b, lineX, 0, goalHalfW, lineX, goalH, goalHalfW, ev, 'post');
      collideSegment(b, lineX, 0, -goalHalfW, lineX, goalH, -goalHalfW, ev, 'post');
      collideSegment(b, lineX, goalH, -goalHalfW, lineX, goalH, goalHalfW, ev, 'bar');
    }
  }
}

// Advance the free ball by dt. Substeps keep each move ≤ 5 cm, so a 35 m/s
// strike can't tunnel through a 5 cm post.
export function stepBall(b, dt, ev) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  const n = Math.max(1, Math.ceil((sp * dt) / 0.05));
  const h = dt / n;
  for (let i = 0; i < n; i++) integrate(b, h, ev);
  if (b.y <= R + 1e-4 && Math.hypot(b.vx, b.vz) < 0.03) { b.vx = 0; b.vz = 0; }
}

// Run the same integrator ahead of time. Used by the aim preview and the AI.
export function predictPath(start, seconds, step = 1 / 60) {
  const b = copyBall(start);
  b.goal = 0;
  const pts = [{ x: b.x, y: b.y, z: b.z }];
  const events = [];
  let goal = 0, t = 0;
  while (t < seconds) {
    const ev = [];
    stepBall(b, step, ev);
    t += step;
    for (const e of ev) { e.t = t; events.push(e); if (e.type === 'goal') goal = e.side; }
    pts.push({ x: b.x, y: b.y, z: b.z });
    if (goal) break;
    if (b.vx === 0 && b.vz === 0 && b.y <= R + 1e-3) break;
  }
  return { pts, events, goal, end: b };
}
