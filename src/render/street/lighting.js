// =====================================================================
// Lighting for the street court: two presets.
//   golden  late afternoon: a low warm sun from behind the camera's left (front-lit play,
//           long shadows across the court, warm walls, cooler shade), a humid warm haze,
//           the sky warm at the horizon. One shadow-casting light: the sun.
//   night   four community floodlights on the corner poles (the shadow casters), sodium
//           street lamps, every lit window, shop and board on (W.uNight), a moonlit sky
//           with the city's glow along the horizon.
// =====================================================================
import * as THREE from 'three';
import { radialTexture } from '../textures.js';
import { W } from './materials.js';

const SUN = new THREE.Vector3(-0.62, 0.4, 0.71).normalize();      // toward the sun (golden hour)

export function buildLighting(group, venue, L, K) {
  // ---------------------------------------------------------------- sky
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uNight: W.uNight, uSun: { value: SUN.clone() }, uTime: W.uTime },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `varying vec3 vDir; uniform float uNight, uTime; uniform vec3 uSun;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); float a = fract(sin(dot(i, vec2(127.1,311.7)))*43758.5), b = fract(sin(dot(i+vec2(1,0), vec2(127.1,311.7)))*43758.5), c = fract(sin(dot(i+vec2(0,1), vec2(127.1,311.7)))*43758.5), d = fract(sin(dot(i+vec2(1,1), vec2(127.1,311.7)))*43758.5); return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
      void main(){
        float h = vDir.y;
        // golden hour: blue overhead, peach to amber at the horizon, the sun's glow
        vec3 zen = vec3(0.32, 0.5, 0.78), hor = vec3(1.0, 0.72, 0.48), haze = vec3(0.98, 0.82, 0.62);
        vec3 day = mix(hor, zen, smoothstep(0.0, 0.55, h));
        day = mix(haze, day, smoothstep(-0.05, 0.12, h));
        float s = max(dot(vDir, normalize(uSun)), 0.0);
        day += vec3(1.0, 0.72, 0.38) * (pow(s, 6.0) * 0.55 + pow(s, 120.0) * 2.5);
        // wisps of high cloud lit from below
        vec2 cp = vDir.xz / max(h, 0.06) * 1.6 + vec2(uTime * 0.004, 0.0);
        float cl = smoothstep(0.55, 0.85, n2(cp) * 0.65 + n2(cp * 3.1) * 0.35) * smoothstep(0.04, 0.25, h);
        day = mix(day, vec3(1.0, 0.84, 0.7) + vec3(0.25, 0.1, 0.0) * pow(s, 3.0), cl * 0.55);
        // night: deep blue, stars, the city's sodium glow at the horizon
        vec3 nt = mix(vec3(0.07, 0.06, 0.1), vec3(0.015, 0.022, 0.06), smoothstep(0.0, 0.5, h));
        nt += vec3(0.32, 0.16, 0.07) * (1.0 - smoothstep(-0.02, 0.2, h)) * 0.8;
        vec3 q = floor(vDir * 420.0); nt += vec3(step(0.9975, hash(q)) * smoothstep(0.15, 0.5, h)) * 0.8;
        gl_FragColor = vec4(mix(day, nt, uNight), 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), sky);
  dome.renderOrder = -10; dome.name = 'street:sky';
  group.add(dome);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,250,235,1)', 'rgba(255,250,235,0)', 128), color: 0xfff6e0, fog: false, depthWrite: false }));
  moon.position.set(-300, 240, -520); moon.scale.set(55, 55, 1); group.add(moon);

  // ---------------------------------------------------------------- golden hour
  const sun = new THREE.DirectionalLight(0xffb36b, 3.1);
  sun.position.copy(SUN).multiplyScalar(70); sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 26, bottom: -26, near: 10, far: 150 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.045;
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xa9c8ea, 0x9a7a58, 1.35);
  group.add(hemi);
  const bounce = new THREE.DirectionalLight(0xffd6a8, 0.35);          // warm light off the sunlit walls
  bounce.position.set(30, 10, -40); group.add(bounce);

  // ---------------------------------------------------------------- night
  const floods = L.floods.map(f => {
    const s = new THREE.SpotLight(0xfff0d8, 1150, 0, 0.86, 0.55, 2);
    s.position.set(f.x, f.y, f.z); s.target.position.copy(f.aim);
    s.castShadow = true; s.shadow.mapSize.set(1024, 1024);
    s.shadow.camera.near = 3; s.shadow.camera.far = 45; s.shadow.bias = -0.0004; s.shadow.normalBias = 0.03; s.shadow.radius = 3;
    group.add(s, s.target);
    return s;
  });
  const sodium = K.lights.filter(l => l.kind === 'sodium').slice(0, 3).map(l => { const p = new THREE.PointLight(0xffa246, 55, 22, 2); p.position.set(l.x, l.y - 0.2, l.z); group.add(p); return p; });
  const moonL = new THREE.DirectionalLight(0x8fa6ff, 0.28); moonL.position.set(-30, 60, -40); group.add(moonL);
  // glows round every lamp at night (floodlights, street lamps, the galleries' tube lights)
  // (two point clouds — big and small — not a sprite per lamp: two draw calls, not twenty)
  const flare = radialTexture('rgba(255,236,200,0.95)', 'rgba(255,190,110,0)', 128);
  const glows = [true, false].map(big => {
    const pts = K.lamps.filter(p => (p.y > 8) === big).flatMap(p => [p.x, p.y - 0.05, p.z]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ map: flare, color: big ? 0xfff0d8 : 0xffd6a0, size: big ? 3.6 : 1.3, sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: big ? 0.85 : 0.6 }));
    m.name = 'street:glow'; group.add(m); return m;
  });

  // ---------------------------------------------------------------- the presets
  const fogDay = new THREE.FogExp2(0xe8c6a0, 0.0062), fogNight = new THREE.FogExp2(0x111827, 0.0075);
  venue.setTime = (tod) => {
    const night = tod === 'night';
    venue.tod = tod;
    W.uNight.value = night ? 1 : 0;
    sun.visible = bounce.visible = !night; moon.visible = moonL.visible = night;
    hemi.color.set(night ? 0x24315a : 0xa9c8ea); hemi.groundColor.set(night ? 0x2a1e14 : 0x9a7a58); hemi.intensity = night ? 0.5 : 1.35;
    floods.forEach(s => { s.visible = night; }); sodium.forEach(p => { p.visible = night; }); glows.forEach(g => { g.visible = night; });
    venue.fog = night ? fogNight : fogDay;
    venue.lights = night ? floods : [sun];
  };
  venue.flare = (k) => { floods.forEach(s => { s.intensity = 1150 * (1 + k * 0.5); }); };
  venue.setTime('golden');
  return { sun, floods, hemi };
}
