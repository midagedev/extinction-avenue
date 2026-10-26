// Headless audio checks for EXTINCTION AVENUE v4 (Playwright + Chromium, which runs WebAudio on a fake output device).
//   node tools/e2e-audio.mjs [shotsDir]
// 1. no AudioContext is constructed before the first gesture (the constructor is wrapped, so this covers every code
//    path) and no autoplay warnings; a click unlocks it and the title theme starts
// 2. settings: mute / master / music / effects / announcer persist in localStorage and come back after a reload
//    (store, engine and slider values); screenshot of the audio settings
// 3. every SFX group and the run cues decode; a run with a simple bot: voices play, the voice cap holds, the master
//    peak stays under 0 dBFS, the run cue follows the heat (breather / combat / combat_hi + heat layer)
// 3b. phone memory budget (?musicbudget=140): decoded music stays under it while the run cues keep changing
// 4. ?boss: warning → sting, boss1 → phase 2 boss2 (intro → loop) → phase 3 boss3 → victory sting → results loop
// 5. death → continue loop → give up → game-over jingle → results loop; a new run cuts a still-playing jingle
// 6. no console errors / page errors / autoplay-policy warnings anywhere
const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const path = await import('node:path');
const http = await import('node:http');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const shots = process.argv[2] || './.tools/shots-audio';
fs.mkdirSync(shots, { recursive: true });
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
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(ok ? 'PASS' : 'FAIL', name, typeof info === 'string' ? info : JSON.stringify(info)); };
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const errors = [];
// Chromium's autoplay-policy warning ("The AudioContext was not allowed to start…") is a console warning, not an error
const autoplayRe = /AudioContext was not allowed|user gesture|autoplay/i;

async function open(params, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('[pageerror]', e.message); });
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && autoplayRe.test(m.text()))) { errors.push(`console.${m.type()}: ${m.text()}`); console.log(`[console.${m.type()}]`, m.text().slice(0, 300)); }
  });
  // record every AudioContext construction and whether the page had a user activation at that moment
  await page.addInitScript(() => {
    window.__acLog = [];
    for (const k of ['AudioContext', 'webkitAudioContext']) {
      const C = window[k];
      if (!C) continue;
      window[k] = class extends C {
        constructor(...a) { super(...a); window.__acLog.push({ activated: !!navigator.userActivation?.hasBeenActive, state: this.state }); }
      };
    }
  });
  await page.goto(`${base}?test&webgl&quality=low${params}`);
  await page.waitForFunction(() => ['title', 'playing'].includes(window.__game?.game?.state), null, { timeout: 900000 });
  return page;
}
const stats = (page) => page.evaluate(() => window.__game.game.audio.stats());
const until = async (page, fn, arg, timeout = 30000) => { try { await page.waitForFunction(fn, arg, { timeout, polling: 200 }); return true; } catch { return false; } };
const step = (page, s) => page.evaluate((s) => window.__game.step(s), s);

// --- 1. gesture unlock + title -----------------------------------------------------------------------------------------
let page = await open('');
log('title up');
await page.waitForTimeout(3000); // idle on the title without any input: nothing may start
check('no AudioContext before the first gesture', await page.evaluate(() => !window.__game.game.audio.ctx && window.__acLog.length === 0), await page.evaluate(() => window.__acLog));
await page.mouse.click(30, 30);
check('first click unlocks a running AudioContext', await until(page, () => window.__game.game.audio.ctx?.state === 'running', null, 10000), await page.evaluate(() => window.__game.game.audio.ctx?.state));
check('title theme starts', await until(page, () => window.__game.game.audio.md.cur?.id === 'title', null, 30000), (await stats(page)).music);
const acs = await page.evaluate(() => window.__acLog);
check('the only AudioContext was created inside a user gesture', acs.length === 1 && acs[0].activated, acs);

