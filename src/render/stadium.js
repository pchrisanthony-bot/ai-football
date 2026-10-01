// Stadium cage (the FTS 15 look): tiered stands on three sides with a canopy over the
// main stand, a scrolling LED ribbon, and ~1200 instanced fans in one draw call.
// The fans wear the two teams' colours, bob with the atmosphere and jump on goals.
import * as THREE from 'three';
import { PITCH } from '../sim/pitch.js';
import { ledRibbon } from './textures.js';

export function buildStands(scene, venue) {
  const { halfL, halfW } = PITCH;
  const rows = 9, rise = 0.48, depth = 0.86;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2c313d, roughness: 0.9 });
  const seatA = new THREE.MeshStandardMaterial({ color: 0x1d3f8a, roughness: 0.7 });
  const seatB = new THREE.MeshStandardMaterial({ color: 0x8a1d2a, roughness: 0.7 });
  const seats = [];   // [x, y, z, facing]

  // A stand is a stack of steps running along one side, rising away from the pitch.
  // along: 'x' (main stand, far side) or 'z' (the ends). front: the pitch-side edge.
  const stand = (along, front, dir, a0, a1, colour) => {
    const len = a1 - a0, mid = (a0 + a1) / 2;
    for (let r = 0; r < rows; r++) {
      const h = (r + 1) * rise, off = front + dir * (r * depth + depth / 2);
      const g = new THREE.BoxGeometry(along === 'x' ? len : depth, h, along === 'x' ? depth : len);
      const m = new THREE.Mesh(g, r % 3 === 2 ? concrete : colour);
      if (along === 'x') m.position.set(mid, h / 2, off); else m.position.set(off, h / 2, mid);
      m.receiveShadow = true;
      scene.add(m);
      // fans on this row (skip a few seats: not every ticket sold)
      for (let a = a0 + 0.3; a < a1 - 0.3; a += 0.56) {
        if (Math.random() < 0.1) continue;
        const j = (Math.random() - 0.5) * 0.12;
        const facing = along === 'x' ? (dir < 0 ? 0 : Math.PI) : (dir < 0 ? Math.PI / 2 : -Math.PI / 2);
        if (along === 'x') seats.push([a + j, h + 0.02, off + dir * 0.05, facing, r]);
        else seats.push([off + dir * 0.05, h + 0.02, a + j, facing, r]);
      }
    }
    // back wall
    const bh = rows * rise + 2.4, back = front + dir * (rows * depth + 0.2);
    const bw = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? len + 0.4 : 0.4, bh, along === 'x' ? 0.4 : len + 0.4), concrete);
    if (along === 'x') bw.position.set(mid, bh / 2, back); else bw.position.set(back, bh / 2, mid);
    scene.add(bw);
  };
  const mainFront = -halfW - 3.1, endFront = halfL + 3.3;
  stand('x', mainFront, -1, -halfL - 2, halfL + 2, seatA);
  stand('z', -endFront, -1, -halfW - 1, halfW + 1.5, seatB);
  stand('z', endFront, 1, -halfW - 1, halfW + 1.5, seatB);

  // Canopy over the main stand (its shadow falls across the back rows).
  const roofY = rows * rise + 4.2, roofD = rows * depth + 3;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(halfL * 2 + 8, 0.25, roofD), new THREE.MeshStandardMaterial({ color: 0x3b414d, metalness: 0.6, roughness: 0.5 }));
  canopy.position.set(0, roofY, mainFront - roofD / 2 + 1.2);
  canopy.castShadow = true;
  scene.add(canopy);
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x555c68, metalness: 0.7, roughness: 0.4 });
  for (let x = -halfL - 2; x <= halfL + 2.1; x += 6) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, roofY, 0.3), beamMat);
    col.position.set(x, roofY / 2, mainFront - rows * depth - 0.6);
    scene.add(col);
  }
  // Roof underside lights
  const strip = new THREE.Mesh(new THREE.BoxGeometry(halfL * 2 + 6, 0.06, 0.25), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2dc, emissiveIntensity: 3 }));
  strip.position.set(0, roofY - 0.16, mainFront - 1.2);
  scene.add(strip);

  // LED ribbon along the front of the main stand.
  const led = ledRibbon();
  led.repeat.set(3, 1);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: led, emissiveIntensity: 1.3 });
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(halfL * 2 + 4, 0.7), ledMat);
  ribbon.position.set(0, 0.62, mainFront + 0.02);
  scene.add(ribbon);
  venue.animated.push(t => { led.offset.x = (t * 0.035) % 1; });

  // ---- crowd: instanced billboards drawn as simple fan silhouettes in the shader
  const n = seats.length;
  const base = new THREE.PlaneGeometry(0.58, 1.0);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const aOff = new Float32Array(n * 3), aFace = new Float32Array(n), aPhase = new Float32Array(n), aTeam = new Float32Array(n), aTone = new Float32Array(n), aRow = new Float32Array(n);
  seats.forEach(([x, y, z, f, r], i) => {
    aOff.set([x, y, z], i * 3); aFace[i] = f; aPhase[i] = Math.random(); aRow[i] = r;
    // home fans left of halfway, away fans right, neutrals sprinkled through
    const side = x < 0 ? 0 : 1, u = Math.random();
    aTeam[i] = u < 0.72 ? side : u < 0.84 ? 1 - side : 2;
    aTone[i] = Math.random();
  });
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(aOff, 3));
  geo.setAttribute('aFace', new THREE.InstancedBufferAttribute(aFace, 1));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
  geo.setAttribute('aTeam', new THREE.InstancedBufferAttribute(aTeam, 1));
  geo.setAttribute('aTone', new THREE.InstancedBufferAttribute(aTone, 1));
  geo.setAttribute('aRow', new THREE.InstancedBufferAttribute(aRow, 1));
  geo.instanceCount = n;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uExcite: { value: 0.2 }, uJump: { value: 0 },
    uHome: { value: new THREE.Color(0x1466ff) }, uAway: { value: new THREE.Color(0xff3b3b) },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 aOff; attribute float aFace, aPhase, aTeam, aTone, aRow;
      uniform float uTime, uExcite, uJump;
      varying vec2 vUv; varying float vTeam, vTone, vLight;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vTeam = aTeam; vTone = aTone; vLight = 0.62 + 0.38 * (1.0 - aRow / 9.0);
        float c = cos(aFace), s = sin(aFace);
        vec3 p = vec3(position.x * c, position.y * (0.9 + 0.2 * aTone), -position.x * s);
        float bob = abs(sin(uTime * (2.2 + aPhase * 1.6) + aPhase * 6.28)) * 0.06 * (0.3 + uExcite * 2.2);
        float jump = uJump * (0.18 + 0.3 * fract(aPhase * 7.3)) * abs(sin(uTime * 9.0 + aPhase * 20.0));
        vec4 mvPosition = modelViewMatrix * vec4(aOff + p + vec3(0.0, bob + jump, 0.0), 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uHome, uAway;
      varying vec2 vUv; varying float vTeam, vTone, vLight;
      #include <fog_pars_fragment>
      void main() {
        vec2 u = vUv;
        // head
        float head = length((u - vec2(0.5, 0.8)) * vec2(1.0, 0.9)) - 0.16;
        // shoulders + torso (rounded)
        vec2 q = u - vec2(0.5, 0.36);
        float body = length(max(abs(q) - vec2(0.3, 0.3), 0.0)) - 0.1;
        if (min(head, body) > 0.0) discard;
        vec3 skin = mix(vec3(0.93, 0.76, 0.62), vec3(0.3, 0.19, 0.13), vTone);
        vec3 shirt = vTeam < 0.5 ? uHome : vTeam < 1.5 ? uAway : mix(vec3(0.85), vec3(0.12), step(0.5, vTone));
        vec3 col = head < 0.0 ? skin : shirt * (0.75 + 0.25 * u.y);
        gl_FragColor = vec4(col * vLight, 1.0);
        #include <fog_fragment>
      }`,
  });
  const crowd = new THREE.Mesh(geo, mat);
  crowd.frustumCulled = false;
  scene.add(crowd);

  venue.crowd = {
    setKits(home, away) { uniforms.uHome.value.set(home.shirt); uniforms.uAway.value.set(away.shirt); },
    setExcite(v) { uniforms.uExcite.value = v; },
    goal() { uniforms.uJump.value = 1; },
    update(t, dt) { uniforms.uTime.value = t; uniforms.uJump.value = Math.max(0, uniforms.uJump.value - dt * 0.35); },
  };
  return { ledMat };
}

// Tall floodlight towers with a grid of lamps (the stadium silhouette).
export function towerHead(mastMat, lampMat) {
  const head = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.3, 0.4), mastMat);
  head.add(frame);
  for (let i = 0; i < 12; i++) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.46, 0.06), lampMat);
    lamp.position.set(-1.2 + (i % 4) * 0.8, 0.78 - Math.floor(i / 4) * 0.56, 0.22);
    head.add(lamp);
  }
  return head;
}
