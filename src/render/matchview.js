// MatchView: everything that turns sim state into pixels and sound.
import * as THREE from 'three';
import { Athlete } from './athlete.js';
import { BallView } from './ballview.js';
import { predictPath, copyBall } from '../sim/ball.js';
import { COURT, BALL } from '../config.js';
import { radialTexture } from './textures.js';

const REPLAY_SECS = 7;

export class MatchView {
  constructor(ctx, match) {
    this.ctx = ctx;                 // { scene, venue, fx, audio, rig, hud }
    this.m = match;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.athletes = new Map();
    for (const p of match.players) {
      const kit = match.teams[p.team].def.kit;
      const a = new Athlete(p, kit);
      a.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      this.group.add(a.root);
      this.athletes.set(p.id, a);
    }
    this.ball = new BallView(this.group);

    // Controlled-player marker: pulsing ground ring + arrow.
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.56, 40), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 3), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
    this.arrow.rotation.x = Math.PI;
    this.group.add(this.arrow);
    // Facing chevron on the ground in front of the controlled player.
    this.chev = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 3), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.8, depthWrite: false }));
    this.chev.rotation.x = -Math.PI / 2;
    this.group.add(this.chev);

    // Aim preview: dotted predicted path + bounce rings (same integrator as the sim).
    this.previewDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }), 90);
    this.previewDots.count = 0;
    this.previewDots.frustumCulled = false;
    this.group.add(this.previewDots);
    this.bounceRings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 24), new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
      r.visible = false; this.group.add(r); this.bounceRings.push(r);
    }
    // Contact blob shadows (only shown when real shadows are off — LOW quality).
    this.blobs = new Map();
    const bTex = radialTexture('rgba(0,0,0,0.7)', 'rgba(0,0,0,0)', 64);
    for (const p of match.players) {
      const bl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: bTex, transparent: true, depthWrite: false }));
      bl.rotation.x = -Math.PI / 2; bl.position.y = 0.012;
      this.group.add(bl); this.blobs.set(p.id, bl);
    }
    // Team-coloured ground glow under every player for readability at distance.
    this.glows = new Map();
    const gTex = radialTexture('rgba(255,255,255,0.55)', 'rgba(255,255,255,0)', 64);
    for (const p of match.players) {
      const c = new THREE.Color(match.teams[p.team].def.kit.shirt);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: gTex, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.45 }));
      g.rotation.x = -Math.PI / 2; g.position.y = 0.015;
      this.group.add(g); this.glows.set(p.id, g);
    }

    // Impact rings that flare on the mesh where the ball hits it.
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 40), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      r.visible = false; this.group.add(r); this.rings.push({ mesh: r, t: 9, k: 0 });
    }
    this.ringIdx = 0;

    this.frames = [];     // replay ring buffer
    this.recT = 0;
    this.goalMark = null;
    this.replay = null;
    this.tmpM = new THREE.Matrix4();
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.(); });
  }

  // ------------------------------------------------------------------ live
  update(dt, human) {
    const m = this.m, b = m.ball;
    for (const p of m.players) {
      const a = this.athletes.get(p.id);
      a.root.visible = p.active;
      this.glows.get(p.id).visible = p.active;
      if (!p.active) { this.blobs.get(p.id).visible = false; continue; }
      a.update(dt, m, b);
      this.glows.get(p.id).position.set(p.x, 0.015, p.z);
      const bl = this.blobs.get(p.id);
      bl.visible = !this.ctx.renderer.shadowMap.enabled;
      bl.position.set(p.x, 0.012, p.z);
    }
    this.ball.update(dt, b, this.ctx.rig.cam);
    this.updateRings(dt);
    this.updateMarker(dt, human);
    this.updatePreview(human);
    this.record(dt);
  }

  updateRings(dt) {
    for (const R of this.rings) {
      if (!R.mesh.visible) continue;
      R.t += dt;
      const u = R.t / 0.45;
      if (u >= 1) { R.mesh.visible = false; continue; }
      const s = 0.6 + u * (2.2 + 2.5 * R.k);
      R.mesh.scale.set(s, s, s);
      R.mesh.material.opacity = (1 - u) * (0.5 + 0.5 * R.k);
    }
  }

  updateMarker(dt, human) {
    const p = this.m.human;
    const show = !!p && p.active && this.m.phase !== 'fulltime';
    this.ring.visible = this.arrow.visible = this.chev.visible = show;
    if (!show) return;
    const t = performance.now() / 1000;
    this.ring.position.set(p.x, 0.02, p.z);
    const s = 1 + Math.sin(t * 6) * 0.06;
    this.ring.scale.set(s, s, s);
    this.arrow.position.set(p.x, 2.25 + Math.sin(t * 4) * 0.06, p.z);
    this.arrow.rotation.y = t * 2;
    this.chev.position.set(p.x + Math.cos(p.facing) * 0.78, 0.03, p.z + Math.sin(p.facing) * 0.78);
    this.chev.rotation.z = -p.facing - Math.PI / 2;
    const col = human && human.charge ? 0xffffff : 0xffd400;
    this.ring.material.color.setHex(col);
  }

  updatePreview(human) {
    const m = this.m;
    const aim = human ? human.previewAim() : null;
    const p = m.human;
    this.previewDots.count = 0;
    for (const r of this.bounceRings) r.visible = false;
    if (!aim || !p || (human.charge.t < 0.12)) return;
    const b = m.ball;
    if (!(b.owner === p || m.ballReachableSoon(p, 1.6))) return;
    const v = m.planShot(p, aim, true);
    const start = copyBall(b);
    start.vx = v.vx; start.vy = v.vy; start.vz = v.vz; start.wx = 0; start.wy = v.wy || 0; start.wz = 0;
    start.y = Math.max(start.y, BALL.r);
    const pred = predictPath(start, 1.4, 1 / 60);
    const goal = pred.goal === m.teams[p.team].dir;
    this.previewDots.material.color.setHex(goal ? 0xffd400 : 0xffffff);
    let k = 0;
    for (let i = 3; i < pred.pts.length && k < 90; i += 2) {
      const q = pred.pts[i];
      const fade = 1 - i / pred.pts.length;
      this.tmpM.makeScale(0.6 + fade * 0.6, 0.6 + fade * 0.6, 0.6 + fade * 0.6).setPosition(q.x, q.y, q.z);
      this.previewDots.setMatrixAt(k++, this.tmpM);
    }
    this.previewDots.count = k;
    this.previewDots.instanceMatrix.needsUpdate = true;
    let ri = 0;
    for (const e of pred.events) {
      if (e.type !== 'wall' || ri >= this.bounceRings.length) continue;
      const r = this.bounceRings[ri++];
      r.visible = true;
      r.position.set(e.x + (e.nx || 0) * 0.02, e.y, e.z + (e.nz || 0) * 0.02);
      r.lookAt(e.x + (e.nx || 0), e.y, e.z + (e.nz || 0));
    }
  }

  // ------------------------------------------------------------------ events → FX, audio, camera
  handleEvents(events, hud) {
    const { venue, fx, audio, rig } = this.ctx;
    const m = this.m;
    for (const e of events) {
      switch (e.type) {
        case 'wall': {
          const k = Math.min(1, e.speed / 20);
          venue.fence.hit(e.x, e.y, e.z, e.board ? 0.02 * k : 0.12 * k);
          if (e.speed > 7) {
            const R = this.rings[this.ringIdx++ % this.rings.length];
            R.t = 0; R.k = k; R.mesh.visible = true;
            R.mesh.position.set(e.x + (e.nx || 0) * 0.05, Math.max(0.3, e.y), e.z + (e.nz || 0) * 0.05);
            R.mesh.lookAt(e.x + (e.nx || 0), Math.max(0.3, e.y), e.z + (e.nz || 0));
          }
          if (e.speed > 5) fx.spark(e.x, e.y, e.z, e.nx, e.nz, k);
          if (e.speed > 16) rig.shake(0.12 * k, 0.25);
          audio.fence(e.speed, e.board);
          if (e.speed > 12) hud.flash(0.05 * k);
          break;
        }
        case 'post':
          fx.spark(e.x, e.y, e.z, 0, 0, Math.min(1, e.speed / 15), [1, 1, 1]);
          rig.shake(0.2, 0.3); audio.post(e.speed); hud.callout(e.kind === 'bar' ? 'OFF THE BAR!' : 'OFF THE POST!', '#ffffff', 1.2);
          break;
        case 'net': venue.nets.hit(e.x, e.y, e.z, Math.min(0.35, e.speed * 0.03)); audio.net(); break;
        case 'bounce': if (e.speed > 1.5) audio.bounce(e.speed); break;
        case 'kick': {
          const p = m.players.find(q => q.id === e.pid);
          audio.kick(Math.min(1, e.speed / 28));
          if (e.kind === 'rainbow' || e.kind === 'flickup' || e.kind === 'panna') audio.whoosh();
          if (e.speed > 22) rig.shake(0.05, 0.15);
          const col = p ? m.teams[p.team].def.kit.trim : '#ffd400';
          this.ball.setTrailColor(col);
          break;
        }
        case 'touch': this.athletes.get(e.pid)?.touch(e.power); audio.touch(e.power); break;
        case 'save': audio.save(e.kind); if (e.kind === 'parry') fx.puff(e.x, e.z, 6, 0.5); hud.callout(e.kind === 'catch' ? 'SAVED!' : 'PARRIED!', '#9fe3ff', 1.1); break;
        case 'tackle': audio.tackle(e.ok); if (e.slide) { audio.slide(); fx.puff(e.x, e.z, 10, 0.6); } break;
        case 'trip': audio.tackle(true); break;
        case 'header': audio.kick(0.4); break;
        case 'style': hud.style(e.label, e.pts, m.teams[e.team].def.kit.shirt); audio.style(e.pts); break;
        case 'panna': audio.crowdOoh(1.2); break;
        case 'gamebreaker': audio.gamebreaker(); hud.gamebreaker(e.team); rig.shake(0.3, 0.6); break;
        case 'whistle': audio.whistle(e.kind === 'end'); break;
        case 'goal': {
          audio.goal();
          rig.shake(0.45, 0.8);
          hud.flash(0.35);
          const T = m.teams[e.team];
          const kit = T.def.kit;
          fx.confetti(T.dir * COURT.halfL * 0.8, 0, [kit.shirt, kit.trim, '#ffffff']);
          this.goalMark = { frame: this.frames.length, team: e.team, info: e };
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ replay
  record(dt) {
    this.recT += dt;
    if (this.replay) return;
    const m = this.m, b = m.ball;
    const q = this.ball.mesh.quaternion;
    const f = { dt, ball: [b.x, b.y, b.z, q.x, q.y, q.z, q.w, b.vx, b.vy, b.vz, b.owner ? 1 : 0], pl: [] };
    for (const p of m.players) {
      const a = this.athletes.get(p.id);
      f.pl.push(p.active ? [p.x, p.z, a.root.rotation.y, a.snapshot()] : null);
    }
    this.frames.push(f);
    let total = 0;
    for (const fr of this.frames) total += fr.dt;
    while (total > REPLAY_SECS + 3 && this.frames.length) { total -= this.frames.shift().dt; if (this.goalMark) this.goalMark.frame--; }
  }

  startReplay() {
    if (!this.goalMark) return false;
    // from ~4.5 s before the goal to ~1.5 s after
    let i = this.goalMark.frame, back = 0;
    while (i > 0 && back < 4.5) { back += this.frames[i - 1].dt; i--; }
    let j = this.goalMark.frame, fwd = 0;
    while (j < this.frames.length - 1 && fwd < 1.5) { fwd += this.frames[j].dt; j++; }
    this.replay = { i, start: i, end: j, acc: 0, speed: 0.75, cam: 0, goalX: this.m.teams[this.goalMark.team].dir * COURT.halfL };
    return true;
  }

  // Returns false when the replay has finished.
  updateReplay(dt) {
    const r = this.replay;
    if (!r) return false;
    r.acc += dt * r.speed;
    while (r.i < r.end && r.acc >= this.frames[r.i].dt) { r.acc -= this.frames[r.i].dt; r.i++; }
    if (r.i >= r.end) { this.replay = null; return false; }
    const f = this.frames[r.i];
    const m = this.m;
    m.players.forEach((p, k) => {
      const a = this.athletes.get(p.id), s = f.pl[k];
      a.root.visible = !!s;
      this.glows.get(p.id).visible = !!s;
      if (!s) return;
      a.applySnapshot(s[3], s[0], s[1], s[2]);
      this.glows.get(p.id).position.set(s[0], 0.015, s[1]);
    });
    const bb = f.ball;
    this.ball.mesh.position.set(bb[0], bb[1], bb[2]);
    this.ball.mesh.quaternion.set(bb[3], bb[4], bb[5], bb[6]);
    this.ball.blob.position.set(bb[0], 0.012, bb[2]);
    this.ring.visible = this.arrow.visible = this.chev.visible = false;
    this.previewDots.count = 0;
    const ballState = { x: bb[0], y: bb[1], z: bb[2], vx: bb[7], vy: bb[8], vz: bb[9], owner: bb[10] ? {} : null, wy: 0 };
    this.ball.update(0, ballState, this.ctx.rig.cam);
    this.ball.mesh.position.set(bb[0], bb[1], bb[2]);
    const progress = (r.i - r.start) / Math.max(1, r.end - r.start);
    this.ctx.rig.replay(dt, ballState, progress < 0.55 ? 0 : 1, r.goalX);
    return true;
  }

  endReplay() { this.replay = null; this.goalMark = null; }
}
