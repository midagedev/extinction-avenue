// The QA loop: run it before every push.  node tools/qa.mjs [options]
//
// Steps (--steps a,b,c to pick; default: syntax,unit,errors,shots,webkit):
//   syntax   every game module parses (tools/check-syntax.mjs)
//   unit     node --test tests/
//   errors   the default page (WebGPU, falling back to WebGL2 in headless Chromium) for 60 s: no uncaught page errors
//            (tools/page-errors.mjs)
//   shots    fixed-seed gameplay screenshots, desktop 1440x900 @2x (High) and iPhone 15 emulation (Phone), with
//            readability metrics (tools/qa-shots.mjs: sharpness, luma spread, street veil, creature-vs-background
//            contrast, enemy size in px), compared with tools/qa-baselines/baseline.json
//   webkit   Playwright WebKit as an iPhone 15: real START flow, phone profile, pixel ratio, streaming, not black
//            (IPHONE=1 tools/e2e-webkit.mjs)
//   soak     opt-in (--soak[=gameSeconds], default 240): the phone-profile memory soak (tools/mem-long-probe.mjs);
//            peak page / GPU-process RSS and the renderer's own GPU allocations vs the baseline
// Options:
//   --fast                syntax, unit and shots only (~9 min; the full run adds page errors and WebKit)
//   --url <base>          test a deployed build, e.g. --url https://midagedev.github.io/extinction-avenue/
//                         (syntax / unit still check the working tree)
//   --only desktop|phone  one shots profile
//   --out <dir>           artifacts (default .tools/qa/<timestamp>: screenshots, metrics.json, logs, summary.json)
//   --update-baselines    after a deliberate visual change: store this run's metrics + thumbnails as the baseline
//                         (tools/qa-baselines/), and the soak peaks when --soak ran. Commit them with the change.
// Exit code 1 when any step FAILs (WARN rows do not fail the run).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serve, captureShots } from './qa-shots.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const BASE_DIR = path.join(ROOT, 'tools/qa-baselines');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const a = args.find((x) => x === k || x.startsWith(k + '=')); if (!a) return d; if (a.includes('=')) return a.split('=').slice(1).join('='); const i = args.indexOf(a); return args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true; };
const steps = String(opt('--steps', args.includes('--fast') ? 'syntax,unit,shots' : 'syntax,unit,errors,shots,webkit')).split(',').filter(Boolean);
const soakArg = opt('--soak');
if (soakArg && !steps.includes('soak')) steps.push('soak');
const soakSecs = soakArg === true || !soakArg ? 240 : +soakArg;
const url = opt('--url');
const only = opt('--only');
const update = args.includes('--update-baselines');
const out = path.resolve(opt('--out') || path.join(ROOT, '.tools/qa', new Date().toISOString().replace(/[:.]/g, '-')));
fs.mkdirSync(out, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[qa ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const rows = []; // { step, check, value, baseline, status }
const row = (step, check, status, value = '', baseline = '') => rows.push({ step, check, status, value: String(value), baseline: String(baseline) });

function run(cmd, argv, { env = {}, logFile } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { cwd: ROOT, env: { ...process.env, ...env } });
    let text = '';
    const take = (d) => { text += d; if (logFile) fs.appendFileSync(logFile, d); };
    p.stdout.on('data', take); p.stderr.on('data', take);
    p.on('close', (code) => resolve({ code, text }));
  });
}

let server = null;
async function base() {
  if (url) return url.endsWith('/') ? url : url + '/';
  server ??= await serve(ROOT);
  return server.base;
}

