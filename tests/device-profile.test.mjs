import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProfile, cityWindow, inWindow, cityKeep, LOWMEM, STREAM, cellOf, cellKey, streamCells, streamDiff, windowCells, loopReach, boxInCells, setCityReach } from '../js/device-profile.js';

const UA = {
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iPadOld: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  chromeIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'
};

test('detectProfile: iPhone, iPad and every iOS browser are lowmem', () => {
  assert.deepEqual(detectProfile({ ua: UA.iPhone }), { lowmem: true, reason: 'iOS' });
  assert.equal(detectProfile({ ua: UA.iPadOld }).lowmem, true);
  assert.equal(detectProfile({ ua: UA.chromeIOS }).lowmem, true);
});

test('detectProfile: iPadOS reporting as a Mac is caught by its touch points, a real Mac is not', () => {
  assert.deepEqual(detectProfile({ ua: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 5 }), { lowmem: true, reason: 'iPadOS' });
  assert.equal(detectProfile({ ua: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 }).lowmem, false);
  assert.equal(detectProfile({ ua: UA.firefoxMac, platform: 'MacIntel', maxTouchPoints: 1 }).lowmem, false);
});

test('detectProfile: Android / mobile UAs are lowmem', () => {
  assert.deepEqual(detectProfile({ ua: UA.android }), { lowmem: true, reason: 'mobile' });
});

test('detectProfile: desktop stays full quality unless deviceMemory is 4 GB or less', () => {
  assert.deepEqual(detectProfile({ ua: UA.chromeWin, deviceMemory: 8 }), { lowmem: false, reason: 'desktop' });
  assert.equal(detectProfile({ ua: UA.chromeWin }).lowmem, false); // deviceMemory unknown (Safari, Firefox)
  assert.equal(detectProfile({ ua: UA.macSafari, platform: 'MacIntel' }).lowmem, false);
  assert.equal(detectProfile({ ua: UA.chromeWin, deviceMemory: 4 }).lowmem, true);
  assert.equal(detectProfile({ ua: UA.chromeWin, deviceMemory: 2 }).lowmem, true);
});

test('detectProfile: ?lowmem forces it on, ?lowmem=0 forces it off', () => {
  assert.deepEqual(detectProfile({ ua: UA.chromeWin, deviceMemory: 8, search: '?lowmem' }), { lowmem: true, reason: '?lowmem' });
  assert.equal(detectProfile({ ua: UA.chromeWin, search: '?test&lowmem=1' }).lowmem, true);
  assert.deepEqual(detectProfile({ ua: UA.iPhone, search: '?lowmem=0' }), { lowmem: false, reason: '?lowmem=0' });
  assert.equal(detectProfile({ ua: UA.android, deviceMemory: 2, search: '?webgl&lowmem=off' }).lowmem, false);
});

test('detectProfile: no environment at all is desktop', () => {
  assert.equal(detectProfile().lowmem, false);
  assert.equal(detectProfile({}).lowmem, false);
});

test('cityWindow covers the whole patrol loop with the margin, inWindow tests boxes and points', () => {
  const w = cityWindow(100);
  // the loop corners (route.js LOOP)
  for (const [x, z] of [[0.4, -1204.3], [0.4, 640.5], [-584.8, 640.5], [-584.8, -1204.3]]) assert.ok(inWindow(w, x, z));
  assert.ok(inWindow(w, 90, 0));
  assert.ok(!inWindow(w, 120, 0));
  assert.ok(!inWindow(w, -300, 3000)); // downtown
  assert.ok(inWindow(w, -300, 700, -200, 3000)); // a box reaching into the window
  assert.ok(!inWindow(w, -5000, -5000, -4000, -4000));
});

test('cityKeep is always true off the lowmem profile (node has no navigator)', () => {
  assert.equal(LOWMEM, false);
  assert.equal(cityKeep(-300, 6000), true);
});

// ---- City chunk streaming window (js/game/city-stream.js) -----------------------------------------------------------

// A straight route along +z through x = 0 (s = z), like a leg of the loop
const straight = (s, out = {}) => { out.x = 0; out.z = s; out.hx = 0; out.hz = 1; return out; };

test('cellOf / cellKey: floor-based cells, negative coordinates included', () => {
  assert.deepEqual(cellOf(0, 0, 200), [0, 0]);
  assert.deepEqual(cellOf(199.9, -0.1, 200), [0, -1]);
  assert.deepEqual(cellOf(-200, 400, 200), [-1, 2]);
  assert.equal(cellKey(-1, 2), '-1,2');
});

