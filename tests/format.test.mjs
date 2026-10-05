// The 5v5 cage from data: every formation builds a valid match, kick-offs follow the laws,
// sides are team-relative, bad configs are refused, the AI plays with the tuned cage
// distances, the ball never leaves the cage, and player switching picks the man who wins
// the ball soonest.
import { Match, SIM_DT, FakeInput } from './lib/sim.mjs';
import { HumanController } from '../src/game/human.js';
import { FORMATS, createMatchConfig } from '../src/sim/formats.js';
import { buildPitch, PITCHES, PITCH } from '../src/sim/pitch.js';
import { aiRanges } from '../src/sim/ai/ranges.js';

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 1) Every format × formation pairing (home and away) builds a sound match.
  {
    const bad = [];
    let n = 0;
    for (const [fid, F] of Object.entries(FORMATS)) {
      for (const home of F.formations) for (const away of F.formations) {
        const m = new Match({ format: fid, formations: [home, away], humanTeam: null, seed: 2 });
        n++;
        const tag = `${fid} ${home} v ${away}`;
        for (let t = 0; t < 2; t++) {
          const ps = m.players.filter(p => p.team === t);
          if (ps.length !== F.teamSize) bad.push(`${tag}: team ${t} has ${ps.length}`);
          if (ps.filter(p => p.line === 'GK').length !== 1) bad.push(`${tag}: team ${t} keepers`);
          if (new Set(ps.map(p => p.name)).size !== ps.length) bad.push(`${tag}: a player picked twice`);
        }
        if (PITCH.id !== F.pitch) bad.push(`${tag}: live pitch ${PITCH.id}`);
        // Kick-off (team 0): everyone in his own half; taker on the spot; the other
        // side outside the centre circle.
        const taker = m.ball.owner;
        for (const p of m.players) {
          const dir = m.teams[p.team].dir;
          if (p.x * dir > 0.01) bad.push(`${tag}: ${p.name} not in own half`);
          if (p.team === 1 && Math.hypot(p.x, p.z) < PITCH.centreR) bad.push(`${tag}: ${p.name} inside the circle`);
          if (Math.abs(p.z) > PITCH.halfW || Math.abs(p.x) > PITCH.halfL) bad.push(`${tag}: ${p.name} off the pitch`);
        }
        if (!taker || taker.team !== 0 || Math.hypot(taker.x, taker.z) > 1) bad.push(`${tag}: kick-off taker`);
      }
    }
    check('every format × formation builds a valid match (size, one keeper, laws of the kick-off)', !bad.length, bad.length ? bad.slice(0, 3).join('; ') : `${n} pairings`);
  }

  // 2) The 5v5 street five keep their places (line-up builder).
  {
    const m = new Match({ humanTeam: null, home: 'cage', away: 'rooftop' });
    const five = m.players.filter(p => p.team === 0).map(p => `${p.role}:${p.name}`).join(' ');
    const want = 'GK:Okafor FIXO:Brandt ALA:Silva ALA:Diallo PIVO:Reyes';
    const silva = m.players.find(p => p.name === 'Silva');
    check('5v5: the street five keep their places (left ala on the left)', five === want && silva.form.y < 0.5, five);
  }

  // 3) Formations are team-relative: each side's left ala is on ITS left.
  {
    const m = new Match({ formations: ['1-2-1', '1-2-1'], humanTeam: null });
    const la = t => m.players.find(p => p.team === t && p.role === 'ALA' && p.form.y < 0.5);
    // Facing +x, left is −z; facing −x, left is +z.
    check('formations are team-relative (both left alas on their own left)', la(0).z < 0 && la(1).z > 0, `home z ${la(0).z.toFixed(1)}, away z ${la(1).z.toFixed(1)}`);
  }

  // 4) Bad data is refused with a clear error.
  {
    const errs = [];
    const tryIt = (what, fn) => { try { fn(); errs.push(`${what}: accepted`); } catch (e) { if (!/pitch|formation|format/i.test(e.message)) errs.push(`${what}: ${e.message}`); } };
    const C = PITCHES.cage5;
    tryIt('negative length', () => buildPitch({ ...C, length: -5 }));
    tryIt('goal wider than pitch', () => buildPitch({ ...C, goal: { ...C.goal, width: 40 } }));
    tryIt('keeper area past halfway', () => buildPitch({ ...C, keeperArea: { radius: 20 } }));
    tryIt('unknown formation', () => createMatchConfig({ formations: ['4-4-2', '1-2-1'] }));
    tryIt('unknown format', () => createMatchConfig({ format: '11v11' }));
    check('invalid pitches / formations / formats are refused', !errs.length, errs.join('; ') || '5 refused');
  }

  // 5) Switching: a loose ball heading past our nearest man toward a team-mate
  //    switches to the team-mate who will get there first, not the man nearest it now.
  {
    const res = [];
    for (const format of ['5v5']) {
      const m = new Match({ format, humanTeam: 0, seconds: 9999, seed: 3 });
      m.phase = 'play';
      const outs = m.players.filter(p => p.team === 0 && p.line !== 'GK');
      const [A, B] = outs;
      for (const p of m.players) if (p.line !== 'GK' && p !== A && p !== B) p.active = false;
      Object.assign(A, { x: 3, z: 0, speed: 0, heading: 0, facing: 0 });
      Object.assign(B, { x: -8, z: 5, speed: 0, heading: 0, facing: 0 });
      const inp = new FakeInput();
      const h = new HumanController(m, 0, inp);
      m.human = null; h.setHuman(A); h.switchCD = 0;
      m.loseBall();
      const tx = -10, tz = 6, d = Math.hypot(tx - 5, tz), v = 14;
      Object.assign(m.ball, { x: 5, y: 0.11, z: 0, vx: (tx - 5) / d * v, vy: 0, vz: tz / d * v, wx: 0, wy: 0, wz: 0, lastTouch: m.players.find(p => p.team === 1 && p.line !== 'GK') });
      let at = null;
      for (let f = 0; f < 30 && at == null; f++) { inp.set([]); h.update(1 / 60); m.step(SIM_DT); m.step(SIM_DT); if (m.human === B) at = f; }
      res.push(`${format}: ${at != null ? `switched after ${at + 1} frames` : `stayed on ${m.human.name}`}`);
      if (at == null) res.fail = true;
    }
    check('switching follows the man who wins the loose ball first (not the nearest now)', !res.fail, res.join(' · '));
  }

  // 6) …and doesn't flicker between two equally placed team-mates.
  {
    const m = new Match({ humanTeam: 0, seconds: 9999, seed: 4 });
    m.phase = 'play';
    const outs = m.players.filter(p => p.team === 0 && p.line !== 'GK');
    const [A, B] = outs;
    for (const p of m.players) if (p.line !== 'GK' && p !== A && p !== B && p.team === 0) p.active = false;
    Object.assign(A, { x: -4, z: -2 }); Object.assign(B, { x: -4, z: 2 });
    const inp = new FakeInput();
    const h = new HumanController(m, 0, inp);
    m.human = null; h.setHuman(A); h.switchCD = 0;
    const carrier = m.players.find(p => p.team === 1 && p.line === 'ATT');
    Object.assign(carrier, { x: 2, z: 0 });
    m.loseBall(); Object.assign(m.ball, { x: 2.4, z: 0, vx: 0, vz: 0 }); m.gainPossession(carrier, true);
    let switches = 0, last = m.human;
    for (let f = 0; f < 180; f++) { inp.set([]); h.update(1 / 60); m.step(SIM_DT); m.step(SIM_DT); if (m.human !== last) { switches++; last = m.human; } }
    check('switching has hysteresis (no flicker between equal men)', switches <= 2, `${switches} switches in 3 s`);
  }
  // 7) The AI plays with the distances it was tuned with in the cage.
  {
    const R = aiRanges();
    const want = { shot: 19, groundPass: 24, threat: 30, run: 7, keeperSet: 14, rush: 5, minXg: 0.07, saveMax: 0.95 };
    const bad = Object.entries(want).filter(([k, v]) => Math.abs(R[k] - v) > 1e-9).map(([k, v]) => `${k} ${R[k]} ≠ ${v}`);
    if (R.support.join() !== '2.5,4.5' || R.lane.join() !== '3.5,16' || R.keeperOut.join() !== '1.6,2.4' || R.space.join() !== '10,14') bad.push('radii');
    check('the AI plays with the tuned cage distances', !bad.length, bad.join('; ') || 'identical');
  }

  // 8) The cage never goes out of play: no restarts but kick-offs in 90 s of AI football.
  {
    const m = new Match({ humanTeam: null, seconds: 90, seed: 2 });
    const kinds = new Set();
    for (let i = 0; i < 90 * 120 * 2 && m.phase !== 'fulltime'; i++) { m.step(SIM_DT); for (const e of m.drainEvents()) { if (e.type === 'restart') kinds.add(e.kind); if (e.type === 'goalDone') m.resumeAfterGoal(); } }
    check('the cage never goes out of play', kinds.size === 0, kinds.size ? [...kinds].join(',') : 'none in 90 s');
  }
  return out;
}
