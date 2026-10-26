// Headless touch-aiming test for EXTINCTION AVENUE (Playwright + Chromium mobile emulation, real CDP touch events).
//   node tools/e2e-touch.mjs [outDir] [portrait|landscape|all] [seed]
// Checks, per orientation:
//   - drag mode (default): touching does NOT move the crosshair to the finger; dragging moves it by the finger's delta;
//     the gun only fires while a finger is down AND the crosshair is on a target; the crosshair stays where it was
//     when the finger lifts; the finger is always far from the crosshair
//   - offset mode: the crosshair sits OFFSET px above the finger and fires while held
// Screenshots draw a translucent "thumb" where the finger touches so the shots show the crosshair clear of it.

const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const out = process.argv[2] || './.tools/shots-touch';
const which = process.argv[3] || 'all';
const seed = +(process.argv[4] || 3);
fs.mkdirSync(out, { recursive: true });

// Serve the repo from inside the test
const http = await import('node:http');
const path = await import('node:path');
const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(root, u.endsWith('/') ? u + 'index.html' : u);
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
server.unref();

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const results = {};
let failures = 0;
const check = (res, name, ok, info = '') => { res[name] = ok ? 'PASS' : `FAIL ${info}`; if (!ok) failures++; log(ok ? 'PASS' : 'FAIL', name, info); };

async function run(orient) {
  const [W, H] = orient === 'portrait' ? [390, 844] : [844, 390];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('[pageerror]', e.message));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 18, radiusY: 22 }] });
  const res = {};
  results[orient] = res;
  await page.goto(`${base}?test&webgl&quality=low&god`);
  await page.waitForFunction(() => window.__game?.game?.state === 'title', null, { timeout: 900000 });
  await page.evaluate((sd) => {
    let x = sd * 2654435761 >>> 0 || 1;
    Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }, seed);
  check(res, 'starts-in-touch-mode', await page.evaluate(() => document.body.classList.contains('touch')));
  await page.tap('#btn-play');
  const step = (s) => page.evaluate((s) => { const g = window.__game; g.step(s, 1 / 30); if (g.game.state === 'levelup') g.pick(0); return g.summary(); }, s);
  const ts = () => page.evaluate(() => window.__game.touchState());
  const threats = () => page.evaluate(() => window.__game.threats().filter((t) => !t.type.startsWith('pickup') && t.type !== 'wreck'));
  // Play until a few dinosaurs are on screen
  for (let i = 0; i < 80; i++) {
    const s = await step(0.5);
    if (s.state === 'playing' && (await threats()).length >= 2 && s.time > 8) break;
  }
  log(orient, 'in play', JSON.stringify(await step(0)));

  // --- Drag mode ---------------------------------------------------------------------------------------------------
  const c0 = await ts();
  check(res, 'default-mode-is-drag', c0.mode === 'drag', c0.mode);
  // Thumb rests in the lower right of the screen (thumb zone), away from the crosshair
  let fx = W * 0.62, fy = H * 0.8;
  await touch('touchStart', fx, fy);
  await step(1 / 30);
  let c = await ts();
  check(res, 'touch-does-not-teleport-crosshair', Math.hypot(c.x - c0.x, c.y - c0.y) < 2 && c.touching, JSON.stringify({ c0, c }));
  // Drag 40 px left: the crosshair moves left by about the same (gain ~1–2.5)
  for (let k = 0; k < 4; k++) { fx -= 10; await touch('touchMove', fx, fy); }
  await step(1 / 30);
  const c1 = await ts();
  const moved = c0.x - c1.x;
  check(res, 'drag-moves-crosshair-by-delta', moved > 25 && moved < 140 && Math.abs(c1.y - c0.y) < 30, `dx=${moved.toFixed(1)} dy=${(c1.y - c0.y).toFixed(1)}`);
  // Drag onto a dinosaur in small finger steps (closed loop, like a player)
  let firedOnTarget = false, firedOffTarget = false, ammoStart = c1.ammo, minFingerDist = 1e9, onTargetFrames = 0;
  for (let i = 0; i < 90; i++) {
    const th = await threats();
    c = await ts();
    if (c.fire && !c.target) firedOffTarget = firedOffTarget || !(await page.evaluate(() => window.__game.game.touchOnT > 0));
    if (c.fire && c.target) { firedOnTarget = true; onTargetFrames++; }
    minFingerDist = Math.min(minFingerDist, Math.hypot(c.x - fx, c.y - fy));
    if (onTargetFrames > 12) break;
    if (!th.length) { await step(0.1); continue; }
    th.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    const t = th[0];
    const dx = Math.max(-14, Math.min(14, (t.x - c.x) * 0.5)), dy = Math.max(-14, Math.min(14, (t.y - c.y) * 0.5));
    // Keep the thumb inside the screen (re-grip if it runs out of room, like a real thumb would)
    if (fx + dx < 20 || fx + dx > W - 20 || fy + dy < H * 0.35 || fy + dy > H - 10) {
      await touch('touchEnd'); fx = W * 0.62; fy = H * 0.8; await touch('touchStart', fx, fy);
    } else { fx += dx; fy += dy; await touch('touchMove', fx, fy); }
    await step(1 / 30);
  }
  c = await ts();
  check(res, 'fires-when-dragged-onto-target', firedOnTarget && c.ammo !== ammoStart || firedOnTarget, `onTargetFrames=${onTargetFrames} ammo ${ammoStart}->${c.ammo}`);
  check(res, 'no-fire-off-target-in-drag-mode', !firedOffTarget);
  check(res, 'finger-never-near-crosshair', minFingerDist > 70, `min=${minFingerDist.toFixed(0)}px`);
  // Screenshot with the thumb drawn in (while held)
  await showThumb(page, fx, fy, 'DRAG AIM — thumb anywhere, crosshair stays put');
  await shot(page, `${out}/mobile-${orient}-drag.png`);
  // Lift: crosshair stays, no fire
  const cHeld = await ts();
  await touch('touchEnd');
  await step(1 / 30);
  const cUp = await ts();
  check(res, 'crosshair-stays-on-lift', Math.hypot(cUp.x - cHeld.x, cUp.y - cHeld.y) < 30 && !cUp.touching && !cUp.fire, JSON.stringify({ cHeld, cUp }));
  await hideThumb(page);

  // --- Offset mode -------------------------------------------------------------------------------------------------
  await page.evaluate(() => { const g = window.__game.game; g.settings.touchAim = 'offset'; g._applyTouchSettings(); });
  const px = W * 0.5, py = H * 0.75;
  await touch('touchStart', px, py);
  await step(1 / 30);
  c = await ts();
  check(res, 'offset-mode-crosshair-above-finger', c.mode === 'offset' && Math.abs(c.x - px) < 40 && py - c.y > 80 && py - c.y < 125, JSON.stringify(c));
  check(res, 'offset-mode-fires-while-held', c.fire);
  await showThumb(page, px, py, 'OFFSET AIM — crosshair floats above the finger');
  await shot(page, `${out}/mobile-${orient}-offset.png`);
  await touch('touchEnd');
  await hideThumb(page);
  await page.evaluate(() => { const g = window.__game.game; g.settings.touchAim = 'drag'; g._applyTouchSettings(); });
  // HUD fits: touch buttons and HUD panels inside the viewport and not overlapping each other
  const boxes = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom, sel } : null; };
    return ['#t-reload', '#t-special', '#t-pause', '#ammo', '.hud-tl', '.hud-tr', '.hud-tc', '.build', '#reticle'].map(r).filter(Boolean);
  });
  const inside = boxes.filter((b) => b.sel !== '#reticle').every((b) => b.l >= -1 && b.t >= -1 && b.r <= W + 1 && b.b <= H + 1);
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const ui = boxes.filter((b) => b.sel !== '#reticle');
  const overlaps = [];
  for (let i = 0; i < ui.length; i++) for (let j = i + 1; j < ui.length; j++) if (hit(ui[i], ui[j])) overlaps.push(`${ui[i].sel}×${ui[j].sel}`);
  check(res, 'hud-inside-viewport', inside, JSON.stringify(boxes.filter((b) => !(b.l >= -1 && b.t >= -1 && b.r <= W + 1 && b.b <= H + 1))));
  check(res, 'hud-no-overlaps', overlaps.length === 0, overlaps.join(', '));
  const ret = boxes.find((b) => b.sel === '#reticle');
  if (ret) res.reticlePx = Math.round(ret.r - ret.l);
  await shot(page, `${out}/mobile-${orient}-hud.png`);
  await ctx.close();
}

