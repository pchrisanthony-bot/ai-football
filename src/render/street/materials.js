// =====================================================================
// The street's materials, and the global weathering every one of them reads:
//   W.weather   streaking under sills and slabs (monsoon runs)
//   W.dirt      grime patches
//   W.moist     damp: concrete darker toward the ground, a little moss in it
//   W.fade      sun-faded paint (toward a chalky, desaturated version of itself)
//   W.rust      rust on metal (patches and runs)
//   W.wet       rain: darker and glossier
//   W.night     0 day … 1 night (lit windows, signs and shops)
//   W.wind      wind direction (xz) and strength, for cloth, wires and laundry
// One shared uniform set: a weather change touches every material at once.
// =====================================================================
import * as THREE from 'three';

export const W = {
  uWeather: { value: 0.65 }, uDirt: { value: 0.55 }, uMoist: { value: 0.6 }, uFade: { value: 0.45 }, uRust: { value: 0.6 },
  uWet: { value: 0 }, uNight: { value: 0 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector3(0.8, 0, 0.35) },
};

const NOISE = `
  float wHash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float wNoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wHash(i), wHash(i + vec3(1,0,0)), f.x), mix(wHash(i + vec3(0,1,0)), wHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(wHash(i + vec3(0,0,1)), wHash(i + vec3(1,0,1)), f.x), mix(wHash(i + vec3(0,1,1)), wHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

// kind: 'wall' (paint/plaster weathering) · 'metal' (rust) · 'ground' (dirt, damp, wet
// gloss) · 'decal' (posters, signs, windows: a lighter touch, lit at night) · 'cloth' (wind)
// · 'wire' (sways in the wind) · 'plain' (props: only the rain darkens them)
// chips: the map's alpha is paint (0 where it has flaked off to bare plaster)
export function weatherize(mat, kind = 'wall', { strength = 1, chips = false } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev && prev.call(mat, sh, r);
    Object.assign(sh.uniforms, W);
    sh.uniforms.uStrength = { value: strength };
    const wind = kind === 'cloth' || kind === 'wire';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec3 uWind;
        varying vec3 vWPos; varying vec3 vWNrm;
        ${wind ? 'attribute float aSway; attribute float aPhase;' : ''}
        ${kind === 'decal' ? 'attribute float aLit; varying float vLit;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${kind === 'cloth' ? `{
          // hanging cloth: the free edge swings with the wind (two frequencies, per-piece phase)
          float s = aSway * (0.55 + 0.45 * sin(uTime * 1.7 + aPhase * 6.28));
          float g = sin(uTime * 2.3 + aPhase * 9.0 + position.x * 1.3) * 0.5 + sin(uTime * 5.1 + aPhase * 3.0) * 0.18;
          transformed += vec3(uWind.x, 0.0, uWind.z) * s * (0.12 + 0.1 * g) + vec3(0.0, 0.04, 0.0) * s * g;
        }` : ''}
        ${kind === 'wire' ? `{
          float s = aSway * (sin(uTime * 1.1 + aPhase * 6.28) * 0.6 + sin(uTime * 2.7 + aPhase * 3.1) * 0.25);
          transformed += vec3(uWind.z, 0.0, -uWind.x) * s * 0.06;
        }` : ''}
        ${kind === 'decal' ? 'vLit = aLit;' : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 wp4 = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp4 = instanceMatrix * wp4;
          #endif
          vWPos = (modelMatrix * wp4).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWeather, uDirt, uMoist, uFade, uRust, uWet, uNight, uStrength;
        varying vec3 vWPos; varying vec3 vWNrm;
        ${kind === 'decal' ? 'varying float vLit;' : ''}
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float wn = wNoise(vWPos * 0.31) * 0.6 + wNoise(vWPos * 1.9) * 0.4;   // patchiness
          float vert = 1.0 - abs(vWNrm.y);
          vec3 c = diffuseColor.rgb;
          ${chips ? `#ifdef USE_MAP
          { float painted = smoothstep(0.75, 0.95, texture2D(map, vMapUv).a); c = mix(sampledDiffuseColor.rgb * vec3(0.7, 0.67, 0.62), c, mix(1.0, painted, uFade)); }   // paint flaked off: bare plaster
          #endif` : ''}
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          ${kind === 'wall' || kind === 'decal' || kind === 'metal' ? `
          // sun-faded paint
          c = mix(c, vec3(l) * vec3(1.06, 1.02, 0.95) + 0.04, uFade * (0.25 + 0.45 * wn) * uStrength);
          // monsoon runs: streaks down vertical faces
          float sk = wNoise(vec3((vWPos.x + vWPos.z) * 2.1, vWPos.y * 0.11, 3.7)) * 0.75 + wNoise(vec3((vWPos.x + vWPos.z) * 7.0, vWPos.y * 0.4, 1.3)) * 0.25;
          float streak = smoothstep(0.58, 0.9, sk) * vert * uWeather * uStrength;
          // grime and the damp band at the foot of the wall
          float dirt = smoothstep(0.4, 0.9, wn) * uDirt * uStrength;
          float damp = smoothstep(1.2 + wn * 1.1, 0.0, vWPos.y) * uMoist * vert;
          c *= 1.0 - 0.34 * streak - 0.2 * dirt - 0.38 * damp;
          c = mix(c, c * vec3(0.74, 0.86, 0.6), damp * smoothstep(0.55, 0.85, wn) * 0.55);   // moss in the damp
          ` : ''}
          ${kind === 'metal' ? `
          float rs = smoothstep(0.42, 0.82, wNoise(vWPos * 2.4) * 0.7 + wNoise(vWPos * 8.0) * 0.3) * uRust;
          rs += smoothstep(0.72, 0.95, wNoise(vec3((vWPos.x + vWPos.z) * 5.0, vWPos.y * 0.3, 1.0))) * uRust * 0.7 * vert;
          c = mix(c, vec3(0.36, 0.17, 0.07) * (0.75 + 0.5 * wn), clamp(rs, 0.0, 0.85));
          ` : ''}
          ${kind === 'ground' ? `
          float gd = smoothstep(0.35, 0.9, wn) * uDirt;
          c *= 1.0 - 0.25 * gd;
          c = mix(c, c * vec3(0.8, 0.85, 0.7), smoothstep(0.62, 0.9, wNoise(vWPos * 0.6)) * uMoist * 0.5);
          ` : ''}
          // rain: everything darker (and, below, glossier)
          c *= 1.0 - 0.28 * uWet;
          diffuseColor.rgb = c;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * ${kind === 'ground' ? '0.35' : '0.6'}, uWet);`);
    if (kind === 'decal') {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= uNight * vLit;`);
    }
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => `street-${kind}${chips ? '-chips' : ''}-${key}`;
  return mat;
}
