// Support play (the movement brief's tests F–H): the person has the ball and his AI
// team-mates make themselves options around it — in triangles, moving with the ball,
// getting out of a lane a defender steps into. The defending AI is the real one (it
// presses and marks), so "open" here means what a footballer means: an angle to pass
// along, not a guarantee.
import { supportScene } from './lib/support.mjs';
import { Match, SIM_DT, FakeInput } from './lib/sim.mjs';
import { HumanController } from '../src/game/human.js';
import { laneRisk } from '../src/sim/ai/eval.js';
import { angleDiff } from '../src/util/math.js';
import { segDist2 } from '../src/util/math.js';

const pct = x => `${Math.round(x * 100)}%`;

// The carrier holds it (or carries it) — then plays it to the team-mate with the best lane.
function passAfter(seed, { x = -6, z = 0, stick = null, hold = 1.5 } = {}) {
  const m = new Match({ humanTeam: 0, seconds: 9999, seed });
  m.phase = 'play'; m.restart = null;
  const carrier = m.players.find(p => p.team === 0 && p.line === 'MID');
  m.ai.teamThink(0); m.ai.teamThink(1);
  for (const p of m.players) { if (p === carrier) continue; const a = m.ai.team[p.team].anchors.get(p.id); if (a) { p.x = a.x; p.z = a.z; } }
  Object.assign(carrier, { x, z, speed: 0, vx: 0, vz: 0, heading: 0, facing: 0 });
  m.loseBall(); Object.assign(m.ball, { x: x + 0.45, z, y: 0.11, vx: 0, vy: 0, vz: 0 }); m.gainPossession(carrier, true);
  const inp = new FakeInput(), h = new HumanController(m, 0, inp); for (const q of m.players) q.human = false; m.human = null; h.setHuman(carrier);
  let to = null, at = 0, kick = false, shape = null;
  for (let f = 0; f < 420; f++) {
    let sx = stick === 'up' ? 0 : 0, sy = stick === 'up' ? 1 : 0, btn = [];
    if (!to && f >= hold * 60) {
      if (m.ball.owner !== carrier) return { res: 'lost before' };
      let bl = -1;
      for (const r of m.mates(carrier)) { if (r.line === 'GK') continue; if (Math.hypot(r.x - carrier.x, r.z - carrier.z) < 3) continue; const l = 1 - laneRisk(m, 0, [{ x: carrier.x, z: carrier.z }, { x: r.x, z: r.z }], s => s / 9, null, 0.6, 0.2).risk; if (l > bl) { bl = l; to = r; } }
      // the shape as he looks up: team-mates 3.5–14 m away, and the widest angle between two of them
      const ms = m.mates(carrier).filter(r => r.line !== 'GK' && Math.hypot(r.x - carrier.x, r.z - carrier.z) > 3.5 && Math.hypot(r.x - carrier.x, r.z - carrier.z) < 14).map(r => Math.atan2(r.z - carrier.z, r.x - carrier.x));
      let spread = 0; for (const a of ms) for (const b of ms) spread = Math.max(spread, Math.abs(angleDiff(a, b)));
      shape = { n: ms.length, spread };
      at = f;
    }
    if (to && !kick) { const dx = to.x - carrier.x, dz = to.z - carrier.z, d = Math.hypot(dx, dz); sx = dx / d; sy = -dz / d; if (f < at + 4) btn = ['pass']; }
    inp.move.x = sx; inp.move.y = sy; inp.set(btn);
    h.update(1 / 60); m.step(SIM_DT); m.step(SIM_DT);
    for (const e of m.drainEvents()) if (e.type === 'kick' && e.pid === carrier.id) kick = true;
    if (kick) { const o = m.ball.owner; if (o && o !== carrier) return { res: o.team === 0 ? 'completed' : 'intercepted', shape }; }
  }
  return { res: kick ? 'loose' : 'no pass', shape };
}

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // F) He has it and holds it: two or more team-mates are at passing distance at different
  //    angles (a triangle, not a line), and his pass to the best of them gets there.
  {
    const rows = []; for (let seed = 1; seed <= 40; seed++) rows.push(passAfter(seed));
    const played = rows.filter(r => r.res === 'completed' || r.res === 'intercepted');
    const done = played.filter(r => r.res === 'completed').length / Math.max(1, played.length);
    const shaped = rows.filter(r => r.shape).filter(r => r.shape.n >= 2 && r.shape.spread >= 0.8).length / Math.max(1, rows.filter(r => r.shape).length);
    check('F · team-mates form a triangle around the carrier (≥ 2 at passing distance, ≥ 45° apart, ≥ 80%)', shaped >= 0.8, `${pct(shaped)} of looks up`);
    check('…and his pass after holding it gets there (≥ 40%; the triangle-less support managed 8%)', done >= 0.4, `${pct(done)} of ${played.length} passes`);
  }

  // G) He carries it across the cage: the support moves with him (the triangle shifts).
  {
    let follow = 0, n = 0, dists = [];
    for (let seed = 1; seed <= 8; seed++) {
      const first = { c: null, s: null }, last = { c: null, s: null };
      const S = supportScene({ seed, x: -3, z: 6, stick: 'up', secs: 3, opponents: false, onSample: (m, o) => {
        const ms = m.mates(o).filter(r => r.line !== 'GK');
        const cz = ms.reduce((a, r) => a + r.z, 0) / ms.length;
        for (const r of ms) dists.push(Math.hypot(r.x - o.x, r.z - o.z));
        if (!first.c) { first.c = o.z; first.s = cz; } last.c = o.z; last.s = cz;
      } });
      if (first.c == null || Math.abs(last.c - first.c) < 2) continue;
      n++; follow += (last.s - first.s) / (last.c - first.c);
    }
    const k = follow / Math.max(1, n), d = dists.reduce((a, b) => a + b, 0) / Math.max(1, dists.length);
    check('G · carrying it across (nobody on him), the support shifts with him (≥ 25% of his move — the weak side keeps its width) and stays at passing distance (4–13 m)', n >= 4 && k >= 0.25 && d > 4 && d < 13, `follows ${pct(k)} of his move over ${n} runs · team-mates ${d.toFixed(1)} m from him on average`);
  }

  // H) A defender steps into the lane to a supporter: he moves out of it (or the next
  //    re-plan finds another angle) — he doesn't stand behind the man.
  {
    let freed = 0, n = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let target = null, def = null, t0 = null, ok = false;
      supportScene({ seed, x: -6, z: 0, stick: 'still', secs: 3.5, onSample: (m, o) => {
        if (ok) return;
        if (!target) {
          // after 1 s: the supporter with the clearest lane; put their nearest free defender on it
          const ms = m.mates(o).filter(r => r.line !== 'GK' && r.ai.state === 'SUPPORT' && Math.hypot(r.x - o.x, r.z - o.z) > 4);
          if (!ms.length) return;
          target = ms[0];
          def = m.opponents(o).filter(q => q.line !== 'GK' && q.ai.state !== 'PRESS').sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z))[0];
          if (!def) { target = null; return; }
          def.x = o.x + (target.x - o.x) * 0.55; def.z = o.z + (target.z - o.z) * 0.55; def.vx = def.vz = def.speed = 0;
          def.frozen = true; t0 = m.time; n++;
          return;
        }
        if (m.time - t0 > 1.6) return;
        const sd = segDist2(def.x, def.z, o.x, o.z, target.x, target.z);
        if (sd.d > 1.2) ok = true;
      } });
      if (ok) freed++;
    }
    check('H · a defender put in a supporter\'s lane: within 1.6 s he has moved out of it (≥ 70%)', n >= 8 && freed / n >= 0.7, `${freed}/${n}`);
  }
  return out;
}
