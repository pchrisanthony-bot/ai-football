// Pull frames out of a reference video with the local Chrome (no ffmpeg needed): seeks
// through it and writes PNGs (and its size / duration) to tools/play/out/<name>-NN.png.
//   node tools/play/video-frames.mjs <video.mp4> [frames=24] [name=ref] [from=0] [to=end]
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const [file, nArg = '24', name = 'ref', fromArg, toArg] = process.argv.slice(2);
if (!file) { console.error('usage: video-frames.mjs <video> [frames] [name] [from] [to]'); process.exit(1); }
const OUT = path.resolve('tools/play/out');
fs.mkdirSync(OUT, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', process.env.CHROME_PATH].find(p => p && fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const url = 'file:///' + path.resolve(file).replace(/\\/g, '/');
await page.goto('file:///' + path.resolve('index.html').replace(/\\/g, '/'));   // a file:// origin, so the video loads
const meta = await page.evaluate(async url => {
  document.body.innerHTML = '';
  const v = document.createElement('video');
  v.src = url; v.muted = true; v.preload = 'auto';
  document.body.appendChild(v);
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video error ' + (v.error && v.error.code))); });
  window.__v = v;
  return { w: v.videoWidth, h: v.videoHeight, duration: v.duration };
}, url);
const n = +nArg, t0 = fromArg != null ? +fromArg : 0, t1 = toArg != null ? +toArg : meta.duration - 0.01;
for (let i = 0; i < n; i++) {
  const t = t0 + (t1 - t0) * (n === 1 ? 0 : i / (n - 1));
  const png = await page.evaluate(async t => {
    const v = window.__v;
    await new Promise(res => { v.onseeked = res; v.currentTime = t; });
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, t);
  fs.writeFileSync(path.join(OUT, `${name}-${String(i).padStart(2, '0')}.png`), Buffer.from(png, 'base64'));
}
console.log(JSON.stringify({ ...meta, frames: n, from: t0, to: t1, out: `${OUT}/${name}-NN.png` }));
await browser.close();
