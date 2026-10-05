// Draw calls, triangles and object counts (one rendered frame).
//   node tools/play/drawcalls.mjs [--venue=N] [--gfx=N]
import { harness } from './harness.mjs';
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const H = await harness({});
const settings = { GRAPHICS: +arg('gfx', 1), VENUE: +arg('venue', 0) };
await H.start(settings, { spectate: true });
await H.step(120);
const r = await H.eval(() => {
  const R = __R, info = R.renderer.info;
  info.autoReset = false; info.reset();
  R.composer.render();
  const out = { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length };
  info.autoReset = true;
  // which visible meshes cost the most draws (materials per mesh)
  const byKind = {};
  R.scene.traverseVisible(o => { if (!o.isMesh && !o.isSprite && !o.isLine) return; const k = o.isInstancedMesh ? 'instanced' : o.isSprite ? 'sprite' : Array.isArray(o.material) ? `mesh×${o.material.length}mat` : 'mesh'; byKind[k] = (byKind[k] || 0) + 1; });
  out.visible = byKind;
  return out;
});
console.log(JSON.stringify(r));
await H.close();
