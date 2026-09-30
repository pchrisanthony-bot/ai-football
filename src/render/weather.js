// Rain: ~1600 streaks in a box that follows the camera's focus, slanted by the wind.
// The pitch goes glossy (venue.setWet) and the ball skids (setSurface wet) — see main.
import * as THREE from 'three';

export class Rain {
  constructor(scene, n = 1600) {
    this.n = n;
    this.box = { x: 44, y: 22, z: 34 };
    this.pos = new Float32Array(n * 6);
    this.drops = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.drops[i * 3 + 1] = Math.random() * this.box.y;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb8ccf0, transparent: true, opacity: 0.32, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.wind = 2.2;
  }

  setOn(on) { this.mesh.visible = on; }
  get on() { return this.mesh.visible; }

  update(dt, focus) {
    if (!this.mesh.visible) return;
    const { n, drops, pos, box } = this;
    const fall = 16, len = 0.55, wx = this.wind;
    const cx = focus ? focus.x : 0, cz = focus ? focus.z : 0;
    for (let i = 0; i < n; i++) {
      let x = drops[i * 3], y = drops[i * 3 + 1], z = drops[i * 3 + 2];
      y -= fall * dt; x += wx * dt;
      if (y < 0) { y += box.y; x = (Math.random() - 0.5) * box.x; z = (Math.random() - 0.5) * box.z; }
      if (x > box.x / 2) x -= box.x;
      drops[i * 3] = x; drops[i * 3 + 1] = y; drops[i * 3 + 2] = z;
      const o = i * 6;
      pos[o] = cx + x; pos[o + 1] = y; pos[o + 2] = cz + z;
      pos[o + 3] = cx + x - wx * len / fall; pos[o + 4] = y + len; pos[o + 5] = cz + z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
