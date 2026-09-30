// The venue: a floodlit rooftop cage at night, city all around.
import * as THREE from 'three';
import { COURT } from '../config.js';
import { courtTextures, chainLink, netTexture, graffitiBoard, concreteTexture, radialTexture, bannerTexture, sprayTag } from './textures.js';

const { halfL, halfW, wallH, boardH, goalHalfW, goalH, goalD, roofH } = COURT;

// ------------------------------------------------------------------ ripple FX (fence + nets)
// Up to 8 live impacts; vertices are pushed along the surface normal by a decaying ring wave.
function makeRippleUniforms() {
  return {
    uTime: { value: 0 },
    uImpacts: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -100, 0, -100)) },
    uStr: { value: new Array(8).fill(0) },
  };
}
function addRipple(mat, U, { freq = 9, speed = 26, falloff = 1.6, decay = 3.5, bulge = 0 } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec4 uImpacts[8]; uniform float uStr[8];`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float disp = 0.0;
          for (int i = 0; i < 8; i++) {
            float age = uTime - uImpacts[i].w;
            if (age < 0.0 || age > 2.0) continue;
            float d = distance(wp, uImpacts[i].xyz);
            float env = exp(-d * ${falloff.toFixed(2)}) * exp(-age * ${decay.toFixed(2)}) * uStr[i];
            disp += env * (sin(d * ${freq.toFixed(1)} - age * ${speed.toFixed(1)}) + ${bulge.toFixed(2)});
          }
          transformed += objectNormal * disp;
        }`);
  };
  mat.customProgramCacheKey = () => `ripple${freq}${speed}${bulge}`;
}
class Ripples {
  constructor() { this.U = makeRippleUniforms(); this.i = 0; }
  hit(x, y, z, strength) {
    const k = this.i++ % 8;
    this.U.uImpacts.value[k].set(x, y, z, this.U.uTime.value);
    this.U.uStr.value[k] = strength;
  }
  update(t) { this.U.uTime.value = t; }
}

