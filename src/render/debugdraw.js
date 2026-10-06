// =====================================================================
// Gameplay debug drawing (with the AI debug overlay, Tab): the ball game made visible.
//   white dots   the ball's actual path            orange dots  the defending side's read of it
//   cyan line    the passing lane (from → aim)     cyan ring    where the pass expects the receiver
//   yellow line  the stick's direction (human)     red ring     the best interception point (+ his run)
//   yellow bar   the live offside line             red bar      the line frozen at the last pass,
//                (for the side on the ball)                      red rings under men caught offside
//   triangles    lines from the ball to each supporter's spot and between them — green open,
//                amber contested, red shut; a dot on each spot in his job's colour
//                (forward option cyan · diagonal violet · safety white · weak side grey)
//   receiving    blue ring where he takes it (the ball's arrival), green ring his contact reach
//                round where he'll stand, a dot on the receiving foot's side
//   movement     thin lines from each AI man to where he's going
//   look         a short line from each head to what he's looking at
// Everything is read from the sim (PassingSystem.ctx, InterceptionSystem, OffsideSystem);
// nothing is computed here that the sim doesn't already know. Updated ~10 Hz.
// =====================================================================
import * as THREE from 'three';
import { PITCH } from '../sim/pitch.js';

const DOTS = 40;
const _h = new THREE.Vector3();
const ringGeo = (r, w) => new THREE.RingGeometry(r - w, r, 32);
const mat = (color, opacity = 0.9) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
const lineMat = (color, opacity = 0.9) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

