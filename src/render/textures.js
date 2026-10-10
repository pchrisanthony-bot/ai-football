// Procedural textures (no downloaded art): everything is drawn to canvases.
import * as THREE from 'three';
import { PITCH } from '../sim/pitch.js';

const cache = new Map();
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = null, srgb = true, aniso = 8, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.generateMipmaps = mip;
  return t;
}
function once(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

// Seeded noise for repeatable grain.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------------------------------------------------------------- court
// 64 px per metre over the court (32 × 18 m).
export function courtTextures() {
  return once(`court:${PITCH.id}`, () => {
    const PPM = 64, W = PITCH.halfL * 2 * PPM, H = PITCH.halfW * 2 * PPM;
    const c = canvas(W, H), g = c.getContext('2d');
    const r = rng(7);
    // painted asphalt base
    g.fillStyle = '#24262c'; g.fillRect(0, 0, W, H);
    // aggregate grain
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 22 + (r() < 0.02 ? (r() - 0.5) * 60 : 0);
      d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.05;
    }
    g.putImageData(img, 0, 0);
    // scuffs & wear patches
    for (let i = 0; i < 140; i++) {
      g.fillStyle = `rgba(${r() < 0.7 ? '0,0,0' : '255,255,255'},${0.008 + r() * 0.018})`;
      g.beginPath(); g.ellipse(r() * W, r() * H, 20 + r() * 160, 8 + r() * 60, r() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    const X = x => (x + PITCH.halfL) * PPM, Z = z => (z + PITCH.halfW) * PPM;

    // coloured zones: keeper areas + centre circle fill
    const zone = (x0, sgn) => {
      g.fillStyle = 'rgba(214, 48, 49, 0.55)';
      g.beginPath(); g.arc(X(x0), Z(0), PITCH.boxR * PPM, sgn > 0 ? -Math.PI / 2 : Math.PI / 2, sgn > 0 ? Math.PI / 2 : Math.PI * 1.5); g.fill();
    };
    zone(-PITCH.halfL, 1); zone(PITCH.halfL, -1);
    g.fillStyle = 'rgba(255, 212, 0, 0.18)';
    g.beginPath(); g.arc(X(0), Z(0), PITCH.centreR * PPM, 0, Math.PI * 2); g.fill();

    // lines
    const line = (w, col = 'rgba(245,245,240,0.92)') => { g.strokeStyle = col; g.lineWidth = w * PPM; };
    line(0.08);
    g.strokeRect(X(-PITCH.halfL) + 0.1 * PPM, Z(-PITCH.halfW) + 0.1 * PPM, W - 0.2 * PPM, H - 0.2 * PPM);
    g.beginPath(); g.moveTo(X(0), Z(-PITCH.halfW)); g.lineTo(X(0), Z(PITCH.halfW)); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), PITCH.centreR * PPM, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(X(-PITCH.halfL), Z(0), PITCH.boxR * PPM, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.beginPath(); g.arc(X(PITCH.halfL), Z(0), PITCH.boxR * PPM, Math.PI / 2, Math.PI * 1.5); g.stroke();
    g.fillStyle = 'rgba(245,245,240,0.92)';
    for (const x of [0, -PITCH.halfL + 6, PITCH.halfL - 6, -PITCH.halfL + 10, PITCH.halfL - 10]) { g.beginPath(); g.arc(X(x), Z(0), 0.12 * PPM, 0, Math.PI * 2); g.fill(); }
    // yellow accent inner border
    line(0.05, 'rgba(255,212,0,0.75)');
    g.strokeRect(X(-PITCH.halfL) + 0.35 * PPM, Z(-PITCH.halfW) + 0.35 * PPM, W - 0.7 * PPM, H - 0.7 * PPM);

    // centre logo
    g.save();
    g.translate(X(0), Z(0));
    g.font = `900 ${0.9 * PPM}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,212,0,0.55)';
    g.fillText('STREETCAGE', 0, 0);
    g.restore();

    // faded floor tag
    g.save();
    g.translate(X(-8), Z(5.5)); g.rotate(-0.15);
    g.font = `italic 900 ${1.6 * PPM}px Impact, sans-serif`;
    g.fillStyle = 'rgba(0,200,255,0.07)'; g.fillText('ROOF KINGS', 0, 0);
    g.restore();

    const map = tex(c, { aniso: 16 });
    // roughness: lines smoother, asphalt rough
    const rc = canvas(512, 288), rg = rc.getContext('2d');
    rg.fillStyle = '#d8d8d8'; rg.fillRect(0, 0, 512, 288);
    const rimg = rg.getImageData(0, 0, 512, 288);
    for (let i = 0; i < rimg.data.length; i += 4) { const n = r() * 40; rimg.data[i] -= n; rimg.data[i + 1] -= n; rimg.data[i + 2] -= n; }
    rg.putImageData(rimg, 0, 0);
    const roughness = tex(rc, { srgb: false });
    return { map, roughness };
  });
}

// ---------------------------------------------------------------- chain-link fence
export function chainLink() {
  return once('chain', () => {
    const S = 128, c = canvas(S, S), g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.lineCap = 'round';
    // one diamond cell: two crossing diagonals tile into chain link
    g.beginPath(); g.moveTo(0, 0); g.lineTo(S, S); g.stroke();
    g.beginPath(); g.moveTo(S, 0); g.lineTo(0, S); g.stroke();
    g.beginPath(); g.moveTo(-S / 2, S / 2); g.lineTo(S / 2, S * 1.5); g.stroke();
    const t = tex(c, { srgb: false, aniso: 16 });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

export function netTexture() {
  return once('net', () => {
    const S = 64, c = canvas(S, S), g = c.getContext('2d');
    g.strokeStyle = '#ffffff'; g.lineWidth = 3;
    g.strokeRect(0, 0, S, S);
    const t = tex(c, { srgb: false, aniso: 8 });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

// ---------------------------------------------------------------- graffiti kickboards
const PALETTE = ['#FFD400', '#FF3B6B', '#00D1FF', '#39FF88', '#B84DFF', '#FF8A00', '#FFFFFF'];
const WORDS = ['STREETCAGE', 'PANNA', 'ROOF KINGS', '5 A SIDE', 'NO RULES', 'SKILLZ', 'CAGE BALL', 'NIGHT LEAGUE', 'NUTMEG', 'KEEP IT LIT'];
export function graffitiBoard(seed, lengthM) {
  return once(`graf${seed}_${lengthM}`, () => {
    const PPM = 96, W = Math.round(lengthM * PPM), H = PPM;
    const c = canvas(Math.min(W, 4096), H), g = c.getContext('2d');
    const sx = c.width / W;
    g.scale(sx, 1);
    const r = rng(seed * 97 + 13);
    // base paint
    g.fillStyle = '#16161c'; g.fillRect(0, 0, W, H);
    // panels
    let x = 0;
    while (x < W) {
      const w = PPM * (1.5 + r() * 3);
      const col = PALETTE[Math.floor(r() * PALETTE.length)];
      const style = r();
      g.save();
      g.beginPath(); g.rect(x, 0, w, H); g.clip();
      if (style < 0.3) {
        // sponsor-style panel
        g.fillStyle = col; g.globalAlpha = 0.9; g.fillRect(x + 4, 6, w - 8, H - 12);
        g.globalAlpha = 1; g.fillStyle = '#111';
        g.font = `900 ${H * 0.42}px "Arial Black", Impact, sans-serif`;
        g.textBaseline = 'middle'; g.textAlign = 'center';
        g.fillText(WORDS[Math.floor(r() * WORDS.length)], x + w / 2, H / 2, w - 20);
      } else {
        // spray tag: blobs + outlined text
        for (let i = 0; i < 6; i++) {
          g.fillStyle = PALETTE[Math.floor(r() * PALETTE.length)];
          g.globalAlpha = 0.25 + r() * 0.4;
          g.beginPath(); g.ellipse(x + r() * w, r() * H, 20 + r() * 60, 10 + r() * 30, r() * 3, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        g.font = `italic 900 ${H * (0.45 + r() * 0.2)}px Impact, "Arial Black", sans-serif`;
        g.textBaseline = 'middle'; g.textAlign = 'center';
        const word = WORDS[Math.floor(r() * WORDS.length)];
        g.lineWidth = 8; g.strokeStyle = '#0a0a0a'; g.strokeText(word, x + w / 2, H / 2 + 4, w - 10);
        g.fillStyle = col; g.fillText(word, x + w / 2, H / 2, w - 10);
        g.lineWidth = 2; g.strokeStyle = '#fff'; g.globalAlpha = 0.6; g.strokeText(word, x + w / 2, H / 2, w - 10);
      }
      g.restore();
      x += w;
    }
    // grime at the bottom
    const grd = g.createLinearGradient(0, H * 0.6, 0, H);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // top trim
    g.fillStyle = '#FFD400'; g.fillRect(0, 0, W, 5);
    return tex(c, { aniso: 8 });
  });
}

// ---------------------------------------------------------------- city windows
export function windowTexture(seed) {
  return once(`win${seed}`, () => {
    const c = canvas(256, 512), g = c.getContext('2d');
    const r = rng(seed * 31 + 5);
    g.fillStyle = '#07080c'; g.fillRect(0, 0, 256, 512);
    const cols = 8, rows = 24, cw = 256 / cols, rh = 512 / rows;
    const warm = ['#ffd27a', '#ffe7b0', '#fff3d6', '#9fd4ff', '#ffc46b'];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (r() < 0.38) {
        g.fillStyle = warm[Math.floor(r() * warm.length)];
        g.globalAlpha = 0.5 + r() * 0.5;
        g.fillRect(x * cw + 5, y * rh + 5, cw - 10, rh - 9);
      }
    }
    g.globalAlpha = 1;
    const t = tex(c, { aniso: 4 });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

export function concreteTexture() {
  return once('concrete', () => {
    const S = 512, c = canvas(S, S), g = c.getContext('2d');
    const r = rng(3);
    g.fillStyle = '#34353a'; g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 26; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    for (let i = 0; i <= S; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
    const t = tex(c, { aniso: 8 });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

// ---------------------------------------------------------------- ball
// A modern street ball, sharp at any distance: a 2048 × 1024 equirectangular map (u =
// longitude, v = latitude) — bright white casing, three bold swoosh bands kept off the
// poles (no pinching), the panel seams as meridians, and a small wordmark.
export function ballTexture() {
  return once('ball', () => {
    const W = 2048, H = 1024, c = canvas(W, H), g = c.getContext('2d');
    // hi-vis optic yellow: the one colour that isn't the court, a kit, a wall or a line
    g.fillStyle = '#e9ff1f'; g.fillRect(0, 0, W, H);
    // a faint warm shade toward the poles (a printed casing, not flat paint)
    const sh = g.createLinearGradient(0, 0, 0, H);
    sh.addColorStop(0, 'rgba(255,255,255,0.75)'); sh.addColorStop(0.25, 'rgba(255,255,255,0)'); sh.addColorStop(0.75, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,0.75)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H);
    // three swoosh bands, each wrapping the ball twice (seamless at u = 0 / 1)
    const bands = [['#15151a', 0.33, 0.0], ['#ffffff', 0.5, 0.33], ['#FF2A8A', 0.67, 0.66]];
    for (const [col, v0, ph] of bands) {
      g.fillStyle = col;
      g.beginPath();
      const amp = H * 0.07, half = H * 0.055, N = 256;
      for (let k = 0; k <= N; k++) { const u = k / N, y = v0 * H + Math.sin((u * 2 + ph) * Math.PI * 2) * amp - half * (0.55 + 0.45 * Math.cos((u * 4 + ph) * Math.PI * 2)); k ? g.lineTo(u * W, y) : g.moveTo(u * W, y); }
      for (let k = N; k >= 0; k--) { const u = k / N, y = v0 * H + Math.sin((u * 2 + ph) * Math.PI * 2) * amp + half * (0.55 + 0.45 * Math.cos((u * 4 + ph) * Math.PI * 2)); g.lineTo(u * W, y); }
      g.closePath(); g.fill();
    }
    // panel seams: six meridians and two latitude seams, thin and soft
    g.strokeStyle = 'rgba(40,40,48,0.35)'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { const x = (i / 6) * W + W / 12; g.beginPath(); g.moveTo(x, H * 0.08); g.bezierCurveTo(x + 40, H * 0.35, x - 40, H * 0.65, x, H * 0.92); g.stroke(); }
    for (const v of [0.22, 0.78]) { g.beginPath(); g.moveTo(0, v * H); g.lineTo(W, v * H); g.stroke(); }
    // wordmark, twice round the equator
    g.font = `900 ${Math.round(H * 0.045)}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const u of [0.25, 0.75]) { g.fillStyle = 'rgba(20,20,26,0.85)'; g.fillText('STREETCAGE', u * W, H * 0.43); }
    return tex(c, { aniso: 16 });
  });
}

// ---------------------------------------------------------------- shirt back number
export function shirtTexture(kit, number, name) {
  return once(`shirt_${kit.shirt}_${number}_${name}`, () => {
    // 256×288 atlas: the shirt occupies the top 256 px; the bottom 32 px strip is
    // plain white so every other body part (vertex-coloured) samples white.
    const W = 256, H = 256, c = canvas(W, H + 32), g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, H, W, 32);
    g.fillStyle = kit.shirt; g.fillRect(0, 0, W, H);
    // Lathe UVs: u = 0 front centre, 0.25 left side, 0.5 back centre, 0.75 right side.
    g.fillStyle = kit.trim;
    g.fillRect(W * 0.25 - 7, 0, 14, H); g.fillRect(W * 0.75 - 7, 0, 14, H);
    // collar band + hem
    g.fillRect(0, H - 16, W, 16);
    g.globalAlpha = 0.35; g.fillRect(0, 0, W, 8); g.globalAlpha = 1;
    const bx = W * 0.5;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // (canvas y is flipped vs the lathe's v: v = 0 at the waist → bottom of the canvas)
    // v = height / 0.5 m: waist at the bottom of the canvas, collar at the top.
    g.font = `900 ${H * 0.3}px "Arial Black", Impact, sans-serif`;
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.strokeText(String(number), bx, H * 0.47);
    g.fillStyle = kit.trim; g.fillText(String(number), bx, H * 0.47);
    g.font = `800 ${H * 0.07}px Arial, sans-serif`;
    g.fillText(name.toUpperCase(), bx, H * 0.27);
    // front: small chest number just off-centre
    g.font = `900 ${H * 0.11}px "Arial Black", Impact, sans-serif`;
    g.fillText(String(number), W * 0.93, H * 0.36);
    return tex(c, { aniso: 4 });
  });
}

