// Close-up filmstrips of one player's animation (frame-accurate): a side-on camera beside
// him, every few frames, for each movement. PNGs go to tools/play/out/film-<name>-<i>.png.
//   node tools/play/anim-film.mjs [movement…] [--every=N] [--n=N] [--label=x]
import { harness } from './harness.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const every = +arg('every', 5), count = +arg('n', 8), label = arg('label', 'film');
const want = process.argv.slice(2).filter(a => !a.startsWith('--'));
const H = await harness({ w: 960, h: 540 });
await H.start({});
await H.step(90);
await H.eval(() => { __R.setQuality(2); document.querySelector('#ui').style.display = 'none'; });

const isolate = (ball) => H.eval((ball) => {
  const m = __G.match, p = m.human;
  m.phase = 'play'; m.restart = null;
  m.players.forEach((q, i) => { if (q !== p) { q.frozen = true; q.speed = 0; if (q.line !== 'GK') { q.x = (q.team === p.team ? -1 : 1) * 13; q.z = ((i % 5) - 2) * 3.2; } } });
  Object.assign(p, { x: -8, z: 2, speed: 0, vx: 0, vz: 0, heading: 0, facing: 0, stamina: 1, action: null });
  m.loseBall();
  const b = m.ball; Object.assign(b, { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, y: 0.11 });
  if (ball) { b.x = p.x + 0.45; b.z = p.z; m.gainPossession(p, true); } else { b.x = 12; b.z = 7; }
}, ball);
// Step n frames, then frame the player side-on (camera at +z, 5.5 m away, hip height) and render.
const snap = async (name, i) => {
  await H.eval(() => {
    const p = window.__filmTarget || __G.match.human, c = __R.camera;
    c.fov = 40; c.position.set(p.x - 0.6, 1.25, p.z + 5.2); c.lookAt(p.x, 0.85, p.z); c.updateProjectionMatrix();
    __R.composer.render();
  });
  await H.shot(`film-${label}-${name}-${i}`);
};
const film = async (name, frames = count) => { for (let i = 0; i < frames; i++) { await H.step(every); await snap(name, i); } };

const MOVES = {
  jog: async () => { await isolate(false); await H.down('KeyD'); await H.step(30); await film('jog'); await H.up('KeyD'); },
  sprint: async () => { await isolate(false); await H.down('KeyD', 'ShiftLeft'); await H.step(50); await film('sprint'); await H.up('KeyD', 'ShiftLeft'); },
  stop: async () => { await isolate(false); await H.down('KeyD', 'ShiftLeft'); await H.step(50); await H.up('KeyD', 'ShiftLeft'); await film('stop'); },
  turn: async () => { await isolate(false); await H.step(30); await H.down('KeyA'); await H.step(2); await H.up('KeyA'); await film('turn'); },
  // standing, rotated to face the camera (front view) and then turned on the spot by the sim facing
  front: async () => { await isolate(false); await H.eval(() => { const p = __G.match.human; p.facing = p.heading = Math.PI / 2; }); await H.step(40); await film('front', 1); },
  spin: async () => {
    await isolate(false); await H.step(30);
    for (let i = 0; i < 10; i++) { await H.eval(() => { const p = __G.match.human; p.facing += Math.PI / 12; p.heading = p.facing; }); await H.step(3); await snap('spin', i); }
  },
  jockey: async () => { await isolate(false); await H.down('Space', 'KeyW'); await H.step(15); await film('jockey'); await H.up('Space', 'KeyW'); },
  pass: async () => { await isolate(true); await H.down('KeyD'); await H.step(20); await H.tap('KeyJ', 3); await H.up('KeyD'); await film('pass', 6); },
  // their keeper dives to a shot across him; then our man slides into a carrier
  dive: async () => {
    await isolate(false);
    await H.eval(() => {
      const m = __G.match, gk = m.keeper(1), p = m.human;
      window.__filmTarget = gk;
      gk.frozen = false; gk.x = 14.6; gk.z = 0; gk.ai.state = 'POSITION';
      Object.assign(m.ball, { x: 6, y: 0.4, z: 0, vx: 22, vy: 1.2, vz: 2.2, wx: 0, wy: 0, wz: 0, owner: null });
      m.ball.lastKick = { pid: p.id, team: p.team, kind: 'shot', t: m.time }; m.ball.lastTouch = p;
    });
    await film('dive', 8);
    await H.eval(() => { window.__filmTarget = null; });
  },
  slide: async () => {
    await isolate(false);
    await H.eval(() => {
      const m = __G.match, p = m.human, o = m.players.find(q => q.team !== p.team && q.line !== 'GK');
      Object.assign(o, { x: p.x + 4, z: p.z, frozen: true }); m.ball.x = o.x + 0.4; m.ball.z = o.z; m.gainPossession(o, true);
    });
    await H.down('KeyD', 'ShiftLeft'); await H.step(14); await H.tap('KeyK', 2); await H.up('KeyD', 'ShiftLeft');
    await film('slide', 8);
  },
  dribble: async () => { await isolate(true); await H.down('KeyD'); await H.step(25); await film('dribble'); await H.up('KeyD'); },
};
for (const n of (want.length ? want : Object.keys(MOVES))) await MOVES[n]();
if (H.errors.length) console.log('PAGE ERRORS', H.errors);
await H.close();
console.log('ok');
