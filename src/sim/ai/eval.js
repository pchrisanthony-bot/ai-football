// Evaluation functions for the AI: interception, threat, and the utility of
// every on-ball option. Kept separate so the debug overlay can show the numbers.
import { KICK, footballGameplayConfig as GP } from '../../config.js';
import { PITCH, isCage, clampToField } from '../pitch.js';
import { clamp, segDist2, angleDiff } from '../../util/math.js';
import { groundPassSpeed, bankAim } from '../kicks.js';
import { maxSpeed } from '../players.js';

// How valuable is it to have the ball at (x, z) for team t? 0 (own goal) .. ~1 (point blank).
export function threat(m, t, x, z) {
  const gx = m.oppGoalX(t);
  const d = Math.hypot(gx - x, z);
  const centrality = 1 - Math.min(1, Math.abs(z) / PITCH.halfW) * 0.35;
  return clamp(1 - d / m.ai.R.threat, 0, 1) ** 1.6 * centrality;
}

// Earliest time player p can reach a point, with reaction delay.
export function reachTime(p, x, z, reaction = 0.2) {
  const d = Math.max(0, Math.hypot(x - p.x, z - p.z) - 0.55);
  const v = maxSpeed(p, true);
  // accelerate from current speed: rough but monotone
  const t0 = Math.max(0, (v - p.speed) / 14);
  const dAcc = (p.speed + v) * 0.5 * t0;
  return reaction + (d <= dAcc ? d / Math.max((p.speed + v) * 0.5, 1) : t0 + (d - dAcc) / v);
}

// Risk that any opponent cuts out a ball travelling along a polyline.
// ballTimeAt(s) gives when the ball reaches arc length s.
export function laneRisk(m, team, path, ballTimeAt, ignore = null, reach = 0.6, reaction = 0.18) {
  let risk = 0, worst = null;
  let s0 = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i], B = path[i + 1];
    const segLen = Math.hypot(B.x - A.x, B.z - A.z);
    for (const o of m.players) {
      if (!o.active || o.team === team || o === ignore) continue;
      const { d, t } = segDist2(o.x, o.z, A.x, A.z, B.x, B.z);
      if (d > 7) continue;
      const s = s0 + t * segLen;
      if (s < 0.25) continue;                  // behind the ball at the kicker's feet
      const tb = ballTimeAt(s);
      const px = A.x + (B.x - A.x) * t, pz = A.z + (B.z - A.z) * t;
      const to = reachTime(o, px, pz, reaction) - reach / 6;
      const r = clamp(0.5 + (tb - to) / 0.35, 0, 1) * (o.line === 'GK' ? 0.8 : 1);
      if (r > risk) { risk = r; worst = o; }
    }
    s0 += segLen;
  }
  return { risk, worst };
}

const pathLen = path => path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) : 0), 0);

// ---------------------------------------------------------------- keeper model
// Can the keeper get to any point of the path near his goal before the ball does?
// Reaction starts at the strike — or at the bounce, for a ball banked off the cage.
export function keeperSave(m, gk, path, bt, bank) {
  const gx = m.ownGoalX(gk.team), box = m.ai.R.keeperBox;
  const leg1 = Math.hypot(path[1].x - path[0].x, path[1].z - path[0].z);
  const t0 = bank ? bt(leg1) : 0;
  const react = 0.17 + (1 - gk.attrs.keeping) * 0.12 + (bank ? 0.13 : 0);
  let best = 0.03, s0 = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i], B = path[i + 1];
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    for (let k = 0; k <= 12; k++) {
      const u = k / 12, x = A.x + (B.x - A.x) * u, z = A.z + (B.z - A.z) * u;
      if (Math.abs(x - gx) > box.x || Math.abs(z) > box.z) continue;
      const tb = bt(s0 + L * u);
      if (bank && tb < t0) continue;
      const move = Math.max(0, Math.hypot(x - gk.x, z - gk.z) - 1.05);
      const tg = t0 + react + move / (bank ? 4.8 : 5.2);
      best = Math.max(best, clamp(0.5 + (tb - tg) * 2.4, 0.02, m.ai.R.saveMax));
    }
    s0 += L;
  }
  return best;
}

