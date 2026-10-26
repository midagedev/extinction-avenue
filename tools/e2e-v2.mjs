// Headless end-to-end driver for EXTINCTION AVENUE v2 (first-person rear gunner), Playwright + Chromium (SwiftShader).
//   node tools/e2e-v2.mjs <mode> [outDir] [extraParams]
// modes:
//   smoke   title → start → 20 s with the bot → a first-person screenshot
//   idle    do-nothing player (never touches the mouse): how long does the cab survive?
//   bot     human-like bot plays a whole run (continues allowed), logs balance numbers, stops after the boss
//   shots   the screenshot set for the report (first-person view, combat zone, level-up, pterosaur, T. rex, continue, results)
// The page runs with ?test (no animation loop): the script advances the simulation with __game.step() and sends REAL
// mouse events through Playwright (page.mouse.move / down / up), so input goes through the game's DOM handlers.
//
// The bot: picks the most urgent on-screen threat (attackers first, then closest), reacts after a human delay
// (220–380 ms) when its target changes, moves the mouse with a capped speed (≈1800 px/s) plus aim noise, and holds
// fire only when the crosshair is near the target (imperfect: some shots miss). It shoots supply drops when calm,
// reloads when the belt is empty (automatic) and picks upgrades with a simple preference (evolution > tail gun > new
// weapon > passive).

const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const mode = process.argv[2] || 'smoke';
const out = process.argv[3] || './.tools/shots-v2';
const extra = process.argv[4] || '';
const base = process.env.BASE_URL || 'http://127.0.0.1:8123/';
const seed = +(process.env.SEED || 1);
fs.mkdirSync(out, { recursive: true });

const W = 1280, H = 720;
const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

await page.goto(`${base}?test&webgl&quality=low${extra}`);
await page.waitForFunction(() => window.__game?.game?.state === 'title' || window.__game?.game?.state === 'playing', null, { timeout: 900000 });
// Deterministic-ish runs: seed Math.random
await page.evaluate((sd) => {
  let x = sd * 2654435761 >>> 0 || 1;
  Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}, seed);
log('loaded');

const shot = async (name) => {
  await page.evaluate(() => window.__game.render());
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 600000 });
  log('shot', name);
};
const step = (s, dt = 1 / 30) => page.evaluate(([s, dt]) => window.__game.step(s, dt), [s, dt]);

// Upgrade preference
const pickCard = async () => {
  const st = await page.evaluate(() => window.__game.summary());
  if (st.state !== 'levelup') return false;
  const c = st.choices;
  let idx = c.findIndex((x) => x.startsWith('evolution'));
  if (idx < 0) idx = c.findIndex((x) => x === 'weapon:cannon');
  if (idx < 0) idx = c.findIndex((x) => x.startsWith('weapon'));
  if (idx < 0) idx = 0;
  // Click the card like a player would
  await page.click(`#lu-cards .card >> nth=${idx}`).catch(() => page.evaluate((i) => window.__game.pick(i), idx));
  await page.mouse.move(W / 2, H * 0.45);
  return true;
};

