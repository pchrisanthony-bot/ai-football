// A reception, close up (frame-accurate): the person passes to a team-mate standing 10 m
// away; the camera is beside the receiver; a frame every 3 ticks from 0.4 s before the
// ball arrives to 0.3 s after — the receiving foot should meet the ball, then cushion it.
//   node tools/play/receive-film.mjs [label]
import { harness } from './harness.mjs';
const label = process.argv[2] || 'rf';
const H = await harness({ w: 960, h: 540 });
await H.start({});
await H.step(90);
await H.eval(() => { __R.setQuality(3); document.querySelector('#ui').style.display = 'none'; });
await H.eval(() => {
  const m = __G.match, p = m.human;
  m.phase = 'play'; m.restart = null;
  const mate = m.mates(p).find(q => q.line !== 'GK');
  m.players.forEach((q, i) => { if (q !== p && q !== mate) { q.frozen = true; q.x = (q.team ? 1 : -1) * 14; q.z = -7 + i * 0.6; } });
  Object.assign(p, { x: -6, z: 0, speed: 0, vx: 0, vz: 0, facing: 0, heading: 0 });
  Object.assign(mate, { x: 4, z: 0, speed: 0, vx: 0, vz: 0, facing: Math.PI, heading: Math.PI });
  mate.frozen = false;
  m.loseBall(); Object.assign(m.ball, { x: -5.55, z: 0, y: 0.11, vx: 0, vy: 0, vz: 0 }); m.gainPossession(p, true); p.possessT = 1;
  window.__mate = mate;
});
await H.down('KeyD'); await H.tap('KeyJ', 4); await H.up('KeyD');
const cam = () => H.eval(() => { const q = window.__mate, c = __R.camera; c.fov = 30; c.position.set(q.x - 0.4, 0.9, q.z + 3.2); c.lookAt(q.x - 0.4, 0.5, q.z); c.updateProjectionMatrix(); __R.composer.render(); });
let shots = 0;
for (let i = 0; i < 200 && shots < 10; i++) {
  await H.step(1);
  const s = await H.eval(() => { const P = window.__mate.recv, m = __G.match; return P && P.point ? { st: P.state, left: P.point.tb - m.time, foot: P.foot } : { st: m.ball.owner === window.__mate ? 'HAS IT' : '-' }; });
  if ((s.left != null && s.left < 0.42) || s.st === 'FIRST_TOUCH' || s.st === 'IN_POSSESSION' || s.st === 'HAS IT') {
    if (i % 3) continue;
    await cam(); await H.shot(`${label}-${String(shots).padStart(2, '0')}`); shots++;
    console.log(shots, s.st, s.left != null ? `ball in ${s.left.toFixed(2)} s` : '', s.foot || '');
  }
}
await H.close();
