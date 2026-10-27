// Fixed-seed gameplay screenshots + readability metrics (the visual half of tools/qa.mjs).
//   node tools/qa-shots.mjs <outDir> [--url <base>] [--root <checkout>] [--only desktop|phone] [--native]
// Chromium (SwiftShader WebGL2, ?test&webgl&god), Math.random seeded, the sim stepped by a bot that aims at the
// nearest dinosaur, frames rendered only for the captures. Profiles:
//   desktop  1440x900 @2x, ?quality=high
//   phone    devices['iPhone 15'] (393x852 @3x, iOS UA → the lowmem profile, Phone quality, city streaming), START by tap
// Two moments per profile (MOMENTS, game seconds). Each capture writes <profile>-t<sec>.png (what the player sees,
// HUD included) and returns the metrics below, measured on screenshots of the 3D view alone (HUD hidden) at DEVICE
// resolution: the browser upscales the canvas to the screen, so a low pixel ratio shows up as lost sharpness.
// The gun has been quiet for 0.5 s at each capture (no muzzle flash).
//   lumaP2 / lumaP50 / lumaP98 / spread   luma percentiles (0..255) of the frame; spread = p98 − p2
//   veil        p5 luma of the lower 45 % of the frame (the street): a milky haze lifts this dark floor
//   sharpness   mean |Laplacian| of luma (4-neighbour) ×10; edgePct = % of pixels with a luma gradient > 24
//   entropy / edgeDensity / contrast   the threejs-qa-release canvas inspector's coarse-grid metrics (p95 − p5)
//   creature    the frame is rendered again with every creature hidden; pixels that change are the creatures.
//               bgDiff = mean |Δluma| creature vs the street behind it, colorDiff = mean RGB distance (0..441),
//               edge = mean |luma| difference between the creature pixels and a 3-device-px ring around them
//   enemies     per live dinosaur on screen: the device-px height of its creature pixels inside its projected box
//               (count, median, min, by species)
// The metrics JSON is written to <outDir>/metrics.json; tools/qa.mjs compares it with tools/qa-baselines/.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

export const MOMENTS = [34, 62];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2' };
export const BASE_PATH = '/extinction-avenue/';

