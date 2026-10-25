// Headless end-to-end run of EXTINCTION AVENUE with Playwright (Chromium + SwiftShader).
//   node tools/e2e-play.mjs [baseURL] [outDir] [mode] [extraParams e.g. '&quality=low&webgl']
//   (uses ./.tools/node_modules/playwright if present, else the 'playwright' package; PLAYWRIGHT=<path> overrides)
// mode: 'full' (title → run → level-up → swarm → boss → results) | 'quick' (title + first seconds)
// The page is opened with ?test so there is no animation loop: the script advances the simulation with
// __game.step(seconds) and renders single frames for screenshots (software rendering is slow, ~5-10 s per frame).

const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT || ((await import('node:fs')).existsSync(localPW) ? localPW.href : 'playwright'));
const base = process.argv[2] || 'http://127.0.0.1:8123/';
const out = process.argv[3] || '/workspace/dino-game-shots';
const mode = process.argv[4] || 'full';
const extra = process.argv[5] || process.env.EXTRA_PARAMS || '';
const fs = await import('node:fs');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

await page.goto(`${base}?test${extra}`);
await page.waitForFunction(() => window.__game?.game?.state === 'title' || window.__game?.game?.state === 'intro' || window.__game?.game?.state === 'playing', null, { timeout: 900000 });
log('loaded', await page.evaluate(() => window.__game.summary()));

const shot = async (name) => {
  await page.evaluate(() => window.__game.render());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 });
  log('shot', name);
};
const step = (s, dt = 1 / 30) => page.evaluate(([s, dt]) => window.__game.step(s, dt), [s, dt]);
const autoPick = async () => {
  let n = 0;
  for (;;) {
    const st = await page.evaluate(() => window.__game.summary());
    if (st.state !== 'levelup') return n;
    // Prefer evolutions, then weapons
    const idx = Math.max(0, st.choices.findIndex((c) => c.startsWith('evolution')) >= 0 ? st.choices.findIndex((c) => c.startsWith('evolution')) : st.choices.findIndex((c) => c.startsWith('weapon')));
    await page.evaluate((i) => window.__game.pick(i), idx);
    n++;
    await step(0.05);
  }
};
// Plays a stretch: fire held, aim near screen centre-ahead, gentle weaving, auto level-ups
const play = async (seconds, { shotAtLevelUp = null, aim = [640, 300] } = {}) => {
  await page.evaluate(([x, y]) => { window.__game.setAim(x, y); window.__game.fire(true); }, aim);
  let leveled = false;
  for (let t = 0; t < seconds; t += 1) {
    const s = await step(1);
    if (s.state === 'levelup') {
      if (shotAtLevelUp && !leveled) { await shot(shotAtLevelUp); leveled = true; }
      await autoPick();
    }
    if (s.state === 'results' || s.state === 'dead') return s;
    await page.evaluate((k) => { window.__game.key('KeyA', k % 6 < 2); window.__game.key('KeyD', k % 6 >= 3 && k % 6 < 5); }, Math.floor(t));
  }
  return page.evaluate(() => window.__game.summary());
};

if (!process.env.SKIP_TITLE) await shot('01-title');
if (await page.evaluate(() => window.__game.game.state === 'title')) await page.evaluate(() => window.__game.start());
let s = await step(3);
log('after 3s', s);
if (mode === 'quick') { await shot('02-start'); await browser.close(); process.exit(errors.length ? 1 : 0); }

if (mode === 'swarm') {
  // Open with ?t=360&god: the MEGA SWARM event at 6:15 pours hundreds of Scuttlers onto the avenue
  s = await play(12, { aim: [640, 280] });
  const perf = await page.evaluate(() => { const t = performance.now(); window.__game.step(5, 1 / 60); return { ms: (performance.now() - t) / 300, enemies: window.__game.game.enemies.count }; });
  log('sim cost per 1/60 s tick (ms):', perf.ms.toFixed(2), 'with', perf.enemies, 'dinosaurs');
  for (let i = 0; i < 8; i++) {
    s = await step(1);
    if (s.state === 'levelup') await autoPick();
    if (s.enemies > 380) break;
  }
  log('swarm', s.enemies, 'enemies', s.time);
  await shot('04-big-swarm');
  await page.evaluate(() => { window.__game.game.pendingLevels = 1; });
  s = await step(0.1);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 700)));
  await shot('03-levelup');
  console.log('errors:', errors.length);
  await browser.close();
  process.exit(0);
}
if (mode === 'balance') {
  // A simple bot (holds fire at screen centre, weaves, takes weapons) plays until the boss or death
  for (let t = 0; t < 520; t += 30) {
    s = await play(30, { aim: [640, 320] });
    log('t', s.time, 'lvl', s.level, 'hp', s.hp, 'kills', s.kills, 'alive', s.enemies, s.state, s.boss ? `boss ${s.boss.mode} ${s.boss.hp}` : '', s.build);
    if (s.state === 'results' || s.state === 'dead') break;
  }
  await shot('20-balance-end');
  console.log('errors:', errors.length);
  await browser.close();
  process.exit(0);
}
if (mode === 'boss') {
  // ?boss starts 12 s before GRIDLOCK
  s = await play(11);
  log('pre-boss', s);
  for (let i = 0; i < 40 && s.state !== 'bossintro'; i++) s = await step(0.25);
  await page.evaluate(() => document.getElementById('warning').classList.remove('on'));
  for (const [k, dt] of [['a', 0.4], ['b', 1.2], ['c', 1.4]]) {
    s = await step(dt, 1 / 60);
    log('intro', k, JSON.stringify(await page.evaluate(() => { const g = window.__game.game; const e = g.boss.e; const c = g.cam.camera.position; return { cam: [c.x, c.y, c.z].map((v) => v.toFixed(1)), rex: e && [e.rx.toFixed(1), e.rz.toFixed(1), e.heading.toFixed(2)], head: g.boss.headPos.toArray().map((v) => v.toFixed(1)), car: [g.player.x.toFixed(1), g.player.z.toFixed(1)], mode: g.cam.mode, ct: g.cam.cine?.time, ts: g.timeScale.toFixed(2), st: g.state }; })));
    await shot(`10-boss-intro-${k}`);
  }
  for (let i = 0; i < 40 && s.state !== 'playing'; i++) s = await step(0.25);
  s = await play(9, { aim: [640, 330] });
  log('fight', s);
  await shot('11-boss-chase');
  s = await play(8, { aim: [640, 330] });
  log('fight2', s);
  await shot('12-boss-fight');
  // Finish it: drop the boss to 1 HP, keep firing
  await page.evaluate(() => { const e = window.__game.game.boss.e; if (e) { e.hp = 1; e.phase = 3; } });
  await page.evaluate(() => { const g = window.__game.game; g.enemies.damage(g.boss.e, 5, {}); });
  s = await step(2.6, 1 / 30);
  await shot('13-boss-death');
  s = await step(2.9, 1 / 30);
  log('after death', s);
  await shot('14-boss-shatter');
  for (let i = 0; i < 30 && s.state !== 'results'; i++) { s = await step(0.5); if (s.state === 'levelup') await autoPick(); }
  log('end', s);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1700)));
  await shot('15-results');
  console.log('share:', await page.evaluate(() => window.__game.game.shareURL()));
  console.log('errors:', errors.length);
  await browser.close();
  process.exit(0);
}

s = await play(14, { shotAtLevelUp: '03-levelup' });
log('t14', s);
await shot('02-early-run');
s = await play(40);
log('t55', s);
await shot('04-swarm');
console.log('errors:', errors.length);
await browser.close();
