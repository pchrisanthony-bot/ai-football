// Unified input: keyboard + Gamepad API (standard mapping, FIFA Street layout).
// Produces logical buttons with pressed / released / held-time.

const KEYMAP = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  pass: ['KeyJ'], shoot: ['KeyK'], through: ['KeyL'], lob: ['KeyI'],
  control: ['Space'],             // Street Ball Control / jockey
  flair: ['ControlLeft', 'ControlRight'],
  stepover: ['KeyQ'], roulette: ['KeyE'], dragback: ['KeyF'], rainbow: ['KeyR'], flickup: ['KeyU'],
  rush: ['KeyO'],
  panna: [],
  gamebreaker: ['KeyG'],
  pause: ['Escape', 'KeyP'],
  debug: ['Tab'],
  confirm: ['Enter', 'NumpadEnter'],
  drill: ['KeyT'],
};

// Standard gamepad: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 12-15 dpad
const PADMAP = {
  pass: [0], shoot: [1], lob: [2], through: [3], flair: [4], flickup: [5], control: [6], sprint: [7],
  pause: [9], debug: [8], confirm: [0], rush: [3], gamebreaker: [10, 11],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.tapped = new Set();     // keys pressed since last frame (catches taps shorter than a frame)
    this.btn = {};
    for (const k of new Set([...Object.keys(KEYMAP), ...Object.keys(PADMAP)])) this.btn[k] = { down: false, pressed: false, released: false, held: 0 };
    this.move = { x: 0, y: 0 };           // screen space: +x right, +y up
    this.rstick = { x: 0, y: 0 };
    this.rflick = null;                   // 'up' | 'down' | 'left' | 'right' — right-stick flick this frame
    this._rWasCentered = true;
    this.usingPad = false;
    this.touch = null;              // TouchControls, when on a touch device
    this.gest = {};                 // button → how it was released this frame (touch swipe: 'up'|'down'|'left'|'right')
    this.skill = null;              // touch skill event this frame: { name, dx, dy }
    this.tapPending = false; this.tapFrame = false;
    addEventListener('pointerdown', e => { if (!(e.target && e.target.tagName === 'INPUT')) this.tapPending = true; });
    const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    addEventListener('keydown', e => {
      if (typing(e)) return;          // don't steer the game while typing a player tag
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code); this.tapped.add(e.code); this.usingPad = false;
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  update(dt) {
    this.tapFrame = this.tapPending; this.tapPending = false;
    const T = this.touch;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const pad = pads[0];
    const padDown = (name) => pad && (PADMAP[name] || []).some(i => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4));
    for (const [name, b] of Object.entries(this.btn)) {
      const kd = (KEYMAP[name] || []).some(c => this.keys.has(c) || this.tapped.has(c)) || (T ? T.isDown(name) : false);
      const pd = padDown(name);
      if (pd) this.usingPad = true;
      const down = kd || pd;
      b.pressed = down && !b.down;
      b.released = !down && b.down;
      if (b.pressed) b.held = 0;
      if (down) b.held += dt;
      b.lastHeld = b.released ? b.held : b.lastHeld;
      b.down = down;
    }
    // Touch gestures ride along with the release they belong to.
    this.gest = {};
    if (T) for (const name of Object.keys(T.gest)) {
      if (this.btn[name]?.released) { this.gest[name] = T.gest[name]; delete T.gest[name]; }
      else if (!this.btn[name]?.down) delete T.gest[name];
    }
    this.skill = T ? T.skill : null;
    if (T) T.skill = null;
    // movement
    let x = 0, y = 0;
    if (this.btn.left.down) x -= 1;
    if (this.btn.right.down) x += 1;
    if (this.btn.up.down) y += 1;
    if (this.btn.down.down) y -= 1;
    if (pad) {
      const ax = pad.axes[0] || 0, ay = -(pad.axes[1] || 0);
      if (Math.hypot(ax, ay) > 0.22) { x = ax; y = ay; this.usingPad = true; }
      if (pad.buttons[12]?.pressed) y = 1; if (pad.buttons[13]?.pressed) y = -1;
      if (pad.buttons[14]?.pressed) x = -1; if (pad.buttons[15]?.pressed) x = 1;
      const rx = pad.axes[2] || 0, ry = -(pad.axes[3] || 0);
      this.rstick.x = rx; this.rstick.y = ry;
      const rm = Math.hypot(rx, ry);
      this.rflick = null;
      if (rm > 0.75 && this._rWasCentered) {
        this.rflick = Math.abs(rx) > Math.abs(ry) ? (rx > 0 ? 'right' : 'left') : (ry > 0 ? 'up' : 'down');
        this._rWasCentered = false;
      }
      if (rm < 0.3) this._rWasCentered = true;
    } else this.rflick = null;
    if (T && T.enabled && Math.hypot(T.move.x, T.move.y) > 0.01) { x = T.move.x; y = T.move.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    this.move.x = x; this.move.y = y;
    this.tapped.clear();
    if (T) T.endFrame();
  }

  pressed(name) { return this.btn[name]?.pressed; }
  released(name) { return this.btn[name]?.released; }
  down(name) { return this.btn[name]?.down; }
  held(name) { return this.btn[name]?.held || 0; }
  anyPressed() { return this.tapFrame || Object.values(this.btn).some(b => b.pressed); }
}
