// Touch gestures through the real HumanController + Match: chip, curl, driven pass,
// double-tap dink, lofted through ball, SKILL swipes and the PANNA prompt.
import { Match } from '../src/sim/match.js';
import { SIM_DT } from '../src/config.js';
import { HumanController } from '../src/game/human.js';
import { DRILL_VARIANTS, setupDrill } from '../src/game/drill.js';

const FRAME = 1 / 60;

// Stands in for Input: each frame says which logical buttons are down, plus any
// gesture (read on release) or skill event, exactly as TouchControls reports them.
class FakeInput {
  constructor() { this.btn = {}; this.move = { x: 0, y: 0 }; this.gest = {}; this.skill = null; this.rflick = null; this.touch = { enabled: true }; }
  set(down = [], { gest = {}, skill = null } = {}) {
    for (const n of new Set([...Object.keys(this.btn), ...down])) {
      const b = this.btn[n] || (this.btn[n] = { down: false, pressed: false, released: false, held: 0 });
      const d = down.includes(n);
      b.pressed = d && !b.down; b.released = !d && b.down; b.down = d;
      b.held = b.pressed ? 0 : b.held + (d ? FRAME : 0);
    }
    this.gest = {};
    for (const [n, g] of Object.entries(gest)) if (this.btn[n]?.released) this.gest[n] = g;
    this.skill = skill;
  }
  pressed(n) { return !!this.btn[n]?.pressed; }
  released(n) { return !!this.btn[n]?.released; }
  down(n) { return !!this.btn[n]?.down; }
  held(n) { return this.btn[n]?.held || 0; }
}

function scene({ mate = true, defenderAhead = false } = {}) {
  const m = new Match({ humanTeam: 0, mode: 'drill', seconds: 9999, seed: 3, difficulty: 0.6 });
  const { shooter, def } = setupDrill(m, DRILL_VARIANTS[0]);
  if (mate) {
    const r = m.players.find(p => p.team === 0 && p.slot === 3);
    Object.assign(r, { active: true, x: shooter.x + 7, z: shooter.z - 3, frozen: true });
  }
  if (defenderAhead) {
    Object.assign(def, { x: shooter.x + Math.cos(shooter.facing) * 2, z: shooter.z + Math.sin(shooter.facing) * 2 });
  } else def.active = false;
  const inp = new FakeInput();
  const h = new HumanController(m, 0, inp);
  const events = [];
  const run = (frames, down = [], extra) => {
    for (let i = 0; i < frames; i++) {
      inp.set(down, i === 0 ? extra : undefined);
      h.update(FRAME);
      m.step(SIM_DT); m.step(SIM_DT);
      events.push(...m.drainEvents());
    }
  };
  return { m, h, inp, shooter, run, events, kick: () => events.find(e => e.type === 'kick') };
}

// Tap a button (down for `hold` frames), then release it with an optional swipe gesture.
function tap(s, name, { hold = 3, gest = null, stick = null } = {}) {
  if (stick) { s.inp.move.x = stick.x; s.inp.move.y = stick.y; }
  s.run(hold, [name]);
  s.run(1, [], gest ? { gest: { [name]: gest } } : undefined);
}

export default function () {
  const out = [];
  const check = (name, ok, info = '') => out.push({ name, ok: !!ok, info });

  // SHOOT: plain vs swipe-up chip vs swipe-down curl
  const plain = scene({ mate: false });
  tap(plain, 'shoot', { hold: 30 }); plain.run(40);
  const chip = scene({ mate: false });
  tap(chip, 'shoot', { hold: 30, gest: 'up' }); chip.run(40);
  const curl = scene({ mate: false });
  tap(curl, 'shoot', { hold: 30, gest: 'down' }); curl.run(40);
  const kp = plain.kick(), kc = chip.kick(), kf = curl.kick();
  check('SHOOT tap/hold strikes', kp && kp.kind === 'shot', kp && `speed ${kp.speed.toFixed(1)}`);
  check('SHOOT swipe ↑ = chip (slower, higher)', kc && kp && kc.speed < kp.speed * 0.85, kc && `speed ${kc.speed.toFixed(1)}`);
  check('SHOOT swipe ↓ = finesse curl', kf && kf.finesse);

  // PASS: tap vs swipe-right driven vs double-tap dink
  const toMate = (s) => { const r = s.m.players.find(p => p.team === 0 && p.slot === 3); const dx = r.x - s.shooter.x, dz = r.z - s.shooter.z, d = Math.hypot(dx, dz); return { x: dx / d, y: -dz / d }; };
  const pass = scene();
  tap(pass, 'pass', { stick: toMate(pass) }); pass.run(30);
  const drive = scene();
  tap(drive, 'pass', { stick: toMate(drive), gest: 'right' }); drive.run(30);
  const dink = scene();
  tap(dink, 'pass', { stick: toMate(dink) }); dink.run(4); tap(dink, 'pass', { hold: 2 }); dink.run(30);
  const pk = pass.kick(), dk = drive.kick(), nk = dink.kick();
  check('PASS tap = ground pass', pk && pk.kind === 'pass', pk && `speed ${pk.speed.toFixed(1)}`);
  check('PASS swipe → = driven (harder)', dk && pk && dk.kind === 'pass' && dk.speed > pk.speed * 1.15, dk && `speed ${dk.speed.toFixed(1)}`);
  check('PASS double-tap = dinked pass', nk && nk.kind === 'lob', nk && nk.kind);

  // THROUGH: swipe up = lofted through ball
  const thr = scene();
  tap(thr, 'through', { stick: toMate(thr), gest: 'up' }); thr.run(30);
  const tk = thr.kick();
  check('THROUGH swipe ↑ = lofted through ball', tk && tk.kind === 'lob', tk && tk.kind);

  // SKILL swipes and the panna prompt
  const sk = scene({ mate: false });
  sk.run(2, [], { skill: { name: 'rainbow', dx: 0, dy: -40 } });
  check('SKILL swipe ↑ = rainbow', sk.shooter.action?.type === 'rainbow', sk.shooter.action?.type);
  const ro = scene({ mate: false });
  ro.run(2, [], { skill: { name: 'roulette', dx: 0, dy: 40 } });
  check('SKILL swipe ← → = roulette', ro.shooter.action?.type === 'roulette', ro.shooter.action?.type);

  const open = scene({ mate: false });
  const pn = scene({ mate: false, defenderAhead: true });
  check('PANNA prompt only with a defender close in front', !open.h.pannaReady() && pn.h.pannaReady());
  pn.run(2, ['panna']);
  check('PANNA button starts a panna', pn.shooter.action?.type === 'panna', pn.shooter.action?.type);
  return out;
}
