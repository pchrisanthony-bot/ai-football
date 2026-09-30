// Ball visuals: rolling rotation integrated from velocity, a height-readable
// blob shadow (FIFA-style: tells you how high a lob is), and a trail on strikes.
import * as THREE from 'three';
import { BALL } from '../config.js';
import { ballTexture, radialTexture } from './textures.js';

const TRAIL = 22;

export class BallView {
  constructor(scene) {
    const map = ballTexture();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.r, 28, 18), new THREE.MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.02 }));
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)', 64), transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    scene.add(this.blob);
    // trail ribbon
    this.trailPts = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(TRAIL * 2), 1));
    const idx = [];
    for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.trailMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1, 0.9, 0.5) } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }`,
    });
    this.trail = new THREE.Mesh(geo, this.trailMat);
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.trailHeat = 0;
    this.q = new THREE.Quaternion();
    this.axis = new THREE.Vector3();
  }

  setTrailColor(c) { this.trailMat.uniforms.uColor.value.set(c); }

  update(dt, b, camera) {
    this.mesh.position.set(b.x, b.y, b.z);
    // Spin: the free ball carries a real spin vector (backspin on a chip, topspin off
    // a bounce, curl on a finesse shot) — show exactly that. A ball held at the feet
    // just rolls with its motion.
    const free = !b.owner || (b.owner.dribble && b.owner.dribble.mode === 'knock');
    const w = Math.hypot(b.wx, b.wy, b.wz);
    if (free && w > 0.5) {
      this.axis.set(b.wx / w, b.wy / w, b.wz / w);
      this.q.setFromAxisAngle(this.axis, w * dt);
      this.mesh.quaternion.premultiply(this.q);
    } else {
      const vx = b.vx, vz = b.vz, sp = Math.hypot(vx, vz);
      if (sp > 0.01) {
        this.axis.set(vz, 0, -vx).normalize();
        this.q.setFromAxisAngle(this.axis, (sp * dt) / BALL.r);
        this.mesh.quaternion.premultiply(this.q);
      }
    }
    // blob shadow: shrinks and fades with height
    const h = Math.max(0, b.y - BALL.r);
    const s = 0.34 + h * 0.12;
    this.blob.scale.set(s, s, 1);
    this.blob.position.set(b.x, 0.012, b.z);
    this.blob.material.opacity = Math.max(0.12, 0.85 - h * 0.18);

    // trail: heats up on fast strikes
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const heat = b.owner ? 0 : Math.min(1, Math.max(0, (speed - 13) / 12));
    this.trailHeat += (heat - this.trailHeat) * Math.min(1, dt * 10);
    this.trailPts.unshift([b.x, b.y, b.z]);
    if (this.trailPts.length > TRAIL) this.trailPts.pop();
    const pos = this.trail.geometry.attributes.position.array, al = this.trail.geometry.attributes.alpha.array;
    const cam = camera.position;
    for (let i = 0; i < TRAIL; i++) {
      const p = this.trailPts[Math.min(i, this.trailPts.length - 1)];
      const n = this.trailPts[Math.min(i + 1, this.trailPts.length - 1)];
      // ribbon perpendicular to both travel and view direction
      let dx = p[0] - n[0], dy = p[1] - n[1], dz = p[2] - n[2];
      const vx2 = cam.x - p[0], vy2 = cam.y - p[1], vz2 = cam.z - p[2];
      let sx = dy * vz2 - dz * vy2, sy = dz * vx2 - dx * vz2, sz = dx * vy2 - dy * vx2;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const w = BALL.r * 0.9 * (1 - i / TRAIL);
      sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      pos.set([p[0] + sx, p[1] + sy, p[2] + sz, p[0] - sx, p[1] - sy, p[2] - sz], i * 6);
      const a = this.trailHeat * (1 - i / TRAIL) * 0.8;
      al[i * 2] = a; al[i * 2 + 1] = a;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.alpha.needsUpdate = true;
  }
}
