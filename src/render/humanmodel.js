// =====================================================================
// The players' bodies: one realistic human (MakeHuman, CC0 — tools/characters/) loaded
// once and cloned per player, dressed in the team's kit and given his own look: skin tone,
// eyes, hair, body type (morph targets), height.
//
// It is driven by the procedural animation skeleton in athlete.js (the gait, leg IK,
// actions): every frame each of its bones' rotations is retargeted onto the human rig.
// Calibration matches the two rest poses bone by bone (arms brought down from the
// model's A-pose, legs straight), so for every mapped bone
//     human world rotation = driver world rotation · C   (C fixed at load)
// and the pelvis follows the driver's hips. The driver is scaled so its legs are exactly
// the model's: a foot the IK plants stays planted on the mesh.
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { clamp } from '../util/math.js';

const BASE = 'assets/players/';
let MODEL = null;                    // { scene, info, tex, rest }
let LOW = false;                     // the lowest graphics level: plain materials
const BODIES = new Set();
// Plain (standard) materials for the skin, eyes and hair at the lowest graphics level —
// phones — and the full physical ones (sheen, clearcoat) above it.
export function setHumanDetail(low) {
  if (low === LOW) return;
  LOW = low;
  for (const b of BODIES) b.useDetail();
}

// The driver bones (athlete.js) → the human rig's bones.
export const MAP = {
  hips: 'pelvis', head: 'head',
  armL: 'upperarm_l', foreL: 'lowerarm_l', armR: 'upperarm_r', foreR: 'lowerarm_r',
  thighL: 'thigh_l', shinL: 'calf_l', footL: 'foot_l', thighR: 'thigh_r', shinR: 'calf_r', footR: 'foot_r',
};
// Directions the limbs point in the driver's rest pose (root space): the human's rest
// pose is brought to these before the offsets are taken.
const DOWN = new THREE.Vector3(0, -1, 0);
const ALIGN_DOWN = ['upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r'];
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

export async function loadHumanModel(onProgress) {
  if (MODEL) return MODEL;
  const [gltf, info, texList] = await Promise.all([
    new GLTFLoader().loadAsync(BASE + 'player_base.glb', onProgress),
    fetch(BASE + 'player_base.json').then(r => r.json()),
    fetch(BASE + 'textures.json').then(r => r.json()),
  ]);
  const loader = new THREE.TextureLoader();
  const tex = {};
  await Promise.all(Object.entries(texList).filter(([slot]) => slot !== 'kitLayout' && slot !== 'kitMask').flatMap(([slot, maps]) => Object.entries(maps).map(async ([kind, t]) => {
    const tx = await loader.loadAsync(BASE + t.file);
    tx.colorSpace = kind === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tx.flipY = false;                                   // glTF UV convention
    tx.anisotropy = 4;
    (tex[slot] || (tex[slot] = {}))[kind] = tx;
  })));
  tex.skinDetail = skinDetailNormal();
  // the kit mask as pixels (the kit painter reads it)
  const img = await createImageBitmap(await (await fetch(BASE + texList.kitMask.diffuse.file)).blob());
  const mc = document.createElement('canvas'); mc.width = img.width; mc.height = img.height;
  const mg = mc.getContext('2d'); mg.drawImage(img, 0, 0);
  tex.kitMaskData = mg.getImageData(0, 0, img.width, img.height);
  tex.kitLayout = texList.kitLayout;
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  // Rest measurements (metres, model space).
  const bone = n => scene.getObjectByName(n);
  const wp = n => bone(n).getWorldPosition(new THREE.Vector3());
  const rest = {
    thigh: wp('thigh_l').distanceTo(wp('calf_l')),
    shin: wp('calf_l').distanceTo(wp('foot_l')),
    ankle: wp('foot_l').y,
    ball: Math.hypot(wp('ball_l').x - wp('foot_l').x, wp('ball_l').z - wp('foot_l').z),
    hipJoint: wp('thigh_l').y,
    hipCentre: wp('thigh_l').add(wp('thigh_r')).multiplyScalar(0.5),
    pelvis: wp('pelvis'),
    hipX: Math.abs(wp('thigh_l').x),
  };
  MODEL = { scene, info, tex, rest };
  return MODEL;
}
export const humanModel = () => MODEL;

