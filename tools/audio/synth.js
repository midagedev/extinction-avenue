// tools/audio/synth.js
// Offline instruments for the original score and the designed sound effects (OfflineAudioContext only: none of this
// ships, the rendered MP3s do). A Session owns the context, shared noise/impulse buffers, mixer buses with send
// effects (hall / room / plate reverbs, tempo delay), sidechain ducking, and the master chain (glue + limiter).

export const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

let seed = 1;
export const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
export const reseed = (s) => { seed = s || 1; };

export class Session {
  constructor(ctx, { bpm = 120, master = 0.8, glue = true } = {}) {
    this.ctx = ctx;
    this.bpm = bpm;
    this.beat = 60 / bpm;
    this.step = this.beat / 4;
    this.bar = this.beat * 4;
    this.noiseBuf = this._noise(3);
    this.pinkBuf = this._noise(3, 'pink');
    this.brownBuf = this._noise(3, 'brown');
    this.curves = {};
    // Master: highpass → glue compressor → limiter → out
    this.master = ctx.createGain();
    this.master.gain.value = master;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 24; hp.Q.value = 0.6;
    let node = this.master.connect(hp);
    if (glue) {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = -16; c.knee.value = 10; c.ratio.value = 2.5; c.attack.value = 0.012; c.release.value = 0.16;
      node = node.connect(c);
    }
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.0015; lim.release.value = 0.08;
    node.connect(lim).connect(ctx.destination);
    this.out = this.master;
    this.fx = {};
    this.buses = {};
    this.kicks = [];
    this.muted = null; // Set of bus names to silence (stem rendering)
  }

  _noise(sec, color = 'white') {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return b;
  }

