// js/game/backend.js
// Renderer backend choice and the WebGPU → WebGL2 fallback URL. Pure functions (no DOM), unit-tested in tests/backend.test.mjs.
//
// Safari (macOS 26+, iOS/iPadOS 26+) ships WebGPU on by default, but the game's WebGPU path has only been verified on
// Chromium. Safari lost the device when a run started (the page reloaded and came back black), so every WebKit-only
// browser — desktop Safari and every iOS/iPadOS browser, which are all WebKit — defaults to the WebGL2 backend.
//   ?webgl   force WebGL2 everywhere
//   ?webgpu  opt back into WebGPU (where navigator.gpu exists)

/** True for browsers whose engine is WebKit only: desktop Safari, and every iOS/iPadOS browser (CriOS/FxiOS/EdgiOS
 *  included — Apple requires WebKit there). Chrome, Edge, Opera and Firefox on desktop/Android are not. */
export function isWebKitOnly(ua = '') {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (!/AppleWebKit/i.test(ua) || !/Safari/i.test(ua)) return false;
  return !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/i.test(ua);
}

/**
 * @param {string} ua navigator.userAgent
 * @param {{ has(k: string): boolean }} params URLSearchParams of the page
 * @param {boolean} hasGpu !!navigator.gpu
 * @returns {'webgl'|'webgpu'}
 */
export function pickBackend(ua, params, hasGpu) {
  if (params.has('webgl') || !hasGpu) return 'webgl';
  if (params.has('webgpu')) return 'webgpu';
  return isWebKitOnly(ua) ? 'webgl' : 'webgpu';
}

/**
 * The URL to reload into after the WebGPU device is lost or keeps erroring: same page on WebGL2, landing straight in a
 * run when the player had already pressed START. Returns null when the page already runs WebGL2 (never loop).
 * @param {string} href location.href
 * @param {{ autostart?: boolean }} [opts]
 */
export function fallbackURL(href, { autostart = false } = {}) {
  if (new URL(href).searchParams.has('webgl')) return null;
  return compatURL(href, { autostart });
}

/** The "Retry (compatibility mode)" button: always WebGL2 + autostart (a deliberate click, so no loop guard) */
export function retryURL(href) {
  return compatURL(href, { autostart: true });
}

function compatURL(href, { autostart }) {
  const url = new URL(href);
  const q = url.searchParams;
  q.delete('webgpu');
  q.set('webgl', '');
  if (autostart) q.set('autostart', '');
  // URLSearchParams writes flags as "webgl=": keep them as bare flags like the rest of the game's URLs
  url.search = q.toString().replace(/=(?=&|$)/g, '');
  return url.href;
}
