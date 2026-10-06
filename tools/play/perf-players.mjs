// What the players' bodies cost, on a frozen frame (as perf-ab): shadows, materials, hair.
//   node tools/play/perf-players.mjs [--gfx=N]
import { harness } from './harness.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const H = await harness({});
await H.start({ GRAPHICS: +arg('gfx', 3) }, { spectate: true });
await H.step(240);
const cpu = () => H.eval(() => {
  const t = [];
  for (let i = 0; i < 60; i++) { const t0 = performance.now(); __R.composer.render(); t.push(performance.now() - t0); }
  __R.renderer.getContext().finish();
  t.sort((a, b) => a - b);
  return +t[30].toFixed(2);
});
const time = () => H.eval(() => {
  const gl = __R.renderer.getContext(), t = [];
  for (let i = 0; i < 60; i++) { const t0 = performance.now(); __R.composer.render(); gl.finish(); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  return +t[30].toFixed(2);
});
const cond = {
  none: () => {},
  hidden: () => { for (const a of __G.mview.athletes.values()) a.root.visible = false; },
  noShadow: () => { for (const a of __G.mview.athletes.values()) a.body.meshes.forEach(m => { m.castShadow = false; }); },
  bodyShadowOnly: () => { for (const a of __G.mview.athletes.values()) a.body.meshes.forEach(m => { m.castShadow = m.material.name === 'skin' || m.material === a.body.mats.skin || m.material === a.body.lowMats.skin; }); },
  plainMats: () => { for (const a of __G.mview.athletes.values()) a.body.slots.forEach(([m, n]) => { if (a.body.lowMats[n]) m.material = a.body.lowMats[n]; }); },
  lambert: () => { for (const a of __G.mview.athletes.values()) a.body.slots.forEach(([m]) => { m.material = new THREE_.MeshLambertMaterial({ map: m.material.map }); }); },
  noHairFace: () => { for (const a of __G.mview.athletes.values()) a.body.slots.forEach(([m, n]) => { if (/hair|eyes|brows|lashes/.test(n)) m.visible = false; }); },
  skinOnly: () => { for (const a of __G.mview.athletes.values()) a.body.slots.forEach(([m, n]) => { m.visible = n === 'skin'; }); },
};
const reset = () => H.eval(() => { for (const a of __G.mview.athletes.values()) { a.root.visible = true; a.body.useDetail(); a.body.slots.forEach(([m, n]) => { m.visible = true; m.castShadow = !['brows', 'lashes', 'eyes'].includes(n); }); } });
console.log('quality', await H.eval(() => __R.renderer.getPixelRatio()), await H.eval(() => __R.renderer.shadowMap.enabled));
await H.eval(() => { window.THREE_ = __THREE; });
for (let round = 0; round < 3; round++) for (const [k, f] of Object.entries(cond)) {
  await reset(); await H.eval(`(${f.toString()})()`); console.log(round, k.padEnd(15), await time(), 'cpu', await cpu());
}
await H.close();
