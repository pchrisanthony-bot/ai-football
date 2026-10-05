// Real-time spike hunt: for every frame over 25 ms, which profiled section grew (sim,
// view, hud, render-submit…) — or none (GC, compositor, GPU stall).
//   node tools/play/perf-spikes.mjs [--gfx=N] [--secs=15]
import { harness, sleep } from './harness.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const H = await harness({ query: '?profile' });
const settings = { GRAPHICS: +arg('gfx', 1), VENUE: +arg('venue', 0) };
await H.start(settings, { spectate: true });
await H.resume();
await sleep(3000);
const r = await H.eval(async (secs) => {
  const P = __prof, out = [];
  let last = performance.now(), prev = { ...P.acc }, n = 0, heapPrev = performance.memory?.usedJSHeapSize || 0;
  await new Promise(res => {
    const f = t => {
      const dt = t - last; last = t; n++;
      const d = {}; for (const k in P.acc) { const v = P.acc[k] - (prev[k] || 0); if (v > 0.5) d[k] = +v.toFixed(1); }
      prev = { ...P.acc };
      const heap = performance.memory?.usedJSHeapSize || 0;
      if (dt > 25 && n > 5) out.push({ dt: +dt.toFixed(1), d, heapDrop: heap < heapPrev - 1e6 ? +((heapPrev - heap) / 1e6).toFixed(1) : 0 });
      heapPrev = heap;
      if (n < secs * 60) requestAnimationFrame(f); else res();
    };
    requestAnimationFrame(f);
  });
  return { frames: n, spikes: out };
}, +arg('secs', 15));
const gc = r.spikes.filter(s => s.heapDrop > 0).length, worked = r.spikes.filter(s => Object.values(s.d).some(v => v > 8)).length;
console.log(`${r.frames} frames, ${r.spikes.length} over 25 ms — ${gc} with a GC (heap drop), ${worked} with a section > 8 ms`);
for (const s of r.spikes.slice(0, 25)) console.log(' ', JSON.stringify(s));
await H.close();
