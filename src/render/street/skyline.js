// =====================================================================
// The far city (detail layer 4): dense low-rise blocks out to the haze, rooftop tanks, and
// the towers beyond — Mumbai's high-rises standing over the informal city. One instanced
// mesh per layer; windows, paint and wear computed in the shader from world position, so
// any block size works. Lit windows come on at night (W.uNight).
// =====================================================================
import * as THREE from 'three';
import { W } from './materials.js';
import { rng, range } from './util.js';

export function buildSkyline(group) {
  const r = rng(4242);
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const mk = (n, place, tall = false) => {
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uNight: W.uNight, uSun: { value: new THREE.Vector3(-0.6, 0.35, 0.7) }, uTall: { value: tall ? 1 : 0 } }]),
      vertexShader: `
        attribute vec3 aCol; attribute float aSeed;
        varying vec3 vWP; varying vec3 vN; varying vec3 vCol; varying float vSeed;
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWP = wp.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vCol = aCol; vSeed = aSeed;
          vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uNight, uTall; uniform vec3 uSun;
        varying vec3 vWP; varying vec3 vN; varying vec3 vCol; varying float vSeed;
        #include <fog_pars_fragment>
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 31.0) * 43758.5453); }
        void main(){
          float sun = clamp(dot(vN, normalize(uSun)), 0.0, 1.0);
          vec3 day = vCol * (0.55 + 0.6 * sun) * (0.85 + 0.15 * hash(floor(vWP.xz)));
          vec3 col = day;
          if (abs(vN.y) < 0.5) {
            float u = abs(vN.x) > 0.5 ? vWP.z : vWP.x;
            vec2 cell = vec2(u / (uTall > 0.5 ? 2.0 : 2.6), vWP.y / (uTall > 0.5 ? 3.1 : 3.0));
            vec2 id = floor(cell), f = fract(cell);
            float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.75);
            float lit = step(0.55, hash(id));
            col = mix(col, col * 0.35 + vec3(0.02), win * (1.0 - uNight) * 0.85);              // windows by day: dark
            vec3 glow = mix(vec3(1.0, 0.78, 0.45), vec3(0.75, 0.88, 1.0), step(0.75, hash(id + 2.0)));
            col = mix(col, col * 0.06, uNight) + win * lit * glow * uNight * (0.6 + 0.8 * hash(id + 9.0));
            // streaks down the walls
            col *= 1.0 - 0.18 * smoothstep(0.6, 0.95, hash(vec2(floor(u * 1.7), 0.0))) * (1.0 - uNight);
          } else col *= 0.75;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    const g = geo.clone();
    const mesh = new THREE.InstancedMesh(g, mat, n);
    const cols = new Float32Array(n * 3), seeds = new Float32Array(n), M = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const { x, z, w, d, h, yaw, col } = place(i);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      M.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(w, h, d)); mesh.setMatrixAt(i, M);
      c.set(col); cols.set([c.r, c.g, c.b], i * 3); seeds[i] = r();
    }
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(cols, 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.frustumCulled = false;
    return mesh;
  };
  const PAINT = ['#d9c9a6', '#c9b38f', '#9fb6c3', '#c79c8f', '#b8c49b', '#d8b46e', '#a7a3a0', '#c4a9c6', '#9cc4b4', '#e0d6c2'];
  // dense low-rise: rings of blocks from 45 m to 230 m (more compact near)
  const lowN = 420;
  const low = mk(lowN, () => {
    let x, z, dist;
    do { const a = r() * Math.PI * 2; dist = 52 + Math.pow(r(), 1.4) * 185; x = Math.cos(a) * dist; z = Math.sin(a) * dist * 0.95 - 10; } while (z > 30 && Math.abs(x) < 40);
    return { x, z, w: range(6, 16, r), d: range(6, 14, r), h: range(7, 22, r) + (dist > 120 ? range(0, 12, r) : 0), yaw: Math.round(r() * 4) * Math.PI / 2 + range(-0.15, 0.15, r), col: PAINT[Math.floor(r() * PAINT.length)] };
  });
  low.name = 'street:skyline-low';
  group.add(low);
  // towers beyond: the new city
  const tall = mk(22, (i) => {
    const a = -Math.PI * 0.9 + (i / 22) * Math.PI * 0.95 + range(-0.05, 0.05, r), dist = range(240, 420, r);
    return { x: Math.cos(a) * dist, z: Math.sin(a) * dist - 40, w: range(18, 34, r), d: range(18, 30, r), h: range(55, 150, r), yaw: range(-0.3, 0.3, r), col: ['#b9c2c9', '#c9c4ba', '#a9b8c4', '#d1cbbf'][i % 4] };
  }, true);
  tall.name = 'street:skyline-tall';
  group.add(tall);
  // rooftop tanks on the near half of the low-rise (black dots on every roof)
  const tankGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.2, 8); tankGeo.translate(0, 0.6, 0);
  const tanks = new THREE.InstancedMesh(tankGeo, new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.7 }), 300);
  const M = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < lowN && k < 300; i++) {
    low.getMatrixAt(i, M); M.decompose(p, q, s);
    if (Math.hypot(p.x, p.z + 10) > 130) continue;
    for (let j = 0; j < 1 + (i % 2) && k < 300; j++) { tanks.setMatrixAt(k++, new THREE.Matrix4().makeTranslation(p.x + range(-s.x * 0.3, s.x * 0.3, r), s.y, p.z + range(-s.z * 0.3, s.z * 0.3, r))); }
  }
  tanks.count = k; tanks.name = 'street:skyline-tanks';
  group.add(tanks);
  return { low, tall, tanks };
}
