// AI scaling: tactical ranges come from the pitch (and equal the hand-tuned 5v5 values in
// the cage), and AI-vs-AI football works in every format — shots, goals, passing,
// restarts, nothing stuck, nothing NaN.
import { aiRanges } from '../src/sim/ai/ranges.js';
import { setPitch } from '../src/sim/pitch.js';
import { playOpen } from './diag-open.mjs';

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 1) In the cage the AI plays with exactly the distances the 5v5 AI was tuned with.
  {
    setPitch('cage5');
    const R = aiRanges({ marking: 'man' });
    const want = { shot: 19, groundPass: 24, threat: 30, run: 7, keeperSet: 14, rush: 5, minXg: 0.07, saveMax: 0.95 };
    const bad = Object.entries(want).filter(([k, v]) => Math.abs(R[k] - v) > 1e-9).map(([k, v]) => `${k} ${R[k]} ≠ ${v}`);
    if (R.support.join() !== '2.5,4.5' || R.lane.join() !== '3.5,16' || R.keeperOut.join() !== '1.6,2.4' || R.space.join() !== '10,14') bad.push('radii');
    if (Math.abs(R.clear.x - 6) > 1e-9 || Math.abs(R.clear.z - 12) > 0.01 || R.markZone !== Infinity) bad.push('clear/mark');
    check('cage: AI ranges equal the tuned 5v5 constants', !bad.length, bad.join('; ') || 'identical');
  }

  // 2) They grow with the pitch (tactical) and the goal (shooting).
  {
    setPitch('full11');
    const R = aiRanges({ marking: 'zonal' });
    check('full pitch: tactical ranges scale up (shot, pass, support, keeper)', R.shot > 25 && R.groundPass > 28 && R.longPass > 50 && R.support[1] > 8 && R.keeperSet > 20 && R.markZone < 30,
      `shot ${R.shot.toFixed(0)} m · pass ${R.groundPass.toFixed(0)} m · long ${R.longPass.toFixed(0)} m · support ${R.support[1].toFixed(1)} m · zone ${R.markZone.toFixed(0)} m`);
  }

  // 3) AI-vs-AI in every open format.
  for (const format of ['7v7', '9v9', '11v11']) {
    const runs = [1, 2].map(seed => playOpen(format, 120, seed));
    const sum = k => runs.reduce((a, r) => a + r[k], 0);
    const restarts = runs.reduce((a, r) => a + Object.values(r.restarts).reduce((x, y) => x + y, 0), 0);
    const pass = sum('passesOk') / Math.max(1, sum('passes'));
    const ok = runs.every(r => r.finished && !r.nan && r.illegal === 0 && r.maxLoose < 6) && sum('shots') >= 3 && sum('goals') >= 1 && pass >= 0.4 && restarts >= 2;
    check(`${format}: AI plays football (shots, goals, passing, restarts; nothing stuck)`, ok,
      `goals ${sum('goals')} · shots ${sum('shots')} · pass ${(pass * 100).toFixed(0)}% · restarts ${restarts} · longest restart ${Math.max(...runs.map(r => r.longestRestart))} s`);
  }
  return out;
}
