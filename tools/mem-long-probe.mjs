// Long-session memory soak on the phone profile: does memory grow while you play?
//   node tools/mem-long-probe.mjs <logFile> [gameSeconds=480] [extraParams] [shotPrefix]
// Chromium with iPhone emulation (393x852 @3x, iOS Safari UA, touch), the repo served under /extinction-avenue/,
// ?test&webgl&lowmem&god&autoplay: the sim is stepped from here (0.5 s of game time per rendered frame — software
// rendering is far too slow for the real loop) and the game plays itself (game.js _autoplay). Every 15 s of game time
// it logs: JS heap, renderer / GPU-process / total RSS (all chromium processes, from ps), renderer.info (geometries,
// textures, draw calls), scene objects, live creatures / particles / projectiles, Web Audio nodes and decoded buffers
// (counted by wrapping the AudioContext factories), game state / time / beat, and every game-side array / Map / Set
// whose size changed since the start (the leak hunt). Ends with a drift summary (first vs last third of the run).
// shotPrefix: phone screenshots at 60 s / 240 s / boss, e.g. /workspace/dino-game-shots/fix-ios2/before

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const { chromium } = await import(new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url).href);
const logFile = process.argv[2] || './.tools/mem-long.log';
const GAME_S = +(process.argv[3] || 480);
const extra = process.argv[4] || '';
const shotPrefix = process.argv[5] || '';
const SAMPLE_S = 15, STEP_S = +(process.env.STEP_S || 0.5);

const BASE_PATH = '/extinction-avenue/';
const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2' };
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
const url = `http://127.0.0.1:${server.address().port}${BASE_PATH}?test&webgl&lowmem&god&autoplay${extra}`;

fs.writeFileSync(logFile, '');
const log = (...a) => { const l = a.join(' '); console.log(l); fs.appendFileSync(logFile, l + '\n'); };
log('#', new Date().toISOString(), url, `gameSeconds=${GAME_S}`);

const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc', `--mem-probe-tag=${process.pid}`] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' });
// Web Audio accounting: live nodes = created − (sources that ended and were never reused); decoded buffer bytes
await ctx.addInitScript(() => {
  const A = (window.__audioStats = { nodes: 0, sources: 0, endedSources: 0, buffers: 0, bufferMB: 0, mediaSources: 0 });
  const P = (window.BaseAudioContext || window.AudioContext).prototype;
  for (const k of Object.getOwnPropertyNames(P)) {
    if (!/^create/.test(k) || typeof Object.getOwnPropertyDescriptor(P, k).value !== 'function') continue;
    const f = P[k];
    P[k] = function (...a) {
      const n = f.apply(this, a);
      if (k === 'createBuffer') { A.buffers++; A.bufferMB += (n.length * n.numberOfChannels * 4) / 1048576; return n; }
      if (k === 'createPeriodicWave') return n;
      A.nodes++;
      if (k === 'createMediaElementSource') A.mediaSources++;
      if (k === 'createBufferSource' || k === 'createOscillator' || k === 'createConstantSource') { A.sources++; n.addEventListener('ended', () => A.endedSources++); }
      return n;
    };
  }
  const dec = P.decodeAudioData;
  P.decodeAudioData = function (...a) {
    const p = dec.apply(this, a);
    return p.then((b) => { A.buffers++; A.bufferMB += (b.length * b.numberOfChannels * 4) / 1048576; return b; });
  };
});
const page = await ctx.newPage();
page.on('pageerror', (e) => log('[pageerror]', e.message.slice(0, 300)));
page.on('console', (m) => { if (/lowmem|error|stream|chunk|quality/i.test(m.text())) log('[console]', m.text().slice(0, 240)); });

// Only this browser's process tree counts (other Chromium instances may run alongside)
const rss = () => {
  try {
    const rows = execSync('ps -eo pid=,ppid=,rss=,args=').toString().trim().split('\n').map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      return m ? { pid: +m[1], ppid: +m[2], kb: +m[3], args: m[4] } : null;
    }).filter(Boolean);
    const root = rows.find((r) => r.args.includes(`--mem-probe-tag=${process.pid}`) && !r.args.includes('--type='));
    if (!root) return { rend: 0, gpu: 0, total: 0 };
    const tree = new Set([root.pid]);
    for (let grew = true; grew;) { grew = false; for (const r of rows) if (!tree.has(r.pid) && tree.has(r.ppid)) { tree.add(r.pid); grew = true; } }
    let total = 0, gpu = 0, rend = 0;
    for (const r of rows) {
      if (!tree.has(r.pid)) continue;
      const kb = r.kb, l = r.args;
      total += kb;
      if (l.includes('type=renderer')) rend = Math.max(rend, kb);
      if (l.includes('type=gpu')) gpu += kb;
    }
    return { rend: Math.round(rend / 1024), gpu: Math.round(gpu / 1024), total: Math.round(total / 1024) };
  } catch { return { rend: 0, gpu: 0, total: 0 }; }
};
const peak = { rend: 0, gpu: 0, total: 0 };
const iv = setInterval(() => { const m = rss(); for (const k in peak) peak[k] = Math.max(peak[k], m[k]); }, 1000);
const t0 = Date.now();
const wall = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

