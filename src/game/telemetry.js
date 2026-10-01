// Debug telemetry: one snapshot of the numbers that matter when tuning feel and
// scaling (player/ball motion, first touch, pitch/team size, camera, restarts).
// Read by the play harness (window.__telemetry) and shown in the debug overlay (Tab).
import { PITCH } from '../sim/pitch.js';

export function makeTelemetry(getMatch, rig) {
  let prev = null;
  return function telemetry() {
    const m = getMatch();
    if (!m) return null;
    const p = m.human, b = m.ball;
    const now = m.time;
    let accel = 0;
    if (p && prev && prev.id === p.id && now > prev.t) accel = (p.speed - prev.speed) / (now - prev.t);
    if (p) prev = { id: p.id, speed: p.speed, t: now };
    const ft = m.lastFirstTouch;
    return {
      format: m.cfg.format, teamSize: m.cfg.teamSize, formations: m.teams.map(t => t.formation),
      pitch: { id: PITCH.id, length: PITCH.length, width: PITCH.width, boundary: PITCH.boundary },
      player: p ? { name: p.name, role: p.role, line: p.line, speed: +p.speed.toFixed(2), accel: +accel.toFixed(1), mode: p.dribble?.mode } : null,
      ball: { speed: +Math.hypot(b.vx, b.vy, b.vz).toFixed(2), v: [+b.vx.toFixed(2), +b.vy.toFixed(2), +b.vz.toFixed(2)], owner: b.owner ? b.owner.name : null, lastTouch: b.lastTouch ? `${b.lastTouch.name} (${m.teams[b.lastTouch.team].def.short})` : null },
      gap: p ? +Math.hypot(b.x - p.x, b.z - p.z).toFixed(2) : null,
      firstTouch: ft ? { name: ft.name, inV: +ft.inV.toFixed(1), outV: +ft.outV.toFixed(1), quality: +ft.quality.toFixed(2), turn: Math.round(ft.turnDeg) } : null,
      camera: rig ? { dist: +rig.dist.toFixed(1) } : null,
      ai: m.ai.ranges ? m.ai.ranges() : null,
      phase: m.phase,
      restart: m.phase === 'restart' && m.restart ? `${m.restart.type} ${m.restart.state}` : null,
    };
  };
}

// Compact text block for the debug overlay.
export function telemetryText(t) {
  if (!t) return '';
  const rows = [
    `${t.format} · ${t.formations.join(' v ')} · pitch ${t.pitch.length}×${t.pitch.width} m ${t.pitch.boundary}`,
    t.player ? `${t.player.name} ${t.player.role} · ${t.player.speed} m/s · ${t.player.accel} m/s² · ${t.player.mode}` : '',
    `ball ${t.ball.speed} m/s · owner ${t.ball.owner ?? '—'} · last touch ${t.ball.lastTouch ?? '—'}` + (t.gap != null ? ` · gap ${t.gap} m` : ''),
    t.firstTouch ? `first touch ${t.firstTouch.name}: ${t.firstTouch.inV} → ${t.firstTouch.outV} m/s · q ${t.firstTouch.quality} · ${t.firstTouch.turn}°` : 'first touch —',
    `phase ${t.phase}${t.restart ? ' · restart ' + t.restart : ''}` + (t.camera ? ` · camera ${t.camera.dist} m` : ''),
    t.ai ? `AI ranges: ${Object.entries(t.ai).map(([k, v]) => `${k} ${v}`).join(' · ')}` : '',
  ];
  return rows.filter(Boolean).join('\n');
}
