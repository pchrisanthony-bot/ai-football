// Support play diagnostic, AI v AI: how the game flows and what the carrier has on.
//   node tests/diag-support.mjs [matches] [seconds]
// goals · shots · passes (completion) · carries into the attacking half · how many open
// options the carrier has (ETA race on the lane) · players bunched (team-mates < 2 m apart)
import { Match } from '../src/sim/match.js';
import { SIM_DT, footballGameplayConfig as GP } from '../src/config.js';
import { passLane } from '../src/sim/ai/support.js';
import { groundPassSpeed } from '../src/sim/kicks.js';

const N = +(process.argv[2] || 6), SECS = +(process.argv[3] || 180);
const tot = { bunchAtt: 0, bunchDef: 0, spaceSamples: 0, spaceOpts: 0, spaceOpts2: 0, atSpot: 0, supSamples: 0, supDist: 0, goals: 0, shots: 0, passes: 0, passesOk: 0, attHalf: 0, carrySamples: 0, opts: 0, opts2: 0, bunched: 0, samples: 0, possSwitch: 0 };
for (let seed = 1; seed <= N; seed++) {
  const m = new Match({ humanTeam: null, seconds: SECS, seed });
  let k = 0, lastOwnerTeam = -1;
  while (m.phase !== 'fulltime') {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) if (e.type === 'goalDone') m.resumeAfterGoal();
    if (m.phase !== 'play' || ++k % 30) continue;               // sample 4 Hz
    const o = m.ball.owner;
    tot.samples++;
    if (o && o.line !== 'GK') {
      tot.carrySamples++;
      if (o.x * m.teams[o.team].dir > 0) tot.attHalf++;
      if (o.team !== lastOwnerTeam) { tot.possSwitch++; lastOwnerTeam = o.team; }
      let n = 0;
      for (const r of m.mates(o)) {
        if (r.line === 'GK') continue;
        const d = Math.hypot(r.x - o.x, r.z - o.z);
        if (d < 2 || d > 22) continue;
        const risk = 1 - passLane(m, o.team, o, r);
        if (risk < 0.35) n++;
      }
      tot.opts += n; if (n >= 2) tot.opts2++;
      // space allows: he's had it a second (support has had time to form), nobody within 3 m
      let near = 99; for (const q of m.opponents(o)) near = Math.min(near, Math.hypot(q.x - o.x, q.z - o.z));
      if (o.possessT > 1 && near > 3) { tot.spaceSamples++; tot.spaceOpts += n; if (n >= 2) tot.spaceOpts2++; }
      const T = m.ai.team[o.team];
      for (const r of m.mates(o)) {
        if (r.line === 'GK' || r.human) continue;
        tot.supSamples++; tot.supDist += Math.hypot(r.x - o.x, r.z - o.z);
        const sp = m.ai.support && m.ai.support.spotFor ? m.ai.support.spotFor(r, T) : null;
        if (sp && Math.hypot(sp.x - r.x, sp.z - r.z) < 2) tot.atSpot++;
      }
    }
    for (const t of [0, 1]) {
      const ps = m.teamPlayers(t).filter(p => p.line !== 'GK');
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z) < 2) {
        tot.bunched++;
        if (o && o.team === t) tot.bunchAtt++; else if (o) tot.bunchDef++;
      }
    }
  }
  for (const T of m.teams) { tot.goals += T.score; tot.shots += T.stats.shots; tot.passes += T.stats.passes; tot.passesOk += T.stats.passesOk; }
}
const r = (a, b) => (a / Math.max(1, b));
console.log(`${N} × ${SECS} s AI v AI`);
console.log(`goals ${r(tot.goals, N).toFixed(1)}/match · shots ${r(tot.shots, N).toFixed(1)} · passes ${r(tot.passes, N).toFixed(0)} (${(100 * r(tot.passesOk, tot.passes)).toFixed(0)}% complete) · possession changes ${r(tot.possSwitch, N).toFixed(0)}`);
console.log(`space allows (had it 1 s, nobody within 3 m): ${(100 * r(tot.spaceSamples, tot.carrySamples)).toFixed(0)}% of carries · open options ${r(tot.spaceOpts, tot.spaceSamples).toFixed(2)} · ≥2 open ${(100 * r(tot.spaceOpts2, tot.spaceSamples)).toFixed(0)}% · supporters ${r(tot.supDist, tot.supSamples).toFixed(1)} m from the carrier, ${(100 * r(tot.atSpot, tot.supSamples)).toFixed(0)}% at their spot`);
console.log(`carrier in the attacking half ${(100 * r(tot.attHalf, tot.carrySamples)).toFixed(0)}% · open options ${r(tot.opts, tot.carrySamples).toFixed(2)} avg · ≥2 open ${(100 * r(tot.opts2, tot.carrySamples)).toFixed(0)}% · bunched pairs ${r(tot.bunched, tot.samples).toFixed(2)}/sample (side on the ball ${r(tot.bunchAtt, tot.samples).toFixed(2)} · defending ${r(tot.bunchDef, tot.samples).toFixed(2)})`);
