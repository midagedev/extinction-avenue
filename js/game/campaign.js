// js/game/campaign.js
// Sector clears, stars and best scores. Pure data so the map and the results card share one record,
// and so unit tests can run it without a browser. localStorage is only touched by load/save.

const KEY = 'ea-campaign';

function freshProgress() {
  return { v: 1, stages: {} };
}

function loadProgress() {
  const p = freshProgress();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && raw.stages && typeof raw.stages === 'object') p.stages = raw.stages;
  } catch { /* private mode, or no localStorage */ }
  return p;
}

function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, stages: p.stages })); } catch { /* ignore */ }
}

function record(p, id) {
  return p.stages[id] || (p.stages[id] = { best: 0, stars: 0, clears: 0, bestTime: 0 });
}

/** Stars for a finished run: 1 for a clear, 2 with no continues, 3 with no continues under par. */
function starsFor(stage, { win, time, continues }) {
  if (!win) return 0;
  if (continues > 0) return 1;
  return time <= stage.par ? 3 : 2;
}

/**
 * Writes a run into the progress object. A loss still keeps a higher score.
 * Returns { stars, best, clears }.
 */
function applyResult(p, stage, run) {
  const rec = record(p, stage.id);
  const score = run.score || 0;
  if (score > rec.best) rec.best = score;
  const stars = starsFor(stage, run);
  if (run.win) {
    rec.clears += 1;
    rec.stars = Math.max(rec.stars, stars);
    if (!rec.bestTime || run.time < rec.bestTime) rec.bestTime = run.time;
  }
  return { stars, best: rec.best, clears: rec.clears };
}

/** Stage 0 is open. Each later stage opens when the previous one has been cleared. */
function isUnlocked(p, stages, index) {
  if (index <= 0) return true;
  const prev = stages[index - 1];
  return !!prev && (p.stages[prev.id]?.clears || 0) > 0;
}

function totalStars(p) {
  let n = 0;
  for (const id in p.stages) n += p.stages[id].stars || 0;
  return n;
}

export { KEY, freshProgress, loadProgress, saveProgress, starsFor, applyResult, isUnlocked, totalStars };
