// In-match HUD (DOM): broadcast score bug, style/GAMEBREAKER meters, callouts,
// controlled-player tag with power + stamina, radar, and the AI debug overlay.
import * as THREE from 'three';
import { STYLE } from '../config.js';
import { PITCH } from '../sim/pitch.js';
import { crest } from './crest.js';

const h = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

// Where each kind of notice goes. Anything that can happen while the ball is live sits
// in the top band under the score bug (never over the middle of the pitch); only
// dead-ball moments (a goal) may take the centre.
export const NOTICES = {
  save:    { at: 'top', size: 'm', dur: 1.3 },     // PARRIED! / SAVED!
  frame:   { at: 'top', size: 'm', dur: 1.3 },     // OFF THE POST / BAR
  skill:   { at: 'top', size: 'm', dur: 1.2 },     // PANNA!
  alert:   { at: 'top', size: 'm', dur: 1.8 },     // GAMEBREAKER READY
  restart: { at: 'top', size: 'l', dur: 1.6 },     // KICK OFF / FREE KICK / PENALTY
  power:   { at: 'top', size: 'l', dur: 2.2 },     // GAMEBREAKER (slow motion, play is live)
  info:    { at: 'top', size: 's', dur: 3.2 },     // instructions (drill)
};
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class HUD {
  constructor(root) {
    this.root = h('div', 'hud');
    root.appendChild(this.root);
    this.v = new THREE.Vector3();
    this.labels = new Map();
    this.debug = false;
  }

  bind(match, camera) {
    this.m = match; this.cam = camera; this.inReplay = false;
    const [A, B] = match.teams;
    this.root.innerHTML = '';
    this.root.classList.remove('hidden');
    const mode = { timed: 'TIMED', firstto: `FIRST TO ${match.opts.firstTo}`, lms: 'LAST MAN STANDING', drill: 'TRICK-SHOT DRILL' }[match.opts.mode] || '';
    // Broadcast score bug (FTS layout): crest · TLA | score | TLA · crest | clock.
    this.bug = h('div', 'bug', `
      <div class="bug-crest">${crest(A.def, 22)}</div>
      <div class="bug-team" style="--c:${A.def.kit.shirt}"><span>${A.def.short}</span></div>
      <div class="bug-score"><b class="s0">0</b><i>-</i><b class="s1">0</b></div>
      <div class="bug-team away" style="--c:${B.def.kit.shirt}"><span>${B.def.short}</span></div>
      <div class="bug-crest">${crest(B.def, 22)}</div>
      <div class="bug-clock">0:00</div>
      <div class="bug-mode">${mode}</div>`);
    this.root.appendChild(this.bug);
    this.s0 = this.bug.querySelector('.s0'); this.s1 = this.bug.querySelector('.s1'); this.clock = this.bug.querySelector('.bug-clock');

    this.meters = [0, 1].map(t => {
      const T = match.teams[t];
      const el = h('div', `meter meter-${t}`, `<div class="meter-name">${T.def.name}</div><div class="meter-bar"><div class="meter-fill" style="background:${T.def.kit.shirt}"></div></div><div class="meter-label">STYLE</div>`);
      this.root.appendChild(el);
      return { el, fill: el.querySelector('.meter-fill'), label: el.querySelector('.meter-label') };
    });
    this.notices = h('div', 'notices');
    this.feed = h('div', 'feed');
    this.banner = h('div', 'banner');
    this.replayTag = h('div', 'replay-tag hidden', '<span class="r-badge">R</span><small>tap / any key to skip</small>');
    this.letterbox = h('div', 'letterbox', '<i></i><i></i>');
    this.l3 = h('div', 'l3');
    this.tag = h('div', 'ptag hidden', '<div class="ptag-name"></div><div class="ptag-power"><div></div></div><div class="ptag-stam"><div></div></div>');
    this.tagName = this.tag.querySelector('.ptag-name'); this.tagPow = this.tag.querySelector('.ptag-power'); this.tagPowFill = this.tagPow.firstChild; this.tagStam = this.tag.querySelector('.ptag-stam div');
    this.flashEl = h('div', 'flash');
    this.radar = h('canvas', 'radar'); this.radar.width = 256; this.radar.height = Math.round(256 * PITCH.width / PITCH.length);   // the pitch's shape
    this.dbg = h('div', 'dbg');
    this.dbgLegend = h('div', 'dbg-legend hidden', `<b>AI DEBUG</b> — each tag is one autonomous agent: <i>STATE</i> · chosen action · top utility scores. <kbd>Tab</kbd> to hide`);
    this.tele = h('pre', 'tele hidden');
    this.teleT = 0;
    this.hint = h('div', 'hint', '<kbd>WASD</kbd> move <kbd>Shift</kbd> sprint <kbd>J</kbd> pass <kbd>K</kbd> shoot (hold) <kbd>L</kbd> through <kbd>I</kbd> lob <kbd>Space</kbd> close control <kbd>Q E F R U</kbd> skills <kbd>Tab</kbd> AI view <kbd>Esc</kbd> pause');
    this.root.append(this.letterbox, this.notices, this.feed, this.banner, this.replayTag, this.l3, this.tag, this.flashEl, this.radar, this.dbg, this.dbgLegend, this.tele, this.hint);
    this.labels.clear();
    this.setDebug(this.debug);
    this.lastScore = [0, 0];
  }

  hide() { this.root.classList.add('hidden'); }
  show() { this.root.classList.remove('hidden'); }

  setDebug(on) {
    this.debug = on;
    this.dbg.classList.toggle('hidden', !on);
    this.dbgLegend?.classList.toggle('hidden', !on);
    this.tele?.classList.toggle('hidden', !on || !this.telemetry);
  }
  // Debug telemetry readout (shown with the AI debug overlay).
  setTelemetry(fn, toText) { this.telemetry = fn; this.teleText = toText; this.tele?.classList.toggle('hidden', !this.debug || !fn); }

  project(x, y, z) {
    this.v.set(x, y, z).project(this.cam);
    return { x: (this.v.x * 0.5 + 0.5) * innerWidth, y: (-this.v.y * 0.5 + 0.5) * innerHeight, vis: this.v.z < 1 };
  }

  flash(a) {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = a;
    requestAnimationFrame(() => { this.flashEl.style.transition = 'opacity .35s'; this.flashEl.style.opacity = 0; });
  }

  // Show a notice. kind: a key of NOTICES; opts: { color, sub, dur }.
  notify(text, kind = 'info', { color = '#FFD400', sub = '', dur } = {}) {
    const spec = NOTICES[kind] || NOTICES.info;
    const e = h('div', `notice n-${spec.size} n-${kind}`, `<b>${text}</b>${sub ? `<small>${sub}</small>` : ''}`);
    e.style.setProperty('--c', color);
    this.notices.prepend(e);
    while (this.notices.children.length > 3) this.notices.lastChild.remove();
    const ms = (dur ?? spec.dur) * 1000;
    setTimeout(() => e.classList.add('out'), ms);
    setTimeout(() => e.remove(), ms + 350);
    return e;
  }

  style(label, pts, color) {
    const e = h('div', 'feed-item', `<b>+${pts}</b> ${label}`);
    e.style.setProperty('--c', color);
    this.feed.prepend(e);
    while (this.feed.children.length > 4) this.feed.lastChild.remove();
    setTimeout(() => e.classList.add('out'), 1800);
    setTimeout(() => e.remove(), 2300);
    if (label === 'PANNA!') this.notify('PANNA!', 'skill', { color: '#FF3B6B' });
  }

  gamebreaker(team) {
    const T = this.m.teams[team];
    this.notify('GAMEBREAKER', 'power', { color: T.def.kit.trim, sub: T.def.name });
  }

  goal(info, match) {
    const T = match.teams[info.team];
    const scorer = match.players.find(p => p.id === info.scorer);
    // Queue the broadcast lower-third for the replay: "GOAL! – Reyes 1:23".
    const at = fmt(match.elapsed());
    const what = info.own ? 'OWN GOAL' : info.cage ? 'CAGE GOAL!' : 'GOAL!';
    this.pendingL3 = { def: T.def, top: T.def.name, bot: scorer ? `${what} – ${scorer.name} <span>${at}</span>${!info.own && scorer.st.g > 1 ? ` <em>${scorer.st.g} GOALS</em>` : ''}` : `${what} <span>${at}</span>` };
    const title = info.cage ? 'CAGE GOAL!' : info.own ? 'OWN GOAL' : 'GOAL!';
    const sub = scorer ? `${scorer.name.toUpperCase()} <span>#${scorer.number}</span>${info.cage ? ` · off the mesh${info.wallHits > 1 ? ' ×' + info.wallHits : ''}` : ''}` : '';
    this.banner.innerHTML = `<div class="goal ${info.cage ? 'cage' : ''}" style="--c:${T.def.kit.shirt}"><div class="goal-t">${title}</div><div class="goal-s">${sub}</div></div>`;
    this.banner.classList.add('show');
    setTimeout(() => this.banner.classList.remove('show'), 2600);
  }


  setReplay(on) {
    this.replayTag.classList.toggle('hidden', !on);
    this.letterbox.classList.toggle('on', on);
    this.inReplay = on;
    for (const el of [this.dbg, this.dbgLegend, this.radar, this.tag, this.hint, this.bug, ...this.meters.map(x => x.el)]) el?.classList.toggle('replay-hide', on);
    if (on && this.pendingL3) { const l = this.pendingL3; this.pendingL3 = null; setTimeout(() => this.lowerThird(l.def, l.top, l.bot, 3200), 500); }
    if (!on) this.l3.classList.remove('show');
  }

  // FTS-style lower-third: crest badge, team bar, info bar.
  lowerThird(def, top, bot, ms = 3000) {
    this.l3.innerHTML = `<div class="l3-crest">${crest(def, 44)}</div><div class="l3-bars"><div class="l3-top" style="--c:${def.kit.shirt}">${top}</div><div class="l3-bot">${bot}</div></div>`;
    this.l3.classList.remove('show'); void this.l3.offsetWidth; this.l3.classList.add('show');
    clearTimeout(this._l3T);
    this._l3T = setTimeout(() => this.l3.classList.remove('show'), ms);
  }
  setSpectate(on) { this.hint?.classList.toggle('hidden', on); }

  update(dt, human) {
    const m = this.m;
    if (!m || this.inReplay) return;
    const [A, B] = m.teams;
    if (A.score !== this.lastScore[0]) { this.s0.textContent = A.score; this.pop(this.s0); }
    if (B.score !== this.lastScore[1]) { this.s1.textContent = B.score; this.pop(this.s1); }
    this.lastScore = [A.score, B.score];
    this.clock.textContent = m.opts.mode === 'timed' ? fmt(Math.max(0, m.clock)) : fmt(m.opts.seconds - m.clock);
    this.clock.classList.toggle('late', m.opts.mode === 'timed' && m.clock < 15 && m.phase === 'play');

    const touch = document.documentElement.classList.contains('is-touch');
    m.teams.forEach((T, i) => {
      const mt = this.meters[i];
      const gb = T.gb > 0, ready = T.gbReady;
      mt.fill.style.width = `${gb ? (T.gb / STYLE.gamebreakerSecs) * 100 : (T.style / STYLE.meterMax) * 100}%`;
      mt.el.classList.toggle('gb-on', gb);
      mt.el.classList.toggle('gb-ready', ready);
      const yours = m.opts.humanTeam === i;
      mt.label.textContent = gb ? `GAMEBREAKER ${Math.ceil(T.gb)}` : ready ? (yours ? (touch ? 'GAMEBREAKER READY · TAP GB' : 'GAMEBREAKER READY · PRESS G') : 'GAMEBREAKER READY') : 'STYLE';
    });

    // controlled player tag
    const p = m.human;
    if (p && p.active && m.phase !== 'fulltime') {
      const s = this.project(p.x, 2.55, p.z);
      this.tag.classList.toggle('hidden', !s.vis);
      this.tag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      const nm = `${p.number} · ${p.name.toUpperCase()}`;
      if (this.tagName.textContent !== nm) this.tagName.textContent = nm;
      const c = human ? human.chargeLevel() : 0;
      this.tagPow.classList.toggle('on', c > 0);
      this.tagPowFill.style.width = `${c * 100}%`;
      this.tagPowFill.classList.toggle('max', c >= 0.98);
      this.tagStam.style.width = `${p.stamina * 100}%`;
    } else this.tag.classList.add('hidden');

    this.drawRadar();
    if (this.debug) {
      this.drawDebug();
      if (this.telemetry && (this.teleT -= dt) <= 0) { this.teleT = 0.25; this.tele.textContent = this.teleText(this.telemetry()); }
    }
  }

  pop(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

  drawRadar() {
    const c = this.radar.getContext('2d'), m = this.m;
    const W = this.radar.width, H = this.radar.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(8,10,16,0.72)'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 2;
    c.strokeRect(6, 6, W - 12, H - 12);
    c.beginPath(); c.moveTo(W / 2, 6); c.lineTo(W / 2, H - 6); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, PITCH.centreR / PITCH.length * (W - 12), 0, Math.PI * 2); c.stroke();
    const X = x => 6 + (x + PITCH.halfL) / PITCH.length * (W - 12);
    const Z = z => 6 + (z + PITCH.halfW) / PITCH.width * (H - 12);
    for (const p of m.players) {
      if (!p.active) continue;
      c.fillStyle = m.teams[p.team].def.kit.shirt;
      c.beginPath(); c.arc(X(p.x), Z(p.z), p === m.human ? 6 : 4.5, 0, Math.PI * 2); c.fill();
      if (p === m.human) { c.strokeStyle = '#FFD400'; c.lineWidth = 2; c.stroke(); }
    }
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(X(m.ball.x), Z(m.ball.z), 3.5, 0, Math.PI * 2); c.fill();
  }

  drawDebug() {
    const m = this.m;
    const seen = new Set();
    for (const p of m.players) {
      if (!p.active || p.human) continue;
      seen.add(p.id);
      let el = this.labels.get(p.id);
      if (!el) { el = h('div', 'dbg-tag'); this.dbg.appendChild(el); this.labels.set(p.id, el); }
      const s = this.project(p.x, 2.3, p.z);
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      el.style.display = s.vis ? '' : 'none';
      const ai = p.ai;
      const opts = ai.state === 'ATTACK' && ai.options ? ai.options.slice(0, 3).map(o => `${o.label.toLowerCase()} ${o.u}`).join(' · ') : '';
      const pop = ai.pop ? `<em>${ai.pop.text}</em>` : '';
      const html = `<b style="--c:${m.teams[p.team].def.kit.shirt}">${ai.label || ai.state}</b>${pop}${opts ? `<small>${opts}</small>` : ''}`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }
}