export function buildVenue(scene, renderer) {
  const venue = { fence: new Ripples(), nets: new Ripples(), nearFade: [], lights: [], animated: [] };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ---------------------------------------------------------------- sky
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){
        float h = vDir.y;
        vec3 top = vec3(0.012, 0.018, 0.05);
        vec3 mid = vec3(0.04, 0.035, 0.11);
        vec3 glow = vec3(0.38, 0.16, 0.12);
        vec3 col = mix(mid, top, smoothstep(0.05, 0.6, h));
        col = mix(glow, col, smoothstep(-0.05, 0.22, h));
        // stars
        vec3 q = floor(vDir * 420.0);
        float s = step(0.9975, hash(q)) * smoothstep(0.15, 0.5, h);
        col += vec3(s) * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);
  // moon
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,250,235,1)', 'rgba(255,250,235,0)', 128), color: 0xfff6e0, fog: false, depthWrite: false }));
  moon.position.set(-260, 260, -520); moon.scale.set(60, 60, 1);
  scene.add(moon);

  scene.fog = new THREE.FogExp2(0x0b0d1a, 0.0065);

  // ---------------------------------------------------------------- lights
  scene.add(new THREE.HemisphereLight(0x3a4a7a, 0x121216, 0.55));
  const moonLight = new THREE.DirectionalLight(0x8fa6ff, 0.35);
  moonLight.position.set(-30, 60, -40);
  scene.add(moonLight);

  // Four floodlight masts outside the corners, each a shadow-casting spot.
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x2b2e36, metalness: 0.8, roughness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff4dc, emissiveIntensity: 6 });
  const flare = radialTexture('rgba(255,244,220,0.9)', 'rgba(255,200,120,0)', 256);
  venue.flicker = null;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // The far-right mast has a dying lamp: it buzzes and stutters now and then.
    const dying = sx === 1 && sz === -1;
    const lm = dying ? lampMat.clone() : lampMat;
    const bx = sx * (halfL + 3.2), bz = sz * (halfW + 3.2), top = 12;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, top, 12), mastMat);
    mast.position.set(bx, top / 2, bz); mast.castShadow = false;
    scene.add(mast);
    const head = new THREE.Group();
    head.position.set(bx, top, bz);
    head.lookAt(sx * 4, 0, sz * 2);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.35), mastMat);
    head.add(frame);
    for (let i = 0; i < 6; i++) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.05), lm);
      lamp.position.set(-0.7 + (i % 3) * 0.7, i < 3 ? 0.22 : -0.22, 0.19);
      head.add(lamp);
    }
    scene.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare, color: 0xffe9c4, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    glow.scale.set(5, 5, 1); glow.position.set(bx - sx * 0.3, top, bz - sz * 0.3);
    scene.add(glow);

    const spot = new THREE.SpotLight(0xfff1dc, 1500, 0, 0.78, 0.6, 2);
    spot.position.set(bx, top, bz);
    spot.target.position.set(sx * 3, 0, sz * 1.5);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 4; spot.shadow.camera.far = 50;
    spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.03;
    spot.shadow.radius = 3;
    scene.add(spot, spot.target);
    venue.lights.push(spot);
    if (dying) venue.flicker = { spot, glow, mat: lm };

    // Volumetric-ish light cone (additive, fades with length).
    const coneLen = 16;
    const coneGeo = new THREE.ConeGeometry(6.5, coneLen, 32, 1, true);
    coneGeo.translate(0, -coneLen / 2, 0);
    const coneMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uLen: { value: coneLen } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = position.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uLen; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float along = clamp(-vY / uLen, 0.0, 1.0); float rim = pow(abs(dot(vN, vV)), 1.5);
          float a = (1.0 - along) * (1.0 - along) * rim * 0.035; gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, 1.0); }`,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(bx, top, bz);
    const dir = new THREE.Vector3(sx * 3 - bx, -top, sz * 1.5 - bz).normalize();
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    scene.add(cone);
  }

  // ---------------------------------------------------------------- rooftop floor & parapet
  const conc = concreteTexture();
  conc.repeat.set(24, 18); conc.anisotropy = maxAniso;
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(64, 48), new THREE.MeshStandardMaterial({ map: conc, roughness: 0.95, metalness: 0 }));
  roof.rotation.x = -Math.PI / 2; roof.position.y = -0.02; roof.receiveShadow = true;
  scene.add(roof);
  const parapetMat = new THREE.MeshStandardMaterial({ color: 0x2c2d33, roughness: 0.9 });
  for (const [w, d, x, z] of [[64, 0.4, 0, -24], [64, 0.4, 0, 24], [0.4, 48, -32, 0], [0.4, 48, 32, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), parapetMat);
    m.position.set(x, 0.55, z); m.receiveShadow = true;
    scene.add(m);
  }

  // ---------------------------------------------------------------- court
  const { map, roughness } = courtTextures();
  map.anisotropy = maxAniso;
  const court = new THREE.Mesh(
    new THREE.PlaneGeometry(halfL * 2, halfW * 2),
    new THREE.MeshStandardMaterial({ map, roughnessMap: roughness, roughness: 0.85, metalness: 0.0 }),
  );
  court.rotation.x = -Math.PI / 2;
  court.receiveShadow = true;
  scene.add(court);
  // goal floors
  for (const s of [-1, 1]) {
    const gf = new THREE.Mesh(new THREE.PlaneGeometry(goalD, goalHalfW * 2), new THREE.MeshStandardMaterial({ color: 0x1b1c21, roughness: 0.95 }));
    gf.rotation.x = -Math.PI / 2; gf.position.set(s * (halfL + goalD / 2), 0.001, 0); gf.receiveShadow = true;
    scene.add(gf);
  }

  // ---------------------------------------------------------------- cage
  const chain = chainLink();
  chain.anisotropy = maxAniso;
  // Blended (not cut out) so the mesh mips down to a believable haze at distance.
  const fenceBase = { color: 0xb4bcc8, metalness: 0.7, roughness: 0.4, alphaMap: chain, side: THREE.DoubleSide, transparent: true, depthWrite: false };
  const fenceMat = new THREE.MeshStandardMaterial({ ...fenceBase, opacity: 1 });
  addRipple(fenceMat, venue.fence.U, { freq: 8, speed: 22, falloff: 1.4, decay: 3.2 });
  const nearFenceMat = new THREE.MeshStandardMaterial({ ...fenceBase, opacity: 0.28 });
  addRipple(nearFenceMat, venue.fence.U, { freq: 8, speed: 22, falloff: 1.4, decay: 3.2 });
  const cell = 0.11; // chain-link diamond size in metres

  const fencePanel = (len, h, near) => {
    const g = new THREE.PlaneGeometry(len, h, Math.max(2, Math.round(len * 3)), Math.max(2, Math.round(h * 3)));
    const m = new THREE.Mesh(g, near ? nearFenceMat : fenceMat);
    // per-panel UV repeat
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / cell, uv.getY(i) * h / cell);
    return m;
  };
  const posts = [];
  const addPost = (x, z, h = wallH) => posts.push([x, z, h]);

  const boardMatFor = (seed, len, near) => {
    const t = graffitiBoard(seed, len);
    t.anisotropy = maxAniso;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.65, metalness: 0.1, transparent: near, opacity: near ? 0.35 : 1, depthWrite: !near });
  };
  const trimMat = venue.trimMat = new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0x332a00 });
  const addBoard = (len, x, z, rotY, seed, near) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, boardH, 0.08), [
      new THREE.MeshStandardMaterial({ color: 0x15161b }), new THREE.MeshStandardMaterial({ color: 0x15161b }),
      trimMat, new THREE.MeshStandardMaterial({ color: 0x15161b }),
      boardMatFor(seed, len, near), boardMatFor(seed + 50, len, near),
    ]);
    m.position.set(x, boardH / 2, z); m.rotation.y = rotY;
    m.receiveShadow = true; m.castShadow = !near;
    scene.add(m);
    if (near) venue.nearFade.push(m);
    return m;
  };

  // Side walls (z = ±halfW). The camera sits at +z, so that one is see-through.
  for (const s of [-1, 1]) {
    const near = s > 0;
    const f = fencePanel(halfL * 2, wallH - boardH, near);
    f.position.set(0, boardH + (wallH - boardH) / 2, s * halfW);
    scene.add(f);
    addBoard(halfL * 2, 0, s * (halfW + 0.04), s > 0 ? Math.PI : 0, s > 0 ? 3 : 4, near);
    if (!near) for (let x = -halfL; x <= halfL + 0.01; x += 4) addPost(x, s * (halfW + 0.06), wallH + 0.1);
  }
  // End walls with the goal mouth cut out.
  for (const s of [-1, 1]) {
    const x = s * halfL;
    const sideLen = halfW - goalHalfW;
    for (const zs of [-1, 1]) {
      const zc = zs * (goalHalfW + sideLen / 2);
      const f = fencePanel(sideLen, wallH - boardH, false);
      f.position.set(x, boardH + (wallH - boardH) / 2, zc); f.rotation.y = Math.PI / 2;
      scene.add(f);
      addBoard(sideLen, x + s * 0.04, zc, s > 0 ? -Math.PI / 2 : Math.PI / 2, 10 + s * 2 + zs, false);
    }
    const top = fencePanel(goalHalfW * 2, wallH - goalH, false);
    top.position.set(x, goalH + (wallH - goalH) / 2, 0); top.rotation.y = Math.PI / 2;
    scene.add(top);
    for (const z of [-halfW, -halfW / 2, halfW / 2, halfW]) addPost(x + s * 0.06, z, wallH + 0.1);
  }
  // Posts & rails
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3d434d, metalness: 0.85, roughness: 0.35 });
  const postGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 10);
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  const M = new THREE.Matrix4();
  posts.forEach(([x, z, h], i) => { M.compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)); postMesh.setMatrixAt(i, M); });
  postMesh.castShadow = true;
  scene.add(postMesh);
  const rail = (x1, z1, x2, z2, y) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 8), postMat);
    m.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    m.rotation.z = Math.PI / 2; m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    scene.add(m);
  };
  for (const y of [wallH]) {
    rail(-halfL, -halfW, halfL, -halfW, y);
    rail(-halfL, -halfW, -halfL, halfW, y); rail(halfL, -halfW, halfL, halfW, y);
  }
  // Roof net: a sparse grid overhead.
  const rn = netTexture();
  const roofNet = new THREE.Mesh(new THREE.PlaneGeometry(halfL * 2, halfW * 2), new THREE.MeshBasicMaterial({ color: 0x6a7080, alphaMap: rn, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
  rn.repeat.set(halfL * 2 / 0.8, halfW * 2 / 0.8);
  roofNet.rotation.x = Math.PI / 2; roofNet.position.y = roofH;
  scene.add(roofNet);

  // ---------------------------------------------------------------- goals
  const postWhite = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.3, metalness: 0.2, emissive: 0x111111 });
  const netMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, alphaMap: netTexture(), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.8 });
  netMat.alphaMap.anisotropy = maxAniso;
  addRipple(netMat, venue.nets.U, { freq: 5, speed: 10, falloff: 2.2, decay: 2.4, bulge: 0.9 });
  venue.goals = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const x = s * halfL;
    const cyl = (len, r = 0.05) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), postWhite);
    for (const z of [-goalHalfW, goalHalfW]) {
      const p = cyl(goalH); p.position.set(x, goalH / 2, z); p.castShadow = true; g.add(p);
      const back = cyl(goalH, 0.025); back.position.set(x + s * goalD, goalH / 2, z); g.add(back);
      const top = cyl(goalD, 0.025); top.rotation.z = Math.PI / 2; top.position.set(x + s * goalD / 2, goalH, z); g.add(top);
    }
    const bar = cyl(goalHalfW * 2); bar.rotation.x = Math.PI / 2; bar.position.set(x, goalH, 0); bar.castShadow = true; g.add(bar);
    const bbar = cyl(goalHalfW * 2, 0.025); bbar.rotation.x = Math.PI / 2; bbar.position.set(x + s * goalD, goalH, 0); g.add(bbar);
    // nets: back, two sides, roof — subdivided so they can bulge
    const netPanel = (w, h) => {
      const geo = new THREE.PlaneGeometry(w, h, Math.round(w * 8), Math.round(h * 8));
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 0.12, uv.getY(i) * h / 0.12);
      return new THREE.Mesh(geo, netMat);
    };
    const back = netPanel(goalHalfW * 2, goalH); back.rotation.y = Math.PI / 2; back.position.set(x + s * goalD, goalH / 2, 0); g.add(back);
    for (const z of [-goalHalfW, goalHalfW]) { const sd = netPanel(goalD, goalH); sd.position.set(x + s * goalD / 2, goalH / 2, z); g.add(sd); }
    const rf = netPanel(goalD, goalHalfW * 2); rf.rotation.x = Math.PI / 2; rf.position.set(x + s * goalD / 2, goalH, 0); g.add(rf);
    scene.add(g);
    venue.goals.push(g);
  }

  // ---------------------------------------------------------------- rooftop props
  const propMat = new THREE.MeshStandardMaterial({ color: 0x4a4d55, metalness: 0.4, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2026, roughness: 0.8 });
  const box = (w, h, d, x, y, z, mat = propMat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  // AC units
  for (const [x, z] of [[-24, -15], [-21, -15], [22, 15], [25, 15], [26, -14]]) {
    box(2.2, 1.4, 1.4, x, 0.7, z);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), darkMat);
    fan.position.set(x, 1.43, z); scene.add(fan);
    venue.animated.push(t => { fan.rotation.y = t * 6; });
  }
  // Stair hut with a lit door
  box(4, 3, 3, -26, 1.5, 13, new THREE.MeshStandardMaterial({ color: 0x3a3c44, roughness: 0.85 }));
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.1), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffc070, emissiveIntensity: 1.8 }));
  door.position.set(-23.99, 1.05, 13); door.rotation.y = Math.PI / 2; scene.add(door);
  // Water tank on legs
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3.2, 24), new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 }));
  tank.position.set(25, 5.2, -9); tank.castShadow = true; scene.add(tank);
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) box(0.15, 3.6, 0.15, 25 + dx, 1.8, -9 + dz, darkMat);
  // Benches (spectators sit here)
  venue.benches = [];
  for (const x of [-10, -3, 4, 11]) { box(4.2, 0.45, 0.6, x, 0.45, -halfW - 2.6, new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.8 })); venue.benches.push({ x, z: -halfW - 2.6 }); }

  // String lights along the far side — warm bulbs that bloom.
  const bulbs = [];
  const bulbGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc46b, emissiveIntensity: 5 });
  const wirePts = [];
  const zS = -halfW - 1.4;
  for (let x = -halfL; x <= halfL + 0.01; x += 0.25) {
    const seg = ((x + halfL) % 8) / 8;
    const y = wallH + 0.3 - Math.sin(seg * Math.PI) * 0.9;
    wirePts.push(new THREE.Vector3(x, y, zS));
    if (Math.abs((x * 4) % 4) < 0.01) bulbs.push([x, y - 0.1, zS]);
  }
  const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: 0x111111 }));
  scene.add(wire);
  const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbs.length);
  bulbs.forEach(([x, y, z], i) => { M.makeTranslation(x, y, z); bulbMesh.setMatrixAt(i, M); });
  scene.add(bulbMesh);

  // ---------------------------------------------------------------- claimed space
  // Small signs that the court belongs to the players, not a venue operator:
  // a bedsheet banner zip-tied to the far fence and spray paint on the floor.
  {
    const bg = new THREE.PlaneGeometry(8, 1.5, 24, 4);
    const pos = bg.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = pos.getX(i) / 4; pos.setY(i, pos.getY(i) - 0.18 * (1 - u * u)); }
    bg.computeVertexNormals();
    const banner = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.95, side: THREE.DoubleSide, transparent: true, alphaTest: 0.1 }));
    banner.position.set(-3, wallH - 1.05, -halfW - 0.05);
    banner.castShadow = true;
    scene.add(banner);
    const b0 = Float32Array.from(pos.array);
    venue.animated.push(t => {
      for (let i = 0; i < pos.count; i++) {
        const x = b0[i * 3], y = b0[i * 3 + 1];
        pos.setZ(i, Math.sin(t * 1.3 + x * 0.9) * 0.05 * (0.75 - y / 1.5) + Math.sin(t * 2.7 + x * 2.1) * 0.015);
      }
      pos.needsUpdate = true;
    });
    const decal = (tx, w, h, x, z, rot, alpha = 0.82) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
        map: tx, transparent: true, opacity: alpha, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2,
      }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = rot;
      m.position.set(x, 0.004, z); m.receiveShadow = true;
      scene.add(m);
    };
    decal(sprayTag('crown', 'CAGE KINGS', '#FFD400', { crown: true }), 3.4, 1.7, -12.2, -6.2, 0.35);
    decal(sprayTag('thirteen', '13', '#FF3B6B', { stencil: true, w: 256 }), 1.2, 1.2, 12.6, 6.8, -0.5, 0.7);
    decal(sprayTag('bankit', 'BANK IT', '#00D1FF', { arrow: true }), 2.6, 1.3, 5.2, -7.6, Math.PI, 0.75);
    decal(sprayTag('est', 'EST. ROOFTOP', '#FFFFFF', { stencil: true }), 2.4, 1.2, -5.5, 7.4, 0.08, 0.5);
    // a tag on the stair hut
    const hut = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshStandardMaterial({ map: sprayTag('hut', 'NIGHT LEAGUE', '#39FF88'), transparent: true, depthWrite: false, roughness: 0.8 }));
    hut.position.set(-26, 1.7, 11.49); scene.add(hut);
  }

  // ---------------------------------------------------------------- city
  buildCity(scene, venue);

  // ---------------------------------------------------------------- reactive lighting
  // The venue explodes to life on big moments (FIFA Street 3's "hyper-real" idea):
  // goals flare the floodlights and paint the trims in the scorer's colours, skills
  // flash the boards, a GAMEBREAKER keeps them pulsing. It also pulses faintly with
  // the boombox on the roof.
  const base = { spot: venue.lights.map(l => l.intensity), trim: 0.25, bulb: bulbMat.emissiveIntensity };
  const trimBase = new THREE.Color(0xffd400), trimCol = new THREE.Color(0xffd400), bulbBase = bulbMat.emissive.clone();
  const R = { flare: 0, flash: 0, gb: 0, color: new THREE.Color(0xffd400), beat: 0 };
  venue.react = (kind, color) => {
    if (color) R.color.set(color);
    if (kind === 'goal') { R.flare = 1; R.flash = 1; }
    else if (kind === 'skill') R.flash = Math.max(R.flash, 0.6);
    else if (kind === 'gb') R.gb = 1;
    else if (kind === 'gbEnd') R.gb = 0;
  };
  venue.setBeat = v => { R.beat = v; };
  let lastT = 0;
  const flickerAt = t => {
    const cyc = t % 13.7;
    if (cyc > 12.6) return ((Math.sin(t * 91.3) * 43758.5453) % 1 + 1) % 1 > 0.42 ? 1 : 0.1;   // stutter
    return 0.97 + 0.03 * Math.sin(t * 50);                                                       // buzz
  };

  venue.update = (t, camera) => {
    const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
    venue.fence.update(t); venue.nets.update(t);
    skyMat.uniforms.uTime.value = t;
    for (const f of venue.animated) f(t);
    R.flare = Math.max(0, R.flare - dt * 0.8); R.flash = Math.max(0, R.flash - dt * 2.2);
    const hot = Math.max(R.flash, R.gb * (0.55 + 0.45 * Math.sin(t * 6)));
    // floodlights: goal flare + the dying lamp
    venue.lights.forEach((l, i) => { l.intensity = base.spot[i] * (1 + R.flare * 0.5); });
    if (venue.flicker) {
      const f = flickerAt(t);
      venue.flicker.spot.intensity *= f;
      venue.flicker.glow.material.opacity = 0.6 * f;
      venue.flicker.mat.emissiveIntensity = 6 * f;
    }
    // board trims + string lights take the moment's colour
    trimCol.copy(trimBase).lerp(R.color, Math.min(1, hot * 1.2));
    trimMat.color.copy(trimCol);
    trimMat.emissive.copy(trimCol).multiplyScalar(base.trim + hot * 1.6 + R.beat * 0.12);
    bulbMat.emissive.copy(bulbBase).lerp(R.color, hot * 0.8);
    bulbMat.emissiveIntensity = base.bulb * (1 + hot * 0.8 + R.beat * 0.15);
  };
  return venue;
}

// Procedural city: one instanced box set; windows computed in the shader from world
// position so any building size works without texture stretching.
function buildCity(scene, venue) {
  const N = 260;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `
      attribute float aSeed;
      varying vec3 vWP; varying vec3 vN; varying float vSeed;
      #include <fog_pars_vertex>
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWP = wp.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vSeed = aSeed;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      varying vec3 vWP; varying vec3 vN; varying float vSeed;
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 17.0) * 43758.5453); }
      void main(){
        vec3 base = vec3(0.018, 0.02, 0.03) + vSeed * 0.012;
        vec3 col = base;
        if (abs(vN.y) < 0.5) {
          float u = abs(vN.x) > 0.5 ? vWP.z : vWP.x;
          vec2 cell = vec2(u / 2.1, vWP.y / 3.3);
          vec2 id = floor(cell), f = fract(cell);
          float inWin = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
          float lit = step(0.64, hash(id));
          vec3 warm = mix(vec3(1.0, 0.78, 0.45), vec3(0.65, 0.85, 1.0), step(0.8, hash(id + 3.1)));
          col += inWin * lit * warm * (0.55 + 0.9 * hash(id + 7.3));
          col += inWin * (1.0 - lit) * vec3(0.02, 0.025, 0.04);
        } else {
          col = base * 0.7;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const seeds = new Float32Array(N);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion();
  let s = 12345;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let i = 0;
  while (i < N) {
    const ang = r() * Math.PI * 2;
    const dist = 70 + r() * 260;
    const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    const w = 10 + r() * 22, d = 10 + r() * 22;
    // Mostly below our roof, a few towers above it.
    const h = 30 + r() * 60 + (r() < 0.12 ? 60 + r() * 80 : 0) + (dist > 180 ? 30 : 0);
    const baseY = -70;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.2);
    M.compose(new THREE.Vector3(x, baseY, z), q, new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, M);
    seeds[i] = r();
    i++;
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  scene.add(mesh);

  // A few red aircraft beacons on the tallest towers, and a neon sign.
  const beaconMat = new THREE.SpriteMaterial({ map: radialTexture('rgba(255,40,40,1)', 'rgba(255,0,0,0)', 64), blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const beacons = [];
  for (let k = 0; k < 14; k++) {
    mesh.getMatrixAt(k * 17 % N, M);
    const pos = new THREE.Vector3(), sc = new THREE.Vector3();
    M.decompose(pos, q, sc);
    const b = new THREE.Sprite(beaconMat.clone());
    b.position.set(pos.x, pos.y + sc.y + 1, pos.z); b.scale.set(6, 6, 1);
    scene.add(b); beacons.push(b);
  }
  venue.animated.push(t => { beacons.forEach((b, k) => { b.material.opacity = 0.25 + 0.75 * (Math.sin(t * 2.2 + k) > 0.6 ? 1 : 0); }); });

  const sc = document.createElement('canvas'); sc.width = 1024; sc.height = 256;
  const g = sc.getContext('2d');
  g.font = '900 150px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ff2bd6'; g.shadowBlur = 30; g.fillStyle = '#ff7df0'; g.fillText('STREETCAGE', 512, 128);
  const st = new THREE.CanvasTexture(sc); st.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(36, 9), new THREE.MeshBasicMaterial({ map: st, transparent: true, fog: false, color: new THREE.Color(2.2, 2.2, 2.2), depthWrite: false }));
  sign.position.set(10, 26, -110); scene.add(sign);
  venue.animated.push(t => { sign.material.color.setScalar(1.6 + 0.6 * (Math.sin(t * 13) > -0.95 ? 1 : 0.2)); });
}
