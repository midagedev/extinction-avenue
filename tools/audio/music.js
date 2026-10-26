// tools/audio/music.js — builds assets/audio/music/*.mp3 + the music part of assets/audio/manifest.json.
//   node tools/audio-build.mjs tools/audio/music.js            (everything)
//   node tools/audio-build.mjs tools/audio/music.js '{"only":["boss_sting"]}'
//
// CC0 tracks (sources in .tools/dl/audio/music, see ASSETS.md §3) are decoded, trimmed to their exact musical loop
// (MP3 sources carry encoder/decoder padding at both ends: removed), cut to a section where noted, loudness-normalised
// to a per-cue target and written with a short pre-roll (end of the loop) and post-roll (start of the loop). Playing
// loopStart → loopEnd is then seamless even if the browser's MP3 decoder shifts the audio by a few ms.
// Original pieces (boss-incoming sting, combat heat layer) are composed and rendered here with tools/audio/synth.js.

import { Session, reseed, midi } from './synth.js';

const DL = '.tools/dl/audio/music/';
const OUT = 'assets/audio/music/';
const ROLL = 0.25; // seconds of pre/post roll around loops

// kind: 'loop' (whole file is the loop) | 'section' (cut [bar0, bar0+bars) out of the file, crossfaded seam) | 'oneshot'
const TRACKS = {
  title: { src: 'cyberpunk-moonlight-sonata/Cyberpunk_Moonlight_Sonata_v2.mp3', kind: 'loop', bpm: 108, beatsPerBar: 3, bars: 70, lufs: -17 },
  combat: { src: 'a-flawless-getaway/a_flawless_getaway_loop.mp3', kind: 'loop', bpm: 130, beatsPerBar: 4, bars: 92, lufs: -16 },
  combat_hi: { src: 'hunter-class-lifeform/hunter-class_lifeform.mp3', kind: 'loop', bpm: 129, beatsPerBar: 4, bars: 80, lufs: -15.5 },
  breather: { src: 'net-infiltration/net_infiltration_loop.mp3', kind: 'loop', bpm: null, beatsPerBar: 4, bars: 96, lufs: -17.5 },
  boss1: { src: 'boss-battle-8-metal/boss_battle_8_metal_loop.wav', kind: 'loop', bpm: null, beatsPerBar: 4, bars: null, lufs: -16, lazy: true },
  boss2_intro: { src: 'boss-battle-9-metal/boss_battle_9_metal_opening.wav', kind: 'oneshot', lufs: -15.5, lazy: true },
  boss2: { src: 'boss-battle-9-metal/boss_battle_9_metal_loop.wav', kind: 'loop', bpm: 113, beatsPerBar: 4, bars: 20, lufs: -15.5, lazy: true },
  boss3: { src: 'unholy-surge/unholy_surge.mp3', kind: 'section', bpm: 166, firstBeat: 0.03, beatsPerBar: 4, bar0: 12, bars: 32, lufs: -15, lazy: true },
  victory: { src: 'victory-fanfare-short/Heavy_ConceptB.wav', kind: 'oneshot', lufs: -14 },
  continue: { src: 'continue-theme/Continue Theme (Loop).ogg', kind: 'loop', bpm: 138, beatsPerBar: 4, bars: 20, lufs: -16 },
  gameover: { src: 'racing-game-finish-jingle/mp3_Racing Game Finish & Jingle/Race Finish Bad/Race Finish Bad (Jingle).mp3', kind: 'oneshot', lufs: -16 },
  results: { src: 'racing-game-finish-jingle/mp3_Racing Game Finish & Jingle/Race Finish Good/Race Finish Good (Loop)_BPM130.mp3', kind: 'loop', bpm: 130, beatsPerBar: 4, bars: 22, lufs: -18 }
};

/** First/last sample above `th` (any channel) */
function bounds(buf, th = 1e-4) {
  const n = buf.length;
  const amp = (i) => { let a = 0; for (let c = 0; c < buf.numberOfChannels; c++) a = Math.max(a, Math.abs(buf.getChannelData(c)[i])); return a; };
  let s = 0; while (s < n && amp(s) < th) s++;
  let e = n - 1; while (e > s && amp(e) < th) e--;
  return [s, e + 1];
}