// ---- baseline comparison (per shot) ---------------------------------------------------------------------------
// Relative thresholds: SwiftShader renders are deterministic for a given build, but gameplay changes move the scene,
// so small drifts are fine and real regressions (a blurrier, mistier frame; creatures sinking into the street) fail.
const CHECKS = [
  // [label, get, compare(value, baseline) → 'PASS' | 'WARN' | 'FAIL']
  ['pixel ratio', (m) => m.view.pr, (v, b) => (v < b ? 'FAIL' : 'PASS')],
  ['sharpness', (m) => m.sharpness, (v, b) => (v < b * 0.8 ? 'FAIL' : v < b * 0.92 ? 'WARN' : 'PASS')],
  ['veil (street p5 luma)', (m) => m.veil, (v, b) => (v > b + 25 ? 'FAIL' : v > b + 10 ? 'WARN' : 'PASS')],
  ['luma spread p2-p98', (m) => m.spread, (v, b) => (v < b - 25 ? 'FAIL' : v < b - 10 ? 'WARN' : 'PASS')],
  ['creature vs street (Δluma)', (m) => m.creature.bgDiff, (v, b) => (v < b * 0.7 ? 'FAIL' : v < b * 0.85 ? 'WARN' : 'PASS')],
  ['creature silhouette edge', (m) => m.creature.edge, (v, b) => (v < b * 0.6 ? 'FAIL' : v < b * 0.8 ? 'WARN' : 'PASS')],
  ['enemy height px (median)', (m) => m.enemies.medianH, (v, b) => (v < b * 0.75 ? 'FAIL' : v < b * 0.9 ? 'WARN' : 'PASS')],
  ['enemy height px (min)', (m) => m.enemies.minH, (v, b) => (v < b * 0.6 ? 'FAIL' : v < b * 0.8 ? 'WARN' : 'PASS')],
  ['camera FOV (vertical °)', (m) => m.view.fov, (v, b) => (b && v > b + 2 ? 'WARN' : 'PASS')],
  ['enemies measured', (m) => m.enemies.count, (v) => (v === 0 ? 'WARN' : 'PASS')]
];

function compareShots(metrics, baseline) {
  for (const [name, m] of Object.entries(metrics.shots)) {
    if (name.endsWith('-native')) continue;
    const b = baseline?.shots?.[name];
    for (const [label, get, cmp] of CHECKS) {
      const v = get(m);
      if (!b) { row(`shots ${name}`, label, 'INFO', v, '(no baseline)'); continue; }
      row(`shots ${name}`, label, cmp(v, get(b)), v, get(b));
    }
  }
}

