// js/game/audio.js
// Fully procedural WebAudio: every sound effect is synthesized from oscillators and noise at play time (no samples,
// no copyrighted audio), positioned with stereo panning + distance attenuation relative to the camera, voice-limited
// per sound so a swarm of 500 dinosaurs doesn't turn into mush. A small step sequencer plays the adaptive darksynth
// score (title / run / boss intensity) and is muffled through a low-pass while the game is paused or levelling up.

const SOUND_LIMITS = {
  // name: [max simultaneous voices, min seconds between starts]
  gun: [4, 0.035], gatling: [5, 0.03], shotgun: [3, 0.06], missile: [4, 0.05], explosion: [6, 0.04], tesla: [4, 0.04],
  saw: [4, 0.05], mine: [3, 0.1], fossilize: [7, 0.025], shatter_big: [4, 0.06], compy_chirp: [3, 0.08],
  raptor_screech: [3, 0.18], brute_growl: [2, 0.3], trike_bellow: [2, 0.3], ankylo_grunt: [2, 0.3], ptero_cry: [2, 0.2],
  trex_roar: [1, 0.5], stomp: [4, 0.07], bite: [3, 0.07], tail_swipe: [2, 0.2], hurt: [2, 0.08], gem: [6, 0.018],
  levelup: [1, 0.2], ui: [3, 0.03], ui_hover: [2, 0.04], warning: [1, 1], nitro: [1, 0.3], crate: [2, 0.2], ram: [4, 0.05],
  airstrike: [2, 0.3], heal: [2, 0.2], death: [1, 1], victory: [1, 1], evolve: [1, 0.5], combo: [2, 0.15], bell: [1, 0.3]
};
const ALIAS = { fossilize_big: 'shatter_big' };