// Soft radial glow (for lamp flares, blob shadows, light pools).
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  return once(`rad${inner}${outer}${size}`, () => {
    const c = canvas(size, size), g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, inner); grd.addColorStop(1, outer);
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    return tex(c, { aniso: 1 });
  });
}

// A hand-painted bedsheet banner zip-tied to the fence: this court belongs to the
// people who play on it ("pirate radio" atmosphere, not a sanctioned venue).
export function bannerTexture(lines = ['NO REFS', 'NO RULES', 'JUST THE CAGE']) {
  return once('banner', () => {
    const W = 1024, H = 200, c = canvas(W, H), g = c.getContext('2d');
    const r = rng(77);
    // off-white sheet with stains and a torn edge
    g.fillStyle = '#e9e3d6'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${120 + r() * 60},${100 + r() * 50},${70 + r() * 40},${0.04 + r() * 0.06})`; g.beginPath(); g.ellipse(r() * W, r() * H, 20 + r() * 90, 10 + r() * 40, r() * 3, 0, Math.PI * 2); g.fill(); }
    g.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < W; x += 6) { g.fillRect(x, 0, 6, r() * 7); g.fillRect(x, H - r() * 7, 6, 10); }
    g.globalCompositeOperation = 'source-over';
    // brush lettering with drips
    const txt = lines.join('  ·  ');
    g.font = 'italic 900 92px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#c4161c';
    g.save(); g.translate(W / 2, H / 2 + 4); g.rotate(-0.02); g.fillText(txt, 0, 0, W - 60); g.restore();
    for (let i = 0; i < 26; i++) { const x = 60 + r() * (W - 120), y = H / 2 + 20 + r() * 20; g.fillStyle = 'rgba(196,22,28,.85)'; g.fillRect(x, y, 3 + r() * 3, 12 + r() * 40); g.beginPath(); g.arc(x + 2.5, y + 12 + r() * 40, 3, 0, Math.PI * 2); g.fill(); }
    // zip-tie holes
    g.fillStyle = '#222';
    for (const x of [16, W / 2, W - 16]) { g.beginPath(); g.arc(x, 14, 6, 0, Math.PI * 2); g.fill(); }
    return tex(c);
  });
}

// A spray-painted tag for the court or a wall (transparent, soft overspray, drips).
export function sprayTag(key, word, color = '#FFD400', { w = 512, h = 256, crown = false, arrow = false, stencil = false } = {}) {
  return once('tag_' + key, () => {
    const c = canvas(w, h), g = c.getContext('2d');
    const r = rng(key.length * 31 + word.length);
    // overspray
    for (let i = 0; i < 900; i++) { g.fillStyle = color; g.globalAlpha = r() * 0.25; g.fillRect(w * 0.1 + r() * w * 0.8, h * 0.2 + r() * h * 0.6, 2, 2); }
    g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${stencil ? '' : 'italic '}900 ${h * 0.55}px ${stencil ? '"Arial Black", Impact' : 'Impact, "Arial Black"'}, sans-serif`;
    g.shadowColor = color; g.shadowBlur = 14;
    g.lineWidth = stencil ? 0 : 10; g.strokeStyle = '#0b0b0e';
    if (!stencil) g.strokeText(word, w / 2, h / 2 + 6, w * 0.86);
    g.fillStyle = color; g.fillText(word, w / 2, h / 2, w * 0.86);
    g.shadowBlur = 0;
    if (stencil) { g.globalCompositeOperation = 'destination-out'; g.fillRect(0, h / 2 - 3, w, 6); g.globalCompositeOperation = 'source-over'; }
    if (crown) {
      g.fillStyle = color; g.beginPath();
      const cx = w / 2, cy = h * 0.12;
      g.moveTo(cx - 60, cy + 34); g.lineTo(cx - 60, cy + 4); g.lineTo(cx - 30, cy + 22); g.lineTo(cx, cy - 8); g.lineTo(cx + 30, cy + 22); g.lineTo(cx + 60, cy + 4); g.lineTo(cx + 60, cy + 34); g.closePath(); g.fill();
    }
    if (arrow) {
      g.strokeStyle = color; g.lineWidth = 16; g.lineCap = 'round';
      g.beginPath(); g.moveTo(w * 0.2, h * 0.9); g.lineTo(w * 0.8, h * 0.9); g.stroke();
      g.beginPath(); g.moveTo(w * 0.7, h * 0.78); g.lineTo(w * 0.82, h * 0.9); g.lineTo(w * 0.7, h * 1.02); g.stroke();
    }
    // drips
    for (let i = 0; i < 10; i++) { const x = w * 0.15 + r() * w * 0.7, y = h * 0.62 + r() * h * 0.1; g.fillStyle = color; g.globalAlpha = 0.85; g.fillRect(x, y, 3, 8 + r() * h * 0.22); }
    g.globalAlpha = 1;
    return tex(c);
  });
}