async function showThumb(page, x, y, label) {
  await page.evaluate(([x, y, label]) => {
    let d = document.getElementById('test-thumb');
    if (!d) {
      d = document.createElement('div');
      d.id = 'test-thumb';
      d.innerHTML = '<i></i><span></span>';
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99;pointer-events:none;';
      d.querySelector('i').style.cssText = 'position:absolute;left:-30px;top:-34px;width:60px;height:150px;border-radius:30px 30px 26px 26px;background:rgba(232,176,140,.72);border:2px solid rgba(120,70,40,.8);transform:rotate(-24deg);transform-origin:30px 34px;box-shadow:0 0 0 2px rgba(0,0,0,.25)';
      d.querySelector('span').style.cssText = 'position:absolute;left:-120px;top:60px;width:240px;text-align:center;font:700 12px sans-serif;color:#fff;text-shadow:0 1px 2px #000';
      document.body.appendChild(d);
    }
    d.style.transform = `translate(${x}px, ${y}px)`;
    d.querySelector('span').textContent = label;
    d.style.display = 'block';
  }, [x, y, label]);
}
async function hideThumb(page) { await page.evaluate(() => { const d = document.getElementById('test-thumb'); if (d) d.style.display = 'none'; }); }
async function shot(page, file) {
  await page.evaluate(() => window.__game.render());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: file, timeout: 600000 });
  log('shot', file);
}

for (const o of which === 'all' ? ['portrait', 'landscape'] : [which]) await run(o);
console.log(JSON.stringify(results, null, 1));
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
await browser.close();
process.exit(failures ? 1 : 0);
