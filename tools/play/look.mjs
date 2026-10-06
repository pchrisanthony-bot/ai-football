// Look IK check (the movement brief's test I), frame-accurate: a player faces the camera,
// the ball jumps round him; frames 3 and 40 after each jump show the eyes leading and the
// head following (and which way is which). Also prints the LookIK angles each step.
//   node tools/play/look.mjs [label]
import { harness } from './harness.mjs';
const label = process.argv[2] || 'look';
const H = await harness({ w: 960, h: 540 });
await H.start({});
await H.step(60);
await H.eval(() => { __R.setQuality(3); document.querySelector('#ui').style.display = 'none'; });
await H.eval(() => {
  const m = __G.match, p = m.human;
  m.phase = 'play'; m.restart = null;
  m.players.forEach((q, i) => { if (q !== p) { q.frozen = true; q.x = (i % 2 ? -1 : 1) * 13; q.z = -7 + (i % 5) * 0.5; } });
  Object.assign(p, { x: 0, z: 0, speed: 0, vx: 0, vz: 0, heading: Math.PI / 2, facing: Math.PI / 2, action: null });
  m.loseBall();
  window.__lookP = p;
});
const place = (x, y, z) => H.eval(([x, y, z]) => { const b = __G.match.ball; Object.assign(b, { x, y, z, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 }); }, [x, y, z]);
const cam = () => H.eval(() => { const p = window.__lookP, c = __R.camera; c.fov = 22; c.position.set(p.x + 0.1, 1.68, p.z + 1.5); c.lookAt(p.x, 1.62, p.z); c.updateProjectionMatrix(); __R.composer.render(); });
const angles = () => H.eval(() => { const a = __G.mview.athletes.get(window.__lookP.id), L = a.look; const d = r => (r * 180 / Math.PI).toFixed(0); return `eyes ${d(L.eye.yaw)}°/${d(L.eye.pitch)}° head ${d(L.head.yaw)}°/${d(L.head.pitch)}° (target: ${L.target?.why})`; });
// he faces +z (the camera); his left is +x
const spots = [['front', 0, 1.6, 4], ['eye-left', 2.2, 1.6, 2.5], ['eye-right', -2.2, 1.6, 2.5], ['left', 2.5, 0.11, 1.2], ['right', -2.5, 0.11, 1.2], ['up-left', 1.5, 2.2, 2], ['feet', 0.2, 0.11, 0.8]];
await place(0, 0.11, 3); await H.step(60);
for (const [name, x, y, z] of spots) {
  await place(x, y, z);
  await H.step(3); await cam(); console.log(`${name.padEnd(8)} +3 frames  ${await angles()}`); await H.shot(`${label}-${name}-a`);
  await H.step(37); await cam(); console.log(`${name.padEnd(8)} +40 frames ${await angles()}`); await H.shot(`${label}-${name}-b`);
}
if (H.errors.length) console.log('PAGE ERRORS', H.errors);
await H.close();