// A tiny tiling normal map (skin micro-relief), so the skin isn't smooth plastic.
function skinDetailNormal() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const h = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) h[i] = r();
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x; h[i] = (h[i] * 2 + h[((y + 1) % N) * N + x] + h[y * N + (x + 1) % N]) / 4;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, dx = h[y * N + (x + 1) % N] - h[i], dy = h[((y + 1) % N) * N + x] - h[i];
    img.data[i * 4] = 128 + dx * 255; img.data[i * 4 + 1] = 128 + dy * 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40); t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ------------------------------------------------------------------ the kit
// A team's kit painted from the mask (shirt, trim, shorts), once per colourway; each
// player's copy then gets his name and number on the back and a small one on the chest.
const kitBases = new Map();
function kitBase(shirt, trim, shorts) {
  const key = shirt + trim + shorts;
  if (kitBases.has(key)) return kitBases.get(key);
  const D = MODEL.tex.kitMaskData, N = D.width, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), out = g.createImageData(N, N);
  const S = new THREE.Color(shirt), T = new THREE.Color(trim), H = new THREE.Color(shorts);
  const rgb = col => [Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255)];
  const [s, t, h] = [rgb(S), rgb(T), rgb(H)];
  const lower = Math.round(N * 0.385) * N * 4;          // the jeans half of the layout: shorts
  for (let i = 0; i < N * N * 4; i += 4) {
    const trimW = D.data[i + 1] / 255;
    const base = i >= lower ? h : s;
    for (let k = 0; k < 3; k++) out.data[i + k] = base[k] * (1 - trimW) + t[k] * trimW;
    out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  kitBases.set(key, c);
  return c;
}
function kitTexture(kitC, number, name) {
  const base = kitBase(kitC.shirt, kitC.trim, kitC.shorts), N = base.width;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  g.drawImage(base, 0, 0);
  const L = MODEL.tex.kitLayout, ink = kitC.number;
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  // the back: the name across the shoulders, the number big below it
  const [bx0, by0, bx1, by1] = L.back.map(v => v * N), bx = (bx0 + bx1) / 2, bh = by1 - by0;
  g.font = `700 ${Math.round(bh * 0.085)}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
  g.fillText(String(name).toUpperCase(), bx, by0 + bh * 0.2);
  g.font = `900 ${Math.round(bh * 0.42)}px Impact, "Arial Black", Arial, sans-serif`;
  g.fillText(String(number), bx, by0 + bh * 0.5);
  // the chest: a small number over the heart
  const [fx0, fy0, fx1, fy1] = L.front.map(v => v * N), fh = fy1 - fy0;
  g.font = `900 ${Math.round(fh * 0.12)}px Impact, "Arial Black", Arial, sans-serif`;
  g.fillText(String(number), fx0 + (fx1 - fx0) * 0.68, fy0 + fh * 0.25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ the look
const SKIN_TONES = ['light', 'olive', 'tan', 'dark'];
const HAIR_OF = { short: 'short02', buzz: 'short04', afro: 'afro01', bun: 'short01', mohawk: 'short04' };
const EYES = ['brown', 'brownlight', 'blue', 'green', 'grey', 'brown'];
// boots are the player's own: mostly black or white, some loud
const BOOTS = ['#1d1d22', '#ececec', '#1d1d22', '#ececec', '#ff6a2a', '#38c6ff', '#d4ff3a', '#ff3d7f'];

// Player look → model choices (deterministic per player).
export function lookOf(p) {
  const L = p.look, k = (p.id * 2654435761) >>> 0, u = n => ((k >>> (n * 3)) & 7) / 7;
  // skin: the 6 tones of the old palette onto the 4 textures, light → dark, with a tint
  const skinIdx = ['#eac3a6', '#d6a488', '#b98064', '#8f5f45', '#6b4533', '#4b3126'].indexOf(L.skin);
  const tone = SKIN_TONES[[0, 1, 1, 2, 3, 3][Math.max(0, skinIdx)]];
  const tint = [1, 0.96, 1, 1, 1, 0.82][Math.max(0, skinIdx)];
  // body type by archetype, subtly
  const B = {
    Speedster: { lean: 0.7, strong: 0.1, stocky: 0 }, Trickster: { lean: 0.55, strong: 0, stocky: 0.1 },
    Playmaker: { lean: 0.35, strong: 0.15, stocky: 0 }, Finisher: { lean: 0.1, strong: 0.45, stocky: 0.1 },
    Enforcer: { lean: 0, strong: 0.6, stocky: 0.35 }, Keeper: { lean: 0.1, strong: 0.35, stocky: 0.15 },
  }[p.arch] || { lean: 0.3, strong: 0.2, stocky: 0 };
  const height = (p.line === 'GK' ? 1.86 : p.arch === 'Trickster' ? 1.72 : p.arch === 'Enforcer' ? 1.85 : 1.79) + (u(1) - 0.5) * 0.06;
  return { tone, tint, body: B, height, hair: HAIR_OF[L.hairStyle] || 'short02', hairColor: L.hair, eyes: EYES[Math.floor(u(2) * 5.99)], boot: BOOTS[(k >>> 9) & 7] };
}

// ------------------------------------------------------------------ one player's body
export class HumanBody {
  // kitC: { shirt, shorts, socks, trim, number (ink) }
  constructor(p, kitC) {
    const M = MODEL, look = this.look = lookOf(p);
    this.group = SkeletonUtils.clone(M.scene);
    this.scale = look.height / M.info.height;
    this.group.scale.setScalar(this.scale);
    this.bones = {};
    this.meshes = [];
    this.group.traverse(o => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) { this.meshes.push(o); o.castShadow = true; o.frustumCulled = false; }
    });
    // one skeleton for all his meshes (glTF gives each its own: ten bone updates and
    // uploads a frame instead of one) — they share the skin, so the bind poses match
    const skel = this.meshes[0].skeleton;
    for (const m of this.meshes) {
      if (m.skeleton !== skel && m.skeleton.bones.length === skel.bones.length && m.skeleton.boneInverses.every((b, i) => b.equals(skel.boneInverses[i]))) m.skeleton = skel;
    }
    // body type: the morph targets blended once into the player's own geometry (they never
    // change, and the vertex shader then skips them every frame)
    for (const m of this.meshes) bakeMorphs(m, look.body);
    // materials and the chosen hair
    const T = M.tex, rim = rimLight;
    const skin = new THREE.MeshPhysicalMaterial({
      map: T['skin_' + look.tone].diffuse, color: new THREE.Color(look.tint, look.tint, look.tint),
      roughness: 0.52, specularIntensity: 0.35, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color(0.55, 0.22, 0.16),
      normalMap: T.skinDetail, normalScale: new THREE.Vector2(0.12, 0.12),
    });
    const kitMap = kitTexture(kitC, p.number, p.name);
    const cloth = (normalScale = 1) => rim(new THREE.MeshStandardMaterial({
      map: kitMap, roughness: 0.82, metalness: 0, normalMap: T.kit.normal, normalScale: new THREE.Vector2(normalScale, normalScale),
      aoMap: T.kit.ao, aoMapIntensity: 0.9, side: THREE.DoubleSide,
    }));
    const mats = {
      skin,
      socks: rim(new THREE.MeshStandardMaterial({ color: kitC.socks, roughness: 0.9, normalMap: T.skinDetail, normalScale: new THREE.Vector2(0.4, 0.4) })),
      shirt: cloth(), shorts: cloth(0.55),
      boots: new THREE.MeshStandardMaterial({ map: T.boots.diffuse, color: look.boot, roughness: 0.4, metalness: 0.05 }),
      eyes: new THREE.MeshPhysicalMaterial({ map: T['eye_' + look.eyes].diffuse, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03 }),
      brows: new THREE.MeshStandardMaterial({ map: T.brows.diffuse, color: look.hairColor, transparent: true, alphaTest: 0.05, depthWrite: false, roughness: 0.8 }),
      lashes: new THREE.MeshStandardMaterial({ map: T.lashes.diffuse, color: '#111111', transparent: true, alphaTest: 0.05, depthWrite: false }),
    };
    const hairKey = 'hair_' + look.hair;
    mats[hairKey] = new THREE.MeshPhysicalMaterial({
      map: T[hairKey].diffuse, normalMap: T[hairKey].normal || null, color: new THREE.Color(look.hairColor).multiplyScalar(1.6),
      alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.62, sheen: 0.5, sheenRoughness: 0.45, sheenColor: new THREE.Color(0.35, 0.3, 0.25),
    });
    // the same looks, cheaper, for the lowest graphics level
    const plain = (src, extra = {}) => new THREE.MeshStandardMaterial({ map: src.map, color: src.color, roughness: src.roughness, normalMap: src.normalMap, normalScale: src.normalScale, alphaTest: src.alphaTest, side: src.side, ...extra });
    this.lowMats = { skin: plain(skin), eyes: plain(mats.eyes, { roughness: 0.2 }), [hairKey]: plain(mats[hairKey]) };
    this.slots = [];
    for (const m of this.meshes) {
      const name = m.material.name;
      if (name.startsWith('hair_') && name !== hairKey) { m.visible = false; continue; }
      if (mats[name]) this.slots.push([m, name]);
      if (name === 'brows' || name === 'lashes' || name === 'eyes') m.castShadow = false;
    }
    this.mats = mats;
    this.kitMap = kitMap;
    this.useDetail();
    BODIES.add(this);
    this.calibrate();
  }

  useDetail() {
    for (const [m, name] of this.slots) m.material = (LOW && this.lowMats[name]) || this.mats[name];
  }

  dispose() {
    BODIES.delete(this);
    this.kitMap.dispose();
    for (const m of [...Object.values(this.mats), ...Object.values(this.lowMats)]) m.dispose();
    for (const m of this.meshes) m.geometry.dispose();
  }

  // The constant offsets C (see the header), from the two rest poses; and every bone's
  // rest rotation (the ones not driven keep it under their parent).
  calibrate() {
    const g = this.group, q = new THREE.Quaternion(), dir = new THREE.Vector3(), align = new THREE.Quaternion();
    g.updateMatrixWorld(true);
    const groupInv = g.getWorldQuaternion(new THREE.Quaternion()).invert();
    const restWorld = b => groupInv.clone().multiply(b.getWorldQuaternion(q));
    this.C = {};
    this.all = [];                       // every bone, parents first
    this.restLocal = {};
    g.traverse(o => { if (o.isBone) { this.all.push(o); this.restLocal[o.name] = o.quaternion.clone(); } });
    for (const b of this.all) {
      const w = restWorld(b);
      align.identity();
      if (ALIGN_DOWN.includes(b.name)) {
        dir.set(0, 1, 0).applyQuaternion(w);                 // a bone points along its +Y
        align.setFromUnitVectors(dir, DOWN);
      }
      this.C[b.name] = align.multiply(w).clone();             // the bone in the driver's rest pose
    }
    // fingers relaxed into a loose fist
    this.curl = {};
    for (const side of ['l', 'r']) {
      for (const f of FINGERS) for (let j = 1; j <= 3; j++) this.curl[`${f}_0${j}_${side}`] = [0.35, 0.6, 0.45][j - 1];
      for (let j = 2; j <= 3; j++) this.curl[`thumb_0${j}_${side}`] = 0.25;
    }
    // the pelvis's position lives in the (rotated) rig root's frame
    const root = this.bones.pelvis.parent;
    this.rootInv = new THREE.Matrix4().compose(root.position, root.quaternion, root.scale).invert();
    this.restPelvisG = MODEL.rest.pelvis.clone();
  }

  // Pose the human from the driver: J = the driver's bones, root = the athlete's root
  // group, hips = the driver's hip-joint centre in root space (metres), heel: { L, R }.
  update(J, root, hips, heel) {
    const rootInv = _q0.copy(root.getWorldQuaternion(_q1)).invert();
    const W = this._w || (this._w = {});
    const drv = n => (W[n] || (W[n] = new THREE.Quaternion())).copy(rootInv).multiply(J[n].getWorldQuaternion(_q2));
    for (const n of Object.keys(MAP)) drv(n);
    drv('spine');
    const T = this._t || (this._t = {});
    const set = (k, q) => (T[k] || (T[k] = new THREE.Quaternion())).copy(q);
    set('pelvis', W.hips);
    set('spine_01', W.hips).slerp(W.spine, 0.4);
    set('spine_02', W.hips).slerp(W.spine, 0.75);
    set('spine_03', W.spine);
    set('neck_01', W.spine).slerp(W.head, 0.5);
    set('head', W.head);
    for (const s of ['L', 'R']) {
      const l = s.toLowerCase();
      set('upperarm_' + l, W['arm' + s]);
      set('lowerarm_' + l, W['fore' + s]);
      set('hand_' + l, W['fore' + s]);
      set('thigh_' + l, W['thigh' + s]);
      set('calf_' + l, W['shin' + s]);
      set('foot_' + l, W['foot' + s]);
      set('ball_' + l, W['foot' + s]);
    }
    // world → local, parents first; the bones not driven keep their rest under their parent
    const world = this._world || (this._world = {});
    for (const b of this.all) {
      const name = b.name, pw = b.parent && b.parent.isBone ? world[b.parent.name] : null;
      const wq = world[name] || (world[name] = new THREE.Quaternion());
      if (T[name]) wq.copy(T[name]).multiply(this.C[name]);
      else if (pw) wq.copy(pw).multiply(this.restLocal[name]);
      else wq.copy(this.restLocal[name]);
      if (pw) b.quaternion.copy(pw).invert().multiply(wq); else b.quaternion.copy(wq);
      // local touches: fingers curl, toes bend as the heel comes up
      const c = this.curl[name];
      if (c) b.quaternion.multiply(_qx.setFromAxisAngle(_az, c));
      if (name === 'ball_l' || name === 'ball_r') {
        const h = heel[name === 'ball_l' ? 'L' : 'R'] || 0;
        if (h > 0.01) b.quaternion.multiply(_qx.setFromAxisAngle(_ax, -h));
      }
      if (c || name.startsWith('ball_')) wq.copy(pw || _qi).multiply(b.quaternion);
    }
    // the pelvis follows the driver's hip joints: their centre onto the model's
    const k = 1 / this.scale, R = MODEL.rest;
    _v0.set(this.restPelvisG.x + hips.x * k - R.hipCentre.x, this.restPelvisG.y + hips.y * k - R.hipCentre.y, this.restPelvisG.z + hips.z * k - R.hipCentre.z);
    this.bones.pelvis.position.copy(_v0.applyMatrix4(this.rootInv));
  }
}
// Blend a mesh's (relative) morph targets into a copy of its geometry and drop them.
function bakeMorphs(m, weights) {
  const src = m.geometry, dict = m.morphTargetDictionary;
  const g = m.geometry = src.clone();
  if (dict) for (const attr of ['position', 'normal']) {
    const base = g.attributes[attr], morphs = src.morphAttributes[attr];
    if (!base || !morphs) continue;
    const out = base.array;
    for (const [k, w] of Object.entries(weights)) {
      const i = dict[k];
      if (i == null || !w || !morphs[i]) continue;
      const d = morphs[i].array;
      for (let j = 0; j < out.length; j++) out[j] += d[j] * w;
    }
    if (attr === 'normal') for (let j = 0; j < out.length; j += 3) {
      const l = Math.hypot(out[j], out[j + 1], out[j + 2]) || 1;
      out[j] /= l; out[j + 1] /= l; out[j + 2] /= l;
    }
  }
  g.morphAttributes = {};
  g.morphTargetsRelative = false;
  m.morphTargetInfluences = undefined;
  m.morphTargetDictionary = undefined;
}

const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qx = new THREE.Quaternion();
const _ax = new THREE.Vector3(1, 0, 0), _az = new THREE.Vector3(0, 0, 1), _v0 = new THREE.Vector3(), _qi = new THREE.Quaternion();

// Broadcast rim light on the kit (silhouettes read against the night).
function rimLight(m) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += vec3(1.0, 0.92, 0.8) * rim * 0.22 * diffuseColor.rgb;
      }`);
  };
  m.customProgramCacheKey = () => 'human-rim';
  return m;
}
