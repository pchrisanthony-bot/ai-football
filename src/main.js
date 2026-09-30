// =====================================================================
// STREETCAGE — game controller.
// Title (AI attract mode) → setup → kickoff flyover → match ⇄ replays → full time.
// Also: WATCH AI (spectator + debug overlay for the AI class) and TRICK-SHOT DRILL.
// =====================================================================
import * as THREE from 'three';
import { createRenderer } from './render/renderer.js';
import { buildVenue } from './render/venue.js';
import { FX } from './render/fx.js';
import { CameraRig } from './render/camera.js';
import { MatchView } from './render/matchview.js';
import { Match } from './sim/match.js';
import { SIM_DT, COURT } from './config.js';
import { Input } from './input/input.js';
import { HumanController } from './game/human.js';
import { Audio } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { Menu, titleScreen, TEAM_IDS, MODES, DIFFS, controlsPanel, statsPanel } from './ui/menus.js';
import { TEAMS } from './sim/players.js';
import { DRILL_VARIANTS, setupDrill as setupDrillCore } from './game/drill.js';
import { online, getTag, setTag, saveMatch, saveDrill, fetchBoards } from './net/leaderboard.js';

const view = document.getElementById('view');
const ui = document.getElementById('ui');
const loading = Object.assign(document.createElement('div'), { className: 'loading', textContent: 'STREETCAGE' });
ui.appendChild(loading);

const R = createRenderer(view);
const venue = buildVenue(R.scene, R.renderer);
const fx = new FX(R.scene);
const rig = new CameraRig(R.camera);
const input = new Input();
const audio = new Audio();
const hud = new HUD(ui);
const screens = document.createElement('div');
ui.appendChild(screens);

const settings = { home: 0, away: 1, mode: 1, diff: 1, gfx: 0 };
const GFX = ['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'ULTRA'];
R.quality.lights = venue.lights;

// ---- performance governor: pick the best quality that holds ~60 fps on this machine.
const perf = { acc: [], cap: 3 };
{
  const gl = R.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
  const integrated = /Intel|Iris|UHD|HD Graphics|Mali|Adreno|Apple GPU|SwiftShader|llvmpipe/i.test(gpu);
  R.setQuality(integrated ? 1 : 2);
  perf.gpu = gpu;
}
function governor(dtReal) {
  if (settings.gfx !== 0 || document.hidden || G.manual) return;
  perf.acc.push(dtReal);
  if (perf.acc.length < 150) return;
  const sorted = perf.acc.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length * 0.6)] * 1000;
  perf.acc = [];
  const lvl = R.quality.level;
  const menu = ['title', 'setup', 'controls'].includes(G.state);
  if (med > (menu ? 18 : 26) && lvl > 0) { perf.cap = lvl - 1; R.setQuality(lvl - 1); }
  else if (menu && med < 11 && lvl < perf.cap) R.setQuality(lvl + 1);
}
function applyGfx() { if (settings.gfx > 0) R.setQuality(settings.gfx - 1); else perf.cap = 3; }
const G = {
  state: 'title', match: null, mview: null, human: null, acc: 0, t: 0, stateT: 0,
  menu: null, screenEl: null, drill: null, spectate: false,
};

// ------------------------------------------------------------------ helpers
function clearScreens() { G.menu?.destroy(); G.menu = null; screens.innerHTML = ''; }
function addScreen(cls = 'screen') { const el = document.createElement('div'); el.className = cls; screens.appendChild(el); return el; }
function nav() { audio.ui(); }

function startMatchObject(opts, humanTeam) {
  G.mview?.dispose();
  const m = new Match({ humanTeam, ...opts });
  G.match = m;
  G.mview = new MatchView({ scene: R.scene, renderer: R.renderer, venue, fx, audio, rig, hud }, m);
  G.human = humanTeam == null ? null : new HumanController(m, humanTeam, input);
  G.acc = 0;
  hud.bind(m, R.camera);
  return m;
}

