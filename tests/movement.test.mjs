// Player movement + dribbling: momentum locomotion and knock-on touches, measured
// the same way they were measured in play (sprint, cut, stop, dribble, turn).
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';

// One player alone on the court, driven like a human stick (m.human skips the AI).
function solo(arch, withBall = false) {
  const m = new Match({ humanTeam: 0, mode: 'drill', seconds: 9999, seed: 1 });
  m.phase = 'play';
  for (const q of m.players) q.active = false;
  const p = m.players.find(q => q.team === 0 && q.arch === arch) || m.kickTaker(0);
  Object.assign(p, { active: true, x: -13, z: 0, speed: 0, vx: 0, vz: 0, heading: 0, facing: 0, human: true, stamina: 1 });
  m.human = p;
  if (withBall) { m.ball.x = p.x + 0.45; m.ball.z = p.z; m.gainPossession(p, true); }
  else Object.assign(m.ball, { x: 12, z: 7, vx: 0, vz: 0, owner: null });
  const events = [];
  const drive = (x, z, speed, sprint, secs, each) => {
    p.move.x = x; p.move.z = z; p.move.speed = speed; p.sprinting = sprint;
    for (let t = 0; t < secs; t += SIM_DT) { m.step(SIM_DT); const ev = m.drainEvents(); events.push(...ev); each && each(t + SIM_DT, ev); }
  };
  return { m, p, drive, events };
}

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 90° cut at full sprint: has to brake into it (it used to snap round in 0.2 s at full pace).
  {
    const { p, drive } = solo('Finisher');
    drive(1, 0, 7.4, true, 1.6);
    const v0 = p.speed;
    let tTurn = null, vMin = 99;
    drive(0, -1, 7.4, true, 1.0, t => { vMin = Math.min(vMin, p.speed); if (tTurn == null && Math.abs(Math.cos(p.heading)) < 0.2) tTurn = t; });
    check('sprint 90° cut brakes into a plant (0.3–0.7 s, speed dips)', tTurn > 0.3 && tTurn < 0.7 && vMin < v0 * 0.8, `turned in ${tTurn?.toFixed(2)} s, ${v0.toFixed(1)} → ${vMin.toFixed(1)} m/s`);
  }
  // Stopping from a sprint takes a few strides, not a single frame.
  {
    const { p, drive } = solo('Finisher');
    drive(1, 0, 7.4, true, 1.6);
    const x0 = p.x; let tStop = null;
    drive(0, 0, 0, false, 1.2, t => { if (tStop == null && p.speed < 0.05) tStop = t; });
    check('stop from a sprint: 0.35–0.8 s over 1–2.5 m', tStop > 0.35 && tStop < 0.8 && p.x - x0 > 1 && p.x - x0 < 2.5, `${tStop?.toFixed(2)} s, ${(p.x - x0).toFixed(2)} m`);
  }
  // At a jog the same cut stays sharp.
  {
    const { p, drive } = solo('Trickster');
    drive(1, 0, 5, false, 1.2);
    let tTurn = null;
    drive(0, -1, 5, false, 0.8, t => { if (tTurn == null && Math.abs(Math.cos(p.heading)) < 0.2) tTurn = t; });
    check('jogging 90° cut stays sharp (< 0.35 s)', tTurn != null && tTurn < 0.35, `${tTurn?.toFixed(2)} s`);
  }
  // Acceleration profiles: explosive first step vs lengthy build-up.
  {
    const t5 = arch => { const { p, drive } = solo(arch); let t = null; drive(1, 0, 7.4, true, 2, s => { if (t == null && p.speed >= 5) t = s; }); return t; };
    const fast = t5('Speedster'), slow = t5('Enforcer');
    check('explosive Speedster beats the Enforcer to 5 m/s', fast < slow, `Speedster ${fast?.toFixed(2)} s vs Enforcer ${slow?.toFixed(2)} s`);
  }
  // Knock-on dribbling: at a sprint the ball runs free ahead of the stride.
  {
    const { m, p, drive } = solo('Speedster', true);
    let lead = 0, owned = true, knocks = 0;
    drive(1, 0, 7.4, true, 2, () => { lead = Math.max(lead, m.ball.x - p.x); owned = owned && m.ball.owner === p; if (p.dribble.mode === 'knock') knocks++; });
    check('sprint dribble knocks it 1–3 m ahead and keeps it', owned && knocks > 0 && lead > 1 && lead < 3, `max lead ${lead.toFixed(2)} m, owned ${owned}`);
    // Cut at pace: the ball only changes direction when his foot touches it (no tether
    // dragging it round), and that touch sends it where the stick points.
    let pv = { x: m.ball.vx, z: m.ball.vz }, untouchedTurns = 0, touches = 0;
    drive(0, -1, 7.4, true, 0.45, (t, ev) => {
      const touched = ev.some(e => e.type === 'touch' || e.type === 'firstTouch');
      if (touched) touches++;
      const a = Math.atan2(m.ball.vz, m.ball.vx), b0 = Math.atan2(pv.z, pv.x);
      const d = Math.abs(((a - b0) * 57.3 + 540) % 360 - 180);
      if (!touched && Math.hypot(pv.x, pv.z) > 1 && d > 25) untouchedTurns++;
      pv = { x: m.ball.vx, z: m.ball.vz };
    });
    check('a cut at pace turns the ball only through a touch (no tether)', untouchedTurns === 0 && touches > 0, `${touches} touches, ${untouchedTurns} untouched swings`);
    check('…and that touch takes it the new way', m.ball.owner === p && m.ball.vz < -2, `owned ${m.ball.owner === p}, ball vz ${m.ball.vz.toFixed(1)}`);
  }
  // Close control glues it to the feet.
  {
    const { m, p, drive } = solo('Trickster', true);
    let far = 0;
    p.closeControl = true;
    drive(1, 0, 4, false, 2, () => { p.closeControl = true; far = Math.max(far, Math.hypot(m.ball.x - p.x, m.ball.z - p.z)); });
    check('close control keeps it within 0.8 m', far < 0.8, `max ${far.toFixed(2)} m`);
  }
  return out;
}
