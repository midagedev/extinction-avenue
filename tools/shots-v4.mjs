// v4 deliverable screenshots: gameplay with audio live, the boss fight, and the audio settings / pause sound controls on
// desktop and on a phone (portrait, touch).
//   node tools/shots-v4.mjs <outDir>
const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const path = await import('node:path');
const http = await import('node:http');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const out = process.argv[2] || './.tools/shots-v4';
fs.mkdirSync(out, { recursive: true });
const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary' };
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
const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const errors = [];

async function open(ctx, params) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors.push(e.message); log('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); log('[console.error]', m.text().slice(0, 300)); } });
  await page.goto(`${base}?test&webgl&quality=low${params}`);
  await page.waitForFunction(() => ['title', 'playing'].includes(window.__game?.game?.state), null, { timeout: 900000 });
  return page;
}
const shot = async (page, file, el) => {
  await page.evaluate(() => window.__game.render());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  if (el) await (await page.$(el)).screenshot({ path: `${out}/${file}`, timeout: 600000 });
  else await page.screenshot({ path: `${out}/${file}`, timeout: 600000 });
  log('shot', file, JSON.stringify(await page.evaluate(() => { const s = window.__game.game.audio.stats(); return { music: s.music, state: s.musicState, voices: s.voices, heat: s.heat }; })));
};
// aim at the most urgent threat and hold fire (bot from e2e-audio)
const bot = (page, s) => page.evaluate((s) => {
  const g = window.__game;
  const th = g.threats().filter((t) => !t.type.startsWith('pickup')).sort((a, b) => (b.attacking - a.attacking) || (a.dist - b.dist))[0];
  if (th) { g.setAim(th.head?.x ?? th.x, th.head?.y ?? th.y); g.fire(true); } else g.fire(false);
  g.step(s);
  if (g.game.state === 'levelup') g.pick(0);
  if (g.game.player.hp < 40) g.game.player.hp = g.game.player.maxHp;
  return { t: g.game.director.time, n: g.threats().filter((t) => !t.type.startsWith('pickup')).length };
}, s);

// argv[3] = 'phone': only the phone shots
if (process.argv[3] !== 'phone') await deskShots();
await phoneShots();

async function deskShots() {
// --- desktop: combat + boss ----------------------------------------------------------------------------------------------
const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
let page = await open(desk, '');
await page.mouse.click(30, 30);
await page.waitForFunction(() => window.__game.game.audio.ctx?.state === 'running', null, { timeout: 10000 });
await page.click('#btn-play');
await page.waitForFunction(() => window.__game.game.state === 'playing', null, { timeout: 20000 });
for (let k = 0; k < 60; k++) {
  const r = await bot(page, 1);
  if (r.t > 40 && r.n >= 3) break;
}
await bot(page, 0.2);
await shot(page, 'v4-01-gameplay-combat.png');
await page.close();

page = await open(desk, '&boss');
await page.mouse.click(30, 30);
await page.waitForFunction(() => window.__game.game.audio.ctx?.state === 'running', null, { timeout: 10000 });
await page.waitForFunction(() => window.__game.game.state === 'playing', null, { timeout: 20000 });
for (let k = 0; k < 40; k++) { await bot(page, 0.5); if (await page.evaluate(() => window.__game.game.boss.active)) break; }
for (let k = 0; k < 12; k++) await bot(page, 0.5);
await page.waitForFunction(() => window.__game.game.audio.md.cur?.id?.startsWith('boss'), null, { timeout: 60000 }).catch(() => {});
await shot(page, 'v4-02-boss-fight.png');
await page.close();

// --- desktop: settings + pause --------------------------------------------------------------------------------------------
page = await open(desk, '');
await page.mouse.click(30, 30);
await page.click('#btn-settings');
await page.waitForTimeout(400);
await shot(page, 'v4-03-settings-audio-desktop.png');
await page.click('#s-settings [data-close]');
await page.click('#btn-play');
await page.waitForFunction(() => window.__game.game.state === 'playing', null, { timeout: 20000 });
for (let k = 0; k < 15; k++) await bot(page, 1);
await page.evaluate(() => window.__game.fire(false));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot(page, 'v4-04-pause-sound-toggle-desktop.png');
await page.close();
await desk.close();
}

async function phoneShots() {
// --- phone (portrait, touch) -------------------------------------------------------------------------------------------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
const page = await open(phone, '&god');
// the title menu keeps animating (never "stable" for Playwright): bring the button into view and tap it anyway
const tapForce = async (sel) => { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.tap(sel, { force: true }); };
await tapForce('#btn-settings');
await page.waitForTimeout(400);
await shot(page, 'v4-05-settings-audio-mobile.png');
await tapForce('#s-settings [data-close]');
await tapForce('#btn-play');
await page.waitForFunction(() => window.__game.game.state === 'playing', null, { timeout: 20000 });
for (let k = 0; k < 40; k++) {
  const r = await bot(page, 1);
  if (r.t > 25 && r.n >= 2) break;
}
await shot(page, 'v4-06-gameplay-mobile.png');
await page.evaluate(() => window.__game.fire(false));
await tapForce('#t-pause');
await page.waitForTimeout(400);
await shot(page, 'v4-07-pause-sound-toggle-mobile.png');
await phone.close();
}

await browser.close();
server.close();
console.log(errors.length ? `errors: ${errors.length}` : 'errors: 0');
process.exit(errors.length ? 1 : 0);
