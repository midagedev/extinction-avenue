// tools/audio/sfx.js — builds assets/audio/sfx/*.mp3 and the `sfx` part of assets/audio/manifest.json.
//   node tools/audio-build.mjs tools/audio/sfx.js                       (everything)
//   node tools/audio-build.mjs tools/audio/sfx.js '{"only":["trex_roar"]}'
//
// Every effect is designed here: CC0 / public-domain recordings (downloaded to .tools/dl/audio/sfx/<source>/, listed
// with URLs and licenses in ASSETS.md §3) are cut into single events, pitched, filtered, layered with procedural
// synthesis (sub thumps, formant growls, clicks, sweeps from tools/audio/synth.js) and short reverbs, rendered offline,
// peak-normalised and encoded as mono MP3. Several variations per sound; the runtime rotates through them.

import { Session, reseed, rnd, midi } from './synth.js';
import { findEvents, cut, play } from './sfx-util.js';

const D = '.tools/dl/audio/sfx/';
const FF = D + 'oga-free-firearm-sound-library/Prepared SFX Library/';
const K = D + 'kenney-impact-sounds/Audio/';
const KS = D + 'kenney-sci-fi-sounds/Audio/';
const KI = D + 'kenney-interface-sounds/Audio/';
const KD = D + 'kenney-digital-audio/Audio/';
const KU = D + 'kenney-ui-audio/Audio/';
const KC = D + 'kenney-casino-audio/Audio/';
const KV = D + 'kenney-voiceover-pack/Male/';
const KF = D + 'kenney-voiceover-pack-fighter/Audio/';
const RB = D + 'oga-rubberduck-75-breaking/';
const OUT = 'assets/audio/sfx/';

let lab;
const cache = new Map();
async function src(path) {
  if (!cache.has(path)) cache.set(path, lab.load(path));
  return cache.get(path);
}
/** The i-th event of a recording (wraps), as a mono buffer of up to `len` s */
async function event(path, i, len, o = {}) {
  const b = await src(path);
  const ev = findEvents(b, { th: o.th ?? -24, gap: o.gap ?? 0.2 });
  const e = ev[((i % ev.length) + ev.length) % ev.length];
  return cut(b, e.t + (o.skip || 0), Math.min(len, o.full ? 99 : len), { fadeOut: o.fadeOut ?? Math.min(0.08, len * 0.3) });
}
/** The loudest `len`-second windows of a long recording (non-overlapping), best first */
async function loudest(path, len, count = 4, { hop = 0.05 } = {}) {
  const b = await src(path);
  const sr = b.sampleRate, W = Math.floor(len * sr), H = Math.floor(hop * sr);
  const d = b.getChannelData(0);
  const sq = new Float64Array(b.length + 1);
  for (let i = 0; i < b.length; i++) sq[i + 1] = sq[i] + d[i] * d[i];
  const cand = [];
  for (let s = 0; s + W < b.length; s += H) cand.push([s, sq[s + W] - sq[s]]);
  cand.sort((a, b2) => b2[1] - a[1]);
  const picks = [];
  for (const [s] of cand) { if (picks.every((p) => Math.abs(p - s) >= W)) picks.push(s); if (picks.length >= count) break; }
  return picks.map((s) => cut(b, s / sr, len, { pre: 0, fadeIn: 0.03, fadeOut: 0.12 }));
}
async function whole(path, o = {}) { const b = await src(path); return cut(b, o.from || 0, o.len || b.duration, { pre: 0, fadeOut: o.fadeOut ?? 0.03 }); }

/** Render a mono effect: fn(ctx, S, out) schedules layers; returns trimmed, normalised buffer */
async function render(len, fn, { reverb = null, peak = -1, channels = 1, trim = -62, fade = 0.04 } = {}) {
  const buf = await lab.render(len, async (ctx) => {
    const S = new Session(ctx, { master: 1, glue: false });
    if (reverb) S.addFx(reverb);
    await fn(ctx, S, S.out);
  }, { channels });
  const sh = lab.shape(buf, { trimEnd: trim, fadeOut: fade });
  lab.normalize(sh, peak);
  return sh;
}
const bus = (S, o) => S.bus('b' + Math.floor(rnd() * 1e9), o);
const pick = (arr, k) => arr[((k % arr.length) + arr.length) % arr.length];
const thump = (S, out, t, f0, f1, v, len) => { S.osc('sine', f0, t, len, { to: f1, glide: len * 0.5 }).connect(S.vca(t, v, 0.002, 0, 1, 0.01, len)).connect(out); };
const click = (S, out, t, v = 0.5, f = 3500) => { S.noise(t, 0.01).connect(S.filt('highpass', f)).connect(S.vca(t, v, 0.0003, 0, 1, 0.002, 0.008)).connect(out); };

// ---------------------------------------------------------------------------------------------------------------------
const RIFLES = [['Mosin Nagant/M_21P.wav', 0], ['1917/B_24P.wav', 0], ['Tikka/W_29P.wav', 1], ['Savage 10 .300 Blackout/T_27P.wav', 0], ['Arisaka/E_25P.wav', 0], ['Mosin Nagant/M_21P.wav', 2], ['Marlin 336/I_22P.wav', 0], ['AR-15/D_32P.wav', 1]];
const SMG = [['Carl Gustav M45/G_31P.wav', 0], ['PPSh/P_30P.wav', 1], ['AK-47/C_28P.wav', 2], ['PPSh/P_30P.wav', 3], ['Carl Gustav M45/G_31P.wav', 2], ['AK-47/C_28P.wav', 0]];
const SHOTGUNS = [['Model 12/K_22P.wav', 0], ['Nova/O_21P.wav', 0], ['CD/H_21P.wav', 1], ['Mossberg/N_30P.wav', 0]];