function slice(buf, s0, s1) {
  const out = new AudioBuffer({ numberOfChannels: 2, length: s1 - s0, sampleRate: buf.sampleRate });
  for (let c = 0; c < 2; c++) out.getChannelData(c).set(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)).subarray(s0, s1));
  return out;
}

/** Loop content `L` → [last ROLL of L][L][first ROLL of L] */
function withRolls(L) {
  const r = Math.floor(ROLL * L.sampleRate);
  const out = new AudioBuffer({ numberOfChannels: 2, length: L.length + 2 * r, sampleRate: L.sampleRate });
  for (let c = 0; c < 2; c++) {
    const d = out.getChannelData(c), s = L.getChannelData(c);
    d.set(s.subarray(s.length - r), 0);
    d.set(s, r);
    d.set(s.subarray(0, r), r + s.length);
  }
  return out;
}

/** Equal-power crossfaded section loop: content = src[a, b) with the material after b faded into the head */
function sectionLoop(buf, a, b, xf) {
  const len = b - a;
  const out = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: buf.sampleRate });
  for (let c = 0; c < 2; c++) {
    const s = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)), d = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      if (i < xf) { const k = i / xf; d[i] = s[a + i] * Math.sin(k * Math.PI / 2) + s[b + i] * Math.cos(k * Math.PI / 2); }
      else d[i] = s[a + i];
    }
  }
  return out;
}

function gainTo(buf, g) {
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
}

/** Gentle peak control after loudness gain: soft knee above −1.5 dBFS (rarely engaged) */
function softClip(buf, ceil = 0.89) {
  let hits = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > ceil * 0.85) { const k = ceil * 0.85, over = a - k; d[i] = Math.sign(d[i]) * (k + (ceil - k) * Math.tanh(over / (ceil - k))); hits++; }
    }
  }
  return hits;
}

async function cc0(lab, id, t) {
  const buf = await lab.load(DL + t.src);
  const sr = buf.sampleRate;
  const [s0, s1] = bounds(buf, t.kind === 'oneshot' ? 2e-3 : 1e-4);
  let content, firstBeat = 0, bpm = t.bpm, bars = t.bars;
  if (t.kind === 'section') {
    const bar = (60 / t.bpm) * t.beatsPerBar;
    const a = Math.round((t.firstBeat + t.bar0 * bar) * sr), b = Math.round((t.firstBeat + (t.bar0 + t.bars) * bar) * sr);
    content = sectionLoop(buf, a, b, Math.round((60 / t.bpm) * sr));
  } else if (t.kind === 'loop') {
    // Integer-bar loops: snap the trimmed length to the musical length when they agree within 60 ms
    let e1 = s1;
    if (t.bpm && t.bars) {
      const want = Math.round(((t.bars * t.beatsPerBar * 60) / t.bpm) * sr);
      if (Math.abs(want - (s1 - s0)) < 0.06 * sr && s0 + want <= buf.length) e1 = s0 + want;
      else console.warn(`${id}: trimmed ${((s1 - s0) / sr).toFixed(3)} s vs ${(want / sr).toFixed(3)} s musical length`);
    }
    content = slice(buf, s0, e1);
    if (!bpm && bars) bpm = (bars * t.beatsPerBar * 60) / content.duration;
    if (bpm && !bars) bars = Math.round(content.duration / ((60 / bpm) * t.beatsPerBar));
    if (!bpm) { // boss1: measured 133.33 (66.67 ×2) → snap to the loop length
      bpm = 133.333;
      bars = Math.round(content.duration / ((60 / bpm) * t.beatsPerBar));
      bpm = (bars * t.beatsPerBar * 60) / content.duration;
    }
  } else {
    content = lab.shape(slice(buf, s0, s1), { fadeOut: 0.05 });
  }
  const m = await lab.measure(content);
  const g = 10 ** ((t.lufs - m.lufs) / 20);
  gainTo(content, g);
  const clipped = softClip(content);
  const out = t.kind === 'oneshot' ? content : withRolls(content);
  const file = `${OUT}${id}.mp3`;
  const stats = await lab.save(file, out, { kbps: 96 });
  const entry = { file, n: stats.n, lufs: +stats.lufs.toFixed(1), peak: +stats.peak.toFixed(1), dur: +out.duration.toFixed(3), lazy: !!t.lazy };
  if (t.kind !== 'oneshot') Object.assign(entry, { loop: true, loopStart: ROLL, loopEnd: +(ROLL + content.duration).toFixed(5), bpm: +bpm.toFixed(4), beatsPerBar: t.beatsPerBar, bars, firstBeat });
  return { entry, log: `${id}: src ${m.lufs.toFixed(1)} LUFS → ${stats.lufs.toFixed(1)} (gain ${(20 * Math.log10(g)).toFixed(1)} dB, ${clipped} soft-clipped samples), ${content.duration.toFixed(2)} s${bpm ? `, ${bpm.toFixed(3)} bpm × ${bars} bars` : ''}` };
}

