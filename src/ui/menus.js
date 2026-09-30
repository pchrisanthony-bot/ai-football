// Menus: title, match setup, pause, controls, full-time. Keyboard, gamepad and mouse.
import { TEAMS } from '../sim/players.js';

const h = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

// A vertical list of items: { label, action } or { label, options: [...], value, onChange }.
export class Menu {
  constructor(root, { title = '', subtitle = '', items = [], cls = '', footer = '', side = null }) {
    this.el = h('div', `menu ${cls}`);
    this.el.innerHTML = `${title ? `<div class="menu-title">${title}</div>` : ''}${subtitle ? `<div class="menu-sub">${subtitle}</div>` : ''}`;
    this.list = h('div', 'menu-list');
    this.el.appendChild(this.list);
    if (side) this.el.appendChild(side);
    if (footer) this.el.appendChild(h('div', 'menu-foot', footer));
    this.items = items;
    this.sel = 0;
    this.rows = items.map((it, i) => {
      const r = h('div', 'menu-item interactive');
      r.addEventListener('mouseenter', () => { this.sel = i; this.render(); });
      r.addEventListener('pointerdown', (e) => {
        if (it.options) { const dir = e.offsetX < r.clientWidth / 2 ? -1 : 1; this.change(it, dir); }
        else it.action?.();
      });
      this.list.appendChild(r);
      return r;
    });
    root.appendChild(this.el);
    this.render();
  }
  change(it, d) {
    const n = it.options.length;
    it.value = (it.value + d + n) % n;
    it.onChange?.(it.value);
    this.render();
    this.onNav?.();
  }
  render() {
    this.items.forEach((it, i) => {
      const r = this.rows[i];
      r.classList.toggle('sel', i === this.sel);
      r.innerHTML = it.options
        ? `<span class="mi-label">${it.label}</span><span class="mi-opt"><i>‹</i>${it.options[it.value].label ?? it.options[it.value]}<i>›</i></span>`
        : `<span class="mi-label">${it.label}</span>`;
      if (it.swatch) r.querySelector('.mi-opt')?.style.setProperty('--c', it.swatch(it.value));
    });
  }
  // nav from Input
  handle(input) {
    const it = this.items[this.sel];
    const up = input.pressed('up'), down = input.pressed('down'), left = input.pressed('left'), right = input.pressed('right');
    if (up) { this.sel = (this.sel - 1 + this.items.length) % this.items.length; this.render(); this.onNav?.(); }
    if (down) { this.sel = (this.sel + 1) % this.items.length; this.render(); this.onNav?.(); }
    if (it.options && (left || right)) this.change(it, left ? -1 : 1);
    if ((input.pressed('confirm') || input.pressed('pass')) && !it.options) { this.onNav?.(); it.action?.(); }
    else if ((input.pressed('confirm') || input.pressed('pass')) && it.options) this.change(it, 1);
  }
  destroy() { this.el.remove(); }
}

export function titleScreen(root) {
  const el = h('div', 'title-screen', `
    <div class="logo"><span class="l1">STREET</span><span class="l2">CAGE</span></div>
    <div class="tagline">5-A-SIDE · ROOFTOP · NO RULES BUT THE CAGE</div>`);
  root.appendChild(el);
  return el;
}

export const TEAM_IDS = Object.keys(TEAMS);
export const MODES = [
  { label: 'TIMED · 2 MIN', mode: 'timed', seconds: 120 },
  { label: 'TIMED · 3 MIN', mode: 'timed', seconds: 180 },
  { label: 'TIMED · 5 MIN', mode: 'timed', seconds: 300 },
  { label: 'FIRST TO 5', mode: 'firstto', seconds: 0, firstTo: 5 },
  { label: 'LAST MAN STANDING', mode: 'lms', seconds: 0 },
];
export const DIFFS = [{ label: 'AMATEUR', v: 0.35 }, { label: 'PRO', v: 0.6 }, { label: 'LEGEND', v: 0.88 }];

