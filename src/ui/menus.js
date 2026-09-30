// Menus: title, match setup, pause, controls, full-time. Keyboard, gamepad and mouse.
import { crest } from './crest.js';
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
    <div class="cp-col"><h3>SHOOT</h3>
      <p><b>Hold</b> for power, release to strike</p>
      <p><b>Swipe ↑</b> chip · <b>swipe ↓</b> finesse curl</p>
      <p class="tip">Stick at the goal = assisted. Stick at the <b>cage</b> = bank shot; the dotted line shows the rebound.</p>
      <h3>PASS</h3>
      <p><b>Tap / hold</b> ground pass · <b>swipe →</b> driven</p>
      <p><b>Double-tap</b> dinked pass over the top</p>
    </div>
    <div class="cp-col"><h3>THROUGH</h3>
      <p><b>Tap</b> through ball · <b>swipe ↑</b> lofted through</p>
      <h3>SPRINT / SKILL</h3>
      <p><b>Hold</b> sprint · <b>tap</b> stepover</p>
      <p><b>Swipe</b> ↑ rainbow · ↓ drag-back · ←→ roulette</p>
      <p><b>PANNA</b> pops up when a defender is close in front</p>
      <p><b>GB</b> appears when your STYLE meter is full: tap it to fire your <b>GAMEBREAKER</b></p>
    </div>
    <div class="cp-col"><h3>DEFEND</h3>
      <p><b>TACKLE</b> tap · <b>swipe</b> to slide</p>
      <p><b>SWITCH</b> player · <b>PRESS</b> hold: teammate presses</p>
      <p><b>JOCKEY</b> hold: contain · <b>SPRINT</b> hold</p>
      <h3>MOVE</h3>
      <p>Left thumb anywhere on the left half</p>
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
      <p><kbd>G</kbd> Fire GAMEBREAKER (meter full) <span>L3 / R3</span></p>
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

// ---- ratings & kit art shared by the line-ups and the full-time sheet
const avg = xs => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
export function rating(p) {
  const a = p.attrs;
  const vals = p.role === 'GK' ? [a.keeping, a.keeping, a.accel, a.strength, a.pass] : [a.pace, a.accel, a.control, a.pass, a.shot, a.tackle, a.skill, a.strength].sort((x, y) => y - x).slice(0, 5);
  return Math.round(40 + 55 * avg(vals));
}
const ARCH_TAG = { Keeper: 'KEEPER', Enforcer: 'ENFORCER', Playmaker: 'PLAYMAKER', Trickster: 'TRICKSTER', Speedster: 'SPEEDSTER', Finisher: 'FINISHER' };
function teamBars(match, t) {
  const ps = match.players.filter(p => p.team === t);
  const out = ps.filter(p => p.role !== 'GK');
  const gk = ps.find(p => p.role === 'GK');
  const att = avg(out.filter(p => p.role !== 'DEF').map(p => (p.attrs.shot + p.attrs.skill + p.attrs.pace) / 3));
  const mid = avg(out.map(p => (p.attrs.pass + p.attrs.control) / 2));
  const def = avg([...out.filter(p => p.role === 'DEF').map(p => (p.attrs.tackle + p.attrs.strength) / 2), gk ? gk.attrs.keeping : 0.7]);
  return { att, mid, def };
}
function kitSVG(k, number = 10) {
  return `<svg class="kit" viewBox="0 0 120 150" width="96" height="120">
    <path d="M36 10 L50 4 Q60 12 70 4 L84 10 L110 30 L98 52 L88 46 L88 96 L32 96 L32 46 L22 52 L10 30 Z" fill="${k.shirt}" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
    <path d="M10 30 L22 52 L32 46 L32 40 L18 26 Z M110 30 L98 52 L88 46 L88 40 L102 26 Z" fill="${k.trim}" opacity=".9"/>
    <path d="M50 4 Q60 16 70 4" fill="none" stroke="${k.trim}" stroke-width="4"/>
    <text x="60" y="76" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="30" fill="${k.trim}" stroke="rgba(0,0,0,.35)" stroke-width="1">${number}</text>
    <path d="M34 98 L86 98 L90 132 L64 132 L60 116 L56 132 L30 132 Z" fill="${k.shorts}" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
    <rect x="34" y="134" width="18" height="14" rx="3" fill="${k.socks}"/><rect x="68" y="134" width="18" height="14" rx="3" fill="${k.socks}"/>
  </svg>`;
}
const bar = (label, v, color) => `<div class="lu-bar"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%;background:${color}"></b></i></div>`;

