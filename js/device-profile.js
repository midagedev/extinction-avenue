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

// ---- City chunk streaming (lowmem) -------------------------------------------------------------------------------
// js/game/city-stream.js keeps only the city cells around the cab resident (in the scene and on the GPU). The window is
// a band along the route: the gunner faces BACKWARDS, so it reaches far behind the cab (the street it is looking down)
// and less far ahead (prefetch, the intro swoop, corners swinging into view). Cells are CELL m squares of the world.
// A cell leaves only once it is HYSTERESIS m outside the window, so a cab idling on a boundary does not thrash it.
export const STREAM = { cell: 200, behind: 900, ahead: 450, side: 260, hysteresis: 120 };

/** Integer cell coordinates of a world point */
export function cellOf(x, z, cell = STREAM.cell) {
  return [Math.floor(x / cell), Math.floor(z / cell)];
}

export const cellKey = (cx, cz) => `${cx},${cz}`;

/**
 * The cells within `side` m of the route between `behind` m before and `ahead` m after arc length s.
 * `sample(s)` returns { x, z } on the route (Route.sample, or any polyline in tests). Returns a Set of cellKey()s.
 */
export function streamCells(sample, s, { cell = STREAM.cell, behind = STREAM.behind, ahead = STREAM.ahead, side = STREAM.side, pad = 0 } = {}) {
  const out = new Set();
  const r = side + pad;
  const step = Math.max(10, Math.min(cell / 2, r));
  const p = {};
  for (let d = -(behind + pad); d <= ahead + pad + 1e-6; d += step) {
    const q = sample(s + d, p);
    const cx0 = Math.floor((q.x - r) / cell), cx1 = Math.floor((q.x + r) / cell);
    const cz0 = Math.floor((q.z - r) / cell), cz1 = Math.floor((q.z + r) / cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        // nearest point of the cell to q, within r?
        const nx = Math.max(cx * cell, Math.min(q.x, (cx + 1) * cell));
        const nz = Math.max(cz * cell, Math.min(q.z, (cz + 1) * cell));
        if ((nx - q.x) ** 2 + (nz - q.z) ** 2 <= r * r) out.add(cellKey(cx, cz));
      }
    }
  }
  return out;
}

/**
 * One streaming step: which cells to build and which to drop. `resident` is the Set of cells now in memory. Cells
 * inside the window (want) that are not resident are built nearest-first (by `dist(key)`); resident cells outside
 * the window grown by the hysteresis (keep) are dropped. Returns { add: key[], drop: key[] }.
 */
export function streamDiff(resident, want, keep, dist = () => 0) {
  const add = [...want].filter((k) => !resident.has(k)).sort((a, b) => dist(a) - dist(b));
  const drop = [...resident].filter((k) => !want.has(k) && !keep.has(k));
  return { add, drop };
}

/**
 * The streaming window at arc length s: the band along the route (streamCells) plus the straight sightline along the
 * heading (the street keeps going past the corner the cab just turned). `sample(s)` must also give the unit heading
 * { hx, hz }. `reach` scales the distances (quality-governor.js shrinks it), `pad` grows them (hysteresis).
 */
export function windowCells(sample, s, { reach = 1, pad = 0 } = {}) {
  const behind = STREAM.behind * reach, ahead = STREAM.ahead * reach, side = STREAM.side * Math.max(0.75, reach);
  const cells = streamCells(sample, s, { behind, ahead, side, pad });
  const p = sample(s, {});
  const ray = (t, out) => { out.x = p.x + p.hx * (t - s); out.z = p.z + p.hz * (t - s); return out; };
  for (const k of streamCells(ray, s, { behind, ahead, side: side * 0.5, pad })) cells.add(k);
  return cells;
}

/** Every cell any window (with its hysteresis) reaches along a closed route of `length` m: nothing else is ever seen */
export function loopReach(sample, length, step = 25) {
  const reach = new Set();
  for (let s = 0; s < length; s += step) for (const k of windowCells(sample, s, { pad: STREAM.hysteresis })) reach.add(k);
  return reach;
}

/** Does the box [x0, x1] x [z0, z1] touch any of the cells? */
export function boxInCells(cells, x0, z0, x1 = x0, z1 = z0, cell = STREAM.cell) {
  const cx0 = Math.floor(x0 / cell), cx1 = Math.floor(x1 / cell), cz0 = Math.floor(z0 / cell), cz1 = Math.floor(z1 / cell);
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) if (cells.has(cellKey(cx, cz))) return true;
  return false;
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

// With city streaming (js/game/world.js), the builders only emit what the loop's windows can ever reach (loopReach)
let REACH = null;
/** Restrict cityKeep to these cells (null: back to the plain window). Game only, set before the city is built. */
export function setCityReach(cells) {
  REACH = WINDOW && cells ? cells : null;
}

/** Should the city builders emit something at (x, z) (or over the box to x1, z1)? Always true off the lowmem profile */
export function cityKeep(x0, z0, x1 = x0, z1 = z0) {
  if (REACH) return boxInCells(REACH, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
  return !WINDOW || inWindow(WINDOW, x0, z0, x1, z1);
}
