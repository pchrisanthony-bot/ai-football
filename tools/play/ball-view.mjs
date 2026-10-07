// The ball, close up and from the match camera (frame-accurate).  node tools/play/ball-view.mjs [label]
import { harness } from './harness.mjs';
const label = process.argv[2] || 'ball';
const H = await harness({ w: 960, h: 540 });
await H.start({});
await H.step(120);
await H.eval(() => { __R.setQuality(2); document.querySelector('#ui').style.display = 'none'; });
await H.eval(() => {
  const m = __G.match; m.phase = 'play'; m.restart = null;
  m.players.forEach((q, i) => { q.frozen = true; q.x = (q.team ? 1 : -1) * (4 + i); q.z = -6; });
  m.loseBall(); Object.assign(m.ball, { x: 0, y: 0.11, z: 2, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
});
await H.step(10);
await H.eval(() => { const c = __R.camera; c.fov = 20; c.position.set(0.9, 0.55, 3.1); c.lookAt(0, 0.12, 2); c.updateProjectionMatrix(); __R.composer.render(); });
await H.shot(`${label}-close`);
await H.step(2);   // the match camera
await H.eval(() => __R.composer.render());
await H.shot(`${label}-match`);
await H.close();
