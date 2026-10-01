// Browser checks for the gameplay rules (frame-accurate, real keyboard input): offside with
// the debug overlay (live line, the line frozen at the pass, the call and the free kick),
// a pass near a defender (lane, both read paths, the cut-out point), pass feedback, and the
// new setup / pause options. Screenshots + telemetry → tools/play/out/.
//   node tools/play/gameplay.mjs [offside|lane|menus|all]
import { harness } from './harness.mjs';

const want = process.argv[2] || 'all';

// Our man on the ball at (x, z), a team-mate at (rx, rz), team 1's second-last defender at
// (dx, dz) plus the keeper; everyone else frozen out of the way; debug overlay on.
const setup = (H, o) => H.eval(o => {
  const m = __G.match, p = m.human;
  m.phase = 'play'; m.restart = null;
  const mate = m.players.find(q => q.team === p.team && q !== p && q.line !== 'GK');
  const def = m.players.find(q => q.team === 1 && q.line === 'DEF');
  const gk = m.keeper(1);
  let i = 0;
  for (const q of m.players) {
    if (q === p || q === mate || q === def || q === gk) continue;
    q.frozen = true; q.speed = 0; q.vx = q.vz = 0;
    q.x = -m.oppGoalX(0) * 0.6 - (q.team === p.team ? 4 : 0); q.z = ((i++ % 9) - 4) * 3.5;   // upfield, out of play's way
  }
  for (const [q, x, z, f] of [[p, o.x, o.z, 0], [mate, o.rx, o.rz, Math.PI], [def, o.dx, o.dz, Math.PI], [gk, m.oppGoalX(0) - 1, 0, Math.PI]]) {
    Object.assign(q, { x, z, vx: 0, vz: 0, speed: 0, heading: f, facing: f, action: null, stun: 0, noTouch: 0, frozen: q !== p && !o.live });
  }
  m.loseBall();
  Object.assign(m.ball, { x: p.x + 0.45, z: p.z, y: 0.11, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
  m.gainPossession(p, true); p.possessT = 1;
  __G.mview.ctx.hud.setDebug(true);
  return { human: p.name, mate: mate.name, defender: def.name };
}, o);

const unfreeze = H => H.eval(() => { for (const q of __G.match.players) if (q !== __G.match.human) q.frozen = false; });
const tele = H => H.eval(() => { const t = __telemetry(); return { pass: t.pass, cut: t.cut, offside: t.offside, phase: t.phase, restart: t.restart }; });

const SCENARIOS = {
  // A team-mate a yard beyond the last defender: the live line, then the line frozen at the
  // pass with him flagged, then the flag when he plays it — a free kick to the defenders.
  async offside(H) {
    await H.start({ FORMAT: 3 });
    await H.step(80);
    const who = await setup(H, { x: 2, z: 0, rx: 21, rz: 0.5, dx: 19, dz: 6 });
    await H.step(2);
    await H.shot('offside-1-before');
    const before = await tele(H);
    await H.down('KeyD'); await H.tap('KeyJ', 4); await H.up('KeyD');
    await unfreeze(H);
    await H.step(10);
    await H.shot('offside-2-in-flight');
    const flight = await tele(H);
    let call = null;
    for (let i = 0; i < 40 && !call; i++) { await H.step(4); call = await H.eval(() => __G.match.offside.last); }
    await H.step(3);
    await H.shot('offside-3-called');
    const after = await tele(H);
    for (let i = 0; i < 30; i++) { await H.step(6); if (await H.eval(() => __G.match.restart?.state === 'READY')) break; }
    await H.shot('offside-4-free-kick');
    return { who, before: before.offside, flight: { pass: flight.pass, offside: flight.offside }, call, after: after.restart, restart: await H.eval(() => { const r = __G.match.restart; return r && { type: r.type, team: r.team, taker: r.taker.name, spot: [+r.spot.x.toFixed(1), +r.spot.z.toFixed(1)] }; }) };
  },

  // A pass with a defender near the lane: the lane, the ball's path and the defending
  // side's read of it, the cut-out point and ETAs — and the pass feedback ring.
  async lane(H) {
    await H.start({ FORMAT: 0 });
    await H.step(80);
    const who = await setup(H, { x: -6, z: 0, rx: 6, rz: 0, dx: 1, dz: 2.2, live: true });
    await H.step(2);
    await H.down('KeyD'); await H.tap('KeyJ', 4); await H.up('KeyD');
    await H.step(8);
    await H.shot('lane-1-in-flight');
    const t1 = await tele(H);
    await H.step(14);
    await H.shot('lane-2-outcome');
    const t2 = await tele(H);
    return { who, flight: t1, outcome: { owner: await H.eval(() => __G.match.ball.owner?.name ?? null), cut: t2.cut } };
  },

  // The setup menu has OFFSIDE and PASS ASSIST; the pause menu changes the assist mid-match.
  async menus(H) {
    await H.eval(() => { __G.menu.items.find(i => /PLAY MATCH/.test(i.label)).action(); });
    await H.step(2);
    await H.shot('menus-setup');
    const items = await H.eval(() => __G.menu.items.map(i => i.label + (i.options ? ': ' + (i.options[i.value]?.label ?? i.options[i.value]) : '')));
    return { items };
  },
};

const H = await harness();
const out = {};
for (const [name, fn] of Object.entries(SCENARIOS)) {
  if (want !== 'all' && want !== name) continue;
  if (want === 'all') { await H.page.reload({ waitUntil: 'networkidle0' }); await new Promise(r => setTimeout(r, 1200)); }
  try { out[name] = await fn(H); } catch (e) { out[name] = { error: e.message }; }
}
console.log(JSON.stringify(out, null, 1));
if (H.errors.length) console.log('PAGE ERRORS', H.errors);
await H.close();
