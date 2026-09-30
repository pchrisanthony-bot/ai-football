// Renderer + post-processing: ACES tone mapping, bloom, and a grade pass
// (vignette, contrast, GAMEBREAKER colour shift, goal flash).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.9 },
    uGB: { value: 0 },          // 0..1 GAMEBREAKER intensity
    uGBColor: { value: new THREE.Color(1, 0.8, 0.1) },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uSat: { value: 1.08 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette, uGB, uFlash, uTime, uSat; uniform vec3 uGBColor; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      // subtle chromatic split during GAMEBREAKER
      vec2 dc = (uv - 0.5) * 0.004 * uGB;
      vec3 c = vec3(texture2D(tDiffuse, uv + dc).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dc).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSat);
      // GAMEBREAKER: desaturate the world, push toward the team tint
      c = mix(c, mix(vec3(l) * 1.1, uGBColor * l * 1.6, 0.45), uGB * 0.55);
      // S-curve contrast
      c = c * c * (3.0 - 2.0 * c) * 0.25 + c * 0.75;
      float d = distance(uv, vec2(0.5));
      c *= mix(1.0, smoothstep(0.85, 0.25, d), uVignette * 0.55);
      c += uFlash;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, container.clientWidth / container.clientHeight, 0.1, 2000);

  const size = new THREE.Vector2(container.clientWidth, container.clientHeight);
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(size, 0.55, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  // Quality presets. Shadow-casting floodlights are the big cost on integrated GPUs.
  const QUALITY = [
    { name: 'LOW', dpr: 0.75, shadows: 0, bloom: false, samples: 0 },
    { name: 'MEDIUM', dpr: 1.0, shadows: 1, bloom: true, samples: 2 },
    { name: 'HIGH', dpr: 1.25, shadows: 2, bloom: true, samples: 4 },
    { name: 'ULTRA', dpr: 1.75, shadows: 4, bloom: true, samples: 4 },
  ];
  const state = { level: -1, lights: [], blobs: [] };
  const setQuality = (level) => {
    level = Math.max(0, Math.min(QUALITY.length - 1, level));
    if (level === state.level) return QUALITY[level];
    const q = QUALITY[level];
    state.level = level;
    const pr = Math.min(window.devicePixelRatio, q.dpr);
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    renderer.shadowMap.enabled = q.shadows > 0;
    // cast from opposite corners first so shadows stay balanced
    state.lights.forEach((l, i) => { l.castShadow = [0, 3, 1, 2].indexOf(i) < q.shadows; });
    bloom.enabled = q.bloom;
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = q.samples; rt.dispose(); }
    for (const b of state.blobs) b.visible = q.shadows === 0;
    scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
    onResize();
    return q;
  };

  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, composer, bloom, grade, onResize, setQuality, QUALITY, quality: state };
}
