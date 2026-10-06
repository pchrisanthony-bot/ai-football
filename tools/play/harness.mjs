// Play harness: drives the real game in Chrome with real keyboard input.
// Two ways to advance time:
//   • frame-accurate: step(n) freezes the real-time loop and advances exactly n
//     frames at 60 fps (every frame rendered) — use this for gameplay scenarios and
//     screenshots, so nothing moves while a screenshot is taken;
//   • real time: leave the loop running — only for performance measurement.
// Needs the dev server (npm run dev) and a local Chrome (CHROME_PATH to override).
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

export const OUT = path.resolve('tools/play/out');
fs.mkdirSync(OUT, { recursive: true });
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const CHROMES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].filter(Boolean);

export async function harness({ w = 1280, h = 720, touch = false, url = 'http://localhost:5173/', query = '' } = {}) {
  const executablePath = CHROMES.find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome found — set CHROME_PATH');
  const browser = await puppeteer.launch({
    executablePath, headless: 'new',
    args: ['--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', `--window-size=${w},${h}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 300)));
  await page.goto(url + query, { waitUntil: 'networkidle0', timeout: 180000 });
  // the players' bodies load first; the title (and __G.menu) comes up after
  for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(window.__G && window.__G.menu))) break; await sleep(100); }
  await sleep(600);
  await page.mouse.click(4, h - 4);   // focus + audio unlock (a first tap on empty space)
  await sleep(150);
  const H = {
    page, browser, errors,
    eval: (fn, ...a) => page.evaluate(fn, ...a),
    // Start a match from the menus. settings: labels → option index (e.g. { VENUE: 1 }).
    async start(settings = {}, { spectate = false } = {}) {
      await page.evaluate(async (settings, spectate) => {
        const pick = re => __G.menu.items.find(i => re.test(i.label));
        pick(spectate ? /WATCH AI/ : /PLAY MATCH/).action(); await new Promise(r => setTimeout(r, 60));
        for (const [label, v] of Object.entries(settings)) { const it = __G.menu.items.find(i => i.label === label); if (it && it.onChange) { it.onChange(v); it.value = v; } }
        pick(/KICK OFF|WATCH/).action(); await new Promise(r => setTimeout(r, 120));
        pick(/KICK OFF|WATCH/).action();
      }, settings, spectate);
      for (let i = 0; i < 80; i++) { if (await page.evaluate(() => __G.state) === 'match') break; await sleep(60); }
    },
    // ---- frame-accurate control
    step: (n = 1) => page.evaluate(n => { __tick(1 / 60, n); }, n),
    async down(...keys) { for (const k of keys) await page.keyboard.down(k); },
    async up(...keys) { for (const k of keys) await page.keyboard.up(k); },
    async hold(keys, frames) { await H.down(...keys); await H.step(frames); await H.up(...keys); },
    async tap(key, frames = 4) { await page.keyboard.down(key); await H.step(frames); await page.keyboard.up(key); await H.step(1); },
    async shot(name) { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); return f; },
    async film(name, frames, n) { const out = []; for (let i = 0; i < n; i++) { await H.step(Math.round(frames / n)); out.push(await H.shot(`${name}-${i}`)); } return out; },
    // ---- real time
    resume: () => page.evaluate(() => __auto()),
    telemetry: () => page.evaluate(() => window.__telemetry ? __telemetry() : null),
    async close() { await browser.close(); },
  };
  return H;
}
