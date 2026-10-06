// Support + reception, seen in the game with the debug overlay on (frame-accurate):
//   1. the person holds the ball in midfield: the triangle forms around him
//   2. he passes to the best option: the receiver's arrival ring and reach as it travels
//   3. the touch: the receiving foot
// Shots go to tools/play/out/<label>-*.png; the telemetry rows are printed.
//   node tools/play/support-view.mjs [label]
import { harness } from './harness.mjs';
const label = process.argv[2] || 'sv';
const H = await harness({ w: 1280, h: 720 });
await H.start({});
await H.step(120);
await H.eval(() => { __R.setQuality(2); });
await H.tap('Tab', 2);                       // the AI debug overlay
// the human on the ball in his own half, everyone in their shape
await H.eval(() => {
  const m = __G.match, p = m.human;
  m.phase = 'play'; m.restart = null;
  Object.assign(p, { x: -5, z: 1, speed: 0, vx: 0, vz: 0, facing: 0, heading: 0 });
  m.loseBall(); Object.assign(m.ball, { x: -4.55, z: 1, y: 0.11, vx: 0, vy: 0, vz: 0 }); m.gainPossession(p, true);
});
const tele = () => H.eval(() => (window.__telemetry ? window.__telemetry() : null)).then(t => t && [t.support, t.recv].filter(Boolean).map(x => JSON.stringify(x)).join('\n'));
const shot = async (name) => { await H.eval(() => __R.composer.render()); await H.shot(`${label}-${name}`); };
await H.down('Space');                       // hold it (Street Ball Control)
await H.step(75); await shot('1-triangle'); console.log('triangle:', await tele());
await H.up('Space');
// pass to the best option (the support plan's best triangle)
const dir = await H.eval(() => {
  const m = __G.match, p = m.human, T = m.ai.team[p.team], tri = T.triangles[0];
  const r = tri ? (tri.b.lane >= tri.c.lane ? tri.b.p : tri.c.p) : m.mates(p).find(q => q.line !== 'GK');
  window.__to = r; return { x: r.x - p.x, z: r.z - p.z };
});
const keys = [];
if (dir.x > 1) keys.push('KeyD'); if (dir.x < -1) keys.push('KeyA'); if (dir.z > 1) keys.push('KeyS'); if (dir.z < -1) keys.push('KeyW');
await H.down(...keys); await H.step(2); await H.tap('KeyJ', 3); await H.step(4); await H.up(...keys);
for (let i = 0; i < 40; i++) {
  await H.step(2);
  const st = await H.eval(() => __G.match.reception.plan ? __G.match.reception.plan.state : null);
  if (st === 'ANTICIPATING' && i > 2 && i < 12) { await shot('2-anticipate'); console.log('in flight:', await tele()); i = 12; }
  if (st === 'RECEIVING') { await H.step(6); await shot('3-receive'); console.log('receiving:', await tele()); break; }
}
await H.step(10); await shot('4-touch');
if (H.errors.length) console.log('PAGE ERRORS', H.errors.slice(0, 3));
await H.close();