// ------------------------------------------------------------------ states
function toTitle() {
  clearScreens();
  G.state = 'title'; G.stateT = 0; G.spectate = false; G.drill = null;
  // Attract mode: two AI sides play behind the menu.
  const ids = TEAM_IDS;
  const hi = Math.floor(Math.random() * ids.length);
  const ai = (hi + 1 + Math.floor(Math.random() * (ids.length - 1))) % ids.length;
  startMatchObject({ home: ids[hi], away: ids[ai], seconds: 600, difficulty: 0.7, seed: Math.floor(Math.random() * 1e6) }, null);
  hud.hide();
  const scr = addScreen('screen');
  titleScreen(scr);
  G.menu = new Menu(scr, {
    items: [
      { label: 'PLAY MATCH', action: toSetup },
      { label: 'WATCH AI  ·  CLASS DEMO', action: () => toSetup(true) },
      { label: 'TRICK-SHOT DRILL', action: toDrill },
      { label: 'LEADERBOARDS', action: () => toBoards() },
      { label: `PLAYER TAG  ·  ${getTag() || 'NOT SET'}`, action: () => askTag(toTitle) },
      { label: 'CONTROLS', action: toControls },
    ],
    footer: `Arrows / D-pad to move · Enter / A to select${online() ? '' : ' · leaderboards offline'}`,
  });
  G.menu.onNav = nav;
  audio.music(true);
  audio.setCrowd(0.02);
}

function toControls() {
  clearScreens();
  G.state = 'controls';
  const scr = addScreen('screen dim');
  G.menu = new Menu(scr, { cls: 'center', title: 'CONTROLS', subtitle: 'KEYBOARD · GAMEPAD', items: [{ label: 'BACK', action: toTitle }], side: controlsPanel() });
  G.menu.onNav = nav;
}

function toSetup(spectate = false) {
  clearScreens();
  G.state = 'setup';
  G.spectate = spectate;
  const scr = addScreen('screen dim');
  const teamOpts = TEAM_IDS.map(id => ({ label: TEAMS[id].name }));
  const items = [
    { label: spectate ? 'HOME' : 'YOUR TEAM', options: teamOpts, value: settings.home, onChange: v => settings.home = v, swatch: v => TEAMS[TEAM_IDS[v]].kit.shirt },
    { label: 'OPPONENT', options: teamOpts, value: settings.away, onChange: v => settings.away = v, swatch: v => TEAMS[TEAM_IDS[v]].kit.shirt },
    { label: 'MATCH', options: MODES, value: settings.mode, onChange: v => settings.mode = v },
    { label: 'AI LEVEL', options: DIFFS, value: settings.diff, onChange: v => settings.diff = v },
    { label: 'GRAPHICS', options: GFX, value: settings.gfx, onChange: v => { settings.gfx = v; applyGfx(); } },
    { label: spectate ? 'WATCH  ▶' : 'KICK OFF  ▶', action: () => startMatch() },
    { label: 'BACK', action: toTitle },
  ];
  G.menu = new Menu(scr, { cls: 'center', title: spectate ? 'WATCH AI' : 'MATCH SETUP', subtitle: spectate ? 'AI VS AI · DEBUG OVERLAY ON' : 'ROOFTOP CAGE · NIGHT', items });
  G.menu.onNav = nav;
}

function startMatch() {
  clearScreens();
  if (settings.home === settings.away) settings.away = (settings.away + 1) % TEAM_IDS.length;
  const md = MODES[settings.mode];
  startMatchObject({
    home: TEAM_IDS[settings.home], away: TEAM_IDS[settings.away], mode: md.mode, seconds: md.seconds || 9999, firstTo: md.firstTo || 5,
    difficulty: DIFFS[settings.diff].v, seed: Math.floor(Math.random() * 1e6),
  }, G.spectate ? null : 0);
  hud.show();
  hud.setDebug(G.spectate);
  hud.setSpectate(G.spectate);
  G.state = 'intro'; G.stateT = 0;
  audio.music(false);
  audio.setCrowd(0.05);
}

