// Long-session frame-cost probe: does the game get slower the longer you play?
//   node tools/perf-decay-probe.mjs <outDir> [seconds=900] [engine=chromium|webkit]
//
// Phone profile (393×852 @3x, iOS Safari UA), WebGL2, the sim driven from here (?test — headless Chromium
// stalls requestAnimationFrame, so a wall-clock rAF loop does not play). Game ticks at 30 Hz; a couple of
// real scene frames are rasterized per sample (SwiftShader cannot sustain 30 fps at phone resolution):
//   ?test&webgl&lowmem&god&autoplay&nointro&governor=0
// governor stays off (test mode never installs it) so a quality step-down cannot hide a rising frame cost.
// god+autoplay keeps the run alive through GRIDLOCK into the next run. Samples every 30 s of game time:
//   frame callback time (mean / p95 of the game loop), draw calls, triangles,
//   renderer.info.memory geometries / textures / programs / render targets,
//   scene object count, live Web Audio nodes (WeakRefs; created − collected),
//   WebGL create/delete deltas, pixel ratio, JS heap, process RSS.
// HIDE_AT=<seconds of play> freezes the page (CDP lifecycle + visibilitychange) for 4 s and records the sample
// on either side, so a "backgrounding makes it fast" reset shows up in the log.
// Writes samples.json, samples.csv, trend.json and chart.png into outDir.
// Exits 1 when a tracked series trends up (tools/perf-trend.mjs).

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { thirds, trendStatus, TRENDS } from './perf-trend.mjs';

const outDir = path.resolve(process.argv[2] || '/workspace/dino-game-shots/fps-decay/run');
const SECONDS = +(process.argv[3] || 900);
const engine = (process.argv[4] || 'chromium').toLowerCase();
const HIDE_AT = process.env.HIDE_AT ? +process.env.HIDE_AT : 0;
const SAMPLE_S = +(process.env.SAMPLE_S || 30);
const BASE_PATH = '/extinction-avenue/';
const root = new URL('..', import.meta.url).pathname;

