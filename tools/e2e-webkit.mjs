// Safari smoke test: Playwright WebKit, the real START flow (real-time animation loop, no ?test), desktop viewport.
//   node tools/e2e-webkit.mjs [outDir] [extraParams]
// Serves the repo under /extinction-avenue/ (the GitHub Pages base path), opens ?quality=low at 1440x900, waits for
// the title, clicks START, waits until the state is 'playing' (software rendering: up to 5 min), then checks:
//   no pageerror, the WebKit UA picks the WebGL2 backend even when navigator.gpu exists, the error screen never showed,
//   and the screenshot's 3D view is not black (mean luminance of the centre of the PNG).
// BASE_URL=https://midagedev.github.io/extinction-avenue/ runs it against the live site.
// IPHONE=1 (or extraParams containing `iphone`): devices['iPhone 15'] (iOS UA → the lowmem profile, Phone quality,
// city streaming), START by tap, plus a check that the phone profile and the city stream are on.

import zlib from 'node:zlib';

const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const path = await import('node:path');
const { webkit } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const out = process.argv[2] || './.tools/shots-webkit';
const IPHONE = process.env.IPHONE === '1' || /(^|&)iphone(&|$)/.test(process.argv[3] || '');
const extra = (process.argv[3] || '').replace(/(^|&)iphone(?=&|$)/, '');
const BASE_PATH = '/extinction-avenue/';
let base = process.env.BASE_URL;
if (!base) {
  const http = await import('node:http');
  const root = new URL('..', import.meta.url).pathname;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary' };
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!u.startsWith(BASE_PATH)) { res.writeHead(404); res.end(); return; }
    u = u.slice(BASE_PATH.length - 1);
    const f = path.join(root, u.endsWith('/') ? u + 'index.html' : u);
    if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}${BASE_PATH}`;
  server.unref();
}
fs.mkdirSync(out, { recursive: true });

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced: what Playwright writes) → mean luma of a centred box */
function pngLuma(buf, frac = 0.5) {
  let o = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('unsupported PNG'); }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported PNG colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  const x0 = Math.round(w * (1 - frac) / 2), y0 = Math.round(h * (1 - frac) / 2), x1 = w - x0, y1 = h - y0;
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = y * stride + x * bpp;
    sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; n++;
  }
  return sum / n;
}

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const browser = await webkit.launch();
const { devices } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const page = IPHONE ? await (await browser.newContext({ ...devices['iPhone 15'] })).newPage() : await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); log('[pageerror]', e.message); });
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /\[(init|webgpu|fatal|audio)\]/.test(t)) log(`[console.${m.type()}]`, t.slice(0, 300)); });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const url = IPHONE ? `${base}${extra ? `?${extra.replace(/^&/, '')}` : ''}` : `${base}?quality=low${extra}`;
log('open', url);
await page.goto(url);
await page.waitForFunction(() => window.__game?.game?.state === 'title' || window.__game?.game?.dead, null, { timeout: 600000 });
log('title reached');
check('WebKit UA picks WebGL2 even with navigator.gpu', await page.evaluate(async (bp) => {
  const { pickBackend } = await import(`${bp}js/game/backend.js`);
  return pickBackend(navigator.userAgent, new URLSearchParams(), true) === 'webgl' && pickBackend(navigator.userAgent, new URLSearchParams('webgpu'), true) === 'webgpu';
}, new URL(base).pathname), await page.evaluate(() => navigator.userAgent));
check('renderer runs the WebGL2 backend', await page.evaluate(() => !window.__game.game.world.renderer.backend.isWebGPUBackend));

if (IPHONE) {
  const p = await page.evaluate(() => { const w = window.__game.game.world; return { quality: w.quality.id, pr: w.renderer.getPixelRatio(), stream: w.stream?.info() }; });
  check('iPhone: phone profile, Phone quality, city streaming on', p.quality === 'phone' && !!p.stream && p.stream.resident > 0 && p.stream.resident < p.stream.cells, JSON.stringify(p));
  check('iPhone: sharp pixel ratio (>= 2x of a 3x screen)', p.pr >= 2, `pixel ratio ${p.pr}`);
  await page.locator('#btn-play').scrollIntoViewIfNeeded().catch(() => {});
  await page.tap('#btn-play', { force: true, timeout: 60000 });
} else await page.click('#btn-play', { timeout: 60000 });
log('START clicked');
// Outbreak map sits between the title and the run. Deploy the first sector.
const onMap = await page.waitForFunction(() => {
  const s = window.__game?.game?.state;
  return s === 'map' || s === 'playing' || s === 'intro' || window.__game?.game?.dead;
}, null, { timeout: 30000 }).then(() => page.evaluate(() => window.__game.game.state === 'map'), () => false);
if (onMap) {
  log('map open — deploying first sector');
  if (IPHONE) await page.tap('#btn-deploy', { force: true, timeout: 30000 });
  else await page.click('#btn-deploy', { timeout: 30000 });
}
const reached = await page.waitForFunction(() => window.__game.game.state === 'playing' || window.__game.game.dead, null, { timeout: 300000, polling: 1000 })
  .then(() => true, () => false);
const st = await page.evaluate(() => ({ state: window.__game.game.state, dead: !!window.__game.game.dead, frames: window.__game.game.frames, status: document.getElementById('load-status').textContent }));
log('after START', JSON.stringify(st));
check('START reaches playing', reached && st.state === 'playing' && !st.dead, JSON.stringify(st));
// A few more real frames of the run before the picture
await page.waitForFunction((f) => window.__game.game.frames >= f + 3, st.frames, { timeout: 120000, polling: 500 }).catch(() => {});
const file = path.join(out, IPHONE ? 'webkit-iphone-playing.png' : 'webkit-playing.png');
const png = await page.screenshot({ path: file });
const luma = pngLuma(png, 0.5);
check('3D view is not black', luma > 12, `centre mean luma ${luma.toFixed(1)}/255, ${file}`);
check('error screen never shown', !(await page.evaluate(() => !document.getElementById('load-error').hidden)));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
