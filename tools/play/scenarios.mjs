// Browser gameplay scenarios with real keyboard input, frame-accurate (nothing moves
// while a screenshot is taken). Screenshots + telemetry go to tools/play/out/.
//   node tools/play/scenarios.mjs <name|all> [--format=N]
import { harness } from './harness.mjs';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const want = process.argv[2] || 'all';
const format = arg('format', null);

// Put the human somewhere clean, others frozen out of the way; optionally with the ball.
const isolate = (H, o = {}) => H.eval((o) => {
  const m = __G.match, p = m.human;
  m.phase = 'play';
  // Out of the way: team-mates lined up near our goal, opponents near theirs.
  const others = m.players.filter(q => q !== p && q.line !== 'GK');
  others.forEach((q, i) => { q.frozen = true; q.speed = 0; q.x = (q.team === p.team ? -1 : 1) * (m.oppGoalX(0) - 3); q.z = ((i % 5) - 2) * 3.2; });
  for (const q of m.players) if (q !== p) { q.frozen = true; q.speed = 0; }
  Object.assign(p, { x: o.x ?? -8, z: o.z ?? 0, speed: 0, vx: 0, vz: 0, heading: 0, facing: 0, stamina: 1, action: null });
  m.loseBall();
  const b = m.ball;
  Object.assign(b, { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, y: 0.11 });
  if (o.ball) { b.x = p.x + 0.45; b.z = p.z; m.gainPossession(p, true); } else { b.x = 12; b.z = 7; }
}, o);
const tel = H => H.eval(() => { const t = __telemetry(); return { speed: t.player.speed, mode: t.player.mode, gap: t.gap, ball: t.ball.speed, owner: t.ball.owner, ft: t.firstTouch }; });

// Send the loose ball over a line off a given side, then step until the restart is ready.
const outOff = async (H, { x, z, vx = 0, vz = 0, team }) => {
  await H.eval(({ x, z, vx, vz, team }) => {
    const m = __G.match, P = m.ball;
    m.phase = 'play'; m.restart = null; m.loseBall();
    Object.assign(P, { x, z, y: 0.11, vx, vy: 0, vz, wx: 0, wy: 0, wz: 0, out: false, net: 0, goal: 0 });
    P.lastTouch = m.players.find(q => q.team === team && q.line !== 'GK');
    for (const q of m.players) if (Math.hypot(q.x - x, q.z - z) < 8) q.x -= Math.sign(x || 1) * 10;
  }, { x, z, vx, vz, team });
  for (let i = 0; i < 40; i++) { await H.step(6); if (await H.eval(() => __G.match.restart?.state === 'READY')) break; }
  return H.eval(() => { const m = __G.match, r = m.restart; return r ? { type: r.type, team: r.team, taker: r.taker.name, human: m.human?.name, spot: [+r.spot.x.toFixed(1), +r.spot.z.toFixed(1)] } : { phase: m.phase }; });
};
const pitch = H => H.eval(() => { const m = __G.match; return { L: m.oppGoalX(0), W: m.ball && window.__telemetry().pitch.width / 2 }; });

