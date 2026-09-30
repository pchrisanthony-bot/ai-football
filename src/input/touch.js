// Touch controls, laid out like FC Mobile / First Touch Soccer: a floating joystick
// on the left, and four contextual thumb buttons in an arc on the right. Each button
// reads gestures (tap, hold, swipe, double-tap) and feeds the same logical buttons the
// keyboard and gamepad use, so the game code barely knows it's on a phone.
//
//   ATTACK   SHOOT    hold = power · swipe ↑ chip · swipe ↓ finesse curl
//            PASS     tap/hold = ground pass · swipe → driven pass · double-tap = dinked pass
//            THROUGH  tap = through ball · swipe ↑ lofted through ball
//            SPRINT   hold = sprint · tap = stepover · swipe ↑ rainbow ↓ drag-back ←→ roulette
//            PANNA    pops up when a defender is close in front
//   DEFENCE  TACKLE (swipe = slide) · SWITCH · PRESS (hold) · SPRINT · JOCKEY (hold)

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const SWIPE = 22;          // px of drag that turns a press into a swipe
const TAP = 0.22;          // s: shorter than this (and no swipe) is a tap

// btn: logical button held while pressed. hints: swipe directions that change the action.
const SLOTS = [
  { key: 'shoot', cls: 'tb-shoot',
    atk: { label: 'SHOOT', btn: 'shoot', sub: '▴CHIP ▾CURL', hints: { up: 'CHIP', down: 'CURL' } },
    def: { label: 'TACKLE', tap: 'through', swipe: 'shoot', sub: 'SWIPE: SLIDE', hints: { up: 'SLIDE', down: 'SLIDE', left: 'SLIDE', right: 'SLIDE' } } },
  { key: 'pass', cls: 'tb-pass',
    atk: { label: 'PASS', btn: 'pass', sub: '2× DINK', hints: { right: 'DRIVEN', left: 'DRIVEN' } },
    def: { label: 'SWITCH', btn: 'pass', sub: '' } },
  { key: 'through', cls: 'tb-through',
    atk: { label: 'THROUGH', btn: 'through', sub: '▴LOFT', hints: { up: 'LOFTED' } },
    def: { label: 'PRESS', btn: 'lob', sub: 'HOLD' } },
  { key: 'sprint', cls: 'tb-sprint',
    atk: { label: 'SPRINT', btn: 'sprint', skill: true, sub: 'SWIPE: SKILL', hints: { up: 'RAINBOW', down: 'DRAG-BACK', left: 'ROULETTE', right: 'ROULETTE' } },
    def: { label: 'SPRINT', btn: 'sprint', sub: '' } },
];
const SKILL_FOR = { up: 'rainbow', down: 'dragback', left: 'roulette', right: 'roulette' };
const CONTEXT = {
  panna: { label: 'PANNA', sub: 'NUTMEG', tap: 'panna' },
  jockey: { label: 'JOCKEY', sub: 'HOLD', btn: 'control' },
};

const dirOf = (dx, dy) => Math.hypot(dx, dy) < SWIPE ? null
  : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy < 0 ? 'up' : 'down');

