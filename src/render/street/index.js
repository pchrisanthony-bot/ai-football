// =====================================================================
// SITARA GULLY: the Mumbai-inspired street court venue. Same contract as the other
// venues (venue.js): fog, lights, fence/nets ripples, react, setWet, setBeat, update,
// crowd — plus setTime('golden' | 'night') and a camera framing that lets the
// neighbourhood into the shot.
//
// Gameplay space and visual environment are separate: the court's walls, goals and roof
// are built from PITCH exactly where the physics has them; everything else is scenery
// with no collision at all.
// =====================================================================
import * as THREE from 'three';
import { Ripples } from '../venue.js';
import { W, weatherize } from './materials.js';
import { atlas } from './atlas.js';
import { plaster, brick, concrete, corrugated, pavers, ground } from './surfaces.js';
import { Batch, rng } from './util.js';
import { Kit } from './kit.js';
import { buildCourt } from './court.js';
import { buildLayout } from './layout.js';
import { buildSkyline } from './skyline.js';
import { buildLighting } from './lighting.js';
import { Crowd } from './crowd.js';
import { StreetLife } from './life.js';

export function buildStreetCourt(scene, renderer, { quality } = {}) {
  const venue = { kind: 'gully', name: 'SITARA GULLY', fence: new Ripples(), nets: new Ripples(), lights: [], animated: [] };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const A = atlas();
  const B = new Batch()
    .define('plaster', { worldUV: 3 }).define('brick', { worldUV: 1.2 }).define('concrete', { worldUV: 2 })
    .define('metal', { worldUV: 0.8 }).define('paver', { worldUV: 1 }).define('ground', { worldUV: 6 })
    .define('steel', {}).define('prop', {})
    .define('decal', { extras: { aLit: [1, 0] } })
    .define('cloth', { extras: { aSway: [1, 0], aPhase: [1, 0] } })
    .define('wire', { extras: { aSway: [1, 0], aPhase: [1, 0] } });
  const K = new Kit(B, A, rng(20261007));
  const group = new THREE.Group(); group.name = 'street';
  scene.add(group);

  buildCourt(group, K, venue, maxAniso);
  const L = buildLayout(K);
  B.add('ground', new THREE.PlaneGeometry(170, 150).rotateX(-Math.PI / 2).translate(0, -0.01, -15));

  // ---------------------------------------------------------------- materials
  const tex = (t, rep = true) => { t.anisotropy = maxAniso; return t; };
  const P = plaster(), Br = brick(), C = concrete(), Co = corrugated(), Pv = pavers(), G = ground();
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const mats = {
    plaster: weatherize(std({ map: tex(P.map), normalMap: P.normal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.93 }), 'wall', { chips: true }),
    brick: weatherize(std({ map: tex(Br.map), normalMap: Br.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9 }), 'wall', { strength: 0.6 }),
    concrete: weatherize(std({ map: tex(C.map), normalMap: C.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 }), 'wall'),
    metal: weatherize(std({ map: tex(Co.map), normalMap: Co.normal, normalScale: new THREE.Vector2(1.0, 1.0), roughness: 0.55, metalness: 0.3 }), 'metal'),
    paver: weatherize(std({ map: tex(Pv.map), normalMap: Pv.normal, roughness: 0.9 }), 'ground'),
    ground: weatherize(std({ map: tex(G.map), normalMap: G.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95 }), 'ground'),
    steel: weatherize(std({ roughness: 0.5, metalness: 0.45 }), 'metal'),
    prop: weatherize(std({ roughness: 0.68 }), 'plain'),
    decal: weatherize(std({ map: A.map, emissiveMap: A.glow, emissive: 0xffffff, emissiveIntensity: 1.9, alphaTest: 0.45, roughness: 0.82, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'decal', { strength: 0.55 }),
    cloth: weatherize(std({ map: A.map, side: THREE.DoubleSide, alphaTest: 0.45, roughness: 0.92 }), 'cloth'),
    wire: weatherize(std({ roughness: 0.6 }), 'wire'),
  };
  const meshes = B.build(group, mats, { cast: k => !['decal', 'wire', 'paver', 'ground'].includes(k), receive: () => true });
  venue.meshes = meshes;

  buildSkyline(group);
  buildLighting(group, venue, L, K);
  venue.spots = K.spots;          // where people can watch from
  venue.crowd = new Crowd(group, K.spots, { quality });
  venue.life = new StreetLife(group, venue.crowd, { quality });

  // ---------------------------------------------------------------- behaviour
  const R = { flare: 0 };
  venue.react = (kind) => { if (kind === 'goal') { R.flare = 1; venue.crowd?.goal(); } };
  venue.setBeat = () => {};
  venue.setWet = on => { W.uWet.value = on ? 1 : 0; W.uMoist.value = on ? 1 : 0.6; };
  let lastT = 0;
  venue.update = (t, camera) => {
    const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
    W.uTime.value = t;
    venue.fence.update(t); venue.nets.update(t);
    R.flare = Math.max(0, R.flare - dt * 0.8);
    if (venue.tod === 'night') venue.flare?.(R.flare);
    venue.crowd?.update(t, dt);
    venue.life?.update(t, dt);
    for (const f of venue.animated) f(t, dt);
  };
  // The broadcast camera a touch lower in its look so the neighbourhood is in the shot
  // above the far fence (CameraRig.broadcast reads these over the format's framing).
  venue.camera = { lookY: 2.3, backOff: 2.2 };
  return venue;
}
