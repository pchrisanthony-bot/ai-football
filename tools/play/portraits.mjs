// Close-camera character checks (frame-accurate): every player of both sides standing
// side by side under the match lighting, then close-ups of one — face, hands, boots —
// for judging the bodies the way the brief's "Scene F" asks.
//   node tools/play/portraits.mjs [label]
import { harness } from './harness.mjs';
const label = process.argv[2] || 'portrait';
const H = await harness({ w: 1280, h: 720 });
await H.start({});
await H.step(60);
await H.eval(() => { __R.setQuality(3); document.querySelector('#ui').style.display = 'none'; });
// line everyone up facing the camera (+z), freeze them
await H.eval(() => {
  const m = __G.match;
  m.phase = 'play'; m.restart = null; m.loseBall(); Object.assign(m.ball, { x: 0, z: 8, vx: 0, vz: 0 });   // in front of them: they face the camera
  m.players.forEach((p, i) => { Object.assign(p, { x: -6.3 + i * 1.4, z: 2, speed: 0, vx: 0, vz: 0, facing: Math.PI / 2, heading: Math.PI / 2, frozen: true, action: null }); });
});
await H.step(40);
const shot = async (name, fn) => { await H.eval(fn); await H.eval(() => __R.composer.render()); return H.shot(`${label}-${name}`); };
await shot('lineup', () => { const c = __R.camera; c.fov = 30; c.position.set(0, 1.25, 12.5); c.lookAt(0, 0.95, 2); c.updateProjectionMatrix(); });
const P = (i, y, dist, dx = 0, fov = 22) => `(() => { const p = __G.match.players[${i}], c = __R.camera; c.fov = ${fov}; c.position.set(p.x + ${dx}, ${y}, p.z + ${dist}); c.lookAt(p.x, ${y}, p.z); c.updateProjectionMatrix(); })()`;
for (const i of [1, 4, 7]) {
  await shot(`face-${i}`, new Function(`return ${P(i, 1.66, 1.1, 0.15, 24)}`));
  await shot(`body-${i}`, new Function(`return ${P(i, 1.0, 3.6, 0.6, 30)}`));
}
await shot('back', new Function(`return ${P(3, 1.25, -2.4, 0, 30)}`));   // from behind: name and number
await shot('hands', new Function(`return ${P(2, 0.95, 0.9, 0.45, 30)}`));
await shot('boots', new Function(`return ${P(2, 0.2, 1.2, 0.5, 30)}`));
if (H.errors.length) console.log('PAGE ERRORS', H.errors);
await H.close();
console.log('ok');
