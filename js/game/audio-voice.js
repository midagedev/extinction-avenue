// Nodes a voice owns, in disconnect order. `air` (far lowpass) and `send` (reverb) used to be left
// connected to the shared reverb bus, so the audio graph grew for the whole session.

const VOICE_NODES = ['src', 'air', 'gain', 'panner', 'send'];

function disconnectVoice(v) {
  if (!v) return 0;
  let extras = 0;
  if (v.air) extras++;
  if (v.send) extras++;
  for (const k of VOICE_NODES) {
    const n = v[k];
    if (n && typeof n.disconnect === 'function') {
      try { n.disconnect(); } catch { /* already disconnected */ }
    }
  }
  if (v.src) v.src.onended = null;
  for (const k of VOICE_NODES) v[k] = null;
  return extras;
}

export { VOICE_NODES, disconnectVoice };
