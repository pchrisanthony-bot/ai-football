// =====================================================================
// Surface textures for the street, painted in code (no downloads): tiling plaster (with a
// chip mask in alpha: where the paint has flaked off), brick, concrete, corrugated sheet,
// paver blocks, the ground, and the court itself — painted concrete, worn and patched, with
// the futsal markings exactly where the game's arcs are.
// Each comes with a normal map made from its height field.
// =====================================================================
import * as THREE from 'three';
import { PITCH } from '../../sim/pitch.js';
import { rng, canvas, texOf, noise2, normalFromHeight } from './util.js';

const cache = new Map();
const once = (k, f) => (cache.has(k) ? cache.get(k) : (cache.set(k, f()), cache.get(k)));

function finish(c, h, w, hh, strength, { srgb = true } = {}) {
  const map = texOf(c, { repeat: true, aniso: 8, srgb });
  const normal = texOf(normalFromHeight(h, w, hh, strength), { repeat: true, srgb: false, aniso: 8 });
  return { map, normal };
}

// Plaster (3 m tile): trowel grain, repairs, hairline cracks; alpha = paint (0 where chipped).
export const plaster = () => once('plaster', () => {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  const n = noise2(11), n2 = noise2(29), h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const big = n.fbm(u, v, 3, 3), grain = n2.fbm(u, v, 32, 3);
    const trowel = n.fbm(u * 1.0 + v * 0.3, v, 6, 2);
    h[i] = grain * 0.6 + trowel * 0.4;
    // chips: small flakes where the paint has gone. (Kept in alpha as 150, not 0: a canvas
    // throws away the colour of fully transparent pixels.)
    const chip = n2.fbm(u, v, 14, 4) > 0.71 ? 0 : 1;
    const lum = 0.84 + (big - 0.5) * 0.16 + (grain - 0.5) * 0.08 + (trowel - 0.5) * 0.05;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.max(0, Math.min(255, lum * 255));
    d[i * 4 + 3] = chip ? 255 : 150;
    if (!chip) h[i] -= 0.25;
  }
  g.putImageData(img, 0, 0);
  // hairline cracks
  const r = rng(5);
  g.strokeStyle = 'rgba(40,36,30,0.35)'; g.lineWidth = 1;
  for (let k = 0; k < 9; k++) {
    let x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 12; j++) { x += (r() - 0.5) * 30; y += r() * 18; g.lineTo(x, y); }
    g.stroke();
  }
  return finish(c, h, S, S, 1.6);
});

// Exposed brick (1.2 m tile): 23 × 7.5 cm bricks, recessed mortar, burnt and pale ones.
export const brick = () => once('brick', () => {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), r = rng(17), n = noise2(41);
  const ppm = S / 1.2, bh = 0.075 * ppm, bw = 0.23 * ppm, mort = 0.011 * ppm;
  const h = new Float32Array(S * S).fill(0.2);
  g.fillStyle = '#8f8a80'; g.fillRect(0, 0, S, S);
  const rows = Math.round(S / bh);
  for (let row = 0; row < rows; row++) {
    const y0 = row * (S / rows), off = (row % 2) * bw / 2;
    for (let x0 = -bw + off; x0 < S; x0 += bw) {
      const tone = r();
      const base = tone < 0.12 ? [92, 48, 34] : tone > 0.9 ? [176, 112, 78] : [140 + r() * 26, 70 + r() * 16, 48 + r() * 12];
      g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      g.fillRect(x0 + mort, y0 + mort, bw - mort * 2, S / rows - mort * 2);
      for (let yy = Math.max(0, Math.floor(y0 + mort)); yy < Math.min(S, y0 + S / rows - mort); yy++)
        for (let xx = Math.max(0, Math.floor(x0 + mort)); xx < Math.min(S, x0 + bw - mort); xx++) h[yy * S + xx] = 0.75 + n(xx / 9, yy / 9, 9999) * 0.12;
    }
  }
  // grain over everything
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < S * S; i++) { const k = (n.fbm((i % S) / S, Math.floor(i / S) / S, 16, 3) - 0.5) * 50; d[i * 4] += k; d[i * 4 + 1] += k * 0.8; d[i * 4 + 2] += k * 0.7; }
  g.putImageData(img, 0, 0);
  return finish(c, h, S, S, 3);
});

