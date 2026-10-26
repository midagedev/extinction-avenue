// Runs a lab script (an ES module exporting `default async function (lab, args)`) inside tools/lab/lab.html in headless
// Chromium (SwiftShader WebGL2). The script may return { shots: [name...] } after calling lab.snap(name), and
// { files: { 'path/in/repo': base64 } } to write outputs (e.g. a built GLB).
//   node tools/model-lab.mjs tools/lab/view.js outDir '{"json":"args"}'
const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const path = await import('node:path');
const http = await import('node:http');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const script = process.argv[2];
const out = process.argv[3] || './.tools/lab-out';
const args = JSON.parse(process.argv[4] || '{}');
fs.mkdirSync(out, { recursive: true });
const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.dae': 'model/vnd.collada+xml' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(root, u);
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const W = args.w || 960, H = args.h || 640;
const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 400)));
await page.goto(`${base}tools/lab/lab.html?w=${W}&h=${H}`);
await page.waitForFunction(() => window.labReady, null, { timeout: 300000 });
await page.exposeFunction('labSnap', async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
});
const res = await page.evaluate(async ([src, args]) => {
  const mod = await import(src);
  window.lab.snap = async (name) => { await window.lab.render(); await window.labSnap(name); };
  return mod.default(window.lab, args);
}, [`${base}${script}`, args]);
if (res?.files) for (const [f, b64] of Object.entries(res.files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), Buffer.from(b64, 'base64')); console.log('wrote', f, Buffer.from(b64, 'base64').length, 'bytes'); }
if (res?.log) console.log(typeof res.log === 'string' ? res.log : JSON.stringify(res.log, null, 1));
await browser.close();
process.exit(0);
