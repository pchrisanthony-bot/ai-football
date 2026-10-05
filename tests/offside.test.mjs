// Offside (Law 11) in the cage, switched on (street rules leave it off). It is judged at
// the moment a team-mate plays the ball and penalised only on involvement. An attacker who
// was offside then and has come back onside is still offside. Level is onside, and so are a
// man behind the ball and a man in his own half. A defender's deliberate play ends it; his
// deflection doesn't. The offence is an indirect free kick to the defenders where he became
// involved. The AI keeps its runners onside.
import { Match, SIM_DT } from './lib/sim.mjs';

// The cage with offside on, in play: team 0 attacks +x. Only these are on the pitch,
// standing still until told otherwise: the passer (on the ball), the receiver, team 1's
// keeper and one defender (the second-last opponent), and optionally a second attacker.
function setup({ passer, receiver, defender, keeper = { x: 15, z: 0 }, other = null, offside = true } = {}) {
  const m = new Match({ humanTeam: null, seconds: 9999, seed: 3, offside });
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
    const S = setup({ passer: { x: 2, z: 0 }, receiver: { x: 7, z: 3 }, defender: { x: 9, z: 1 } });
    const r = play(S);
    check('test 1 · a clear onside pass: no offside, he keeps the ball', r.snap && r.snap.flagged.size === 0 && !r.call && S.m.ball.owner === S.Rc && S.m.passing.ctx.receiverOffside === false,
      `line x ${r.snap?.line.toFixed(1)} (2nd-last defender at 9) · receiver at 7 · ${r.call ? 'CALLED' : 'play on'}`);
  }

  // 2) Clear offside: beyond the second-last defender and the ball when it's played — called
  //    when he plays it, a free kick to the defenders where he was.
  {
    const S = setup({ passer: { x: 2, z: 0 }, receiver: { x: 11, z: 3 }, defender: { x: 9, z: -3 } });   // (out of the lane)
    const r = play(S);
    const at = r.call ? `(${r.call.x.toFixed(1)}, ${r.call.z.toFixed(1)})` : '—';
    check('test 2 · clear offside: the position is recorded at the pass, called on involvement', r.snap && r.snap.receiverOffside && r.snap.flagged.has(S.Rc.id) && r.call && r.call.pid === S.Rc.id,
      `snapshot: receiver offside ${r.snap?.receiverOffside} · called ${!!r.call} (${r.call?.how})`);
    check('…an indirect free kick to the defending side where he became involved', r.restart && r.restart.type === 'FREE_KICK' && r.restart.team === 1 && r.call && Math.abs(r.call.x - S.Rc.x) < 1.5 && S.m.teams[0].stats.offsides === 1,
      `restart ${r.restart?.type} team ${r.restart?.team} at ${at}`);
  }

  // 3) Offside when it was played, back onside by the time he gets it: still offside.
  {
    const S = setup({ passer: { x: 2, z: 0 }, receiver: { x: 11.5, z: 2 }, defender: { x: 9, z: 1 } });
    let back = null;
    const r = play(S, {
      chase: false,
      onKick: ({ m, Rc }) => {   // he drops back onto the ball's line, behind the defender
        const b = m.ball, x = 6, z = b.z + (x - b.x) * (b.vz / b.vx);
        Object.assign(Rc, { x, z }); back = { onside: !m.offside.inPosition(Rc) };
      },
    });
    check('test 3 · offside at the pass, onside when he receives it: still offside', back && back.onside && r.call && r.call.pid === S.Rc.id,
      `back onside at x 6 before receiving: ${back?.onside} · called ${!!r.call}`);
  }

  // 4) The ball is further forward than him (a cut-back): onside, even beyond the defender.
  {
    const S = setup({ passer: { x: 12, z: 2, facing: Math.PI * 0.85 }, receiver: { x: 10, z: -2.5 }, defender: { x: 9, z: 1 } });
    const r = play(S);
    check('test 4 · the ball beyond the attacker (pass back to him): onside', r.snap && !r.snap.receiverOffside && !r.call && S.m.ball.owner === S.Rc,
      `receiver x 10 · 2nd-last defender x 9 · ball x 12 · ${r.call ? 'CALLED' : 'play on'}`);
  }

  // Level with the second-last defender is onside; so is a man in his own half.
  {
    const S = setup({ passer: { x: 2, z: 0 }, receiver: { x: 9.1, z: 3 }, defender: { x: 9, z: 1 } });
    const r = play(S);
    const S2 = setup({ passer: { x: -9, z: 0 }, receiver: { x: -1, z: 2.5 }, defender: { x: -4, z: 1 } });
    const r2 = play(S2);
    check('level (within the tolerance) is onside; so is anyone in his own half', !r.call && !r.snap.receiverOffside && !r2.call && !r2.snap.receiverOffside,
      `10 cm past the line: ${r.call ? 'CALLED' : 'onside'} · own half beyond the defender: ${r2.call ? 'CALLED' : 'onside'}`);
  }

  // A defender's deflection keeps it alive; his deliberate play ends it.
  {
    const S = setup({ passer: { x: 2, z: 0 }, receiver: { x: 11, z: 3 }, defender: { x: 9, z: 1 } });
    const { m, P, Rc, D } = S;
    m.offside.snapshot(P, 'pass');
    m.offside.touch(D, 'deflect');
    const afterDeflect = m.offside.touch(Rc, 'control');
    const S2 = setup({ passer: { x: 2, z: 0 }, receiver: { x: 11, z: 3 }, defender: { x: 9, z: 1 } });
    S2.m.offside.snapshot(S2.P, 'pass');
    S2.m.offside.touch(S2.D, 'control');
    const afterPlay = S2.m.offside.touch(S2.Rc, 'control');
    check("a defender's deflection doesn't reset it (offside); his deliberate play does (play on)", afterDeflect === true && afterPlay === false,
      `after a deflection: ${afterDeflect ? 'offside' : 'play on'} · after a deliberate play: ${afterPlay ? 'offside' : 'play on'}`);
  }

  // Not involved, not offside: the pass goes to an onside team-mate while another is offside.
  {
    const S = setup({ passer: { x: 2, z: 0 }, receiver: { x: 7, z: 3 }, defender: { x: 9, z: 1 }, other: { x: 12, z: -4 } });
    const r = play(S);
    check('an offside team-mate who stays out of it is not penalised', r.snap && r.snap.flagged.has(S.O.id) && !r.call && S.m.ball.owner === S.Rc,
      `${S.O.name} offside at the pass, not involved · ${r.call ? 'CALLED' : 'play on'}`);
  }

  // Challenging an opponent for the ball from an offside position is involvement.
  {
    const S = setup({ passer: { x: 2, z: 0 }, receiver: { x: 11, z: 3 }, defender: { x: 9, z: 1 } });
    const { m, P, Rc, D } = S;
    m.offside.snapshot(P, 'pass');
    m.loseBall();
    Object.assign(m.ball, { x: 10.5, z: 2.5, vx: 0, vz: 0 });
    Object.assign(D, { x: 11.1, z: 2.9 }); Object.assign(Rc, { x: 11.2, z: 2.0, vx: -2, vz: 1, speed: 2.2 });
    m.offside.step();
    check('going for the ball against a defender from an offside position is called', m.offside.last && m.offside.last.pid === Rc.id && /challenged/.test(m.offside.last.how), m.offside.last ? m.offside.last.how : 'no call');
  }

  // Street rules: off by default; a match can switch it on.
  {
    const off = new Match({ humanTeam: null, seed: 1 }), on = new Match({ humanTeam: null, seed: 1, offside: true });
    check('rules.offsideEnabled: off in the cage by default, on when the match asks', !off.offside.enabled && on.offside.enabled, `default ${off.offside.enabled} · switched on ${on.offside.enabled}`);
  }

  // The AI keeps its runners onside and doesn't feed men in offside positions.
  {
    let offs = 0, passes = 0, toOffside = 0;
    for (const seed of [1, 2, 3]) {
      const m = new Match({ humanTeam: null, seconds: 150, seed, offside: true });
      while (m.phase !== 'fulltime') {
        m.step(SIM_DT);
        for (const e of m.drainEvents()) {
          if (e.type === 'goalDone') m.resumeAfterGoal();
          if (e.type === 'offside') offs++;
          if (e.type === 'kick' && e.pass) { passes++; if (m.passing.ctx.receiverOffside) toOffside++; }
        }
      }
    }
    check('AI v AI (offside on): runners hold the line (≤ 1.5 offsides a match, ≤ 4% of passes to an offside man)', offs / 3 <= 1.5 && toOffside / passes <= 0.04, `${(offs / 3).toFixed(1)} offsides a match · ${toOffside}/${passes} passes to a man in an offside position`);
  }
  return out;
}
