// =====================================================================
// Gameplay debug drawing (with the AI debug overlay, Tab): the ball game made visible.
//   white dots   the ball's actual path            orange dots  the defending side's read of it
//   cyan line    the passing lane (from → aim)     cyan ring    where the pass expects the receiver
//   yellow line  the stick's direction (human)     red ring     the best interception point (+ his run)
//   yellow bar   the live offside line             red bar      the line frozen at the last pass,
//                (for the side on the ball)                      red rings under men caught offside
// Everything is read from the sim (PassingSystem.ctx, InterceptionSystem, OffsideSystem);
// nothing is computed here that the sim doesn't already know. Updated ~10 Hz.
// =====================================================================
import * as THREE from 'three';
import { PITCH } from '../sim/pitch.js';

const DOTS = 40;
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

  update(dt, m, on) {
    this.root.visible = on;
    if (!on) return;
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
}