export class DebugDraw {
  constructor(group) {
    this.root = new THREE.Group();
    this.root.visible = false;
    group.add(this.root);
    const dot = new THREE.SphereGeometry(0.06, 6, 4);
    this.actual = new THREE.InstancedMesh(dot, mat(0xffffff, 0.85), DOTS);
    this.read = new THREE.InstancedMesh(dot, mat(0xff8a1c, 0.85), DOTS);
    for (const d of [this.actual, this.read]) { d.count = 0; d.frustumCulled = false; this.root.add(d); }
    const line = (color, opacity) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); const l = new THREE.Line(g, lineMat(color, opacity)); l.frustumCulled = false; this.root.add(l); return l; };
    this.lane = line(0x2ee6ff, 0.9);
    this.stick = line(0xffd400, 0.8);
    this.run = line(0xff3b3b, 0.8);
    this.offLive = line(0xffd400, 0.7);
    this.offSnap = line(0xff3b3b, 0.95);
    const ring = (r, color) => { const m = new THREE.Mesh(ringGeo(r, 0.07), mat(color)); m.rotation.x = -Math.PI / 2; m.visible = false; this.root.add(m); return m; };
    this.recv = ring(0.55, 0x2ee6ff);
    this.cut = ring(0.45, 0xff3b3b);
    this.flags = Array.from({ length: 6 }, () => ring(0.62, 0xff3b3b));
    // triangles / support, reception, movement targets, look lines
    const seg = (n, color, opacity) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false })); l.frustumCulled = false; l.userData.n = n; this.root.add(l); return l; };
    this.tri = seg(8, 0xffffff, 0.95);
    this.moves = seg(10, 0xffffff, 0.45);
    this.looks = seg(10, 0xffffff, 0.7);
    this.spots = Array.from({ length: 4 }, () => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), mat(0xffffff, 0.85)); m.rotation.x = -Math.PI / 2; m.visible = false; this.root.add(m); return m; });
    this.arrive = ring(0.3, 0x3b8bff);
    this.reach = ring(0.62, 0x3bff8b);
    this.foot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), mat(0x3bff8b)); this.foot.rotation.x = -Math.PI / 2; this.root.add(this.foot);
    this.t = 0;
    this.tmp = new THREE.Matrix4();
    this.info = null;     // the numbers behind the picture (telemetry reads it)
  }

  setLine(l, ax, ay, az, bx, by, bz) {
    const a = l.geometry.attributes.position.array;
    a[0] = ax; a[1] = ay; a[2] = az; a[3] = bx; a[4] = by; a[5] = bz;
    l.geometry.attributes.position.needsUpdate = true;
    l.visible = true;
  }

  dots(mesh, path) {
    let k = 0;
    if (path) for (let i = 2; i < path.pts.length && k < DOTS; i += 2) {
      const q = path.pts[i];
      this.tmp.makeTranslation(q.x, Math.max(q.y, 0.06), q.z);
      mesh.setMatrixAt(k++, this.tmp);
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Coloured line segments: segs [[ax, ay, az, bx, by, bz, hex], …]
  segs(l, list) {
    const P = l.geometry.attributes.position, C = l.geometry.attributes.color, c = new THREE.Color();
    const n = Math.min(list.length, l.userData.n);
    for (let i = 0; i < n; i++) {
      const s = list[i]; c.setHex(s[6]);
      P.array.set(s.slice(0, 6), i * 6); C.array.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    }
    l.geometry.setDrawRange(0, n * 2);
    P.needsUpdate = true; C.needsUpdate = true;
    l.visible = n > 0;
  }

  update(dt, m, on, athletes = null) {
    this.root.visible = on;
    if (!on) return;
    this.live(m, athletes);
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.1;
    for (const o of [this.lane, this.stick, this.run, this.offLive, this.offSnap]) o.visible = false;
    for (const r of [this.recv, this.cut, ...this.flags]) r.visible = false;
    const b = m.ball, ctx = m.passing.inFlight() || (m.passing.ctx && m.time - m.passing.ctx.t < 1.5 ? m.passing.ctx : null);
    const IS = m.intercepts;
    // The ball's path, and the defending side's read of it.
    const loose = !b.owner;
    this.dots(this.actual, loose ? IS.exactPath() : null);
    const defending = ctx ? 1 - ctx.passer.team : b.lastTouch ? 1 - b.lastTouch.team : 0;
    this.dots(this.read, loose ? IS.perceived(defending) : null);
    const info = this.info = { pass: null, cut: null, offside: null };
    // The pass: lane, aim, receiver prediction.
    if (ctx) {
      this.setLine(this.lane, ctx.from.x, 0.05, ctx.from.z, ctx.intended.x, 0.05, ctx.intended.z);
      this.recv.position.set(ctx.intended.x, 0.03, ctx.intended.z); this.recv.visible = true;
      if (ctx.stickAng != null) this.setLine(this.stick, ctx.from.x, 0.06, ctx.from.z, ctx.from.x + Math.cos(ctx.stickAng) * 6, 0.06, ctx.from.z + Math.sin(ctx.stickAng) * 6);
      info.pass = ctx;
    }
    // The best interception on the defending side (by its own read, after reactions).
    if (loose && ctx && m.passing.inFlight()) {
      const best = IS.bestCut(defending);
      if (best) {
        this.cut.position.set(best.ic.x, 0.035, best.ic.z); this.cut.visible = true;
        this.cut.material.color.setHex(best.ic.feasible ? 0xff3b3b : 0x8a8a8a);
        this.setLine(this.run, best.p.x, 0.05, best.p.z, best.ic.x, 0.05, best.ic.z);
        info.cut = { name: best.p.name, x: best.ic.x, z: best.ic.z, eta: best.ic.eta, ballT: best.ic.ballT, feasible: best.ic.feasible, reacted: IS.reacted(best.p) };
      }
    }
    // Offside: the live line for the side on the ball, and the frozen one.
    const OS = m.offside;
    if (OS.enabled) {
      const t = b.owner ? b.owner.team : ctx ? ctx.passer.team : -1;
      if (t >= 0) {
        const L = OS.line(t), x = Math.max(L.u, b.x * L.dir, 0) * L.dir;
        this.setLine(this.offLive, x, 0.04, -PITCH.halfW, x, 0.04, PITCH.halfW);
        info.offside = { team: t, line: x, secondLast: L.secondLast ? L.secondLast.name : '—' };
      }
      const s = OS.snap;
      if (s && s.flagged.size) {
        this.setLine(this.offSnap, s.line, 0.05, -PITCH.halfW, s.line, 0.05, PITCH.halfW);
        let i = 0;
        for (const id of s.flagged) { const q = m.byId.get(id); if (q && i < this.flags.length) { const r = this.flags[i++]; r.position.set(q.x, 0.04, q.z); r.visible = true; } }
        info.offside = { ...(info.offside || {}), snap: { line: s.line, flagged: [...s.flagged].map(id => m.byId.get(id).name), receiverOffside: s.receiverOffside } };
      }
      if (OS.last && m.time - OS.last.t < 4) info.offside = { ...(info.offside || {}), call: OS.last };
    }
  }

  // Every frame (not throttled): the support triangles, the reception, movement targets and
  // where each player is looking.
  live(m, athletes) {
    const b = m.ball, laneHex = l => (l >= 0.65 ? 0x3bff6b : l >= 0.35 ? 0xffb12e : 0xff3b3b);
    const ROLE = { FORWARD: 0x2ee6ff, DIAGONAL: 0xb36bff, SAFETY: 0xffffff, WEAK: 0x9a9a9a };
    // support: carrier (or receiving point) → each spot, and the best triangle's third side
    const P = m.reception && m.reception.plan;
    const t = b.owner ? b.owner.team : P ? P.receiver.team : -1;
    const T = t >= 0 ? m.ai.team[t] : null, f = T && T.supportFocus;
    const tri = [];
    for (const s of this.spots) s.visible = false;
    if (T && f && T.support) {
      let i = 0;
      for (const [id, s] of T.support) {
        const q = m.byId.get(id), sp = m.ai.support.spotFor(q, T) || s;
        tri.push([f.x, 0.06, f.z, sp.x, 0.06, sp.z, laneHex(s.lane)]);
        const dot = this.spots[i++];
        if (dot) { dot.position.set(sp.x, 0.05, sp.z); dot.material.color.setHex(ROLE[s.role] || 0xffffff); dot.visible = true; }
      }
      const best = T.triangles && T.triangles[0];
      if (best) {
        const B = T.support.get(best.b.p.id), C = T.support.get(best.c.p.id);
        if (B && C) { const sb = m.ai.support.spotFor(best.b.p, T) || B, sc = m.ai.support.spotFor(best.c.p, T) || C; tri.push([sb.x, 0.06, sb.z, sc.x, 0.06, sc.z, laneHex(best.lanes.bc)]); }
      }
    }
    this.segs(this.tri, tri);
    // the reception
    this.arrive.visible = this.reach.visible = this.foot.visible = false;
    if (P && P.point && (P.state === 'ANTICIPATING' || P.state === 'RECEIVING')) {
      const s = P.stand || P.point, r = P.receiver;
      this.arrive.position.set(P.point.x, 0.04, P.point.z); this.arrive.visible = true;
      this.reach.position.set(s.x, 0.035, s.z); this.reach.visible = true;
      this.reach.material.color.setHex(P.state === 'RECEIVING' ? 0x3bff8b : 0x2e9e6b);
      const fx = Math.cos(r.facing), fz = Math.sin(r.facing), side = P.foot === 'R' ? 1 : -1;
      this.foot.position.set(r.x - fz * 0.18 * side + fx * 0.3, 0.05, r.z + fx * 0.18 * side + fz * 0.3); this.foot.visible = true;
    }
    // where each AI man is going (his move this tick, 2 m long, or to his spot)
    const moves = [];
    for (const q of m.players) {
      if (!q.active || q.human || q.line === 'GK') continue;
      const sp = q.ai.spot || null;
      if (sp && (q.ai.state === 'SUPPORT' || q.ai.state === 'RUN')) moves.push([q.x, 0.05, q.z, sp.x, 0.05, sp.z, q.team === 0 ? 0x8fd0ff : 0xffa0a0]);
      else if (q.move.speed > 0.3) moves.push([q.x, 0.05, q.z, q.x + q.move.x * 2, 0.05, q.z + q.move.z * 2, q.team === 0 ? 0x8fd0ff : 0xffa0a0]);
    }
    this.segs(this.moves, moves);
    // look lines: head → what he's looking at (1.5 m of it)
    const looks = [];
    if (athletes) for (const a of athletes.values()) {
      const L = a.look, T2 = L && L.target;
      if (!T2 || !a.root.visible) continue;
      a.J.head.getWorldPosition(_h);
      const dx = T2.x - _h.x, dy = T2.y - _h.y, dz = T2.z - _h.z, d = Math.hypot(dx, dy, dz) || 1, k = Math.min(1.5, d) / d;
      looks.push([_h.x, _h.y, _h.z, _h.x + dx * k, _h.y + dy * k, _h.z + dz * k, T2.why === 'ball' ? 0xffe14d : 0xff6bd5]);
    }
    this.segs(this.looks, looks);
  }
}