// In-page snapshot. Collections: every Array / Map / Set / typed array (depth 2) under the game's subsystems.
const snapshot = () => page.evaluate(() => {
  const g = window.__game.game, w = g.world, r = w.renderer;
  const mem = performance.memory;
  let objects = 0, visible = 0, meshes = 0;
  w.scene.traverse((o) => { objects++; if (o.visible) visible++; if (o.isMesh) meshes++; });
  const sizes = {};
  const seen = new Set();
  const visit = (o, name, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    if (o.isObject3D || o.isMaterial || o.isBufferGeometry || o.isTexture || o instanceof Node || o instanceof AudioNode) return;
    for (const k of Object.keys(o)) {
      let v;
      try { v = o[k]; } catch { continue; }
      if (!v || typeof v !== 'object') continue;
      const key = `${name}.${k}`;
      if (Array.isArray(v)) sizes[key] = v.length;
      else if (v instanceof Map || v instanceof Set) sizes[key] = v.size;
      else if (depth < 2 && !ArrayBuffer.isView(v)) visit(v, key, depth + 1);
    }
  };
  for (const k of ['enemies', 'weapons', 'vfx', 'boss', 'pickups', 'director', 'hud', 'audio', 'player', 'cam', 'gunner', 'input']) visit(g[k], k, 0);
  visit(w.cityBlocks, 'cityBlocks', 0);
  visit(w.streetDetails, 'streetDetails', 0);
  visit(w.lighting, 'lighting', 0);
  const v = g.vfx;
  const particles = ['glow', 'streak', 'smoke'].reduce((s, k) => s + (v[k]?.alive || 0), 0);
  const au = window.__audioStats || {};
  return {
    state: g.state, time: +g.director.time.toFixed(0), beat: g.director.beat?.id || '-', boss: g.boss.active ? g.boss.e?.phase : 0,
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null, heapTotalMB: mem ? Math.round(mem.totalJSHeapSize / 1048576) : null,
    geo: r.info.memory.geometries, tex: r.info.memory.textures, calls: r.info.render.calls, tris: r.info.render.triangles,
    objects, visible, meshes,
    enemies: g.enemies.list.length, pool: g.enemies.pool.length, particles,
    proj: (g.weapons.missiles?.length || 0) + (g.weapons.mines?.length || 0) + (g.weapons.fires?.length || 0) + (g.weapons.tracers?.count || 0),
    wrecks: g.boss.wrecks.length, pickups: g.pickups.items.length,
    audio: { nodes: au.nodes, live: (au.sources || 0) - (au.endedSources || 0), buffers: au.buffers, bufMB: +(au.bufferMB || 0).toFixed(1), media: au.mediaSources,
      voices: g.audio?.voices?.length, streams: g.audio?.streams?.length },
    pr: +r.getPixelRatio().toFixed(2), gpuInfoMB: +(r.info.memory.total / 1048576).toFixed(1), stream: w.stream?.info?.(), sizes
  };
});

await page.goto(url);
await page.waitForFunction(() => window.__game?.game?.state === 'title', null, { timeout: 900000 });
await page.evaluate(() => window.__game.render());
const s0 = await snapshot();
log(wall(), 'TITLE', JSON.stringify({ ...rss(), heap: s0.heapMB, geo: s0.geo, tex: s0.tex, objects: s0.objects }), 'peak', JSON.stringify(peak));
await page.tap('#btn-play', { force: true, timeout: 5000 }).catch(() => page.evaluate(() => window.__game.start()));
await page.waitForFunction(() => window.__game.game.state === 'playing', null, { timeout: 60000 }).catch(() => page.evaluate(() => window.__game.start()));

const base = s0.sizes;
const rows = [];
let lastSizes = { ...base };
const shotsAt = new Set([60, 240]);
let bossShot = false;
for (let t = 0; t <= GAME_S; t += STEP_S) {
  const err = await page.evaluate((s) => { const g = window.__game; try { g.step(s, 1 / 30); g.render(); return null; } catch (e) { return String(e?.stack || e).slice(0, 300); } }, STEP_S);
  if (err) log(wall(), `t=${t} [step error]`, err);
  const gt = Math.round(t * 2) / 2;
  if (shotPrefix && (shotsAt.has(gt) || (!bossShot && await page.evaluate(() => window.__game.game.boss.active)))) {
    if (!shotsAt.has(gt)) bossShot = true;
    fs.mkdirSync(path.dirname(shotPrefix), { recursive: true });
    await page.screenshot({ path: `${shotPrefix}-${shotsAt.has(gt) ? `t${gt}` : 'boss'}.png` });
  }
  if (gt % SAMPLE_S !== 0) continue;
  if (gt % 60 === 0) await page.evaluate(() => window.gc?.());
  const s = await snapshot();
  const m = rss();
  const changed = {};
  for (const [k, n] of Object.entries(s.sizes)) if (n !== lastSizes[k] && (n > 8 || (base[k] ?? 0) > 8)) changed[k] = n;
  lastSizes = s.sizes;
  delete s.sizes;
  rows.push({ t: gt, ...m, ...s });
  log(wall(), `t=${gt}`, JSON.stringify({ ...m, ...s }), Object.keys(changed).length ? `grew/shrank: ${JSON.stringify(changed)}` : '');
}
clearInterval(iv);
// Drift: mean of the first third (after the first minute) vs the last third
const play = rows.filter((r) => r.t >= 60);
const third = Math.max(1, Math.floor(play.length / 3));
const mean = (a, k) => Math.round(a.reduce((s, r) => s + (r[k] || 0), 0) / a.length);
const first = play.slice(0, third), last = play.slice(-third);
const drift = {};
for (const k of ['rend', 'gpu', 'total', 'heapMB', 'geo', 'tex', 'objects', 'calls']) drift[k] = `${mean(first, k)} → ${mean(last, k)}`;
log(wall(), 'PEAK', JSON.stringify(peak));
log(wall(), 'DRIFT (first third → last third of play after 60 s)', JSON.stringify(drift));
await browser.close();
server.close();
