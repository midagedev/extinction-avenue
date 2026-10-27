import assert from 'node:assert/strict';
import test from 'node:test';
import { thirds, trendStatus, TRENDS } from '../tools/perf-trend.mjs';

function series(key, values, t0 = 0) {
  return values.map((v, i) => ({ t: t0 + i * 30, [key]: v }));
}

test('thirds ignores warmup and splits the rest into equal ends', () => {
  const rows = series('audioLive', [1, 2, 10, 11, 12, 40, 41, 42]);
  const t = thirds(rows, 'audioLive', { warmup: 60 });
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

test('a lap of city streaming does not fail geometries, a steady climb does', () => {
  const lap = thirds(series('geometries', [1670, 1570, 1540, 1600, 1660, 1700, 1760, 1810, 1790, 1760, 1720]), 'geometries');
  assert.equal(trendStatus(lap, TRENDS.geometries), 'PASS');
  const leak = thirds(series('geometries', [1500, 1600, 1700, 2000, 2200, 2400, 2800, 3000, 3200]), 'geometries');
  assert.equal(trendStatus(leak, TRENDS.geometries), 'FAIL');
});

test('canvas font keys that keep growing fail, and a plateau passes', () => {
  const grow = thirds(series('fontKeys', [800, 1600, 2400, 4000, 5000, 6000, 7500, 8500, 9100]), 'fontKeys');
  assert.equal(trendStatus(grow, TRENDS.fontKeys), 'FAIL');
  const flat = thirds(series('fontKeys', [40, 48, 52, 55, 55, 56, 56, 56, 56]), 'fontKeys');
  assert.equal(trendStatus(flat, TRENDS.fontKeys), 'PASS');
});

test('frame time that drifts up across a soak fails', () => {
  const slow = thirds(series('frameMs', [30, 31, 32, 40, 42, 44, 55, 58, 60]), 'frameMs');
  assert.equal(trendStatus(slow, TRENDS.frameMs), 'FAIL');
  const steady = thirds(series('frameMs', [48, 52, 47, 51, 49, 53, 50, 48, 52]), 'frameMs');
  assert.equal(trendStatus(steady, TRENDS.frameMs), 'PASS');
});
