// tools/audio/slices.js — lists the separate sound events inside source recordings (onset, length, peak, brightness)
// so sfx.js can cut single shots / cracks / calls out of long CC0 takes.
//   node tools/audio-build.mjs tools/audio/slices.js '{"files":["…"],"th":-30}'
import { findEvents } from './sfx-util.js';

export default async function (lab, args) {
  const out = {};
  for (const f of args.files) {
    try {
      const b = await lab.load(f);
      const ev = findEvents(b, { th: args.th ?? -30, gap: args.gap ?? 0.12 });
      out[f.split('/').slice(-2).join('/')] = `${b.duration.toFixed(2)}s ch${b.numberOfChannels} :: ` + ev.slice(0, 40).map((e) => `${e.t.toFixed(2)}+${e.len.toFixed(2)} ${e.peak.toFixed(0)}dB z${e.zcr.toFixed(2)}`).join(' | ');
    } catch (err) { out[f] = 'ERR ' + err.message; }
  }
  return { log: out };
}
