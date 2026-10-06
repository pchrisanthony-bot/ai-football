// Receiving a pass (the movement brief's tests A–E and J), headless, many seeded scenes.
// The man a pass is for has to see it coming, get there and be set as it arrives, and take
// a touch that means something — for the person playing (whatever the stick is doing) and
// for the AI.
import { receiveTally } from './lib/receive.mjs';
import { Match, SIM_DT } from './lib/sim.mjs';

const pct = x => `${Math.round(x * 100)}%`;
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const angBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.z * b.z) / ((Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z)) || 1))));

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // A) A direct pass to a team-mate standing still — whatever the person does with the stick
  //    (it was aiming the pass when the control moved to the receiver). The root cause of
  //    "he ran straight past it": the passer's stick drove the receiver away from the ball.
  {
    const styles = ['release', 'hold', 'toBall'].map(s => [s, receiveTally({ stickAfter: s })]);
    const worst = Math.min(...styles.map(([, t]) => t.rate('received')));
    const past = styles.reduce((n, [, t]) => n + (t.passedBy || 0), 0);
    const set = avg(styles.flatMap(([, t]) => t.contacts.map(c => c.speed)));
    check('A · a direct pass to a standing team-mate is received, whatever the stick (≥ 95%, never run past)', worst >= 0.95 && past === 0,
      styles.map(([s, t]) => `${s} ${pct(t.rate('received'))}`).join(' · ') + ` · passed by ${past}`);
    check('…and he is set when it arrives (not running through it: < 2.5 m/s at the touch)', set < 2.5, `${set.toFixed(1)} m/s`);
    const ai = receiveTally({ by: 'ai' });
    check('A · the AI\'s receiver too (≥ 95%)', ai.rate('received') >= 0.95, `${pct(ai.rate('received'))} · at the touch ${avg(ai.contacts.map(c => c.speed)).toFixed(1)} m/s`);
  }

  // B) A team-mate on the move: he reads where it'll meet him and takes it on the run.
  {
    const across = receiveTally({ receiverRun: 5, stickAfter: 'run' });
    const runOn = receiveTally({ receiverRun: 6, runDir: 0.3, button: 'through', stickAfter: 'release' });
    const ai = receiveTally({ by: 'ai', receiverRun: 6, runDir: 0.3, kind: 'through' });
    check('B · a moving receiver gets it — across, onto a through ball, for the AI too (≥ 90%)', Math.min(across.rate('received'), runOn.rate('received'), ai.rate('received')) >= 0.9,
      `across ${pct(across.rate('received'))} · through ${pct(runOn.rate('received'))} · AI through ${pct(ai.rate('received'))}`);
    // his touch goes the way the stick points (his run)
    const dev = across.contacts.filter(c => c.out).map(c => angBetween(c.out, { x: 0, z: 1 }) * 180 / Math.PI);
    check('…with the stick on his run, the first touch goes with his run (within 45°)', dev.length && avg(dev) < 45, `${avg(dev).toFixed(0)}° off his run on average`);
    const relThrough = avg(runOn.contacts.map(c => c.rel));
    check('…a through ball is run onto, not stopped for (relative pace at the touch < 6 m/s)', relThrough < 6, `${relThrough.toFixed(1)} m/s`);
  }

  // C) A pass a little to his side (the stick 10° off, assist corrects most): he adjusts and
  //    gets to it — or it's a fair miss, never a ball that went past him untouched.
  {
    const t = receiveTally({ offDeg: 10, stickAfter: 'hold' }), t2 = receiveTally({ offDeg: -10, stickAfter: 'release', dist: 14 });
    check('C · a slightly misaligned pass: he adjusts (≥ 90%, none run past)', Math.min(t.rate('received'), t2.rate('received')) >= 0.9 && !(t.passedBy || t2.passedBy),
      `${pct(t.rate('received'))} · ${pct(t2.rate('received'))}`);
  }

  // D) Under pressure (the AI receiver): a defender to his side → the first touch goes away
  //    from him; a defender tight behind → he kills it and keeps it (cushion, body in the way).
  {
    // (a defender this close sometimes steps in and cuts the pass out first: that's his
    // read — the test is about the touches the receiver gets)
    const side = receiveTally({ by: 'ai', defender: { x: 0.4, z: 1.5 } }, 24);
    const away = side.contacts.filter(c => c.out && c.def).map(c => angBetween(c.out, { x: c.def.x - c.at.x, z: c.def.z - c.at.z }) * 180 / Math.PI);
    const ok = away.filter(a => a > 90).length / Math.max(1, away.length);
    check('D · a defender at his side: the first touch goes away from him (≥ 80% of touches)', ok >= 0.8 && away.length >= 8, `${pct(ok)} of ${away.length} touches away · mean ${avg(away).toFixed(0)}° from the defender · received ${pct(side.rate('received'))} · cut out ${pct(side.rate('intercepted'))}`);
    // straight behind him (on the far side from the ball)
    const ang = 0.5, behind = { x: Math.cos(ang) * 1.3, z: Math.sin(ang) * 1.3 };
    // (he comes short in front of the man — then he's not tight any more and takes it away;
    // if he's still tight as it arrives he kills it and shields it)
    const back = receiveTally({ by: 'ai', defender: behind });
    const safe = back.contacts.filter(c => c.mode === 'cushion' || (c.out && c.def && angBetween(c.out, { x: c.def.x - c.at.x, z: c.def.z - c.at.z }) > Math.PI / 2)).length / Math.max(1, back.contacts.length);
    const cush = back.contacts.filter(c => c.mode === 'cushion').length;
    check('…a defender tight behind: he keeps it (≥ 80%), his touch never back into the man (cushioned or away ≥ 90%)', back.rate('received') >= 0.8 && safe >= 0.9, `kept ${pct(back.rate('received'))} · lost ${pct(back.rate('intercepted'))} · safe touches ${pct(safe)} (${cush} cushioned)`);
    const free = receiveTally({ by: 'ai' });
    const fwd = free.contacts.filter(c => c.out).map(c => c.out.x);
    check('…with nobody near, a positive touch into space toward goal', avg(fwd) > 0.8, `${avg(fwd).toFixed(1)} m/s toward goal off the touch`);
  }

  // E) A fast (driven) pass: he doesn't run into it — he gets set and cushions it.
  {
    const t = receiveTally({ stickAfter: 'hold', driven: true, dist: 14 });
    const into = avg(t.contacts.map(c => c.speed));
    check('E · a driven pass is received (≥ 90%), the receiver set (< 2.5 m/s), not bounced off him', t.rate('received') >= 0.9 && into < 2.5 && !(t.heavy > 1),
      `${pct(t.rate('received'))} · ${into.toFixed(1)} m/s at the touch · rel ${avg(t.contacts.map(c => c.rel)).toFixed(1)} m/s · heavy ${t.heavy || 0}`);
  }

  // J) The pass goes behind him (he's running away from it): he turns and gets back to it,
  //    he doesn't sprint on along his old line.
  {
    const t = receiveTally({ receiverRun: 6, runDir: 0.5 + Math.PI / 2, stickAfter: 'release', dist: 12 });
    check('J · a pass behind a running team-mate: he turns back to it (≥ 85%, none run past)', t.rate('received') >= 0.85 && !t.passedBy, `${pct(t.rate('received'))} · passed by ${t.passedBy || 0}`);
  }

  // AI v AI: the man a pass is for never lets it run past him untouched.
  {
    let passes = 0, past = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const m = new Match({ humanTeam: null, seconds: 120, seed });
      let open = null;
      while (m.phase !== 'fulltime') {
        m.step(SIM_DT);
        if (open && !m.ball.owner && open.to) {
          const d = Math.hypot(m.ball.x - open.to.x, m.ball.z - open.to.z);
          open.minD = Math.min(open.minD, d);
          if (!open.touched && open.minD < 1.0 && d > 2.5) { past++; open = null; }
        }
        for (const e of m.drainEvents()) {
          if (e.type === 'goalDone') m.resumeAfterGoal();
          if (e.type === 'kick' && ['pass', 'through', 'lob'].includes(e.kind) && m.ball.passTo) { passes++; open = { to: m.ball.passTo, minD: 99, touched: false }; continue; }
          if (open && ['firstTouch', 'control', 'deflect', 'block', 'chest', 'header', 'tackle', 'save', 'claim'].includes(e.type)) open = null;
        }
      }
    }
    check('AI v AI: a pass is never left to run past the man it was for (≤ 1%)', past <= passes * 0.01, `${past} of ${passes} passes`);
  }
  return out;
}
