// Touch controls (First Touch Soccer style): a floating joystick on the left half
// of the screen and a thumb cluster of buttons on the right. The buttons feed the
// same logical buttons as the keyboard/gamepad, so the game code doesn't change.
//
//   attack:  SHOOT (hold = power) · PASS · THROUGH · LOB · SPRINT (hold)
//            SKILL: tap = stepover, swipe ↑ rainbow / ↓ drag-back / ←→ stepover, long-press = panna
//   defend:  SLIDE · SWITCH · TACKLE · PRESS · SPRINT · JOCKEY

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const BUTTONS = [
  // name: logical button; atk/def: labels; cls: position class
  { name: 'shoot', atk: 'SHOOT', def: 'SLIDE', cls: 'tb-shoot' },
  { name: 'pass', atk: 'PASS', def: 'SWITCH', cls: 'tb-pass' },
  { name: 'through', atk: 'THRU', def: 'TACKLE', cls: 'tb-through' },
  { name: 'lob', atk: 'LOB', def: 'PRESS', cls: 'tb-lob' },
  { name: 'sprint', atk: 'SPRINT', def: 'SPRINT', cls: 'tb-sprint' },
  { name: 'skill', atk: 'SKILL', def: 'JOCKEY', cls: 'tb-skill' },
];

export class TouchControls {
  constructor(root, input) {
    this.input = input;
    this.down = new Set();
    this.move = { x: 0, y: 0 };
    this.stick = null;               // { id, ox, oy }
    this.enabled = false;
    this.attack = true;

    const el = this.el = document.createElement('div');
    el.className = 'touch hidden';
    el.innerHTML = `
      <div class="t-stickzone"></div>
      <div class="t-stick hidden"><div class="t-knob"></div></div>
      <div class="t-pause">❚❚</div>
      <div class="t-reset hidden">↺</div>
      ${BUTTONS.map(b => `<div class="tb ${b.cls}" data-name="${b.name}"><span>${b.atk}</span></div>`).join('')}`;
    root.appendChild(el);
    this.zone = el.querySelector('.t-stickzone');
    this.stickEl = el.querySelector('.t-stick');
    this.knob = el.querySelector('.t-knob');
    this.btnEls = [...el.querySelectorAll('.tb')];
    this.resetEl = el.querySelector('.t-reset');

    // --- joystick (floating: appears where the thumb lands)
    this.zone.addEventListener('pointerdown', e => {
      if (this.stick) return;
      e.preventDefault();
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.stickEl.classList.remove('hidden');
      this.stickEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    });
    const R = 58;
    this.zone.addEventListener('pointermove', e => {
      const s = this.stick;
      if (!s || e.pointerId !== s.id) return;
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const d = Math.hypot(dx, dy);
      // drag the base along if the thumb wanders far (keeps the stick under the thumb)
      if (d > R * 1.6) { s.ox += dx * (1 - R * 1.6 / d); s.oy += dy * (1 - R * 1.6 / d); this.stickEl.style.transform = `translate(${s.ox}px, ${s.oy}px)`; dx = e.clientX - s.ox; dy = e.clientY - s.oy; }
      const k = Math.min(1, Math.hypot(dx, dy) / R);
      const a = Math.atan2(dy, dx);
      const mag = k < 0.18 ? 0 : (k - 0.18) / 0.82;
      this.move.x = Math.cos(a) * mag; this.move.y = -Math.sin(a) * mag;
      this.knob.style.transform = `translate(calc(-50% + ${Math.cos(a) * k * R}px), calc(-50% + ${Math.sin(a) * k * R}px))`;
    });
    const endStick = e => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null; this.move.x = 0; this.move.y = 0;
      this.stickEl.classList.add('hidden');
    };
    this.zone.addEventListener('pointerup', endStick);
    this.zone.addEventListener('pointercancel', endStick);

    // --- buttons (multi-touch; each button tracks its own pointer)
    for (const b of this.btnEls) {
      const name = b.dataset.name;
      let id = null, sx = 0, sy = 0, t0 = 0;
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
        id = e.pointerId; sx = e.clientX; sy = e.clientY; t0 = performance.now();
        b.classList.add('on');
        if (name === 'skill') { if (!this.attack) this.down.add('control'); }
        else this.down.add(name);
        navigator.vibrate?.(8);
      });
      const up = e => {
        if (e.pointerId !== id) return;
        id = null;
        b.classList.remove('on');
        if (name === 'skill') {
          this.down.delete('control');
          if (this.attack) {
            // tap = stepover; swipe = direction-based skill (like FIFA Street's right stick)
            const dx = e.clientX - sx, dy = e.clientY - sy;
            const held = performance.now() - t0;
            if (Math.hypot(dx, dy) >= 24) this.pendingFlick = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy < 0 ? 'up' : 'down');
            else if (held > 350) this.tapPanna = true;          // long-press = panna attempt
            else this.tapSkill = 'stepover';
          }
        } else this.down.delete(name);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
    el.querySelector('.t-pause').addEventListener('pointerdown', e => { e.preventDefault(); this.tapPause = true; });
    this.resetEl.addEventListener('pointerdown', e => { e.preventDefault(); this.tapReset = true; });
  }

  // Show only during play; relabel for attack/defence.
  setVisible(on, { drill = false } = {}) {
    if (on !== this.enabled) {
      this.enabled = on;
      this.el.classList.toggle('hidden', !on);
      if (!on) { this.down.clear(); this.stick = null; this.move.x = this.move.y = 0; this.stickEl.classList.add('hidden'); this.btnEls.forEach(b => b.classList.remove('on')); }
    }
    this.resetEl.classList.toggle('hidden', !drill);
  }

  setMode(attack) {
    if (attack === this.attack) return;
    this.attack = attack;
    for (const b of this.btnEls) {
      const def = BUTTONS.find(x => x.name === b.dataset.name);
      b.firstElementChild.textContent = attack ? def.atk : def.def;
      b.classList.toggle('def', !attack);
    }
  }

  // Called by Input.update: extra "down" buttons for this frame.
  isDown(name) {
    if (!this.enabled) return false;
    if (name === 'pause' && this.tapPause) return true;
    if (name === 'drill' && this.tapReset) return true;
    if (name === 'stepover' && this.tapSkill === 'stepover') return true;
    if (name === 'panna' && this.tapPanna) return true;
    return this.down.has(name);
  }
  endFrame() {
    this.tapPause = false; this.tapReset = false; this.tapSkill = null; this.tapPanna = false;
  }
}
