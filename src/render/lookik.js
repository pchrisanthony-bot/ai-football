// =====================================================================
// Look IK: where a player looks, and how. Eyes first, head second.
//
//   target   by priority — the man he's passing to as he winds up, the goal before a
//            shot, an opponent closing him down, his receiving point's ball (with a
//            little look-ahead: where it's going, not where it is), and off the ball
//            the ball, broken by short scans (his man, a team-mate, the goal) the way a
//            footballer checks his shoulder.
//   motion   the eyes jump to the target fast (a saccade, ±35° / ±20°); the head turns
//            after them, slower, within ±60° / ±35° of the chest; once the head arrives
//            the eyes recentre. The neck takes part of the head's turn (the body model
//            splits it), the upper spine a little (spineShare).
// All angles are relative to the chest: yaw + = to his left, pitch + = down.
// No three.js here (testable headless); athlete.js feeds it and poses the bones.
// =====================================================================
import { footballMovementConfig as FM } from '../config.js';
import { clamp, wrapAngle } from '../util/math.js';

const L = FM.lookIK;

export class LookIK {
  constructor(seed = 1) {
    this.s = (seed * 2654435761) >>> 0 || 1;
    this.gaze = { yaw: 0, pitch: 0.3 };     // where the eyes point (chest frame)
    this.head = { yaw: 0, pitch: 0.2 };
    this.eye = { yaw: 0, pitch: 0 };        // eyes relative to the head
    this.scan = null;                       // { until, kind }
    this.nextScan = 1 + this.rand() * 2;
    this.target = null;                     // { x, y, z, why }
    this.recvT = -1;
  }

