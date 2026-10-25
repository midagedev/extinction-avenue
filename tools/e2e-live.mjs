// Real-time smoke test (normal animation loop, no ?test): title → click START SHIFT → play for a minute.
//   node tools/e2e-live.mjs [url] [outDir] [mobile]
const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const url = process.argv[2] || 'http://127.0.0.1:8123/?quality=low';
const out = process.argv[3] || './shots';
const mobile = process.argv[4] === 'mobile';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }
  : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
await page.goto(url);
await page.waitForFunction(() => window.__game?.game?.state === 'title', null, { timeout: 900000 });
console.log('title; backend:', await page.evaluate(() => (window.__game.game.world.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2')));
if (mobile) await page.tap('#btn-play'); else await page.click('#btn-play');
// Audio: play every recipe once to make sure none throws
const names = ['gun', 'gatling', 'shotgun', 'missile', 'explosion', 'tesla', 'saw', 'mine', 'fossilize', 'shatter_big', 'compy_chirp', 'raptor_screech',
  'brute_growl', 'trike_bellow', 'ankylo_grunt', 'ptero_cry', 'trex_roar', 'stomp', 'bite', 'tail_swipe', 'hurt', 'ram', 'gem', 'heal', 'levelup', 'evolve',
  'combo', 'ui', 'ui_hover', 'warning', 'nitro', 'crate', 'airstrike', 'bell', 'death', 'victory'];
console.log('audio ctx', await page.evaluate((list) => { const a = window.__game.game.audio; for (const n of list) a.play(n); return a.ctx && a.ctx.state; }, names));
if (!mobile) { await page.mouse.move(640, 300); await page.mouse.down(); }
await page.keyboard.down('KeyD');
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => { const g = window.__game.game; if (g.state === 'levelup') g.pick(0); return g.summary(); });
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`, s.state, 'game t', s.time, 'lvl', s.level, 'kills', s.kills);
}
await page.screenshot({ path: `${out}/live${mobile ? '-mobile' : ''}.png`, timeout: 300000 });
console.log('errors:', errors.length);
await browser.close();
