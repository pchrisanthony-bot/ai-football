// =====================================================================
// Match formats and match configuration. A format is data: team size, pitch, the
// formations that fit it, and the rules that apply. createMatchConfig() resolves
// and validates everything a Match needs; nothing else in the game asks
// "is this 5v5?" — it reads the config.
// =====================================================================
import { PITCHES, buildPitch } from './pitch.js';
import { FORMATIONS } from './formations.js';

// Broadcast camera framing per format (see CameraRig.broadcast). The cage values are the
// tuned 5v5 framing. Open pitches follow the ball across the width from a gantry beyond
// the near touch line, and zoom with the play around the ball (roi m), not the whole
// pitch — so a bigger pitch doesn't simply mean a wider, emptier shot.
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
const OPEN_CAM = {
  ...CAGE_CAM,
  lead: 0.45, humanBias: 0.2, omega: 2.6,
  edge: 9, zFollow: 0.85, zRange: [-0.8, 0.85],
  spreadK: 0.16, goalZoom: 3, goalBand: [14, 10],
  rise: 0.56, lift: 2,
  gantry: 1, zCam: 0.25, back: 0.55, backOff: 2,
  lookZ: 1, lookOff: 1.4, fov: 36,
};

export const FORMATS = {
  '5v5': {
    label: '5v5 · STREET CAGE', teamSize: 5, pitch: 'cage5',
    formations: ['1-2-1', '2-1-1', '1-1-2'],
    camera: CAGE_CAM,
    rules: { outOfPlay: false, marking: 'man', offsideEnabled: false },   // walled cage: the ball never leaves play; futsal man-marking; no offside (street rules)
  },
  '7v7': {
    label: '7v7', teamSize: 7, pitch: 'open7',
    formations: ['2-3-1', '3-2-1', '2-2-2'],
    camera: { ...OPEN_CAM, base: 22, dist: [18, 30], roi: 16 },
    rules: { outOfPlay: true, marking: 'zonal', offsideEnabled: true },
  },
  '9v9': {
    label: '9v9', teamSize: 9, pitch: 'open9',
    formations: ['3-3-2', '3-2-3', '4-3-1'],
    camera: { ...OPEN_CAM, base: 24, dist: [19, 34], roi: 19 },
    rules: { outOfPlay: true, marking: 'zonal', offsideEnabled: true },
  },
  '11v11': {
    label: '11v11', teamSize: 11, pitch: 'full11',
    formations: ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2'],
    camera: { ...OPEN_CAM, base: 26, dist: [20, 38], roi: 22 },
    rules: { outOfPlay: true, marking: 'zonal', offsideEnabled: true },
  },
};
export const FORMAT_IDS = Object.keys(FORMATS);

// opts: { format, formations: [home, away] (ids), pitch (id or spec override),
//         offside: true | false (overrides the format's rule; null/undefined = the format's) }
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
  return { format: id, label: f.label, teamSize: f.teamSize, pitch: { ...pitchSpec, id: pitchId }, formations, rules, camera: f.camera };
}