// --------------------------------------------------------------------------------------------------------------------
// Human-like bot
const bot = {
  x: W / 2, y: H * 0.45, target: null, pendingKey: null, reactT: 0, down: false, noiseX: 0, noiseY: 0, noiseT: 0,
  speed: +(process.env.BOT_SPEED || 1800), react: [0.22, 0.38], skill: +(process.env.BOT_SKILL || 1)
};
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const keyOf = (t) => t ? `${t.type}:${Math.round(t.dist)}` : null;
async function botStep(dt, threats, enabled = true) {
  if (!enabled) { if (bot.down) { await page.mouse.up(); bot.down = false; } return; }
  // Urgency: boss collar > attackers (closest) > wrecks > others (closest); supply drops when nothing attacks
  let best = null, bestScore = -1e9;
  for (const t of threats) {
    let s = -t.dist;
    if (t.attacking) s += 200;
    if (t.boss) s += 120;
    if (t.type === 'wreck') s += 250;
    if (t.type.startsWith('pickup')) s = threats.some((o) => o.attacking) ? -500 : 50 - t.dist * 0.2;
    if (s > bestScore) { bestScore = s; best = t; }
  }
  // Reaction delay when the target changes (sticks to the current one meanwhile)
  const k = best ? best.type + Math.round(best.x / 160) + Math.round(best.y / 120) : null;
  if (k !== bot.pendingKey) { bot.pendingKey = k; bot.reactT = bot.react[0] + Math.random() * (bot.react[1] - bot.react[0]); }
  bot.reactT -= dt;
  if (bot.reactT <= 0) bot.target = best;
  const t = bot.target && threats.find((o) => o.type === bot.target.type && Math.abs(o.x - bot.target.x) < 140 && Math.abs(o.y - bot.target.y) < 120) || (bot.reactT <= 0 ? best : null);
  if (t) bot.target = t;
  // Aim noise drifts (imperfect accuracy)
  bot.noiseT -= dt;
  if (bot.noiseT <= 0) { bot.noiseT = 0.25 + Math.random() * 0.3; bot.noiseX = gauss() * 14 / bot.skill; bot.noiseY = gauss() * 12 / bot.skill; }
  let tx = W / 2, ty = H * 0.45;
  if (t) {
    const aimHead = t.head && !t.boss && Math.random() < 0.5;
    tx = (aimHead ? t.head.x : t.x) + bot.noiseX;
    ty = (aimHead ? t.head.y : t.y) + bot.noiseY;
  }
  const dx = tx - bot.x, dy = ty - bot.y, d = Math.hypot(dx, dy);
  const maxMove = bot.speed * dt;
  if (d > maxMove) { bot.x += dx / d * maxMove; bot.y += dy / d * maxMove; } else { bot.x = tx; bot.y = ty; }
  bot.x = Math.max(4, Math.min(W - 4, bot.x)); bot.y = Math.max(4, Math.min(H - 4, bot.y));
  await page.mouse.move(bot.x, bot.y);
  const onTarget = t && Math.hypot((t.x + bot.noiseX * 0) - bot.x, t.y - bot.y) < (t.boss ? 60 : 38);
  const want = !!onTarget;
  if (want !== bot.down) { if (want) await page.mouse.down(); else await page.mouse.up(); bot.down = want; }
}

// One simulation slice + threats snapshot
const slice = (s) => page.evaluate((s) => { const g = window.__game; g.step(s, 1 / 30); return { s: g.summary(), t: g.threats() }; }, s);

async function startRun() {
  await page.click('#btn-play', { timeout: 5000 }).catch(() => page.evaluate(() => document.getElementById('btn-play').click()));
  await page.mouse.move(W / 2, H * 0.45);
}

async function playFor(seconds, { botOn = true, cont = true, onSlice = null, stopAt = null } = {}) {
  const dt = 0.1;
  let r = null;
  for (let t = 0; t < seconds; t += dt) {
    r = await slice(dt);
    const st = r.s.state;
    if (st === 'levelup') { if (bot.down) { await page.mouse.up(); bot.down = false; } await pickCard(); continue; }
    if (st === 'continue') {
      stats.deaths.push(r.s.time);
      if (!cont) return r;
      await page.click('#btn-continue').catch(() => page.evaluate(() => window.__game.game.doContinue()));
      continue;
    }
    if (st === 'results') return r;
    if (onSlice && (await onSlice(r)) === 'stop') return r;
    if (stopAt && stopAt(r)) return r;
    await botStep(dt, st === 'playing' ? r.t : [], botOn && st === 'playing');
  }
  return r;
}

const stats = { deaths: [] };