export class TouchControls {
  constructor(root, input) {
    this.input = input;
    this.down = new Set();     // logical buttons held by a finger
    this.seen = new Set();     // …that a frame has already read
    this.latch = new Set();    // released before any frame saw them: stay down one frame
    this.pulse = new Set();    // one-frame taps (tackle, slide, panna, pause…)
    this.gest = {};            // logical button → swipe direction, read by Input on release
    this.skill = null;         // { name, dx, dy } for this frame
    this.move = { x: 0, y: 0 };
    this.stick = null;
    this.enabled = false;
    this.attack = true;
    this.context = null;
    this.charged = null;

    const el = this.el = document.createElement('div');
    el.className = 'touch hidden';
    const btn = (cls, key) => `<div class="tb ${cls}" data-key="${key}"><b class="tb-l"></b><small class="tb-s"></small>
      <i class="gh gh-up">▴</i><i class="gh gh-down">▾</i><i class="gh gh-left">‹</i><i class="gh gh-right">›</i></div>`;
    el.innerHTML = `
      <div class="t-stickzone"></div>
      <div class="t-stick idle"><div class="t-knob"></div></div>
      <div class="t-pause">❚❚</div>
      <div class="t-reset hidden">↺</div>
      ${SLOTS.map(s => btn(s.cls, s.key)).join('')}
      ${btn('tb-ctx', 'ctx')}`;
    root.appendChild(el);
    this.zone = el.querySelector('.t-stickzone');
    this.stickEl = el.querySelector('.t-stick');
    this.knob = el.querySelector('.t-knob');
    this.resetEl = el.querySelector('.t-reset');
    this.btns = {};
    for (const b of el.querySelectorAll('.tb')) this.btns[b.dataset.key] = b;
    this.ctxEl = this.btns.ctx;

    this.bindStick();
    for (const s of SLOTS) this.bindSlot(this.btns[s.key], () => this.attack ? s.atk : s.def);
    this.bindSlot(this.ctxEl, () => CONTEXT[this.context]);
    el.querySelector('.t-pause').addEventListener('pointerdown', e => { e.preventDefault(); this.pulse.add('pause'); });
    this.resetEl.addEventListener('pointerdown', e => { e.preventDefault(); this.pulse.add('drill'); });
    this.relabel();
  }