// --- 2. settings -------------------------------------------------------------------------------------------------------
await page.click('#btn-settings');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('set-master', 0.8); set('set-music', 0.45); set('set-sfx', 0.9);
});
await page.waitForTimeout(300);
const panel = await page.$('#s-settings .panel');
await panel.screenshot({ path: `${shots}/audio-settings.png` });
await page.screenshot({ path: `${shots}/audio-settings-full.png` });
await page.click('#set-mute');
await page.waitForTimeout(200);
const muted = await page.evaluate(() => ({ enabled: window.__game.game.audio.enabled, store: JSON.parse(localStorage.getItem('ea-audio')), label: document.querySelector('#set-mute b').textContent }));
check('mute toggles and persists', !muted.enabled && muted.store.enabled === false && muted.label === 'MUTED', muted);
await page.screenshot({ path: `${shots}/audio-settings-muted.png` });
// reload while muted: mute comes back
await page.reload();
await page.waitForFunction(() => window.__game?.game?.state === 'title', null, { timeout: 900000 });
const mutedBack = await page.evaluate(() => ({ enabled: window.__game.game.audio.enabled, label: document.querySelector('#set-mute b').textContent, ac: window.__acLog.length }));
check('mute restored after reload (and still no AudioContext)', !mutedBack.enabled && mutedBack.label === 'MUTED' && mutedBack.ac === 0, mutedBack);
await page.mouse.click(30, 30);
await page.click('#btn-settings');
await page.waitForTimeout(400);
await page.click('#set-mute');
await page.click('#set-announcer');
const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem('ea-audio')));
check('volumes + announcer persist in localStorage', st2.enabled && st2.volume.master === 0.8 && st2.volume.music === 0.45 && st2.volume.sfx === 0.9 && st2.announcer === false, st2);
await page.click('#set-announcer');
await page.click('#s-settings [data-close]');
// reload: settings come back
await page.reload();
await page.waitForFunction(() => window.__game?.game?.state === 'title', null, { timeout: 900000 });
const back = await page.evaluate(() => ({ v: { ...window.__game.game.audio.volume }, enabled: window.__game.game.audio.enabled, sl: ['set-master', 'set-music', 'set-sfx'].map((id) => document.getElementById(id).value), a: document.getElementById('set-announcer').checked }));
check('volumes restored after reload (engine + sliders)', back.enabled && back.v.master === 0.8 && back.v.music === 0.45 && back.v.sfx === 0.9 && back.sl.join() === '0.8,0.45,0.9' && back.a === true, back);
await page.mouse.click(30, 30);
await until(page, () => window.__game.game.audio.ctx?.state === 'running', null, 10000);

// --- 3. loading + a run ------------------------------------------------------------------------------------------------
const loaded = await until(page, () => { const s = window.__game.game.audio.stats(); return s.sfxLoaded === s.sfxTotal && s.musicLoaded.includes('combat') && s.musicLoaded.includes('breather') && s.musicLoaded.includes('combat_hi') && s.musicLoaded.includes('combat_heat'); }, null, 120000);
check('all SFX groups + run cues decoded', loaded, await stats(page));
const boss0 = (await stats(page)).musicLoaded.filter((m) => m.startsWith('boss') && m !== 'boss_sting');
check('boss music not loaded up front (lazy)', boss0.length === 0, boss0);
await page.click('#btn-play');
await until(page, () => window.__game.game.state === 'playing', null, 20000);
const seen = { cues: new Set(), maxVoices: 0, maxPeak: 0, maxPre: 0, maxLayer: 0, peaks: [] };
for (let k = 0; k < 75; k++) {
  // simple bot: aim at the most urgent threat and hold fire
  await page.evaluate(() => {
    const g = window.__game;
    const th = g.threats().filter((t) => !t.type.startsWith('pickup')).sort((a, b) => (b.attacking - a.attacking) || (a.dist - b.dist))[0];
    if (th) { g.setAim(th.head?.x ?? th.x, th.head?.y ?? th.y); g.fire(true); } else g.fire(false);
    if (g.game.state === 'levelup') g.pick(0);
    if (g.game.player.hp < 40) g.game.player.hp = g.game.player.maxHp; // keep the bot alive for the long check
  });
  await step(page, 2);
  await page.waitForTimeout(250);
  const s = await stats(page);
  if (s.music) seen.cues.add(s.music);
  seen.maxVoices = Math.max(seen.maxVoices, s.voices);
  seen.maxPeak = Math.max(seen.maxPeak, s.peak || 0);
  seen.maxPre = Math.max(seen.maxPre, s.peakPre || 0);
  seen.maxLayer = Math.max(seen.maxLayer, s.layer);
  if (k % 10 === 0) log(`run t=${(await page.evaluate(() => window.__game.game.director.time)).toFixed(0)} cue=${s.music} heat=${s.heat} layer=${s.layer} voices=${s.voices} peak=${s.peak}`);
}
await page.evaluate(() => window.__game.fire(false));
check('run music moved between cues', seen.cues.size >= 2, [...seen.cues]);
check('voices played and stayed under the cap', seen.maxVoices > 0 && seen.maxVoices <= 44, seen.maxVoices);
check('master peak below 0 dBFS (output)', seen.maxPeak > 0.01 && seen.maxPeak < 1.0, seen.maxPeak);
check('limiter keeps the level under 0 dBFS before the safety clipper', seen.maxPre < 1.0, seen.maxPre);
check('heat layer faded in at some point', seen.maxLayer > 0.05, seen.maxLayer);
await page.screenshot({ path: `${shots}/audio-run.png` });
await page.close();

