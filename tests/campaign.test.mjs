import assert from 'node:assert/strict';
import test from 'node:test';
import { STAGES, firstWhoa, scriptDuration, stageById } from '../js/game/stages.js';
import { freshProgress, applyResult, isUnlocked, starsFor, totalStars } from '../js/game/campaign.js';
import { Route } from '../js/game/route.js';

const route = new Route();

test('the outbreak map has six sectors plus the T. rex finale', () => {
  assert.equal(STAGES.length, 7);
  assert.equal(STAGES.filter((s) => s.finale === 'trex').length, 1);
  assert.equal(STAGES[STAGES.length - 1].id, 'gridlock');
  assert.equal(new Set(STAGES.map((s) => s.id)).size, STAGES.length);
});

test('every sector starts on the patrol, near its real corner, with an early set piece', () => {
  for (const s of STAGES) {
    assert.ok(s.startS > 0 && s.startS < route.length, s.id);
    const at = route.sample(s.startS);
    const dist = Math.hypot(at.x - s.marker.x, at.z - s.marker.z);
    assert.ok(dist < 450, `${s.id} start is ${dist.toFixed(0)} m from its marker`);
    const whoa = firstWhoa(s);
    assert.ok(whoa !== null && whoa <= 22, `${s.id} whoa at ${whoa}`);
    const dur = scriptDuration(s);
    if (s.finale === 'trex') assert.ok(dur >= 30 && dur <= 80, s.id);
    else assert.ok(dur >= 80 && dur <= 160, `${s.id} dur ${dur}`);
    assert.ok(s.finale === 'trex' || s.beats.at(-1).boss, s.id);
    assert.ok(s.par >= dur * 0.5, s.id);
  }
});

test('clears unlock the next sector and stars follow continues and par', () => {
  const p = freshProgress();
  assert.equal(isUnlocked(p, STAGES, 0), true);
  assert.equal(isUnlocked(p, STAGES, 1), false);
  const times = stageById('times');
  assert.equal(starsFor(times, { win: false, time: 10, continues: 0 }), 0);
  assert.equal(starsFor(times, { win: true, time: 10, continues: 1 }), 1);
  assert.equal(starsFor(times, { win: true, time: times.par + 5, continues: 0 }), 2);
  assert.equal(starsFor(times, { win: true, time: times.par - 1, continues: 0 }), 3);
  applyResult(p, times, { win: true, score: 12000, time: 90, continues: 0 });
  assert.equal(isUnlocked(p, STAGES, 1), true);
  assert.equal(isUnlocked(p, STAGES, 2), false);
  applyResult(p, times, { win: false, score: 40000, time: 40, continues: 2 });
  assert.equal(p.stages.times.best, 40000);
  assert.equal(p.stages.times.stars, 3);
  assert.equal(p.stages.times.clears, 1);
  assert.equal(totalStars(p), 3);
});
