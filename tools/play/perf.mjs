// Real-time performance profile of an AI-vs-AI match in Chrome (no screenshots while
// measuring). Frame-time distribution, spikes, per-section cost and JS heap growth.
//   node tools/play/perf.mjs [label] [--secs=20] [--gfx=3] [--venue=0] [--format=0] [--w=1280 --h=720]
import fs from 'fs';
import { harness, sleep } from './harness.mjs';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const label = process.argv.slice(2).find(a => !a.startsWith('--')) || 'perf';
const secs = +arg('secs', 20), gfx = +arg('gfx', 3), venue = +arg('venue', 0), format = arg('format', null);
const w = +arg('w', 1280), h = +arg('h', 720);

const H = await harness({ w, h, query: '?profile' });
const settings = { GRAPHICS: gfx, VENUE: venue };
if (format != null) settings.FORMAT = +format;
await H.start(settings, { spectate: true });
await H.resume();
await sleep(3000);   // warm up: shader compiles, caches
const heap0 = (await H.page.metrics()).JSHeapUsedSize;
await H.eval(() => {
  window.__ftLog = []; window.__heapLog = [];
  let last = performance.now();
  const f = t => { __ftLog.push(t - last); last = t; if (__ftLog.length % 30 === 0 && performance.memory) __heapLog.push(performance.memory.usedJSHeapSize); __rafId = requestAnimationFrame(f); };
  window.__rafId = requestAnimationFrame(f);
  __prof.reset();
});
await sleep(secs * 1000);
const r = await H.eval(() => {
  cancelAnimationFrame(__rafId);
  const a = __ftLog.slice(1), s = a.slice().sort((x, y) => x - y), q = k => s[Math.min(s.length - 1, Math.floor(s.length * k))];
  const total = a.reduce((x, y) => x + y, 0);
  // allocation estimate: sum of heap increases between samples (GC shows as drops)
  let alloc = 0, gcs = 0;
  for (let i = 1; i < __heapLog.length; i++) { const d = __heapLog[i] - __heapLog[i - 1]; if (d > 0) alloc += d; else if (d < -2e5) gcs++; }
  const m = __G.match;
  return {
    frames: a.length, fps: +(a.length / (total / 1000)).toFixed(1), median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(1),
    spikes33: a.filter(x => x > 33.4).length, spikes50: a.filter(x => x > 50).length,
    sections: __prof.report(), allocMBperSec: +(alloc / 1e6 / (total / 1000)).toFixed(2), gcs,
    quality: __R.quality.level, players: m.players.filter(p => p.active).length, renderer: __R.renderer.info.render,
  };
});
const heap1 = (await H.page.metrics()).JSHeapUsedSize;
r.heapMB = { start: +(heap0 / 1e6).toFixed(1), end: +(heap1 / 1e6).toFixed(1) };
r.errors = H.errors;
await H.close();
console.log(JSON.stringify(r, null, 1));
fs.mkdirSync('docs/metrics', { recursive: true });
fs.writeFileSync(`docs/metrics/${label}.json`, JSON.stringify(r, null, 1));