// Pre-match line-ups (FTS "match setup" screen): who's playing, what kind of player
// each one is (archetype chip), ratings, kits and a read on each side's strengths.
export function lineupsPanel(match, sub) {
  const team = t => {
    const T = match.teams[t];
    const rows = match.players.filter(p => p.team === t).map(p => `<div class="lu-row"><i class="pos pos-${p.role}">${p.role}</i><b>${p.number}</b><span>${p.name}<small>${ARCH_TAG[p.arch] || p.arch.toUpperCase()}</small></span><em>${rating(p)}</em></div>`).join('');
    return `<div class="lu-team"><div class="lu-head" style="--c:${T.def.kit.shirt}">${T.def.name}</div>${rows}</div>`;
  };
  const side = t => {
    const T = match.teams[t], b = teamBars(match, t);
    const star = match.players.filter(p => p.team === t && p.role !== 'GK').sort((x, y) => rating(y) - rating(x))[0];
    return `<div class="lu-side"><div class="lu-crest">${crest(T.def, 40)}</div>${kitSVG(T.def.kit, star ? star.number : 10)}
      ${bar('ATT', b.att, '#FFC43D')}${bar('MID', b.mid, '#37D67A')}${bar('DEF', b.def, '#3D8BFF')}</div>`;
  };
  return h('div', 'lineups', `${team(0)}<div class="lu-mid"><div class="lu-vs">${side(0)}<div class="lu-v">VS</div>${side(1)}</div><div class="lu-comp">${sub}</div></div>${team(1)}`);
}

// Full-time sheet (FTS layout): crests + final score, scorers with times, man of the
// match, and team-coloured split bars for each stat.
export function statsPanel(match) {
  const [A, B] = match.teams;
  const pos = A.stats.possession + B.stats.possession || 1;
  const pct = (ok, n) => n ? Math.round(ok / n * 100) : 0;
  const rows = [
    ['POSSESSION', Math.round(A.stats.possession / pos * 100), Math.round(B.stats.possession / pos * 100), '%'],
    ['SHOTS', A.stats.shots, B.stats.shots],
    ['ON TARGET', A.stats.onTarget, B.stats.onTarget],
    ['PASS COMPLETION', pct(A.stats.passesOk, A.stats.passes), pct(B.stats.passesOk, B.stats.passes), '%'],
    ['CAGE GOALS', A.stats.cageGoals, B.stats.cageGoals],
    ['SKILLS', A.stats.skills, B.stats.skills],
    ['PANNAS', A.stats.pannas, B.stats.pannas],
    ['SAVES', A.stats.saves, B.stats.saves],
  ];
  const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const scorers = t => match.goalLog.filter(g => g.team === t).map(g => `<span>${g.name || '—'} ${fmtT(g.at)}${g.cage ? ' <em>CAGE</em>' : ''}${g.own ? ' <em>OG</em>' : ''}</span>`).join('') || '<span class="none">—</span>';
  const motm = match.manOfTheMatch();
  const mt = motm ? match.teams[motm.team] : null;
  const motmLine = motm ? `<div class="ft-motm">MAN OF THE MATCH <b>${motm.name.toUpperCase()}</b> <small>${mt.def.short} · ${[motm.st.g && `${motm.st.g} goal${motm.st.g > 1 ? 's' : ''}`, motm.st.sk && `${motm.st.sk} skills`, motm.st.tk && `${motm.st.tk} tackles`, motm.st.sv && `${motm.st.sv} saves`].filter(Boolean).join(' · ') || 'solid shift'}</small></div>` : '';
  return h('div', 'stats ft', `
    <div class="ft-head">
      <div class="ft-team">${crest(A.def, 34)}<span>${A.def.name}</span></div>
      <div class="ft-score"><small>FINAL SCORE</small>${A.score} - ${B.score}</div>
      <div class="ft-team away"><span>${B.def.name}</span>${crest(B.def, 34)}</div>
    </div>
    <div class="ft-scorers"><div>${scorers(0)}</div><div class="away">${scorers(1)}</div></div>
    ${motmLine}
    ${rows.map(([k, a, b, u = '']) => {
      const tot = (a + b) || 1, wa = Math.round(a / tot * 100);
      return `<div class="ft-row"><span>${k}</span><div class="ft-bar"><i style="width:${(a + b) ? wa : 50}%;background:${A.def.kit.shirt}"><b>${a}${u}</b></i><i style="width:${(a + b) ? 100 - wa : 50}%;background:${B.def.kit.shirt}"><b>${b}${u}</b></i></div></div>`;
    }).join('')}`);
}