// ---------------------------------------------------------------------------------------------------------------------
// Original: "Apex Approaching" — the boss-incoming sting (≈8.5 s, D minor with a flat-2 cluster). Plays over the
// warning klaxon: heartbeat drums that accelerate, a swelling low brass/choir cluster and reese drone, a riser, then
// one huge hit at 6.0 s whose tail rings out.
async function bossSting(lab) {
  reseed(77);
  const len = 9;
  const buf = await lab.render(len, (ctx) => {
    const S = new Session(ctx, { bpm: 120, master: 0.9 });
    S.addFx({ hall: 3.2, room: 1.1 });
    const drums = S.bus('drums', { gain: 1, hall: 0.35, room: 0.25 });
    const low = S.bus('low', { gain: 0.9, lp: 900, hall: 0.2 });
    const brass = S.bus('brass', { gain: 0.8, hall: 0.5, hp: 90 });
    const choir = S.bus('choir', { gain: 0.6, hall: 0.6, hp: 150 });
    const fx = S.bus('fx', { gain: 0.8, hall: 0.4 });
    S.impact(drums, 0.02, 0.8);
    // Heartbeat: pairs of hits, interval shrinking toward the big hit
    let t = 0.6, gap = 0.95;
    while (t < 5.75) {
      S.taiko(drums, t, 0.75, { tone: 58, len: 0.9 });
      S.taiko(drums, t + Math.min(0.22, gap * 0.28), 0.5, { tone: 52, len: 0.7 });
      t += gap; gap = Math.max(0.22, gap * 0.8);
    }
    for (let k = 0; k < 8; k++) S.tom(drums, 5.2 + k * 0.1, 45 - k, 0.45 + k * 0.05, 0.4);
    S.reese(low, 0.3, 5.6, 26, 0.9, { cut: 300, drive: 3 });
    // Cluster: D3 F3 A3 + Eb4 (flat 2) — swells, then the hit chord
    S.brass(brass, 1.2, 4.6, [50, 53, 57, 63], 0.55, { swell: 3.6, cut: 1900, r: 0.3 });
    S.choir(choir, 0.8, 5.0, [62, 63, 69], 0.55, { a: 3.8, r: 0.6, vowel: 'o' });
    S.riser(fx, 2.6, 3.4, 1);
    // The hit
    S.impact(drums, 6.0, 1.15);
    S.crash(drums, 6.0, 0.9, 3);
    S.brass(brass, 6.0, 1.4, [38, 50, 53, 57, 63], 0.9, { swell: 0.03, cut: 2600, r: 1.2 });
    S.reese(low, 6.0, 1.6, 26, 0.9, { cut: 500, drive: 5 });
    S.downlifter(fx, 6.05, 2.2, 0.8);
  });
  const shaped = lab.shape(buf, { trimEnd: -70, fadeOut: 0.4 });
  const m = await lab.measure(shaped);
  gainTo(shaped, 10 ** ((-14 - m.lufs) / 20));
  softClip(shaped);
  const st = await lab.save(`${OUT}boss_sting.mp3`, shaped, { kbps: 112 });
  return { entry: { file: `${OUT}boss_sting.mp3`, n: st.n, lufs: +st.lufs.toFixed(1), peak: +st.peak.toFixed(1), dur: +shaped.duration.toFixed(3), hitAt: 6.0, original: true }, log: `boss_sting: ${st.lufs.toFixed(1)} LUFS, peak ${st.peak.toFixed(1)}` };
}

