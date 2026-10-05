// Browser gameplay scenarios with real keyboard input, frame-accurate (nothing moves
// while a screenshot is taken). Screenshots + telemetry go to tools/play/out/.
//   node tools/play/scenarios.mjs <name|all>
import { harness } from './harness.mjs';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const want = process.argv[2] || 'all';

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

// Where the human and the ball are on screen (0..1; outside = off-screen).
const onScreen = H => H.eval(() => {
  const m = __G.match, cam = __R.camera, V = new cam.position.constructor();
  const at = (x, y, z) => { V.set(x, y, z).project(cam); return [+((V.x + 1) / 2).toFixed(2), +((1 - V.y) / 2).toFixed(2)]; };
  return { human: m.human ? at(m.human.x, 1, m.human.z) : null, ball: at(m.ball.x, m.ball.y, m.ball.z) };
});

const SCENARIOS = {
  // A human on a big pitch: sprint-dribble upfield, pass, then defend — the camera must
  // keep the man and the ball in frame throughout.
  async 'human-run'(H) {
    await H.step(70);                                    // kick-off whistle
    const frames = [];
    const log = async tag => frames.push({ tag, ...(await onScreen(H)), t: await H.eval(() => { const t = __telemetry(); return { human: t.player?.name, owner: t.ball.owner, speed: t.player?.speed, cam: t.camera.dist }; }) });
    await log('start');
    await H.down('KeyD', 'ShiftLeft');
    for (let i = 0; i < 4; i++) { await H.step(25); await log(`sprint ${i}`); }
    await H.shot('human-run-sprint');
    await H.up('ShiftLeft');
    await H.tap('KeyJ', 6);
    await H.up('KeyD');
    for (let i = 0; i < 4; i++) { await H.step(30); await log(`after pass ${i}`); }
    await H.shot('human-run-pass');
    for (let i = 0; i < 6; i++) { await H.step(60); await log(`play ${i}`); }
    await H.shot('human-run-later');
    const off = frames.filter(f => f.human && (f.human[0] < 0 || f.human[0] > 1 || f.human[1] < 0 || f.human[1] > 1)).length;
    return { offScreenFrames: off, frames: frames.map(f => `${f.tag}: human ${f.t.human} @${f.human} ball @${f.ball} owner ${f.t.owner} ${f.t.speed} m/s cam ${f.t.cam}`) };
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
await H.start({});
await H.step(90);
const names = want === 'all' ? Object.keys(SCENARIOS) : [want];
for (const n of names) {
  const r = await SCENARIOS[n](H);
  console.log(`\n=== ${n}\n` + JSON.stringify(r, null, 1));
}
if (H.errors.length) console.log('PAGE ERRORS', H.errors);
await H.close();