const RECIPES = {
  // --- Tail gun ------------------------------------------------------------------------------------------------------
  // Short, punchy body (the tail is a separate sound played when the trigger is released, so sustained fire stays tight)
  gun: { n: 6, kbps: 96, async build(k) {
    const [f, i] = RIFLES[k];
    const shot = await event(FF + f, i, 0.42, { fadeOut: 0.25 });
    const mech = await whole(D + 'oga-qubodup-mech-clicks/mechanical/mechanical_clicks-0' + (1 + (k % 5)) + '.flac', { len: 0.08 });
    return render(0.5, (ctx, S, out) => {
      play(ctx, shot, out, { rate: 0.86 + k * 0.012, gain: 1, hp: 60, eq: [['peaking', 180, 4, 1], ['peaking', 2500, 2, 1]], curve: 1.6 });
      thump(S, out, 0, 150, 52, 0.55, 0.13);
      click(S, out, 0, 0.35, 2500);
      play(ctx, mech, out, { rate: 1.1, gain: 0.25, hp: 1500, at: 0.015 });
    });
  } },
  gun_tail: { n: 3, kbps: 80, async build(k) {
    const [f, i] = RIFLES[k * 2 + 1];
    const b = await src(FF + f);
    const e = findEvents(b, { th: -24, gap: 0.2 })[i];
    const tail = cut(b, e.t + 0.09, 1.3, { pre: 0, fadeIn: 0.04, fadeOut: 0.5 });
    return render(1.6, (ctx, S, out) => {
      const o = bus(S, { hall: 0.25 });
      play(ctx, tail, o, { rate: 0.85, lp: 3200, hp: 120 });
    }, { reverb: { hall: 2.4 } });
  } },
  casing: { n: 6, kbps: 64, async build(k) {
    const a = await whole(pick([K + 'impactMetal_light_000.ogg', K + 'impactMetal_light_001.ogg', K + 'impactMetal_light_002.ogg', K + 'impactMetal_light_003.ogg', K + 'impactMetal_light_004.ogg', D + 'oga-bmaczero-metal-impacts/clink1.wav'], k), { len: 0.3 });
    const b = await whole(pick([D + 'oga-bmaczero-metal-impacts/clink2.wav', D + 'oga-bmaczero-metal-impacts/clink3.wav', K + 'impactTin_medium_000.ogg'], k), { len: 0.25 });
    return render(0.5, (ctx, S, out) => {
      play(ctx, a, out, { rate: 1.7 + k * 0.08, gain: 0.8, hp: 1800 });
      play(ctx, b, out, { rate: 2.1 + k * 0.05, gain: 0.45, hp: 2500, at: 0.07 + (k % 3) * 0.03 });
      play(ctx, a, out, { rate: 2.4, gain: 0.2, hp: 3000, at: 0.16 + (k % 2) * 0.05 });
    });
  } },
  dry_fire: { n: 2, kbps: 64, async build(k) {
    const c = await whole(D + 'oga-qubodup-mech-clicks/mechanical/mechanical_clicks-0' + (2 + k) + '.flac', { len: 0.15 });
    return render(0.2, (ctx, S, out) => { play(ctx, c, out, { rate: 0.8, hp: 400 }); thump(S, out, 0, 400, 200, 0.2, 0.03); });
  } },
  reload_out: { n: 2, kbps: 80, async build(k) {
    const r = await event(D + 'oga-springyspringo-reloads/' + (k ? 'gunreload1.wav' : 'assaultriflereload1.wav'), 0, 0.45, { th: -20, gap: 0.08 });
    const thunk = await whole(K + 'impactPlate_light_00' + (k + 1) + '.ogg', { len: 0.25 });
    return render(0.6, (ctx, S, out) => { play(ctx, r, out, { rate: 0.85, hp: 150 }); play(ctx, thunk, out, { rate: 0.7, gain: 0.5, at: 0.05, lp: 3000 }); });
  } },
  reload_in: { n: 2, kbps: 80, async build(k) {
    const r = await event(D + 'oga-springyspringo-reloads/' + (k ? 'gunreload1.wav' : 'assaultriflereload1.wav'), 1, 0.45, { th: -20, gap: 0.08 });
    return render(0.6, (ctx, S, out) => { play(ctx, r, out, { rate: 0.85, hp: 150 }); thump(S, out, 0.005, 220, 90, 0.35, 0.08); });
  } },
  bolt: { n: 2, kbps: 80, async build(k) {
    const b = await whole(k ? D + 'bsb-gun-loading-1-s1988/1988.wav' : D + 'oga-springyspringo-reloads/shotguncock.wav', { len: 0.7 });
    return render(0.8, (ctx, S, out) => { play(ctx, b, out, { rate: 0.8, hp: 120, eq: [['peaking', 300, 3, 1]] }); });
  } },
  overheat: { n: 2, kbps: 80, async build(k) {
    const h = await whole(D + `oga-bart-steam-hisses/steam hisses - Marker #${2 + k}.wav`, { len: 1.2, fadeOut: 0.5 });
    const ping = await whole(K + 'impactMetal_light_00' + (2 + k) + '.ogg', { len: 0.3 });
    return render(1.4, (ctx, S, out) => {
      play(ctx, h, out, { gain: 0.8, hp: 900, env: [0.02, 0.5, 0.6] });
      for (let i = 0; i < 3; i++) play(ctx, ping, out, { rate: 2.2 + i * 0.3, gain: 0.25, at: 0.15 + i * 0.22 + rnd() * 0.05, hp: 2000 });
    });
  } },
  rail: { n: 3, kbps: 96, async build(k) {
    const [f, i] = RIFLES[1 + k];
    const shot = await event(FF + f, i, 0.6, { fadeOut: 0.3 });
    const zap = await whole(D + (k === 1 ? 'oga-bmaczero-electricity/spark.wav' : 'oga-faxcorp-electricity/hit.wav'), { len: 0.6, fadeOut: 0.2 });
    return render(1.2, (ctx, S, out) => {
      const o = bus(S, { hall: 0.2 });
      play(ctx, shot, o, { rate: 0.55, gain: 1, curve: 2 });
      play(ctx, zap, o, { rate: 1.2, gain: 0.5, hp: 1200 });
      const s = S.osc('sawtooth', 2400, 0, 0.35, { to: 120, glide: 0.3 });
      s.connect(S.filt('bandpass', 1800, 2)).connect(S.vca(0, 0.25, 0.002, 0, 1, 0.05, 0.3)).connect(o);
      thump(S, o, 0, 120, 30, 1, 0.5);
    }, { reverb: { hall: 1.8 } });
  } },
  // --- Hit feedback ---------------------------------------------------------------------------------------------------
  hitmarker: { n: 3, kbps: 64, async build(k) {
    const t = await whole(KI + pick(['tick_001.ogg', 'tick_002.ogg', 'tick_004.ogg'], k), { len: 0.1 });
    return render(0.15, (ctx, S, out) => {
      play(ctx, t, out, { rate: 1.3, gain: 0.7, hp: 1500 });
      S.osc('sine', 3100 + k * 140, 0, 0.05).connect(S.vca(0, 0.35, 0.001, 0, 1, 0.005, 0.04)).connect(out);
      click(S, out, 0, 0.4, 5000);
    });
  } },
  headshot: { n: 2, kbps: 64, async build(k) {
    const b = await whole(K + 'impactBell_heavy_00' + (k + 1) + '.ogg', { len: 0.5, fadeOut: 0.3 });
    return render(0.5, (ctx, S, out) => {
      play(ctx, b, out, { rate: 2.6, gain: 0.5, hp: 1500 });
      S.osc('sine', 1760 * (k ? 1.12 : 1), 0, 0.3).connect(S.vca(0, 0.4, 0.001, 0.1, 0.3, 0.05, 0.25)).connect(out);
      S.osc('sine', 2637 * (k ? 1.12 : 1), 0.04, 0.25).connect(S.vca(0.04, 0.3, 0.001, 0.1, 0.3, 0.05, 0.2)).connect(out);
      click(S, out, 0, 0.6, 4000);
    });
  } },
  // --- Kills: stone-crack shatter ------------------------------------------------------------------------------------
  fossilize: { n: 6, kbps: 80, async build(k) {
    const crack = await whole(pick([RB + 'bfh1_rock_breaking_01.ogg', K + 'impactMining_000.ogg', D + 'oga-qubodup-break-crunch/impcrunch/impactcrunch01.mp3.flac', RB + 'bfh1_rock_breaking_02.ogg', K + 'impactMining_002.ogg', D + 'oga-themightyglider-breaking-rock/rock_break.ogg'], k), { len: 0.5, fadeOut: 0.15 });
    const grit = await whole(RB + `bfh1_rock_falling_0${1 + (k % 9)}.ogg`, { len: 0.6, fadeOut: 0.2 });
    const shard = await whole(KI + `glass_00${1 + (k % 6)}.ogg`, { len: 0.4 });
    return render(0.8, (ctx, S, out) => {
      play(ctx, crack, out, { rate: 1.05 + (k % 3) * 0.08, gain: 1, hp: 200, eq: [['peaking', 2800, 3, 1]] });
      play(ctx, grit, out, { rate: 1.2, gain: 0.45, at: 0.04, hp: 500 });
      play(ctx, shard, out, { rate: 1.4 + k * 0.05, gain: 0.18, at: 0.01, hp: 3000 });
      thump(S, out, 0, 180, 70, 0.4, 0.09);
    });
  } },
  shatter_big: { n: 3, kbps: 96, async build(k) {
    const crack = await whole(pick([RB + 'bfh1_rock_breaking_03.ogg', D + 'oga-qubodup-break-crunch/impcrunch/impactcrunch03.mp3.flac', RB + 'bfh1_breaking_02.ogg'], k), { len: 1.0, fadeOut: 0.3 });
    const slide = (await loudest(D + 'oga-starninjas-cave-in/cave_in_-_starninjas.ogg', 1.4, 3))[k];
    const boulder = await whole(D + 'oga-themightyglider-moving-boulder/boulder_drop.ogg', { len: 0.6 });
    return render(1.9, (ctx, S, out) => {
      const o = bus(S, { room: 0.25 });
      play(ctx, crack, o, { rate: 0.8, gain: 1, curve: 1.3 });
      play(ctx, slide, o, { rate: 0.95, gain: 0.55, at: 0.05, hp: 120, env: [0.03, 0.8, 0.6] });
      play(ctx, boulder, o, { rate: 0.7, gain: 0.6, at: 0.02 });
      thump(S, o, 0, 90, 32, 1, 0.55);
    }, { reverb: { room: 1.2 } });
  } },
  // --- Explosions ----------------------------------------------------------------------------------------------------
  explosion: { n: 4, kbps: 96, async build(k) {
    const a = await whole(KS + `explosionCrunch_00${k}.ogg`, { fadeOut: 0.2 });
    const lf = await whole(KS + `lowFrequency_explosion_00${k % 2}.ogg`, { fadeOut: 0.3 });
    const deb = await whole(RB + `bfh1_rock_falling_0${3 + k}.ogg`, { len: 0.8 });
    return render(2.0, (ctx, S, out) => {
      const o = bus(S, { hall: 0.18 });
      play(ctx, a, o, { rate: 0.85, gain: 1, curve: 1.5 });
      play(ctx, lf, o, { gain: 0.8, lp: 400 });
      play(ctx, deb, o, { rate: 0.9, gain: 0.3, at: 0.25, hp: 800 });
      thump(S, o, 0, 70, 28, 1, 0.7);
      S.noise(0, 0.05).connect(S.filt('highpass', 2000)).connect(S.vca(0, 0.5, 0.0005, 0, 1, 0.005, 0.04)).connect(o);
    }, { reverb: { hall: 2.2 } });
  } },
  explosion_big: { n: 2, kbps: 96, async build(k) {
    const a = await whole(k ? D + 'oga-joth-chunky-explosion/Chunky Explosion.mp3' : D + 'oga-springspring-mech-explosion/mechanical_explosion.wav', { len: 3, fadeOut: 0.8 });
    const b = await whole(KS + `explosionCrunch_00${3 + k}.ogg`, { fadeOut: 0.2 });
    const metal = await whole(D + 'oga-rubberduck-100-metal-wood/metal_falling_01.ogg', { len: 1.8 });
    return render(3.2, (ctx, S, out) => {
      const o = bus(S, { hall: 0.3 });
      play(ctx, a, o, { rate: 0.8, gain: 1, curve: 1.2 });
      play(ctx, b, o, { rate: 0.6, gain: 0.8 });
      play(ctx, metal, o, { rate: 0.8, gain: 0.35, at: 0.5, hp: 300 });
      thump(S, o, 0, 60, 24, 1, 1.4);
      S.noise(0, 1.8, 'brown').connect(S.filt('lowpass', 300)).connect(S.vca(0, 0.9, 0.01, 0, 1, 0.3, 1.4)).connect(o);
    }, { reverb: { hall: 3 } });
  } },
  // --- Support weapons -----------------------------------------------------------------------------------------------
  gatling: { n: 5, kbps: 64, async build(k) {
    const [f, i] = SMG[k];
    const shot = await event(FF + f, i, 0.16, { fadeOut: 0.09 });
    return render(0.2, (ctx, S, out) => {
      play(ctx, shot, out, { rate: 1.05 + k * 0.03, hp: 150, eq: [['peaking', 1500, 3, 1]], curve: 1.4 });
      click(S, out, 0, 0.3, 3000);
    });
  } },
  shotgun: { n: 3, kbps: 96, async build(k) {
    const [f, i] = SHOTGUNS[k];
    const shot = await event(FF + f, i, 0.75, { fadeOut: 0.4 });
    return render(0.9, (ctx, S, out) => {
      const o = bus(S, { room: 0.15 });
      play(ctx, shot, o, { rate: 0.82, curve: 1.4, hp: 50 });
      thump(S, o, 0, 120, 38, 1, 0.25);
    }, { reverb: { room: 0.9 } });
  } },
  missile: { n: 3, kbps: 80, async build(k) {
    const m = await whole(k === 2 ? D + 'oga-qubodup-rocket-launch/launch/launch.wav' : D + 'oga-mikeask-missile/missile.wav', { len: 1.0, fadeOut: 0.4 });
    return render(1.1, (ctx, S, out) => {
      play(ctx, m, out, { rate: 1.1 + k * 0.1, gain: 1, hp: 200 });
      thump(S, out, 0, 200, 70, 0.6, 0.12);
      S.noise(0, 0.8).connect(S.filt('bandpass', 1200, 1.2)).connect(S.vca(0, 0.25, 0.04, 0, 1, 0.3, 0.4)).connect(out);
    });
  } },
  tesla: { n: 4, kbps: 64, async build(k) {
    const z = await whole(pick([D + 'oga-bmaczero-electricity/spark.wav', D + 'oga-faxcorp-electricity/hit.wav', KD + 'zap1.ogg', KD + 'zap2.ogg'], k), { len: 0.4, fadeOut: 0.15 });
    return render(0.45, (ctx, S, out) => {
      play(ctx, z, out, { rate: 1 + k * 0.06, gain: 0.9, hp: 300 });
      const o = S.osc('sawtooth', 90, 0, 0.25);
      const lfo = S.osc('square', 47 + k * 9, 0, 0.25);
      const lg = ctx.createGain(); lg.gain.value = 500; lfo.connect(lg).connect(o.frequency);
      o.connect(S.filt('highpass', 800)).connect(S.vca(0, 0.25, 0.002, 0, 1, 0.08, 0.15)).connect(out);
    });
  } },
  saw: { n: 3, kbps: 64, async build(k) {
    const s = await whole(D + 'oga-springspring-buzzsaw/saw.wav', { fadeOut: 0.1 });
    const m = await whole(K + `impactMetal_medium_00${k}.ogg`, { len: 0.3 });
    return render(0.4, (ctx, S, out) => { play(ctx, s, out, { rate: 1.1 + k * 0.1, gain: 0.7, len: 0.3, env: [0.005, 0.15, 0.12] }); play(ctx, m, out, { rate: 1.6, gain: 0.5, hp: 1500 }); });
  } },
  mine: { n: 1, kbps: 64, async build() {
    return render(0.25, (ctx, S, out) => { for (const [t, f] of [[0, 1760], [0.09, 2349]]) S.osc('square', f, t, 0.06).connect(S.filt('lowpass', 4000)).connect(S.vca(t, 0.3, 0.002, 0, 1, 0.05, 0.02)).connect(out); });
  } },
  airstrike: { n: 2, kbps: 80, async build(k) {
    // Incoming-shell whistle: a falling, slightly wavering tone with air noise (original synthesis)
    return render(1.7, (ctx, S, out) => {
      const o = S.osc('sine', 2600 - k * 300, 0, 1.5, { to: 420, glide: 1.45, curve: 'lin' });
      const v = S.osc('sine', 7, 0, 1.5); const vg = ctx.createGain(); vg.gain.value = 18; v.connect(vg).connect(o.frequency);
      o.connect(S.vca(0, 0.4, 0.3, 0, 1, 1.3, 0.15)).connect(out);
      S.noise(0, 1.5).connect(S.filt('bandpass', 2000, 2)).connect(S.vca(0, 0.12, 0.6, 0, 1, 0.8, 0.2)).connect(out);
    });
  } },
  flamer_loop: { n: 1, kbps: 80, loop: true, async build() {
    const fire = await whole(D + 'bsb-gasoline-fire-1-s1340/1340.wav', { from: 2, len: 3.4, fadeOut: 0 });
    const hiss = await whole(D + 'oga-0new4y-gas-leak/compressed_gas_leak.ogg', { len: 2 });
    return render(3.4, (ctx, S, out) => {
      play(ctx, fire, out, { gain: 1, hp: 150 });
      play(ctx, hiss, out, { gain: 0.35, hp: 2000 });
      play(ctx, hiss, out, { gain: 0.35, hp: 2000, at: 1.9 });
    }, { trim: -200, fade: 0 });
  } },
  // --- Cab damage ----------------------------------------------------------------------------------------------------
  hurt: { n: 4, kbps: 80, async build(k) {
    const plate = await whole(K + `impactPlate_heavy_00${k}.ogg`, { fadeOut: 0.2 });
    const sheet = await whole(D + `oga-rubberduck-100-metal-wood/metal_sheet_0${1 + k}.ogg`, { len: 0.7, fadeOut: 0.3 });
    const glass = await whole(K + `impactGlass_light_00${k}.ogg`, { len: 0.4 });
    return render(0.9, (ctx, S, out) => {
      play(ctx, plate, out, { rate: 0.75, gain: 1, curve: 1.3 });
      play(ctx, sheet, out, { rate: 0.85, gain: 0.5, at: 0.01 });
      play(ctx, glass, out, { rate: 1.1, gain: 0.3, at: 0.02, hp: 1500 });
      thump(S, out, 0, 110, 40, 0.9, 0.2);
    });
  } },
  glass: { n: 3, kbps: 80, async build(k) {
    const g = await whole(pick([D + 'bsb-glass-burst-s0148/0148.wav', D + 'bsb-mirror-explodes-s0387/0387.wav', D + 'oga-tinyworlds-glass-break/glass_breaking.wav'], k), { len: 1.4, fadeOut: 0.4 });
    return render(1.5, (ctx, S, out) => { play(ctx, g, out, { gain: 1, hp: 300 }); thump(S, out, 0, 140, 60, 0.4, 0.1); });
  } },
  // --- Creatures -----------------------------------------------------------------------------------------------------
  compy_chirp: { n: 5, kbps: 64, async build(k) {
    const crane = (await loudest(D + 'commons-yellowstone-sound-library-sandhill-crane-001/Yellowstone_sound_library_-_Sandhill_Crane_-_001.mp3', 0.28, 5))[k];
    return render(0.4, (ctx, S, out) => {
      play(ctx, crane, out, { rate: 1.9 + k * 0.1, gain: 0.8, hp: 900 });
      for (let i = 0; i < 2 + (k % 2); i++) {
        const t = i * 0.07;
        S.osc('sine', 2200 + k * 150, t, 0.05, { to: 3400 + k * 100, glide: 0.04 }).connect(S.vca(t, 0.25, 0.003, 0, 1, 0.03, 0.02)).connect(out);
      }
    });
  } },
  raptor_screech: { n: 4, kbps: 80, async build(k) {
    const eagle = (await loudest(D + 'commons-yellowstone-sound-library-bald-eagle-003/Yellowstone_sound_library_-_Bald_Eagle_-_003.mp3', 0.6, 4))[k];
    const pea = await whole(D + 'oga-qubodup-peacock/peacockscream.flac', { len: 0.8, fadeOut: 0.3 });
    const hiss = await whole(D + 'commons-cat-hissing-zabuhailo/Cat_hissing_-_Zabuhailo.wav', { from: 0.9, len: 0.8, fadeOut: 0.3 });
    return render(0.9, (ctx, S, out) => {
      const o = bus(S, { room: 0.2 });
      play(ctx, eagle, o, { rate: 0.72 + k * 0.04, gain: 0.8, hp: 400, curve: 1.6 });
      play(ctx, pea, o, { rate: 0.68 + k * 0.03, gain: 0.55, hp: 300 });
      play(ctx, hiss, o, { rate: 0.9, gain: 0.35, at: 0.05, hp: 1500 });
      // formant rasp (original synthesis): rising then falling saw through two vocal bandpasses
      const s = S.osc('sawtooth', 420 + k * 30, 0, 0.6, { to: 900 + k * 40, glide: 0.12 });
      s.frequency.exponentialRampToValueAtTime(380, 0.6);
      const sh = S.shaper(6);
      const g = S.vca(0, 0.25, 0.03, 0.2, 0.7, 0.35, 0.2);
      s.connect(sh); sh.connect(S.filt('bandpass', 1700, 4)).connect(g); sh.connect(S.filt('bandpass', 2900, 5)).connect(g);
      g.connect(o);
    }, { reverb: { room: 0.7 } });
  } },
  raptor_call: { n: 4, kbps: 64, async build(k) {
    const crane = (await loudest(D + 'commons-yellowstone-sound-library-sandhill-crane-001/Yellowstone_sound_library_-_Sandhill_Crane_-_001.mp3', 0.55, 8))[k + 4];
    return render(0.75, (ctx, S, out) => {
      play(ctx, crane, out, { rate: 0.85 + k * 0.05, gain: 1, hp: 250, curve: 1.3 });
      const s = S.osc('sawtooth', 300 + k * 20, 0.02, 0.3, { to: 520, glide: 0.08 });
      s.connect(S.filt('bandpass', 1400, 5)).connect(S.vca(0.02, 0.12, 0.02, 0.1, 0.5, 0.15, 0.1)).connect(out);
    });
  } },
  brute_growl: { n: 3, kbps: 80, async build(k) {
    const bear = (await loudest(D + 'commons-yellowstone-sound-library-grizzly-bears-roar-001/Yellowstone_sound_library_-_Grizzly_Bears_Roar_-_001.mp3', 1.0, 3))[k];
    const troll = await event(D + 'oga-darsycho-troll/troll-roars.ogg', k + 1, 1.1, { th: -18, gap: 0.15 });
    return render(1.3, (ctx, S, out) => {
      const o = bus(S, { room: 0.25 });
      play(ctx, bear, o, { rate: 0.8, gain: 0.9, curve: 1.5 });
      play(ctx, troll, o, { rate: 0.75, gain: 0.6, lp: 3000 });
      thump(S, o, 0.05, 70, 45, 0.5, 0.8);
    }, { reverb: { room: 1 } });
  } },
  trike_bellow: { n: 3, kbps: 80, async build(k) {
    const bison = await whole(D + 'commons-bison/Bison.wav', { len: 1.6, fadeOut: 0.4 });
    const gator = (await loudest(D + 'commons-alligatorbellowedit/Alligatorbellowedit.ogg', 1.4, 3))[k];
    const deer = (await loudest(D + 'bsb-sika-deer-rut-call-1-s3617/3617.wav', 1.2, 3))[k];
    return render(1.8, (ctx, S, out) => {
      const o = bus(S, { hall: 0.2 });
      play(ctx, bison, o, { rate: 0.7 + k * 0.04, gain: 0.8 });
      play(ctx, gator, o, { rate: 0.8, gain: 0.7, lp: 1500 });
      play(ctx, deer, o, { rate: 0.45, gain: 0.35, lp: 2000 });
      thump(S, o, 0.1, 55, 40, 0.5, 1.2);
    }, { reverb: { hall: 2 } });
  } },
  ankylo_grunt: { n: 3, kbps: 64, async build(k) {
    const bear = await whole(D + `oga-antumdeluge-bear/flac/bear_0${1 + (k % 2)}.flac`, { len: 1.0 });
    const pig = (await loudest(D + 'bsb-grumpy-pig-2-s1659/1659.wav', 0.5, 3))[k];
    return render(0.9, (ctx, S, out) => {
      play(ctx, bear, out, { rate: 0.7 + k * 0.05, gain: 0.9, curve: 1.4 });
      play(ctx, pig, out, { rate: 0.6, gain: 0.4, lp: 1500 });
      thump(S, out, 0, 80, 50, 0.4, 0.3);
    });
  } },
  ptero_cry: { n: 4, kbps: 80, async build(k) {
    const scr = await event(D + 'oga-nocturnalvanguard-screech/evil_screech_1.ogg', k, 1.0, { th: -18, gap: 0.15 });
    const owl = await event(D + 'bsb-barn-owl-s1400/1400.wav', k, 1.2, { th: -18, gap: 0.15 });
    return render(1.3, (ctx, S, out) => {
      const o = bus(S, { hall: 0.25 });
      play(ctx, scr, o, { rate: 1.1 + k * 0.05, gain: 0.7, hp: 500 });
      play(ctx, owl, o, { rate: 1.05, gain: 0.6, hp: 700 });
      const s = S.osc('square', 1300 + k * 60, 0, 0.6, { to: 760, glide: 0.55 });
      const v = S.osc('sine', 14, 0, 0.6); const vg = ctx.createGain(); vg.gain.value = 80; v.connect(vg).connect(s.frequency);
      s.connect(S.filt('bandpass', 1600, 3)).connect(S.vca(0, 0.12, 0.03, 0.2, 0.6, 0.35, 0.2)).connect(o);
    }, { reverb: { hall: 2 } });
  } },
  bite: { n: 3, kbps: 64, async build(k) {
    const a = await whole(K + `impactWood_light_00${k}.ogg`, { len: 0.2 });
    const sw = await whole(D + `oga-artisticdude-swishes/swishes/swish-${2 + k}.wav`, { len: 0.3 });
    return render(0.35, (ctx, S, out) => {
      play(ctx, sw, out, { rate: 0.8, gain: 0.4, hp: 400 });
      play(ctx, a, out, { rate: 1.6, gain: 1, at: 0.08, hp: 600 });
      play(ctx, a, out, { rate: 1.9, gain: 0.5, at: 0.095, hp: 900 });
      thump(S, out, 0.08, 160, 80, 0.4, 0.06);
    });
  } },
  tail_swipe: { n: 2, kbps: 64, async build(k) {
    const sw = await whole(D + `oga-artisticdude-swishes/swishes/swish-${8 + k}.wav`, { len: 0.8 });
    return render(0.9, (ctx, S, out) => {
      play(ctx, sw, out, { rate: 0.5, gain: 1, lp: 2500 });
      S.noise(0, 0.6, 'pink').connect(S.filt('bandpass', 300, 1.2)).connect(S.vca(0, 0.6, 0.18, 0, 1, 0.2, 0.25)).connect(out);
    });
  } },
  footstep_heavy: { n: 4, kbps: 64, async build(k) {
    const f = await whole(K + `footstep_concrete_00${k}.ogg`, { len: 0.4 });
    const g = await whole(D + `oga-tinyworlds-steps/gravel.ogg`, { len: 0.4 });
    return render(0.6, (ctx, S, out) => {
      play(ctx, f, out, { rate: 0.45 + k * 0.03, gain: 1, lp: 2500 });
      play(ctx, g, out, { rate: 0.7, gain: 0.3, at: 0.02, hp: 500 });
      thump(S, out, 0, 75, 38, 0.9, 0.3);
    });
  } },
  stampede_loop: { n: 1, kbps: 80, loop: true, async build() {
    // A herd-sized gallop: heavy steps on a broken 6/8 grid + ground rumble, 2.4 s seamless loop
    const steps = [];
    for (let k = 0; k < 4; k++) steps.push(await whole(K + `footstep_concrete_00${k}.ogg`, { len: 0.4 }));
    const rumble = await whole(D + 'oga-cinameng-rumble/rumble.wav', { from: 4, len: 2.4, fadeOut: 0 });
    reseed(99);
    const L = 2.4;
    const buf = await lab.render(L * 2, async (ctx) => {
      const S = new Session(ctx, { master: 1, glue: false });
      for (let rep = 0; rep < 2; rep++) {
        for (let i = 0; i < 16; i++) {
          const t = rep * L + i * (L / 16) + (i % 3 === 2 ? 0.03 : 0);
          play(ctx, steps[i % 4], S.out, { rate: 0.4 + rnd() * 0.08, gain: 0.5 + (i % 4 === 0 ? 0.4 : 0), at: t, lp: 1800 });
          thump(S, S.out, t, 70, 36, 0.6, 0.25);
        }
        play(ctx, rumble, S.out, { gain: 0.5, at: rep * L, lp: 400 });
      }
    });
    // second pass (steady state) is the loop
    const out = lab.shape(buf, { start: L, end: 2 * L });
    lab.normalize(out, -1);
    return out;
  } },
  stomp: { n: 4, kbps: 96, async build(k) {
    const punch = await whole(K + `impactPunch_heavy_00${k}.ogg`, { len: 0.5 });
    const deb = await whole(RB + `bfh1_rock_falling_0${5 + k}.ogg`, { len: 0.9 });
    const shake = await whole(D + 'oga-mieki256-earthquake/shake.flac', { from: 0.3 + k * 0.6, len: 1.4, fadeOut: 0.6 });
    return render(2.0, (ctx, S, out) => {
      const o = bus(S, { hall: 0.25 });
      play(ctx, punch, o, { rate: 0.4, gain: 1, curve: 2, lp: 2000 });
      play(ctx, deb, o, { rate: 0.8, gain: 0.35, at: 0.06, hp: 400 });
      play(ctx, shake, o, { gain: 0.5, lp: 500 });
      thump(S, o, 0, 62, 26, 1, 0.9);
      click(S, o, 0, 0.25, 1500);
    }, { reverb: { hall: 2.4 } });
  } },
  // --- T. rex: the signature roar -----------------------------------------------------------------------------------
  // Original layered design (no elephant, no film roar): lion and grizzly pitched down for the throat, a CC0 monster
  // roar for the snarl, a procedural formant growl (two detuned saws through sweeping vowel bandpasses, distorted)
  // for the tonal scream, a sub drop and a chest rumble for weight, breath noise, and a street-canyon reverb.
  trex_roar: { n: 5, kbps: 112, async build(k) {
    // k: 0,1 long · 2,3 short · 4 death
    const long = k < 2, death = k === 4;
    const dur = death ? 4.2 : long ? 3.1 : 1.5;
    const lion = await whole(D + 'commons-lion-raring-sound1tamilnadu178/Lion_raring-sound1TamilNadu178.ogg', { from: [0.2, 2.6, 4.9, 0.9, 5.5][k], len: dur * 0.75, fadeOut: 0.5 });
    const bear = (await loudest(D + 'commons-yellowstone-sound-library-grizzly-bears-roar-001/Yellowstone_sound_library_-_Grizzly_Bears_Roar_-_001.mp3', dur * 0.6, 3))[k % 3];
    const deep = await whole(D + 'oga-trazzz123-deep-roar/monster_roar.wav', { from: 0.21 + (k % 2) * 0.4, len: dur * 0.9, fadeOut: 0.6 });
    const p = death ? 0.62 : [0.58, 0.55, 0.66, 0.62][k];
    return render(dur + 2.4, (ctx, S, out) => {
      const o = bus(S, { hall: 0.32, room: 0.2 });
      play(ctx, lion, o, { rate: p, gain: 0.85, curve: 1.6, eq: [['lowshelf', 200, 4], ['peaking', 900, 3, 1]] });
      play(ctx, bear, o, { rate: p * 0.95, gain: 0.55, lp: 2600 });
      play(ctx, deep, o, { rate: 0.8, gain: 0.55, lp: 3000 });
      // procedural formant growl
      const t = 0.05;
      const f0 = 52, fpk = death ? 70 : 92;
      const mix = ctx.createGain(); mix.gain.value = 0.5;
      for (const [mul, det] of [[1, 0], [1.51, 8], [0.5, -6]]) {
        const s = ctx.createOscillator(); s.type = 'sawtooth'; s.detune.value = det;
        s.frequency.setValueAtTime(f0 * mul, t);
        s.frequency.linearRampToValueAtTime(fpk * mul, t + dur * 0.25);
        s.frequency.linearRampToValueAtTime(fpk * 0.8 * mul, t + dur * 0.7);
        s.frequency.linearRampToValueAtTime((death ? 30 : 40) * mul, t + dur);
        s.start(t); s.stop(t + dur + 0.1);
        s.connect(mix);
      }
      const am = ctx.createOscillator(); am.frequency.setValueAtTime(18, t); am.frequency.linearRampToValueAtTime(31, t + dur * 0.4); am.frequency.linearRampToValueAtTime(21, t + dur);
      am.start(t); am.stop(t + dur + 0.1);
      const amg = ctx.createGain(); amg.gain.value = 0.4;
      const vca = ctx.createGain(); vca.gain.value = 0.6;
      am.connect(amg).connect(vca.gain);
      const sh = S.shaper(5);
      mix.connect(vca).connect(sh);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.5, t + 0.25); env.gain.setValueAtTime(0.5, t + dur * 0.6); env.gain.linearRampToValueAtTime(0, t + dur);
      for (const [a, b, c, q] of [[340, 880, 300, 2.5], [1050, 1850, 760, 3], [2400, 2900, 1800, 5]]) {
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
        f.frequency.setValueAtTime(a, t); f.frequency.linearRampToValueAtTime(b, t + dur * 0.3); f.frequency.linearRampToValueAtTime(c, t + dur);
        sh.connect(f).connect(env);
      }
      env.connect(S.filt('lowpass', 3200)).connect(o);
      // breath + sub + chest rumble
      S.noise(t, dur, 'pink').connect(S.filt('bandpass', 900, 0.8)).connect(S.vca(t, 0.35, 0.2, 0, 1, dur * 0.8, 0.4)).connect(o);
      S.osc('sine', 48, t, dur, { to: 28, glide: dur }).connect(S.vca(t, 0.9, 0.25, 0, 1, dur * 0.7, dur * 0.3)).connect(o);
      const rum = S.noise(t, dur, 'brown');
      const rlfo = S.osc('sine', 24, t, dur); const rg = ctx.createGain(); rg.gain.value = 0.5;
      const rv = ctx.createGain(); rv.gain.value = 0.5; rlfo.connect(rg).connect(rv.gain);
      rum.connect(S.filt('lowpass', 160)).connect(rv).connect(S.vca(t, 0.8, 0.3, 0, 1, dur * 0.6, dur * 0.4)).connect(o);
    }, { reverb: { hall: 3.4, room: 1.0 }, fade: 0.6, trim: -58 });
  } },
  // --- Pickups / UI / arcade -----------------------------------------------------------------------------------------
  xp: { n: 3, kbps: 64, async build(k) {
    const g = await whole(KC + `chips-collide-${1 + k}.ogg`, { len: 0.25 });
    return render(0.3, (ctx, S, out) => {
      play(ctx, g, out, { rate: 1.6, gain: 0.5, hp: 2000 });
      S.osc('triangle', midi(84 + [0, 4, 7][k]), 0, 0.12).connect(S.vca(0, 0.35, 0.002, 0.05, 0.3, 0.02, 0.1)).connect(out);
      S.osc('sine', midi(96 + [0, 4, 7][k]), 0.01, 0.1).connect(S.vca(0.01, 0.15, 0.002, 0.04, 0.3, 0.02, 0.08)).connect(out);
    });
  } },
  pickup: { n: 2, kbps: 80, async build(k) {
    const m = await whole(KI + `maximize_00${k + 3}.ogg`, { len: 0.6 });
    const latch = await whole(K + `impactPlate_medium_00${k}.ogg`, { len: 0.3 });
    return render(0.8, (ctx, S, out) => {
      play(ctx, latch, out, { rate: 1.1, gain: 0.5 });
      play(ctx, m, out, { gain: 0.6, at: 0.05 });
      [0, 4, 7, 12].forEach((n, i) => S.pluck(out, 0.08 + i * 0.06, 76 + n + k * 2, 1.4, { cut: 4000, len: 0.3, type: 'triangle' }));
    });
  } },
  heal: { n: 1, kbps: 80, async build() {
    const p = await whole(D + 'oga-rubberduck-50-retro-synth/power_up_02.ogg', { len: 1.0 });
    return render(1.1, (ctx, S, out) => {
      play(ctx, p, out, { gain: 0.5 });
      [0, 4, 7, 12, 16].forEach((n, i) => S.bell(out, 0.05 + i * 0.06, 72 + n, 1.4, 0.8));
    }, { reverb: { hall: 1.6 } });
  } },
  overdrive: { n: 1, kbps: 80, async build() {
    const t = await whole(D + 'oga-faxcorp-electricity/turbo.wav', { len: 1.4, fadeOut: 0.4 });
    return render(1.5, (ctx, S, out) => {
      play(ctx, t, out, { gain: 0.8 });
      S.riser(out, 0, 0.6, 1.2);
      thump(S, out, 0.6, 140, 50, 0.7, 0.3);
    });
  } },
  levelup: { n: 1, kbps: 96, async build() {
    const p = await whole(KD + 'powerUp7.ogg', { len: 1.2 });
    const j = await whole(D + 'kenney-music-jingles/Audio/Hit jingles/jingles_HIT07.ogg', { len: 1.6 });
    return render(1.8, (ctx, S, out) => {
      const o = bus(S, { hall: 0.2 });
      play(ctx, p, o, { gain: 0.45 });
      play(ctx, j, o, { gain: 0.8, at: 0.02 });
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => S.pluck(o, i * 0.05, 69 + n, 1.2, { cut: 5000, len: 0.35 }));
    }, { reverb: { hall: 1.8 } });
  } },
  card_show: { n: 1, kbps: 64, async build() {
    const f = await whole(KC + 'card-fan-1.ogg', { len: 0.6 });
    return render(0.7, (ctx, S, out) => { play(ctx, f, out, { gain: 1, hp: 300 }); });
  } },
  card_pick: { n: 2, kbps: 80, async build(k) {
    const c = await whole(KC + `card-place-${1 + k}.ogg`, { len: 0.3 });
    const s = await whole(KI + `confirmation_00${2 + k}.ogg`, { len: 0.6 });
    return render(0.7, (ctx, S, out) => {
      play(ctx, c, out, { gain: 0.8 });
      play(ctx, s, out, { gain: 0.7, at: 0.03 });
      thump(S, out, 0, 200, 90, 0.4, 0.08);
    });
  } },
  reroll: { n: 1, kbps: 64, async build() {
    const s = await whole(KC + 'card-shuffle.ogg', { len: 0.7, fadeOut: 0.2 });
    return render(0.8, (ctx, S, out) => { play(ctx, s, out, { gain: 1, rate: 1.2 }); });
  } },
  evolve: { n: 1, kbps: 96, async build() {
    const z = await whole(KD + 'zapThreeToneUp.ogg', { len: 1 });
    const p = await whole(D + 'oga-faxcorp-electricity/powerup.wav', { len: 1.6, fadeOut: 0.5 });
    return render(2.2, (ctx, S, out) => {
      const o = bus(S, { hall: 0.35 });
      play(ctx, p, o, { gain: 0.6 });
      play(ctx, z, o, { gain: 0.6, at: 0.1 });
      [0, 7, 12, 19, 24, 31].forEach((n, i) => S.pad(o, 0.05 + i * 0.08, 0.4, [57 + n], 0.5, { a: 0.01, r: 0.6, cut: 3200, voices: 3 }));
      S.impact(o, 0.55, 0.6);
    }, { reverb: { hall: 2.4 } });
  } },
  combo: { n: 1, kbps: 64, async build() {
    return render(0.35, (ctx, S, out) => { [0, 7, 12].forEach((n, i) => S.pluck(out, i * 0.045, 79 + n, 1.4, { cut: 6000, len: 0.18 })); });
  } },
  danger: { n: 1, kbps: 64, async build() {
    // Two-tone alert blip (original)
    return render(0.5, (ctx, S, out) => {
      for (const [t, f] of [[0, 988], [0.12, 740], [0.24, 988]]) S.osc('sawtooth', f, t, 0.1).connect(S.filt('lowpass', 2600)).connect(S.vca(t, 0.35, 0.004, 0, 1, 0.08, 0.02)).connect(out);
    });
  } },
  warning: { n: 1, kbps: 80, async build() {
    const a = await whole(D + 'oga-bonzille-alarm/alarm.wav', { len: 3.6, fadeOut: 0.6 });
    return render(3.8, (ctx, S, out) => {
      const o = bus(S, { hall: 0.3 });
      play(ctx, a, o, { gain: 0.6, hp: 200 });
      for (let i = 0; i < 4; i++) { const t = i * 0.85; S.osc('sawtooth', i % 2 ? 466 : 622, t, 0.7).connect(S.filt('lowpass', 1800)).connect(S.vca(t, 0.3, 0.02, 0, 1, 0.65, 0.05)).connect(o); }
    }, { reverb: { hall: 2.6 } });
  } },
  ui_click: { n: 2, kbps: 64, async build(k) { const c = await whole(KI + `select_00${1 + k}.ogg`, { len: 0.2 }); return render(0.22, (ctx, S, out) => { play(ctx, c, out, { gain: 1 }); }); } },
  ui_hover: { n: 1, kbps: 64, async build() { const c = await whole(KU + 'rollover2.ogg', { len: 0.12 }); return render(0.14, (ctx, S, out) => { play(ctx, c, out, { gain: 1, hp: 800 }); }); } },
  ui_back: { n: 1, kbps: 64, async build() { const c = await whole(KI + 'back_002.ogg', { len: 0.3 }); return render(0.32, (ctx, S, out) => { play(ctx, c, out, { gain: 1 }); }); } },
  count_tick: { n: 1, kbps: 64, async build() {
    const c = await whole(KI + 'tick_002.ogg', { len: 0.1 });
    return render(0.4, (ctx, S, out) => { play(ctx, c, out, { gain: 0.6 }); S.bell(out, 0, 81, 1, 0.3); });
  } },
  bell: { n: 1, kbps: 64, async build() {
    return render(1.3, (ctx, S, out) => { S.bell(out, 0, 81, 1.3, 1.2); S.bell(out, 0.0, 88, 0.6, 1.0); });
  } },
  zone_clear: { n: 1, kbps: 80, async build() {
    const j = await whole(D + 'kenney-music-jingles/Audio/Steel jingles/jingles_STEEL04.ogg', { len: 1.8 });
    return render(2, (ctx, S, out) => { play(ctx, j, out, { gain: 0.9 }); S.bell(out, 0, 84, 0.6, 1.2); });
  } },
  // --- Announcer (Kenney Voiceover Packs, CC0): light arcade processing (presence EQ, compression, short slap) ------
  ...Object.fromEntries([
    ['vo_go', KV + 'go.ogg'], ['vo_ready', KV + 'ready.ogg'], ['vo_levelup', KV + 'level_up.ogg'], ['vo_gameover', KV + 'game_over.ogg'],
    ['vo_highscore', KV + 'new_highscore.ogg'], ['vo_mission', KV + 'mission_completed.ogg'], ['vo_hurry', KV + 'hurry_up.ogg'], ['vo_powerup', KV + 'power_up.ogg'],
    ['vo_lookout', KV + 'war_look_out.ogg'], ['vo_combo', KF + 'combo.ogg'], ['vo_multikill', KF + 'multi_kill.ogg'], ['vo_flawless', KF + 'flawless_victory.ogg'],
    ['vo_prepare', KF + 'prepare_yourself.ogg'], ['vo_finalround', KF + 'final_round.ogg'], ['vo_winner', KF + 'winner.ogg']
  ].map(([id, file]) => [id, { n: 1, kbps: 80, voice: true, async build() {
    const v = await whole(file, { fadeOut: 0.02 });
    return render(v.duration + 0.6, (ctx, S, out) => {
      const o = bus(S, { room: 0.12, comp: { threshold: -20, ratio: 4, attack: 0.003, release: 0.1 }, eq: [['highpass', 90, 0, 0.7], ['peaking', 3000, 3, 1]] });
      play(ctx, v, o, { gain: 1 });
    }, { reverb: { room: 0.8 } });
  } }]))
};

export default async function (l, args) {
  lab = l;
  const only = args.only ? new Set(args.only) : null;
  const sfx = {};
  const log = [];
  for (const [id, r] of Object.entries(RECIPES)) {
    if (only && !only.has(id)) continue;
    const files = [];
    for (let k = 0; k < r.n; k++) {
      reseed(1000 + k * 17 + id.length);
      const buf = await r.build(k);
      const file = `${OUT}${id}${r.n > 1 ? '_' + k : ''}.mp3`;
      const st = await lab.save(file, buf, { kbps: r.kbps || 80 });
      files.push({ file, n: st.n, dur: +buf.duration.toFixed(3) });
    }
    sfx[id] = { files, ...(r.loop ? { loop: true } : {}), ...(r.voice ? { voice: true } : {}) };
    log.push(`${id} ×${r.n}`);
  }
  return { manifest: { sfx }, manifestPath: 'assets/audio/manifest.json', log: log.join(', ') };
}