// ---- steps ----------------------------------------------------------------------------------------------------
const STEPS = {
  async syntax() {
    const r = await run(process.execPath, ['--experimental-vm-modules', 'tools/check-syntax.mjs']);
    row('syntax', 'game modules parse', r.code === 0 ? 'PASS' : 'FAIL', r.text.trim().split('\n').pop());
  },
  async unit() {
    const r = await run(process.execPath, ['--test', 'tests/'], { logFile: path.join(out, 'unit.log') });
    const n = (k) => +(r.text.match(new RegExp(`# ${k} (\\d+)`))?.[1] ?? 0);
    row('unit', 'node --test tests/', r.code === 0 ? 'PASS' : 'FAIL', `${n('pass')}/${n('tests')} pass`);
  },
  async errors() {
    const r = await run(process.execPath, ['tools/page-errors.mjs', await base(), '60'], { logFile: path.join(out, 'page-errors.log') });
    // Headless SwiftShader WebGPU loses its device at load ("Instance dropped in popErrorScope"), and the game reloads
    // on WebGL2: those errors before the fallback are expected here (a real GPU does not drop the instance)
    const lines = r.text.split('\n');
    const fallback = lines.findIndex((l) => /renderer backend: webgl/.test(l));
    const known = (l, i) => /Instance dropped in popErrorScope/.test(l) && (fallback < 0 || i < fallback);
    const errs = lines.filter((l, i) => /pageerror\]/.test(l) && !known(l, i));
    const dropped = lines.filter((l, i) => /pageerror\]/.test(l) && known(l, i)).length;
    const booted = lines.some((l) => /renderer backend:/.test(l));
    row('errors', 'default page 60 s: no page errors', errs.length || !booted ? 'FAIL' : 'PASS', errs.length ? errs[0].slice(0, 120) : booted ? '0 errors' : 'renderer never initialised');
    if (dropped) row('errors', 'SwiftShader WebGPU device loss', 'INFO', `${dropped} before the WebGL2 fallback`);
  },
  async shots() {
    const dir = path.join(out, 'shots');
    const metrics = await captureShots({ outDir: dir, base: await base(), only, log });
    row('shots', 'page errors during play', metrics.pageErrors.length ? 'FAIL' : 'PASS', metrics.pageErrors.length);
    const bf = path.join(BASE_DIR, 'baseline.json');
    const baseline = fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, 'utf8')) : null;
    compareShots(metrics, baseline);
    if (update) {
      fs.mkdirSync(BASE_DIR, { recursive: true });
      const next = { ...(baseline || {}), shots: { ...(baseline?.shots || {}), ...metrics.shots }, date: metrics.date, seed: metrics.seed, moments: metrics.moments };
      for (const s of Object.values(next.shots)) delete s.enemies?.list; // keep the file small
      fs.writeFileSync(bf, JSON.stringify(next, null, 1));
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.thumb.png')) fs.copyFileSync(path.join(dir, f), path.join(BASE_DIR, f));
      log('baseline updated:', bf);
    }
  },
  async webkit() {
    const env = { IPHONE: '1', ...(url ? { BASE_URL: await base() } : {}) };
    const r = await run(process.execPath, ['tools/e2e-webkit.mjs', path.join(out, 'webkit')], { env, logFile: path.join(out, 'webkit.log') });
    const summary = r.text.match(/(\d+\/\d+) checks passed/)?.[1] || 'no summary';
    const fails = r.text.split('\n').filter((l) => /\bFAIL\b/.test(l)).map((l) => l.slice(0, 100));
    row('webkit', 'iPhone 15 (WebKit) START → playing', r.code === 0 ? 'PASS' : 'FAIL', fails[0] || summary);
  },
  async soak() {
    if (url) { row('soak', 'memory soak', 'INFO', 'skipped with --url (the probe serves the working tree)'); return; }
    const logFile = path.join(out, 'soak.log');
    log(`soak: ${soakSecs} game seconds (~${Math.round(soakSecs * 5.5 / 60)} min)`);
    const r = await run(process.execPath, ['tools/mem-long-probe.mjs', logFile, String(soakSecs)], { env: { STEP_S: process.env.STEP_S || '0.5' } });
    const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : r.text;
    const peak = JSON.parse(text.match(/PEAK (\{.*\})/)?.[1] || 'null');
    const gpuInfo = Math.max(0, ...[...text.matchAll(/"gpuInfoMB":([\d.]+)/g)].map((m) => +m[1]));
    const errs = (text.match(/\[pageerror\]|\[step error\]/g) || []).length;
    row('soak', 'no page / step errors', errs ? 'FAIL' : 'PASS', errs);
    if (!peak) { row('soak', 'PEAK line', 'FAIL', 'missing (probe crashed?)'); return; }
    const bf = path.join(BASE_DIR, 'baseline.json');
    const baseline = fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, 'utf8')) : {};
    const b = baseline.memory;
    const cmp = (v, bv) => (!bv ? 'INFO' : v > bv * 1.06 ? 'FAIL' : v > bv * 1.02 ? 'WARN' : 'PASS');
    row('soak', 'peak page process MB', cmp(peak.rend, b?.rend), peak.rend, b?.rend ?? '');
    row('soak', 'peak GPU process MB', cmp(peak.gpu, b?.gpu), peak.gpu, b?.gpu ?? '');
    row('soak', 'renderer GPU allocations MB (max)', cmp(gpuInfo, b?.gpuInfoMB), gpuInfo, b?.gpuInfoMB ?? '');
    if (update) {
      fs.writeFileSync(bf, JSON.stringify({ ...baseline, memory: { rend: peak.rend, gpu: peak.gpu, gpuInfoMB: gpuInfo, gameSeconds: soakSecs, date: new Date().toISOString() } }, null, 1));
      log('memory baseline updated');
    }
  }
};

for (const s of steps) {
  if (!STEPS[s]) { row(s, 'unknown step', 'FAIL'); continue; }
  log(`--- ${s}`);
  try { await STEPS[s](); } catch (e) { row(s, 'step crashed', 'FAIL', String(e?.message || e).slice(0, 140)); }
}
server?.close();

// ---- summary --------------------------------------------------------------------------------------------------
const w = (k, n) => String(k).slice(0, n).padEnd(n);
console.log(`\n${w('step', 18)} ${w('check', 34)} ${w('status', 6)} ${w('value', 26)} baseline`);
console.log('-'.repeat(100));
for (const r of rows) console.log(`${w(r.step, 18)} ${w(r.check, 34)} ${w(r.status, 6)} ${w(r.value, 26)} ${r.baseline}`);
const fails = rows.filter((r) => r.status === 'FAIL').length, warns = rows.filter((r) => r.status === 'WARN').length;
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ steps, url, rows, fails, warns }, null, 1));
console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${fails} failed, ${warns} warnings, ${((Date.now() - t0) / 60000).toFixed(1)} min — artifacts in ${out}`);
process.exit(fails ? 1 : 0);
