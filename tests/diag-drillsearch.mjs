import { runDrill } from './drill.test.mjs';
const rows = [];
for (const sx of [5, 7, 9, 11, 12.5]) for (const sz of [2.5, 4, 5.5, 7]) for (const w of [1, -1]) for (const tzS of [1, -1]) {
  // defender blocks the direct lane 40% of the way to goal; keeper on the ball–goal line
  const gx = 16, t = 0.4;
  const v = { sx, sz, dx: sx + (gx - sx) * t, dz: sz * (1 - t), gz: Math.max(-1.1, Math.min(1.1, sz * 0.18)) };
  const tz = tzS * 1.05;
  let g = 0; const outs = [];
  for (let seed = 1; seed <= 3; seed++) { const r = runDrill(v, tz, w, seed); outs.push(r.res); if (r.res === 'GOAL') g++; }
  rows.push({ sx, sz, wall: w, tz, g, outs: outs.join(',') });
}
rows.sort((a, b) => b.g - a.g);
console.log(rows.slice(0, 18).map(r => `goals ${r.g}/3  shooter(${r.sx},${r.sz}) wall ${r.wall > 0 ? '+z' : '-z'} target ${r.tz}  [${r.outs}]`).join('\n'));
console.log('configs with ≥2/3:', rows.filter(r => r.g >= 2).length, 'of', rows.length);