  // ---- joystick: rests bottom-left, jumps to wherever the left thumb lands
  bindStick() {
    const R = 58;
    const place = (x, y) => { this.stickEl.style.transform = `translate(${x}px, ${y}px)`; };
    this.zone.addEventListener('pointerdown', e => {
      if (this.stick) return;
      e.preventDefault();
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.stickEl.classList.remove('idle');
      place(e.clientX, e.clientY);
      this.knob.style.transform = 'translate(-50%, -50%)';
    });
    this.zone.addEventListener('pointermove', e => {
      const s = this.stick;
      if (!s || e.pointerId !== s.id) return;
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const d = Math.hypot(dx, dy);
      // drag the base along if the thumb wanders far (keeps the stick under the thumb)
      if (d > R * 1.6) { s.ox += dx * (1 - R * 1.6 / d); s.oy += dy * (1 - R * 1.6 / d); place(s.ox, s.oy); dx = e.clientX - s.ox; dy = e.clientY - s.oy; }
      const k = Math.min(1, Math.hypot(dx, dy) / R);
      const a = Math.atan2(dy, dx);
      const mag = k < 0.18 ? 0 : (k - 0.18) / 0.82;
      this.move.x = Math.cos(a) * mag; this.move.y = -Math.sin(a) * mag;
      this.knob.style.transform = `translate(calc(-50% + ${Math.cos(a) * k * R}px), calc(-50% + ${Math.sin(a) * k * R}px))`;
    });
    const end = e => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.releaseStick();
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  releaseStick() {
    this.stick = null; this.move.x = 0; this.move.y = 0;
    this.stickEl.classList.add('idle');
    this.stickEl.style.transform = '';
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  // ---- one thumb button; `role()` is its current personality (attack/defence/context)
  bindSlot(el, role) {
    let g = null;   // the press in progress: { id, role, sx, sy, t0, dir, fired }
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const r = role();
      if (!r || g) return;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      g = { id: e.pointerId, role: r, sx: e.clientX, sy: e.clientY, t0: performance.now(), dir: null, fired: false };
      el.classList.add('on');
      if (r.btn) this.press(r.btn);
      navigator.vibrate?.(8);
    });
    el.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      const dir = dirOf(e.clientX - g.sx, e.clientY - g.sy);
      if (dir === g.dir) return;
      g.dir = dir;
      const r = g.role;
      // Show which variant the swipe picks (the label becomes CHIP, CURL, RAINBOW…).
      const variant = dir && r.hints?.[dir];
      el.dataset.dir = variant ? dir : '';
      el.querySelector('.tb-l').textContent = variant || r.label;
      if (variant) navigator.vibrate?.(5);
      if (dir && r.skill) this.release(r.btn);                 // a swipe on SPRINT is a skill, not a sprint
      if (dir && r.swipe && !g.fired) { g.fired = true; this.pulse.add(r.swipe); }   // slide goes in on the swipe
    });
    const up = e => {
      if (!g || e.pointerId !== g.id) return;
      const r = g.role, dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      const dir = dirOf(dx, dy), held = (performance.now() - g.t0) / 1000;
      if (r.btn) {
        if (dir && r.hints?.[dir] && !r.skill) this.gest[r.btn] = dir;
        this.release(r.btn);
      }
      if (r.skill && this.attack) {
        if (dir) this.skill = { name: SKILL_FOR[dir], dx, dy };
        else if (held < TAP) this.skill = { name: 'stepover', dx: 0, dy: 0 };
      }
      if (r.tap && !g.fired) this.pulse.add(r.tap);
      g = null;
      el.classList.remove('on');
      el.dataset.dir = '';
      this.relabel();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  press(name) { this.down.add(name); this.seen.delete(name); }
  release(name) {
    if (!this.down.has(name)) return;
    if (!this.seen.has(name)) this.latch.add(name);            // a tap shorter than a frame still counts
    this.down.delete(name);
  }

  relabel() {
    for (const s of SLOTS) {
      const el = this.btns[s.key];
      if (el.classList.contains('on')) continue;               // don't relabel under a thumb
      const r = this.attack ? s.atk : s.def;
      el.querySelector('.tb-l').textContent = r.label;
      el.querySelector('.tb-s').textContent = r.sub || '';
      el.classList.toggle('def', !this.attack);
      for (const d of ['up', 'down', 'left', 'right']) el.querySelector('.gh-' + d).classList.toggle('show', !!r.hints?.[d]);
    }
  }

  // Show only during play.
  setVisible(on, { drill = false } = {}) {
    if (on !== this.enabled) {
      this.enabled = on;
      this.el.classList.toggle('hidden', !on);
      if (!on) {
        this.down.clear(); this.seen.clear(); this.latch.clear(); this.pulse.clear(); this.gest = {}; this.skill = null;
        this.releaseStick();
        for (const b of Object.values(this.btns)) { b.classList.remove('on'); b.dataset.dir = ''; }
        this.relabel();
      }
    }
    this.resetEl.classList.toggle('hidden', !drill);
  }

  setMode(attack) {
    if (attack === this.attack) return;
    this.attack = attack;
    this.relabel();
  }

  // The pop-up button: 'panna' when one is on, 'jockey' when defending, or null.
  setContext(name) {
    if (name === this.context) return;
    if (this.ctxEl.classList.contains('on') && !name) return;  // keep it while it's held
    this.context = name;
    const c = CONTEXT[name];
    this.ctxEl.classList.toggle('show', !!c);
    this.ctxEl.classList.toggle('panna', name === 'panna');
    if (c) {
      this.ctxEl.querySelector('.tb-l').textContent = c.label;
      this.ctxEl.querySelector('.tb-s').textContent = c.sub;
    }
  }

  // Power ring on the button being charged (kind: 'shoot' | 'pass' | 'through' | null).
  setCharge(kind, level) {
    const key = kind === 'shoot' || kind === 'pass' || kind === 'through' ? kind : null;
    const v = key ? Math.round(level * 40) / 40 : 0;
    if (this.charged && this.charged !== key) { this.btns[this.charged].style.setProperty('--c', 0); this.btns[this.charged].classList.remove('charging'); }
    this.charged = key;
    if (key) { this.btns[key].style.setProperty('--c', v); this.btns[key].classList.add('charging'); }
  }

  // Read by Input.update each frame.
  isDown(name) {
    if (!this.enabled) return false;
    return this.down.has(name) || this.latch.has(name) || this.pulse.has(name);
  }
  endFrame() {
    for (const n of this.down) this.seen.add(n);
    this.latch.clear();
    this.pulse.clear();
  }
}
