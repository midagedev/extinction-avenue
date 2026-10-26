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
const seed = +(process.env.SEED || process.argv[5] || 1);
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
// skill (6th arg, default 1): 1 = attentive player; 0.6 ≈ an average newcomer (more aim noise, slower mouse, slower reactions)
const skill = +(process.env.BOT_SKILL || process.argv[6] || 1);
const bot = {
  x: W / 2, y: H * 0.45, target: null, pendingKey: null, reactT: 0, down: false, noiseX: 0, noiseY: 0, noiseT: 0,
  speed: 1800 * Math.sqrt(skill), react: [0.22 / Math.sqrt(skill), 0.38 / Math.sqrt(skill)], skill
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
const slice = (s, dt = 1 / 30) => page.evaluate(([s, dt]) => { const g = window.__game; g.step(s, dt); return { s: g.summary(), t: g.threats() }; }, [s, dt]);

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
  // Wait for a moment with several pursuers on screen (and one of them winding up, if possible)
  if (mode === 'shots') r = await playFor(40, { stopAt: (x) => x.t.filter((o) => !o.type.startsWith('pickup')).length >= 4 && x.t.some((o) => o.attacking) });
  log('t', r.s.time, JSON.stringify(r.s));
  await shot(mode === 'smoke' ? 'smoke-fp' : '01-first-person');
  if (mode === 'smoke') { console.log('errors:', errors.length); await browser.close(); process.exit(errors.length ? 1 : 0); }
  // Combat zone: play until zone1 is busy on screen
  r = await playFor(220, { stopAt: (x) => x.s.beat === 'zone1' && x.t.filter((o) => !o.type.startsWith('pickup')).length >= 6 });
  log('zone', JSON.stringify(r.s));
  await shot('02-combat-zone');
  // Level-up: force one and screenshot the cards
  await page.evaluate(() => { window.__game.game.pendingLevels++; window.__game.game.enemies.attackers = 0; });
  for (let i = 0; i < 10; i++) { const s = await slice(0.05); if (s.s.state === 'levelup') break; }
  await page.evaluate(() => new Promise((res) => setTimeout(res, 700)));
  await shot('03-level-up');
  await pickCard();
  // Pterosaur at the windshield: stage one dive straight at the gunner (camera facing back, nothing else attacking)
  await page.evaluate(() => {
    const g = window.__game.game;
    for (let i = g.enemies.list.length - 1; i >= 0; i--) if (!g.enemies.list[i].boss) g.enemies._remove(i);
    g.cam.swing(0, 0, 20, 0);
    g.enemies.attackers = 0;
    g.enemies.attackGrace = 0;
    const p = g.player;
    const e = g.enemies.spawn('ptero', p.x - p.fx * 15, p.z - p.fz * 15, { y: 9, elite: true });
    e.seenT = 5; e.spawnT = 5; e.attackCd = 0; e.hoverGap = -15; e.hoverD = 0;
  });
  let found = false;
  for (let i = 0; i < 400 && !found; i++) {
    const r2 = await slice(1 / 30);
    if (r2.s.state === 'levelup') { await pickCard(); continue; }
    found = await page.evaluate(() => window.__game.game.enemies.list.some((e) => e.type === 'ptero' && e.state === 'dive' && e.stateT > 0.42));
  }
  log('ptero dive found', found);
  await shot('04-pterosaur-dive');
  // Side-street ambush: the view swings out to the side
  await page.evaluate(() => { const g = window.__game.game; g.director._run([0, 'ambush', 'right', [['raptor', 4], ['compy', 3]]]); });
  r = await playFor(2.2);
  await shot('05-ambush-swing');
  // Wreck → CONTINUE? countdown
  await page.mouse.up();
  await page.evaluate(() => { const g = window.__game.game; g.player.invuln = 0; g.hurtPlayer(9999, g.player.x, g.player.z, 'debug'); });
  for (let i = 0; i < 40; i++) { const s = await slice(0.1); if (s.s.state === 'continue') break; }
  await slice(1.6);
  await page.evaluate(() => new Promise((res) => setTimeout(res, 500)));
  await shot('06-continue');

  // ---- T. rex: a second load with ?boss&god (starts just before GRIDLOCK with a mid-game build)
  await page.goto(`${base}?test&webgl&quality=low&boss&god${extra}`);
  await page.waitForFunction(() => window.__game?.game?.state === 'playing' || window.__game?.game?.state === 'intro', null, { timeout: 900000 });
  await page.mouse.move(W / 2, H * 0.45);
  r = await playFor(30, { stopAt: (x) => x.s.state === 'bossintro' });
  await page.evaluate(() => document.getElementById('warning').classList.remove('on'));
  await slice(1.2, 1 / 60);
  await shot('07-trex-reveal');
  r = await playFor(20, { stopAt: (x) => x.s.state === 'playing' });
  r = await playFor(6);
  await shot('08-trex-chase');
  // Lunge telegraph (danger ring + stagger meter)
  await page.evaluate(() => { const g = window.__game.game; const b = g.boss; b.e.atkCd = 99; b._set(b.e, 'lunge_tele'); });
  await playFor(0.9, { botOn: false });
  await shot('09-trex-lunge-telegraph');
  // Flank: it pulls up beside the cab and the view swings to face it
  await page.evaluate(() => { const g = window.__game.game; const b = g.boss; b.e.flankSide = 1; b._set(b.e, 'flank'); });
  r = await playFor(6, { botOn: true, stopAt: (x) => x.s.boss?.mode === 'flank_tele' });
  await playFor(0.5);
  await shot('10-trex-flank');
  // Phase 3 head-on charge: it turns around ahead of the cab and the view swings forward
  await page.evaluate(() => { const g = window.__game.game; const e = g.boss.e; e.hp = e.maxHp * 0.3; e.phase = 3; g.hud.setBossPhase(3); g.boss._set(e, 'overtake'); });
  r = await playFor(14, { botOn: false, stopAt: (x) => x.s.boss?.mode === 'charge_tele' });
  await playFor(0.8, { botOn: false });
  await shot('11-trex-head-on');
  // Death: drop it to 1 HP and finish it
  await page.evaluate(() => { const g = window.__game.game; const e = g.boss.e; g.boss._clearView(); g.boss._set(e, 'chase'); e.hp = 1; g.enemies.damage(e, 50, {}); });
  await slice(2.4, 1 / 30);
  await shot('12-trex-death');
  for (let i = 0; i < 40; i++) { const s = await slice(0.5); if (s.s.state === 'levelup') await pickCard(); if (s.s.state === 'results') break; }
  await page.evaluate(() => new Promise((res) => setTimeout(res, 1700)));
  await shot('13-results');
  console.log('share:', await page.evaluate(() => window.__game.game.shareURL()));
  await browser.close();
  console.log('errors:', errors.length);
  process.exit(0);
}

if (mode === 'probe') {
  // Debug: where are the pursuers (route gap, lateral, kind/state, on screen)?
  await startRun();
  for (let k = 0; k < 8; k++) {
    await playFor(15);
    const d = await page.evaluate(() => {
      const g = window.__game.game;
      return { t: g.director.time.toFixed(0), beat: g.director.beat?.id, swing: g.cam.swingYaw.toFixed(2), speed: g.player.speed.toFixed(1),
        list: g.enemies.list.filter((e) => !e.boss).map((e) => `${e.type}/${e.kind}/${e.state} gap=${(e.gap ?? 0).toFixed(0)} d=${(e.d ?? 0).toFixed(1)} y=${e.y.toFixed(1)} on=${e.onScreen ? 1 : 0} seen=${e.seenT.toFixed(1)} t=${e.spawnT.toFixed(0)}`) };
    });
    console.log(JSON.stringify(d, null, 1));
  }
  await browser.close();
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