// Concrete (2 m tile): pores, formwork seams, stains.
export const concrete = () => once('concrete', () => {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  const n = noise2(53), n2 = noise2(61), h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const big = n.fbm(u, v, 3, 4), fine = n2.fbm(u, v, 48, 2);
    const pore = fine < 0.22 ? -0.18 : 0;
    const lum = 0.62 + (big - 0.5) * 0.22 + (fine - 0.5) * 0.08 + pore * 0.6;
    h[i] = fine * 0.5 + big * 0.2 + pore;
    d[i * 4] = lum * 255; d[i * 4 + 1] = lum * 250; d[i * 4 + 2] = lum * 240; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(30,30,30,0.18)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();       // a formwork seam
  return finish(c, h, S, S, 1.8);
});

// Corrugated sheet (0.8 m tile): ribs along v (vertical on a wall), white — tinted by paint.
export const corrugated = () => once('corrugated', () => {
  const S = 256, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data, n = noise2(71);
  const h = new Float32Array(S * S), ribs = 10.5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, u = x / S;
    const rib = Math.pow(Math.abs(Math.sin(u * Math.PI * ribs)), 0.8);
    h[i] = rib;
    const lum = 0.78 + rib * 0.12 + (n.fbm(u, y / S, 8, 3) - 0.5) * 0.12;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = lum * 255; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return finish(c, h, S, S, 6);
});

// Paver blocks (1 m tile): grey and red stretcher-bond pavers, worn, gritty joints.
export const pavers = () => once('pavers', () => {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), r = rng(83), n = noise2(89);
  const h = new Float32Array(S * S).fill(0.1);
  g.fillStyle = '#4a4741'; g.fillRect(0, 0, S, S);
  const pw = S / 5, ph = S / 10, gap = 3;
  for (let row = 0; row < 10; row++) for (let k = -1; k < 6; k++) {
    const x0 = k * pw + (row % 2) * pw / 2, y0 = row * ph;
    const red = r() < 0.35, v = 0.85 + r() * 0.25;
    g.fillStyle = red ? `rgb(${Math.round(150 * v)},${Math.round(92 * v)},${Math.round(78 * v)})` : `rgb(${Math.round(150 * v)},${Math.round(148 * v)},${Math.round(140 * v)})`;
    g.fillRect(x0 + gap, y0 + gap, pw - gap * 2, ph - gap * 2);
    for (let y = Math.max(0, y0 + gap); y < Math.min(S, y0 + ph - gap); y++) for (let x = Math.max(0, x0 + gap); x < Math.min(S, x0 + pw - gap); x++) h[y * S + x] = 0.7;
  }
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < S * S; i++) { const k = (n.fbm((i % S) / S, Math.floor(i / S) / S, 24, 3) - 0.5) * 46; d[i * 4] += k; d[i * 4 + 1] += k; d[i * 4 + 2] += k; }
  g.putImageData(img, 0, 0);
  return finish(c, h, S, S, 2.5);
});