const { chromium, webkit } = await import(new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url).href);
fs.mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!u.startsWith(BASE_PATH)) { res.writeHead(404); res.end(); return; }
  u = u.slice(BASE_PATH.length - 1);
  const f = path.join(root, u.endsWith('/') ? u + 'index.html' : u);
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}${BASE_PATH}?test&webgl&lowmem&god&autoplay&nointro&governor=0`;

const logPath = path.join(outDir, 'probe.log');
fs.writeFileSync(logPath, '');
const log = (...a) => { const l = a.join(' '); console.log(l); fs.appendFileSync(logPath, l + '\n'); };
log('#', new Date().toISOString(), engine, url, `seconds=${SECONDS}`, HIDE_AT ? `hideAt=${HIDE_AT}` : '');

const browserType = engine === 'webkit' ? webkit : chromium;
const launchOpts = engine === 'webkit' ? {} : {
  channel: 'chromium',
  args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc', `--decay-probe-tag=${process.pid}`]
};
const browser = await browserType.launch(launchOpts);
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
});

await ctx.addInitScript(() => {
  const G = (window.__glStats = { createBuffer: 0, deleteBuffer: 0, createTexture: 0, deleteTexture: 0, createProgram: 0, deleteProgram: 0, createFramebuffer: 0, deleteFramebuffer: 0, bufferData: 0, bufferDataBytes: 0, bufferSubData: 0, bufferSubBytes: 0, texSubImage2D: 0, texImage2D: 0, shadowBlur: 0, fontSet: 0 });
  const proto = window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype;
  if (proto) {
    for (const k of ['createBuffer', 'deleteBuffer', 'createTexture', 'deleteTexture', 'createProgram', 'deleteProgram', 'createFramebuffer', 'deleteFramebuffer']) {
      const f = proto[k];
      if (!f) continue;
      proto[k] = function (...a) { G[k]++; return f.apply(this, a); };
    }
    const bd = proto.bufferData;
    proto.bufferData = function (target, data, usage) {
      G.bufferData++;
      G.bufferDataBytes += (data && data.byteLength) || (typeof data === 'number' ? data : 0);
      return bd.call(this, target, data, usage);
    };
    const bs = proto.bufferSubData;
    proto.bufferSubData = function (target, offset, data) {
      G.bufferSubData++;
      G.bufferSubBytes += (data && data.byteLength) || 0;
      return bs.call(this, target, offset, data);
    };
    const ts = proto.texSubImage2D;
    proto.texSubImage2D = function (...a) { G.texSubImage2D++; return ts.apply(this, a); };
    const ti = proto.texImage2D;
    proto.texImage2D = function (...a) { G.texImage2D++; return ti.apply(this, a); };
    for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const f = proto[k];
      if (!f) continue;
      G[k] = 0;
      proto[k] = function (...a) { G[k]++; return f.apply(this, a); };
    }
    if (window.__glDebug) {
      G.glErrors = [];
      const note = function (fn, name) {
        const f = proto[fn];
        if (!f) return;
        proto[fn] = function (...a) {
          const r = f.apply(this, a);
          if (G.glErrors.length < 12) {
            const e = this.getError();
            if (e) G.glErrors.push(name + ':' + e);
          }
          return r;
        };
      };
      note('drawElements', 'drawElements');
      note('drawArrays', 'drawArrays');
      note('drawElementsInstanced', 'drawElementsInstanced');
      note('drawArraysInstanced', 'drawArraysInstanced');
    }
  }
  const fontSeen = new Set();
  window.__fontKeys = () => fontSeen.size;
  const c2 = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
  if (c2) {
    const blur = Object.getOwnPropertyDescriptor(c2, 'shadowBlur');
    if (blur?.set) Object.defineProperty(c2, 'shadowBlur', { configurable: true, get() { return blur.get.call(this); }, set(v) { if (v) G.shadowBlur++; blur.set.call(this, v); } });
    const font = Object.getOwnPropertyDescriptor(c2, 'font');
    if (font?.set) Object.defineProperty(c2, 'font', { configurable: true, get() { return font.get.call(this); }, set(v) { G.fontSet++; fontSeen.add(String(v)); font.set.call(this, v); } });
  }
  const refs = [];
  window.__audioLive = () => {
    let live = 0;
    const keep = [];
    for (const r of refs) { if (r.deref()) { live++; keep.push(r); } }
    refs.length = 0;
    for (const r of keep) refs.push(r);
    return live;
  };
  const P = (window.BaseAudioContext || window.AudioContext).prototype;
  for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k);
    if (!d || !/^create/.test(k) || typeof d.value !== 'function') continue;
    const f = d.value;
    P[k] = function (...a) {
      const n = f.apply(this, a);
      if (n && typeof n === 'object' && k !== 'createBuffer' && k !== 'createPeriodicWave') refs.push(new WeakRef(n));
      return n;
    };
  }
  const frames = [];
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    const a = performance.now();
    try { return cb(t); } finally {
      const dt = performance.now() - a;
      if (dt > 4) frames.push(dt);
    }
  });
  window.__takeFrames = () => {
    const xs = frames.splice(0, frames.length).sort((a, b) => a - b);
    if (!xs.length) return { n: 0, mean: 0, p95: 0 };
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    return { n: xs.length, mean, p95: xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] };
  };
});

const page = await ctx.newPage();
page.on('pageerror', (e) => log('[pageerror]', e.message.slice(0, 300)));
page.on('console', (m) => { const t = m.text(); if (/lowmem|error|fatal|quality|pageerror/i.test(t)) log('[console]', t.slice(0, 240)); });

const rss = () => {
  try {
    const rows = execSync('ps -eo pid=,ppid=,rss=,args=').toString().trim().split('\n').map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      return m ? { pid: +m[1], ppid: +m[2], kb: +m[3], args: m[4] } : null;
    }).filter(Boolean);
    if (engine === 'webkit') {
      let total = 0;
      for (const r of rows) if (/WebKit|MiniBrowser|Playwright/.test(r.args)) total += r.kb;
      return { rend: Math.round(total / 1024), gpu: 0, total: Math.round(total / 1024) };
    }
    const rootP = rows.find((r) => r.args.includes(`--decay-probe-tag=${process.pid}`) && !r.args.includes('--type='));
    if (!rootP) return { rend: 0, gpu: 0, total: 0 };
    const tree = new Set([rootP.pid]);
    for (let grew = true; grew;) { grew = false; for (const r of rows) if (!tree.has(r.pid) && tree.has(r.ppid)) { tree.add(r.pid); grew = true; } }
    let total = 0, gpu = 0, rend = 0;
    for (const r of rows) {
      if (!tree.has(r.pid)) continue;
      total += r.kb;
      if (r.args.includes('type=renderer')) rend = Math.max(rend, r.kb);
      if (r.args.includes('type=gpu')) gpu += r.kb;
    }
    return { rend: Math.round(rend / 1024), gpu: Math.round(gpu / 1024), total: Math.round(total / 1024) };
  } catch { return { rend: 0, gpu: 0, total: 0 }; }
};

const snapshot = () => page.evaluate(() => {
  const api = window.__game;
  const g = api?.game;
  const w = g?.world;
  const r = w?.renderer;
  const mem = performance.memory;
  const frames = window.__takeFrames();
  const gl = window.__glStats || {};
  let objects = 0, meshes = 0;
  if (w?.scene) w.scene.traverse((o) => { objects++; if (o.isMesh) meshes++; });
  const info = r?.info;
  return {
    state: g?.state || '?',
    time: g ? +g.director.time.toFixed(1) : 0,
    beat: g?.director.beat?.id || '-',
    frameMs: +frames.mean.toFixed(2),
    frameP95: +frames.p95.toFixed(2),
    frameN: frames.n,
    drawCalls: info?.render?.drawCalls ?? null,
    triangles: info?.render?.triangles ?? null,
    geometries: info?.memory?.geometries ?? null,
    textures: info?.memory?.textures ?? null,
    programs: info?.memory?.programs ?? null,
    renderTargets: info?.memory?.renderTargets ?? null,
    gpuMB: info ? +(info.memory.total / 1048576).toFixed(1) : null,
    objects, meshes,
    enemies: g?.enemies?.list?.length ?? null,
    audioLive: window.__audioLive ? window.__audioLive() : null,
    fontKeys: window.__fontKeys ? window.__fontKeys() : null,
    audioVoices: g?.audio?.voices?.length ?? null,
    audioState: g?.audio?.ctx?.state || 'none',
    pr: r ? +r.getPixelRatio().toFixed(2) : null,
    governor: g?.governor?.step ?? null,
    hidden: document.hidden,
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    stream: w?.stream?.info?.() || null,
    gl: { ...gl }
  };
});

const t0 = Date.now();
const wall = () => ((Date.now() - t0) / 1000).toFixed(0);
log(wall() + 's', 'loading');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game?.game?.state === 'title', null, { timeout: 900000 });
// The tap is the user gesture AudioContext needs; the button starts the run.
await page.tap('#btn-play', { force: true }).catch(() => page.evaluate(() => window.__game.start()));
await page.waitForFunction(() => window.__game?.game?.state === 'playing', null, { timeout: 120000 });
log(wall() + 's', 'PLAYING', JSON.stringify(await snapshot()), 'rss', JSON.stringify(rss()));
await page.evaluate(() => window.__game?.game?.world?.renderer?.backend?.gl?.finish?.());

// SwiftShader takes ~4.5 s for one phone-resolution frame, so a 30 fps soak cannot run for 15 min.
// Step every tick (gameplay, audio, overlay at 30 Hz). Rasterize FULL_FRAMES real scene frames at
// the end of each sample and fold one gl.finish() into that frame time.
// The renderer's rAF is what advances NodeFrame and resets info. It cannot run inside this
// synchronous loop, and without a new frame id the post pipeline reuses the scene pass and only
// draws the output quad. Match Animation.start on each full frame: reset info, then advance the frame.
const DT = 1 / 30;
const FULL_FRAMES = Math.max(1, +(process.env.FULL_FRAMES || 3));
log('full frames per sample', FULL_FRAMES);
const drive = (frames) => page.evaluate(async ({ frames, fullFrames }) => {
  const g = window.__game;
  const dts = [];
  let err = null;
  let ticks = 0;
  const gl0 = { ...(window.__glStats || {}) };
  const renderer = g.game?.world?.renderer;
  const glCtx = renderer?.backend?.gl;
  const nodeFrame = renderer?._nodes?.nodeFrame;
  const vfx = g.game?.vfx;
  const cam = g.game?.cam?.camera;
  const firstFull = Math.max(0, frames - fullFrames);
  for (let i = 0; i < frames; i++) {
    try {
      g.step(1 / 30, 1 / 30);
      ticks++;
      if (i >= firstFull) {
        renderer?.info?.reset?.();
        nodeFrame?.update?.();
        glCtx?.finish?.();
        const a = performance.now();
        g.render();
        glCtx?.finish?.();
        dts.push(performance.now() - a);
      } else if (vfx && cam) {
        vfx.drawOverlay(cam, g.game.enemies?.dangers);
      }
    } catch (e) { err = String(e?.stack || e).slice(0, 240); break; }
  }
  dts.sort((x, y) => x - y);
  const mid = Math.floor(dts.length / 2);
  const wallMean = dts.length ? (dts.length % 2 ? dts[mid] : (dts[mid - 1] + dts[mid]) / 2) : 0;
  const mean = dts.reduce((s, v) => s + v, 0) / (dts.length || 1);
  const gl = window.__glStats || {};
  const dgl = {};
  for (const k of Object.keys(gl)) dgl[k] = (gl[k] || 0) - (gl0[k] || 0);
  const api = window.__game;
  const game = api?.game;
  const w = game?.world;
  const info = w?.renderer?.info;
  if (typeof window.gc === 'function') { try { window.gc(); } catch { /* ignore */ } }
  let objects = 0;
  if (w?.scene) w.scene.traverse(() => { objects++; });
  return {
    n: ticks, rendered: dts.length, mean: wallMean, cpuMs: mean, p95: dts[Math.min(dts.length - 1, Math.floor(dts.length * 0.95))] || 0, err, dgl,
    fontKeys: window.__fontKeys ? window.__fontKeys() : 0,
    state: game?.state, time: game ? +game.director.time.toFixed(1) : 0, beat: game?.director.beat?.id,
    drawCalls: info?.render?.drawCalls ?? null, triangles: info?.render?.triangles ?? null,
    glDraws: (dgl.drawArrays || 0) + (dgl.drawElements || 0) + (dgl.drawArraysInstanced || 0) + (dgl.drawElementsInstanced || 0),
    geometries: info?.memory?.geometries ?? null, textures: info?.memory?.textures ?? null,
    programs: info?.memory?.programs ?? null, renderTargets: info?.memory?.renderTargets ?? null,
    gpuMB: info ? +(info.memory.total / 1048576).toFixed(1) : null,
    objects, enemies: game?.enemies?.list?.length ?? null,
    audioLive: window.__audioLive ? window.__audioLive() : null,
    audioHeld: game?.audio?.heldNodes ?? null,
    audioVoices: game?.audio?.voices?.length ?? null, audioState: game?.audio?.ctx?.state || 'none',
    pr: w?.renderer ? +w.renderer.getPixelRatio().toFixed(2) : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    stream: w?.stream?.info?.() || null,
    glErrors: (window.__glStats && window.__glStats.glErrors) || null
  };
}, { frames, fullFrames: FULL_FRAMES });

const rows = [];
let hiddenDone = false;
let gameT = 0;
while (gameT < SECONDS) {
  const frames = Math.round(Math.min(SAMPLE_S, SECONDS - gameT) / DT);
  const driven = await drive(frames);
  if (driven.err) log(wall() + 's', '[step error]', driven.err);
  if (!driven.n) { log(wall() + 's', 'no ticks, stopping'); break; }
  gameT += driven.n * DT;
  if (HIDE_AT && !hiddenDone && gameT >= HIDE_AT) {
    hiddenDone = true;
    const before = await snapshot();
    log(wall() + 's', 'HIDE before', JSON.stringify({ frameMs: before.frameMs, audioLive: before.audioLive, fontKeys: before.fontKeys, programs: before.programs, objects: before.objects, drawCalls: before.drawCalls, audioState: before.audioState }));
    try {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await page.waitForTimeout(4000);
      await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    } catch (e) {
      log(wall() + 's', 'CDP lifecycle failed', String(e).slice(0, 160));
    }
    await page.evaluate(() => {
      const set = (v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); };
      set('hidden');
      return new Promise((res) => setTimeout(() => { set('visible'); res(); }, 2000));
    });
    await page.waitForTimeout(1500);
    const after = await snapshot();
    log(wall() + 's', 'HIDE after', JSON.stringify({ frameMs: after.frameMs, audioLive: after.audioLive, fontKeys: after.fontKeys, programs: after.programs, objects: after.objects, drawCalls: after.drawCalls, audioState: after.audioState, hidden: after.hidden }));
  }
  const m = rss();
  const dgl = driven.dgl || {};
  const row = {
    t: +gameT.toFixed(0),
    frameMs: +driven.mean.toFixed(2),
    frameP95: +driven.p95.toFixed(2),
    frameN: driven.n,
    rendered: driven.rendered,
    ...m,
    state: driven.state, time: driven.time, beat: driven.beat,
    drawCalls: driven.drawCalls, glDraws: driven.rendered ? Math.round(driven.glDraws / driven.rendered) : null, triangles: driven.triangles,
    geometries: driven.geometries, textures: driven.textures, programs: driven.programs,
    renderTargets: driven.renderTargets, gpuMB: driven.gpuMB, objects: driven.objects,
    enemies: driven.enemies, audioLive: driven.audioLive, audioHeld: driven.audioHeld, audioVoices: driven.audioVoices,
    audioState: driven.audioState, pr: driven.pr, heapMB: driven.heapMB, stream: driven.stream,
    fontKeys: driven.fontKeys, glDelta: dgl
  };
  rows.push(row);
  log(wall() + 's', `t=${row.t}`, JSON.stringify({
    game: row.time, state: row.state, frameMs: row.frameMs, p95: row.frameP95, ticks: row.frameN, rendered: row.rendered,
    draws: row.drawCalls, glDraws: row.glDraws, tris: row.triangles, obj: row.objects, geo: row.geometries, tex: row.textures,
    prog: row.programs, rt: row.renderTargets, audio: row.audioLive, held: row.audioHeld, voices: row.audioVoices, audioState: row.audioState,
    heap: row.heapMB, pr: row.pr, rss: m, gpuMB: row.gpuMB, enemies: row.enemies,
    bufData: dgl.bufferData, bufSub: dgl.bufferSubData, texSub: dgl.texSubImage2D, texImg: dgl.texImage2D,
    newBuf: dgl.createBuffer, delBuf: dgl.deleteBuffer, newProg: dgl.createProgram, shadow: dgl.shadowBlur, font: dgl.fontSet, fontKeys: row.fontKeys,
    glErrors: driven.glErrors,
    stream: row.stream && { res: row.stream.resident, adds: row.stream.adds, drops: row.stream.drops }
  }));
}

const warmup = Math.min(60, SECONDS / 5);
const trend = {};
for (const key of Object.keys(TRENDS)) {
  const t = thirds(rows, key, { warmup });
  trend[key] = t ? { ...t, status: trendStatus(t, TRENDS[key]), tol: TRENDS[key] } : { status: 'PASS', note: 'too few samples' };
}
const fails = Object.entries(trend).filter(([, v]) => v.status === 'FAIL').map(([k]) => k);
fs.writeFileSync(path.join(outDir, 'samples.json'), JSON.stringify({ engine, url, seconds: SECONDS, warmup, rows, trend }, null, 1));
const cols = ['t', 'frameMs', 'frameP95', 'drawCalls', 'triangles', 'objects', 'geometries', 'textures', 'programs', 'renderTargets', 'audioLive', 'audioHeld', 'fontKeys', 'heapMB', 'rend', 'gpu', 'gpuMB', 'pr', 'time'];
fs.writeFileSync(path.join(outDir, 'samples.csv'), cols.join(',') + '\n' + rows.map((r) => cols.map((c) => r[c] ?? '').join(',')).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'trend.json'), JSON.stringify({ warmup, trend, fails }, null, 1));
writeChart(path.join(outDir, 'chart.png'), rows);
log('TREND', JSON.stringify(Object.fromEntries(Object.entries(trend).map(([k, v]) => [k, `${v.status} ${v.first?.toFixed?.(1) ?? ''}→${v.last?.toFixed?.(1) ?? ''}`]))));
log(fails.length ? `FAIL ${fails.join(',')}` : 'PASS trends flat');

await browser.close();
server.close();
process.exit(fails.length ? 1 : 0);

function writeChart(file, rows) {
  if (rows.length < 2) return;
  const series = [
    ['frame ms', 'frameMs', [255, 176, 46]],
    ['draw calls', 'drawCalls', [80, 200, 255]],
    ['objects', 'objects', [180, 180, 200]],
    ['programs', 'programs', [255, 90, 140]],
    ['geometries', 'geometries', [120, 220, 140]],
    ['textures', 'textures', [160, 140, 255]],
    ['audio nodes', 'audioLive', [255, 120, 60]],
    ['held audio', 'audioHeld', [255, 80, 40]],
    ['font keys', 'fontKeys', [255, 220, 80]],
    ['heap MB', 'heapMB', [200, 200, 200]]
  ];
  const W = 960, H = series.length * 78 + 16, pad = 8;
  const img = Buffer.alloc(W * H * 3, 14);
  const set = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2];
  };
  series.forEach(([, , color], i) => {
    const y0 = 16 + i * 78;
    for (let x = 0; x < W; x++) { set(x, y0, [40, 44, 56]); set(x, y0 + 64, [40, 44, 56]); }
  });
  const plot = (key, y0, color) => {
    const ys = rows.map((r) => +r[key] || 0);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const n = ys.length;
    for (let i = 1; i < n; i++) {
      const x0 = Math.round((i - 1) / (n - 1) * (W - pad * 2)) + pad;
      const x1 = Math.round(i / (n - 1) * (W - pad * 2)) + pad;
      const ya = y0 + 64 - Math.round(((ys[i - 1] - lo) / (hi - lo)) * 60);
      const yb = y0 + 64 - Math.round(((ys[i] - lo) / (hi - lo)) * 60);
      const steps = Math.max(1, Math.abs(x1 - x0));
      for (let s = 0; s <= steps; s++) set(x0 + Math.round((x1 - x0) * s / steps), ya + Math.round((yb - ya) * s / steps), color);
    }
  };
  series.forEach(([, key, color], i) => plot(key, 16 + i * 78, color));
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
