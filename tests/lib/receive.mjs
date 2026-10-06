// Reception scenes: a carrier, the team-mate a pass is for, and (optionally) a defender
// placed relative to the team-mate. The pass is played by the person (the real
// HumanController: stick + PASS, the control then switches to the receiver) or by the AI
// (Match.requestKick). Until the ball is struck the team-mate does what the scene says
// (stands, or runs along runDir). Outcome:
//   'received' · 'heavy' (bounced off the receiver) · 'passedBy' (it came within 1 m of him
//   and he never touched it) · 'intercepted' · 'loose'
// contact: the receiver's first touch — { rel, q, mode, speed (his, at contact), out (the
// ball's velocity off the touch), intent, def (the defender's position) }.
import { Match, SIM_DT, FakeInput } from './sim.mjs';
import { HumanController } from '../../src/game/human.js';

export function receiveScene({
  by = 'human', dist = 11, side = 0.5, offDeg = 0, stickAfter = 'release', receiverRun = 0, runDir = Math.PI / 2,
  seed = 1, button = 'pass', hold = 4, defender = null, kind = 'pass', driven = false, frames = 240, difficulty = 0.6, onFrame = null,
} = {}) {
  const human = by === 'human';
  const m = new Match({ humanTeam: human ? 0 : null, seconds: 9999, seed, difficulty });
  m.phase = 'play'; m.restart = null;
  const team0 = m.players.filter(p => p.team === 0 && p.line !== 'GK');
  const carrier = team0[0], mate = team0[1];
  const def = m.players.find(p => p.team === 1 && p.line !== 'GK');
  for (const p of m.players) if (p !== carrier && p !== mate && p !== def && p.line !== 'GK') p.active = false;
  if (!defender) def.active = false;
  Object.assign(carrier, { x: -6, z: 0, speed: 0, vx: 0, vz: 0, heading: side, facing: side });
  const mx = carrier.x + Math.cos(side) * dist, mz = carrier.z + Math.sin(side) * dist;
  Object.assign(mate, { x: mx, z: mz, speed: receiverRun, heading: runDir, facing: runDir, vx: Math.cos(runDir) * receiverRun, vz: Math.sin(runDir) * receiverRun });
  if (defender) { Object.assign(def, { x: mx + defender.x, z: mz + defender.z, speed: 0, vx: 0, vz: 0 }); def.facing = def.heading = Math.atan2(mz - def.z, mx - def.x); }
  m.loseBall();
  Object.assign(m.ball, { x: carrier.x + Math.cos(side) * 0.45, z: carrier.z + Math.sin(side) * 0.45, y: 0.11, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
  m.gainPossession(carrier, true);
  carrier.possessT = 1;
  const inp = new FakeInput();
  let h = null;
  if (human) { h = new HumanController(m, 0, inp); for (const q of m.players) q.human = false; m.human = null; h.setHuman(carrier); }
  let kick = null;
  // Before the strike the team-mate does what the scene says; the carrier waits for the scene's
  // pass; the defender stands (then the AI has them all).
  const act = m.ai.act.bind(m.ai);
  m.ai.act = (q, dt) => {
    if (!kick && q === mate) { q.move.x = Math.cos(runDir); q.move.z = Math.sin(runDir); q.move.speed = receiverRun; return; }
    if (!kick && (q === carrier || q === def)) { q.move.speed = 0; return; }
    act(q, dt);
  };
  if (!human) { const think = m.ai.think.bind(m.ai); m.ai.think = q => { if (!kick && q === carrier) return; think(q); }; }
  const aim = side + offDeg * Math.PI / 180;
  let minD = 99, touched = false, res = null, contact = null;
  for (let f = 0; f < frames && !res; f++) {
    if (human) {
      const press = f >= 2 && f < 2 + hold;
      let sx = 0, sy = 0;
      if (!kick || f < 2 + hold + 1 || stickAfter === 'hold') { sx = Math.cos(aim); sy = -Math.sin(aim); }
      else if (stickAfter === 'toBall') { const b = m.ball, dx = b.x - mate.x, dz = b.z - mate.z, d = Math.hypot(dx, dz) || 1; sx = dx / d; sy = -dz / d; }
      else if (stickAfter === 'run') { sx = Math.cos(runDir); sy = -Math.sin(runDir); }
      inp.move.x = sx; inp.move.y = sy;
      inp.set(press ? [button] : [], {});
      if (driven && f === 2 + hold) inp.gest = { [button]: 'right' };
      h.update(1 / 60);
    } else if (f === 2 && !kick) {
      m.requestKick(carrier, kind, { receiver: mate });
    }
    for (let k = 0; k < 2; k++) {
      m.step(SIM_DT);
      if (kick && !touched && !m.ball.owner) minD = Math.min(minD, Math.hypot(m.ball.x - mate.x, m.ball.z - mate.z));
    }
    for (const e of m.drainEvents()) {
      if (e.type === 'kick' && !kick) { kick = { f, speed: e.speed, mateSpeed: Math.hypot(mate.vx, mate.vz), ctx: m.passing.ctx }; continue; }
      if (!kick) continue;
      if (e.pid === mate.id && e.type === 'firstTouch') contact = { rel: e.relIn, q: e.quality, mode: e.mode, speed: Math.hypot(mate.vx, mate.vz), out: e.out, intent: e.intent, def: def.active ? { x: def.x, z: def.z } : null, at: { x: mate.x, z: mate.z }, facing: mate.facing, mateV: { x: mate.vx, z: mate.vz } };
      if (e.pid === mate.id && (e.type === 'deflect' || e.type === 'block') && !res) res = 'heavy';
      if (e.pid === mate.id) touched = true;
    }
    if (onFrame && kick) onFrame(f - kick.f, { m, mate, def, carrier });
    if (!kick || res) continue;
    const o = m.ball.owner;
    if (o === mate) res = 'received';
    else if (o && o.team !== 0) res = 'intercepted';
    else if (!touched && minD < 1.0 && Math.hypot(m.ball.x - mate.x, m.ball.z - mate.z) > 2.5) res = 'passedBy';
  }
  return { res: res || (kick ? 'loose' : 'no pass'), minD, contact, kick, m, mate, def, carrier };
}

export function receiveTally(opts, seeds = 16) {
  const t = { n: 0 }, rows = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const r = receiveScene({ ...opts, seed });
    t[r.res] = (t[r.res] || 0) + 1; t.n++;
    rows.push(r);
  }
  t.rate = k => (t[k] || 0) / t.n;
  t.rows = rows;
  t.contacts = rows.map(r => r.contact).filter(Boolean);
  return t;
}