function toPause() {
  if (G.state !== 'match') return;
  G.state = 'paused';
  const scr = addScreen('screen dim');
  const items = [
    { label: 'RESUME', action: resume },
    { label: 'AI DEBUG OVERLAY', options: ['OFF', 'ON'], value: hud.debug ? 1 : 0, onChange: v => hud.setDebug(!!v) },
    { label: 'GRAPHICS', options: GFX, value: settings.gfx, onChange: v => { settings.gfx = v; applyGfx(); } },
    { label: 'TRICK-SHOT DRILL', action: toDrill },
    { label: 'QUIT TO MENU', action: () => { leaveDrill(); toTitle(); } },
  ];
  G.menu = new Menu(scr, { cls: 'center', title: 'PAUSED', items, side: controlsPanel() });
  G.menu.onNav = nav;
}
function resume() { clearScreens(); G.state = 'match'; }

function toFullTime() {
  G.state = 'fulltime'; G.stateT = 0;
  // Post the human's result to the online leaderboard.
  G.post = null;
  if (G.human && !G.spectate && !G.drill && online()) {
    const tag = getTag();
    G.post = tag ? { status: 'POSTING RESULT…' } : { status: 'SET A PLAYER TAG TO POST THIS RESULT ONLINE', needsTag: true };
    if (tag) postResult(tag);
  }
  setTimeout(() => { if (G.state === 'fulltime') showFullTimeMenu(); }, 2200);
  audio.setCrowd(0.12);
}

function postResult(tag) {
  G.post = { status: 'POSTING RESULT…' };
  saveMatch(G.match, 0, tag, DIFFS[settings.diff].label).then(r => {
    G.post = { status: r.ok ? `RESULT POSTED AS ${tag} ✓` : `COULD NOT POST (${r.reason === 'offline' ? 'offline' : 'network'})` };
    if (G.state === 'fulltime' && G.menu) showFullTimeMenu();
  });
}

function showFullTimeMenu() {
  clearScreens();
  const m = G.match;
  const w = m.winner();
  const title = w < 0 ? 'DRAW' : `${m.teams[w].def.name} WIN`;
  const scr = addScreen('screen dim');
  const items = [{ label: 'REMATCH', action: () => startMatch() }];
  if (G.post && G.post.needsTag) {
    items.push({ label: 'SET TAG & POST RESULT', action: () => askTag(() => { G.state = 'fulltime'; const t = getTag(); if (t) postResult(t); showFullTimeMenu(); }) });
  }
  items.push({ label: 'LEADERBOARDS', action: () => toBoards(() => { G.state = 'fulltime'; showFullTimeMenu(); }) });
  items.push({ label: 'MAIN MENU', action: toTitle });
  G.menu = new Menu(scr, {
    cls: 'center', title, subtitle: `FULL TIME · ${m.teams[0].score} – ${m.teams[1].score}`,
    items, side: statsPanel(m), footer: G.post ? G.post.status : '',
  });
  G.menu.onNav = nav;
  // stats sit above the buttons
  G.menu.el.insertBefore(G.menu.el.querySelector('.stats'), G.menu.list);
}

// ------------------------------------------------------------------ online: tag entry + leaderboards
function askTag(done) {
  clearScreens();
  G.state = 'tag';
  const scr = addScreen('screen dim');
  const box = document.createElement('div');
  box.className = 'menu center tag-entry interactive';
  box.innerHTML = `<div class="menu-title">PLAYER TAG</div><div class="menu-sub">2–16 LETTERS, NUMBERS, SPACE . _ -  ·  SHOWN ON THE LEADERBOARDS</div>
    <input class="tag-input" maxlength="16" spellcheck="false" autocomplete="off" placeholder="YOUR TAG">
    <div class="menu-foot"><kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel</div><div class="tag-err"></div>`;
  scr.appendChild(box);
  const inp = box.querySelector('input'), err = box.querySelector('.tag-err');
  inp.value = getTag() || '';
  setTimeout(() => inp.focus(), 30);
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const t = setTag(inp.value);
      if (!t) { err.textContent = 'Use 2–16 letters, numbers, space . _ -'; return; }
      audio.ui(); done();
    } else if (e.key === 'Escape') { audio.uiBack(); done(); }
  });
}

