// Creature rendering cost probe (headless Chromium, WebGL2 / SwiftShader — GPU timings are meaningless here, so this
// measures what is portable: CPU time of the per-frame creature update + pose upload, draw calls and triangles).
//   node tools/perf-creatures.mjs [extraParams]      e.g. '&procedural' for the v2 rigs
// Spawns a 40-dinosaur mix behind the cab (director paused), then times enemies.render() over 300 frames and reads
// renderer.info after a real render.
const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const extra = process.argv[2] || '';
const http = await import('node:http');
const path = await import('node:path');
const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); res.end(data); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
server.unref();
const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
await page.goto(`${base}?test&webgl&quality=low&god${extra}`);
await page.waitForFunction(() => window.__game?.game?.state === 'title', null, { timeout: 900000 });
const loadMs = Date.now() - t0;
if (process.argv[3] === 'probe') {
  // hit-sphere rest offsets and bone names per species
  console.log(JSON.stringify(await page.evaluate(() => {
    const g = window.__game.game;
    return Object.fromEntries(Object.entries(g.enemies.models).map(([k, m]) => [k, { hit: g.enemies.hitLocal[k], height: m.height, radius: m.radius, bones: m.bones?.names?.join(' ') }]));
  }), null, 1));
  await browser.close();
  process.exit(0);
}
await page.click('#btn-play');
const res = await page.evaluate(async () => {
  const G = window.__game, g = G.game;
  for (let i = 0; i < 60 && !(g.state === 'playing' && g.director.time > 4); i++) G.step(0.5);
  g.director.update = () => {};
  g.enemies.attackGrace = 1e9;
  for (let i = g.enemies.list.length - 1; i >= 0; i--) g.enemies._remove(i);
  const p = g.player;
  const mix = [['raptor', 12], ['compy', 12], ['brute', 4], ['trike', 2], ['ankylo', 2], ['ptero', 8]];
  let k = 0;
  for (const [type, n] of mix) for (let i = 0; i < n; i++, k++) {
    const gap = -8 - (k % 10) * 3.2, d = ((k * 7) % 11 - 5) * 1.3;
    const r = g.route.sample(p.s + gap, {});
    const e = type === 'ptero' ? g.enemies.spawn(type, r.x + r.rx * d, r.z + r.rz * d, { y: 6 + (k % 4) }) : g.enemies.spawn(type, r.x + r.rx * d, r.z + r.rz * d, { onRoad: true, heading: r.heading });
    if (e) { e.slotGap = gap; e.slotD = d; e.hoverGap = gap; e.hoverD = d; e.hoverY = 6 + (k % 4); }
  }
  G.step(1.0);
  const n = g.enemies.list.length;
  // CPU: creature update + pose (what runs every frame on the main thread)
  const T = 300;
  let t = performance.now();
  for (let i = 0; i < T; i++) g.enemies.render(g.elapsed + i / 60);
  const renderMs = (performance.now() - t) / T;
  t = performance.now();
  for (let i = 0; i < 60; i++) g.enemies.update(1 / 60);
  const updateMs = (performance.now() - t) / 60;
  // draw calls / triangles of the creature meshes in one real frame
  g.enemies.render(g.elapsed);
  const info = g.world.renderer.info;
  info.autoReset = false; info.reset();
  g.world.renderer.render(g.world.scene, g.cam.camera);
  const total = { calls: info.render.calls, triangles: info.render.triangles };
  info.autoReset = true;
  let calls = 0, tris = 0, drawn = 0;
  for (const rig of Object.values(g.enemies.rigs)) {
    if (rig.stats) { const s = rig.stats(); calls += s.calls; tris += s.tris; drawn += s.count; }
    else { for (const m of rig.meshes) if (m.count) { calls++; tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * m.count; } drawn += rig.count; }
  }
  return { enemies: n, drawn, creatureDrawCalls: calls, creatureTriangles: Math.round(tris), cpuPoseMsPerFrame: +renderMs.toFixed(3), cpuUpdateMsPerFrame: +updateMs.toFixed(3), sceneDrawCallsMainPass: total.calls, sceneTrianglesMainPass: total.triangles };
});
console.log(JSON.stringify({ mode: extra || 'skinned', loadMs, ...res }, null, 1));
await browser.close();
process.exit(0);