// ---------------------------------------------------------------- shooting
export function evalShots(m, p) {
  const b = m.ball, t = p.team, gx = m.oppGoalX(t), dir = m.teams[t].dir;
  const R = m.ai.R;
  const dGoal = Math.hypot(gx - b.x, b.z);
  if (dGoal > R.shot) return null;
  const gk = m.keeper(1 - t);
  const speed = (KICK.shotMin + (KICK.shotMax - KICK.shotMin) * 0.88) * (0.86 + 0.16 * p.attrs.shot);
  // Ball time along a path; after a cage bounce the ball keeps ~85% of its speed.
  const btFor = (path) => {
    const leg1 = Math.hypot(path[1].x - path[0].x, path[1].z - path[0].z);
    return s => (path.length < 3 || s <= leg1) ? s / (speed * 0.9) : leg1 / (speed * 0.9) + (s - leg1) / (speed * 0.9 * 0.85);
  };
  const out = [];
  for (const tz of R.shotZ) {
    const tgt = { x: gx, z: tz };
    const options = [{ path: [{ x: b.x, z: b.z }, tgt], bank: 0 }];
    for (const w of isCage() ? [-1, 1] : []) {                 // banks need the cage
      const ba = bankAim(b.x, b.z, gx, tz, w);
      const bx = ba.bounceX;
      if ((bx - b.x) * dir < 1.5 || (gx - bx) * dir < 1.5) continue;
      if (ba.incidence > 1.15) continue;                        // > ~66° from the wall normal: too glancing
      options.push({ path: [{ x: b.x, z: b.z }, { x: bx, z: ba.wz }, tgt], bank: w, angle: ba.angle, keep: ba.keep });
    }
    for (const o of options) {
      const L = pathLen(o.path);
      if (L > (o.bank ? 28 : R.shot)) continue;
      const bt = btFor(o.path);
      const { risk } = laneRisk(m, t, o.path, bt, gk, 0.5, 0.15);
      const save = gk ? keeperSave(m, gk, o.path, bt, !!o.bank) : 0.03;
      // Visible angle of the goal from the shooter.
      const openAngle = Math.abs(Math.atan2(PITCH.goalHalfW, Math.abs(gx - b.x))) * (1 - Math.abs(b.z) / (PITCH.halfW + 4));
      const base = clamp(Math.exp(-(L - 5) / R.shotFade) * (0.55 + openAngle * 1.2), 0, 1) * (o.bank ? 0.97 : 1);
      const xg = base * (1 - risk) * (1 - save);
      // Banks are the specialist option: slightly discounted for execution risk.
      out.push({ kind: 'shoot', tz, bank: o.bank, angle: o.angle, path: o.path, xg, u: xg * 1.9 * (o.bank ? 0.95 : 1), label: o.bank ? 'BANK SHOT' : 'SHOOT' });
    }
  }
  out.sort((a, c) => c.u - a.u);
  // Don't hoof hopeless shots — below this it's better to keep the ball.
  return out[0] && out[0].xg >= m.ai.R.minXg ? out[0] : null;
}

// ---------------------------------------------------------------- passing
export function evalPasses(m, p, runners = new Set()) {
  const b = m.ball, t = p.team, R = m.ai.R;
  const here = threat(m, t, b.x, b.z);
  const out = [];
  for (const r of m.mates(p)) {
    if (r.line === 'GK') continue;
    // A man in an offside position (as this side reads the line) is a free kick waiting to happen.
    const off = m.offside.aiReadsOffside(r) ? GP.offside.aiPassPenalty : 0;
    if (!isCage()) { const lob = evalLongBall(m, p, r, here); if (lob) { lob.u -= off; lob.offside = !!off; out.push(lob); } }
    const lead = m.leadTarget(p, r, runners.has(r));
    const through = runners.has(r);
    const d = Math.hypot(lead.x - b.x, lead.z - b.z);
    if (d < 3 || d > R.groundPass) continue;
    const s = clamp(groundPassSpeed(d, through ? 7 : 6 + d * 0.2), KICK.passMin, KICK.passMax);
    const bt = x => x / Math.max(s * 0.75, 3);
    let { risk } = laneRisk(m, t, [{ x: b.x, z: b.z }, lead], bt, null, 0.6, 0.2);
    let open = 99;
    for (const o of m.opponents(p)) open = Math.min(open, Math.hypot(o.x - lead.x, o.z - lead.z));
    // Race to the landing spot: does a defender get there before our receiver?
    const tArrive = bt(d);
    const tMate = Math.max(tArrive, reachTime(r, lead.x, lead.z, 0.1));
    let tOpp = Infinity;
    for (const o of m.opponents(p)) tOpp = Math.min(tOpp, reachTime(o, lead.x, lead.z, 0.2));
    risk = Math.max(risk, clamp(0.5 + (tMate - tOpp) / 0.4, 0, 1));
    const value = threat(m, t, lead.x, lead.z) + clamp(open / 6, 0, 1) * 0.12;
    const ok = 1 - risk;
    const u = ok * value - (1 - ok) * 0.3 - here * 0.5 + 0.04;
    out.push({ kind: through ? 'through' : 'pass', r, lead, risk, u: u - off, offside: !!off, label: through ? 'THROUGH BALL' : 'PASS', path: [{ x: b.x, z: b.z }, lead] });

    // Wall pass: bank it off the cage around a blocker (street football's 1-2 with the wall).
    if (risk > 0.35 && isCage()) {
      const wSide = r.z + b.z > 0 ? 1 : -1;
      const ba = bankAim(b.x, b.z, lead.x, lead.z, wSide);
      const bx = ba.bounceX, wz = ba.wz;
      const tt = (bx - b.x) / ((lead.x - b.x) || 1e-3);
      if (tt > 0.15 && tt < 0.85) {
        const path = [{ x: b.x, z: b.z }, { x: bx, z: wz }, lead];
        const L = pathLen(path);
        if (L < 26) {
          const sp = 14;
          const btw = x => (x < Math.hypot(bx - b.x, wz - b.z) ? x / (sp * 0.9) : x / (sp * 0.72));
          const wr = laneRisk(m, t, path, btw, null, 0.6, 0.2).risk;
          const ok2 = 1 - wr;
          const u2 = ok2 * value - (1 - ok2) * 0.3 - here * 0.55 + 0.05;
          out.push({ kind: 'wallpass', r, lead, risk: wr, u: u2 - off, label: 'WALL PASS', path, angle: ba.angle, speed: sp });
        }
      }
    }
  }
  out.sort((a, c) => c.u - a.u);
  return out;
}

