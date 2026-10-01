// =====================================================================
// 🔒 BALL PHYSICS — 3D, substepped, frame-rate independent.
// Gravity + quadratic drag + Magnus curl in the air; bounce → roll on the ground.
// Cage walls: reflect about the normal (v' = v − 2(v·n)n) with the research-
// validated restitution e = 0.70 applied to the NORMAL component (that's what a
// coefficient of restitution is) and light friction on the tangential component.
// A 30 m/s strike at 50° leaves the mesh at ~26 m/s — that's why cage banks bite.
// Open pitches have no walls: the ball goes out of play (swept, see lineCrossing) and
// runs on into the run-off until the advertising boards stop it.
// =====================================================================
import { BALL } from '../config.js';
import { PITCH, lineCrossing } from './pitch.js';

const R = BALL.r;

export function makeBall() {
  return {
    x: 0, y: R, z: 0,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,       // spin (rad/s)
    goal: 0,                   // +1 = in the +x goal, −1 = in the −x goal
    net: 0,                    // ±1 while inside that goal (entered through the mouth)
    out: false,                // wholly over a line (open pitches)
  };
}

export function copyBall(b) {
  return { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, wx: b.wx, wy: b.wy, wz: b.wz, goal: b.goal, net: b.net || 0, out: !!b.out };
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

// A wall mirrors the ball's roll/topspin the same way it mirrors the velocity (the
// spin tied to the normal component flips and scales by e, the rest by et), so a
// ball that was rolling into the mesh leaves rolling along its new line instead of
// curling off on the next bounce. nx/nz: the wall's horizontal normal.
function mirrorSpin(b, nx, nz) {
  if (nz !== 0) { b.wx *= -BALL.wallE; b.wz *= BALL.wallT; }
  else { b.wz *= -BALL.wallE; b.wx *= BALL.wallT; }
  b.wy *= 0.4;
}

// Sphere vs capsule segment (posts / crossbar).
function collideSegment(b, ax, ay, az, bx, by, bz, ev, kind) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = ((b.x - ax) * dx + (b.y - ay) * dy + (b.z - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
  let nx = b.x - px, ny = b.y - py, nz = b.z - pz;
  const d = Math.hypot(nx, ny, nz), rr = R + PITCH.postR;
  if (d >= rr || d < 1e-9) return;
  nx /= d; ny /= d; nz /= d;
  b.x = px + nx * rr; b.y = py + ny * rr; b.z = pz + nz * rr;
  const imp = reflect(b, nx, ny, nz, BALL.postE, 0.95);
  if (imp > 0.5) {
    b.wx *= 0.5; b.wy *= 0.5; b.wz *= 0.5;
    ev && ev.push({ type: 'post', x: px, y: py, z: pz, speed: imp, kind });
  }
}

// Drag coefficient through the drag crisis: high below ~8 m/s, low above ~14 m/s.
function dragK(sp) {
  const t = Math.min(1, Math.max(0, (sp - BALL.crisisLo) / (BALL.crisisHi - BALL.crisisLo)));
  return BALL.dragLow + (BALL.drag - BALL.dragLow) * t * t * (3 - 2 * t);
}

// Friction impulse J (per unit mass, ≤ jmax) at the ground contact, opposing the slip
// of the contact point. The ball is a hollow shell (I = ⅔mR²), so an impulse J changes
// the slip by 2.5·J: backspin checks a ball up, topspin makes it skid on, and a
// spinless landing grips and starts to roll.
function contactFriction(b, jmax) {
  const sx = b.vx + b.wz * R, sz = b.vz - b.wx * R;
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-6) return 0;
  const J = Math.min(jmax, sl / 2.5);
  const jx = -sx / sl * J, jz = -sz / sl * J;
  b.vx += jx; b.vz += jz;
  b.wz += 1.5 * jx / R; b.wx -= 1.5 * jz / R;
  return sl - 2.5 * J;
}

// The goal's net box from OUTSIDE (open pitches: a ball wide of the post into the side
// netting, over the bar onto the roof of the net, or round the back). The front face is
// the mouth, so only a ball already behind the goal line can touch it.
function netOutside(b, s, lineX, ev) {
  const { goalHalfW, goalH, goalD } = PITCH;
  const px = (b.x - lineX) * s;                       // depth behind the goal line
  if (px <= 0 || px > goalD + R || Math.abs(b.z) > goalHalfW + R || b.y > goalH + R) return;
  const cx = Math.min(goalD, px), cz = Math.max(-goalHalfW, Math.min(goalHalfW, b.z)), cy = Math.min(goalH, b.y);
  const dx = px - cx, dy = b.y - cy, dz = b.z - cz, d = Math.hypot(dx, dy, dz);
  if (d >= R) return;
  // Outward normal of the face it touches (box frame: x = depth behind the line).
  let nx = 0, ny = 0, nz = 0, qx = cx, qy = cy, qz = cz;
  if (d > 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d; }
  else {
    // Centre inside the box (it never came through the mouth): out by the nearest face.
    const side = goalHalfW - Math.abs(b.z), top = goalH - b.y, back = goalD - px;
    if (side <= top && side <= back) { nz = Math.sign(b.z) || 1; qz = nz * goalHalfW; }
    else if (top <= back) { ny = 1; qy = goalH; }
    else { nx = 1; qx = goalD; }
  }
  // Rest it against the net, then let the net take the pace off it.
  b.x = lineX + s * (qx + nx * R); b.y = qy + ny * R; b.z = qz + nz * R;
  const hit = reflect(b, s * nx, ny, nz, BALL.netE, 0.5);
  if (hit > 0.8) ev && ev.push({ type: 'net', side: s, x: b.x, y: b.y, z: b.z, speed: hit, outside: true });
}

// Advertising boards round the run-off (open pitches): the ball stops there.
function boards(b, ev) {
  const { halfL, halfW, runoff, boardH } = PITCH;
  if (b.y > boardH + R) return;
  const bx = halfL + runoff, bz = halfW + runoff;
  let nx = 0, nz = 0;
  if (b.z > bz - R) { b.z = bz - R; nz = -1; } else if (b.z < -bz + R) { b.z = -bz + R; nz = 1; }
  if (b.x > bx - R) { b.x = bx - R; nx = -1; } else if (b.x < -bx + R) { b.x = -bx + R; nx = 1; }
  if (!nx && !nz) return;
  const imp = reflect(b, nx, 0, nz, BALL.wallE, BALL.wallT);
  if (imp > 0) mirrorSpin(b, nx, nz);
  if (imp > 0.3) ev && ev.push({ type: 'board', x: b.x, y: b.y, z: b.z, nx, nz, speed: imp });
}

function integrate(b, h, ev) {
  const { halfL, halfW, roofH, goalHalfW, goalH, goalD, boardH } = PITCH;
  const cage = PITCH.boundary === 'cage';
  const x0 = b.x, y0 = b.y, z0 = b.z;
  const grounded = b.y <= R + 1e-4 && Math.abs(b.vy) < BALL.bounceMinVy;

  if (grounded) {
    b.y = R; b.vy = 0;
    // Skid until the contact point stops slipping, then roll.
    const slip = contactFriction(b, BALL.slideMu * BALL.gravity * h);
    // Rolling resistance: constant + linear, no Magnus.
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0) {
      const dec = (BALL.rollDecel + BALL.rollLinear * sp) * h;
      const k = sp > dec ? (sp - dec) / sp : 0;
      b.vx *= k; b.vz *= k;
    }
    if (slip < 0.05) { b.wx = b.vz / R; b.wz = -b.vx / R; }   // rolling: spin matches the roll
    b.wy *= Math.exp(-BALL.spinDecayGround * h);            // side spin scrubs off quickly
  } else {
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const kd = dragK(sp) * sp;
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
        contactFriction(b, BALL.bounceMu * (1 + BALL.groundE) * vy);
        b.wy *= 0.8;
        ev && ev.push({ type: 'bounce', x: b.x, y: 0, z: b.z, speed: vy });
      } else b.vy = 0;
    }
  }

  // --- roof net (cage)
  if (cage && b.y > roofH - R) {
    b.y = roofH - R;
    const imp = reflect(b, 0, -1, 0, BALL.roofE, 0.8);
    if (imp > 1) ev && ev.push({ type: 'roof', x: b.x, y: roofH, z: b.z, speed: imp });
  }

  // --- side walls (cage: full length, full height) 🔒
  if (cage && b.z > halfW - R) {
    b.z = halfW - R;
    const imp = reflect(b, 0, 0, -1, BALL.wallE, BALL.wallT);
    if (imp > 0) mirrorSpin(b, 0, -1);
    if (imp > 0.3) { ev && ev.push({ type: 'wall', x: b.x, y: b.y, z: halfW, nx: 0, nz: -1, speed: imp, board: b.y < boardH }); }
  } else if (cage && b.z < -halfW + R) {
    b.z = -halfW + R;
    const imp = reflect(b, 0, 0, 1, BALL.wallE, BALL.wallT);
    if (imp > 0) mirrorSpin(b, 0, 1);
    if (imp > 0.3) { ev && ev.push({ type: 'wall', x: b.x, y: b.y, z: -halfW, nx: 0, nz: 1, speed: imp, board: b.y < boardH }); }
  }

  // --- goals (mouth, net, posts) and the cage's end walls
  for (let s = -1; s <= 1; s += 2) {
    const lineX = s * halfL;
    const past = (b.x - lineX) * s, past0 = (x0 - lineX) * s;   // >0 = centre beyond the goal line
    // Into the goal through the mouth: the centre crosses the line between the posts, under the bar.
    if (b.net !== s && past0 <= 0 && past > 0) {
      const t = -past0 / (past - past0), zc = z0 + (b.z - z0) * t, yc = y0 + (b.y - y0) * t;
      if (Math.abs(zc) < goalHalfW && yc < goalH) b.net = s;
    }
    if (b.net === s && past < -R) b.net = 0;        // back out into the field (off the inside of a post)

    if (b.net === s) {
      // Goal counts once the whole ball is over the line inside the frame.
      if (!b.goal && past > R) {
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
    } else if (!cage) netOutside(b, s, lineX, ev);
    else if (past > -R) {
      // End wall (fence) everywhere except the goal mouth.
      const inMouth = Math.abs(b.z) < goalHalfW && b.y < goalH;
      if (!inMouth) {
        b.x = s * (halfL - R);
        const imp = reflect(b, -s, 0, 0, BALL.wallE, BALL.wallT);
        if (imp > 0) mirrorSpin(b, -s, 0);
        if (imp > 0.3) { ev && ev.push({ type: 'wall', x: lineX, y: b.y, z: b.z, nx: -s, nz: 0, speed: imp, board: b.y < boardH }); }
      }
    }

    // Posts and crossbar (only test when close — cheap early-out).
    if (Math.abs(b.x - lineX) < 0.5 && Math.abs(b.z) < goalHalfW + 0.5 && b.y < goalH + 0.5) {
      collideSegment(b, lineX, 0, goalHalfW, lineX, goalH, goalHalfW, ev, 'post');
      collideSegment(b, lineX, 0, -goalHalfW, lineX, goalH, -goalHalfW, ev, 'post');
      collideSegment(b, lineX, goalH, -goalHalfW, lineX, goalH, goalHalfW, ev, 'bar');
    }
  }

  if (!cage) {
    // Out of play: the whole ball over a line (a ball that went in through the mouth is a goal).
    if (!b.out) {
      const c = lineCrossing(x0, z0, b.x, b.z, R);
      if (c && !(c.line === 'goal' && b.net === c.side)) {
        b.out = true;
        ev && ev.push({ type: 'out', line: c.line, side: c.side, x: c.x, z: c.z, y: y0 + (b.y - y0) * c.t });
      }
    }
    boards(b, ev);
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
  b.out = false;
  const pts = [{ x: b.x, y: b.y, z: b.z }];
  const events = [];
  let goal = 0, out = null, t = 0;
  while (t < seconds) {
    const ev = [];
    stepBall(b, step, ev);
    t += step;
    for (const e of ev) { e.t = t; events.push(e); if (e.type === 'goal') goal = e.side; if (e.type === 'out' && !out) out = e; }
    pts.push({ x: b.x, y: b.y, z: b.z });
    if (goal || out) break;
    if (b.vx === 0 && b.vz === 0 && b.y <= R + 1e-3) break;
  }
  return { pts, events, goal, out, end: b };
}
