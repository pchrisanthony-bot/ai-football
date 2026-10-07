// =====================================================================
// The facade atlas: every window, door, shutter, shopfront, signboard, poster, mural and
// plate in the neighbourhood, painted once into one texture (and a half-size glow layer
// for night: lit windows, shops and boards). Decals on the buildings sample it — one
// material, one draw call for all of them.
// Fictional places and brands only; Marathi/Hindi signage with English.
// =====================================================================
import * as THREE from 'three';
import { rng, canvas } from './util.js';
import { star } from './surfaces.js';

const DEV = '"Nirmala UI", "Noto Sans Devanagari", "Kohinoor Devanagari", "Mangal", "Devanagari Sangam MN", sans-serif';
const BOLD = '"Arial Black", "Arial Bold", Impact, sans-serif';
const NARROW = '"Arial Narrow", "Roboto Condensed", Arial, sans-serif';
const HAND = '"Segoe Print", "Comic Sans MS", "Marker Felt", cursive';

let ATLAS = null;
export const atlas = () => ATLAS || (ATLAS = buildAtlas());

// ---------------------------------------------------------------- the items
// [name, width px, height px, draw(g, w, h, r), glow(g, w, h, r) | null]  (≈ 160 px per metre)
function items() {
  const L = [];
  const add = (name, w, h, draw, glow = null) => L.push({ name, w, h, draw, glow });
  // windows
  for (const [k, col] of [['g', '#2f6b4f'], ['b', '#2c5f8a'], ['w', '#d9d4c4'], ['r', '#7a3b2e']]) add('win_grill_' + k, 176, 208, (g, w, h, r) => winGrill(g, w, h, r, col), (g, w, h, r) => winGlow(g, w, h, r, 'warm'));
  for (const [k, cur] of [['pink', '#d9708f'], ['yellow', '#e7c04e'], ['blue', '#5a86c6'], ['maroon', '#7c2639']]) add('win_slide_' + k, 192, 192, (g, w, h, r) => winSlide(g, w, h, r, cur), (g, w, h, r) => winGlow(g, w, h, r, k === 'blue' ? 'cool' : 'lamp', cur));
  add('win_open', 160, 192, (g, w, h, r) => winOpen(g, w, h, r), (g, w, h, r) => winGlow(g, w, h, r, 'warm'));
  for (const [k, col] of [['teal', '#2f8f88'], ['brown', '#7a4a2a']]) add('win_louver_' + k, 160, 208, (g, w, h, r) => winLouver(g, w, h, r, col), (g, w, h, r) => louverGlow(g, w, h, r));
  add('win_dark', 128, 128, (g, w, h) => { g.fillStyle = '#1b1d22'; g.fillRect(0, 0, w, h); frame(g, 0, 0, w, h, 8, '#8d8a80'); });
  add('vent', 96, 72, (g, w, h, r) => vent(g, w, h, r));
  // doors
  for (const [k, cur] of [['red', '#b8323a'], ['green', '#2f8f5a'], ['purple', '#6b3b8f']]) add('door_curtain_' + k, 144, 336, (g, w, h, r) => doorCurtain(g, w, h, r, cur), (g, w, h, r) => { g.fillStyle = 'rgba(255,190,110,0.55)'; g.fillRect(w * 0.12, h * 0.05, w * 0.76, h * 0.95); });
  for (const [k, col] of [['blue', '#2e5f9e'], ['green', '#3d7a52']]) add('door_metal_' + k, 160, 336, (g, w, h, r) => doorMetal(g, w, h, r, col));
  // shutters and shopfronts
  add('shutter_closed', 416, 384, (g, w, h, r) => shutter(g, w, h, r, true));
  add('shutter_ad', 416, 384, (g, w, h, r) => shutter(g, w, h, r, true, 'SITARA CEMENT', 'मजबूत!'));
  add('shutter_top', 416, 112, (g, w, h, r) => shutter(g, w, h, r, false));
  for (const kind of ['tea', 'kirana', 'mobile', 'sports', 'barber', 'vadapav']) add('shop_' + kind, 416, 352, (g, w, h, r) => shop(g, w, h, r, kind), (g, w, h, r) => shopGlow(g, w, h, r, kind));
  // signboards
  const SIGNS = {
    tea: ['#f2c230', '#b3261e', 'राहुल टी स्टॉल', 'RAHUL TEA STALL · CUTTING CHAI'],
    sports: ['#1f4fa8', '#ffffff', 'सितारा स्पोर्ट्स', 'SITARA SPORTS · FOOTBALL · CRICKET'],
    mobile: ['#c62828', '#ffffff', 'गणेश मोबाईल', 'GANESH MOBILE · RECHARGE · REPAIRING'],
    kirana: ['#2e7d32', '#ffeb3b', 'साई कृपा किराणा स्टोअर्स', 'SAI KRUPA KIRANA STORES'],
    vadapav: ['#ef6c00', '#fffde7', 'जय मल्हार वडापाव', 'VADA PAV · BHAJI · CHAI'],
    barber: ['#f4f1ea', '#1d3c8f', 'स्टाईल कट्स', 'STYLE CUTS · GENTS PARLOUR'],
  };
  for (const [k, s] of Object.entries(SIGNS)) add('sign_' + k, 448, 96, (g, w, h, r) => signBoard(g, w, h, r, ...s, k), (g, w, h, r) => signGlow(g, w, h, r, ...s, k));
  // posters
  for (const kind of ['cup', 'tuition', 'garba', 'gym', 'dance', 'wishes', 'torn', 'blood']) add('poster_' + kind, 96, 136, (g, w, h, r) => poster(g, w, h, r, kind));
  // murals and wall paintings (≈ 128 px/m)
  add('mural_player', 576, 384, (g, w, h, r) => muralPlayer(g, w, h, r));
  add('mural_crest', 308, 308, (g, w, h, r) => muralCrest(g, w, h, r));
  add('mural_pattern', 512, 256, (g, w, h, r) => muralPattern(g, w, h, r));
  add('mural_kids', 384, 205, (g, w, h, r) => muralKids(g, w, h, r));
  add('wall_ad', 512, 154, (g, w, h, r) => wallAd(g, w, h, r, 'SITARA CEMENT', 'मजबूत घर · मजबूत पाया', '#c62828', '#f4efe2'));
  add('wall_clean', 512, 154, (g, w, h, r) => wallAd(g, w, h, r, 'KEEP OUR GULLY CLEAN', 'स्वच्छता राखा', '#1565c0', '#f4efe2'));
  add('scoreboard', 256, 160, (g, w, h, r) => scoreboard(g, w, h, r));
  add('meters', 176, 128, (g, w, h, r) => meters(g, w, h, r));
  add('danger', 72, 56, (g, w, h) => danger(g, w, h));
  add('plate_chawl', 88, 52, (g, w, h) => plate(g, w, h, 'चाळ क्र. ३', '#1f4fa8'));
  add('plate_nivas', 120, 44, (g, w, h) => plate(g, w, h, 'सितारा निवास', '#1f4fa8'));
  add('plate_num', 56, 40, (g, w, h) => plate(g, w, h, 'B-12', '#2f2f2f', BOLD));
  add('ac_front', 128, 80, (g, w, h, r) => acFront(g, w, h, r));
  add('banner_cup', 640, 128, (g, w, h, r) => banner(g, w, h, r, '#b3261e', 'MONSOON STREET CUP', 'SITARA GULLY 5-A-SIDE · FINALS SATURDAY 7 PM'));
  add('banner_club', 384, 102, (g, w, h, r) => banner(g, w, h, r, '#1f4fa8', 'SITARA GULLY F.C.', 'आपली गल्ली, आपला खेळ · OUR GULLY, OUR GAME'));
  add('grill', 128, 128, (g, w, h) => grillTile(g, w, h));
  add('kite', 32, 32, (g, w, h) => { g.fillStyle = '#e53935'; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.lineTo(0, h / 2); g.fill(); g.strokeStyle = '#ffd54f'; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); });
  for (const [k, f] of Object.entries(CLOTH)) add('cloth_' + k, 64, 64, f);
  add('stripes_rw', 64, 64, (g, w, h) => stripes(g, w, h, ['#c62828', '#f5f5f0']));
  add('stripes_by', 64, 64, (g, w, h) => stripes(g, w, h, ['#1565c0', '#f9d84a']));
  add('stripes_gw', 64, 64, (g, w, h) => stripes(g, w, h, ['#2e7d32', '#f5f5f0']));
  add('white', 16, 16, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); });
  add('lamp', 16, 16, (g, w, h) => { g.fillStyle = '#fff4d8'; g.fillRect(0, 0, w, h); }, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); });
  return L;
}

