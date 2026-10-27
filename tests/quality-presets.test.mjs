import assert from 'node:assert/strict';
import test from 'node:test';
import { QUALITY, LOOKS } from '../js/game/quality-presets.js';
import { QualityGovernor, GOVERNOR_STEPS, PIXEL_RATIO_FLOOR } from '../js/game/quality-governor.js';

// The screen-clarity pass (2026-10-27): "the screen is too blurry/milky, I can barely see the enemies"

test('phones render at 2–2.4x with a light sharpen and no SSR; desktop High caps at 2x', () => {
  const p = QUALITY.phone;
  assert.ok(p.pixelRatio >= 2.0 && p.pixelRatio <= 2.4, `phone pixel ratio ${p.pixelRatio}`);
  assert.equal(p.ssr, false);
  assert.ok(p.sharpen > 0 && p.sharpen <= 0.5);
  assert.ok(p.shadowMap <= 1024, 'phone shadow cascades stay small (memory)');
  assert.equal(QUALITY.high.pixelRatio, 2.0);
  for (const q of Object.values(QUALITY)) assert.ok([0, 2, 4].includes(q.samples), 'MSAA samples 0 / 2 / 4');
});

test('bloom only catches emissives: threshold 1.3–1.6, strength 0.25–0.35 in every look', () => {
  for (const [id, l] of Object.entries(LOOKS)) {
    assert.ok(l.threshold >= 1.3 && l.threshold <= 1.6, `${id} threshold ${l.threshold}`);
    assert.ok(l.bloom >= 0.25 && l.bloom <= 0.35, `${id} strength ${l.bloom}`);
  }
});

function fakeWorld(pr = QUALITY.phone.pixelRatio) {
  const w = {
    pr, reach: 1,
    renderer: { getPixelRatio: () => w.pr, setPixelRatio: (v) => { w.pr = v; }, info: { memory: { total: 100e6 } } },
    lighting: { sunLight: { castShadow: true } },
    stream: { setReach: (r) => { w.reach = r; } }
  };
  return w;
}

function runSlow(gov, seconds) {
  for (let t = 0; t < seconds; t += 1 / 20) gov.update(1 / 20); // 20 fps: always "slow"
}

test('governor: shadows and stream reach go before resolution, which never drops below 1.5x', () => {
  const prevDpr = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 3;
  try {
    const w = fakeWorld();
    const gov = new QualityGovernor({ world: w, onResize: () => {}, log: () => {} });
    const firstPr = GOVERNOR_STEPS.findIndex((s) => s.pixelRatio);
    assert.ok(GOVERNOR_STEPS.findIndex((s) => s.shadows === false) < firstPr, 'shadows first');
    assert.ok(GOVERNOR_STEPS.findIndex((s) => s.streamReach) < firstPr, 'stream reach before resolution');
    runSlow(gov, 10);
    assert.equal(gov.step, 1);
    assert.equal(w.lighting.sunLight.castShadow, false);
    assert.equal(w.pr, QUALITY.phone.pixelRatio, 'the first step keeps the resolution');
    runSlow(gov, 200);
    assert.equal(gov.step, GOVERNOR_STEPS.length);
    assert.equal(w.pr, PIXEL_RATIO_FLOOR);
    assert.ok(PIXEL_RATIO_FLOOR >= 1.5);
    assert.equal(w.reach, 0.5);
  } finally {
    globalThis.devicePixelRatio = prevDpr;
  }
});

test('governor: never raises the pixel ratio of a device below the step', () => {
  const prevDpr = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 1.25;
  try {
    const w = fakeWorld(1.25);
    const gov = new QualityGovernor({ world: w, onResize: () => {}, log: () => {} });
    for (let i = 0; i < GOVERNOR_STEPS.length; i++) gov.stepDown('test');
    assert.equal(w.pr, 1.25);
  } finally {
    globalThis.devicePixelRatio = prevDpr;
  }
});

test('governor: GPU allocations over budget step down even when frames are fast', () => {
  const w = fakeWorld();
  w.renderer.info.memory.total = 400e6;
  const gov = new QualityGovernor({ world: w, onResize: () => {}, log: () => {} });
  for (let t = 0; t < 4; t += 1 / 60) gov.update(1 / 60);
  assert.equal(gov.step, 1);
});