  rand() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }

  // ------------------------------------------------------------------ what he looks at
  pick(p, m, b, t) {
    const at = (x, y, z, why) => ({ x, y, z, why });
    const ahead = (k = 1) => {
      const la = L.lookAheadTime * k;
      return b.owner ? at(b.x, b.y, b.z, 'ball') : at(b.x + b.vx * la, Math.max(0.05, b.y + b.vy * la), b.z + b.vz * la, 'ball');
    };
    if (!m || m.phase === 'restart' && !(m.restart && m.restart.taker === p)) return ahead();
    const a = p.action;
    // About to strike it: the man he's passing to / the goal.
    if (a && !a.fired) {
      if ((a.type === 'pass' || a.type === 'through' || a.type === 'lob') && a.receiver) return at(a.receiver.x, 1.0, a.receiver.z, 'pass target');
      if (a.type === 'shot' || a.type === 'volley') return at(m.oppGoalX(p.team), 0.9, a.aim && a.aim.tz != null ? a.aim.tz : 0, 'goal');
    }
    if (a && a.fired && (a.type === 'shot' || a.type === 'pass' || a.type === 'through')) return ahead();
    if (p.line === 'GK') return ahead(0.6);
    // Scans: short checks of what's around him, between long looks at the ball.
    if (this.scan && t > this.scan.until) this.scan = null;
    const near = nearest(m, p);
    // On the ball: mostly the ball at his feet; head up now and then (the next pass, the
    // goal); a man closing him down gets a glance.
    if (b.owner === p) {
      if (!this.scan && t > this.nextScan) this.startScan(t, near && near.d < 2.4 ? 'opponent' : 'option');
      if (this.scan) {
        if (this.scan.kind === 'opponent' && near) return at(near.q.x, 1.2, near.q.z, 'pressure');
        const opt = bestOption(m, p);
        return opt ? at(opt.x, 1.0, opt.z, 'scan: option') : at(m.oppGoalX(p.team), 1.0, 0, 'scan: goal');
      }
      // the ball, a little ahead of it along his run (a dribbler's eyes lead the ball)
      return at(b.x + Math.cos(p.heading) * Math.min(1.5, p.speed * 0.25), 0.1, b.z + Math.sin(p.heading) * Math.min(1.5, p.speed * 0.25), 'ball');
    }
    // A pass on its way to him: a glance at who's on him as he reads it, then the ball.
    const P = p.recv;
    if (P && P.receiver === p && (P.state === 'ANTICIPATING' || P.state === 'RECEIVING')) {
      if (this.recvT < 0) { this.recvT = t; if (near && near.d < 5) this.scan = { until: t + 0.3, kind: 'opponent' }; }
      if (this.scan && near) return at(near.q.x, 1.2, near.q.z, 'scan: opponent');
      return ahead(1.3);
    }
    this.recvT = -1;
    // Off the ball: the ball, and every few seconds a check over the shoulder.
    if (!this.scan && t > this.nextScan) this.startScan(t, p.ai && (p.ai.state === 'MARK' || p.ai.state === 'COVER') ? 'man' : this.rand() < 0.5 ? 'opponent' : 'mate');
    if (this.scan) {
      if (this.scan.kind === 'man' && p.ai && p.ai.mark) return at(p.ai.mark.x, 1.2, p.ai.mark.z, 'scan: his man');
      if (this.scan.kind === 'mate') { const q = nearestMate(m, p); if (q) return at(q.x, 1.2, q.z, 'scan: team-mate'); }
      if (near) return at(near.q.x, 1.2, near.q.z, 'scan: opponent');
    }
    return ahead();
  }

  startScan(t, kind) {
    this.scan = { until: t + L.scanFor[0] + this.rand() * (L.scanFor[1] - L.scanFor[0]), kind };
    this.nextScan = this.scan.until + L.scanEvery[0] + this.rand() * (L.scanEvery[1] - L.scanEvery[0]);
  }

  // ------------------------------------------------------------------ eyes, head
  // yaw, pitch: the target relative to the chest (yaw + left, pitch + down).
  step(dt, yaw, pitch) {
    const ke = 1 - Math.exp(-L.eyeSpeed * dt), kh = 1 - Math.exp(-L.headSpeed * dt);
    // where the eyes point (a fast saccade, as far as eyes + head can turn)
    const reachY = L.headYawLimit + L.eyeYawLimit, reachP = L.headPitchLimit + L.eyePitchLimit;
    this.gaze.yaw += (clamp(yaw, -reachY, reachY) - this.gaze.yaw) * ke;
    this.gaze.pitch += (clamp(pitch, -reachP * 0.6, reachP) - this.gaze.pitch) * ke;
    // the head follows the gaze (slower), within its own range
    this.head.yaw += (clamp(this.gaze.yaw, -L.headYawLimit, L.headYawLimit) - this.head.yaw) * kh;
    this.head.pitch += (clamp(this.gaze.pitch, -L.headPitchLimit * 0.6, L.headPitchLimit) - this.head.pitch) * kh;
    // the eyes cover what the head doesn't (they lead, then recentre as it arrives)
    this.eye.yaw = clamp(this.gaze.yaw - this.head.yaw, -L.eyeYawLimit, L.eyeYawLimit);
    this.eye.pitch = clamp(this.gaze.pitch - this.head.pitch, -L.eyePitchLimit, L.eyePitchLimit);
    return this;
  }

  // One frame: pick the target and turn toward it. chest: the chest's facing (sim angle,
  // atan2(z, x)); eye: the head's world position { x, y, z }.
  update(dt, p, m, b, t, chest, eyeAt) {
    const T = this.target = this.pick(p, m, b, t);
    const dx = T.x - eyeAt.x, dz = T.z - eyeAt.z, h = Math.hypot(dx, dz);
    const yaw = wrapAngle(chest - Math.atan2(dz, dx));                // + : to his left
    const pitch = Math.atan2(eyeAt.y - T.y, Math.max(h, 0.2));        // + : down
    return this.step(dt, yaw, pitch);
  }
}

function nearest(m, p) {
  if (!m) return null;
  let best = null;
  for (const q of m.players) {
    if (!q.active || q.team === p.team) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (!best || d < best.d) best = { q, d };
  }
  return best;
}

function nearestMate(m, p) {
  let best = null, bd = 99;
  for (const q of m.players) {
    if (!q.active || q.team !== p.team || q === p || q.line === 'GK') continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

// The carrier's best option as his side's support plan has it (the AI and the person
// alike see team-mates showing for it), else the most advanced team-mate.
function bestOption(m, p) {
  const T = m.ai && m.ai.team[p.team], tri = T && T.triangles && T.triangles[0];
  if (tri) { const r = tri.b.lane >= tri.c.lane ? tri.b : tri.c; return r.p || r; }
  let best = null;
  for (const q of m.players) if (q.active && q.team === p.team && q !== p && q.line !== 'GK' && (!best || (q.x - best.x) * m.teams[p.team].dir > 0)) best = q;
  return best;
}
