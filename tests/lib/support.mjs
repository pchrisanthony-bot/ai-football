// Support scenes (the movement brief's tests F–H): the person has the ball (the real
// HumanController), his four team-mates and the five opponents are all AI. The carrier
// holds it, or carries it a way (stick), for a few seconds; every quarter second after
// the first we count what he has on:
//   open      team-mates whose pass is on (ETA race on the lane: risk < 0.35)
//   triangle  two open options at different angles from him (≥ 0.45 rad apart)
//   forward / safety   an open option ahead of him (> 2 m) / behind him
import { Match, SIM_DT, FakeInput } from './sim.mjs';
import { HumanController } from '../../src/game/human.js';
import { passLane } from '../../src/sim/ai/support.js';
import { groundPassSpeed } from '../../src/sim/kicks.js';
import { angleDiff } from '../../src/util/math.js';

export function openOptions(m, o) {
  const out = [];
  for (const r of m.mates(o)) {
    if (r.line === 'GK') continue;
    const d = Math.hypot(r.x - o.x, r.z - o.z);
    if (d < 2 || d > 22) continue;
    const risk = 1 - passLane(m, o.team, o, r);
    if (risk < 0.35) out.push({ r, ang: Math.atan2(r.z - o.z, r.x - o.x), d, fwd: (r.x - o.x) * m.teams[o.team].dir });
  }
  return out;
}

// stick: 'still' | 'right' (screen right = +x) | 'up' (screen up = −z) | 'forward' (+x)
export function supportScene({ seed = 1, x = -4, z = 0, stick = 'still', secs = 4, difficulty = 0.6, onSample = null, opponents = true } = {}) {
  const m = new Match({ humanTeam: 0, seconds: 9999, seed, difficulty });
  m.phase = 'play'; m.restart = null;
  const carrier = m.players.find(p => p.team === 0 && p.line === 'MID') || m.players.find(p => p.team === 0 && p.line !== 'GK');
  // everyone else from the team's shape around the ball, as in play
  m.ai.teamThink(0); m.ai.teamThink(1);
  for (const p of m.players) {
    if (p === carrier) continue;
    const a = m.ai.team[p.team].anchors.get(p.id);
    if (a) { p.x = a.x; p.z = a.z; }
  }
  Object.assign(carrier, { x, z, speed: 0, vx: 0, vz: 0, heading: 0, facing: 0 });
  if (!opponents) for (const p of m.players) if (p.team === 1 && p.line !== 'GK') { p.active = false; p.x = 0; p.z = 40; }
  m.loseBall();
  Object.assign(m.ball, { x: x + 0.45, z, y: 0.11, vx: 0, vy: 0, vz: 0 });
  m.gainPossession(carrier, true);
  const inp = new FakeInput(), h = new HumanController(m, 0, inp);
  for (const q of m.players) q.human = false; m.human = null; h.setHuman(carrier);
  const S = { n: 0, open: 0, two: 0, tri: 0, fwd: 0, safe: 0, lost: false };
  const frames = Math.round(secs * 60);
  for (let f = 0; f < frames; f++) {
    const st = { still: [0, 0], right: [0, 1].reverse(), up: [0, 1], forward: [1, 0] }[stick] || [0, 0];
    inp.move.x = stick === 'right' || stick === 'forward' ? 1 : 0; inp.move.y = stick === 'up' ? 1 : 0;
    inp.set(stick === 'still' ? ['control'] : []);   // holding it: Street Ball Control
    h.update(1 / 60); m.step(SIM_DT); m.step(SIM_DT); m.drainEvents();
    if (m.ball.owner !== carrier) { S.lost = true; break; }
    if (f < 60 || f % 15) continue;
    const opts = openOptions(m, carrier);
    S.n++; S.open += opts.length;
    if (opts.length >= 2) S.two++;
    if (opts.some(a => opts.some(b => a !== b && Math.abs(angleDiff(a.ang, b.ang)) >= 0.45))) S.tri++;
    if (opts.some(o => o.fwd > 2)) S.fwd++;
    if (opts.some(o => o.fwd < 0)) S.safe++;
    if (onSample) onSample(m, carrier, opts);
  }
  return S;
}

export function supportTally(opts, seeds = 8) {
  const t = { n: 0, open: 0, two: 0, tri: 0, fwd: 0, safe: 0, lost: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const s = supportScene({ ...opts, seed });
    for (const k of ['n', 'open', 'two', 'tri', 'fwd', 'safe']) t[k] += s[k];
    if (s.lost) t.lost++;
  }
  t.avgOpen = t.open / Math.max(1, t.n);
  t.rate = k => t[k] / Math.max(1, t.n);
  return t;
}