export function controlsPanel() {
  if (document.documentElement.classList.contains('is-touch')) return h('div', 'controls-panel', `
    <div class="cp-col"><h3>MOVE</h3>
      <p>Left thumb anywhere on the left half: joystick</p>
      <p><b>SPRINT</b> hold while moving</p>
      <h3>ATTACK</h3>
      <p><b>SHOOT</b> hold for power, release to strike</p>
      <p class="tip">Point the stick at the goal = assisted. Point it at the <b>cage</b> = bank shot; the dotted preview shows the rebound.</p>
      <p><b>PASS</b> · <b>THRU</b> through ball · <b>LOB</b></p>
    </div>
    <div class="cp-col"><h3>SKILL BUTTON</h3>
      <p>Tap: stepover</p>
      <p>Swipe ↑ rainbow flick · ↓ drag-back · ← → stepover</p>
      <p>Long-press near a defender: <b>PANNA</b></p>
      <p class="tip">Skills, pannas and cage goals fill the <b>STYLE</b> meter → <b>GAMEBREAKER</b>.</p>
    </div>
    <div class="cp-col"><h3>DEFEND</h3>
      <p><b>SWITCH</b> player · <b>TACKLE</b> · <b>SLIDE</b></p>
      <p><b>PRESS</b> hold: teammate presses too</p>
      <p><b>JOCKEY</b> hold: contain the attacker</p>
      <h3>GAME</h3>
      <p>❚❚ pause · tap to skip replays</p>
    </div>`);
  return h('div', 'controls-panel', `
    <div class="cp-col"><h3>ATTACK</h3>
      <p><kbd>WASD</kbd> Move <span>L-stick</span></p>
      <p><kbd>Shift</kbd> Sprint <span>RT</span></p>
      <p><kbd>J</kbd> Pass (hold = harder) <span>A</span></p>
      <p><kbd>K</kbd> Shoot — hold for power <span>B</span></p>
      <p class="tip">Aim at the goal = assisted. Aim at the <b>cage</b> = bank shot, the preview shows the rebound.</p>
      <p><kbd>L</kbd> Through ball <span>Y</span></p>
      <p><kbd>I</kbd> Lob · <kbd>Ctrl</kbd>+<kbd>I</kbd> Chip <span>X</span></p>
      <p><kbd>Ctrl</kbd>+<kbd>K</kbd> Finesse curl <span>LB+B</span></p>
    </div>
    <div class="cp-col"><h3>STREET</h3>
      <p><kbd>Space</kbd> Street Ball Control <span>LT</span></p>
      <p><kbd>Space</kbd>+<kbd>Shift</kbd> near a defender: PANNA <span>LT→RT</span></p>
      <p><kbd>Q</kbd> Stepover <span>R ← →</span></p>
      <p><kbd>E</kbd> Roulette</p>
      <p><kbd>F</kbd> Drag back <span>R ↓</span></p>
      <p><kbd>R</kbd> Rainbow flick <span>R ↑</span></p>
      <p><kbd>U</kbd> Flick up → <kbd>K</kbd> volley <span>RB</span></p>
      <p class="tip">Skills + pannas + wall goals fill the <b>STYLE</b> meter → <b>GAMEBREAKER</b>.</p>
    </div>
    <div class="cp-col"><h3>DEFEND</h3>
      <p><kbd>J</kbd> Switch player <span>A</span></p>
      <p><kbd>L</kbd> Tackle <span>Y</span></p>
      <p><kbd>K</kbd> Slide tackle <span>B</span></p>
      <p><kbd>Space</kbd> Jockey <span>LT</span></p>
      <p><kbd>I</kbd> (hold) Teammate press <span>X</span></p>
      <p><kbd>O</kbd> (hold) Rush keeper</p>
      <h3>GAME</h3>
      <p><kbd>Tab</kbd> AI debug overlay</p>
      <p><kbd>Esc</kbd> Pause · <kbd>T</kbd> Trick-shot drill</p>
    </div>`);
}

export function statsPanel(match) {
  const [A, B] = match.teams;
  const pos = A.stats.possession + B.stats.possession || 1;
  const rows = [
    ['GOALS', A.score, B.score],
    ['SHOTS', A.stats.shots, B.stats.shots],
    ['ON TARGET', A.stats.onTarget, B.stats.onTarget],
    ['POSSESSION', Math.round(A.stats.possession / pos * 100) + '%', Math.round(B.stats.possession / pos * 100) + '%'],
    ['PASSES', `${A.stats.passesOk}/${A.stats.passes}`, `${B.stats.passesOk}/${B.stats.passes}`],
    ['CAGE GOALS', A.stats.cageGoals, B.stats.cageGoals],
    ['PANNAS', A.stats.pannas, B.stats.pannas],
    ['SKILLS', A.stats.skills, B.stats.skills],
    ['TACKLES', A.stats.tackles, B.stats.tackles],
    ['SAVES', A.stats.saves, B.stats.saves],
  ];
  return h('div', 'stats', `
    <div class="stats-head"><span style="--c:${A.def.kit.shirt}">${A.def.name}</span><span style="--c:${B.def.kit.shirt}">${B.def.name}</span></div>
    ${rows.map(([k, a, b]) => `<div class="stats-row"><b>${a}</b><span>${k}</span><b>${b}</b></div>`).join('')}`);
}