// A lofted pass (open pitches): over the lane, so only the landing spot can be fought
// for — a race between the receiver and the nearest defender to where it comes down.
// Long balls switch play and go in behind; a slight discount for the harder control.
function evalLongBall(m, p, r, here) {
  const b = m.ball, R = m.ai.R;
  const d0 = Math.hypot(r.x - b.x, r.z - b.z);
  if (d0 < 14 || d0 > R.longPass) return null;
  const flight = 0.9 + d0 / 20;                               // s in the air (a ~0.55-elevation lob)
  const lead = clampToField(r.x + r.vx * flight * 0.8, r.z + r.vz * flight * 0.8, 1.5);
  const tMate = Math.max(flight, reachTime(r, lead.x, lead.z, 0.1));
  let tOpp = Infinity;
  for (const o of m.opponents(p)) tOpp = Math.min(tOpp, reachTime(o, lead.x, lead.z, 0.25));
  const risk = clamp(0.5 + (tMate - tOpp) / 0.5, 0, 1);
  let open = 99;
  for (const o of m.opponents(p)) open = Math.min(open, Math.hypot(o.x - lead.x, o.z - lead.z));
  const value = threat(m, p.team, lead.x, lead.z) + clamp(open / 8, 0, 1) * 0.12;
  const ok = 1 - risk;
  const u = ok * value - (1 - ok) * 0.3 - here * 0.5 - 0.02;
  return { kind: 'lob', r, lead, risk, u, label: 'LONG BALL', path: [{ x: b.x, z: b.z }, lead] };
}

// ---------------------------------------------------------------- dribbling
export function evalDribble(m, p) {
  const t = p.team, dir = m.teams[t].dir;
  const gx = m.oppGoalX(t);
  const toGoal = Math.atan2(-p.z, gx - p.x);
  const here = threat(m, t, p.x, p.z);
  let best = null;
  for (const off of [0, -0.5, 0.5, -1.0, 1.0, -1.5, 1.5]) {
    const ang = toGoal + off;
    const L = 3.5;
    let tx = p.x + Math.cos(ang) * L, tz = p.z + Math.sin(ang) * L;
    if (Math.abs(tz) > PITCH.halfW - 0.8 || Math.abs(tx) > PITCH.halfL - 0.8) continue;
    let space = 99;
    for (const o of m.opponents(p)) {
      if (o.line === 'GK' && Math.hypot(o.x - tx, o.z - tz) > 3) continue;
      space = Math.min(space, segDist2(o.x, o.z, p.x, p.z, tx, tz).d);
    }
    const prog = threat(m, t, tx, tz) - here;
    const u = prog * 1.5 + clamp(space / 3.5, 0, 1) * 0.16 - (space < 1.5 ? 0.45 : 0) + (off === 0 ? 0.02 : 0);
    if (!best || u > best.u) best = { kind: 'dribble', angle: ang, u, space, label: 'DRIBBLE' };
  }
  return best;
}

// Nearest opponent roughly in front of p (for skills / pannas).
export function frontDefender(m, p, maxD = 2.8, cone = 0.9) {
  let best = null, bd = maxD;
  for (const d of m.opponents(p)) {
    if (d.line === 'GK') continue;
    const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > bd) continue;
    if (Math.abs(angleDiff(p.facing, Math.atan2(dz, dx))) > cone) continue;
    bd = dist; best = d;
  }
  return best ? { d: best, dist: bd } : null;
}

export function pressure(m, p) {
  let d = 99;
  for (const o of m.opponents(p)) d = Math.min(d, Math.hypot(o.x - p.x, o.z - p.z));
  return d;
}
