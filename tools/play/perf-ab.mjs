// What costs render time, measured on a FROZEN frame: the same frame rendered 80 times
// with a GPU sync (gl.finish) after each, per condition — no gameplay noise. Conditions
// hide parts of the scene (light cones, crowd, athletes, …).
//   node tools/play/perf-ab.mjs [--format=N] [--gfx=N] [--venue=N] [--frames=N]
import { harness } from './harness.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const H = await harness({});
const settings = { GRAPHICS: +arg('gfx', 1), VENUE: +arg('venue', 0) };
if (arg('format', null) != null) settings.FORMAT = +arg('format');
await H.start(settings, { spectate: true });
await H.step(+arg('frames', 240));
await H.eval(() => {
  window.__parts = { cones: [], crowd: [], athletes: [], stands: [], boards: [], city: [] };
  __R.scene.traverse(o => {
    const u = o.material && o.material.uniforms;
    if (u && u.uLen) __parts.cones.push(o);
    if (u && u.uHome) __parts.crowd.push(o);
    if (o.isInstancedMesh && o.count > 200 && o.material.isShaderMaterial && !u.uHome) __parts.city.push(o);
  });
  for (const a of __G.mview.athletes.values()) __parts.athletes.push(a.root);
});
const time = () => H.eval(() => {
  const gl = __R.renderer.getContext(), t = [];
  for (let i = 0; i < 80; i++) { const t0 = performance.now(); __R.composer.render(); gl.finish(); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  return +t[40].toFixed(2);
});
const set = (part, vis) => H.eval((part, vis) => { for (const o of __parts[part]) o.visible = vis; }, part, vis);
const base = [];
base.push(await time());
const res = {};
for (const part of ['cones', 'crowd', 'athletes', 'city']) {
  await set(part, false); res[part] = await time(); await set(part, true); base.push(await time());
}
const b = base.sort((x, y) => x - y)[Math.floor(base.length / 2)];
console.log(`frame ${b} ms (median of ${base.length} baselines: ${base.join(', ')})`);
for (const [k, v] of Object.entries(res)) console.log(`  without ${k.padEnd(9)} ${v} ms  (${(b - v).toFixed(2)} ms saved)`);
const cnt = await H.eval(() => Object.fromEntries(Object.entries(__parts).map(([k, v]) => [k, v.length])));
console.log('  parts', JSON.stringify(cnt));
await H.close();