const SCENARIOS = {
  // Open pitch: a throw-in to us — the human throws it to the man the stick points at.
  async 'throw-in'(H) {
    const { L, W } = await pitch(H);
    const set = await outOff(H, { x: L * 0.2, z: W - 1, vz: 6, team: 1 });
    await H.shot('throw-in-ready');
    const aim = await H.eval(() => { const m = __G.match, p = m.human; const q = m.players.filter(o => o.team === p.team && o !== p && o.line !== 'GK').sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0]; return { to: q.name, dx: q.x - p.x, dz: q.z - p.z }; });
    // stick toward him (screen: right = +x, up = −z), PASS tapped
    const keys = []; if (aim.dx > 2) keys.push('KeyD'); if (aim.dx < -2) keys.push('KeyA'); if (aim.dz < -2) keys.push('KeyW'); if (aim.dz > 2) keys.push('KeyS');
    await H.down(...keys); await H.tap('KeyJ', 5); await H.up(...keys);
    await H.step(20); await H.shot('throw-in-thrown');
    await H.step(40);
    const after = await H.eval(() => { const m = __G.match, b = m.ball; return { phase: m.phase, lastKick: b.lastKick?.kind, owner: b.owner?.name, lastTouch: b.lastTouch?.name }; });
    return { set, aim, after };
  },
  // Open pitch: our corner — the human crosses it (LOB) into the box.
  async corner(H) {
    const { L, W } = await pitch(H);
    const set = await outOff(H, { x: L - 2, z: 12, vx: 7, team: 1 });
    await H.shot('corner-ready');
    const box = await H.eval(() => { const m = __G.match, gx = m.oppGoalX(0); return m.players.filter(p => p.team === 0 && Math.abs(p.x - gx) < 17).map(p => p.name); });
    await H.down('KeyA', 'KeyS'); await H.tap('KeyI', 14); await H.up('KeyA', 'KeyS');
    await H.film('corner-cross', 60, 3);
    const after = await H.eval(() => { const m = __G.match, b = m.ball; return { phase: m.phase, lastKick: b.lastKick?.kind, owner: b.owner?.name, lastTouch: b.lastTouch?.name, ballY: +b.y.toFixed(2) }; });
    return { set, inTheBox: box, after };
  },
  // Open pitch: a goal kick to them — their keeper takes it, we stay out of the area.
  async 'goal-kick'(H) {
    const { L } = await pitch(H);
    const set = await outOff(H, { x: L - 2, z: -6, vx: 8, team: 0 });
    await H.shot('goal-kick-ready');
    const inArea = await H.eval(() => { const m = __G.match, gx = m.oppGoalX(0), box = __telemetry().pitch.box; return m.players.filter(p => p.team === 0 && Math.abs(p.x - gx) < box.depth && Math.abs(p.z) < box.width / 2).length; });
    await H.step(150);
    await H.shot('goal-kick-taken');
    const after = await H.eval(() => { const m = __G.match, b = m.ball; return { phase: m.phase, lastKick: b.lastKick?.kind, lastTouch: b.lastTouch?.name }; });
    return { set, opponentsInArea: inArea, after };
  },
  // P2: notices sit in the top band, not over play — a real parry, then KICK OFF + GAMEBREAKER
  async notices(H) {
    await H.step(30);
    await H.eval(() => {
      const m = __G.match, gk = m.keeper(1), p = m.human;
      m.loseBall();
      const dir = -m.teams[gk.team].dir;   // toward the keeper's goal
      Object.assign(m.ball, { x: gk.x - dir * 4, y: 0.6, z: gk.z, vx: dir * 22, vy: 0.4, vz: 0, wx: 0, wy: 0, wz: 0, owner: null });
      m.ball.lastKick = { pid: p.id, team: p.team, kind: 'shot', t: m.time }; m.ball.lastTouch = p;
    });
    await H.step(14);
    const afterSave = await H.eval(() => [...document.querySelectorAll('.notice b')].map(n => n.textContent));
    await H.shot('notices-parry');
    await H.eval(() => { __G.match.teams[0].gbReady = true; __G.match.activateGB(0); });
    await H.step(6);
    await H.shot('notices-gamebreaker');
    const stack = await H.eval(() => [...document.querySelectorAll('.notice')].map(n => ({ text: n.textContent, top: Math.round(n.getBoundingClientRect().top), bottom: Math.round(n.getBoundingClientRect().bottom), vh: innerHeight })));
    return { afterSave, stack };
  },
  // P1: release the stick while sprinting with the ball
  async 'stop-with-ball'(H) {
    await isolate(H, { ball: true, x: -12 });
    await H.hold(['KeyD', 'ShiftLeft'], 70);
    const before = await tel(H);
    const rows = [];
    for (let f = 0; f < 42; f += 6) { await H.step(6); rows.push(await tel(H)); if (f === 12 || f === 36) await H.shot(`stop-with-ball-${f}`); }
    return { before, after: rows.map(r => `${r.speed} m/s gap ${r.gap} ${r.mode} owner ${r.owner}`) };
  },
  // P1: a 10 m/s pass into a standing receiver — neutral, cushioned (Space), directed (W)
  async 'first-touch'(H) {
    const res = {};
    for (const [label, keys] of [['neutral', []], ['cushion', ['Space']], ['directed', ['KeyW']]]) {
      await isolate(H, { x: -4, z: 0 });
      await H.eval(() => {
        const m = __G.match, p = m.human, b = m.ball;
        const mate = m.players.find(q => q.team === p.team && q !== p && q.line !== 'GK');
        const v = 10 + (1.2 + 3.5) * 0.36;
        Object.assign(b, { x: p.x + 3.6, z: p.z, vx: -v, vz: 0, vy: 0, wx: 0, wz: v / 0.11, owner: null });
        b.passTo = p; b.passUntil = m.time + 3; b.lastKick = { pid: mate.id, team: p.team, kind: 'pass', t: m.time };
      });
      await H.step(12);
      if (keys.length) await H.down(...keys);
      await H.step(14);
      const t = await tel(H);
      await H.shot(`first-touch-${label}`);
      await H.step(18);
      const t2 = await tel(H);
      if (keys.length) await H.up(...keys);
      res[label] = { firstTouch: t.ft, gapAfter0_3s: t2.gap, owner: t2.owner };
    }
    return res;
  },
};

const H = await harness({ w: +arg('w', 1280), h: +arg('h', 720), touch: arg('touch', '0') === '1' });
await H.start(format != null ? { FORMAT: +format } : {});
await H.step(90);
const names = want === 'all' ? Object.keys(SCENARIOS) : [want];
for (const n of names) {
  const r = await SCENARIOS[n](H);
  console.log(`\n=== ${n}\n` + JSON.stringify(r, null, 1));
}
if (H.errors.length) console.log('PAGE ERRORS', H.errors);
await H.close();