function toBoards(back = toTitle) {
  clearScreens();
  G.state = 'boards';
  const scr = addScreen('screen dim');
  const panel = document.createElement('div');
  panel.className = 'boards';
  panel.innerHTML = `<div class="boards-msg">${online() ? 'LOADING…' : 'LEADERBOARDS ARE OFFLINE (no Supabase config)'}</div>`;
  G.menu = new Menu(scr, {
    cls: 'center wide', title: 'LEADERBOARDS', subtitle: 'ROOFTOP CAGE · ONLINE',
    items: [{ label: 'REFRESH', action: () => loadBoards(panel) }, { label: 'BACK', action: back }], side: panel,
  });
  G.menu.onNav = nav;
  G.menu.el.insertBefore(panel, G.menu.list);
  if (online()) loadBoards(panel);
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function loadBoards(panel) {
  panel.innerHTML = '<div class="boards-msg">LOADING…</div>';
  fetchBoards().then(r => {
    if (!r.ok) { panel.innerHTML = `<div class="boards-msg">COULD NOT LOAD LEADERBOARDS (${esc(r.reason)})</div>`; return; }
    const me = getTag();
    const row = (cells, tag) => `<tr class="${tag && tag === me ? 'me' : ''}">${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
    const empty = n => `<tr><td colspan="${n}" class="empty">No entries yet — be the first.</td></tr>`;
    panel.innerHTML = `
      <div class="board"><h3>TOP PLAYERS</h3><table><tr><th>#</th><th>TAG</th><th>P</th><th>W-D-L</th><th>GLS</th><th>CAGE</th><th>PTS</th></tr>
        ${r.players.length ? r.players.map((p, i) => row([i + 1, esc(p.player_tag), p.played, `${p.wins}-${p.draws}-${p.losses}`, p.goals, p.cage_goals, `<b>${p.points}</b>`], p.player_tag)).join('') : empty(7)}</table></div>
      <div class="board"><h3>TRICK-SHOT DRILL</h3><table><tr><th>#</th><th>TAG</th><th>CAGE GOALS</th><th>GOALS</th><th>ACC</th></tr>
        ${r.drill.length ? r.drill.map((d, i) => row([i + 1, esc(d.player_tag), `<b>${d.cage_goals}</b>`, `${d.goals}/${d.attempts}`, d.accuracy + '%'], d.player_tag)).join('') : empty(5)}</table></div>
      <div class="board"><h3>LATEST RESULTS</h3><table>
        ${r.recent.length ? r.recent.map(x => row([`<span class="res res-${x.result}">${x.result}</span>`, esc(x.player_tag), `${esc(x.team)} ${x.goals_for}–${x.goals_against} ${esc(x.opponent)}`, x.cage_goals ? `${x.cage_goals} cage` : ''], x.player_tag)).join('') : empty(4)}</table></div>`;
  });
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = text;
  ui.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3200);
}

// Leaving the drill posts the run (if the player has a tag and took shots).
function leaveDrill() {
  const d = G.drill;
  if (!d) return;
  if (d.panel) d.panel.remove();
  const tag = getTag();
  if (tag && d.attempts > 0) saveDrill(tag, d).then(r => toast(r.ok ? `Drill run posted: ${d.cage} cage goals from ${d.attempts} attempts ✓` : `Drill run not posted (${r.reason === 'offline' ? 'offline' : 'network'})`));
  else if (d.attempts > 0 && online()) toast('Set a PLAYER TAG on the title screen to post drill runs');
}

// ------------------------------------------------------------------ trick-shot drill
function toDrill() {
  clearScreens();
  startMatchObject({ home: 'cage', away: 'rooftop', mode: 'drill', seconds: 99999, difficulty: 0.6, seed: 7 }, 0);
  hud.show(); hud.setDebug(false); hud.setSpectate(false);
  G.drill = { attempts: 0, goals: 0, cage: 0, shotT: null, panel: null };
  const panel = document.createElement('div');
  panel.className = 'drill-panel';
  ui.appendChild(panel);
  G.drill.panel = panel;
  setupDrill();
  G.state = 'match';
  audio.music(false);
  hud.big('TRICK-SHOT DRILL', 'Lane blocked — hold K and aim at the FAR wall: it comes back behind the keeper', 3200);
}

function setupDrill() {
  const m = G.match, d = G.drill;
  const v = DRILL_VARIANTS[d.attempts % DRILL_VARIANTS.length];
  const { shooter } = setupDrillCore(m, v);
  m.human = null;                 // reset clears every human flag; re-register the shooter
  G.human.setHuman(shooter);
  d.shotT = null;
  updateDrillPanel();
}

function updateDrillPanel() {
  const d = G.drill;
  d.panel.innerHTML = `CAGE GOALS <b>${d.cage}</b><br>GOALS ${d.goals} / ATTEMPTS ${d.attempts}<br><small><kbd>T</kbd> reset · <kbd>Esc</kbd> menu</small>`;
}

function drillTick(dt, events) {
  const m = G.match, d = G.drill, b = m.ball;
  for (const e of events) {
    if (e.type === 'kick' && e.kind === 'shot') d.shotT = 0;
    if (e.type === 'goal') { d.goals++; if (e.cage) d.cage++; updateDrillPanel(); }
  }
  if (d.shotT != null) {
    d.shotT += dt;
    const settled = !b.owner && Math.hypot(b.vx, b.vz) < 0.6 && b.y < 0.2;
    if ((d.shotT > 1.2 && (settled || b.owner)) || d.shotT > 4) { d.attempts++; setupDrill(); }
  }
  if (input.pressed('drill')) setupDrill();
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let crowdLevel = 0.05;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!G.manual) { tick(dt); governor(dt); }
  requestAnimationFrame(frame);
}

// One game frame. Split from rAF so tests can drive the game deterministically
// even when the tab is hidden: window.__tick(1/60, n).
function tick(dt) {
  G.t += dt; G.stateT += dt;
  input.update(dt);
  if (input.anyPressed()) audio.init();

  if (input.pressed('debug') && G.match && G.state !== 'title') hud.setDebug(!hud.debug);

  const m = G.match;
  switch (G.state) {
    case 'title': case 'setup': case 'controls': case 'boards': case 'tag': {
      stepMatch(dt, true);
      if (m.phase === 'fulltime') toTitle();
      rig.broadcast(dt, m.ball, null, 8);
      // slow drift for the attract camera
      R.camera.position.x += Math.sin(G.t * 0.15) * 3;
      G.menu?.handle(input);
      if (input.pressed('pause') && G.state !== 'title' && G.state !== 'tag') { audio.uiBack(); toTitle(); }
      break;
    }
    case 'intro': {
      const u = Math.min(1, G.stateT / 2.4);
      rig.intro(dt, 1 - Math.pow(1 - u, 3));
      G.mview.update(dt, G.human);
      if (G.stateT > 2.4 || (G.stateT > 0.3 && input.anyPressed())) {
        G.state = 'match';
        rig.focus.set(m.ball.x, 0, m.ball.z); rig.fVel.set(0, 0, 0);
        hud.big('KICK OFF', `${m.teams[0].def.name} vs ${m.teams[1].def.name}`, 1100);
      }
      break;
    }
    case 'match': {
      if (input.pressed('pause')) {
        if (G.drill) { leaveDrill(); toTitle(); break; }
        toPause(); break;
      }
      G.human?.update(dt);
      const events = stepMatch(dt, false);
      if (G.drill) drillTick(dt, events);
      rig.broadcast(dt, m.ball, m.human, spread(m));
      if (m.phase === 'fulltime' && !G.drill) toFullTime();
      break;
    }
    case 'replay': {
      const going = G.mview.updateReplay(dt);
      if (!going || (G.stateT > 0.4 && input.anyPressed())) {
        G.mview.endReplay();
        hud.setReplay(false);
        if (G.drill) { G.drill.attempts++; setupDrill(); G.state = 'match'; break; }
        m.resumeAfterGoal();
        m.drainEvents().forEach(e => e.type === 'whistle' && audio.whistle(true));
        if (m.phase === 'fulltime') { toFullTime(); break; }
        G.state = 'match';
        rig.focus.set(0, 0, 0);
      }
      break;
    }
    case 'paused':
      G.menu?.handle(input);
      if (input.pressed('pause')) { audio.uiBack(); resume(); }
      rig.broadcast(0, m.ball, m.human, spread(m));
      break;
    case 'fulltime':
      stepMatch(dt, false);
      rig.orbit(dt, { x: 0, z: 0 }, G.t, 16, 7);
      G.menu?.handle(input);
      break;
  }

  // atmosphere
  if (m && (G.state === 'match' || G.state === 'intro')) {
    const b = m.ball;
    const nearGoal = Math.max(0, (Math.abs(b.x) - 9) / 7);
    crowdLevel += ((0.05 + nearGoal * 0.08) - crowdLevel) * dt * 2;
    audio.setCrowd(crowdLevel);
  }
  const gbTeam = m ? m.teams.find(t => t.gb > 0) : null;
  const gbU = R.grade.uniforms;
  gbU.uGB.value += ((gbTeam ? 1 : 0) - gbU.uGB.value) * Math.min(1, dt * 3);
  if (gbTeam) gbU.uGBColor.value.set(gbTeam.def.kit.trim);

  venue.update(G.t, R.camera);
  fx.update(dt);
  rig.apply(dt);
  if (G.match && !['title', 'setup', 'controls', 'boards', 'tag'].includes(G.state)) hud.update(dt, G.human);
  R.composer.render();
}

function spread(m) {
  let minX = Infinity, maxX = -Infinity;
  for (const p of m.players) if (p.active) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
  return maxX - minX;
}

// Advance the sim at a fixed 120 Hz and render-side view; returns this frame's events.
function stepMatch(dt, quiet) {
  const m = G.match;
  G.acc += dt;
  let n = 0;
  while (G.acc >= SIM_DT && n < 12) { m.step(SIM_DT); G.acc -= SIM_DT; n++; }
  if (n === 12) G.acc = 0;
  const events = m.drainEvents();
  if (quiet) {
    for (const e of events) if (e.type === 'goalDone') m.resumeAfterGoal();
    G.mview.update(dt, null);
    return events;
  }
  G.mview.handleEvents(events, hud);
  for (const e of events) {
    if (e.type === 'goal') hud.goal(e, m);
    if (e.type === 'goalDone') {
      if (G.mview.startReplay()) { G.state = 'replay'; G.stateT = 0; hud.setReplay(true); }
      else m.resumeAfterGoal();
    }
  }
  G.mview.update(dt, G.human);
  return events;
}

// ------------------------------------------------------------------ boot
fx.resize(innerHeight);
addEventListener('resize', () => fx.resize(innerHeight));
addEventListener('pointerdown', () => audio.init());
toTitle();
R.renderer.compile(R.scene, R.camera);
requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
setTimeout(() => { loading.style.opacity = 0; setTimeout(() => loading.remove(), 700); }, 400);
window.__G = G;
window.__R = R; window.__perf = perf;
window.__tick = (dt = 1 / 60, n = 1) => { G.manual = true; for (let i = 0; i < n; i++) tick(dt); };
window.__auto = () => { G.manual = false; };