/** Serves `root` under /extinction-avenue/ (the GitHub Pages base path). Returns { base, close } */
export async function serve(root) {
  root = path.resolve(root) + path.sep;
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!u.startsWith(BASE_PATH)) { res.writeHead(404); res.end(); return; }
    u = u.slice(BASE_PATH.length - 1);
    const f = path.join(root, u.endsWith('/') ? u + 'index.html' : u);
    if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}${BASE_PATH}`, close: () => server.close() };
}

export async function loadPlaywright() {
  const local = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
  return import(process.env.PLAYWRIGHT || (fs.existsSync(local) ? local.href : 'playwright'));
}

// ---- in-page code -------------------------------------------------------------------------------------------------
// Seeded Math.random (mulberry32) before any game module runs: the same seed → the same spawns, bot and frames
export function seedRandom(seed) {
  // No Web Audio either: voice limits follow the audio clock (real time), so sounds would consume random numbers
  // depending on how fast this machine steps the sim
  window.AudioContext = window.webkitAudioContext = undefined;
  // A clock the captures can freeze: the gun bob and pickup spins read performance.now(), and must not move between
  // the with- and without-creature renders (or across runs)
  if (!window.__qaClock) {
    const realNow = performance.now.bind(performance);
    window.__qaClock = { frozen: null };
    performance.now = () => window.__qaClock.frozen ?? realNow();
  }
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One bot step: aim at the nearest dinosaur and fire, keep the city stream caught up (frames are not rendered)
export function botStep(s) {
  const g = window.__game, G = g.game;
  const th = g.threats().filter((t) => !t.type.startsWith('pickup')).sort((a, b) => a.dist - b.dist)[0];
  if (th) { g.setAim(th.head?.x ?? th.x, th.head?.y ?? th.y); g.fire(true); } else g.fire(false);
  g.step(s);
  if (G.state === 'levelup') g.pick(0);
  G.player.hp = G.player.maxHp;
  const st = G.world.stream;
  if (st) for (let k = 0; k < 60 && (st.info?.().pending ?? 0) > 0; k++) st.update(G.player.s);
  return G.director.time;
}

// Hides / shows the creatures (and the DOM overlays, for the metric captures). Runs in the page.
function setView({ creatures, hud }) {
  const G = window.__game.game;
  if (window.__qaClock) window.__qaClock.frozen = hud ? null : 1e6;
  G.world.scene.traverse((o) => { if (/^Skin_/.test(o.name)) o.visible = creatures; });
  let st = document.getElementById('qa-hide-hud');
  if (!hud && !st) { st = document.createElement('style'); st.id = 'qa-hide-hud'; st.textContent = 'body > *:not(#canvas-container) { visibility: hidden !important; }'; document.head.appendChild(st); }
  if (hud && st) st.remove();
  window.__game.render();
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// Measures two device-resolution screenshots of the 3D view: A (as played) and C (creatures hidden). Runs in the page.
async function measure({ a: aB64, c: cB64 }) {
  const g = window.__game, G = g.game, w = G.world, r = w.renderer, cvs = r.domElement;
  const dpr = devicePixelRatio;
  const decode = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0);
    return { c, d: x.getImageData(0, 0, c.width, c.height).data };
  };
  const A = await decode(aB64), C = await decode(cB64);
  const W = A.c.width, H = A.c.height;
  const N = W * H, a = A.d, c = C.d;
  const Y = new Float32Array(N), YC = new Float32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    Y[i] = 0.2126 * a[p] + 0.7152 * a[p + 1] + 0.0722 * a[p + 2];
    YC[i] = 0.2126 * c[p] + 0.7152 * c[p + 1] + 0.0722 * c[p + 2];
  }
  const pct = (arr, qs) => {
    const h = new Uint32Array(256);
    for (let i = 0; i < arr.length; i++) h[Math.min(255, arr[i] | 0)]++;
    return qs.map((q) => { let acc = 0; const t = q * arr.length; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= t) return v; } return 255; });
  };
  const [p2, p50, p98] = pct(Y, [0.02, 0.5, 0.98]);
  const [veil] = pct(Y.subarray(Math.floor(H * 0.55) * W), [0.05]);
  let lap = 0, edges = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1, i = y * W + 1; x < W - 1; x++, i++) {
      const v = Y[i];
      lap += Math.abs(4 * v - Y[i - 1] - Y[i + 1] - Y[i - W] - Y[i + W]);
      if (Math.abs(Y[i + 1] - Y[i - 1]) + Math.abs(Y[i + W] - Y[i - W]) > 48) edges++;
    }
  }
  const inner = (W - 2) * (H - 2);
  // the canvas inspector's coarse-grid metrics (threejs-qa-release/scripts/inspect-threejs-canvas.mjs)
  const sx = Math.max(1, Math.floor(W / 160)), sy = Math.max(1, Math.floor(H / 90)), cols = Math.floor(W / sx), rows = Math.floor(H / sy);
  const gl = new Float32Array(cols * rows), buckets = new Map();
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const p = ((gy * sy) * W + gx * sx) * 4;
    gl[gy * cols + gx] = 0.2126 * a[p] + 0.7152 * a[p + 1] + 0.0722 * a[p + 2];
    const k = `${a[p] >> 4},${a[p + 1] >> 4},${a[p + 2] >> 4}`;
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  let entropy = 0;
  for (const n of buckets.values()) { const q = n / gl.length; entropy -= q * Math.log2(q); }
  let gEdges = 0, gChecked = 0;
  for (let gy = 0; gy < rows - 1; gy++) for (let gx = 0; gx < cols - 1; gx++) {
    const i = gy * cols + gx;
    if (Math.max(Math.abs(gl[i] - gl[i + 1]), Math.abs(gl[i] - gl[i + cols])) > 12) gEdges++;
    gChecked++;
  }
  const [g5, g95] = pct(gl, [0.05, 0.95]);

  // creature mask: pixels that change when the creatures are hidden
  const mask = new Uint8Array(N);
  let mN = 0, bg = 0, col = 0;
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const dr = a[p] - c[p], dg = a[p + 1] - c[p + 1], db = a[p + 2] - c[p + 2];
    if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) > 10) { mask[i] = 1; mN++; bg += Math.abs(Y[i] - YC[i]); col += Math.sqrt(dr * dr + dg * dg + db * db); }
  }
  // ring: the mask dilated by R device px (separable box max), minus the mask
  const R = Math.max(2, Math.round(3 * dpr));
  const tmp = new Uint8Array(N), dil = new Uint8Array(N);
  for (let y = 0; y < H; y++) { let run = 0; const o = y * W; for (let x = 0; x < W + R; x++) { if (x < W && mask[o + x]) run = 2 * R + 1; if (run > 0) { const xx = x - R; if (xx >= 0 && xx < W) tmp[o + xx] = 1; run--; } } }
  for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y < H + R; y++) { if (y < H && tmp[y * W + x]) run = 2 * R + 1; if (run > 0) { const yy = y - R; if (yy >= 0 && yy < H) dil[yy * W + x] = 1; run--; } } }
  let inS = 0, ringS = 0, ringN = 0;
  for (let i = 0; i < N; i++) { if (mask[i]) inS += Y[i]; else if (dil[i]) { ringS += Y[i]; ringN++; } }

  // per-enemy screen height: creature pixels inside the projected box of each live dinosaur
  const cam = G.cam.camera, v = new cam.position.constructor();
  const enemies = [];
  for (const e of G.enemies.list) {
    if (e.ghost || e.state === 'dying' || e.state === 'launched' || e.boss) continue;
    const h = (e.sp?.height || 1) * (e.scale || 1), rad = Math.max(e.radius || 0.5, Math.hypot(e.hx - e.x, e.hz - e.z) + (e.sp?.headR || 0.3) * (e.scale || 1));
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, front = false;
    for (const dx of [-rad, rad]) for (const dz of [-rad, rad]) for (const yy of [e.y - 0.2, e.y + h * 1.25 + 0.3]) {
      v.set(e.x + dx, yy, e.z + dz).project(cam);
      if (v.z < 1) front = true;
      const px = (v.x * 0.5 + 0.5) * W, py = (-v.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    if (!front) continue;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) continue;
    let my0 = 1e9, my1 = -1, mx0 = 1e9, mx1 = -1, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0, i = y * W + x0; x <= x1; x++, i++) if (mask[i]) { n++; if (y < my0) my0 = y; if (y > my1) my1 = y; if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; }
    if (n < 6) continue;
    enemies.push({ type: e.type, h: my1 - my0 + 1, w: mx1 - mx0 + 1, px: n, box: [mx0, my0, mx1, my1], dist: +Math.hypot(e.x - G.player.x, e.z - G.player.z).toFixed(1) });
  }
  const hs = enemies.map((e) => e.h).sort((p, q) => p - q);
  const byType = {};
  for (const e of enemies) (byType[e.type] ||= []).push(e.h);
  for (const k in byType) { const s = byType[k].sort((p, q) => p - q); byType[k] = s[s.length >> 1]; }

  // thumbnail for the baseline folder (480 px wide JPEG-free PNG)
  const tw = 480, th = Math.round(H * tw / W);
  const t = document.createElement('canvas'); t.width = tw; t.height = th;
  const tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(A.c, 0, 0, tw, th);
  const r1 = (x) => +x.toFixed(1), r2 = (x) => +x.toFixed(2);
  return {
    view: { css: [innerWidth, innerHeight], dpr, pr: +r.getPixelRatio().toFixed(2), canvas: [cvs.width, cvs.height], device: [W, H], quality: w.quality?.id, gpuMB: r1((r.info.memory?.total || 0) / 1048576), state: G.state, time: r1(G.director.time) },
    lumaP2: p2, lumaP50: p50, lumaP98: p98, spread: p98 - p2, veil,
    sharpness: r2((lap / inner) * 10), edgePct: r2((edges / inner) * 100),
    entropy: r2(entropy), edgeDensity: +(gEdges / gChecked).toFixed(3), contrast: g95 - g5,
    creature: { pixels: mN, sharePct: r2((mN / N) * 100), bgDiff: mN ? r1(bg / mN) : 0, colorDiff: mN ? r1(col / mN) : 0, edge: mN && ringN ? r1(Math.abs(inS / mN - ringS / ringN)) : 0 },
    enemies: { count: hs.length, medianH: hs.length ? hs[hs.length >> 1] : 0, minH: hs[0] || 0, byType, list: enemies },
    thumb: t.toDataURL('image/png')
  };
}

export async function measureView(page) {
  await page.evaluate(setView, { creatures: true, hud: false });
  const a = (await page.screenshot({ timeout: 900000 })).toString('base64');
  await page.evaluate(setView, { creatures: false, hud: false });
  const c = (await page.screenshot({ timeout: 900000 })).toString('base64');
  await page.evaluate(setView, { creatures: true, hud: true });
  return page.evaluate(measure, { a, c });
}

// ---- driver -------------------------------------------------------------------------------------------------------
export async function captureShots({ outDir, base, only, native = false, seed = 1977, log = console.log }) {
  const { chromium, devices } = await loadPlaywright();
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const t0 = Date.now();
  const say = (...a) => log(`[shots ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
  const profiles = [
    { id: 'desktop', ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, params: '&quality=high', tap: false },
    { id: 'phone', ctx: { ...devices['iPhone 15'] }, params: '', tap: true }
  ].filter((p) => !only || p.id === only);
  const results = {}, errors = [];
  for (const prof of profiles) {
    const ctx = await browser.newContext(prof.ctx);
    await ctx.addInitScript(seedRandom, seed);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { errors.push(`${prof.id}: ${e.message}`); say('[pageerror]', prof.id, e.message.slice(0, 200)); });
    await page.goto(`${base}?test&webgl&god&nointro${prof.params}`);
    await page.waitForFunction(() => ['title', 'playing'].includes(window.__game?.game?.state), null, { timeout: 1200000 });
    await page.evaluate(seedRandom, seed); // again: async loading consumed an unpredictable share of the sequence
    if (prof.tap) { await page.$eval('#btn-play', (el) => el.scrollIntoView({ block: 'center' })); await page.tap('#btn-play', { force: true }); }
    else { await page.mouse.click(30, 30); await page.click('#btn-play', { force: true }); }
    await page.waitForFunction(() => window.__game.game.state === 'playing', null, { timeout: 120000 });
    say(prof.id, 'playing');
    for (const at of MOMENTS) {
      for (let k = 0; k < 400; k++) { const t = await page.evaluate(botStep, at - (await page.evaluate(() => window.__game.game.director.time)) > 1 ? 1 : 0.25); if (t >= at - 0.2) break; }
      await page.evaluate(() => { window.__game.fire(false); window.__game.step(0.5); });
      const name = `${prof.id}-t${at}`;
      const m = await measureView(page);
      fs.writeFileSync(path.join(outDir, `${name}.thumb.png`), Buffer.from(m.thumb.split(',')[1], 'base64'));
      delete m.thumb;
      await page.screenshot({ path: path.join(outDir, `${name}.png`), timeout: 900000 });
      results[name] = m;
      say(name, JSON.stringify({ pr: m.view.pr, sharp: m.sharpness, veil: m.veil, spread: m.spread, creature: m.creature, enemies: { n: m.enemies.count, med: m.enemies.medianH } }));
      if (native && prof.tap && at === MOMENTS[0]) {
        // the same frame at the device's full pixel ratio, for reference
        await page.evaluate(() => { const G = window.__game.game; G.world.renderer.setPixelRatio(devicePixelRatio); G.onResize(); });
        const n = await measureView(page);
        delete n.thumb;
        await page.screenshot({ path: path.join(outDir, `${name}-native.png`), timeout: 900000 });
        results[`${name}-native`] = n;
        await page.evaluate((pr) => { const G = window.__game.game; G.world.renderer.setPixelRatio(pr); G.onResize(); }, m.view.pr);
      }
    }
    await ctx.close();
  }
  await browser.close();
  const out = { date: new Date().toISOString(), base, seed, moments: MOMENTS, shots: results, pageErrors: errors };
  fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(out, null, 1));
  return out;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const outDir = args[0] && !args[0].startsWith('--') ? args[0] : './.tools/qa/shots';
  let base = opt('--url'), srv = null;
  if (!base) { srv = await serve(opt('--root') || new URL('..', import.meta.url).pathname); base = srv.base; }
  const res = await captureShots({ outDir, base, only: opt('--only'), native: args.includes('--native') });
  srv?.close();
  console.log(`wrote ${outDir}/metrics.json (${Object.keys(res.shots).length} shots, ${res.pageErrors.length} page errors)`);
  process.exit(res.pageErrors.length ? 1 : 0);
}
