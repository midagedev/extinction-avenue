import assert from 'node:assert/strict';
import test from 'node:test';
import { thirds, trendStatus, TRENDS } from '../tools/perf-trend.mjs';

function series(key, values, t0 = 0) {
  return values.map((v, i) => ({ t: t0 + i * 30, [key]: v }));
}

test('thirds ignores warmup and splits the rest into equal ends', () => {
  const rows = series('audioLive', [1, 2, 10, 11, 12, 40, 41, 42]);
  const t = thirds(rows, 'audioLive', { warmup: 30 });
  assert.ok(t);
  assert.equal(t.n, 2);
  assert.equal(t.first, 10.5);
  assert.equal(t.last, 41.5);
});

test('a flat series passes and a climb past both margins fails', () => {
  const flat = thirds(series('programs', [80, 80, 81, 80, 82, 81, 80, 81, 80]), 'programs');
  assert.equal(trendStatus(flat, TRENDS.programs), 'PASS');
  const climb = thirds(series('audioLive', [40, 42, 44, 200, 220, 240, 400, 420, 440]), 'audioLive');
  assert.equal(trendStatus(climb, TRENDS.audioLive), 'FAIL');
});

test('absolute slack absorbs a small count bump the relative test would flag', () => {
  const bump = thirds(series('programs', [10, 10, 10, 12, 12, 12, 13, 13, 13]), 'programs');
  assert.ok((bump.last - bump.first) / bump.first > TRENDS.programs.rel);
  assert.equal(trendStatus(bump, TRENDS.programs), 'PASS');
});

test('frame time that drifts up across a soak fails', () => {
  const slow = thirds(series('frameMs', [30, 31, 32, 40, 42, 44, 55, 58, 60]), 'frameMs');
  assert.equal(trendStatus(slow, TRENDS.frameMs), 'FAIL');
  const steady = thirds(series('frameMs', [48, 52, 47, 51, 49, 53, 50, 48, 52]), 'frameMs');
  assert.equal(trendStatus(steady, TRENDS.frameMs), 'PASS');
});
