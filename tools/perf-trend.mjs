// Pure trend check for the long-soak frame-cost probe (tools/perf-decay-probe.mjs) and the QA soak.
// A series fails when the last-third mean is above the first-third mean by both a relative and an absolute margin,
// after an optional warmup. Flat or falling series pass. Noise floors keep a 40 → 46 blip from failing a count.

/**
 * @param {Array<Record<string, number>>} samples rows in time order
 * @param {string} key numeric field
 * @param {{ warmup?: number, timeKey?: string }} [opts]
 * warmup is compared against row[timeKey] (default `t`, seconds).
 */
function thirds(samples, key, { warmup = 0, timeKey = 't' } = {}) {
  const xs = samples.filter((r) => r && Number.isFinite(+r[key]) && (+r[timeKey] || 0) >= warmup);
  if (xs.length < 3) return null;
  const n = Math.floor(xs.length / 3);
  const mean = (a) => a.reduce((s, r) => s + +r[key], 0) / a.length;
  const first = mean(xs.slice(0, n));
  const last = mean(xs.slice(-n));
  return { first, last, n, ratio: first > 0 ? last / first : (last > 0 ? Infinity : 1) };
}

/**
 * @param {{ first: number, last: number }} t
 * @param {{ rel?: number, abs?: number }} tol last may exceed first by `rel` fraction or `abs` units before failing
 * @returns {'PASS' | 'FAIL'}
 */
function trendStatus(t, { rel = 0.15, abs = 0 } = {}) {
  if (!t) return 'PASS';
  const grew = t.last - t.first;
  if (grew <= abs) return 'PASS';
  if (t.first <= 0) return grew > abs ? 'FAIL' : 'PASS';
  return grew / t.first > rel ? 'FAIL' : 'PASS';
}

// What the soak is allowed to do. Relative slack covers the cab driving into a heavier block; absolute slack covers
// counters that sit near zero (a couple of extra geometries from a boss that has not despawned yet).
const TRENDS = {
  frameMs: { rel: 0.18, abs: 8 },
  drawCalls: { rel: 0.12, abs: 40 },
  objects: { rel: 0.08, abs: 80 },
  programs: { rel: 0.05, abs: 4 },
  geometries: { rel: 0.08, abs: 30 },
  textures: { rel: 0.08, abs: 6 },
  audioLive: { rel: 0.25, abs: 24 },
  // Distinct canvas font strings. Safari caches each one until the tab is backgrounded; a quantized font set plateaus.
  fontKeys: { rel: 0.15, abs: 40 }
};

export { thirds, trendStatus, TRENDS };
