// Opens a URL headless (SwiftShader WebGPU) and reports uncaught page errors for N seconds.
//   node tools/page-errors.mjs <url> [seconds]
const localPW = new URL('../.tools/node_modules/playwright/index.mjs', import.meta.url);
const fs = await import('node:fs');
const { chromium } = await import(process.env.PLAYWRIGHT || (fs.existsSync(localPW) ? localPW.href : 'playwright'));
const url = process.argv[2];
const secs = +(process.argv[3] || 120);
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const t0 = Date.now();
page.on('pageerror', (e) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s pageerror]`, e.message));
page.on('console', (m) => { if (/\[init\]|state/.test(m.text())) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, m.text().slice(0, 200)); });
await page.goto(url);
await page.waitForTimeout(secs * 1000);
await browser.close();