// ---------------------------------------------------------------- stadium cage (FTS look)
// Artificial turf: a mown checkerboard in two greens, blade grain, worn goalmouths
// and centre, crisp white markings (same geometry as the street court).
export function turfTextures() {
  return once(`turf:${PITCH.id}`, () => {
    const PPM = 48, W = PITCH.halfL * 2 * PPM, H = PITCH.halfW * 2 * PPM;
    const c = canvas(W, H), g = c.getContext('2d');
    const r = rng(21);
    const X = x => (x + PITCH.halfL) * PPM, Z = z => (z + PITCH.halfW) * PPM;
    const sq = 2 * PPM;
    for (let i = 0; i * sq < W; i++) for (let j = 0; j * sq < H; j++) {
      const light = (i + j) % 2 === 0, stripe = i % 2 === 0;
      g.fillStyle = light ? (stripe ? '#4a9636' : '#468f33') : (stripe ? '#3a7f29' : '#367926');
      g.fillRect(i * sq, j * sq, sq, sq);
    }
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 26; d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.4; }
    g.putImageData(img, 0, 0);
    // wear: goalmouths, the centre spot, and the keeper's line
    const wear = (x, z, rx, rz, a) => { const gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rx * PPM); gr.addColorStop(0, `rgba(150,140,90,${a})`); gr.addColorStop(1, 'rgba(150,140,90,0)'); g.save(); g.translate(X(x), Z(z)); g.scale(1, rz / rx); g.translate(-X(x), -Z(z)); g.fillStyle = gr; g.beginPath(); g.arc(X(x), Z(z), rx * PPM, 0, Math.PI * 2); g.fill(); g.restore(); };
    wear(-PITCH.halfL + 1.2, 0, 3, 2, 0.35); wear(PITCH.halfL - 1.2, 0, 3, 2, 0.35); wear(0, 0, 3.2, 2.4, 0.22);
    for (let i = 0; i < 70; i++) wear((r() - 0.5) * 30, (r() - 0.5) * 16, 0.5 + r() * 1.5, 0.3 + r() * 0.8, 0.06 + r() * 0.08);
    // markings
    g.strokeStyle = 'rgba(250,250,245,0.95)'; g.lineWidth = 0.09 * PPM;
    g.strokeRect(X(-PITCH.halfL) + 0.15 * PPM, Z(-PITCH.halfW) + 0.15 * PPM, W - 0.3 * PPM, H - 0.3 * PPM);
    g.beginPath(); g.moveTo(X(0), Z(-PITCH.halfW)); g.lineTo(X(0), Z(PITCH.halfW)); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), PITCH.centreR * PPM, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(X(-PITCH.halfL), Z(0), PITCH.boxR * PPM, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.beginPath(); g.arc(X(PITCH.halfL), Z(0), PITCH.boxR * PPM, Math.PI / 2, Math.PI * 1.5); g.stroke();
    g.fillStyle = 'rgba(250,250,245,0.95)';
    for (const x of [0, -PITCH.halfL + 6, PITCH.halfL - 6]) { g.beginPath(); g.arc(X(x), Z(0), 0.13 * PPM, 0, Math.PI * 2); g.fill(); }
    const map = tex(c, { aniso: 16 });
    const rc = canvas(256, 144), rg = rc.getContext('2d');
    rg.fillStyle = '#f0f0f0'; rg.fillRect(0, 0, 256, 144);
    return { map, roughness: tex(rc, { srgb: false }) };
  });
}

