// =====================================================================
// Match formats and match configuration. A format is data: team size, pitch, the
// formations that fit it, and the rules that apply. createMatchConfig() resolves
// and validates everything a Match needs; nothing else in the game asks
// "is this 5v5?" — it reads the config.
// =====================================================================
import { PITCHES, buildPitch } from './pitch.js';
import { FORMATIONS } from './formations.js';

export const FORMATS = {
  '5v5': {
    label: '5v5 · STREET CAGE', teamSize: 5, pitch: 'cage5',
    formations: ['1-2-1', '2-1-1', '1-1-2'],
    rules: { outOfPlay: false, marking: 'man' },   // walled cage: the ball never leaves play; futsal man-marking
  },
  '7v7': {
    label: '7v7', teamSize: 7, pitch: 'open7',
    formations: ['2-3-1', '3-2-1', '2-2-2'],
    rules: { outOfPlay: true, marking: 'zonal' },
  },
  '9v9': {
    label: '9v9', teamSize: 9, pitch: 'open9',
    formations: ['3-3-2', '3-2-3', '4-3-1'],
    rules: { outOfPlay: true, marking: 'zonal' },
  },
  '11v11': {
    label: '11v11', teamSize: 11, pitch: 'full11',
    formations: ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2'],
    rules: { outOfPlay: true, marking: 'zonal' },
  },
};
export const FORMAT_IDS = Object.keys(FORMATS);

// opts: { format, formations: [home, away] (ids), pitch (id or spec override) }
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
  return { format: id, label: f.label, teamSize: f.teamSize, pitch: { ...pitchSpec, id: pitchId }, formations, rules: { ...f.rules } };
}