test('streamCells: reaches far behind the cab (the gunner looks back) and less far ahead', () => {
  const opts = { cell: 100, behind: 600, ahead: 200, side: 50 };
  const w = streamCells(straight, 1000, opts);
  assert.ok(w.has(cellKey(0, 4)), 'cell 600 m behind'); // z 400..500
  assert.ok(w.has(cellKey(0, 11)), 'cell 150 m ahead'); // z 1100..1200
  assert.ok(!w.has(cellKey(0, 2)), 'nothing beyond behind + side (z < 350)');
  assert.ok(!w.has(cellKey(0, 13)), 'nothing 300 m ahead');
  // lateral: within `side` of the street only
  assert.ok(w.has(cellKey(-1, 10)) && w.has(cellKey(0, 10)), 'both sides of the street (x = 0 is a cell edge)');
  assert.ok(!w.has(cellKey(1, 10)) && !w.has(cellKey(-2, 10)), 'not a block further out');
});

test('streamCells: the padded (hysteresis) window contains the window', () => {
  const opts = { cell: 200, behind: 900, ahead: 450, side: 260 };
  const w = streamCells(straight, 5000, opts);
  const keep = streamCells(straight, 5000, { ...opts, pad: STREAM.hysteresis });
  for (const k of w) assert.ok(keep.has(k));
  assert.ok(keep.size > w.size);
});

test('streamCells: the window moves with the cab, its size stays bounded', () => {
  const sizes = [];
  for (let s = 0; s < 5000; s += 200) sizes.push(streamCells(straight, s).size);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 6, `about constant along a straight street: ${sizes}`);
  // default window: (900 + 450 + 2 * 260) m of street x (2 * 260) m ≈ 10 x 4 cells
  assert.ok(Math.max(...sizes) <= 44, `${Math.max(...sizes)} cells`);
});

test('streamDiff: adds the missing cells nearest first, drops only outside the hysteresis band', () => {
  const resident = new Set(['a', 'b', 'c']);
  const want = new Set(['b', 'c', 'd', 'e']);
  const dist = (k) => ({ d: 5, e: 1 })[k];
  assert.deepEqual(streamDiff(resident, want, new Set(['a', 'b', 'c', 'd', 'e']), dist), { add: ['e', 'd'], drop: [] });
  assert.deepEqual(streamDiff(resident, want, new Set(['b', 'c', 'd', 'e']), dist).drop, ['a']);
  assert.deepEqual(streamDiff(new Set(), new Set(), new Set()), { add: [], drop: [] });
});

// A 1000 x 600 m rectangular loop (like route.js LOOP), sampled by arc length with its heading
function rectLoop(w = 1000, h = 600) {
  const L = 2 * (w + h);
  return {
    length: L,
    sample(s, out = {}) {
      s = ((s % L) + L) % L;
      if (s < w) Object.assign(out, { x: s, z: 0, hx: 1, hz: 0 });
      else if (s < w + h) Object.assign(out, { x: w, z: s - w, hx: 0, hz: 1 });
      else if (s < 2 * w + h) Object.assign(out, { x: w - (s - w - h), z: h, hx: -1, hz: 0 });
      else Object.assign(out, { x: 0, z: h - (s - 2 * w - h), hx: 0, hz: -1 });
      return out;
    }
  };
}

test('windowCells: the straight sightline reaches past the corner the cab just turned', () => {
  const loop = rectLoop();
  // just after the corner at (1000, 0), heading +z: looking back along the heading means x = 1000, z < 0
  const w = windowCells(loop.sample, 1000 + 50);
  assert.ok(w.has(cellKey(...cellOf(1000, -600))), 'the street beyond the corner, behind the cab');
  const routeOnly = streamCells(loop.sample, 1000 + 50);
  assert.ok(!routeOnly.has(cellKey(...cellOf(1000, -600))));
  // a smaller reach (quality governor) gives a smaller window
  assert.ok(windowCells(loop.sample, 500, { reach: 0.5 }).size < w.size);
});

test('loopReach covers every window along the loop, and nothing far away', () => {
  const loop = rectLoop();
  const reach = loopReach(loop.sample, loop.length);
  for (let s = 0; s < loop.length; s += 137) for (const k of windowCells(loop.sample, s)) assert.ok(reach.has(k), `${k} at s=${s}`);
  assert.ok(!reach.has(cellKey(...cellOf(5000, 5000))));
  assert.ok(!reach.has(cellKey(...cellOf(500, 3000))), 'not 2.4 km off the loop');
});

test('boxInCells: boxes and points against a cell set', () => {
  const cells = new Set([cellKey(0, 0), cellKey(2, 0)]);
  assert.ok(boxInCells(cells, 10, 10));
  assert.ok(!boxInCells(cells, 250, 10)); // cell (1, 0)
  assert.ok(boxInCells(cells, 250, 10, 450, 20)); // spans into (2, 0)
  assert.ok(!boxInCells(cells, -50, -50, -10, -10));
});

test('setCityReach does nothing off the lowmem profile', () => {
  setCityReach(new Set());
  assert.equal(cityKeep(0, 0), true);
  setCityReach(null);
});
