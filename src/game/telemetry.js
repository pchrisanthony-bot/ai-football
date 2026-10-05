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
      pitch: { id: PITCH.id, length: PITCH.length, width: PITCH.width, box: PITCH.keeperArea },
      player: p ? { name: p.name, role: p.role, line: p.line, speed: +p.speed.toFixed(2), accel: +accel.toFixed(1), mode: p.dribble?.mode } : null,
      ball: { speed: +Math.hypot(b.vx, b.vy, b.vz).toFixed(2), v: [+b.vx.toFixed(2), +b.vy.toFixed(2), +b.vz.toFixed(2)], owner: b.owner ? b.owner.name : null, lastTouch: b.lastTouch ? `${b.lastTouch.name} (${m.teams[b.lastTouch.team].def.short})` : null },
      gap: p ? +Math.hypot(b.x - p.x, b.z - p.z).toFixed(2) : null,
      firstTouch: ft ? { name: ft.name, inV: +ft.inV.toFixed(1), outV: +ft.outV.toFixed(1), quality: +ft.quality.toFixed(2), turn: Math.round(ft.turnDeg) } : null,
      camera: rig ? { dist: +rig.dist.toFixed(1) } : null,
      ai: m.ai.ranges ? m.ai.ranges() : null,
      phase: m.phase,
      restart: m.phase === 'restart' && m.restart ? `${m.restart.type} ${m.restart.state}` : null,
      ...gameplay(m),
    };
  };
}

const deg = r => Math.round(r * 180 / Math.PI * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

// The last pass, the defending side's best chance to cut it out, and offside.
function gameplay(m) {
  const b = m.ball, c = m.passing.ctx, IS = m.intercepts, OS = m.offside;
  const live = m.passing.inFlight();
  const pass = c ? {
    passer: c.passer.name, target: c.receiver ? c.receiver.name : 'space', type: c.type, mode: c.mode, live: !!live,
    power: c.power != null ? r2(c.power) : null, quality: r2(c.quality), tier: c.tier,
    angErr: deg(c.angErr), paceErr: Math.round(c.paceErr * 100), pace: r2(c.pace), correction: r2(c.correction), read: r2(c.read),
    intended: [r2(c.intended.x), r2(c.intended.z)], receiverOffside: c.receiverOffside,
  } : null;
  let cut = null;
  if (live) {
    const t = 1 - live.passer.team, best = IS.bestCut(t), P = IS.perceived(t), X = IS.exactPath();
    const at = (path, s) => { const q = path && path.pts[Math.min(path.pts.length - 1, Math.round(s * 30))]; return q ? [r2(q.x), r2(q.z)] : null; };
    if (best) cut = { defender: best.p.name, at: [r2(best.p.x), r2(best.p.z)], point: [r2(best.ic.x), r2(best.ic.z)], eta: r2(best.ic.eta), ballEta: r2(best.ic.ballT), feasible: best.ic.feasible, reacted: IS.reacted(best.p), ballIn05: at(X, 0.5), readIn05: at(P, 0.5) };
  }
  let offside = null;
  if (OS.enabled) {
    const t = b.owner ? b.owner.team : live ? live.passer.team : null;
    const L = t != null ? OS.line(t) : null;
    offside = {
      line: L ? r2(Math.max(L.u, b.x * L.dir, 0) * L.dir) : null, secondLast: L && L.secondLast ? L.secondLast.name : null,
      snapshot: OS.snap ? { line: r2(OS.snap.line), flagged: [...OS.snap.flagged].map(id => m.byId.get(id).name), receiverOffside: OS.snap.receiverOffside } : null,
      lastCall: OS.last ? `${OS.last.name} — ${OS.last.how}` : null,
    };
  }
  const R = m.referee, k = R.keeperHolding();
  const referee = { fouls: R.fouls, keeper: k ? `${k.name} holding ${R.holdT.toFixed(1)} s` : null, kickoffHold: R.kickoffLive, last: R.last };
  return { pass, cut, offside, referee, ballV: [r2(b.vx), r2(b.vy), r2(b.vz)] };
}

// Compact text block for the debug overlay.
export function telemetryText(t) {
  if (!t) return '';
  const rows = [
    `${t.format} · ${t.formations.join(' v ')} · cage ${t.pitch.length}×${t.pitch.width} m`,
    t.player ? `${t.player.name} ${t.player.role} · ${t.player.speed} m/s · ${t.player.accel} m/s² · ${t.player.mode}` : '',
    `ball ${t.ball.speed} m/s · owner ${t.ball.owner ?? '—'} · last touch ${t.ball.lastTouch ?? '—'}` + (t.gap != null ? ` · gap ${t.gap} m` : ''),
    t.firstTouch ? `first touch ${t.firstTouch.name}: ${t.firstTouch.inV} → ${t.firstTouch.outV} m/s · q ${t.firstTouch.quality} · ${t.firstTouch.turn}°` : 'first touch —',
    `phase ${t.phase}${t.restart ? ' · restart ' + t.restart : ''}` + (t.camera ? ` · camera ${t.camera.dist} m` : ''),
    t.ai ? `AI ranges: ${Object.entries(t.ai).map(([k, v]) => `${k} ${v}`).join(' · ')}` : '',
    t.pass ? `pass ${t.pass.passer} → ${t.pass.target} · ${t.pass.type} (${t.pass.mode}) · power ${t.pass.power ?? '—'} · q ${t.pass.quality} ${t.pass.tier} · err ${t.pass.angErr}° / ${t.pass.paceErr}% · ${t.pass.pace} m/s · assist ${t.pass.correction}${t.pass.receiverOffside ? ' · OFFSIDE' : ''}${t.pass.live ? ' · in flight' : ''}` : '',
    t.cut ? `cut-out: ${t.cut.defender} at (${t.cut.at}) → (${t.cut.point}) · ETA ${t.cut.eta} s vs ball ${t.cut.ballEta} s · ${t.cut.feasible ? 'CAN' : 'cannot'} · ${t.cut.reacted ? 'reacted' : 'not yet reacted'} · ball +0.5 s (${t.cut.ballIn05}) read (${t.cut.readIn05})` : '',
    t.referee && (t.referee.keeper || t.referee.last || t.referee.kickoffHold) ? `referee: ${t.referee.fouls ? 'fouls on' : 'no fouls'}${t.referee.keeper ? ' · ' + t.referee.keeper + ' (protected)' : ''}${t.referee.kickoffHold ? ' · kick-off: own halves' : ''}${t.referee.last ? ` · last foul ${t.referee.last.fouler} on ${t.referee.last.victim}: ${t.referee.last.slide ? 'slide' : 'tackle'}${t.referee.last.behind ? ' from behind' : ''}${t.referee.last.ballFirst ? ' (ball first)' : ' (man first)'} at ${t.referee.last.speed} m/s → ${t.referee.last.card || 'no card'}${t.referee.last.penalty ? ' · PENALTY' : ''}` : ''}` : '',
    t.offside ? `offside line x ${t.offside.line ?? '—'} (2nd-last ${t.offside.secondLast ?? '—'})${t.offside.snapshot ? ` · frozen at ${t.offside.snapshot.line}: ${t.offside.snapshot.flagged.join(', ') || 'nobody'} offside` : ''}${t.offside.lastCall ? ` · last call ${t.offside.lastCall}` : ''}` : '',
  ];
  return rows.filter(Boolean).join('\n');
}
