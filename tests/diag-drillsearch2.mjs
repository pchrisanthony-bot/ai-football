import { runDrill } from './drill.test.mjs';
const rows = [];
for (const sx of [3, 4, 5, 6, 7, 8]) for (const sz of [1.5, 2.5, 3.5, 4.5]) for (const side of [1, -1]) {
  const z = sz * side, w = -side, tz = side * 1.05;   // bank off the FAR wall into the near post
  const gx = 16, t = 0.42;
  const v = { sx, sz: z, dx: sx + (gx - sx) * t, dz: z * (1 - t), gz: Math.max(-1.1, Math.min(1.1, z * 0.18)) };
  let g = 0; const outs = [];
  for (let seed = 1; seed <= 5; seed++) { const r = runDrill(v, tz, w, seed); outs.push(r.res); if (r.res === 'GOAL') g++; }
  rows.push({ sx, sz: z, g, outs: outs.join(','), v });
}
rows.sort((a, b) => b.g - a.g);
console.log(rows.slice(0, 14).map(r => `goals ${r.g}/5  shooter(${r.sx},${r.sz})  [${r.outs}]`).join('\n'));
