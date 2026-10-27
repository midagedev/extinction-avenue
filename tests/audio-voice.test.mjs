import assert from 'node:assert/strict';
import test from 'node:test';
import { disconnectVoice } from '../js/game/audio-voice.js';

test('releasing a voice disconnects the reverb send and the air filter', () => {
  const calls = [];
  const node = (name) => ({ disconnect() { calls.push(name); } });
  const v = { src: node('src'), air: node('air'), gain: node('gain'), panner: node('panner'), send: node('send') };
  v.src.onended = () => {};
  assert.equal(disconnectVoice(v), 2);
  assert.deepEqual(calls, ['src', 'air', 'gain', 'panner', 'send']);
  assert.equal(v.src, null);
  assert.equal(v.send, null);
  assert.equal(v.air, null);
});
