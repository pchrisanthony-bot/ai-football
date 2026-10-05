// The referee in the cage, headless. The keeper's protection (no challenge on the ball in
// his hands, opponents clear his area, six seconds) and the kick-off always apply. Fouls
// are street-rules off unless switched on; switched on here: fouls from the geometry of the
// challenge (the man before the ball, from behind), cards by severity (two yellows = off),
// the direct free kick with its wall, the penalty.
import { Match, SIM_DT } from './lib/sim.mjs';
import { PITCH, inKeeperArea } from '../src/sim/pitch.js';
import { fromBehind, rayHit } from '../src/sim/rules/referee.js';

// The cage in play, fouls on; only the named players are on (team 0 attacks +x).
function scene(opts = {}) {
  const m = new Match({ humanTeam: null, seconds: 9999, seed: 7, fouls: true, ...opts });
  m.phase = 'play'; m.restart = null;
  const t0 = m.players.filter(p => p.team === 0 && p.line !== 'GK'), t1 = m.players.filter(p => p.team === 1 && p.line !== 'GK');
  return { m, A: t0, D: t1, GK: m.keeper(1) };
}
const only = (m, keep) => { for (const p of m.players) p.active = keep.includes(p); };
const place = (p, x, z, facing = 0, speed = 0) => Object.assign(p, { x, z, facing, heading: facing, speed, vx: Math.cos(facing) * speed, vz: Math.sin(facing) * speed, action: null, stun: 0, noTouch: 0, frozen: true });
const giveBall = (m, p) => { m.loseBall(); Object.assign(m.ball, { x: p.x + Math.cos(p.facing) * 0.45, z: p.z + Math.sin(p.facing) * 0.45, y: 0.11, vx: 0, vy: 0, vz: 0 }); m.gainPossession(p, true); p.possessT = 1; };
const run = (m, n, until = () => false) => { const ev = []; for (let i = 0; i < n && !until(); i++) { m.step(SIM_DT); ev.push(...m.drainEvents()); } return ev; };

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // 1) The keeper's hands: no tackle, no slide, no trip takes it off him.
  {
    const { m, A, GK } = scene();
    only(m, [A[0], GK]);
    place(GK, 14.5, 0, Math.PI); giveBall(m, GK); m.ball.inHands = true;
    place(A[0], 13.1, 0.2, 0, 6);
    const tackle = m.requestTackle(A[0]), slide = m.requestSlide(A[0]);
    // a slide already on its way when he gathered it can't knock it out of his hands either
    A[0].action = null; m.startAction(A[0], 'slide', {});
    run(m, 40);
    check('the keeper\'s hands: no tackle, no slide, no trip takes the ball off him', !tackle && !slide && m.ball.owner === GK && m.ball.inHands,
      `tackle allowed ${tackle} · slide allowed ${slide} · after a slide into him: ${m.ball.owner === GK ? 'still his' : 'LOST'}`);
  }

  // 2) While he holds it, opponents clear his area (AI); nobody presses him.
  {
    const { m, A, GK } = scene();
    only(m, [A[0], A[1], A[2], GK]);
    place(GK, 14.5, 0, Math.PI); giveBall(m, GK); m.ball.inHands = true;
    GK.frozen = true;                                            // he holds on (we're watching the others)
    place(A[0], 13, 1); place(A[1], 12, -2.5); place(A[2], 12.5, 3);
    for (const q of [A[0], A[1], A[2]]) q.frozen = false;
    run(m, 120 * 2.5);
    const inside = [A[0], A[1], A[2]].filter(q => inKeeperArea(q.x, q.z, m.ownGoalX(1), 0.2));
    check('…opponents retreat out of his area while he holds it', inside.length === 0, `${inside.length} of 3 still inside after 2.5 s (${[A[0], A[1], A[2]].map(q => q.ai.label).join(', ')})`);
  }

  // 3) Six seconds: then an indirect free kick to the other side.
  {
    const { m, A, GK } = scene();
    only(m, [A[0], GK]);
    place(GK, 14, 1, Math.PI); giveBall(m, GK); m.ball.inHands = true; GK.frozen = true;
    place(A[0], 2, 0);
    const ev = run(m, 120 * 7, () => m.phase !== 'play');
    const r = m.restart;
    check('a keeper holding it more than six seconds concedes an indirect free kick', r && r.type === 'FREE_KICK' && r.team === 0 && !r.direct && ev.some(e => e.type === 'foul' && e.kind === 'handling'),
      r ? `${r.type} to team ${r.team} (${r.direct ? 'direct' : 'indirect'})` : 'no call');
  }

  // 4) The geometry: what the sweep meets first, and from behind.
  {
    const a = { x: 0, z: 0, facing: 0 }, behindMe = { x: -1, z: 0 }, inFront = { x: 1, z: 0 };
    const hit = rayHit(0, 0, 1, 0, 0.6, 0, 0.2, 1), miss = rayHit(0, 0, 1, 0, 0.6, 0.5, 0.2, 1);
    check('foul geometry: ray-vs-circle first contact, and the behind test (dot of his forward with the tackler → him)', Math.abs(hit - 0.4) < 1e-9 && miss === Infinity && fromBehind(behindMe, a).behind && !fromBehind(inFront, a).behind,
      `contact at ${hit.toFixed(2)} m · tackler behind: dot ${fromBehind(behindMe, a).dot.toFixed(2)} · in front: ${fromBehind(inFront, a).dot.toFixed(2)}`);
  }

  // 5) A standing tackle: the ball first from the front is clean; through the man (his
  //    back to the tackler, the ball beyond him) is a foul → a direct free kick.
  {
    const { m, A, D } = scene();
    only(m, [A[0], D[0]]);
    place(A[0], 10, 0, Math.PI); giveBall(m, A[0]);                  // carrier facing −x, ball in front of him
    place(D[0], 9.0, 0, 0);                                         // tackler in front, facing him: the ball between
    m.startAction(D[0], 'tackle', {}); const ev1 = run(m, 40);
    const clean = !ev1.some(e => e.type === 'foul');
    const s2 = scene(); only(s2.m, [s2.A[0], s2.D[0]]);
    place(s2.A[0], 10, 0, 0); giveBall(s2.m, s2.A[0]);                // carrier facing +x (away), ball ahead of him
    place(s2.D[0], 9.4, 0, 0);                                       // tackler right behind
    s2.D[0].human = true;                                            // a player's own tackle (an AI would pull out)
    s2.m.startAction(s2.D[0], 'tackle', {}); const ev2 = run(s2.m, 40, () => s2.m.phase !== 'play');
    const s3 = scene(); only(s3.m, [s3.A[0], s3.D[0]]);
    place(s3.A[0], 10, 0, 0); giveBall(s3.m, s3.A[0]); place(s3.D[0], 9.4, 0, 0);
    s3.m.startAction(s3.D[0], 'tackle', {}); const ev3 = run(s3.m, 40);
    const pulled = ev3.some(e => e.type === 'tackle' && e.pulledOut) && !ev3.some(e => e.type === 'foul');
    const f = ev2.find(e => e.type === 'foul'), r = s2.m.restart;
    check('a standing tackle: ball first from the front is clean; through the man from behind is a foul → direct free kick (an AI pulls out of it)', clean && f && r && r.type === 'FREE_KICK' && r.direct && r.team === 0 && s2.m.teams[1].stats.fouls === 1 && pulled,
      `AI pulls out: ${pulled} · front: ${clean ? 'clean' : 'FOUL'} · behind: ${f ? `foul (${s2.m.referee.last.ballFirst ? 'ball' : 'man'} first, behind ${s2.m.referee.last.behind})` : 'no call'} → ${r ? `${r.type} ${r.direct ? 'direct' : 'indirect'} to team ${r.team}` : '—'}`);
  }

  // 6) A slide: winning the ball from the side is clean; clipping the man first is a foul; a
  //    fast slide through the back of him is a card.
  {
    const s1 = scene(); only(s1.m, [s1.A[0], s1.D[0]]);
    place(s1.A[0], 10, 0, 0, 3); giveBall(s1.m, s1.A[0]); s1.A[0].frozen = true;
    place(s1.D[0], s1.m.ball.x, s1.m.ball.z - 1.6, Math.PI / 2, 7);     // from the side, at the ball
    s1.m.startAction(s1.D[0], 'slide', {}); const ev1 = run(s1.m, 80);
    const sideClean = !ev1.some(e => e.type === 'foul') && ev1.some(e => e.type === 'tackle' && e.slide && e.ok);
    const s2 = scene(); only(s2.m, [s2.A[0], s2.D[0]]);
    place(s2.A[0], 10, 0, 0, 5); giveBall(s2.m, s2.A[0]);
    place(s2.D[0], 8.6, 0, 0, 8.5);                                 // straight through the back at speed
    s2.m.startAction(s2.D[0], 'slide', {}); const ev2 = run(s2.m, 80, () => s2.m.phase !== 'play');
    const f = ev2.find(e => e.type === 'foul');
    check('a slide: the ball from the side is clean; through the back at speed is a foul and a card', sideClean && f && f.card,
      `from the side: ${sideClean ? 'clean, ball won' : 'FOUL/miss'} · from behind at 8.5 m/s: ${f ? `foul, ${f.card || 'no card'} (severity ${s2.m.referee.last.severity})` : 'no call'}`);
  }

  // 7) Two yellows: off.
  {
    const { m, A, D } = scene();
    only(m, [A[0], D[0]]);
    const fouler = D[0];
    const c1 = m.referee.callFoul(fouler, A[0], 0, 0, { behind: true, slide: true, ballFirst: false });
    m.restart = null; m.phase = 'play';
    fouler.active = true;
    const c2 = m.referee.callFoul(fouler, A[0], 5, 0, { behind: true, slide: true, ballFirst: false });
    check('a second yellow is a red: he is sent off', c1 === 'yellow' && c2 === 'second yellow' && !fouler.active && fouler.sentOff && m.teams[1].stats.reds === 1,
      `first ${c1} · second ${c2} · on the pitch: ${fouler.active}`);
  }

  // 8) A foul in the area: a penalty — only the taker and the keeper in the area, the
  //    keeper on his line; the taker scores or the keeper saves it.
  {
    const { m, A, D, GK } = scene();
    only(m, [...A.slice(0, 4), ...D.slice(0, 4), GK, m.keeper(0)]);
    for (const q of m.players) q.frozen = false;
    m.referee.callFoul(D[0], A[0], 13.5, 1, { behind: false, slide: false, ballFirst: false });
    run(m, 120 * 4, () => m.restart?.state === 'READY');
    const r = m.restart, gx = m.oppGoalX(0);
    const inArea = m.players.filter(q => q.active && q !== r.taker && q.line !== 'GK' && inKeeperArea(q.x, q.z, gx, 0));
    const gkOnLine = Math.abs(GK.x - gx) < 0.6;
    const spotOk = Math.abs(m.ball.x - (gx - PITCH.penaltySpot)) < 0.05 && Math.abs(m.ball.z) < 0.05;
    const ev = run(m, 120 * 5, () => m.phase !== 'restart' && (m.ball.owner === GK || m.phase === 'goal' || Math.abs(m.ball.x) > gx + 0.5));
    const shot = ev.find(e => e.type === 'kick' && e.kind === 'shot');
    check('a foul in the area is a penalty: ball on the spot, only the taker and the keeper in the area, the keeper on his line, then a shot', r && r.type === 'PENALTY' && r.team === 0 && spotOk && inArea.length === 0 && gkOnLine && shot,
      `${r?.type} · spot ${spotOk} · others in the area ${inArea.length} · keeper on his line ${gkOnLine} · taken: ${shot ? `shot ${shot.speed.toFixed(1)} m/s` : 'no'} → ${m.phase === 'goal' ? 'GOAL' : 'no goal'}`);
  }

  // 9) A direct free kick in shooting range: a wall on the ball–goal line at the laws' distance.
  {
    const { m, A, D, GK } = scene();
    only(m, [...A.slice(0, 4), ...D.slice(0, 4), GK]);
    for (const q of m.players) q.frozen = false;
    m.referee.callFoul(D[0], A[0], 7, 3, { behind: false, slide: false, ballFirst: false });
    run(m, 120 * 4, () => m.restart?.state === 'READY');
    const r = m.restart, b = m.ball, gx = m.oppGoalX(0);
    const ux = (gx - b.x), uz = -b.z, ul = Math.hypot(ux, uz);
    const wall = D.filter(q => q.active).filter(q => {
      const along = ((q.x - b.x) * ux + (q.z - b.z) * uz) / ul, lat = Math.abs((-(q.x - b.x) * uz + (q.z - b.z) * ux) / ul);
      return Math.abs(along - PITCH.centreR) < 0.6 && lat < 1.8;
    });
    const tooClose = m.players.filter(q => q.active && q.team === 1 && Math.hypot(q.x - b.x, q.z - b.z) < PITCH.centreR - 0.05);
    check('a direct free kick in range: a wall on the ball–goal line, the laws\' distance away', r && r.type === 'FREE_KICK' && r.direct && wall.length >= 2 && tooClose.length === 0,
      `${wall.length} men in the wall at ${PITCH.centreR} m · defenders closer than that: ${tooClose.length}`);
  }

  // 10) The kick-off: until the taker has played it, everyone in his own half.
  {
    const m = new Match({ humanTeam: null, seconds: 9999, seed: 3 });
    run(m, 120 * 1.2, () => m.phase === 'play');
    m.step(SIM_DT);
    const taker = m.ball.owner;
    const opp = m.players.find(q => q.team !== taker.team && q.line === 'ATT');
    opp.x = 3 * m.teams[opp.team].dir; opp.z = 1;                            // tries to sneak over halfway, into the circle
    taker.frozen = true;                                                     // the taker hasn't played it yet
    m.step(SIM_DT);
    const held = opp.x * m.teams[opp.team].dir <= 0 && Math.hypot(opp.x, opp.z) >= PITCH.centreR - 0.01 && m.referee.kickoffLive;
    taker.frozen = false;
    check('the kick-off: everyone stays in his own half (and out of the circle) until it is played', held, `opponent pushed back to x ${opp.x.toFixed(2)}, ${Math.hypot(opp.x, opp.z).toFixed(2)} m from the spot`);
  }

  // 11) Street rules: no fouls in the cage unless a match switches them on.
  {
    const off = new Match({ humanTeam: null, seed: 1 }), on = new Match({ humanTeam: null, seed: 1, fouls: true });
    check('rules.foulsEnabled: off in the cage by default, on when the match asks', !off.referee.fouls && on.referee.fouls, `default ${off.referee.fouls} · switched on ${on.referee.fouls}`);
  }

  // 12) AI v AI: a realistic number of fouls, few cards, every set piece taken.
  {
    let fouls = 0, reds = 0, longest = 0, n = 0;
    for (const seed of [1, 2, 3]) {
      const m = new Match({ humanTeam: null, seconds: 180, seed, fouls: true });
      let rT = 0;
      while (m.phase !== 'fulltime') {
        m.step(SIM_DT);
        for (const e of m.drainEvents()) { if (e.type === 'goalDone') m.resumeAfterGoal(); if (e.type === 'foul') { fouls++; if (e.card && e.card !== 'yellow') reds++; } }
        if (m.phase === 'restart' && m.restart.type !== 'KICKOFF') { rT += SIM_DT; longest = Math.max(longest, rT); } else rT = 0;
      }
      n++;
    }
    check('AI v AI (fouls on): a handful of fouls, rare reds, every free kick taken', fouls / n <= 6 && reds <= 1 && longest < 6, `${(fouls / n).toFixed(1)} fouls / 3 min · ${reds} reds in ${n} matches · longest stoppage ${longest.toFixed(1)} s`);
  }
  return out;
}
