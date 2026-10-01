// Offside (Law 11), headless. It is judged at the moment a team-mate plays the ball and
// penalised only on involvement. An attacker who was offside then and has come back onside
// is still offside. Level is onside, and so are a man behind the ball and a man in his own
// half. There's no offside from a throw-in. A defender's deliberate play ends it; his
// deflection doesn't. The offence is an indirect free kick to the defenders where he
// became involved. The cage plays without it, and the AI keeps its runners onside.
import { Match, SIM_DT } from './lib/sim.mjs';

// 11v11, in play: team 0 attacks +x. Only these are on the pitch, standing still until
// told otherwise: the passer (on the ball), the receiver, team 1's keeper and one
// defender (the second-last opponent), and optionally a second attacker.
function setup({ passer, receiver, defender, keeper = { x: 50, z: 0 }, other = null, format = '11v11', offside } = {}) {
  const m = new Match({ format, humanTeam: null, seconds: 9999, seed: 3, ...(offside != null ? { offside } : {}) });
  m.phase = 'play'; m.restart = null;
  const t0 = m.players.filter(p => p.team === 0 && p.line !== 'GK');
  const P = t0[0], Rc = t0[1], O = t0[2];
  const D = m.players.find(p => p.team === 1 && p.line !== 'GK'), GK = m.keeper(1);
  const on = [P, Rc, D, GK, other ? O : null];
  for (const p of m.players) p.active = on.includes(p);
  const place = (p, s) => Object.assign(p, { x: s.x, z: s.z, vx: 0, vz: 0, speed: 0, frozen: true, facing: s.facing ?? Math.PI, heading: s.facing ?? Math.PI, action: null, noTouch: 0, stun: 0 });
  place(P, { ...passer, facing: passer.facing ?? 0 }); place(Rc, receiver); place(D, defender); place(GK, keeper); if (other) place(O, other);
  P.attrs.pass = 1;   // a clean pass: these tests are about the law, not the strike
  m.loseBall();
  const fx = Math.cos(P.facing), fz = Math.sin(P.facing);
  Object.assign(m.ball, { x: P.x + fx * 0.45, z: P.z + fz * 0.45, y: 0.11, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
  m.gainPossession(P, true); P.possessT = 1;
  return { m, P, Rc, D, GK, O };
}

// The passer plays it to the receiver (who goes and gets it); run until he has it, a
// whistle, or `secs`. onKick(S) runs the moment the ball is struck.
function play(S, { kind = 'pass', secs = 3, onKick = null, chase = true } = {}) {
  const { m, P, Rc } = S;
  if (chase) Rc.frozen = false;
  m.requestKick(P, kind, { receiver: Rc });
  const ev = [];
  let snap = null;
  for (let i = 0; i < secs * 120; i++) {
    m.step(SIM_DT);
    for (const e of m.drainEvents()) {
      ev.push(e);
      if (e.type === 'kick' && e.pid === P.id) { snap = m.offside.snap; if (onKick) onKick(S); }
    }
    if (m.ball.owner === Rc || m.phase !== 'play') break;
  }
  return { ev, snap, call: ev.find(e => e.type === 'offside'), restart: m.restart };
}

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 1) Clear onside: the receiver is behind the second-last defender when it's played.
  {
    const S = setup({ passer: { x: 5, z: 0 }, receiver: { x: 15, z: 6 }, defender: { x: 20, z: 2 } });
    const r = play(S);
    check('test 1 · a clear onside pass: no offside, he keeps the ball', r.snap && r.snap.flagged.size === 0 && !r.call && S.m.ball.owner === S.Rc && S.m.passing.ctx.receiverOffside === false,
      `line x ${r.snap?.line.toFixed(1)} (2nd-last defender at 20) · receiver at 15 · ${r.call ? 'CALLED' : 'play on'}`);
  }

  // 2) Clear offside: beyond the second-last defender and the ball when it's played — called
  //    when he plays it, a free kick to the defenders where he was.
  {
    const S = setup({ passer: { x: 5, z: 0 }, receiver: { x: 25, z: 6 }, defender: { x: 20, z: 2 } });
    const r = play(S);
    const at = r.call ? `(${r.call.x.toFixed(1)}, ${r.call.z.toFixed(1)})` : '—';
    check('test 2 · clear offside: the position is recorded at the pass, called on involvement', r.snap && r.snap.receiverOffside && r.snap.flagged.has(S.Rc.id) && r.call && r.call.pid === S.Rc.id,
      `snapshot: receiver offside ${r.snap?.receiverOffside} · called ${!!r.call} (${r.call?.how})`);
    check('…an indirect free kick to the defending side where he became involved', r.restart && r.restart.type === 'FREE_KICK' && r.restart.team === 1 && r.call && Math.abs(r.call.x - S.Rc.x) < 1.5 && S.m.teams[0].stats.offsides === 1,
      `restart ${r.restart?.type} team ${r.restart?.team} at ${at}`);
  }

  // 3) Offside when it was played, back onside by the time he gets it: still offside.
  {
    const S = setup({ passer: { x: 5, z: 0 }, receiver: { x: 25, z: 4 }, defender: { x: 20, z: 2 } });
    let back = null;
    const r = play(S, {
      chase: false,
      onKick: ({ m, Rc }) => {   // he drops back onto the ball's line, behind the defender
        const b = m.ball, x = 14, z = b.z + (x - b.x) * (b.vz / b.vx);
        Object.assign(Rc, { x, z }); back = { onside: !m.offside.inPosition(Rc) };
      },
    });
    check('test 3 · offside at the pass, onside when he receives it: still offside', back && back.onside && r.call && r.call.pid === S.Rc.id,
      `back onside at x 14 before receiving: ${back?.onside} · called ${!!r.call}`);
  }

  // 4) The ball is further forward than him (a cut-back): onside, even beyond the defender.
  {
    const S = setup({ passer: { x: 30, z: 4, facing: Math.PI * 0.85 }, receiver: { x: 24, z: -3 }, defender: { x: 20, z: 2 } });
    const r = play(S);
    check('test 4 · the ball beyond the attacker (pass back to him): onside', r.snap && !r.snap.receiverOffside && !r.call && S.m.ball.owner === S.Rc,
      `receiver x 24 · 2nd-last defender x 20 · ball x 30 · ${r.call ? 'CALLED' : 'play on'}`);
  }

  // Level with the second-last defender is onside; so is a man in his own half.
  {
    const S = setup({ passer: { x: 5, z: 0 }, receiver: { x: 20.1, z: 6 }, defender: { x: 20, z: 2 } });
    const r = play(S);
    const S2 = setup({ passer: { x: -15, z: 0 }, receiver: { x: -2, z: 5 }, defender: { x: -8, z: 2 } });
    const r2 = play(S2);
    check('level (within the tolerance) is onside; so is anyone in his own half', !r.call && !r.snap.receiverOffside && !r2.call && !r2.snap.receiverOffside,
      `10 cm past the line: ${r.call ? 'CALLED' : 'onside'} · own half beyond the defender: ${r2.call ? 'CALLED' : 'onside'}`);
  }

  // No offside straight from a throw-in.
  {
    const S = setup({ passer: { x: 5, z: 0 }, receiver: { x: 25, z: 6 }, defender: { x: 20, z: 2 } });
    const { m, Rc } = S;
    m.beginRestart('THROW_IN', 0, { x: 10, z: -33.5 });
    for (let i = 0; i < 600 && m.restart?.state !== 'READY'; i++) m.step(SIM_DT);
    const taker = m.restart.taker;
    for (const p of m.players) if (p !== taker) p.frozen = true;
    Object.assign(Rc, { x: 26, z: -25, active: true });
    const flagged = m.offside.inPosition(Rc);
    m.takeRestart(taker, 'throwin', { receiver: Rc });
    Rc.frozen = false;
    const ev = [];
    for (let i = 0; i < 480 && !(m.ball.owner === Rc) && m.phase === 'play'; i++) { m.step(SIM_DT); ev.push(...m.drainEvents()); }
    check('no offside straight from a throw-in', flagged && m.ball.owner === Rc && !ev.some(e => e.type === 'offside'),
      `beyond the defender at the throw: ${flagged} · he has it, no call`);
  }

  // A defender's deflection keeps it alive; his deliberate play ends it.
  {
    const S = setup({ passer: { x: 5, z: 0 }, receiver: { x: 25, z: 6 }, defender: { x: 20, z: 2 } });
    const { m, P, Rc, D } = S;
    m.offside.snapshot(P, 'pass');
    m.offside.touch(D, 'deflect');
    const afterDeflect = m.offside.touch(Rc, 'control');
    const S2 = setup({ passer: { x: 5, z: 0 }, receiver: { x: 25, z: 6 }, defender: { x: 20, z: 2 } });
    S2.m.offside.snapshot(S2.P, 'pass');
    S2.m.offside.touch(S2.D, 'control');
    const afterPlay = S2.m.offside.touch(S2.Rc, 'control');
    check("a defender's deflection doesn't reset it (offside); his deliberate play does (play on)", afterDeflect === true && afterPlay === false,
      `after a deflection: ${afterDeflect ? 'offside' : 'play on'} · after a deliberate play: ${afterPlay ? 'offside' : 'play on'}`);
  }

  // Not involved, not offside: the pass goes to an onside team-mate while another is offside.
  {
    const S = setup({ passer: { x: 5, z: 0 }, receiver: { x: 15, z: 6 }, defender: { x: 20, z: 2 }, other: { x: 30, z: -6 } });
    const r = play(S);
    check('an offside team-mate who stays out of it is not penalised', r.snap && r.snap.flagged.has(S.O.id) && !r.call && S.m.ball.owner === S.Rc,
      `${S.O.name} offside at the pass, not involved · ${r.call ? 'CALLED' : 'play on'}`);
  }

  // Challenging an opponent for the ball from an offside position is involvement.
  {
    const S = setup({ passer: { x: 5, z: 0 }, receiver: { x: 25, z: 6 }, defender: { x: 20, z: 2 } });
    const { m, P, Rc, D } = S;
    m.offside.snapshot(P, 'pass');
    m.loseBall();
    Object.assign(m.ball, { x: 22, z: 4, vx: 0, vz: 0 });
    Object.assign(D, { x: 22.6, z: 4.4 }); Object.assign(Rc, { x: 22.7, z: 3.5, vx: -2, vz: 1, speed: 2.2 });
    m.offside.step();
    check('going for the ball against a defender from an offside position is called', m.offside.last && m.offside.last.pid === Rc.id && /challenged/.test(m.offside.last.how), m.offside.last ? m.offside.last.how : 'no call');
  }

  // The cage plays without offside; open pitches with it; a match can override either.
  {
    const cage = new Match({ format: '5v5', humanTeam: null, seed: 1 }), open = new Match({ format: '7v7', humanTeam: null, seed: 1 }), off = new Match({ format: '11v11', humanTeam: null, seed: 1, offside: false });
    check('rules.offsideEnabled: off in the cage, on in open formats, overridable per match', !cage.offside.enabled && open.offside.enabled && !off.offside.enabled, `5v5 ${cage.offside.enabled} · 7v7 ${open.offside.enabled} · 11v11 (off) ${off.offside.enabled}`);
  }

  // The AI keeps its runners onside and doesn't feed men in offside positions.
  {
    let offs = 0, passes = 0, toOffside = 0;
    for (const seed of [1, 2, 3]) {
      const m = new Match({ format: '11v11', humanTeam: null, seconds: 150, seed });
      while (m.phase !== 'fulltime') {
        m.step(SIM_DT);
        for (const e of m.drainEvents()) {
          if (e.type === 'goalDone') m.resumeAfterGoal();
          if (e.type === 'offside') offs++;
          if (e.type === 'kick' && e.pass) { passes++; if (m.passing.ctx.receiverOffside) toOffside++; }
        }
      }
    }
    check('AI v AI: runners hold the line (≤ 1 offside a match, ≤ 3% of passes to an offside man)', offs / 3 <= 1 && toOffside / passes <= 0.03, `${(offs / 3).toFixed(1)} offsides a match · ${toOffside}/${passes} passes to a man in an offside position`);
  }
  return out;
}