class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = { master: 0.8, sfx: 0.9, music: 0.55 };
    this.listener = { x: 0, z: 0, fx: 0, fz: 1 };
    this.voices = new Map(); // name -> { count, last }
    this.musicState = 'off';
    this.loops = {};
    try {
      const saved = JSON.parse(localStorage.getItem('ea-audio') || 'null');
      if (saved) Object.assign(this.volume, saved.volume || {}), (this.enabled = saved.enabled !== false);
    } catch { /* storage unavailable */ }
  }

  get supported() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  /** Must be called from a user gesture */
  unlock() {
    if (!this.supported) return;
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicFilter).connect(this.master);
    // Shared reverb for size (boss roars, explosions)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.2, 2.5);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = this._noiseBuffer(2);
    this.brown = this._noiseBuffer(2, true);
    this.dist = this._distCurve(30);
    this.applyVolumes();
    this._buildLoops();
    if (this.musicState !== 'off') this._startMusic(this.musicState);
  }

  applyVolumes() {
    try { localStorage.setItem('ea-audio', JSON.stringify({ volume: this.volume, enabled: this.enabled })); } catch { /* ignore */ }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? this.volume.master : 0, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volume.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volume.music * 0.5, t, 0.05);
  }

  setEnabled(on) {
    this.enabled = on;
    this.applyVolumes();
  }

  setListener(x, z, fx, fz) {
    const L = this.listener;
    L.x = x; L.z = z; L.fx = fx; L.fz = fz;
  }

  /** Muffles the music (level-up / pause) */
  setMuffled(on) {
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(on ? 650 : 20000, this.ctx.currentTime, 0.08);
  }

  // ------------------------------------------------------------------------------------------------------------------
  _noiseBuffer(seconds, brown = false) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  _distCurve(k) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return c;
  }

  // Building blocks: each returns its output node; `t` is the start time
  _osc(type, f0, f1, t, dur, curve = 'exp') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  _noise(t, dur, brown = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = brown ? this.brown : this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  _filter(type, f, q = 1, t = 0, f1 = null, dur = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.setValueAtTime(f, t);
    if (f1 !== null) b.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    b.Q.value = q;
    return b;
  }

  /** Gain envelope: attack a, hold to peak, exponential decay over dur */
  _env(t, peak, a, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
    return g;
  }

  _shaper() {
    const w = this.ctx.createWaveShaper();
    w.curve = this.dist;
    w.oversample = '2x';
    return w;
  }

  // ------------------------------------------------------------------------------------------------------------------
  /**
   * play(name, { x, z, volume, pitch }) — x/z world position for panning & distance (omit for UI/2D sounds)
   */
  play(name, opts = {}) {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    name = ALIAS[name] || name;
    const recipe = RECIPES[name];
    if (!recipe) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const lim = SOUND_LIMITS[name] || [3, 0.05];
    let v = this.voices.get(name);
    if (!v) { v = { count: 0, last: -1 }; this.voices.set(name, v); }
    if (v.count >= lim[0] || now - v.last < lim[1]) return;
    let vol = opts.volume ?? 1;
    let pan = 0;
    if (opts.x !== undefined) {
      const L = this.listener;
      const dx = opts.x - L.x, dz = opts.z - L.z;
      const d = Math.hypot(dx, dz);
      const range = opts.range ?? 90;
      vol *= 1 / (1 + (d / (range * 0.35)) ** 2);
      if (vol < 0.03) return;
      // right of the listener: (-fz, fx)... the camera's right in world space is (-fz, fx) for heading (sin h, cos h)
      const rx = -L.fz, rz = L.fx;
      pan = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / (d + 4)) * -1.2));
    }
    v.count++;
    v.last = now;
    const out = ctx.createGain();
    out.gain.value = vol;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.sfxBus);
    if (recipe.reverb) {
      const send = ctx.createGain();
      send.gain.value = recipe.reverb;
      out.connect(send).connect(this.reverbSend);
    }
    const dur = recipe.fn(this, out, now + 0.005, opts.pitch ?? 1, opts) || 0.5;
    setTimeout(() => {
      v.count = Math.max(0, v.count - 1);
      try { out.disconnect(); panner.disconnect(); } catch { /* already gone */ }
    }, (dur + 0.2) * 1000);
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Continuous loops: engine (follows speed), flamer, boss heavy breathing… set every frame.
  _buildLoops() {
    const ctx = this.ctx;
    // Engine: two detuned saws through a lowpass whose cutoff follows the revs
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 3;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 50;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 25.3;
    const o2g = ctx.createGain(); o2g.gain.value = 0.5;
    o1.connect(lp); o2.connect(o2g).connect(lp);
    lp.connect(eg).connect(this.sfxBus);
    o1.start(); o2.start();
    this.loops.engine = { gain: eg, filter: lp, o1, o2 };
    // Flamer: filtered noise
    const fg = ctx.createGain();
    fg.gain.value = 0;
    const fn = ctx.createBufferSource(); fn.buffer = this.noise; fn.loop = true;
    const fbp = ctx.createBiquadFilter(); fbp.type = 'bandpass'; fbp.frequency.value = 900; fbp.Q.value = 0.6;
    fn.connect(fbp).connect(fg).connect(this.sfxBus);
    fn.start();
    this.loops.flamer = { gain: fg };
    // Wind / boost rush
    const wg = ctx.createGain(); wg.gain.value = 0;
    const wn = ctx.createBufferSource(); wn.buffer = this.noise; wn.loop = true;
    const whp = ctx.createBiquadFilter(); whp.type = 'bandpass'; whp.frequency.value = 1500; whp.Q.value = 0.4;
    wn.connect(whp).connect(wg).connect(this.sfxBus);
    wn.start();
    this.loops.wind = { gain: wg, filter: whp };
  }

  updateLoops(speed, boosting, flamer, active) {
    if (!this.ctx || !this.loops.engine) return;
    const t = this.ctx.currentTime;
    const e = this.loops.engine;
    const rev = 38 + speed * 3.2 + (boosting ? 25 : 0);
    e.o1.frequency.setTargetAtTime(rev, t, 0.08);
    e.o2.frequency.setTargetAtTime(rev * 0.502, t, 0.08);
    e.filter.frequency.setTargetAtTime(250 + speed * 28 + (boosting ? 900 : 0), t, 0.1);
    e.gain.gain.setTargetAtTime(active ? 0.07 + (boosting ? 0.05 : 0) : 0, t, 0.15);
    this.loops.flamer.gain.gain.setTargetAtTime(active && flamer ? 0.12 : 0, t, 0.08);
    this.loops.wind.gain.gain.setTargetAtTime(active ? Math.min(0.12, speed * 0.003) + (boosting ? 0.12 : 0) : 0, t, 0.2);
    this.loops.wind.filter.frequency.setTargetAtTime(800 + speed * 40, t, 0.2);
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Music: 16-step sequencer, darksynth. States: 'title', 'run', 'boss', 'off'
  setMusic(state) {
    if (state === this.musicState) return;
    this.musicState = state;
    if (!this.ctx) return;
    this._startMusic(state);
  }

  _startMusic(state) {
    if (this.seqTimer) clearInterval(this.seqTimer);
    this.seqTimer = null;
    if (state === 'off') return;
    const song = SONGS[state] || SONGS.run;
    this.song = song;
    this.step = 0;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.seqTimer = setInterval(() => this._schedule(), 25);
  }

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const song = this.song;
    const stepDur = 60 / song.bpm / 4;
    while (this.nextStep < ctx.currentTime + 0.12) {
      this._playStep(song, this.step, this.nextStep, stepDur);
      this.nextStep += stepDur;
      this.step++;
    }
  }

  _playStep(song, step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = song.chords[bar % song.chords.length];
    const out = this.musicBus;
    const ctx = this.ctx;
    const intensity = this.intensity ?? 1;
    // Kick
    if (song.kick[s] === 'x' && intensity > 0) {
      const o = this._osc('sine', 150, 42, t, 0.22);
      const g = this._env(t, 0.9, 0.002, 0.28);
      o.connect(g).connect(out);
    }
    // Snare / clap
    if (song.snare[s] === 'x' && intensity > 0) {
      const n = this._noise(t, 0.2);
      const f = this._filter('bandpass', 1800, 0.8);
      const g = this._env(t, 0.32, 0.002, 0.18);
      n.connect(f).connect(g).connect(out);
      const o = this._osc('triangle', 220, 160, t, 0.08);
      const g2 = this._env(t, 0.2, 0.002, 0.08);
      o.connect(g2).connect(out);
    }
    // Hats
    if (song.hat[s] !== '.' && intensity > 0) {
      const n = this._noise(t, 0.05);
      const f = this._filter('highpass', 7500, 0.7);
      const g = this._env(t, song.hat[s] === 'X' ? 0.12 : 0.06, 0.001, song.hat[s] === 'o' ? 0.12 : 0.04);
      n.connect(f).connect(g).connect(out);
    }
    // Bass: root on 8ths with octave pops, sidechain-feel envelope
    if (song.bass[s] !== '.' && intensity > 0) {
      const root = chord[0] - 24 + (song.bass[s] === 'o' ? 12 : 0);
      const f = midi(root);
      const o = this._osc('sawtooth', f, f, t, sd * 0.95);
      const o2 = this._osc('square', f * 0.5, f * 0.5, t, sd * 0.95);
      const lp = this._filter('lowpass', song.bassCut * 2.4, 6, t, song.bassCut, sd * 0.9);
      const g = this._env(t, 0.22, 0.005, sd * 0.95);
      o.connect(lp); o2.connect(lp);
      if (song.dirty) { const w = this._shaper(); lp.connect(w).connect(g); } else lp.connect(g);
      g.connect(out);
    }
    // Arp
    if (song.arp && s % song.arpRate === 0) {
      const idx = Math.floor(s / song.arpRate) % song.arpPattern.length;
      const note = chord[song.arpPattern[idx] % chord.length] + 12 * Math.floor(song.arpPattern[idx] / chord.length) + 12;
      const f = midi(note);
      const o = this._osc('square', f, f, t, sd * 0.9);
      const lp = this._filter('lowpass', 2600, 2);
      const g = this._env(t, 0.06, 0.004, sd * 1.6);
      o.connect(lp).connect(g).connect(out);
      const d = ctx.createDelay(); d.delayTime.value = sd * 3;
      const dg = ctx.createGain(); dg.gain.value = 0.35;
      g.connect(d).connect(dg).connect(out);
    }
    // Pad: on bar start, detuned saws holding the chord
    if (s === 0) {
      const len = sd * 16;
      for (const n of chord) {
        for (const det of [-7, 7]) {
          const o = this._osc('sawtooth', midi(n), midi(n), t, len);
          o.detune.value = det;
          const lp = this._filter('lowpass', song.padCut, 0.7);
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(song.pad, t + len * 0.3);
          g.gain.linearRampToValueAtTime(0.0001, t + len);
          o.connect(lp).connect(g).connect(out);
        }
      }
    }
  }
}

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Chords as MIDI notes (original progressions)
const SONGS = {
  title: {
    bpm: 96, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    kick: '................', snare: '................', hat: '................', bass: 'x.......x.......',
    arp: true, arpRate: 2, arpPattern: [0, 1, 2, 3, 2, 1, 4, 3], bassCut: 300, padCut: 1400, pad: 0.035
  },
  run: {
    bpm: 128, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...xo', bass: '.x.x.o.x.x.x.o.x',
    arp: true, arpRate: 1, arpPattern: [0, 1, 2, 4, 2, 1, 0, 3], bassCut: 420, padCut: 1100, pad: 0.022
  },
  boss: {
    bpm: 148, chords: [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]],
    kick: 'x..xx...x..xx.x.', snare: '....x.......x..x', hat: 'xXxXxXxXxXxXxXxX', bass: 'xxoxxxoxxxoxxxox',
    arp: true, arpRate: 1, arpPattern: [0, 2, 1, 3, 0, 4, 2, 5], bassCut: 600, padCut: 1600, pad: 0.03, dirty: true
  },
  results: {
    bpm: 84, chords: [[57, 60, 64], [52, 55, 59], [53, 57, 60], [55, 59, 62]],
    kick: '................', snare: '................', hat: '................', bass: 'x...............',
    arp: true, arpRate: 4, arpPattern: [0, 2, 1, 3], bassCut: 260, padCut: 1000, pad: 0.04
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// Sound recipes: fn(audio, out, t, pitch, opts) → duration (s)
const RECIPES = {
  gun: { reverb: 0.15, fn(a, out, t, p) {
    const n = a._noise(t, 0.15);
    const f = a._filter('bandpass', 1800 * p, 0.9, t, 500, 0.12);
    const g = a._env(t, 0.55, 0.001, 0.12);
    n.connect(f).connect(g).connect(out);
    const o = a._osc('sine', 190 * p, 48, t, 0.14);
    const g2 = a._env(t, 0.8, 0.001, 0.16);
    const w = a._shaper();
    o.connect(w).connect(g2).connect(out);
    return 0.18;
  } },
  gatling: { fn(a, out, t, p) {
    const n = a._noise(t, 0.06);
    const f = a._filter('bandpass', 2600 * p, 1.2);
    const g = a._env(t, 0.32, 0.001, 0.05);
    n.connect(f).connect(g).connect(out);
    const o = a._osc('square', 320 * p, 90, t, 0.04);
    const g2 = a._env(t, 0.12, 0.001, 0.05);
    o.connect(g2).connect(out);
    return 0.07;
  } },
  shotgun: { reverb: 0.25, fn(a, out, t, p) {
    const n = a._noise(t, 0.35);
    const f = a._filter('lowpass', 5000 * p, 0.7, t, 500, 0.3);
    const g = a._env(t, 0.8, 0.001, 0.3);
    n.connect(f).connect(g).connect(out);
    const o = a._osc('sine', 130, 40, t, 0.2);
    const g2 = a._env(t, 0.9, 0.001, 0.22);
    o.connect(g2).connect(out);
    return 0.36;
  } },
  missile: { fn(a, out, t, p) {
    const n = a._noise(t, 0.45);
    const f = a._filter('bandpass', 500 * p, 2, t, 2600 * p, 0.35);
    const g = a._env(t, 0.35, 0.02, 0.42);
    n.connect(f).connect(g).connect(out);
    return 0.45;
  } },
  explosion: { reverb: 0.45, fn(a, out, t, p, o) {
    const big = o.big ? 1.6 : 1;
    const n = a._noise(t, 1.2 * big, true);
    const f = a._filter('lowpass', 1400 * p, 0.8, t, 90, 0.9 * big);
    const g = a._env(t, 1.0, 0.004, 1.0 * big);
    const w = a._shaper();
    n.connect(w).connect(f).connect(g).connect(out);
    const s = a._osc('sine', 75 * p, 28, t, 0.7 * big);
    const g2 = a._env(t, 1.0, 0.003, 0.75 * big);
    s.connect(g2).connect(out);
    const c = a._noise(t, 0.4);
    const cf = a._filter('highpass', 3000, 0.7);
    const cg = a._env(t + 0.03, 0.25, 0.005, 0.35);
    c.connect(cf).connect(cg).connect(out);
    return 1.2 * big;
  } },
  tesla: { fn(a, out, t, p) {
    const o = a._osc('sawtooth', 90 * p, 70, t, 0.18);
    const lfo = a._osc('square', 55, 30, t, 0.18);
    const lg = a.ctx.createGain(); lg.gain.value = 400;
    lfo.connect(lg).connect(o.frequency);
    const f = a._filter('highpass', 900, 0.8);
    const g = a._env(t, 0.22, 0.002, 0.17);
    o.connect(f).connect(g).connect(out);
    const n = a._noise(t, 0.1);
    const nf = a._filter('bandpass', 5000, 1);
    const ng = a._env(t, 0.18, 0.001, 0.08);
    n.connect(nf).connect(ng).connect(out);
    return 0.2;
  } },
  saw: { fn(a, out, t, p) {
    const o = a._osc('square', 1900 * p, 1300, t, 0.12);
    const g = a._env(t, 0.08, 0.001, 0.1);
    o.connect(g).connect(out);
    const n = a._noise(t, 0.12);
    const f = a._filter('bandpass', 4200, 2);
    const g2 = a._env(t, 0.22, 0.001, 0.1);
    n.connect(f).connect(g2).connect(out);
    return 0.13;
  } },
  mine: { fn(a, out, t, p) {
    const o = a._osc('sine', 1400 * p, 1400 * p, t, 0.07);
    const g = a._env(t, 0.15, 0.002, 0.07);
    o.connect(g).connect(out);
    return 0.08;
  } },
  fossilize: { fn(a, out, t, p) {
    // Stone crack: granular noise bursts + a dull thud
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.018 + Math.random() * 0.01;
      const n = a._noise(tt, 0.05);
      const f = a._filter('bandpass', (1800 + Math.random() * 2400) * p, 3);
      const g = a._env(tt, 0.4 - i * 0.07, 0.001, 0.045);
      n.connect(f).connect(g).connect(out);
    }
    const o = a._osc('sine', 160 * p, 60, t, 0.1);
    const g = a._env(t, 0.35, 0.001, 0.1);
    o.connect(g).connect(out);
    return 0.14;
  } },
  shatter_big: { reverb: 0.4, fn(a, out, t, p) {
    for (let i = 0; i < 9; i++) {
      const tt = t + i * 0.03 + Math.random() * 0.02;
      const n = a._noise(tt, 0.08);
      const f = a._filter('bandpass', (900 + Math.random() * 2600) * p, 2.5);
      const g = a._env(tt, 0.55 - i * 0.04, 0.001, 0.08);
      n.connect(f).connect(g).connect(out);
    }
    const o = a._osc('sine', 90 * p, 30, t, 0.5);
    const g = a._env(t, 0.9, 0.002, 0.5);
    o.connect(g).connect(out);
    return 0.55;
  } },
  compy_chirp: { fn(a, out, t, p) {
    for (let i = 0; i < 2; i++) {
      const o = a._osc('sine', 2300 * p, 3300 * p, t + i * 0.07, 0.05);
      const g = a._env(t + i * 0.07, 0.07, 0.003, 0.05);
      o.connect(g).connect(out);
    }
    return 0.16;
  } },
  raptor_screech: { reverb: 0.25, fn(a, out, t, p) {
    const o = a._osc('sawtooth', 700 * p, 1500 * p, t, 0.12);
    o.frequency.exponentialRampToValueAtTime(600 * p, t + 0.45);
    const vib = a._osc('sine', 38, 38, t, 0.45);
    const vg = a.ctx.createGain(); vg.gain.value = 60;
    vib.connect(vg).connect(o.frequency);
    const f1 = a._filter('bandpass', 1700 * p, 4);
    const f2 = a._filter('bandpass', 2900 * p, 5);
    const g = a._env(t, 0.32, 0.02, 0.45);
    o.connect(f1).connect(g); o.connect(f2).connect(g);
    const n = a._noise(t, 0.4);
    const nf = a._filter('bandpass', 3500, 1.5);
    const ng = a._env(t, 0.12, 0.02, 0.35);
    n.connect(nf).connect(ng).connect(out);
    g.connect(out);
    return 0.5;
  } },
  brute_growl: { reverb: 0.3, fn(a, out, t, p) {
    const o = a._osc('sawtooth', 95 * p, 62 * p, t, 0.8);
    const am = a._osc('sine', 28, 22, t, 0.8);
    const amg = a.ctx.createGain(); amg.gain.value = 0.5;
    const vca = a.ctx.createGain(); vca.gain.value = 0.5;
    am.connect(amg).connect(vca.gain);
    const f = a._filter('lowpass', 700, 3);
    const g = a._env(t, 0.55, 0.06, 0.8);
    const w = a._shaper();
    o.connect(vca).connect(w).connect(f).connect(g).connect(out);
    return 0.85;
  } },
  trike_bellow: { reverb: 0.35, fn(a, out, t, p) {
    const o = a._osc('sawtooth', 72 * p, 52 * p, t, 1.0);
    const f1 = a._filter('bandpass', 320, 3);
    const f2 = a._filter('bandpass', 720, 4);
    const g = a._env(t, 0.9, 0.12, 1.0);
    o.connect(f1).connect(g); o.connect(f2).connect(g);
    g.connect(out);
    return 1.05;
  } },
  ankylo_grunt: { reverb: 0.25, fn(a, out, t, p) {
    const o = a._osc('sawtooth', 85 * p, 60 * p, t, 0.4);
    const f = a._filter('lowpass', 500, 4);
    const g = a._env(t, 0.6, 0.03, 0.4);
    o.connect(f).connect(g).connect(out);
    return 0.45;
  } },
  ptero_cry: { reverb: 0.4, fn(a, out, t, p) {
    const o = a._osc('square', 1300 * p, 780 * p, t, 0.5);
    const vib = a._osc('sine', 14, 14, t, 0.5);
    const vg = a.ctx.createGain(); vg.gain.value = 90;
    vib.connect(vg).connect(o.frequency);
    const f = a._filter('bandpass', 1600, 3);
    const g = a._env(t, 0.22, 0.03, 0.5);
    o.connect(f).connect(g).connect(out);
    return 0.55;
  } },
  trex_roar: { reverb: 0.9, fn(a, out, t, p, o) {
    // Layered roar: growling saw through sweeping formants, breathy noise, sub rumble, distortion
    const dur = (o.dur ?? 2.6);
    const ctx = a.ctx;
    const saw = ctx.createOscillator(); saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(48 * p, t);
    saw.frequency.linearRampToValueAtTime(92 * p, t + dur * 0.25);
    saw.frequency.linearRampToValueAtTime(70 * p, t + dur * 0.7);
    saw.frequency.linearRampToValueAtTime(38 * p, t + dur);
    saw.start(t); saw.stop(t + dur + 0.1);
    const saw2 = ctx.createOscillator(); saw2.type = 'sawtooth';
    saw2.frequency.setValueAtTime(48 * p * 1.51, t);
    saw2.frequency.linearRampToValueAtTime(92 * p * 1.49, t + dur * 0.25);
    saw2.frequency.linearRampToValueAtTime(38 * p * 1.5, t + dur);
    saw2.start(t); saw2.stop(t + dur + 0.1);
    const am = ctx.createOscillator(); am.type = 'sine';
    am.frequency.setValueAtTime(18, t); am.frequency.linearRampToValueAtTime(34, t + dur * 0.4); am.frequency.linearRampToValueAtTime(22, t + dur);
    am.start(t); am.stop(t + dur + 0.1);
    const amg = ctx.createGain(); amg.gain.value = 0.45;
    const vca = ctx.createGain(); vca.gain.value = 0.55;
    am.connect(amg).connect(vca.gain);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 2.5;
    f1.frequency.setValueAtTime(350, t); f1.frequency.linearRampToValueAtTime(900, t + dur * 0.3); f1.frequency.linearRampToValueAtTime(300, t + dur);
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 3;
    f2.frequency.setValueAtTime(1100, t); f2.frequency.linearRampToValueAtTime(1900, t + dur * 0.3); f2.frequency.linearRampToValueAtTime(800, t + dur);
    const w = a._shaper();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.0, t + 0.25);
    g.gain.setValueAtTime(1.0, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    saw.connect(vca); saw2.connect(vca);
    vca.connect(w);
    w.connect(f1).connect(g); w.connect(f2).connect(g);
    const lp = a._filter('lowpass', 2400, 0.7);
    g.connect(lp).connect(out);
    // Breath
    const n = a._noise(t, dur);
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.9;
    nf.frequency.setValueAtTime(700, t); nf.frequency.linearRampToValueAtTime(1500, t + dur * 0.3); nf.frequency.linearRampToValueAtTime(500, t + dur);
    const ng = a._env(t, 0.45, 0.2, dur);
    n.connect(nf).connect(ng).connect(out);
    // Sub
    const sub = a._osc('sine', 44 * p, 30, t, dur);
    const sg = a._env(t, 0.9, 0.2, dur);
    sub.connect(sg).connect(out);
    return dur + 0.2;
  } },
  stomp: { reverb: 0.3, fn(a, out, t, p) {
    const o = a._osc('sine', 85 * p, 28, t, 0.4);
    const g = a._env(t, 1.0, 0.002, 0.42);
    o.connect(g).connect(out);
    const n = a._noise(t, 0.2, true);
    const f = a._filter('lowpass', 500, 0.7);
    const g2 = a._env(t, 0.8, 0.002, 0.2);
    n.connect(f).connect(g2).connect(out);
    return 0.45;
  } },
  bite: { fn(a, out, t, p) {
    const n = a._noise(t, 0.08);
    const f = a._filter('highpass', 1800 * p, 1);
    const g = a._env(t, 0.35, 0.001, 0.07);
    n.connect(f).connect(g).connect(out);
    const o = a._osc('square', 240 * p, 120, t, 0.05);
    const g2 = a._env(t, 0.15, 0.001, 0.05);
    o.connect(g2).connect(out);
    return 0.1;
  } },
  tail_swipe: { reverb: 0.2, fn(a, out, t, p) {
    const n = a._noise(t, 0.5);
    const f = a._filter('bandpass', 300 * p, 1.5, t, 1800, 0.25);
    const g = a._env(t, 0.5, 0.15, 0.45);
    n.connect(f).connect(g).connect(out);
    return 0.5;
  } },
  hurt: { reverb: 0.2, fn(a, out, t, p) {
    for (const [f, v] of [[523, 0.18], [1187, 0.12], [1841, 0.08], [2730, 0.05]]) {
      const o = a._osc('sine', f * p, f * p * 0.98, t, 0.4);
      const g = a._env(t, v, 0.001, 0.4);
      o.connect(g).connect(out);
    }
    const n = a._noise(t, 0.15, true);
    const nf = a._filter('lowpass', 900, 1);
    const ng = a._env(t, 0.7, 0.001, 0.15);
    n.connect(nf).connect(ng).connect(out);
    return 0.42;
  } },
  ram: { fn(a, out, t, p) {
    const o = a._osc('sine', 120 * p, 45, t, 0.15);
    const g = a._env(t, 0.7, 0.001, 0.16);
    o.connect(g).connect(out);
    const n = a._noise(t, 0.1);
    const f = a._filter('bandpass', 1300, 1);
    const g2 = a._env(t, 0.3, 0.001, 0.08);
    n.connect(f).connect(g2).connect(out);
    return 0.18;
  } },
  gem: { fn(a, out, t, p) {
    const f = 880 * p;
    const o = a._osc('triangle', f, f * 1.5, t, 0.06);
    const g = a._env(t, 0.09, 0.002, 0.09);
    o.connect(g).connect(out);
    return 0.1;
  } },
  heal: { fn(a, out, t) {
    [0, 4, 7, 12].forEach((n, i) => {
      const o = a._osc('triangle', midi(72 + n), midi(72 + n), t + i * 0.05, 0.2);
      const g = a._env(t + i * 0.05, 0.12, 0.005, 0.25);
      o.connect(g).connect(out);
    });
    return 0.5;
  } },
  levelup: { reverb: 0.4, fn(a, out, t) {
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => {
      const tt = t + i * 0.055;
      const o = a._osc('square', midi(69 + n), midi(69 + n), tt, 0.18);
      const lp = a._filter('lowpass', 3500, 1);
      const g = a._env(tt, 0.1, 0.003, 0.3);
      o.connect(lp).connect(g).connect(out);
    });
    const n = a._noise(t, 0.8);
    const f = a._filter('highpass', 6000, 0.7);
    const g = a._env(t, 0.06, 0.2, 0.8);
    n.connect(f).connect(g).connect(out);
    return 0.9;
  } },
  evolve: { reverb: 0.6, fn(a, out, t) {
    [0, 7, 12, 19, 24, 31].forEach((n, i) => {
      const tt = t + i * 0.09;
      for (const det of [-8, 8]) {
        const o = a._osc('sawtooth', midi(57 + n), midi(57 + n), tt, 0.6);
        o.detune.value = det;
        const lp = a._filter('lowpass', 2800, 1);
        const g = a._env(tt, 0.06, 0.01, 0.7);
        o.connect(lp).connect(g).connect(out);
      }
    });
    return 1.3;
  } },
  combo: { fn(a, out, t, p) {
    const o = a._osc('square', 660 * p, 1320 * p, t, 0.12);
    const g = a._env(t, 0.07, 0.003, 0.14);
    o.connect(g).connect(out);
    return 0.15;
  } },
  ui: { fn(a, out, t, p) {
    const o = a._osc('triangle', 1200 * p, 900 * p, t, 0.05);
    const g = a._env(t, 0.12, 0.001, 0.06);
    o.connect(g).connect(out);
    return 0.07;
  } },
  ui_hover: { fn(a, out, t) {
    const o = a._osc('sine', 2200, 2400, t, 0.025);
    const g = a._env(t, 0.03, 0.001, 0.03);
    o.connect(g).connect(out);
    return 0.04;
  } },
  warning: { fn(a, out, t) {
    for (let i = 0; i < 4; i++) {
      const tt = t + i * 0.42;
      const o = a._osc('sawtooth', i % 2 ? 460 : 620, i % 2 ? 460 : 620, tt, 0.36);
      const lp = a._filter('lowpass', 1800, 1);
      const g = a._env(tt, 0.16, 0.01, 0.38);
      o.connect(lp).connect(g).connect(out);
    }
    return 1.8;
  } },
  nitro: { fn(a, out, t) {
    const n = a._noise(t, 0.7);
    const f = a._filter('bandpass', 400, 1, t, 3000, 0.4);
    const g = a._env(t, 0.4, 0.03, 0.6);
    n.connect(f).connect(g).connect(out);
    return 0.7;
  } },
  crate: { reverb: 0.3, fn(a, out, t) {
    [0, 5, 9, 12].forEach((n, i) => {
      const o = a._osc('triangle', midi(76 + n), midi(76 + n), t + i * 0.07, 0.3);
      const g = a._env(t + i * 0.07, 0.12, 0.004, 0.35);
      o.connect(g).connect(out);
    });
    return 0.6;
  } },
  airstrike: { reverb: 0.4, fn(a, out, t) {
    const o = a._osc('sine', 2400, 380, t, 0.9);
    const g = a._env(t, 0.14, 0.05, 0.9);
    o.connect(g).connect(out);
    return 1.0;
  } },
  bell: { reverb: 0.5, fn(a, out, t) {
    for (const [f, v] of [[880, 0.12], [1760 * 1.01, 0.06], [2640 * 0.99, 0.03]]) {
      const o = a._osc('sine', f, f, t, 1.2);
      const g = a._env(t, v, 0.002, 1.2);
      o.connect(g).connect(out);
    }
    return 1.2;
  } },
  death: { reverb: 0.6, fn(a, out, t) {
    RECIPES.explosion.fn(a, out, t, 0.7, { big: true });
    const o = a._osc('sawtooth', 220, 40, t, 1.6);
    const lp = a._filter('lowpass', 900, 1);
    const g = a._env(t, 0.15, 0.02, 1.6);
    o.connect(lp).connect(g).connect(out);
    return 2;
  } },
  victory: { reverb: 0.6, fn(a, out, t) {
    [[57, 60, 64], [53, 57, 60, 65], [55, 59, 62, 67], [57, 61, 64, 69]].forEach((ch, i) => {
      const tt = t + i * 0.32;
      for (const n of ch) {
        const o = a._osc('sawtooth', midi(n + 12), midi(n + 12), tt, i === 3 ? 1.6 : 0.34);
        const lp = a._filter('lowpass', 2400, 1);
        const g = a._env(tt, 0.05, 0.01, i === 3 ? 1.8 : 0.34);
        o.connect(lp).connect(g).connect(out);
      }
    });
    return 3;
  } }
};

export { GameAudio };