  /** Stereo impulse response: early reflections + decaying, darkening diffuse tail */
  impulse(sec, decay = 3, { pre = 0.01, bright = 0.5, early = 6 } = {}) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      const p0 = Math.floor(pre * ctx.sampleRate);
      for (let i = p0; i < n; i++) {
        const x = (i - p0) / (n - p0);
        const w = rnd() * 2 - 1;
        const k = 0.05 + bright * Math.pow(1 - x, 2) * 0.95; // high frequencies die first
        lp += (w - lp) * k;
        d[i] = lp * Math.pow(1 - x, decay) * (1 + (1 - k) * 1.5);
      }
      for (let e = 0; e < early; e++) {
        const at = p0 + Math.floor((0.004 + rnd() * 0.05) * ctx.sampleRate);
        if (at < n) d[at] += (rnd() > 0.5 ? 1 : -1) * (0.5 - e * 0.05);
      }
    }
    return b;
  }

  curve(k) {
    if (this.curves[k]) return this.curves[k];
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    return (this.curves[k] = c);
  }

  /** Send effects. Call once per song. */
  addFx({ hall = 2.6, room = 0.9, plate = 1.6, delayBeats = 0.75, delayFb = 0.35 } = {}) {
    const ctx = this.ctx;
    const mk = (sec, decay, opts, gain) => {
      const inp = ctx.createGain();
      const cv = ctx.createConvolver(); cv.buffer = this.impulse(sec, decay, opts);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
      const g = ctx.createGain(); g.gain.value = gain;
      inp.connect(hp).connect(cv).connect(g).connect(this.out);
      return inp;
    };
    this.fx.hall = mk(hall, 2.6, { pre: 0.025, bright: 0.35, early: 8 }, 0.9);
    this.fx.room = mk(room, 2.2, { pre: 0.004, bright: 0.6, early: 10 }, 0.8);
    this.fx.plate = mk(plate, 2.0, { pre: 0.0, bright: 0.8, early: 0 }, 0.7);
    // Ping-pong-ish delay (L/R different times), filtered feedback
    const inp = ctx.createGain();
    const dl = ctx.createDelay(4), dr = ctx.createDelay(4);
    dl.delayTime.value = this.beat * delayBeats; dr.delayTime.value = this.beat * delayBeats * 1.5;
    const fb = ctx.createGain(); fb.gain.value = delayFb;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    const merger = ctx.createChannelMerger(2);
    inp.connect(hp).connect(dl);
    dl.connect(lp).connect(fb).connect(dr);
    fb.connect(dl);
    dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
    const dg = ctx.createGain(); dg.gain.value = 0.6;
    merger.connect(dg).connect(this.out);
    dg.connect(this.fx.hall);
    this.fx.delay = inp;
  }

  /**
   * Mixer channel: returns an input node. opts: { gain, pan, hall, room, plate, delay, hp, lp, sidechain (0–1),
   * eq: [[type, f, gain, q]...], comp: true }
   */
  bus(name, o = {}) {
    if (this.buses[name]) return this.buses[name].input;
    const ctx = this.ctx;
    const input = ctx.createGain();
    let node = input;
    if (o.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; f.Q.value = 0.7; node = node.connect(f); }
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.7; node = node.connect(f); }
    for (const [type, f, gain, q] of o.eq || []) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = gain; b.Q.value = q ?? 1; node = node.connect(b); }
    if (o.comp) {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = o.comp.threshold ?? -18; c.ratio.value = o.comp.ratio ?? 4; c.attack.value = o.comp.attack ?? 0.005; c.release.value = o.comp.release ?? 0.1; c.knee.value = 6;
      node = node.connect(c);
    }
    const duck = ctx.createGain();
    node = node.connect(duck);
    const out = ctx.createGain();
    out.gain.value = this.muted && this.muted.has(name) ? 0 : (o.gain ?? 1);
    const pan = ctx.createStereoPanner(); pan.pan.value = o.pan ?? 0;
    node.connect(out).connect(pan).connect(this.out);
    for (const fx of ['hall', 'room', 'plate', 'delay']) {
      if (o[fx] && this.fx[fx]) { const s = ctx.createGain(); s.gain.value = o[fx]; pan.connect(s).connect(this.fx[fx]); }
    }
    this.buses[name] = { input, duck, out, sidechain: o.sidechain || 0 };
    return input;
  }

  /** Sidechain pump: every registered kick ducks the buses that asked for it */
  applySidechain() {
    for (const b of Object.values(this.buses)) {
      if (!b.sidechain) continue;
      const g = b.duck.gain;
      g.setValueAtTime(1, 0);
      for (const t of this.kicks) {
        g.setValueAtTime(1, Math.max(0, t - 0.002));
        g.linearRampToValueAtTime(1 - b.sidechain, t + 0.008);
        g.setTargetAtTime(1, t + 0.03, this.beat * 0.22);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // primitives
  osc(type, f, t, dur, { detune = 0, to = null, curve = 'exp', glide = dur } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to !== null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + glide);
      else o.frequency.linearRampToValueAtTime(to, t + glide);
    }
    o.detune.value = detune;
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(t, dur, color = 'white', rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = color === 'pink' ? this.pinkBuf : color === 'brown' ? this.brownBuf : this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(t, rnd() * 2);
    s.stop(t + dur + 0.05);
    return s;
  }

  filt(type, f, q = 0.7, gain = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain;
    return b;
  }

  /** ADSR-ish gain: a attack, d decay to s·peak, release r after `hold` */
  env(t, peak, a, d, s, hold, r) {
    const g = this.ctx.createGain().gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + a);
    g.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
    const tr = t + Math.max(a, hold);
    g.cancelAndHoldAtTime ? g.cancelAndHoldAtTime(tr) : g.setValueAtTime(peak * s, tr);
    g.setTargetAtTime(0, tr, Math.max(0.001, r / 4));
    return g;
  }

  vca(t, peak, a, d, s, hold, r) {
    const node = this.ctx.createGain();
    const g = node.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + a);
    if (d > 0) g.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
    const tr = t + Math.max(a + 0.001, hold);
    g.cancelAndHoldAtTime(tr);
    g.setTargetAtTime(0, tr, Math.max(0.001, r / 4));
    return node;
  }

  shaper(k, over = '4x') {
    const w = this.ctx.createWaveShaper();
    w.curve = this.curve(k);
    w.oversample = over;
    return w;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // drums
  kick(out, t, v = 1, { tone = 52, punch = 1, len = 0.42, click = 1 } = {}) {
    this.kicks.push(t);
    const o = this.osc('sine', tone * 3.4, t, len, { to: tone, glide: 0.07 });
    const sh = this.shaper(1.6, '2x');
    o.connect(sh).connect(this.vca(t, v * 1.0, 0.001, 0, 1, 0.02, len)).connect(out);
    const sub = this.osc('sine', tone, t, len);
    sub.connect(this.vca(t, v * 0.5 * punch, 0.004, 0, 1, 0.05, len * 1.1)).connect(out);
    const n = this.noise(t, 0.02);
    n.connect(this.filt('highpass', 2500)).connect(this.vca(t, v * 0.35 * click, 0.0005, 0, 1, 0.003, 0.012)).connect(out);
  }

  snare(out, t, v = 1, { tone = 190, snappy = 1, len = 0.24, gated = null } = {}) {
    const n = this.noise(t, len + 0.1);
    const bp = this.filt('bandpass', 3800, 0.6);
    const hp = this.filt('highpass', 900);
    n.connect(hp).connect(bp).connect(this.vca(t, v * 0.75 * snappy, 0.001, 0, 1, 0.01, len)).connect(out);
    const n2 = this.noise(t, 0.08);
    n2.connect(this.filt('bandpass', 1800, 1)).connect(this.vca(t, v * 0.5, 0.001, 0, 1, 0.005, 0.07)).connect(out);
    const o = this.osc('triangle', tone * 1.6, t, 0.15, { to: tone, glide: 0.04 });
    o.connect(this.vca(t, v * 0.7, 0.001, 0, 1, 0.01, 0.1)).connect(out);
    const o2 = this.osc('sine', tone * 2.7, t, 0.08, { to: tone * 1.9, glide: 0.03 });
    o2.connect(this.vca(t, v * 0.25, 0.001, 0, 1, 0.005, 0.05)).connect(out);
    if (gated) {
      // 80s gated reverb: a burst of dense noise that is chopped off
      const g = this.noise(t, gated + 0.05, 'pink');
      g.connect(this.filt('bandpass', 2200, 0.5)).connect(this.vca(t + 0.004, v * 0.32, 0.01, 0, 1, gated, 0.02)).connect(out);
    }
  }

  clap(out, t, v = 1) {
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.009;
      const n = this.noise(tt, 0.05);
      n.connect(this.filt('bandpass', 1400, 1.4)).connect(this.vca(tt, v * (i === 3 ? 0.6 : 0.35), 0.0005, 0, 1, 0.002, i === 3 ? 0.16 : 0.02)).connect(out);
    }
  }

  /** 808-style metallic hat: six detuned squares through a bandpass */
  hat(out, t, v = 1, open = 0) {
    const dur = open ? 0.12 + open * 0.3 : 0.045;
    const mix = this.ctx.createGain(); mix.gain.value = 0.18;
    for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) { const o = this.osc('square', f * 1.6, t, dur); o.connect(mix); }
    const n = this.noise(t, dur);
    const ng = this.ctx.createGain(); ng.gain.value = 0.5;
    n.connect(ng).connect(mix);
    mix.connect(this.filt('bandpass', 10000, 0.9)).connect(this.filt('highpass', 7000)).connect(this.vca(t, v * 0.55, 0.0008, 0, 1, 0.004, dur)).connect(out);
  }

  shaker(out, t, v = 1) {
    const n = this.noise(t, 0.08);
    n.connect(this.filt('bandpass', 7000, 1.2)).connect(this.vca(t, v * 0.25, 0.015, 0, 1, 0.02, 0.05)).connect(out);
  }

  crash(out, t, v = 1, len = 2.4) {
    const mix = this.ctx.createGain(); mix.gain.value = 0.12;
    for (const f of [296, 413, 571, 742, 893, 1131, 1347]) { const o = this.osc('square', f * 2.1, t, len); o.detune.value = rnd() * 30; o.connect(mix); }
    const n = this.noise(t, len);
    const ng = this.ctx.createGain(); ng.gain.value = 0.7;
    n.connect(ng).connect(mix);
    mix.connect(this.filt('highpass', 4200)).connect(this.vca(t, v * 0.5, 0.002, 0.25, 0.45, 0.02, len)).connect(out);
  }

  ride(out, t, v = 1) {
    const mix = this.ctx.createGain(); mix.gain.value = 0.12;
    for (const f of [520, 803, 1187, 1601]) { const o = this.osc('square', f * 2.3, t, 0.6); o.connect(mix); }
    mix.connect(this.filt('bandpass', 7500, 1.2)).connect(this.vca(t, v * 0.4, 0.001, 0.08, 0.3, 0.01, 0.6)).connect(out);
  }

  tom(out, t, note = 45, v = 1, len = 0.5) {
    const f = midi(note);
    const o = this.osc('sine', f * 2.2, t, len, { to: f, glide: 0.09 });
    o.connect(this.shaper(1.4, '2x')).connect(this.vca(t, v * 0.9, 0.001, 0, 1, 0.02, len)).connect(out);
    const n = this.noise(t, 0.06);
    n.connect(this.filt('bandpass', f * 6, 1)).connect(this.vca(t, v * 0.3, 0.001, 0, 1, 0.005, 0.05)).connect(out);
  }

  /** Cinematic taiko / big drum: deep body, skin slap, long room */
  taiko(out, t, v = 1, { tone = 62, len = 1.2 } = {}) {
    const o = this.osc('sine', tone * 2.4, t, len, { to: tone, glide: 0.06 });
    o.connect(this.shaper(2, '2x')).connect(this.vca(t, v, 0.001, 0, 1, 0.03, len)).connect(out);
    const o2 = this.osc('sine', tone * 1.5, t, len * 0.6, { to: tone * 1.02, glide: 0.1 });
    o2.connect(this.vca(t, v * 0.35, 0.002, 0, 1, 0.02, len * 0.5)).connect(out);
    const n = this.noise(t, 0.2, 'pink');
    n.connect(this.filt('lowpass', 1600)).connect(this.vca(t, v * 0.6, 0.001, 0, 1, 0.01, 0.12)).connect(out);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // tonal
  /** Synth bass: saw + square sub, filter envelope, optional drive */
  bass(out, t, dur, note, v = 1, { cut = 500, env = 2.4, res = 4, drive = 0, sub = 0.6, decay = 0.15, glideFrom = null } = {}) {
    const f = midi(note);
    const mix = this.ctx.createGain();
    const o1 = this.osc('sawtooth', glideFrom ? midi(glideFrom) : f, t, dur, glideFrom ? { to: f, glide: 0.04 } : {});
    const o2 = this.osc('sawtooth', f, t, dur, { detune: 9 });
    const o3 = this.osc('square', f / 2, t, dur);
    const g3 = this.ctx.createGain(); g3.gain.value = sub;
    o1.connect(mix); o2.connect(mix); o3.connect(g3).connect(mix);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = res;
    lp.frequency.setValueAtTime(cut * env, t);
    lp.frequency.setTargetAtTime(cut, t + 0.005, decay);
    let node = mix.connect(lp);
    if (drive) node = node.connect(this.shaper(drive)).connect(this.filt('lowpass', 2400));
    node.connect(this.vca(t, v * 0.32, 0.003, 0.08, 0.85, dur * 0.92, 0.03)).connect(out);
  }

  /** Reese / growl bass for the boss: detuned saws with a moving notch */
  reese(out, t, dur, note, v = 1, { cut = 900, drive = 4 } = {}) {
    const f = midi(note);
    const mix = this.ctx.createGain(); mix.gain.value = 0.35;
    for (const d of [-14, 0, 13]) this.osc('sawtooth', f, t, dur, { detune: d }).connect(mix);
    this.osc('sine', f / 2, t, dur).connect(mix);
    const lp = this.filt('lowpass', cut, 2);
    const lfo = this.osc('sine', 1 / (this.beat * 2), t, dur);
    const lg = this.ctx.createGain(); lg.gain.value = cut * 0.5;
    lfo.connect(lg).connect(lp.frequency);
    mix.connect(this.shaper(drive)).connect(lp).connect(this.vca(t, v * 0.5, 0.005, 0.1, 0.9, dur * 0.95, 0.04)).connect(out);
  }

  /** Supersaw pad / chord stack */
  pad(out, t, dur, notes, v = 1, { a = 0.4, r = 0.8, cut = 2000, voices = 5, spread = 22, q = 0.6, type = 'sawtooth', move = 0 } = {}) {
    const mixL = this.ctx.createGain(), mixR = this.ctx.createGain();
    const merger = this.ctx.createChannelMerger(2);
    mixL.connect(merger, 0, 0); mixR.connect(merger, 0, 1);
    const k = 1 / Math.sqrt(notes.length * voices);
    mixL.gain.value = mixR.gain.value = k;
    for (const n of notes) {
      for (let i = 0; i < voices; i++) {
        const det = (i / (voices - 1) - 0.5) * 2 * spread;
        const o = this.osc(type, midi(n), t, dur + r, { detune: det + (rnd() - 0.5) * 4 });
        o.connect(i % 2 ? mixL : mixR);
      }
    }
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = q;
    lp.frequency.setValueAtTime(cut, t);
    if (move) { lp.frequency.linearRampToValueAtTime(cut * move, t + dur); }
    merger.connect(lp).connect(this.vca(t, v * 0.5, a, 0, 1, dur, r)).connect(out);
  }

  /** Staccato string section (orchestral-hybrid ostinato): bright saws, fast attack, short bowed decay */
  strings(out, t, dur, notes, v = 1, { cut = 3200, a = 0.008 } = {}) {
    const mix = this.ctx.createGain(); mix.gain.value = 0.22 / Math.sqrt(notes.length);
    for (const n of notes) for (const d of [-9, 0, 8]) {
      const o = this.osc('sawtooth', midi(n), t, dur + 0.15, { detune: d });
      const vib = this.osc('sine', 5.2 + rnd(), t, dur + 0.15);
      const vg = this.ctx.createGain(); vg.gain.value = 6;
      vib.connect(vg).connect(o.detune);
      o.connect(mix);
    }
    const lp = this.filt('lowpass', cut, 0.7);
    const bp = this.filt('peaking', 1200, 1, 3);
    mix.connect(lp).connect(bp).connect(this.vca(t, v, a, dur * 0.6, 0.55, dur, 0.12)).connect(out);
  }

  /** Brass stab / swell: filtered saw stack whose cutoff follows the envelope */
  brass(out, t, dur, notes, v = 1, { swell = 0.05, cut = 2400, r = 0.25 } = {}) {
    const mix = this.ctx.createGain(); mix.gain.value = 0.3 / Math.sqrt(notes.length);
    for (const n of notes) for (const d of [-6, 6]) this.osc('sawtooth', midi(n), t, dur + r, { detune: d }).connect(mix);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.linearRampToValueAtTime(cut, t + swell + 0.03);
    lp.frequency.setTargetAtTime(cut * 0.45, t + swell + 0.05, dur * 0.5);
    mix.connect(lp).connect(this.filt('peaking', 900, 1.2, 4)).connect(this.vca(t, v, swell, dur * 0.6, 0.7, dur, r)).connect(out);
  }

  /** Distorted power chord ("rhythm guitar"): root/fifth/octave → drive → cab sim. mute = palm mute (short, dark) */
  guitar(out, t, dur, root, v = 1, { mute = false, fifth = true, octave = true, gain = 26 } = {}) {
    const mix = this.ctx.createGain(); mix.gain.value = 0.4;
    const notes = [root]; if (fifth) notes.push(root + 7); if (octave) notes.push(root + 12);
    for (const n of notes) {
      this.osc('sawtooth', midi(n), t, dur + 0.1, { detune: (rnd() - 0.5) * 10 }).connect(mix);
      this.osc('square', midi(n) * 1.002, t, dur + 0.1, { detune: (rnd() - 0.5) * 8 }).connect(mix);
    }
    const pre = this.filt('highpass', 160, 0.7);
    const pk = this.filt('peaking', 800, 0.8, 6);
    const drive = this.shaper(gain);
    const cab1 = this.filt('lowpass', mute ? 1400 : 4600, 0.9);
    const cab2 = this.filt('peaking', 1600, 1.2, 3);
    const cab3 = this.filt('peaking', 380, 1, -4);
    const cab4 = this.filt('highpass', 85, 0.7);
    const len = mute ? Math.min(dur, this.step * 0.9) : dur;
    mix.connect(pre).connect(pk).connect(drive).connect(cab1).connect(cab2).connect(cab3).connect(cab4)
      .connect(this.vca(t, v * 0.22, 0.002, mute ? 0.05 : 0.3, mute ? 0.35 : 0.8, len, mute ? 0.04 : 0.09)).connect(out);
  }

  /** Lead synth: two saws + square, vibrato after the attack, optional glide */
  lead(out, t, dur, note, v = 1, { cut = 3600, from = null, vib = 0.18, type2 = 'square', a = 0.01, r = 0.18 } = {}) {
    const f = midi(note);
    const mix = this.ctx.createGain(); mix.gain.value = 0.3;
    const oscs = [this.osc('sawtooth', from ? midi(from) : f, t, dur + r, { detune: -7 }), this.osc('sawtooth', from ? midi(from) : f, t, dur + r, { detune: 7 }), this.osc(type2, from ? midi(from) : f, t, dur + r)];
    const vibO = this.osc('sine', 5.6, t, dur + r);
    const vg = this.ctx.createGain();
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(0, t + Math.min(0.25, dur * 0.5)); vg.gain.linearRampToValueAtTime(vib * 100, t + Math.min(0.6, dur));
    vibO.connect(vg);
    for (const o of oscs) {
      if (from) o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      vg.connect(o.detune);
      o.connect(mix);
    }
    const lp = this.filt('lowpass', cut, 1.4);
    mix.connect(lp).connect(this.vca(t, v * 0.5, a, 0.2, 0.8, dur, r)).connect(out);
  }

  /** Plucky arp / bell */
  pluck(out, t, note, v = 1, { cut = 3000, len = 0.25, type = 'square' } = {}) {
    const f = midi(note);
    const o = this.osc(type, f, t, len + 0.1);
    const o2 = this.osc('sawtooth', f * 2, t, len + 0.1, { detune: 5 });
    const g2 = this.ctx.createGain(); g2.gain.value = 0.3;
    const mix = this.ctx.createGain();
    o.connect(mix); o2.connect(g2).connect(mix);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(cut, t); lp.frequency.setTargetAtTime(cut * 0.2, t, len * 0.4);
    mix.connect(lp).connect(this.vca(t, v * 0.25, 0.002, len * 0.5, 0.3, len * 0.6, len * 0.5)).connect(out);
  }

  /** Electric-piano / bell: sine FM */
  bell(out, t, note, v = 1, len = 1.6) {
    const f = midi(note);
    const car = this.osc('sine', f, t, len);
    const mod = this.osc('sine', f * 3.5, t, len);
    const mg = this.ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.setTargetAtTime(f * 0.2, t, 0.2);
    mod.connect(mg).connect(car.frequency);
    car.connect(this.vca(t, v * 0.25, 0.002, len * 0.4, 0.2, len * 0.5, len * 0.5)).connect(out);
  }

  /** "Aah" choir pad: saws through vowel formant bandpasses */
  choir(out, t, dur, notes, v = 1, { a = 0.6, r = 1, vowel = 'a' } = {}) {
    const F = vowel === 'o' ? [[450, 8], [800, 9], [2830, 12]] : [[730, 7], [1090, 9], [2440, 12]];
    const mix = this.ctx.createGain(); mix.gain.value = 0.5 / Math.sqrt(notes.length);
    for (const n of notes) for (const d of [-10, -3, 4, 11]) {
      const o = this.osc('sawtooth', midi(n), t, dur + r, { detune: d });
      const vib = this.osc('sine', 4.6 + rnd() * 0.8, t, dur + r);
      const vg = this.ctx.createGain(); vg.gain.value = 9; vib.connect(vg).connect(o.detune);
      o.connect(mix);
    }
    const sum = this.ctx.createGain();
    for (const [f, q] of F) { const b = this.filt('bandpass', f, q); const g = this.ctx.createGain(); g.gain.value = 2.2; mix.connect(b).connect(g).connect(sum); }
    sum.connect(this.vca(t, v, a, 0, 1, dur, r)).connect(out);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // transitions
  riser(out, t, dur, v = 1) {
    const n = this.noise(t, dur);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.35, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    n.connect(bp).connect(g).connect(out);
  }

  downlifter(out, t, dur, v = 1) {
    const n = this.noise(t, dur);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1;
    bp.frequency.setValueAtTime(7000, t); bp.frequency.exponentialRampToValueAtTime(200, t + dur);
    n.connect(bp).connect(this.vca(t, v * 0.3, 0.01, 0, 1, 0.02, dur)).connect(out);
  }

  /** Cinematic hit: sub drop + taiko + noise burst (send it to the hall) */
  impact(out, t, v = 1) {
    const s = this.osc('sine', 110, t, 2.2, { to: 32, glide: 1.4 });
    s.connect(this.vca(t, v * 0.9, 0.003, 0, 1, 0.1, 2)).connect(out);
    this.taiko(out, t, v * 0.9, { tone: 55, len: 1.5 });
    const n = this.noise(t, 0.6, 'pink');
    n.connect(this.filt('lowpass', 3500)).connect(this.vca(t, v * 0.5, 0.001, 0, 1, 0.02, 0.5)).connect(out);
  }
}