if (mode === 'smoke' || mode === 'shots') {
  if (mode === 'shots') await shot('00-title');
  await startRun();
  let r = await playFor(mode === 'smoke' ? 20 : 12);
  log('t', r.s.time, JSON.stringify(r.s));
  await shot(mode === 'smoke' ? 'smoke-fp' : '01-first-person');
  if (mode === 'smoke') { console.log('errors:', errors.length); await browser.close(); process.exit(errors.length ? 1 : 0); }
  // Combat zone: play until zone1 is busy
  r = await playFor(200, { stopAt: (x) => x.s.beat === 'zone1' && x.s.enemies >= 6 });
  r = await playFor(4);
  log('zone', JSON.stringify(r.s));
  await shot('02-combat-zone');
  // Level-up: force one and screenshot the cards
  await page.evaluate(() => { window.__game.game.pendingLevels++; });
  await slice(0.1);
  await page.evaluate(() => new Promise((res) => setTimeout(res, 600)));
  await shot('03-level-up');
  await pickCard();
  // Pterosaur at the windshield: wait for a dive in progress
  await page.evaluate(() => { const g = window.__game.game; g.director.spawnChaser('ptero', 'sky'); g.director.spawnChaser('ptero', 'sky'); });
  let found = false;
  for (let i = 0; i < 300 && !found; i++) {
    const r2 = await slice(1 / 30);
    found = await page.evaluate(() => window.__game.game.enemies.list.some((e) => e.type === 'ptero' && e.state === 'dive' && e.stateT > 0.45));
    if (r2.s.state === 'levelup') await pickCard();
    await botStep(1 / 30, [], false);
  }
  await shot('04-pterosaur-dive');
  await browser.close();
  console.log('errors:', errors.length);
  process.exit(0);
}

if (mode === 'idle') {
  await startRun();
  let r;
  for (let t = 0; t < 240; t += 1) {
    r = await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 30; i++) { g.step(1 / 30, 1 / 30); if (g.game.state === 'levelup') g.pick(0); } return g.summary(); });
    if (t % 5 === 0) log(`t=${r.time} hp=${r.hp} enemies=${r.enemies} beat=${r.beat}`);
    if (r.state === 'continue' || r.state === 'dead') break;
  }
  log('IDLE survived until', r.time, 's', JSON.stringify(r));
  await browser.close();
  process.exit(0);
}

if (mode === 'bot') {
  await startRun();
  let lastLog = -10;
  let peak = 0;
  const hpLog = [];
  let bossSeen = null;
  const r = await playFor(900, {
    onSlice: async (x) => {
      peak = Math.max(peak, x.s.enemies);
      if (x.s.boss && bossSeen === null) bossSeen = x.s.time;
      if (x.s.time - lastLog >= 15) { lastLog = x.s.time; hpLog.push([x.s.time, x.s.hp]); log(`t=${x.s.time} beat=${x.s.beat} hp=${x.s.hp} lvl=${x.s.level} kills=${x.s.kills} on=${x.s.enemies} atk=${x.s.attackers} ammo=${x.s.ammo} cont=${x.s.continues} ${x.s.boss ? `BOSS ${x.s.boss.mode} ${x.s.boss.hp} p${x.s.boss.phase}` : ''}`); }
      if (process.env.STOP_AT_BOSS && x.s.boss) return 'stop';
    }
  });
  const g = await page.evaluate(() => { const g = window.__game.game; return { stats: g.stats, score: g.score, level: g.level, shots: g.weapons.shotsFired, build: g.summary().build }; });
  console.log(JSON.stringify({ seed, end: r.s, bossAt: bossSeen, deaths: stats.deaths, firstDeath: stats.deaths[0] ?? null, peakOnScreen: peak, kills: g.stats.kills, headshots: g.stats.headshots, staggers: g.stats.staggers, hitsTaken: g.stats.hitsTaken, damageTaken: Math.round(g.stats.damageTaken), accuracyHint: g.shots, score: g.score, level: g.level, build: g.build, errors: errors.length }, null, 1));
  await shot('bot-end');
  await browser.close();
  process.exit(0);
}
