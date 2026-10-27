// js/device-profile.js
// Low-memory device profile. Pure functions (no DOM), unit-tested in tests/device-profile.test.mjs.
//
// iOS Safari kills a WebContent process that grows past its memory limit (roughly 1–1.5 GB on recent iPhones, less on
// older ones) and then shows "A problem repeatedly occurred". Phones and tablets therefore get the `lowmem` profile:
// a phone graphics preset, the city built only around the cab's loop, streamed music, lazily decoded SFX and capped
// creature textures. Desktop browsers keep everything as it was.
//   ?lowmem    force the profile on (any device)      ?lowmem=0  force it off (a phone gets the full desktop build)

/**
 * @param {{ ua?: string, platform?: string, maxTouchPoints?: number, deviceMemory?: number, search?: string }} env
 * @returns {{ lowmem: boolean, reason: string }}
 */
export function detectProfile({ ua = '', platform = '', maxTouchPoints = 0, deviceMemory, search = '' } = {}) {
  const q = new URLSearchParams(search);
  if (q.has('lowmem')) {
    const v = q.get('lowmem');
    const on = !/^(0|false|off|no)$/i.test(v);
    return { lowmem: on, reason: on ? '?lowmem' : '?lowmem=0' };
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return { lowmem: true, reason: 'iOS' };
  // iPadOS 13+ Safari asks for the desktop site and reports itself as a Mac; only the touch points give it away
  if ((/Macintosh/i.test(ua) || /^MacIntel$/.test(platform)) && maxTouchPoints > 1) return { lowmem: true, reason: 'iPadOS' };
  if (/Android|Mobile|Silk|Kindle/i.test(ua)) return { lowmem: true, reason: 'mobile' };
  if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 4) return { lowmem: true, reason: `deviceMemory ${deviceMemory} GB` };
  return { lowmem: false, reason: 'desktop' };
}

// The cab's patrol loop (js/game/route.js LOOP: 5th Ave 57th → 34th St, 34th St → 7th Ave, 7th Ave → 57th St) spans
// x -585..0, z -1204..640. On lowmem only the blocks, streets and park furniture within CITY_MARGIN of it are built;
// the landmarks (the skyline: Empire State, Chrysler, One WTC, ...) and the low-detail boroughs are always built.
const LOOP_BOUNDS = { minX: -585, maxX: 0.4, minZ: -1204, maxZ: 640 };
export const CITY_MARGIN = 900;

/** The axis-aligned window of the city that is built on lowmem: { minX, maxX, minZ, maxZ } */
export function cityWindow(margin = CITY_MARGIN) {
  return {
    minX: LOOP_BOUNDS.minX - margin, maxX: LOOP_BOUNDS.maxX + margin,
    minZ: LOOP_BOUNDS.minZ - margin, maxZ: LOOP_BOUNDS.maxZ + margin
  };
}

/** Does the box [x0, x1] x [z0, z1] touch the window? (a point when x1/z1 are omitted) */
export function inWindow(w, x0, z0, x1 = x0, z1 = z0) {
  return x1 >= w.minX && x0 <= w.maxX && z1 >= w.minZ && z0 <= w.maxZ;
}

// ---- The live profile of this page -------------------------------------------------------------------------------
const nav = typeof navigator !== 'undefined' ? navigator : {};
const loc = typeof location !== 'undefined' ? location : { search: '', pathname: '' };
export const PROFILE = detectProfile({
  ua: nav.userAgent || '', platform: nav.platform || '', maxTouchPoints: nav.maxTouchPoints || 0,
  deviceMemory: nav.deviceMemory, search: loc.search || ''
});
export const LOWMEM = PROFILE.lowmem;
// The city window only applies to the game (index.html), not to the free-roam city sandbox (sim.html)
const WINDOW = LOWMEM && !/sim\.html$/.test(loc.pathname || '') ? cityWindow() : null;

/** Should the city builders emit something at (x, z) (or over the box to x1, z1)? Always true off the lowmem profile */
export function cityKeep(x0, z0, x1 = x0, z1 = z0) {
  return !WINDOW || inWindow(WINDOW, x0, z0, x1, z1);
}