// ---------------------------------------------------------------- packing + painting
function buildAtlas() {
  const S = 2048, pad = 3;
  const list = items().sort((a, b) => b.h - a.h);
  const rects = {};
  let x = 0, y = 0, rowH = 0;
  for (const it of list) {
    if (x + it.w + pad > S) { x = 0; y += rowH + pad; rowH = 0; }
    rects[it.name] = { x, y, w: it.w, h: it.h };
    x += it.w + pad; rowH = Math.max(rowH, it.h);
  }
  if (y + rowH > S) console.warn('street atlas overflow', y + rowH);
  const c = canvas(S, S), g = c.getContext('2d');
  const e = canvas(S / 2, S / 2), eg = e.getContext('2d');
  g.clearRect(0, 0, S, S); eg.fillStyle = '#000'; eg.fillRect(0, 0, S / 2, S / 2);
  let seed = 1;
  for (const it of list) {
    const R = rects[it.name];
    g.save(); g.beginPath(); g.rect(R.x, R.y, R.w, R.h); g.clip(); g.translate(R.x, R.y);
    it.draw(g, R.w, R.h, rng(seed * 7919 + 13)); g.restore();
    if (it.glow) { eg.save(); eg.scale(0.5, 0.5); eg.beginPath(); eg.rect(R.x, R.y, R.w, R.h); eg.clip(); eg.translate(R.x, R.y); it.glow(eg, R.w, R.h, rng(seed * 7919 + 13)); eg.restore(); }
    seed++;
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const glow = new THREE.CanvasTexture(e); glow.colorSpace = THREE.SRGBColorSpace;
  // uv rect (glTF-free: plain canvas, flipY on) for each item
  const uv = {};
  for (const [k, R] of Object.entries(rects)) uv[k] = { u0: (R.x + 0.5) / S, u1: (R.x + R.w - 0.5) / S, v0: 1 - (R.y + R.h - 0.5) / S, v1: 1 - (R.y + 0.5) / S, w: R.w, h: R.h };
  return { map, glow, uv, canvas: c };
}

// ---------------------------------------------------------------- painting helpers
function frame(g, x, y, w, h, t, col) { g.fillStyle = col; g.fillRect(x, y, w, t); g.fillRect(x, y + h - t, w, t); g.fillRect(x, y, t, h); g.fillRect(x + w - t, y, t, h); }
function speckle(g, w, h, r, n = 120, col = 'rgba(0,0,0,0.12)', s = 2) { g.fillStyle = col; for (let i = 0; i < n; i++) g.fillRect(r() * w, r() * h, s * (0.5 + r()), s * (0.5 + r())); }
function runs(g, w, h, r, n = 6, a = 0.16) {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y0 = r() * h * 0.5, len = h * (0.2 + r() * 0.6);
    const gr = g.createLinearGradient(0, y0, 0, y0 + len); gr.addColorStop(0, `rgba(40,32,24,${a})`); gr.addColorStop(1, 'rgba(40,32,24,0)');
    g.fillStyle = gr; g.fillRect(x, y0, 2 + r() * 5, len);
  }
}
function fitText(g, text, x, y, maxW, size, font, weight = 900) {
  let s = size; g.font = `${weight} ${s}px ${font}`;
  while (g.measureText(text).width > maxW && s > 6) { s -= 1; g.font = `${weight} ${s}px ${font}`; }
  g.fillText(text, x, y);
  return s;
}
function peel(g, w, h, r, n, col = 'rgba(190,184,170,0.9)') {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) { const x = r() * w, y = r() * h, s = 3 + r() * 14; g.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; g.lineTo(x + Math.cos(a) * s * (0.5 + r()), y + Math.sin(a) * s * (0.4 + r() * 0.7)); } g.fill(); }
}

