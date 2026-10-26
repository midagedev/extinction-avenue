// Offline audio build: runs an audio lab script (an ES module exporting `default async function (lab, args)`) inside
// tools/audio/lab.html in headless Chromium. The script renders music stems / sound effects with an OfflineAudioContext
// and calls lab.save('assets/audio/…mp3', buffer, { kbps }); this driver encodes the PCM to MP3 with LAME (WASM build
// from the dev-only `wasm-media-encoders` package in .tools/node_modules, never shipped) and writes it into the repo.
// A script may return { manifest: {...}, manifestPath } to write JSON next to the audio.
//   node tools/audio-build.mjs tools/audio/music.js '{"only":["combat"]}'
//   node tools/audio-build.mjs tools/audio/sfx.js
// Set WAV=1 to also write a .wav copy of every file to .tools/audio-out/ for listening.
const fs = await import('node:fs');
const path = await import('node:path');
const http = await import('node:http');
const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const { createMp3Encoder } = await import(new URL('../.tools/node_modules/wasm-media-encoders/dist/index.cjs', import.meta.url).href);
const script = process.argv[2];
const args = JSON.parse(process.argv[3] || '{}');
const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
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
const browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 600)));
const mp3 = await createMp3Encoder();
let written = 0;
function wav(file, i16, chans, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + i16.byteLength, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(chans, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * chans * 2, 28);
  h.writeUInt16LE(chans * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(i16.byteLength, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength)]));
}
await page.exposeFunction('labWrite', async (rel, data, chans, sr, opts) => {
  const raw = Buffer.from(data, 'base64');
  const i16 = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const n = i16.length / chans;
  const ch = [];
  for (let c = 0; c < chans; c++) { const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = i16[i * chans + c] / 32767; ch.push(f); }
  // Keep the input rate (LAME would otherwise resample low bitrates to 32 kHz, which also changes the decoder delay):
  // every file then decodes with the standard 1105-sample MP3 delay that the runtime compensates for
  mp3.configure({ sampleRate: sr, channels: chans, bitrate: opts.kbps || (chans === 1 ? 96 : 128), outputSampleRate: sr });
  const parts = [];
  for (let i = 0; i < n; i += 1152 * 64) parts.push(Buffer.from(mp3.encode(ch.map((f) => f.subarray(i, Math.min(n, i + 1152 * 64))))));
  parts.push(Buffer.from(mp3.finalize()));
  const out = Buffer.concat(parts);
  const file = path.join(root, rel);
  if (!file.startsWith(root)) throw new Error('outside repo: ' + rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  if (process.env.WAV || opts.wav) wav(path.join(root, '.tools/audio-out', rel.replace(/\.mp3$/, '.wav')), i16, chans, sr);
  written += out.length;
  console.log('wrote', rel, `${(out.length / 1024).toFixed(1)} KB`, `${(n / sr).toFixed(2)} s`, chans === 1 ? 'mono' : 'stereo');
});
// Raw file output (analysis plots, JSON) — repo-relative path
await page.exposeFunction('labFile', async (rel, data) => {
  const file = path.join(root, rel);
  if (!file.startsWith(root)) throw new Error('outside repo: ' + rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('wrote', rel);
});
await page.goto(`${base}tools/audio/lab.html`);
await page.waitForFunction(() => window.labReady, null, { timeout: 60000 });
const t0 = Date.now();
const res = await page.evaluate(async ([src, args]) => {
  const mod = await import(src);
  return mod.default(window.lab, args);
}, [`${base}${script}`, args]);
if (res?.manifest && res.manifestPath) {
  const file = path.join(root, res.manifestPath);
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
  // Partial builds (args.only) merge into the existing manifest
  const merged = { ...prev, ...res.manifest };
  for (const k of Object.keys(res.manifest)) if (prev[k] && typeof prev[k] === 'object' && !Array.isArray(prev[k])) merged[k] = { ...prev[k], ...res.manifest[k] };
  fs.writeFileSync(file, JSON.stringify(merged, null, 1) + '\n');
  console.log('wrote', res.manifestPath);
}
if (res?.log) console.log(typeof res.log === 'string' ? res.log : JSON.stringify(res.log, null, 1));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(written / 1024 / 1024).toFixed(2)} MB written`);
await browser.close();
process.exit(0);