// --- 3b. memory budget ------------------------------------------------------------------------------------------------
page = await open('&musicbudget=140');
await page.mouse.click(30, 30);
await until(page, () => window.__game.game.audio.ctx?.state === 'running', null, 10000);
await until(page, () => window.__game.game.audio.md.cur?.id === 'title', null, 30000);
await until(page, () => window.__game.game.audio.stats().musicLoaded.includes('breather'), null, 60000);
await page.click('#btn-play');
await until(page, () => window.__game.game.state === 'playing', null, 20000);
const tight = { cues: new Set(), maxMB: 0, silent: 0 };
for (let k = 0; k < 40; k++) {
  await page.evaluate(() => {
    const g = window.__game;
    const th = g.threats().filter((t) => !t.type.startsWith('pickup')).sort((a, b) => (b.attacking - a.attacking) || (a.dist - b.dist))[0];
    if (th) { g.setAim(th.head?.x ?? th.x, th.head?.y ?? th.y); g.fire(true); } else g.fire(false);
    if (g.game.state === 'levelup') g.pick(0);
    if (g.game.player.hp < 40) g.game.player.hp = g.game.player.maxHp;
  });
  await step(page, 2);
  await page.waitForTimeout(250);
  const s = await stats(page);
  if (s.music) tight.cues.add(s.music); else if (k > 3) tight.silent++;
  tight.maxMB = Math.max(tight.maxMB, s.musicMB);
  if (k % 10 === 0) log(`budget run cue=${s.music} musicMB=${s.musicMB} loaded=${s.musicLoaded.join(',')}`);
}
await page.evaluate(() => window.__game.fire(false));
check('decoded music stays under a 140 MB budget', tight.maxMB > 0 && tight.maxMB <= 140, tight.maxMB);
check('run cues still change under the budget (evicted cues decode again)', tight.cues.size >= 2 && tight.silent <= 2, { cues: [...tight.cues], silentSamples: tight.silent });
await page.close();

