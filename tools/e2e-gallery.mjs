// Creature gallery for before/after comparisons (Playwright + Chromium/SwiftShader, WebGL2 path).
//   node tools/e2e-gallery.mjs [outDir] [prefix] [only] [extraParams]   (e.g. '&procedural' for the v2 rigs)
// Starts a run with the director paused (?god), places specific dinosaurs at fixed route-space slots behind the cab and
// screenshots them from the gunner's seat; then starts GRIDLOCK for the T. rex hero (intro cinematic) and chase shots.
// Uses only the public game objects, so the same script captures the old procedural models and the new GLB models.

const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const out = process.argv[2] || './.tools/gallery';
const prefix = process.argv[3] || '';
const only = process.argv[4] || '';
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
fs.mkdirSync(out, { recursive: true });

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
const base = process.env.BASE_URL || `http://127.0.0.1:${server.address().port}/`;
server.unref();

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log(`[console.${m.type()}]`, m.text().slice(0, 300)); });
await page.goto(`${base}?test&webgl&quality=${process.env.QUALITY || 'low'}&god${process.env.EXTRA || process.argv[5] || ''}`);
await page.waitForFunction(() => window.__game?.game?.state === 'title', null, { timeout: 900000 });
await page.evaluate(() => {
  let x = 7 * 2654435761 >>> 0 || 1;
  Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
});
log('loaded');
await page.click('#btn-play');
await page.mouse.move(W * 0.88, H * 0.22);
const step = (s) => page.evaluate((s) => { const g = window.__game; g.step(s, 1 / 30); if (g.game.state === 'levelup') g.pick(0); return g.summary(); }, s);
for (let i = 0; i < 40; i++) { const s = await step(0.5); if (s.state === 'playing' && s.time > 4) break; }
// Pause the director, no attacks, keep the street clear
await page.evaluate(() => {
  const g = window.__game.game;
  g.director.update = () => {};
  g.enemies.attackGrace = 1e9;
  g.boss.cameoPending = false;
  window.__clear = () => { for (let i = g.enemies.list.length - 1; i >= 0; i--) g.enemies._remove(i); g.vfx.threats.length = 0; };
  // Place a dinosaur on the road `gap` metres behind the cab (negative), `d` metres to the side
  window.__place = (type, gap, d, opts = {}) => {
    const p = g.player, r = g.route.sample(p.s + gap, {});
    const e = g.enemies.spawn(type, r.x + r.rx * d, r.z + r.rz * d, { onRoad: true, heading: r.heading, ...opts });
    if (e) { e.slotGap = gap; e.slotD = d; e.seenT = 0; e.spawnT = 3; }
    return !!e;
  };
});
const shot = async (name) => {
  await page.evaluate(() => window.__game.render());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${out}/${prefix}${name}.png`, timeout: 600000 });
  log('shot', name);
};
const want = (n) => !only || only.split(',').includes(n);
// let the opening banner clear before the first framing; no tutorial hints in the shots
await step(3);
await page.addStyleTag({ content: '#hint, #prompt { display: none !important; }' });

if (want('raptor-closeup')) {
  await page.evaluate(() => { window.__clear(); window.__place('raptor', -5.6, -1.1); window.__place('raptor', -9.5, 2.6); window.__place('compy', -7, 0.9); });
  await step(1.6);
  // the far one snarls (crouch + telegraph)
  await page.evaluate(() => { const e = window.__game.game.enemies.list.find((x) => x.type === 'raptor' && x.slotGap < -9); if (e) { e.state = 'windup'; e.stateT = 0; e.windT = 9; } });
  await step(0.5);
  await shot('raptor-closeup');
}
if (want('pack-chase')) {
  await page.evaluate(() => {
    window.__clear();
    const P = window.__place;
    P('raptor', -8, -2.4); P('raptor', -10, 2.2); P('raptor', -13, -0.4); P('raptor', -16, 3.4); P('raptor', -19, -3.4);
    P('compy', -6.5, 1.2); P('compy', -7.5, -0.9); P('compy', -9, 3.4); P('compy', -11, -3.1);
    P('brute', -20, 0.6);
  });
  await step(2.2);
  await shot('pack-chase');
}
if (want('pterosaur')) {
  await page.evaluate(() => {
    window.__clear();
    const g = window.__game.game, p = g.player;
    for (const [gap, d, y, wind] of [[-12, -1.4, 3.7, false], [-19, 4.2, 5.6, false]]) {
      const r = g.route.sample(p.s + gap, {});
      const e = g.enemies.spawn('ptero', r.x + r.rx * d, r.z + r.rz * d, { y });
      if (e) { e.hoverGap = gap; e.hoverD = d; e.hoverY = y; e.vx = p.vx; e.vz = p.vz; e.spawnT = 3; if (wind) { e.state = 'windup'; e.stateT = 0; e.windT = 9; } }
    }
  });
  await step(1.2);
  await shot('pterosaur');
}
if (want('armored-charger')) {
  await page.evaluate(() => { window.__clear(); window.__place('trike', -12.5, -0.5); window.__place('ankylo', -9.5, 4.4); });
  await step(2.5);
  // Wind the Hornwall up for its charge (head down, pawing, lane telegraph)
  await page.evaluate(() => { const g = window.__game.game; const e = g.enemies.list.find((x) => x.type === 'trike'); if (e) { e.state = 'windup'; e.stateT = 0; e.windT = 9; e.laneD = 0; } });
  await step(0.8);
  await shot('armored-charger');
}
if (want('trex')) {
  await page.evaluate(() => { window.__clear(); const g = window.__game.game; g.boss.start(); });
  // Intro cinematic runs in slow motion; the close-up keyframe is around 1.4–2.4 s of real time
  for (let i = 0; i < 12; i++) await step(0.1);
  await shot('trex-hero');
  for (let i = 0; i < 6; i++) await step(0.1);
  await shot('trex-hero2');
  for (let i = 0; i < 80; i++) { const s = await step(0.1); if (s.state === 'playing') break; }
  await page.evaluate(() => { const b = window.__game.game.boss; b.e.atkCd = 99; });
  await step(2.5);
  await shot('trex-chase');
  await page.evaluate(() => { const g = window.__game.game; const b = g.boss; b._set(b.e, 'lunge_tele'); });
  await step(1.1);
  await shot('trex-lunge');
}
await browser.close();
log('done');
process.exit(0);
