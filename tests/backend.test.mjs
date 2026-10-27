import assert from 'node:assert/strict';
import test from 'node:test';
import { isWebKitOnly, pickBackend, fallbackURL, retryURL } from '../js/game/backend.js';

const UA = {
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariIPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeIPad: 'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
};
const P = (s = '') => new URLSearchParams(s);

test('isWebKitOnly: Safari and every iOS browser yes, Chromium/Firefox no', () => {
  assert.equal(isWebKitOnly(UA.safariMac), true);
  assert.equal(isWebKitOnly(UA.safariIPhone), true);
  assert.equal(isWebKitOnly(UA.chromeIPad), true);
  assert.equal(isWebKitOnly(UA.chromeMac), false);
  assert.equal(isWebKitOnly(UA.edgeWin), false);
  assert.equal(isWebKitOnly(UA.firefoxMac), false);
  assert.equal(isWebKitOnly(UA.chromeAndroid), false);
  assert.equal(isWebKitOnly(''), false);
});

test('pickBackend: Safari macOS and iOS default to WebGL2', () => {
  assert.equal(pickBackend(UA.safariMac, P(), true), 'webgl');
  assert.equal(pickBackend(UA.safariIPhone, P(), true), 'webgl');
  assert.equal(pickBackend(UA.chromeIPad, P(), true), 'webgl');
});

test('pickBackend: Chrome / Edge keep WebGPU', () => {
  assert.equal(pickBackend(UA.chromeMac, P(), true), 'webgpu');
  assert.equal(pickBackend(UA.edgeWin, P('quality=low'), true), 'webgpu');
});

test('pickBackend: ?webgpu opts Safari back in, ?webgl forces WebGL2, no navigator.gpu means WebGL2', () => {
  assert.equal(pickBackend(UA.safariMac, P('webgpu'), true), 'webgpu');
  assert.equal(pickBackend(UA.safariMac, P('webgpu'), false), 'webgl');
  assert.equal(pickBackend(UA.chromeMac, P('webgl'), true), 'webgl');
  assert.equal(pickBackend(UA.chromeMac, P('webgl&webgpu'), true), 'webgl');
  assert.equal(pickBackend(UA.firefoxMac, P(), false), 'webgl');
});

test('fallbackURL: adds webgl (+ autostart after START), drops webgpu, keeps other params', () => {
  const base = 'https://midagedev.github.io/extinction-avenue/';
  assert.equal(fallbackURL(base), `${base}?webgl`);
  assert.equal(fallbackURL(base, { autostart: true }), `${base}?webgl&autostart`);
  assert.equal(fallbackURL(`${base}?quality=low&webgpu`, { autostart: true }), `${base}?quality=low&webgl&autostart`);
});

test('fallbackURL: never loops once on WebGL2', () => {
  assert.equal(fallbackURL('https://x.test/?webgl'), null);
  assert.equal(fallbackURL('https://x.test/?quality=low&webgl&autostart', { autostart: true }), null);
});

test('retryURL: always WebGL2 + autostart', () => {
  assert.equal(retryURL('https://x.test/g/'), 'https://x.test/g/?webgl&autostart');
  assert.equal(retryURL('https://x.test/g/?webgl'), 'https://x.test/g/?webgl&autostart');
  assert.equal(retryURL('https://x.test/g/?webgpu&quality=high'), 'https://x.test/g/?quality=high&webgl&autostart');
});
