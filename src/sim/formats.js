// =====================================================================
// Match formats and match configuration. A format is data: team size, pitch, the
// formations that fit it, and the rules that apply. createMatchConfig() resolves
// and validates everything a Match needs; nothing else in the game asks
// "is this 5v5?" — it reads the config.
// =====================================================================
import { PITCHES, buildPitch } from './pitch.js';
import { FORMATIONS } from './formations.js';

// Broadcast camera framing (see CameraRig.broadcast): the tuned 5v5 cage framing.
const CAGE_CAM = {
  lead: 0.35, humanBias: 0.25, omega: 3.2,       // focus: ball + its run, a little toward the human
  edge: 6, zFollow: 0.55, zRange: [-3 / 9, 2.5 / 9],   // keep the focus this far in (x m; z as × half-width)
  base: 20, spreadK: 0.12, dist: [16, 25],       // zoom: base + spread of play, clamped
  goalZoom: 2.5, goalBand: [8, 6],               // tighter near goal: within goalBand[0] m of the line, over goalBand[1] m
  xFollow: 0.9, rise: 0.52, lift: 1.6,           // camera x follows 90%; height from the zoom
  gantry: 0, zCam: 0.3, back: 0.9, backOff: 1,   // camera z: gantry × half-width + follow + zoom
  lookZ: 0.4, lookOff: 1.2, fov: 34,
  roi: Infinity,                                  // the cage: everyone is in the play
};
export const FORMATS = {
  '5v5': {
    label: '5v5 · STREET CAGE', teamSize: 5, pitch: 'cage5',
    formations: ['1-2-1', '2-1-1', '1-1-2'],
    camera: CAGE_CAM,
    rules: { offsideEnabled: false, foulsEnabled: false },   // street rules: no offside, no refs (both can be switched on)
  },
};
export const FORMAT_IDS = Object.keys(FORMATS);

// opts: { format, formations: [home, away] (ids), pitch (id or spec override),
//         offside, fouls: true | false (override the format's rule; null/undefined = the format's) }
export function createMatchConfig(opts = {}) {
  const id = opts.format || '5v5';
  const f = FORMATS[id];
  if (!f) throw new Error(`Unknown format "${id}"`);
  const pitchSpec = opts.pitch ? (typeof opts.pitch === 'string' ? PITCHES[opts.pitch] : opts.pitch) : PITCHES[f.pitch];
  if (!pitchSpec) throw new Error(`Unknown pitch "${opts.pitch}"`);
  const pitchId = typeof opts.pitch === 'string' ? opts.pitch : (opts.pitch?.id || f.pitch);
  buildPitch(pitchSpec, pitchId);   // validates (throws on bad dimensions)
  const formations = [0, 1].map(t => {
    const fid = (opts.formations && opts.formations[t]) || f.formations[0];
    const fm = FORMATIONS[fid];
    if (!fm) throw new Error(`Unknown formation "${fid}"`);
    if (fm.size !== f.teamSize) throw new Error(`Formation ${fid} is for ${fm.size} players, format ${id} needs ${f.teamSize}`);
    return fid;
  });
  const rules = { ...f.rules };
  if (opts.offside === true || opts.offside === false) rules.offsideEnabled = opts.offside;
  if (opts.fouls === true || opts.fouls === false) rules.foulsEnabled = opts.fouls;
  return { format: id, label: f.label, teamSize: f.teamSize, pitch: { ...pitchSpec, id: pitchId }, formations, rules, camera: f.camera };
}
