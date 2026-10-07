// The crowd up close (frame-accurate, a match in progress): the far fence, the chawl's
// galleries, and the same with the crowd cheering (uCheer forced to 1).
//   node tools/play/crowd-shots.mjs [label] [--venue=N] [--cheer]
import { harness } from './harness.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const label = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'crowd';
const H = await harness({ w: 1280, h: 720 });
await H.start({ VENUE: +arg('venue', 0) });
await H.step(240);
await H.eval(() => { __R.setQuality(3); document.querySelector('#ui').style.display = 'none'; });
await H.step(30);
const views = [
  ['fence', { fov: 45, pos: [1.5, 1.6, -5.2], at: [-2.5, 1.2, -10.5] }],
  ['fence2', { fov: 40, pos: [-6, 1.5, -6.5], at: [-9, 1.3, -10.6] }],
  ['gallery', { fov: 50, pos: [-13, 3.2, -6.5], at: [-15, 5.5, -14] }],
  ['end', { fov: 50, pos: [12, 1.7, 2], at: [17.5, 1.4, -3] }],
  ['lane', { fov: 55, pos: [-1, 3.2, -6.8], at: [-9, 0.9, -12.2] }],
  ['sky', { fov: 60, pos: [0, 1.6, 4], at: [-4, 14, -20] }],
];
for (const cheer of process.argv.includes('--cheer') ? [0, 1] : [0]) {
  for (const [n, c] of views) {
    await H.eval(([c, cheer]) => {
      const v = Object.values(__G).find(x => x && x.crowd) || null;
      __R.scene.traverse(o => { if (o.name === 'street:crowd') o.material.userData.cheer = cheer; });
      const C = __R.camera; C.fov = c.fov; C.position.set(...c.pos); C.lookAt(...c.at); C.updateProjectionMatrix();
      if (window.__crowd) window.__crowd.U.uCheer.value = cheer;
      __R.composer.render();
    }, [c, cheer]);
    await H.shot(`${label}-${n}${cheer ? '-cheer' : ''}`);
  }
}
if (H.errors.length) console.log('PAGE ERRORS', H.errors.slice(0, 3));
await H.close();
console.log('ok');
