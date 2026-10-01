// Visual check of a format in the real game, frame-accurate: the line-ups screen, the
// kick-off shape and a few seconds of AI play (spectating), with positions logged.
//   node tools/play/check-format.mjs [--format=N] [--venue=N] [--gfx=N] [--label=name]
import { harness } from './harness.mjs';

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const label = arg('label', 'format');
const settings = { VENUE: +arg('venue', 0) };
if (arg('format', null) != null) settings.FORMAT = +arg('format');
if (arg('gfx', null) != null) settings.GRAPHICS = +arg('gfx');

const H = await harness({ w: +arg('w', 1280), h: +arg('h', 720) });
// Line-ups: open the setup, apply the settings, go to the line-ups screen.
await H.eval(async (settings) => {
  const pick = re => __G.menu.items.find(i => re.test(i.label));
  pick(/WATCH AI/).action(); await new Promise(r => setTimeout(r, 60));
  for (const [label, v] of Object.entries(settings)) { const it = __G.menu.items.find(i => i.label === label); if (it && it.onChange) { it.onChange(v); it.value = v; } }
  pick(/WATCH/).action();
}, settings);
await H.step(30);
await H.shot(`${label}-lineups`);
await H.eval(() => __G.menu.items.find(i => /WATCH/.test(i.label)).action());
await H.step(150);                         // intro flyover → match (kick-off phase)
await H.eval(() => { const m = __G.match; if (m.phase === 'play') m.kickoff(0); });
await H.step(2);
await H.shot(`${label}-kickoff`);
const kick = await H.eval(() => __G.match.players.map(p => `${p.team}:${p.role}:${p.name}@(${p.x.toFixed(1)},${p.z.toFixed(1)})`).join('  '));
console.log('KICK-OFF', kick);
for (let i = 0; i < 4; i++) { await H.step(150); await H.shot(`${label}-play-${i}`); }
const t = await H.telemetry();
console.log('TELEMETRY', JSON.stringify({ teamSize: t.teamSize, pitch: t.pitch, phase: t.phase }));
if (H.errors.length) console.log('PAGE ERRORS', H.errors);
await H.close();
