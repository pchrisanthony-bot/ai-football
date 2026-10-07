// The person's keeper (with the ball in his hands, the control is his): he throws it to the
// team-mate the stick picks out, kicks it long to the man (or the spot) he aims at — never
// to a random spot — stays in his area, and plays it himself if nothing is chosen.
import { Match, SIM_DT, FakeInput } from './lib/sim.mjs';
import { HumanController } from '../src/game/human.js';
import { PITCH } from '../src/sim/pitch.js';
import { predictPath } from '../src/sim/ball.js';

function keeperScene(seed, { stick = null, button = null, hold = 4, at = 40, frames = 360, walk = null } = {}) {
  const m = new Match({ humanTeam: 0, seconds: 9999, seed });
  m.phase = 'play'; m.restart = null;
  const gk = m.keeper(0), outs = m.players.filter(p => p.team === 0 && p.line !== 'GK');
  // team-mates spread up the pitch, opponents back in their half
  const spots = [[-9, 5], [-9, -5], [-2, 0], [6, 4]];
  outs.forEach((p, i) => Object.assign(p, { x: spots[i][0], z: spots[i][1], speed: 0, vx: 0, vz: 0 }));
  m.players.filter(p => p.team === 1 && p.line !== 'GK').forEach((p, i) => Object.assign(p, { x: 4 + i * 2, z: -6 + i * 3.5, speed: 0, vx: 0, vz: 0 }));
  Object.assign(gk, { x: -14.5, z: 0, speed: 0, vx: 0, vz: 0, facing: 0, heading: 0 });
  m.loseBall(); Object.assign(m.ball, { x: gk.x + 0.3, z: 0, y: 1, vx: 0, vy: 0, vz: 0 });
  m.gainPossession(gk, true); m.ball.inHands = true;
  const inp = new FakeInput(), h = new HumanController(m, 0, inp);
  for (const q of m.players) q.human = false; m.human = null;
  const ev = [];
  let kick = null, res = null, maxOut = 0;
  for (let f = 0; f < frames && !res; f++) {
    const aim = stick ? (typeof stick === 'function' ? stick(m) : stick) : null;
    inp.move.x = walk ? walk.x : aim && f >= at - 2 && f < at + hold + 1 ? aim.x : 0;
    inp.move.y = walk ? -walk.z : aim && f >= at - 2 && f < at + hold + 1 ? -aim.z : 0;
    inp.set(button && f >= at && f < at + hold ? [button] : []);
    h.update(1 / 60); m.step(SIM_DT); m.step(SIM_DT);
    if (m.ball.owner === gk && m.ball.inHands) maxOut = Math.max(maxOut, Math.hypot(gk.x - m.ownGoalX(0), gk.z));
    for (const e of m.drainEvents()) {
      ev.push(e);
      if (e.type === 'kick' && e.pid === gk.id && !kick) {
        // where it was aimed (the keeper's target) and where it will come down, nobody in the way
        const pp = predictPath(m.ball, 3, 1 / 120), bounce = pp.events.find(x => x.type === 'bounce');
        const fall = bounce ? pp.pts[Math.round(bounce.t * 120)] : pp.pts[pp.pts.length - 1];
        kick = { f, kind: e.kind, to: m.ball.passTo, aim: gk.action && gk.action.target, fall };
      }
    }
    if (kick) { const o = m.ball.owner; if (o && o !== gk) res = { by: o, mate: o.team === 0 }; }
  }
  return { m, gk, kick, res, human: m.human, maxOut, outs };
}

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });
  const dirTo = q => m => { const g = m.keeper(0), dx = q(m).x - g.x, dz = q(m).z - g.z, d = Math.hypot(dx, dz); return { x: dx / d, z: dz / d }; };

  // the control is the person's as soon as his keeper has it
  { const s = keeperScene(1, { frames: 20 }); check('the person controls his keeper when the keeper has the ball', s.human === s.gk, `human ${s.human?.name} · keeper ${s.gk.name}`); }

  // PASS with the stick at a team-mate: thrown to that team-mate, who has it
  {
    let to = 0, got = 0, n = 0;
    for (let seed = 1; seed <= 8; seed++) for (const k of [0, 1, 2]) {
      const s = keeperScene(seed, { button: 'pass', stick: dirTo(m => m.players.filter(p => p.team === 0 && p.line !== 'GK')[k]) });
      const target = s.outs[k];
      n++; if (s.kick && s.kick.kind === 'throw') to++; if (s.res && s.res.by === target) got++;
    }
    check('PASS: the keeper throws it (≥ 90%), and the team-mate the stick points at has it (≥ 90%)', to / n >= 0.9 && got / n >= 0.9, `thrown ${to}/${n} · the man aimed at has it ${got}/${n}`);
  }

  // LOB (long) at the far team-mate: a long ball meant for him, not a random spot
  {
    let to = 0, near = 0, n = 0, miss = [];
    for (let seed = 1; seed <= 8; seed++) {
      const s = keeperScene(seed, { button: 'lob', hold: 30, stick: dirTo(m => m.players.filter(p => p.team === 0 && p.line !== 'GK')[3]) });
      n++; if (s.kick && s.kick.to === s.outs[3]) to++;
      const k = s.kick;
      if (k && k.fall && k.aim) { const d = Math.hypot(k.fall.x - k.aim.x, k.fall.z - k.aim.z); miss.push(d); if (d < 3) near++; }
    }
    check('LOB / long: kicked long to the team-mate he aims at (≥ 90%), coming down where he aimed it (into his run, within 3 m, ≥ 75%) — not a random spot', to / n >= 0.9 && near / n >= 0.75, `meant for him ${to}/${n} · comes down within 3 m ${near}/${n} · off by ${miss.map(d => d.toFixed(1)).join(' ')} m`);
  }

  // nothing chosen: after a few seconds he plays it himself
  {
    const s = keeperScene(3, { frames: 480 });
    check('nothing chosen: the keeper plays it himself after a few seconds (no stall)', !!s.kick, s.kick ? `${s.kick.kind} after ${(s.kick.f / 60).toFixed(1)} s to ${s.kick.to ? s.kick.to.name : 'space'}` : 'never');
  }

  // walking with it: he can't carry it out of his area
  {
    const s = keeperScene(2, { walk: { x: 1, z: 0.3 }, frames: 180 });
    check('walking with it in his hands, he stays in his area', s.maxOut <= PITCH.boxR + 0.05, `furthest ${s.maxOut.toFixed(2)} m from goal (area ${PITCH.boxR} m)`);
  }
  return out;
}