// ---------------------------------------------------------------- windows
function interior(g, x, y, w, h, r, warm = 0) {
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#14161a'); gr.addColorStop(1, '#262420');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  // a hint of a room: a shelf line, a hanging cloth
  g.fillStyle = 'rgba(80,70,60,0.35)'; g.fillRect(x + w * 0.1, y + h * 0.35, w * 0.8, 3);
  if (r() < 0.6) { g.fillStyle = ['rgba(150,60,60,0.5)', 'rgba(60,100,150,0.5)', 'rgba(170,150,60,0.5)'][Math.floor(r() * 3)]; g.fillRect(x + w * (0.2 + r() * 0.5), y + h * 0.36, w * 0.18, h * 0.3); }
}
function glass(g, x, y, w, h) {
  const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, 'rgba(170,190,205,0.55)'); gr.addColorStop(0.45, 'rgba(70,85,100,0.35)'); gr.addColorStop(1, 'rgba(140,160,175,0.45)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}
function winGrill(g, w, h, r, col) {
  interior(g, 0, 0, w, h, r);
  glass(g, 10, 10, w / 2 - 12, h - 26); glass(g, w / 2 + 2, 10, w / 2 - 12, h - 26);
  frame(g, 0, 0, w, h - 10, 9, col); g.fillStyle = col; g.fillRect(w / 2 - 3, 0, 6, h - 10);
  // ornamental grill: bars, two rails and an arch band
  g.strokeStyle = shade(col, -0.35); g.lineWidth = 3;
  for (let x = 16; x < w - 8; x += 16) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, h - 16); g.stroke(); }
  for (const yy of [h * 0.32, h * 0.64]) { g.beginPath(); g.moveTo(6, yy); g.lineTo(w - 6, yy); g.stroke(); }
  for (let x = 16; x < w - 16; x += 32) { g.beginPath(); g.arc(x + 8, h * 0.32, 8, Math.PI, 0); g.stroke(); g.beginPath(); g.arc(x + 8, h * 0.64, 8, 0, Math.PI); g.stroke(); }
  // sill
  g.fillStyle = '#b8b2a4'; g.fillRect(-2, h - 12, w + 4, 12);
  runs(g, w, h, r, 3, 0.12); speckle(g, w, h, r, 60);
}
function winSlide(g, w, h, r, cur) {
  interior(g, 0, 0, w, h, r);
  // curtains, half drawn
  const cw = w * (0.3 + r() * 0.15);
  g.fillStyle = cur; g.fillRect(8, 8, cw, h - 22);
  g.fillStyle = shade(cur, -0.2); for (let x = 12; x < cw; x += 10) g.fillRect(x, 8, 3, h - 22);
  g.fillStyle = cur; g.fillRect(w - 8 - cw * 0.6, 8, cw * 0.6, h - 22);
  glass(g, 8, 8, w - 16, h - 22);
  frame(g, 0, 0, w, h - 12, 8, '#a9adb0'); g.fillStyle = '#a9adb0'; g.fillRect(w * 0.48, 0, 7, h - 12);
  g.fillStyle = '#b8b2a4'; g.fillRect(-2, h - 14, w + 4, 14);
  speckle(g, w, h, r, 50);
}
function winOpen(g, w, h, r) {
  interior(g, 0, 0, w, h, r);
  g.fillStyle = 'rgba(30,30,30,0.6)'; g.fillRect(w * 0.35, h * 0.2, w * 0.3, h * 0.04);       // a fan blade, a shadow
  g.strokeStyle = '#3a3a3a'; g.lineWidth = 3;
  for (let x = 14; x < w - 6; x += 14) { g.beginPath(); g.moveTo(x, 4); g.lineTo(x, h - 16); g.stroke(); }
  frame(g, 0, 0, w, h - 12, 7, '#6b4a2f');
  g.fillStyle = '#b8b2a4'; g.fillRect(-2, h - 14, w + 4, 14);
  // a shirt on a hanger at the window
  g.fillStyle = ['#e0e0e0', '#5d8fd6', '#d94f4f'][Math.floor(r() * 3)];
  g.beginPath(); g.moveTo(w * 0.62, h * 0.25); g.lineTo(w * 0.86, h * 0.25); g.lineTo(w * 0.9, h * 0.38); g.lineTo(w * 0.82, h * 0.4); g.lineTo(w * 0.82, h * 0.7); g.lineTo(w * 0.66, h * 0.7); g.lineTo(w * 0.66, h * 0.4); g.lineTo(w * 0.58, h * 0.38); g.fill();
}
function winLouver(g, w, h, r, col) {
  g.fillStyle = col; g.fillRect(0, 0, w, h);
  for (let y = 10; y < h - 18; y += 9) { g.fillStyle = shade(col, -0.3); g.fillRect(8, y + 5, w - 16, 3); g.fillStyle = shade(col, 0.12); g.fillRect(8, y, w - 16, 2); }
  g.fillStyle = shade(col, -0.45); g.fillRect(w / 2 - 2, 0, 4, h - 12);
  frame(g, 0, 0, w, h - 12, 7, shade(col, -0.2));
  g.fillStyle = '#b8b2a4'; g.fillRect(-2, h - 12, w + 4, 12);
  peel(g, w, h * 0.8, r, 10, 'rgba(170,160,140,0.8)'); runs(g, w, h, r, 4); speckle(g, w, h, r, 80);
}
function winGlow(g, w, h, r, kind, tint) {
  // warm bulbs, a CFL behind a curtain, or a cool tube light — not every room the same
  const warm = kind === 'warm', cool = kind === 'cool';
  const gr = g.createRadialGradient(w * 0.5, h * 0.3, 4, w * 0.5, h * 0.45, h * 0.7);
  gr.addColorStop(0, warm ? 'rgba(255,214,140,1)' : cool ? 'rgba(205,222,245,1)' : 'rgba(255,236,196,1)');
  gr.addColorStop(1, warm ? 'rgba(200,120,50,0.6)' : cool ? 'rgba(120,150,195,0.5)' : 'rgba(215,160,90,0.55)');
  g.fillStyle = gr; g.fillRect(8, 8, w - 16, h - 24);
  if (tint) { g.fillStyle = tint; g.globalAlpha = 0.7; g.fillRect(8, 8, w * 0.42, h - 22); g.globalAlpha = 1; }
  g.strokeStyle = '#000'; g.lineWidth = 6; for (let x = 16; x < w - 8; x += 16) { if (kind === 'warm') { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, h - 16); g.stroke(); } }
}
function louverGlow(g, w, h) { for (let y = 15; y < h - 18; y += 9) { g.fillStyle = 'rgba(255,190,110,0.8)'; g.fillRect(10, y, w - 20, 2); } }
function vent(g, w, h, r) {
  g.fillStyle = '#2b2a28'; g.fillRect(0, 0, w, h); frame(g, 0, 0, w, h, 6, '#9a958a');
  g.strokeStyle = '#555'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2, h * 0.32, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 3; k++) { g.save(); g.translate(w / 2, h / 2); g.rotate(k * 2.1 + r()); g.fillStyle = '#6a6a6a'; g.fillRect(0, -3, h * 0.28, 6); g.restore(); }
}

