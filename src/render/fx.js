// Particle FX: sparks off the cage, dust on slides and landings, confetti on goals.
import * as THREE from 'three';
import { radialTexture } from './textures.js';

const MAX = 900;

export class FX {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { map: { value: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64) }, uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float uScale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a * vA, t.a * vA); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.p = [];
    // dust uses normal blending
    this.dustMat = this.mat.clone();
    this.dustMat.blending = THREE.NormalBlending;
    this.dustMat.fragmentShader = `uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }`;
    const dgeo = geo.clone();
    this.dpos = dgeo.attributes.position.array; this.dcol = dgeo.attributes.color.array; this.dsize = dgeo.attributes.size.array; this.dalpha = dgeo.attributes.alpha.array;
    this.dust = new THREE.Points(dgeo, this.dustMat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.d = [];
  }

  resize(h) { this.mat.uniforms.uScale.value = h * 0.8; this.dustMat.uniforms.uScale.value = h * 0.8; }

  spark(x, y, z, nx, nz, strength = 1, color = [1, 0.85, 0.4]) {
    const n = Math.round(10 + 26 * strength);
    for (let i = 0; i < n && this.p.length < MAX; i++) {
      const sp = 2 + Math.random() * 7 * strength;
      const a = Math.random() * Math.PI * 2;
      this.p.push({
        x, y, z,
        vx: nx * sp * (0.4 + Math.random()) + Math.cos(a) * sp * 0.6,
        vy: (Math.random() * 0.9 + 0.1) * sp * 0.8,
        vz: nz * sp * (0.4 + Math.random()) + Math.sin(a) * sp * 0.6,
        life: 0.25 + Math.random() * 0.35, t: 0, size: 0.05 + Math.random() * 0.06, c: color, g: 9,
      });
    }
  }

  confetti(x, z, colors) {
    for (let i = 0; i < 260 && this.p.length < MAX; i++) {
      const c = new THREE.Color(colors[i % colors.length]);
      this.p.push({
        x: x + (Math.random() - 0.5) * 10, y: 4 + Math.random() * 2, z: z + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 2, vy: -0.5 - Math.random(), vz: (Math.random() - 0.5) * 2,
        life: 2 + Math.random() * 1.5, t: 0, size: 0.07, c: [c.r * 1.4, c.g * 1.4, c.b * 1.4], g: 0.6, flutter: Math.random() * 6,
      });
    }
  }

  puff(x, z, n = 8, size = 0.5) {
    for (let i = 0; i < n && this.d.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 1.2;
      this.d.push({ x, y: 0.1, z, vx: Math.cos(a) * sp, vy: 0.3 + Math.random() * 0.5, vz: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.5, t: 0, size: size * (0.6 + Math.random() * 0.8), c: [0.55, 0.55, 0.58] });
    }
  }

  update(dt) {
    const step = (arr, pos, col, size, alpha, attrObj, dust) => {
      let k = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        const q = arr[i];
        q.t += dt;
        if (q.t >= q.life) { arr.splice(i, 1); continue; }
        q.vy -= (q.g ?? 0) * dt;
        if (q.flutter) { q.vx += Math.sin(q.t * q.flutter) * dt * 2; }
        const drag = dust ? Math.exp(-2.5 * dt) : 1;
        q.vx *= drag; q.vz *= drag;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.y < 0.02) { q.y = 0.02; q.vy *= -0.3; }
      }
      for (const q of arr) {
        if (k >= MAX) break;
        pos[k * 3] = q.x; pos[k * 3 + 1] = q.y; pos[k * 3 + 2] = q.z;
        col[k * 3] = q.c[0]; col[k * 3 + 1] = q.c[1]; col[k * 3 + 2] = q.c[2];
        const u = q.t / q.life;
        size[k] = q.size * (dust ? 1 + u * 1.5 : 1);
        alpha[k] = dust ? (1 - u) * 0.28 : (1 - u);
        k++;
      }
      for (let i = k; i < MAX; i++) alpha[i] = 0;
      const a = attrObj.geometry.attributes;
      a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
      attrObj.geometry.setDrawRange(0, k);
    };
    step(this.p, this.pos, this.col, this.size, this.alpha, this.points, false);
    step(this.d, this.dpos, this.dcol, this.dsize, this.dalpha, this.dust, true);
  }
}
