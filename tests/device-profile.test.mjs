import assert from 'node:assert/strict';
import test from 'node:test';
import { detectProfile, cityWindow, inWindow, cityKeep, LOWMEM } from '../js/device-profile.js';

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
