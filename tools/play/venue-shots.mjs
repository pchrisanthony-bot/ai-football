// The venue from the eight angles of the visual brief (frame-accurate, real match in
// progress): gameplay camera, low angle, high angle, pitch corner, player close-up, goal
// area, street/building view, and (optional) the night version of the gameplay view.
//   node tools/play/venue-shots.mjs [label] [--venue=N] [--night] [--quality=N]
import { harness } from './harness.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const label = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'venue';
const venue = +arg('venue', 0), q = +arg('quality', 2);
const H = await harness({ w: 1280, h: 720 });
await H.start({ VENUE: venue });
await H.step(240);
await H.eval(q => { __R.setQuality(q); document.querySelector('#ui').style.display = 'none'; }, q);
await H.step(30);
const shot = async (name, cam) => {
  if (cam) await H.eval(c => {
    const C = __R.camera; C.fov = c.fov; C.position.set(...c.pos); C.lookAt(...c.at); C.updateProjectionMatrix();
    __G.mview && (__G.__freezeCam = true);
  }, cam);
  await H.eval(() => __R.composer.render());
  await H.shot(`${label}-${name}`);
};
// 1. the gameplay camera as it is
await shot('1-gameplay');
// the rest: fixed cameras (the rig is re-applied each frame, so set and render at once)
const views = [
  ['2-low', { fov: 50, pos: [-6, 1.4, 6.5], at: [4, 2.2, -6] }],
  ['3-high', { fov: 40, pos: [0, 32, 26], at: [0, 0, -2] }],
  ['4-corner', { fov: 55, pos: [-15, 2.2, 8.2], at: [0, 2, -4] }],
  ['6-goal', { fov: 50, pos: [-10, 1.8, 3.5], at: [-16, 1.2, -1] }],
  ['7-street', { fov: 55, pos: [4, 3, 7.5], at: [6, 9, -16] }],
  // the crowd up close: along the far fence, and the chawl's galleries
  ['8-fence', { fov: 45, pos: [1.5, 1.6, -5.2], at: [-2.5, 1.2, -10.5] }],
  ['9-gallery', { fov: 50, pos: [-13, 3.2, -6.5], at: [-15, 5.5, -14] }],
];
for (const [n, c] of views) await shot(n, c);
// 5. a player close-up
await H.eval(() => {
  const p = __G.match.players.find(q => q.line !== 'GK'), C = __R.camera;
  C.fov = 35; C.position.set(p.x + 1.6, 1.5, p.z + 3.2); C.lookAt(p.x, 1.1, p.z); C.updateProjectionMatrix();
});
await shot('5-player');
if (H.errors.length) console.log('PAGE ERRORS', H.errors.slice(0, 3));
await H.close();
console.log('ok');
