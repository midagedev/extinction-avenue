import assert from 'node:assert/strict';
import test from 'node:test';
import { overlayFont, overlayFontPx } from '../js/game/overlay-font.js';

test('damage-number fonts quantize to a small reused set', () => {
  const keys = new Set();
  const raw = new Set();
  for (const size of [1, 1.35, 1.7]) {
    for (let pop = 0.5; pop <= 1.4; pop += 0.001) {
      for (const weight of [800, 900]) keys.add(overlayFont(2, size, pop, weight));
      raw.add(`${17 * 2 * size * pop}`);
    }
  }
  assert.ok(keys.size < 200, `quantized font set is ${keys.size}`);
  assert.ok(raw.size > 1000, 'the unrounded pixel size is a new string almost every frame');
  const finer = new Set(keys);
  for (let pop = 0.5; pop <= 1.4; pop += 0.0001) finer.add(overlayFont(2, 1.35, pop, 800));
  assert.equal(finer.size, keys.size, 'a finer sweep of the pop animation adds no new font strings');
  assert.equal(overlayFontPx(2, 1, 1), Math.round(34));
});
