// Pass scenarios with the real human controller: a carrier, one team-mate to pass to and
// (optionally) one defender placed against the passing lane, frozen where he stands until
// the ball is struck (then the AI has him). The pass is played the way a player plays it:
// the analog stick aimed `offDeg` off the team-mate and PASS (or THROUGH / LOB) tapped.
// The outcome is the first thing that happens to the ball after the kick:
//   'received'     the team-mate has it
//   'intercepted'  an opponent controlled it
//   'deflected'    an opponent got a touch (block, poke, deflection) without controlling it
//   'loose' / 'other mate' / 'out' / 'no pass'
import { Match, SIM_DT, FakeInput } from './sim.mjs';
import { HumanController } from '../../src/game/human.js';

// defender: 'none' | 'lane' (on the line) | 'near' (1.4 m off) | 'far' (5.5 m off) | a number (m off the line)
// defAt: where along the lane (0 = passer, 1 = team-mate).
export function passScene({
  dist = 11, offDeg = 0, defender = 'none', defAt = 0.55, receiverRun = 0, seed = 1, hold = 4,
  assist, difficulty = 0.6, frames = 180, button = 'pass', gesture = null, side = 0.5, defFacing = null, passer = null,
} = {}) {
  const m = new Match({ humanTeam: 0, seconds: 9999, seed, difficulty, ...(assist ? { passAssist: assist } : {}) });
  m.phase = 'play'; m.restart = null;
  const team0 = m.players.filter(p => p.team === 0 && p.line !== 'GK');
  const carrier = team0[0], mate = team0[1];
  if (passer) Object.assign(carrier.attrs, passer);
  const def = m.players.find(p => p.team === 1 && p.line !== 'GK');
  for (const p of m.players) if (p !== carrier && p !== mate && p !== def && p.line !== 'GK') p.active = false;
  Object.assign(carrier, { x: -6, z: 0, speed: 0, vx: 0, vz: 0, heading: 0, facing: 0 });
  // the team-mate up and across from him (`side` rad off straight ahead), standing or running on
  const ang = side;
  Object.assign(mate, { x: carrier.x + Math.cos(ang) * dist, z: carrier.z + Math.sin(ang) * dist, speed: receiverRun, heading: 0, facing: Math.PI, vx: receiverRun, vz: 0 });
  const off = defender === 'none' ? null : typeof defender === 'number' ? defender : { lane: 0, near: 1.4, far: 5.5 }[defender];
  if (off == null) def.active = false;
  else {
    Object.assign(def, { x: carrier.x + Math.cos(ang) * dist * defAt - Math.sin(ang) * off, z: carrier.z + Math.sin(ang) * dist * defAt + Math.cos(ang) * off, speed: 0, vx: 0, vz: 0 });
    def.facing = def.heading = defFacing ?? Math.atan2(carrier.z - def.z, carrier.x - def.x);
    def.frozen = true;
  }
  m.loseBall();
  Object.assign(m.ball, { x: carrier.x + 0.45, z: carrier.z, y: 0.11, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
  m.gainPossession(carrier, true);
  carrier.possessT = 1;                        // settled on the ball
  const inp = new FakeInput(), h = new HumanController(m, 0, inp);
  m.human = null; h.setHuman(carrier);
  const aim = ang + offDeg * Math.PI / 180;
  const ev = [];
  let kick = null, first = null;
  for (let f = 0; f < frames; f++) {
    const press = f >= 2 && f < 2 + hold;
    const stick = f < 2 + hold + 1;
    inp.move.x = stick ? Math.cos(aim) : 0; inp.move.y = stick ? -Math.sin(aim) : 0;
    inp.set(press ? [button] : [], gesture && f === 2 + hold ? { gest: { [button]: gesture } } : {});
    h.update(1 / 60); m.step(SIM_DT); m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      ev.push(e);
      if (e.type === 'kick' && !kick) { kick = { ...e, f, ctx: m.passing.ctx, mateAt: { x: mate.x, z: mate.z } }; def.frozen = false; continue; }
      if (kick && !first && e.pid !== carrier.id && ['firstTouch', 'control', 'deflect', 'block', 'chest', 'header'].includes(e.type)) first = { ...e, f };
    }
    if (!kick) continue;
    const o = m.ball.owner;
    const base = { t: +((f - kick.f) / 60).toFixed(2), speed: +kick.speed.toFixed(1), ctx: kick.ctx, kick, m, ev, first, def, mate, carrier };
    if (first && first.pid === def.id && !o) return { result: 'deflected', ...base };
    if (o && o !== carrier) return { result: o === mate ? 'received' : o.team === 0 ? 'other mate' : 'intercepted', by: o.name, ...base };
    if (m.phase === 'restart') return { result: 'out', ...base };
  }
  return { result: kick ? 'loose' : 'no pass', m, ev, ctx: kick?.ctx, kick, first, def, mate, carrier, speed: kick ? +kick.speed.toFixed(1) : null };
}

// Run a scene over seeds (and both signs of the aim error); tally the results.
export function tally(opts, seeds = 12) {
  const t = { n: 0 }, rows = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const r = passScene({ ...opts, seed, offDeg: (opts.offDeg || 0) * (seed % 2 ? 1 : -1) });
    t[r.result] = (t[r.result] || 0) + 1; t.n++;
    rows.push(r);
  }
  t.rate = k => (t[k] || 0) / t.n;
  t.rows = rows;
  return t;
}