// ---------------------------------------------------------------- doors
function doorCurtain(g, w, h, r, cur) {
  g.fillStyle = '#7b6a55'; g.fillRect(0, 0, w, h);                                         // frame
  interior(g, 10, 10, w - 20, h - 10, r);
  // a printed curtain across the doorway, tied up a little on one side
  g.fillStyle = cur; g.beginPath(); g.moveTo(10, 14); g.lineTo(w - 10, 14); g.lineTo(w - 10, h * 0.86); g.quadraticCurveTo(w * 0.5, h * 0.92, w * 0.32, h * 0.74); g.lineTo(10, h * 0.94); g.fill();
  g.fillStyle = shade(cur, 0.35);
  for (let y = 30; y < h * 0.85; y += 26) for (let x = 20 + (y % 52 ? 0 : 12); x < w - 18; x += 24) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = shade(cur, -0.25); for (let x = 16; x < w - 12; x += 14) g.fillRect(x, 14, 2, h * 0.7);
  g.fillStyle = '#9b927f'; g.fillRect(0, h - 6, w, 6);                                          // threshold
  speckle(g, w, h, r, 40);
}
function doorMetal(g, w, h, r, col) {
  g.fillStyle = col; g.fillRect(0, 0, w, h);
  g.strokeStyle = shade(col, -0.3); g.lineWidth = 4; g.strokeRect(14, 14, w - 28, h * 0.42); g.strokeRect(14, h * 0.5, w - 28, h * 0.44);
  g.fillStyle = shade(col, -0.4); for (const [x, y] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#c9c4b5'; g.fillRect(w - 26, h * 0.5, 8, 22);                                    // latch
  g.fillStyle = '#e8e2c8'; g.fillRect(w / 2 - 14, h * 0.2, 28, 18); g.fillStyle = '#222'; g.font = `700 12px ${BOLD}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(10 + Math.floor(r() * 30)), w / 2, h * 0.2 + 9);
  peel(g, w, h, r, 16); runs(g, w, h, r, 6, 0.22); speckle(g, w, h, r, 120);
}

// ---------------------------------------------------------------- shutters, shopfronts
function shutter(g, w, h, r, full, ad = null, adSub = null) {
  g.fillStyle = '#8c9196'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y + 6, w, 2); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, y, w, 1); }
  if (ad) {
    g.fillStyle = 'rgba(198,40,40,0.82)'; g.fillRect(w * 0.08, h * 0.18, w * 0.84, h * 0.34);
    g.fillStyle = '#f4efe2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, ad, w / 2, h * 0.3, w * 0.78, 54, BOLD); fitText(g, adSub, w / 2, h * 0.44, w * 0.6, 34, DEV, 700);
  } else {
    g.save(); g.translate(w * 0.5, h * 0.42); g.rotate(-0.08); g.fillStyle = 'rgba(30,160,210,0.7)'; g.textAlign = 'center';
    fitText(g, 'GULLY KINGS', 0, 0, w * 0.7, 48, BOLD); g.restore();
  }
  if (full) { g.fillStyle = '#5a5e62'; g.fillRect(0, h - 18, w, 18); g.fillStyle = '#c8a02c'; g.fillRect(w * 0.48, h - 30, 18, 22); }
  runs(g, w, h, r, 10, 0.25); speckle(g, w, h, r, 200, 'rgba(60,40,20,0.2)');
}
function shop(g, w, h, r, kind) {
  const back = { tea: '#e6c46a', kirana: '#d9d2c0', mobile: '#e9eef2', sports: '#3f6fb5', barber: '#e8e4dc', vadapav: '#f0b35a' }[kind];
  g.fillStyle = back; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, 20);                                  // shade under the shutter
  const shelf = (y) => { g.fillStyle = '#6d5a43'; g.fillRect(14, y, w - 28, 6); };
  if (kind === 'kirana') {
    for (let row = 0; row < 4; row++) {
      const y = 36 + row * 52; shelf(y + 42);
      for (let x = 18; x < w - 22; x += 12 + r() * 10) { g.fillStyle = `hsl(${Math.floor(r() * 360)},${50 + r() * 40}%,${40 + r() * 25}%)`; const hh = 18 + r() * 22; g.fillRect(x, y + 42 - hh, 9 + r() * 8, hh); }
    }
    // strings of snack sachets across the top
    for (let s = 0; s < 6; s++) { const x0 = 20 + s * 66; for (let k = 0; k < 8; k++) { g.fillStyle = `hsl(${(s * 57 + k * 13) % 360},80%,55%)`; g.fillRect(x0, 26 + k * 13, 16, 11); } }
    sacks(g, w, h, r);
  } else if (kind === 'tea' || kind === 'vadapav') {
    shelf(120); for (let x = 30; x < w - 40; x += 34) { g.fillStyle = 'rgba(220,235,240,0.7)'; g.fillRect(x, 90, 22, 30); g.fillStyle = ['#c98a3a', '#e8c070', '#b0602a'][Math.floor(r() * 3)]; g.fillRect(x + 3, 102, 16, 16); }
    // menu board
    g.fillStyle = '#2b2b2b'; g.fillRect(w * 0.62, 26, w * 0.32, 60); g.fillStyle = '#f4efe2'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.font = `700 13px ${DEV}`; g.fillText(kind === 'tea' ? 'चहा   ₹10' : 'वडापाव ₹15', w * 0.64, 30); g.fillText(kind === 'tea' ? 'कटिंग  ₹8' : 'भजी    ₹20', w * 0.64, 48); g.fillText('कॉफी  ₹15', w * 0.64, 66);
    // the counter, a big kettle on the stove, glasses on a tray
    g.fillStyle = '#9aa3a8'; g.fillRect(0, h - 120, w, 120); g.fillStyle = '#c4ccd0'; g.fillRect(0, h - 120, w, 10);
    g.fillStyle = '#b0b6b9'; g.beginPath(); g.ellipse(w * 0.28, h - 150, 34, 30, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#80878b'; g.fillRect(w * 0.28 - 30, h - 128, 60, 10);
    for (let k = 0; k < 7; k++) { g.fillStyle = 'rgba(210,150,80,0.9)'; g.fillRect(w * 0.5 + k * 13, h - 140, 9, 16); }
    if (kind === 'vadapav') for (let k = 0; k < 9; k++) { g.fillStyle = '#d18b2c'; g.beginPath(); g.arc(w * 0.12 + (k % 3) * 22, h - 140 - Math.floor(k / 3) * 14, 9, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'mobile') {
    g.fillStyle = '#c62828'; g.fillRect(14, 22, w - 28, 34); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'RECHARGE · SIM · ACCESSORIES', w / 2, 39, w * 0.8, 20, NARROW, 700);
    for (let row = 0; row < 3; row++) for (let x = 22; x < w - 30; x += 26) { g.fillStyle = `hsl(${Math.floor(r() * 360)},70%,55%)`; g.fillRect(x, 70 + row * 44, 18, 34); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + 4, 76 + row * 44, 10, 20); }
    g.fillStyle = 'rgba(190,220,235,0.6)'; g.fillRect(0, h - 110, w, 110); g.fillStyle = '#7d8a90'; g.fillRect(0, h - 110, w, 6);
  } else if (kind === 'sports') {
    for (let k = 0; k < 9; k++) { const x = 40 + (k % 5) * 76, y = 40 + Math.floor(k / 5) * 70; g.fillStyle = '#f2f2f2'; g.beginPath(); g.arc(x, y, 24, 0, Math.PI * 2); g.fill(); g.fillStyle = '#222'; star(g, x, y, 8, 4); g.strokeStyle = 'rgba(200,200,200,0.8)'; g.lineWidth = 1; g.strokeRect(x - 26, y - 26, 52, 52); }
    for (let k = 0; k < 5; k++) { const x = 30 + k * 76, y = 180; g.fillStyle = ['#c62828', '#f9d84a', '#1565c0', '#2e7d32', '#ffffff'][k]; g.fillRect(x, y, 56, 64); g.fillRect(x - 12, y, 80, 18); g.fillStyle = 'rgba(0,0,0,0.6)'; g.font = `900 26px ${BOLD}`; g.textAlign = 'center'; g.fillText(String([7, 10, 9, 11, 1][k]), x + 28, y + 44); }
    g.fillStyle = '#c8a46a'; for (let k = 0; k < 4; k++) g.fillRect(w - 60 + k * 12, h - 150, 8, 130);
  } else if (kind === 'barber') {
    g.fillStyle = 'rgba(200,225,235,0.9)'; g.fillRect(40, 40, w - 80, 120); g.strokeStyle = '#8d6e4f'; g.lineWidth = 8; g.strokeRect(40, 40, w - 80, 120);
    g.fillStyle = '#2b2b2b'; g.fillRect(w * 0.3, h - 150, w * 0.4, 90); g.fillStyle = '#7a1f1f'; g.fillRect(w * 0.32, h - 175, w * 0.36, 40);
    for (let k = 0; k < 6; k++) { g.fillStyle = `hsl(${k * 60},60%,50%)`; g.fillRect(60 + k * 22, 175, 12, 26); }
  }
  runs(g, w, h, r, 4, 0.12); speckle(g, w, h, r, 80, 'rgba(0,0,0,0.1)');
}
function sacks(g, w, h, r) { for (let k = 0; k < 4; k++) { g.fillStyle = '#efe9da'; g.beginPath(); g.ellipse(40 + k * 52, h - 30, 24, 32, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(160,40,40,0.6)'; g.fillRect(28 + k * 52, h - 36, 24, 5); } }
function shopGlow(g, w, h, r, kind) {
  const col = { mobile: 'rgba(235,245,255,0.95)', barber: 'rgba(235,245,255,0.9)' }[kind] || 'rgba(255,220,150,0.95)';
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(120,90,50,0.6)');
  g.fillStyle = gr; g.fillRect(0, 20, w, h - 20);
}

// ---------------------------------------------------------------- signs, posters, murals
function signBoard(g, w, h, r, bg, fg, dev, eng, kind) {
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = shade(bg, -0.35); g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  if (kind === 'barber') for (let x = 0; x < 36; x += 9) { g.fillStyle = x % 18 ? '#c62828' : '#1d3c8f'; g.fillRect(x + 6, 6, 5, h - 12); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, dev, w / 2 + (kind === 'barber' ? 18 : 0), h * 0.4, w * 0.84, 44, DEV, 700);
  fitText(g, eng, w / 2, h * 0.8, w * 0.86, 17, NARROW, 700);
  if (kind === 'sports') { g.fillStyle = '#fff'; g.beginPath(); g.arc(30, h / 2, 18, 0, Math.PI * 2); g.fill(); g.fillStyle = '#222'; star(g, 30, h / 2, 7, 3); }
  if (kind === 'tea') { g.fillStyle = '#b3261e'; g.fillRect(20, h * 0.35, 24, 28); g.strokeStyle = '#b3261e'; g.lineWidth = 3; g.beginPath(); g.arc(46, h * 0.5, 7, -1.3, 1.3); g.stroke(); }
  runs(g, w, h, r, 5, 0.18); speckle(g, w, h, r, 90, 'rgba(0,0,0,0.12)');
}
function signGlow(g, w, h, r, bg, fg, dev, eng, kind) {
  if (!['tea', 'mobile', 'vadapav', 'sports'].includes(kind)) return;
  g.fillStyle = bg; g.globalAlpha = 0.85; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, dev, w / 2, h * 0.4, w * 0.84, 44, DEV, 700);
}
function poster(g, w, h, r, kind) {
  const P = {
    cup: ['#f9d84a', '#111', ['MONSOON', 'STREET CUP', '5-A-SIDE', 'SAT 7 PM', '1st ₹5,001']],
    tuition: ['#ffffff', '#1d3c8f', ['STAR', 'TUITIONS', '5th–10th', 'MATHS', 'SCIENCE']],
    garba: ['#c2185b', '#ffeb3b', ['DANDIYA', 'NIGHT', 'नवरात्री', 'ALL WELCOME']],
    gym: ['#212121', '#ff7043', ['IRON', 'GYM', '₹500', 'PER MONTH']],
    dance: ['#6a1b9a', '#ffffff', ['DANCE', 'CLASSES', 'BOLLYWOOD', 'HIP HOP']],
    wishes: ['#ff8f00', '#ffffff', ['हार्दिक', 'शुभेच्छा!', 'SITARA', 'YUVA MANDAL']],
    blood: ['#f5f5f5', '#c62828', ['BLOOD', 'DONATION', 'CAMP', 'SUNDAY']],
  }[kind];
  if (kind === 'torn') {
    for (let k = 0; k < 6; k++) { g.fillStyle = `hsl(${Math.floor(r() * 360)},60%,${45 + r() * 30}%)`; g.beginPath(); const x = r() * w, y = r() * h; for (let j = 0; j < 6; j++) g.lineTo(x + (r() - 0.5) * w, y + (r() - 0.5) * h * 0.7); g.fill(); }
    speckle(g, w, h, r, 60, 'rgba(255,255,255,0.3)'); return;
  }
  g.fillStyle = P[0]; g.fillRect(0, 0, w, h);
  if (kind === 'cup') { g.fillStyle = '#fff'; g.beginPath(); g.arc(w * 0.72, h * 0.22, 14, 0, Math.PI * 2); g.fill(); g.fillStyle = '#111'; star(g, w * 0.72, h * 0.22, 6, 3); g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(0, h * 0.62, w, h * 0.12); }
  if (kind === 'wishes') { g.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, h * (0.2 + k * 0.2)); g.quadraticCurveTo(w * 0.5, h * (0.1 + k * 0.2), w, h * (0.25 + k * 0.2)); g.lineTo(w, h * (0.3 + k * 0.2)); g.quadraticCurveTo(w * 0.5, h * (0.15 + k * 0.2), 0, h * (0.25 + k * 0.2)); g.fill(); } }
  g.fillStyle = P[1]; g.textAlign = 'center'; g.textBaseline = 'middle';
  P[2].forEach((t, i) => { const dev = /[ऀ-ॿ]/.test(t); g.fillStyle = kind === 'cup' && i === 3 ? '#f9d84a' : P[1]; fitText(g, t, w / 2, h * (0.14 + i * 0.18), w * 0.88, i < 2 ? 17 : 13, dev ? DEV : BOLD, dev ? 700 : 900); });
  // tape, tears, the rain
  g.fillStyle = 'rgba(240,235,215,0.7)'; g.fillRect(w * 0.4, 0, w * 0.2, 6);
  g.fillStyle = 'rgba(0,0,0,0)'; runs(g, w, h, r, 3, 0.15); speckle(g, w, h, r, 30, 'rgba(0,0,0,0.12)');
  if (r() < 0.5) { g.clearRect(w * 0.7, h * 0.85, w * 0.3, h * 0.15); }
}
function muralPlayer(g, w, h, r) {
  // rough painted background shapes (favela-bright), a footballer volleying, GULLY KINGS
  const cols = ['#ffb300', '#00acc1', '#e53935', '#8e24aa', '#43a047', '#fdd835'];
  g.fillStyle = '#f2e7cf'; roughRect(g, 6, 6, w - 12, h - 12, r);
  for (let k = 0; k < 9; k++) { g.fillStyle = cols[k % cols.length]; g.globalAlpha = 0.85; g.beginPath(); const x = r() * w, y = r() * h, s = 40 + r() * 90; g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s * 0.8); g.lineTo(x - s * 0.9, y + s * 0.1); g.fill(); }
  g.globalAlpha = 1;
  // the player: a bold silhouette mid-volley
  g.save(); g.translate(w * 0.36, h * 0.52); g.fillStyle = '#1b1b1b';
  g.beginPath(); g.arc(0, -h * 0.3, h * 0.07, 0, Math.PI * 2); g.fill();                       // head
  g.lineCap = 'round'; g.strokeStyle = '#1b1b1b'; g.lineWidth = h * 0.09;
  line(g, 0, -h * 0.22, -h * 0.04, h * 0.05);                                                 // torso
  g.lineWidth = h * 0.055; line(g, 0, -h * 0.18, -h * 0.2, -h * 0.3); line(g, 0, -h * 0.18, h * 0.16, -h * 0.05);   // arms
  g.lineWidth = h * 0.07; line(g, -h * 0.04, h * 0.05, h * 0.26, -h * 0.06); line(g, -h * 0.04, h * 0.05, -h * 0.14, h * 0.32);   // legs (the kick)
  g.restore();
  // the ball with motion lines
  g.fillStyle = '#fff'; g.beginPath(); g.arc(w * 0.68, h * 0.42, h * 0.075, 0, Math.PI * 2); g.fill(); g.fillStyle = '#111'; star(g, w * 0.68, h * 0.42, h * 0.03, h * 0.014);
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 5; for (let k = 0; k < 3; k++) line(g, w * 0.54, h * (0.38 + k * 0.04), w * 0.6, h * (0.38 + k * 0.04));
  // GULLY KINGS in outlined block letters
  g.save(); g.translate(w * 0.5, h * 0.86); g.rotate(-0.04); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${h * 0.16}px ${BOLD}`; g.lineWidth = 10; g.strokeStyle = '#1b1b1b'; g.strokeText('GULLY KINGS', 0, 0); g.fillStyle = '#fdd835'; g.fillText('GULLY KINGS', 0, 0); g.restore();
  peel(g, w, h, r, 24, 'rgba(200,190,170,0.85)'); runs(g, w, h, r, 12, 0.2); speckle(g, w, h, r, 300, 'rgba(0,0,0,0.1)');
}
function muralCrest(g, w, h, r) {
  g.fillStyle = '#e9e1cb'; roughRect(g, 4, 4, w - 8, h - 8, r);
  g.save(); g.translate(w / 2, h / 2);
  g.fillStyle = '#1f4fa8'; g.beginPath(); g.moveTo(-w * 0.32, -h * 0.34); g.lineTo(w * 0.32, -h * 0.34); g.lineTo(w * 0.32, h * 0.06); g.quadraticCurveTo(w * 0.3, h * 0.3, 0, h * 0.4); g.quadraticCurveTo(-w * 0.3, h * 0.3, -w * 0.32, h * 0.06); g.closePath(); g.fill();
  g.strokeStyle = '#f9c80e'; g.lineWidth = 8; g.stroke();
  g.fillStyle = '#f9c80e'; star(g, 0, -h * 0.04, w * 0.17, w * 0.07);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, 'SITARA GULLY', 0, -h * 0.25, w * 0.56, 26, BOLD); fitText(g, 'F.C.', 0, h * 0.18, w * 0.4, 30, BOLD); fitText(g, 'EST. 1998', 0, h * 0.28, w * 0.3, 14, BOLD, 700);
  g.restore();
  runs(g, w, h, r, 8, 0.18); peel(g, w, h, r, 10); speckle(g, w, h, r, 160);
}
function muralPattern(g, w, h, r) {
  const cols = ['#ef5350', '#ffca28', '#26c6da', '#7e57c2', '#66bb6a', '#ff7043', '#ec407a'];
  for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { g.fillStyle = cols[Math.floor(r() * cols.length)]; if (r() < 0.5) g.fillRect(x, y, 32, 32); else { g.beginPath(); g.moveTo(x, y + 32); g.lineTo(x + 32, y + 32); g.lineTo(x + (r() < 0.5 ? 0 : 32), y); g.fill(); } }
  g.strokeStyle = '#fff'; g.lineWidth = 6; for (let k = 0; k < 3; k++) { g.beginPath(); for (let x = 0; x <= w; x += 16) g.lineTo(x, h * (0.25 + k * 0.25) + Math.sin(x / 40 + k) * 12); g.stroke(); }
  peel(g, w, h, r, 20); runs(g, w, h, r, 10, 0.22); speckle(g, w, h, r, 200);
}
function muralKids(g, w, h, r) {
  g.fillStyle = '#f7f1dd'; roughRect(g, 4, 4, w - 8, h - 8, r);
  for (let k = 0; k < 14; k++) { const col = `hsl(${Math.floor(r() * 360)},75%,50%)`; g.fillStyle = col; const x = 20 + r() * (w - 40), y = 20 + r() * (h - 80); if (r() < 0.5) { g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; star(g, x, y, 5, 2); } else { for (let f = 0; f < 5; f++) g.fillRect(x + f * 5, y, 4, 14 + (f === 2 ? 4 : 0)); g.fillRect(x, y + 12, 24, 14); } }
  g.fillStyle = '#c62828'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${h * 0.16}px ${HAND}`; g.fillText('FOOTBALL FOR ALL', w / 2, h * 0.85);
  speckle(g, w, h, r, 120); runs(g, w, h, r, 6, 0.16);
}
function wallAd(g, w, h, r, big, sub, bg, fg) {
  g.fillStyle = bg; roughRect(g, 4, 4, w - 8, h - 8, r);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, big, w / 2, h * 0.38, w * 0.88, h * 0.4, BOLD); fitText(g, sub, w / 2, h * 0.76, w * 0.7, h * 0.24, DEV, 700);
  peel(g, w, h, r, 30, 'rgba(225,215,195,0.9)'); runs(g, w, h, r, 14, 0.25); speckle(g, w, h, r, 220);
}
function scoreboard(g, w, h, r) {
  g.fillStyle = '#6d4c33'; g.fillRect(0, 0, w, h); g.fillStyle = '#26302b'; g.fillRect(8, 8, w - 16, h - 16);
  g.fillStyle = 'rgba(240,240,230,0.88)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 15px ${HAND}`; g.fillText('SITARA GULLY 5-A-SIDE', w / 2, 26);
  g.font = `700 22px ${HAND}`; g.fillText('STAR XI  3 – 2  GULLY KINGS', w / 2, 68);
  g.font = `700 13px ${HAND}`; g.fillText('NEXT: SAT 7 PM · SUN 6 PM', w / 2, 104); g.fillText('ENTRY ₹100 / TEAM', w / 2, 128);
  speckle(g, w, h, r, 80, 'rgba(255,255,255,0.08)');
}
function meters(g, w, h, r) {
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
  for (let k = 0; k < 6; k++) { const x = 6 + (k % 3) * 56, y = 6 + Math.floor(k / 3) * 54; g.fillStyle = '#9ea4a6'; g.fillRect(x, y, 50, 46); g.fillStyle = '#d7e3e8'; g.fillRect(x + 10, y + 10, 30, 14); g.fillStyle = '#222'; g.fillRect(x + 13, y + 14, 24, 6); g.fillStyle = '#555'; g.fillRect(x + 20, y + 32, 10, 8); }
  g.strokeStyle = '#111'; g.lineWidth = 2; for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(10 + r() * (w - 20), h * 0.82); g.quadraticCurveTo(r() * w, h, r() * w, h + 10); g.stroke(); }
}
function danger(g, w, h) {
  g.fillStyle = '#f5f5f0'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c62828'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
  g.fillStyle = '#c62828'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'धोका', w / 2, h * 0.38, w * 0.8, 20, DEV, 700); fitText(g, '440 V', w / 2, h * 0.75, w * 0.6, 14, BOLD);
}
function plate(g, w, h, text, bg, font = DEV) {
  g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, h, 8) : g.rect(0, 0, w, h); g.fill();
  g.strokeStyle = '#f5f5f0'; g.lineWidth = 2; g.strokeRect(4, 4, w - 8, h - 8);
  g.fillStyle = '#f5f5f0'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, text, w / 2, h / 2, w * 0.82, h * 0.5, font, 700);
}
function acFront(g, w, h, r) {
  g.fillStyle = '#d9d8d2'; g.fillRect(0, 0, w, h); g.fillStyle = '#2c2c2c'; g.beginPath(); g.arc(w * 0.38, h / 2, h * 0.36, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#999'; g.lineWidth = 2; for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(w * 0.38 - h * 0.36, h / 2 + k * 7); g.lineTo(w * 0.38 + h * 0.36, h / 2 + k * 7); g.stroke(); }
  g.fillStyle = '#bdbcb5'; g.fillRect(w * 0.72, 10, w * 0.22, h - 20); runs(g, w, h, r, 4, 0.25);
}
function banner(g, w, h, r, bg, big, sub) {
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, 6, w, 4); g.fillRect(0, h - 10, w, 4);
  g.fillStyle = '#ffeb3b'; star(g, h * 0.5, h * 0.5, h * 0.3, h * 0.12); star(g, w - h * 0.5, h * 0.5, h * 0.3, h * 0.12);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, big, w / 2, h * 0.4, w - h * 2.2, h * 0.38, BOLD); g.fillStyle = '#ffeb3b';
  const dev = /[ऀ-ॿ]/.test(sub); fitText(g, sub, w / 2, h * 0.76, w - h * 2.2, h * 0.17, dev ? DEV : NARROW, 700);
  for (const x of [8, w - 16]) { g.fillStyle = '#ddd'; g.beginPath(); g.arc(x + 4, 12, 4, 0, Math.PI * 2); g.fill(); }
  speckle(g, w, h, r, 120, 'rgba(0,0,0,0.12)');
}
function grillTile(g, w, h) {
  g.clearRect(0, 0, w, h); g.strokeStyle = '#2b2f33'; g.lineWidth = 5;
  for (let x = 0; x <= w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  g.lineWidth = 4; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.beginPath(); for (let x = 0; x < w; x += 32) { g.moveTo(x + 32, h / 2); g.arc(x + 16, h / 2, 16, 0, Math.PI, true); } g.stroke();
}
const CLOTH = {
  plain: (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, 0, w, 3); },
  stripe: (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 4); },
  check: (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < w; k += 12) { g.fillRect(k, 0, 4, h); g.fillRect(0, k, w, 4); } },
  floral: (g, w, h, r) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(${150 + r() * 100},${40 + r() * 60},${60 + r() * 80},0.7)`; g.beginPath(); g.arc(r() * w, r() * h, 3 + r() * 4, 0, Math.PI * 2); g.fill(); } },
  border: (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(190,140,30,0.95)'; g.fillRect(0, h - 12, w, 8); g.fillRect(0, 4, w, 3); },
  print: (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.5)'; g.font = `900 16px ${BOLD}`; g.textAlign = 'center'; g.fillText('10', w / 2, h / 2 + 6); },
};
function stripes(g, w, h, cols) { for (let x = 0; x < w; x += 16) { g.fillStyle = cols[(x / 16) % 2]; g.fillRect(x, 0, 16, h); } }
function roughRect(g, x, y, w, h, r) {
  g.beginPath();
  for (let k = 0; k <= 20; k++) g.lineTo(x + w * k / 20, y + (r() - 0.5) * 6);
  for (let k = 0; k <= 12; k++) g.lineTo(x + w + (r() - 0.5) * 6, y + h * k / 12);
  for (let k = 20; k >= 0; k--) g.lineTo(x + w * k / 20, y + h + (r() - 0.5) * 6);
  for (let k = 12; k >= 0; k--) g.lineTo(x + (r() - 0.5) * 6, y + h * k / 12);
  g.fill();
}
function line(g, x0, y0, x1, y1) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
function shade(hex, k) {
  const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + k * (k > 0 ? 1 - hsl.l : hsl.l))));
  return '#' + c.getHexString();
}