// Original: combat heat layer — 4 bars of cinematic percussion (taiko, toms, low hits, shaker) at exactly the combat
// track's tempo, faded in over the CC0 combat loop when the fight heats up and re-aligned to its beat grid at runtime.
async function heatLayer(lab, bpm) {
  reseed(130);
  const beat = 60 / bpm, bar = beat * 4, bars = 4;
  const loopLen = bar * bars;
  // Render 1 bar of pre-roll so reverb tails wrap into the loop start, then cut
  const buf = await lab.render(loopLen + bar + 2, (ctx) => {
    const S = new Session(ctx, { bpm, master: 0.85 });
    S.addFx({ hall: 2.2, room: 0.8 });
    const tk = S.bus('taiko', { gain: 0.95, hall: 0.22, room: 0.2, eq: [['lowshelf', 120, 2]] });
    const tm = S.bus('toms', { gain: 0.6, room: 0.3, pan: 0.15 });
    const sh = S.bus('shaker', { gain: 0.45, pan: -0.3, hp: 3000, room: 0.15 });
    const pattern = (b, t0) => {
      // taiko: 1, the "and" of 2, 3; bar 4 gets a tom run
      S.taiko(tk, t0, 0.9, { tone: 60, len: 1.0 });
      S.taiko(tk, t0 + beat * 1.5, 0.55, { tone: 66, len: 0.7 });
      S.taiko(tk, t0 + beat * 2, 0.8, { tone: 56, len: 1.0 });
      if (b % 2 === 1) S.taiko(tk, t0 + beat * 3.5, 0.5, { tone: 70, len: 0.5 });
      for (let s = 0; s < 16; s++) S.shaker(sh, t0 + s * beat / 4, s % 4 === 2 ? 1 : 0.55);
      if (b === 3) for (let k = 0; k < 6; k++) S.tom(tm, t0 + beat * 2.5 + k * beat / 4, 50 - k * 2, 0.55 + k * 0.06, 0.45);
      else { S.tom(tm, t0 + beat * 3, 47, 0.45, 0.4); S.tom(tm, t0 + beat * 3.25, 45, 0.35, 0.4); }
    };
    pattern(3, 0); // pre-roll bar = last bar of the loop
    for (let b = 0; b < bars + 1; b++) pattern(b % bars, bar + b * bar);
  });
  const sr = buf.sampleRate;
  const a = Math.round((bar - ROLL) * sr), b = Math.round((bar + loopLen + ROLL) * sr);
  const out = slice(buf, a, b);
  const m = await lab.measure(slice(buf, Math.round(bar * sr), Math.round((bar + loopLen) * sr)));
  gainTo(out, 10 ** ((-19 - m.lufs) / 20));
  softClip(out);
  const st = await lab.save(`${OUT}combat_heat.mp3`, out, { kbps: 96 });
  return { entry: { file: `${OUT}combat_heat.mp3`, n: st.n, lufs: +st.lufs.toFixed(1), peak: +st.peak.toFixed(1), dur: +out.duration.toFixed(3), loop: true, loopStart: ROLL, loopEnd: +(ROLL + loopLen).toFixed(5), bpm, beatsPerBar: 4, bars, firstBeat: 0, layerOf: 'combat', original: true }, log: `combat_heat: ${st.lufs.toFixed(1)} LUFS @ ${bpm} bpm` };
}

export default async function (lab, args) {
  const only = args.only ? new Set(args.only) : null;
  const want = (id) => !only || only.has(id);
  const music = {};
  const log = [];
  for (const [id, t] of Object.entries(TRACKS)) {
    if (!want(id)) continue;
    const r = await cc0(lab, id, t);
    music[id] = { ...r.entry, source: id };
    log.push(r.log);
  }
  if (want('boss_sting')) { const r = await bossSting(lab); music.boss_sting = r.entry; log.push(r.log); }
  if (want('combat_heat')) { const r = await heatLayer(lab, 130); music.combat_heat = r.entry; log.push(r.log); }
  void midi;
  return { manifest: { music }, manifestPath: 'assets/audio/manifest.json', log: log.join('\n') };
}
