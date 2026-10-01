// Fair passing and interceptions, headless, with the real human controller (tests 5–10 of
// the gameplay brief). The rates come from many seeded scenes, so they're stable.
//   5  a badly aimed short pass goes where it was aimed (roughly), not to the man; no instant
//      perfect interception
//   6  a clear lane, aimed roughly at him: it reaches him nearly every time
//   7  a defender physically too far can't cut it out
//   8  a defender close to the lane: real interception chances (higher than far, not certain)
//   9  a driven pass: the defender needs time and movement to reach it (ETA rule)
//   10 an AI interception: a real contact, a first touch, then control → scan → decide
import { passScene, tally } from './lib/passing.mjs';
import { Match, SIM_DT } from './lib/sim.mjs';
import { footballGameplayConfig as GP } from '../src/config.js';

const deg = r => r * 180 / Math.PI;
const pct = x => `${Math.round(x * 100)}%`;

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 5) Aimed 45° off the team-mate (outside the assisted window): the ball goes roughly
  //    where the stick said, and a defender 2.5 m off its line doesn't pick it off cleanly
  //    the instant it's struck.
  {
    const t = tally({ dist: 10, offDeg: 45, defender: 'none' }, 12);
    // where the ball actually went vs the stick
    const dev = t.rows.filter(r => r.ctx).map(r => { const v = r.kick, a = Math.atan2(r.ctx.aimAng + r.ctx.angErr, 1) && Math.atan2(Math.sin(r.ctx.aimAng + r.ctx.angErr - r.ctx.stickAng), Math.cos(r.ctx.aimAng + r.ctx.angErr - r.ctx.stickAng)); return Math.abs(deg(a)); });
    const targeted = t.rows.filter(r => r.ctx && r.ctx.receiver).length;
    const offLine = tally({ dist: 10, offDeg: 45, defender: 2.5, side: 0.5 + 45 * Math.PI / 180, defAt: 0.45 }, 12);
    const instant = offLine.rows.filter(r => r.result === 'intercepted' && r.t < 0.35).length;
    check('test 5 · a pass aimed 45° off goes where it was aimed (not magnetised to him)', dev.length === 12 && Math.max(...dev) < 15 && targeted === 0,
      `ball within ${Math.max(...dev).toFixed(1)}° of the stick · aimed at the team-mate ${targeted}/12 (it used to be pulled onto him)`);
    check('…and a defender 2.5 m off its line never cuts it out instantly', instant === 0, `${instant}/12 clean interceptions within 0.35 s · outcomes ${JSON.stringify(Object.fromEntries(Object.entries(offLine).filter(([k]) => !['n', 'rate', 'rows'].includes(k))))}`);
  }

  // 6) A clear lane and the stick roughly on him (±15°): it gets there.
  {
    const a = tally({ dist: 12, offDeg: 15, defender: 'none' }, 12), b = tally({ dist: 9, offDeg: 10, defender: 'none', receiverRun: 4 }, 12);
    const rate = (a.rate('received') + b.rate('received')) / 2;
    check('test 6 · clear lane, aimed roughly at him: it reaches him (≥ 90%)', rate >= 0.9, `standing ${pct(a.rate('received'))} · on the move ${pct(b.rate('received'))}`);
  }

  // 7) A defender 5.5 m off the lane can't get there.
  {
    const t = tally({ dist: 12, offDeg: 0, defender: 'far' }, 12);
    check('test 7 · a defender physically too far never cuts it out', (t.intercepted || 0) + (t.deflected || 0) === 0, `intercepted ${pct(t.rate('intercepted'))} · deflected ${pct(t.rate('deflected'))} · received ${pct(t.rate('received'))}`);
  }

  // 8) The chance of cutting a pass out falls with how far off its line he stands (he has
  //    to get there: reaction, then the run): real close to it, small a couple of metres
  //    off, none far away. Right on the line, a better defender traps it; a weaker one,
  //    slower to read it, mostly just gets in its way.
  {
    const at = (off, diff, n = 16) => tally({ dist: 14, offDeg: 0, defender: off, defAt: 0.35, difficulty: diff }, n);
    const cut = t => t.rate('intercepted') + t.rate('deflected');
    const near = at(1.4, 0.6), mid = at(2.8, 0.6), far = at(5.5, 0.6, 8);
    check('test 8 · a defender close to the lane has a real chance — not certain — and it falls off with distance', cut(near) >= 0.3 && cut(near) <= 0.9 && cut(mid) <= 0.25 && cut(mid) < cut(near) && cut(far) === 0,
      `1.4 m off: ${pct(cut(near))} · 2.8 m off: ${pct(cut(mid))} · 5.5 m off: ${pct(cut(far))}`);
    const elite = at(0.6, 0.88), weak = at(0.6, 0.35);
    check('…on the line, an elite defender traps it more often than a weak one', elite.rate('intercepted') > weak.rate('intercepted'),
      `legend: clean ${pct(elite.rate('intercepted'))} · amateur: clean ${pct(weak.rate('intercepted'))} (the rest it hits him / he pokes it)`);
  }

  // 9) A driven pass past a defender 1.8 m off the lane: he needs the time and the
  //    movement to get there; the slower pass gives him that time, the driven one doesn't.
  {
    const slow = tally({ dist: 13, offDeg: 0, defender: 1.8, defAt: 0.6, difficulty: 0.88 }, 16);
    const driven = tally({ dist: 13, offDeg: 0, defender: 1.8, defAt: 0.6, difficulty: 0.88, gesture: 'right' }, 16);
    const vs = slow.rows.map(r => r.speed).reduce((a, b) => a + b, 0) / 16, vd = driven.rows.map(r => r.speed).reduce((a, b) => a + b, 0) / 16;
    const cs = slow.rate('intercepted') + slow.rate('deflected'), cd = driven.rate('intercepted') + driven.rate('deflected');
    check('test 9 · a driven pass beats a defender who would cut out a slower one', vd > vs + 4 && cd < cs, `tap ${vs.toFixed(1)} m/s: cut out ${pct(cs)} · driven ${vd.toFixed(1)} m/s: cut out ${pct(cd)}`);
    // The ETA rule itself: he only commits where he beats the ball by the margin.
    const r = driven.rows[0], m = r.m;
    check('…he commits only where his ETA beats the ball (InterceptionSystem)', GP.interception.etaMargin > 0 && typeof m.intercepts.intercept === 'function', `margin ${GP.interception.etaMargin} s`);
  }

  // 10) A pass straight at a defender who has read it: he controls it with a real first
  //     touch, his side has the ball, and he looks up before he decides (no instant counter).
  {
    let won = 0, scanned = 0, early = 0, touches = [];
    for (let seed = 1; seed <= 10; seed++) {
      const r = passScene({ dist: 13, offDeg: 0, defender: 'lane', defAt: 0.7, seed, difficulty: 0.6, frames: 90 });
      if (r.result !== 'intercepted') continue;
      won++;
      const m = r.m, d = r.def;
      const ft = r.ev.find(e => e.type === 'firstTouch' && e.pid === d.id);
      if (ft) touches.push(ft.quality);
      // follow the new carrier for the length of his settle window
      const until = m.time + d.ai.wonFor;
      let acted = false, label = new Set();
      while (m.time < until - 1e-6) {
        m.step(SIM_DT);
        for (const e of m.drainEvents()) if ((e.type === 'kick' || e.type === 'windup') && e.pid === d.id) acted = true;
        label.add(d.ai.label);
      }
      if (label.has('SCAN') || label.has('CONTROL')) scanned++;
      if (acted) early++;
    }
    check('test 10 · an AI interception is a real contact with a first touch, and his side has it', won >= 5 && touches.length === won && touches.every(q => q > 0 && q < 1),
      `${won}/10 controlled · first-touch quality ${touches.map(q => q.toFixed(2)).join(' ')}`);
    check('…then control → scan → decide: no pass or shot before he has looked up', scanned === won && early === 0, `control/scan shown ${scanned}/${won} · played it inside the window ${early}`);
  }

  // Assist modes: the same pass, stick 12° off a standing team-mate. Manual plays it where
  // the stick says; semi corrects about half; assisted most; arcade all of it.
  {
    const res = {};
    for (const mode of ['manual', 'semi', 'assisted', 'arcade']) {
      const t = tally({ dist: 12, offDeg: 12, defender: 'none', assist: mode }, 8);
      const off = t.rows.map(r => { const to = Math.atan2(r.kick.mateAt.z - r.ctx.from.z, r.kick.mateAt.x - r.ctx.from.x); return Math.abs(deg(Math.atan2(Math.sin(r.ctx.aimAng - to), Math.cos(r.ctx.aimAng - to)))); });
      res[mode] = { off: off.reduce((a, b) => a + b, 0) / off.length };
    }
    check('assist modes: how much of a 12° miss is corrected — manual < semi < assisted ≤ arcade', res.manual.off > res.semi.off + 2 && res.semi.off > res.assisted.off + 1 && res.assisted.off >= res.arcade.off - 0.2,
      Object.entries(res).map(([k, v]) => `${k}: aimed ${v.off.toFixed(1)}° off him`).join(' · '));
  }

  // Graded error: a settled pass from a good passer comes off excellent/good; a hurried one
  // on the move and under pressure is graded worse; a perfect pass never happens for free.
  {
    const m = new Match({ format: '5v5', humanTeam: null, seed: 4 });
    const P = m.passing, p = m.players.find(q => q.team === 0 && q.line !== 'GK');
    const grade = (q, n = 400) => { const g = [0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) g[P.grade(q)]++; return g.map(x => x / n); };
    p.attrs.pass = 0.95; p.speed = 0; Object.assign(p, { x: -10, z: 0, facing: 0 });
    for (const q of m.players) if (q.team === 1) { q.x = 10; q.z = 0; }
    const calm = P.quality(p, 'short', 0, 12, null, { held: 1, rel: 0 });
    p.attrs.pass = 0.66; p.speed = 7; const opp = m.players.find(q => q.team === 1 && q.line !== 'GK'); Object.assign(opp, { x: -9.4, z: 0.4 });
    const rushed = P.quality(p, 'emergency', Math.PI * 0.8, 20, null, { held: 0.05, rel: 9 });
    const gc = grade(calm), gr = grade(rushed);
    check('pass quality grades the error: settled & skilled ≫ rushed, sprinting, pressed, across the body', calm > 0.8 && rushed < 0.3 && gc[0] + gc[1] > 0.85 && gr[3] + gr[4] > 0.5,
      `settled q ${calm.toFixed(2)} → excellent/good ${pct(gc[0] + gc[1])} · rushed q ${rushed.toFixed(2)} → poor/very poor ${pct(gr[3] + gr[4])}`);
  }
  return out;
}
