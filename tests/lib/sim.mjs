// Shared headless harness for gameplay scenarios: the real Match + HumanController,
// driven by a fake controller at 60 fps (two 120 Hz sim steps per frame), exactly as
// the browser drives them. Used by the regression tests and tools/metrics.mjs.
import { Match } from '../../src/sim/match.js';
import { SIM_DT } from '../../src/config.js';
import { HumanController } from '../../src/game/human.js';

export const FRAME = 1 / 60;

// Stands in for Input: which logical buttons are down this frame, the stick, and any
// touch gesture/skill event, exactly as the browser's Input reports them.
export class FakeInput {
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

// A human-controlled player alone (others inactive unless asked for), on a fresh match.
// opts: { matchOpts, pick(player) → bool, x, z, heading, ball, keepers, others }
export function scenario(opts = {}) {
  const m = new Match({ humanTeam: 0, seconds: 9999, seed: 1, ...(opts.matchOpts || {}) });
  m.phase = 'play';
  const pick = opts.pick || (p => p.line === 'ATT');
  const p = m.players.find(q => q.team === 0 && pick(q)) || m.players.find(q => q.team === 0 && q.line !== 'GK');
  for (const q of m.players) {
    if (q === p) continue;
    const keep = (opts.keepers && q.line === 'GK') || (opts.others && opts.others(q));
    q.active = !!keep;
    if (q.active) q.frozen = opts.frozenOthers ?? true;
  }
  Object.assign(p, { x: opts.x ?? -8, z: opts.z ?? 0, speed: 0, vx: 0, vz: 0, heading: opts.heading ?? 0, facing: opts.heading ?? 0, stamina: 1, action: null });
  m.loseBall();
  const b = m.ball;
  Object.assign(b, { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, y: b.r ?? 0.11 });
  if (opts.ball) { b.x = p.x + Math.cos(p.facing) * 0.45; b.z = p.z + Math.sin(p.facing) * 0.45; m.gainPossession(p, true); }
  else { b.x = opts.ballAt?.x ?? 12; b.z = opts.ballAt?.z ?? 7; }
  const inp = new FakeInput();
  const h = new HumanController(m, 0, inp);
  if (m.human !== p) { for (const q of m.players) q.human = false; m.human = null; h.setHuman(p); }
  const events = [];
  // One 60 fps frame: stick in screen space (+x right, +y up = −z), buttons held.
  const frame = (sx = 0, sy = 0, down = [], extra) => {
    inp.move.x = sx; inp.move.y = sy;
    inp.set(down, extra);
    h.update(FRAME);
    m.step(SIM_DT); m.step(SIM_DT);
    for (const e of m.drainEvents()) events.push(e);
  };
  return { m, p, h, inp, frame, events, ball: b };
}

// Run frames while a predicate holds; returns frames run.
export function runUntil(s, pred, maxFrames, sx = 0, sy = 0, down = []) {
  let n = 0;
  while (n < maxFrames && !pred()) { s.frame(sx, sy, down); n++; }
  return n;
}

export { Match, SIM_DT };