// --- 4. boss ------------------------------------------------------------------------------------------------------------
page = await open('&boss');
await page.mouse.click(30, 30);
await until(page, () => window.__game.game.audio.ctx?.state === 'running', null, 10000);
await until(page, () => window.__game.game.state === 'playing', null, 20000);
const cueLog = [];
const snap = async (label) => { const s = await stats(page); cueLog.push(`${label}: ${s.musicState}/${s.music}`); return s; };
await snap('start');
// ?boss starts past the scripted warning: fire it by hand (klaxon + sting), then run until the boss arrives
await page.evaluate(() => window.__game.game.director._run([0, 'warning']));
let sawPrebos = (await stats(page)).musicState === 'prebos';
await page.waitForTimeout(1500);
const sting = await page.evaluate(() => window.__game.game.audio.music.has('boss_sting'));
check('boss-incoming sting decoded and played', sting, '');
for (let k = 0; k < 40; k++) {
  await step(page, 0.5);
  await page.waitForTimeout(120);
  const s = await stats(page);
  if (s.musicState === 'prebos') sawPrebos = true;
  if (await page.evaluate(() => window.__game.game.boss.active)) break;
}
check('boss warning puts the music into the sting state', sawPrebos, cueLog);
await until(page, () => window.__game.game.state === 'playing' && window.__game.game.boss.active, null, 30000);
check('boss phase 1 cue', await until(page, () => window.__game.game.audio.md.cur?.id === 'boss1', null, 60000), await snap('p1'));
const setHp = (f) => page.evaluate((f) => { const e = window.__game.game.boss.e; e.hp = e.maxHp * f; }, f);
await setHp(0.6); await step(page, 0.5);
check('boss phase 2 cue (intro → loop)', await until(page, () => window.__game.game.audio.md.cur?.id === 'boss2', null, 30000), await snap('p2'));
await page.waitForTimeout(500);
await step(page, 4);
await setHp(0.3); await step(page, 0.5);
check('boss phase 3 cue', await until(page, () => window.__game.game.audio.md.cur?.id === 'boss3', null, 30000), await snap('p3'));
await page.screenshot({ path: `${shots}/audio-boss.png` });
const s3 = await stats(page);
check('boss fight peak below 0 dBFS', (s3.peak ?? 0) < 1.0 && (s3.peakPre ?? 0) < 1.0, { out: s3.peak, pre: s3.peakPre });
// kill it
await page.evaluate(() => { const g = window.__game.game; const e = g.boss.e; g.enemies.damage(e, e.hp + 10, { source: 'gun' }); });
let sawVictory = false;
for (let k = 0; k < 60; k++) {
  await step(page, 0.5);
  await page.waitForTimeout(100);
  const s = await stats(page);
  if (s.musicState === 'victory') sawVictory = true;
  if (await page.evaluate(() => window.__game.game.state === 'results')) break;
}
check('victory sting state after the boss', sawVictory, await snap('dead'));
check('victory chains into the results loop', await until(page, () => window.__game.game.audio.md.cur?.id === 'results', null, 30000), await snap('results'));
await page.close();

// --- 5. death → continue → game over ------------------------------------------------------------------------------------
page = await open('&t=60');
await page.mouse.click(30, 30);
await until(page, () => window.__game.game.audio.ctx?.state === 'running', null, 10000);
await until(page, () => window.__game.game.state === 'playing', null, 20000);
await step(page, 3);
await page.evaluate(() => { const g = window.__game.game; g.hurtPlayer(9999, g.player.x, g.player.z, 'test'); });
await step(page, 3);
check('continue screen plays the continue loop', await until(page, () => window.__game.game.audio.md.cur?.id === 'continue', null, 30000), await stats(page));
await page.screenshot({ path: `${shots}/audio-continue.png` });
await page.evaluate(() => window.__game.game.giveUp());
check('give up → game-over jingle', (await stats(page)).musicState === 'gameover', await stats(page));
check('game-over jingle chains into the results loop', await until(page, () => window.__game.game.audio.md.cur?.id === 'results', null, 30000), await stats(page));
// "Again" while a jingle is still playing: the new run must cut it
await page.evaluate(() => window.__game.game.audio.setMusic('gameover'));
const jingle = await page.evaluate(() => window.__game.game.audio.md.stings.length);
await page.evaluate(() => window.__game.game.audio.setMusic('run'));
const after = await page.evaluate(() => ({ stings: window.__game.game.audio.md.stings.length, state: window.__game.game.audio.md.state }));
check('a new run stops a still-playing stinger', jingle === 1 && after.stings === 0 && after.state === 'run', { jingle, ...after });
await page.close();

check('no console errors / page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} audio checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
fs.writeFileSync(`${shots}/audio-checks.json`, JSON.stringify({ results, cueLog }, null, 1));
process.exit(failed.length ? 1 : 0);