// The ground round the court (6 m tile): broken concrete, patches, joints, dust, oil stains.
export const ground = () => once('ground', () => {
  const S = 1024, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  const n = noise2(97), n2 = noise2(101), h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const big = n.fbm(u, v, 4, 4), fine = n2.fbm(u, v, 64, 2);
    const dust = smooth(0.55, 0.8, n2.fbm(u, v, 3, 3));
    const lum = 0.5 + (big - 0.5) * 0.22 + (fine - 0.5) * 0.1;
    h[i] = fine * 0.5 + big * 0.3;
    d[i * 4] = (lum + dust * 0.08) * 255; d[i * 4 + 1] = (lum * 0.97 + dust * 0.05) * 255; d[i * 4 + 2] = (lum * 0.92) * 255; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const r = rng(103);
  // expansion joints every 3 m
  g.strokeStyle = 'rgba(20,20,20,0.5)'; g.lineWidth = 3;
  for (let k = 0; k <= 2; k++) { g.beginPath(); g.moveTo(k * S / 2, 0); g.lineTo(k * S / 2, S); g.stroke(); g.beginPath(); g.moveTo(0, k * S / 2); g.lineTo(S, k * S / 2); g.stroke(); }
  // cracks, patches, oil stains
  crack(g, r, S, 14, 'rgba(15,14,12,0.55)');
  for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '110,108,100' : '70,68,62'},0.5)`; g.fillRect(r() * S, r() * S, 40 + r() * 140, 30 + r() * 90); }
  for (let k = 0; k < 10; k++) blot(g, r() * S, r() * S, 10 + r() * 40, 'rgba(10,10,12,0.22)', r);
  return finish(c, h, S, S, 2);
});

// The court: painted concrete (faded green), worn to bare concrete in the goalmouths and the
// centre, patched, cracked, with dried puddle marks, faded lines and the neighbourhood's crest.
// 64 px per metre over the 32 × 18 m court.
export const court = () => once(`streetcourt:${PITCH.id}`, () => {
  const PPM = 64, L = PITCH.halfL * 2, Wd = PITCH.halfW * 2, W = Math.round(L * PPM), H = Math.round(Wd * PPM);
  const c = canvas(W, H), g = c.getContext('2d'), r = rng(707);
  const X = x => (x + PITCH.halfL) * PPM, Z = z => (z + PITCH.halfW) * PPM;
  // noise at a quarter resolution, drawn up (fast)
  const NW = W / 4, NH = H / 4, nc = canvas(NW, NH), ng = nc.getContext('2d'), ni = ng.createImageData(NW, NH), n = noise2(709), n2 = noise2(719);
  const hq = new Float32Array(NW * NH);
  for (let y = 0; y < NH; y++) for (let x = 0; x < NW; x++) {
    const u = x / NW, v = y / NH, i = y * NW + x;
    const big = n.fbm(u * 1.8, v, 4, 4), fine = n2.fbm(u * 1.8, v, 40, 2);
    // wear: where the paint is gone — goalmouths, the centre, the corners
    const gx = Math.min(Math.abs(u * L - 0), Math.abs(u * L - L)) / 6, gz = Math.abs(v * Wd - Wd / 2) / 3.2;
    const goalWear = Math.max(0, 1 - Math.hypot(gx, gz));
    const centreWear = Math.max(0, 1 - Math.hypot((u - 0.5) * L / 3, (v - 0.5) * Wd / 2.5)) * 0.6;
    const wear = Math.min(1, (goalWear * 1.1 + centreWear) * (0.55 + big * 0.9) + (big > 0.72 ? (big - 0.72) * 2 : 0));
    hq[i] = fine * 0.6 + big * 0.2 - wear * 0.1;
    // paint (faded court green) → bare concrete where worn
    const pg = [52 + big * 16, 92 + big * 18, 74 + big * 12], cc = [112 + fine * 30, 110 + fine * 28, 102 + fine * 24];
    const k = smooth(0.35, 0.75, wear + (fine - 0.5) * 0.4);
    ni.data[i * 4] = pg[0] * (1 - k) + cc[0] * k + (fine - 0.5) * 18;
    ni.data[i * 4 + 1] = pg[1] * (1 - k) + cc[1] * k + (fine - 0.5) * 18;
    ni.data[i * 4 + 2] = pg[2] * (1 - k) + cc[2] * k + (fine - 0.5) * 16;
    ni.data[i * 4 + 3] = 255;
  }
  ng.putImageData(ni, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(nc, 0, 0, W, H);
  // fine grain at full resolution
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < W * H; i++) { const k = (r() - 0.5) * 16; d[i * 4] += k; d[i * 4 + 1] += k; d[i * 4 + 2] += k; }
  g.putImageData(img, 0, 0);
  // patched sections (newer, greyer concrete) and a dried puddle stain
  for (const [x, z, w, h2] of [[-9.5, 5.2, 3.2, 2.1], [6.8, -6.6, 2.4, 1.6], [12.4, 3.4, 1.8, 2.6]]) {
    g.fillStyle = 'rgba(96,98,90,0.55)'; g.fillRect(X(x), Z(z), w * PPM, h2 * PPM);
    g.strokeStyle = 'rgba(30,30,28,0.4)'; g.lineWidth = 2; g.strokeRect(X(x), Z(z), w * PPM, h2 * PPM);
  }
  for (const [x, z, s] of [[-2.5, -4.2, 2.6], [8.5, 5.4, 1.8]]) {
    g.strokeStyle = 'rgba(205,200,180,0.18)'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(X(x), Z(z), s * PPM, s * 0.6 * PPM, r(), 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(20,24,20,0.12)'; g.beginPath(); g.ellipse(X(x), Z(z), s * 0.9 * PPM, s * 0.52 * PPM, 0.3, 0, Math.PI * 2); g.fill();
  }
  crack(g, r, W, 22, 'rgba(18,20,18,0.7)', H);
  for (let k = 0; k < 16; k++) blot(g, r() * W, r() * H, 14 + r() * 50, 'rgba(12,14,12,0.16)', r);

  // markings: faded white lines (worn through in the goalmouths), maroon keeper D's
  const fadeLine = (draw, w, col) => {
    g.save(); g.strokeStyle = col; g.lineWidth = w * PPM; g.lineCap = 'round';
    g.setLineDash([2.6 * PPM, 0.07 * PPM, 0.9 * PPM, 0.12 * PPM]);     // chipped paint
    draw(); g.restore();
  };
  const D = (x0, s) => { g.beginPath(); g.arc(X(x0), Z(0), PITCH.boxR * PPM, s > 0 ? -Math.PI / 2 : Math.PI / 2, s > 0 ? Math.PI / 2 : Math.PI * 1.5); };
  g.fillStyle = 'rgba(172, 60, 44, 0.58)'; D(-PITCH.halfL, 1); g.fill(); D(PITCH.halfL, -1); g.fill();
  const white = 'rgba(232,230,214,0.78)';
  fadeLine(() => { g.strokeRect(X(-PITCH.halfL) + 0.1 * PPM, Z(-PITCH.halfW) + 0.1 * PPM, W - 0.2 * PPM, H - 0.2 * PPM); }, 0.08, white);
  fadeLine(() => { g.beginPath(); g.moveTo(X(0), Z(-PITCH.halfW)); g.lineTo(X(0), Z(PITCH.halfW)); g.stroke(); }, 0.08, white);
  fadeLine(() => { g.beginPath(); g.arc(X(0), Z(0), PITCH.centreR * PPM, 0, Math.PI * 2); g.stroke(); }, 0.08, white);
  fadeLine(() => { D(-PITCH.halfL, 1); g.stroke(); D(PITCH.halfL, -1); g.stroke(); }, 0.08, white);
  g.fillStyle = white;
  for (const x of [0, -PITCH.halfL + PITCH.penaltySpot, PITCH.halfL - PITCH.penaltySpot]) { g.beginPath(); g.arc(X(x), Z(0), 0.12 * PPM, 0, Math.PI * 2); g.fill(); }
  // the crest in the centre circle: a star in a ring, the neighbourhood's name round it
  g.save(); g.translate(X(0), Z(0)); g.globalAlpha = 0.42;
  g.fillStyle = '#e8b93c'; star(g, 0, 0, 1.15 * PPM, 0.48 * PPM);
  g.strokeStyle = '#e8b93c'; g.lineWidth = 0.09 * PPM; g.beginPath(); g.arc(0, 0, 1.75 * PPM, 0, Math.PI * 2); g.stroke();
  g.font = `900 ${0.36 * PPM}px "Arial Black", Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('SITARA GULLY F.C.', 0, -2.25 * PPM); g.fillText('EST. 1998', 0, 2.25 * PPM);
  g.restore();
  // chalk: a kid's hopscotch scratched by the near touchline, a scoreline tally on the far one
  g.save(); g.strokeStyle = 'rgba(240,240,235,0.32)'; g.lineWidth = 3;
  g.translate(X(-12.5), Z(7.8)); g.rotate(0.04);
  for (let k = 0; k < 6; k++) g.strokeRect(k * 0.55 * PPM, -0.5 * PPM, 0.55 * PPM, 0.55 * PPM);
  g.restore();
  g.save(); g.fillStyle = 'rgba(240,240,235,0.3)'; g.font = `700 ${0.4 * PPM}px "Segoe Print", "Comic Sans MS", cursive`;
  g.translate(X(9), Z(-8.3)); g.fillText('STAR XI  ||||  GULLY KINGS  |||', 0, 0); g.restore();

  const map = texOf(c, { aniso: 16 });
  const nrm = texOf(normalFromHeight(hq, NW, NH, 2.2), { srgb: false, aniso: 8 });
  return { map, normal: nrm };
});

// ---------------------------------------------------------------- helpers
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function crack(g, r, W, n, col, H = W) {
  g.strokeStyle = col; g.lineCap = 'round';
  for (let k = 0; k < n; k++) {
    let x = r() * W, y = r() * H, a = r() * Math.PI * 2;
    g.lineWidth = 1 + r() * 2.2; g.beginPath(); g.moveTo(x, y);
    const segs = 6 + Math.floor(r() * 14);
    for (let j = 0; j < segs; j++) {
      a += (r() - 0.5) * 1.1; const len = 6 + r() * 26;
      x += Math.cos(a) * len; y += Math.sin(a) * len; g.lineTo(x, y);
      if (r() < 0.15) { const bx = x, by = y; g.moveTo(bx, by); g.lineTo(bx + (r() - 0.5) * 40, by + (r() - 0.5) * 40); g.moveTo(x, y); }
    }
    g.stroke();
  }
}
function blot(g, x, y, s, col, r) {
  g.fillStyle = col;
  for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(x + (r() - 0.5) * s, y + (r() - 0.5) * s, s * (0.3 + r() * 0.5), s * (0.2 + r() * 0.4), r() * 3, 0, Math.PI * 2); g.fill(); }
}
export function star(g, x, y, R, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