// Sponsor-style perimeter boards (invented brands), clean like a stadium, not a wall.
const SPONSORS = [['CAGE COLA', '#d7263d', '#fff'], ['ROOFTOP FM', '#111', '#FFD400'], ['VOLTKICK', '#1466FF', '#fff'], ['NUTMEG SPORTS', '#fff', '#111'],
  ['BLOCK PARTY', '#39FF88', '#111'], ['SC TV', '#B84DFF', '#fff'], ['KORNER', '#FF8A00', '#111'], ['STREETCAGE', '#FFD400', '#111']];
export function adBoard(seed, lengthM) {
  return once(`ad${seed}_${lengthM}`, () => {
    const PPM = 96, W = Math.round(lengthM * PPM), H = PPM;
    const c = canvas(Math.min(W, 4096), H), g = c.getContext('2d');
    g.scale(c.width / W, 1);
    let x = 0, k = seed;
    while (x < W) {
      const [word, bg, fg] = SPONSORS[k++ % SPONSORS.length];
      const w = PPM * 4;
      g.fillStyle = bg; g.fillRect(x, 0, w, H);
      g.fillStyle = fg; g.font = `900 ${H * 0.5}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(word, x + w / 2, H / 2 + 2, w - 24);
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, 0, w, 6);
      x += w;
    }
    return tex(c);
  });
}

// A scrolling LED ribbon along the front of the stands (emissive).
export function ledRibbon() {
  return once('ledribbon', () => {
    const W = 2048, H = 64, c = canvas(W, H), g = c.getContext('2d');
    let x = 0, k = 0;
    while (x < W) {
      const [word, bg, fg] = SPONSORS[k++ % SPONSORS.length];
      const w = 256;
      g.fillStyle = bg === '#fff' ? '#1a1a1a' : bg; g.fillRect(x, 0, w, H);
      g.fillStyle = fg === '#111' ? '#fff' : fg; g.font = `900 34px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(word, x + w / 2, H / 2 + 1, w - 16);
      x += w;
    }
    // LED pixel grid
    g.fillStyle = 'rgba(0,0,0,.35)';
    for (let i = 0; i < W; i += 4) g.fillRect(i, 0, 1, H);
    for (let j = 0; j < H; j += 4) g.fillRect(0, j, W, 1);
    const t = tex(c); t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}
