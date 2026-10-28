// js/game/audio.js
// The game's sound system (v4). Designed samples (assets/audio/sfx, built by tools/audio/sfx.js from CC0 recordings +
// synthesis) and CC0 / original music (assets/audio/music, tools/audio/music.js), all listed in
// assets/audio/manifest.json and ASSETS.md. WebAudio graph:
//
//   voices ─┬─ weapons ─┐                                      ┌─ music cues ─ duck ─ muffle ─┐
//           ├─ impacts ─┤                                      │  stingers ───────────────────┤
//           ├─ creatures┼─ glue comp ─ sfx vol ─┐              │                    music vol ┘
//           ├─ ui ──────┤                       ├─ master ─ limiter ─ out
//           ├─ ambience ┘     announcer ─ sfx vol┘   (one shared street reverb is fed by voice sends)
//
// Voices: per-sound voice limits + minimum retrigger gaps, a global voice cap with priority stealing (oldest, lowest
// priority first), round-robin variations with pitch/gain jitter so repeated shots don't fatigue, 3D positioning
// (PannerNode + listener from the camera) with distance attenuation and air absorption, and music ducking for big
// moments. Until a sample group has decoded, the old procedural recipe (audio-recipes.js) stands in.
// Audio starts only after the first user gesture; everything loads lazily in priority order (boss music last).
//
// Phones (device-profile.js LOWMEM, iOS kills tabs that hold too much): the long looping music cues stream through a
// pool of two <audio> elements routed into the music bus (MediaElementSource) instead of being decoded (a decoded
// minute of stereo is ≈ 23 MB); only the short stingers decode. MP3 bytes are never kept, SFX decode on first use (the
// frequent ones up front), downmixed to mono, under SFX_BUDGET_LOWMEM (least recently used groups are dropped).

import { MusicDirector } from './audio-music.js';
import { ProcSynth, RECIPES } from './audio-recipes.js';
import { isWebKitOnly } from './backend.js';
import { disconnectVoice } from './audio-voice.js';
import { LOWMEM } from '../device-profile.js';

const MANIFEST = 'assets/audio/manifest.json';
const CODEC_DELAY = 1105 / 44100; // LAME encoder + decoder delay of our MP3s (compensated when the decoder keeps it)
const STORE = 'ea-audio';
const SFX_BUDGET_LOWMEM = 16e6; // decoded SFX bytes on phones (≈ 90 s of mono; was 24 MB, trimmed to pay for the 2.2× screen)
// Played from the first second of a run: decoded up front (everything else on phones decodes on first use)
const FIRST_SFX = ['ui_click', 'ui_hover', 'ui_back', 'gun', 'hitmarker', 'fossilize', 'casing', 'xp', 'compy_chirp', 'raptor_screech', 'hurt', 'danger', 'vo_go', 'bell'];

// name: { g group, vol, pitch [lo, hi], limit, gap (s), bus, prio 1–5, steal, range (m), verb, duck [dB, hold s],
//         also [{ name, chance, delay [a, b], vol }], proc (fallback recipe), pick (opts) => variation index,
//         pmap [centre, amount]: callers pass pitches tuned for the old recipes; samples only follow them partly }
const SFX = {
  // tail gun
  gun: { vol: 0.42, pitch: [0.95, 1.05], pmap: [1, 0.4], gainVar: 0.15, limit: 4, gap: 0.03, bus: 'weapons', prio: 4, steal: true, also: [{ name: 'casing', chance: 0.45, delay: [0.22, 0.42] }] },
  gun_tail: { vol: 0.3, pitch: [0.96, 1.04], limit: 1, gap: 0.25, bus: 'weapons', prio: 2, steal: true },
  casing: { vol: 0.12, pitch: [0.9, 1.12], limit: 3, gap: 0.05, bus: 'weapons', prio: 1 },
  dry_fire: { vol: 0.5, limit: 1, gap: 0.12, bus: 'weapons', prio: 3, proc: 'ui' },
  reload_out: { vol: 0.55, limit: 1, gap: 0.2, bus: 'weapons', prio: 4, proc: 'ui' },
  reload_in: { vol: 0.6, limit: 1, gap: 0.2, bus: 'weapons', prio: 4, proc: 'ui' },
  bolt: { vol: 0.5, limit: 1, gap: 0.2, bus: 'weapons', prio: 4, proc: 'ui' },
  overheat: { vol: 0.35, limit: 1, gap: 2.5, bus: 'weapons', prio: 2 },
  rail: { vol: 0.62, pitch: [0.97, 1.03], limit: 2, gap: 0.1, bus: 'weapons', prio: 4, steal: true, verb: 0.1, proc: 'gun' },
  hitmarker: { vol: 0.32, pitch: [0.97, 1.05], limit: 3, gap: 0.035, bus: 'ui', prio: 3, proc: 'ui' },
  headshot: { vol: 0.42, pitch: [0.98, 1.03], limit: 2, gap: 0.06, bus: 'ui', prio: 4, proc: 'combo' },
  // support weapons
  gatling: { vol: 0.24, pitch: [0.93, 1.08], gainVar: 0.2, limit: 5, gap: 0.028, bus: 'weapons', prio: 2, steal: true },
  shotgun: { vol: 0.5, pitch: [0.95, 1.05], limit: 3, gap: 0.06, bus: 'weapons', prio: 3, steal: true },
  missile: { vol: 0.36, pitch: [0.92, 1.1], limit: 4, gap: 0.05, bus: 'weapons', prio: 2 },
  tesla: { vol: 0.32, pitch: [0.9, 1.1], limit: 4, gap: 0.04, bus: 'weapons', prio: 2 },
  saw: { vol: 0.3, pitch: [0.9, 1.1], limit: 4, gap: 0.05, bus: 'weapons', prio: 2 },
  mine: { vol: 0.25, limit: 3, gap: 0.1, bus: 'weapons', prio: 1 },
  airstrike: { vol: 0.5, limit: 2, gap: 0.3, bus: 'weapons', prio: 4 },
  // impacts / kills
  fossilize: { vol: 0.5, pitch: [0.92, 1.08], pmap: [1.1, 0.4], gainVar: 0.15, limit: 7, gap: 0.025, bus: 'impacts', prio: 3, steal: true },
  shatter_big: { vol: 0.75, pitch: [0.93, 1.05], pmap: [1, 0.35], limit: 4, gap: 0.06, bus: 'impacts', prio: 4, verb: 0.15 },
  explosion: { vol: 0.62, pitch: [0.92, 1.06], pmap: [1, 0.5], limit: 6, gap: 0.04, bus: 'impacts', prio: 3, steal: true, verb: 0.15, range: 120 },
  explosion_big: { vol: 0.9, pitch: [0.95, 1.03], pmap: [1, 0.5], limit: 2, gap: 0.15, bus: 'impacts', prio: 5, verb: 0.25, range: 200, duck: [-5, 0.8], proc: 'explosion' },
  hurt: { vol: 0.75, pitch: [0.92, 1.06], pmap: [1, 0.5], limit: 2, gap: 0.08, bus: 'impacts', prio: 5 },
  glass: { vol: 0.6, pitch: [0.95, 1.1], limit: 2, gap: 0.15, bus: 'impacts', prio: 3, proc: 'shatter_big' },
  // creatures
  compy_chirp: { vol: 0.32, pitch: [0.9, 1.15], limit: 3, gap: 0.08, bus: 'creatures', prio: 2, range: 70 },
  raptor_screech: { vol: 0.55, pitch: [0.92, 1.1], limit: 3, gap: 0.16, bus: 'creatures', prio: 3, verb: 0.08 },
  raptor_call: { vol: 0.32, pitch: [0.9, 1.12], limit: 2, gap: 0.6, bus: 'creatures', prio: 1, verb: 0.1, range: 80, proc: 'raptor_screech' },
  brute_growl: { vol: 0.7, pitch: [0.92, 1.06], pmap: [0.85, 0.4], limit: 2, gap: 0.3, bus: 'creatures', prio: 4, verb: 0.12, range: 110 },
  trike_bellow: { vol: 0.8, pitch: [0.92, 1.05], pmap: [0.8, 0.4], limit: 2, gap: 0.3, bus: 'creatures', prio: 4, verb: 0.15, range: 130 },
  ankylo_grunt: { vol: 0.65, pitch: [0.92, 1.08], limit: 2, gap: 0.3, bus: 'creatures', prio: 3, range: 100 },
  ptero_cry: { vol: 0.55, pitch: [0.92, 1.1], limit: 2, gap: 0.2, bus: 'creatures', prio: 3, verb: 0.15, range: 120 },
  bite: { vol: 0.55, pitch: [0.9, 1.1], pmap: [1, 0.4], limit: 3, gap: 0.07, bus: 'creatures', prio: 3 },
  tail_swipe: { vol: 0.6, pitch: [0.9, 1.1], pmap: [1, 0.4], limit: 2, gap: 0.2, bus: 'creatures', prio: 3 },
  footstep_heavy: { vol: 0.5, pitch: [0.85, 1.1], gainVar: 0.25, limit: 4, gap: 0.09, bus: 'creatures', prio: 1, range: 60, proc: 'stomp' },
  stomp: { vol: 0.85, pitch: [0.92, 1.06], pmap: [0.65, 0.35], limit: 3, gap: 0.12, bus: 'creatures', prio: 4, verb: 0.15, range: 170 },
  trex_roar: { vol: 1.0, pitch: [0.97, 1.03], pmap: [1, 0.3], limit: 1, gap: 0.5, bus: 'creatures', prio: 5, steal: true, verb: 0.2, range: 320, duck: [-9, 1.6], y: 5,
    pick: (o) => ((o.dur ?? 2.6) >= 2 ? [0, 1] : [2, 3]) },
  trex_death: { g: 'trex_roar', vol: 1.0, limit: 1, gap: 1, bus: 'creatures', prio: 5, steal: true, verb: 0.25, range: 320, duck: [-10, 3], y: 4, pick: () => [4], proc: 'trex_roar' },
  // pickups, UI, arcade
  xp: { vol: 0.22, limit: 6, gap: 0.018, bus: 'ui', prio: 1, proc: 'gem' },
  pickup: { vol: 0.5, limit: 2, gap: 0.2, bus: 'ui', prio: 3, proc: 'crate' },
  heal: { vol: 0.5, limit: 2, gap: 0.2, bus: 'ui', prio: 3 },
  overdrive: { vol: 0.55, limit: 1, gap: 0.3, bus: 'ui', prio: 4, proc: 'nitro' },
  levelup: { vol: 0.55, limit: 1, gap: 0.2, bus: 'ui', prio: 5 },
  card_show: { vol: 0.4, limit: 1, gap: 0.2, bus: 'ui', prio: 3, proc: 'ui_hover' },
  card_pick: { vol: 0.55, limit: 2, gap: 0.05, bus: 'ui', prio: 4, proc: 'ui' },
  reroll: { vol: 0.5, limit: 1, gap: 0.1, bus: 'ui', prio: 3, proc: 'ui' },
  evolve: { vol: 0.6, limit: 1, gap: 0.5, bus: 'ui', prio: 5, duck: [-6, 1.2] },
  combo: { vol: 0.35, limit: 2, gap: 0.15, bus: 'ui', prio: 3 },
  danger: { vol: 0.42, limit: 1, gap: 0.5, bus: 'ui', prio: 4, proc: 'ui' },
  warning: { vol: 0.6, limit: 1, gap: 1, bus: 'ui', prio: 5 },
  ui_click: { vol: 0.45, limit: 3, gap: 0.03, bus: 'ui', prio: 3, proc: 'ui' },
  ui_hover: { vol: 0.22, limit: 2, gap: 0.04, bus: 'ui', prio: 1 },
  ui_back: { vol: 0.4, limit: 2, gap: 0.04, bus: 'ui', prio: 2, proc: 'ui' },
  count_tick: { vol: 0.4, limit: 1, gap: 0.2, bus: 'ui', prio: 3, proc: 'ui' },
  bell: { vol: 0.4, limit: 1, gap: 0.3, bus: 'ui', prio: 3 },
  zone_clear: { vol: 0.5, limit: 1, gap: 0.5, bus: 'ui', prio: 4, proc: 'bell' },
  // announcer (Kenney Voiceover Packs, CC0): skipped while the announcer is switched off
  ...Object.fromEntries(['go', 'ready', 'levelup', 'gameover', 'highscore', 'mission', 'hurry', 'powerup', 'lookout', 'combo', 'multikill', 'flawless', 'prepare', 'finalround', 'winner']
    .map((v) => [`vo_${v}`, { vol: 0.7, limit: 1, gap: 0.4, bus: 'voice', prio: 5, steal: true, duck: [-5, 1] }]))
};
// Old names used around the code base
const ALIAS = { fossilize_big: 'shatter_big', ui: 'ui_click', gem: 'xp', crate: 'pickup', nitro: 'overdrive', ram: 'hurt' };
const BUS_GAIN = { weapons: 0.9, impacts: 1, creatures: 1, ui: 0.8, ambience: 0.7, voice: 1 };

const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
// Safari kills (and reloads) WebContent processes that hold too much memory: WebKit browsers get the phone music budget
const tightMemory = isMobile || (typeof navigator !== 'undefined' && isWebKitOnly(navigator.userAgent || ''));

class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.announcer = true;
    this.volume = { master: 0.9, music: 0.6, sfx: 0.85 };
    this.listener = { x: 0, y: 1.6, z: 0, fx: 0, fy: 0, fz: 1 };
    this.voices = []; // active sample/recipe voices
    this.heldNodes = 0; // air filters + reverb sends not yet disconnected (must stay flat over a session)
    this.byName = new Map(); // name → { count, last }
    this.maxVoices = isMobile ? 26 : 44;
    this.loops = {};
    this.loopVoices = new Map();
    this.manifest = null;
    this.sfxBuf = new Map(); // group → [{ buffer, offset }]
    this.music = new Map(); // cue id → { buffer, offset }
    this.raw = new Map(); // url → Promise<ArrayBuffer>
    this.loading = new Set();
    this.queue = [];
    this.active = 0;
    this.lastPick = new Map();
    this.musicState = 'off';
    this.md = new MusicDirector(this);
    this.duckUntil = 0;
    this.duckDepth = 1;
    // Decoded music is big (stereo float ≈ 21 MB a minute; all cues ≈ 310 MB) and phones kill tabs that hold that much,
    // so decoded cues live under a budget: the least recently used long cue that isn't needed is dropped and decoded
    // again from its kept MP3 bytes (≈ 10 MB in total) when it is wanted. ?musicbudget=<MB> overrides (tests).
    const mb = typeof location !== 'undefined' && /[?&]musicbudget=(\d+)/.exec(location.search);
    this.musicBudget = (mb ? +mb[1] : tightMemory ? 140 : 320) * 1e6;
    this.musicUsed = new Map(); // cue id → last use (ms)
    this.stream = LOWMEM && typeof Audio !== 'undefined'; // long music cues stream from <audio> elements (see header)
    this.streams = []; // pool: { el, node, busy, since, timer }
    this.sfxBudget = LOWMEM ? SFX_BUDGET_LOWMEM : Infinity;
    this.sfxUsed = new Map(); // group → last use (ms)
    this.failed = new Map(); // load key → time of the last failure (retry after a pause)
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (saved) {
        for (const k of Object.keys(this.volume)) {
          const v = Number(saved.volume?.[k]);
          if (saved.volume?.[k] != null && Number.isFinite(v)) this.volume[k] = Math.max(0, Math.min(1, v));
        }
        this.enabled = saved.enabled !== false;
        this.announcer = saved.announcer !== false;
      }
    } catch { /* storage unavailable */ }
    this._manifestP = this._fetchManifest();
  }

  get supported() {
    return !this.broken && typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  async _fetchManifest() {
    try {
      const r = await fetch(MANIFEST);
      if (!r.ok) throw new Error(r.status);
      this.manifest = await r.json();
      // Prefetch (network only, no decoding before the first gesture) what the title screen needs
      if (!this.isStream('title')) this._prefetch(this.manifest.music?.title?.file);
      for (const g of ['ui_click', 'ui_hover']) for (const f of this.manifest.sfx?.[g]?.files || []) this._prefetch(f.file);
    } catch (err) {
      console.warn('Audio manifest unavailable, using procedural sound only:', err.message || err);
      this.manifest = { sfx: {}, music: {} };
    }
    return this.manifest;
  }

  _prefetch(url) {
    if (!url || this.raw.has(url)) return this.raw.get(url);
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); });
    p.catch(() => {});
    this.raw.set(url, p);
    return p;
  }

  /** Must be called from a user gesture (pointer/key/touch) */
  unlock() {
    if (!this.supported) return;
    if (!this.ctx) {
      // Outside a real activation (touch pointerdown, gamepad, scripted calls) the browser would refuse and warn
      // "The AudioContext was not allowed to start": wait for the next gesture instead
      const ua = navigator.userActivation;
      if (ua && !ua.isActive) return;
      // A context that can't be built leaves the game silent, never stuck (START calls this)
      try { this._build(); } catch (err) {
        console.warn('Web Audio unavailable, continuing without sound:', err.message || err);
        try { this.ctx?.close(); } catch { /* ignore */ }
        this.ctx = null;
        this.broken = true;
        return;
      }
    }
    const s = this.ctx.state;
    if (s !== 'running' && s !== 'closed' && this.enabled && !document.hidden) this.ctx.resume().catch(() => {});
  }

  /** Unlock on the next user gesture anywhere: the first start, and again whenever the OS suspends or interrupts the
   *  context (iOS after an app switch or a phone call refuses a resume() that isn't inside a gesture) */
  armGesture() {
    if (this._armed || !this.supported) return;
    this._armed = true;
    const evs = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'];
    const fn = (e) => {
      // A touch pointerdown is not a user activation (it comes with pointerup/touchend)
      if (e.type === 'pointerdown' && e.pointerType !== 'mouse') return;
      this.unlock();
      if (this.ctx?.state === 'running') {
        for (const ev of evs) window.removeEventListener(ev, fn, true);
        this._armed = false;
      }
    };
    for (const ev of evs) window.addEventListener(ev, fn, true);
  }

  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // iOS: a silent buffer started inside the gesture unlocks output
    try { const b = ctx.createBuffer(1, 1, ctx.sampleRate); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch { /* ignore */ }
    // Master: gain → brick-wall-ish limiter (Chrome/Safari compressor has 6 ms look-ahead) → out
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    const L = this.limiter;
    L.threshold.value = -2.5; L.knee.value = 0; L.ratio.value = 20; L.attack.value = 0.001; L.release.value = 0.12;
    // WebAudio compressors add automatic make-up gain: trim 2 dB after the limiter so peaks stay well under 0 dBFS
    this.outTrim = ctx.createGain();
    this.outTrim.gain.value = 0.79;
    // Last line of defence: a soft clipper that is linear up to −1.5 dBFS and bends smoothly into 0.99 (never a hard clip)
    this.safety = ctx.createWaveShaper();
    // (a WaveShaper maps input −1…1 across the curve; anything beyond ±1 holds the end values, about ±0.97)
    const n = 4097, curve = new Float32Array(n), k = 0.84;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= k ? a : k + (0.99 - k) * Math.tanh((a - k) / (0.99 - k) * 1.2));
    }
    this.safety.curve = curve;
    this.safety.oversample = 'none'; // oversampling filters could ring past the ceiling
    this.master.connect(L).connect(this.outTrim).connect(this.safety).connect(ctx.destination);
    // Tests (?test / ?audiodebug): an output meter after the limiter (peak over the last 0.74 s)
    if (/[?&](test|audiodebug)\b/.test(location.search)) {
      this.meter = ctx.createAnalyser();
      this.meter.fftSize = 32768;
      this.meterBuf = new Float32Array(this.meter.fftSize);
      this.safety.connect(this.meter);
      this.meterPre = ctx.createAnalyser(); // before the soft clipper: how hard is it being driven?
      this.meterPre.fftSize = 32768;
      this.outTrim.connect(this.meterPre);
    }
    // SFX: category buses → glue compressor → sfx volume → master
    this.sfxVol = ctx.createGain();
    this.sfxVol.connect(this.master);
    this.glue = ctx.createDynamicsCompressor();
    const G = this.glue;
    G.threshold.value = -16; G.knee.value = 8; G.ratio.value = 3.5; G.attack.value = 0.004; G.release.value = 0.14;
    this.glue.connect(this.sfxVol);
    this.buses = {};
    for (const [name, g] of Object.entries(BUS_GAIN)) {
      const b = ctx.createGain();
      b.gain.value = g;
      b.connect(name === 'voice' ? this.sfxVol : this.glue);
      this.buses[name] = b;
    }
    this.voiceGain = this.buses.voice;
    // Shared street reverb (short, slightly dark): sends from voices
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    const rvHp = ctx.createBiquadFilter(); rvHp.type = 'highpass'; rvHp.frequency.value = 200;
    this.reverbSend.connect(rvHp).connect(this.reverb).connect(this.glue);
    // Music: cues → duck → muffle → music volume → master; stingers skip the duck
    this.musicVol = ctx.createGain();
    this.musicVol.connect(this.master);
    this.musicMuffle = ctx.createBiquadFilter();
    this.musicMuffle.type = 'lowpass';
    this.musicMuffle.frequency.value = 20000;
    this.musicMuffle.Q.value = 0.5;
    this.musicMuffle.connect(this.musicVol);
    this.musicDuck = ctx.createGain();
    this.musicDuck.connect(this.musicMuffle);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicDuck);
    this.stingBus = ctx.createGain();
    this.stingBus.connect(this.musicVol);
    this.proc = new ProcSynth(ctx);
    if (this.stream) this._buildStreams();
    this.applyVolumes();
    this._buildLoops();
    if (ctx.listener.positionX === undefined) this._legacyListener = true;
    // Pause audio with the tab (battery on phones); resume on return
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else if (this.enabled) { this.ctx.resume().catch(() => {}); this.armGesture(); }
      for (const s of this.streams) if (s.busy) { if (document.hidden) s.el.pause(); else s.el.play().catch(() => {}); }
    });
    ctx.onstatechange = () => { if (ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) this.armGesture(); };
    // Start loading: title + UI + the most frequent sounds first, then everything except the boss music
    this._manifestP.then(() => this._queueAll());
    if (this.musicState !== 'off') this.md.set(this.musicState);
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        lp += ((Math.random() * 2 - 1) - lp) * (0.15 + 0.6 * (1 - x) * (1 - x));
        d[i] = lp * Math.pow(1 - x, decay);
      }
      // two street-canyon slaps
      for (const [t, a] of [[0.045 + c * 0.012, 0.5], [0.11 + c * 0.017, 0.3]]) d[Math.floor(t * ctx.sampleRate)] += a;
    }
    return buf;
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Loading
  _queueAll() {
    const m = this.manifest;
    if (!m) return;
    const first = FIRST_SFX;
    const add = (kind, id) => { if (!this.queue.some((q) => q.kind === kind && q.id === id)) this.queue.push({ kind, id }); };
    if (LOWMEM) {
      // Phones: the frequent SFX and the stingers; music streams, the rest of the SFX decode on first use
      for (const g of first) if (m.sfx[g]) add('sfx', g);
      for (const id of ['boss_sting', 'victory', 'gameover']) if (m.music[id]) add('music', id);
      this._pump();
      return;
    }
    add('music', 'title');
    for (const g of first) if (m.sfx[g]) add('sfx', g);
    add('music', 'combat');
    for (const g of Object.keys(m.sfx)) add('sfx', g);
    // On a tight memory budget (phones) the rarer long cues (combat_hi, results) decode on demand instead
    const tight = this.musicBudget < 200e6;
    for (const id of ['combat_heat', 'breather', 'combat_hi', 'boss_sting', 'continue', 'gameover', 'results', 'victory']) {
      if (m.music[id] && !(tight && (id === 'combat_hi' || id === 'results'))) add('music', id);
    }
    this._pump();
  }

  /** Request music cues (front of the queue); boss cues only load through here */
  loadMusic(ids) {
    for (const id of ids) {
      if (!this.manifest?.music?.[id] || this.isStream(id) || this.music.has(id) || this.loading.has('music:' + id)) continue;
      if (performance.now() - (this.failed.get('music:' + id) ?? -1e9) < 10000) continue;
      this.queue = this.queue.filter((q) => !(q.kind === 'music' && q.id === id));
      this.queue.unshift({ kind: 'music', id });
    }
    this._pump();
  }

  _pump() {
    if (!this.ctx) return;
    while (this.active < 3 && this.queue.length) {
      const job = this.queue.shift();
      const key = job.kind + ':' + job.id;
      if (this.loading.has(key) || (job.kind === 'music' ? this.music.has(job.id) : this.sfxBuf.has(job.id))) continue;
      this.loading.add(key);
      this.active++;
      this._load(job).finally(() => { this.loading.delete(key); this.active--; this._pump(); });
    }
  }

  async _decode(url, n, keepRaw = false) {
    let data;
    try { data = await this._prefetch(url); } catch (err) { this.raw.delete(url); throw err; } // refetch on a retry
    if (!keepRaw || LOWMEM) this.raw.delete(url); // decoded copies only from here on (music keeps its MP3 bytes, see musicBudget)
    let buffer = await this.ctx.decodeAudioData(LOWMEM ? data : data.slice(0));
    if (LOWMEM && !keepRaw && buffer.numberOfChannels > 1) buffer = this._mono(buffer);
    // MP3 decoders that ignore the encoder delay return it as extra leading samples: skip them
    const extra = buffer.length - (n || 0) * (buffer.sampleRate / 44100);
    const offset = n && extra > 0.015 * buffer.sampleRate ? CODEC_DELAY : 0;
    return { buffer, offset };
  }

  async _load(job) {
    try {
      if (job.kind === 'music') {
        const e = this.manifest.music[job.id];
        this.music.set(job.id, await this._decode(e.file, e.n, true));
        this.musicUsed.set(job.id, performance.now());
        this._trimMusic(job.id);
        this.md.onLoaded(job.id);
      } else {
        const e = this.manifest.sfx[job.id];
        const list = [];
        for (const f of e.files) list.push(await this._decode(f.file, f.n));
        this.sfxBuf.set(job.id, list);
        if (job.id === 'flamer_loop') this._sampleFlamer();
        if (LOWMEM) this._trimSfx(job.id);
      }
    } catch (err) {
      this.failed.set(job.kind + ':' + job.id, performance.now());
      console.warn(`Audio: could not load ${job.kind} "${job.id}":`, err.message || err);
    }
  }

  /** Decoded SFX group `g` is wanted (phones decode on first use; the procedural recipe stands in meanwhile) */
  _wantSfx(g) {
    this.sfxUsed.set(g, performance.now());
    if (!LOWMEM || this.sfxBuf.has(g) || this.loading.has('sfx:' + g) || !this.manifest?.sfx?.[g]) return;
    if (performance.now() - (this.failed.get('sfx:' + g) ?? -1e9) < 10000) return;
    if (!this.queue.some((q) => q.kind === 'sfx' && q.id === g)) this.queue.unshift({ kind: 'sfx', id: g });
    this._pump();
  }

  /** Phones: keep decoded SFX under sfxBudget by dropping the least recently used groups (never the frequent ones) */
  _trimSfx(loaded) {
    const bytes = (list) => list.reduce((n, s) => n + s.buffer.length * s.buffer.numberOfChannels * 4, 0);
    let total = 0;
    for (const list of this.sfxBuf.values()) total += bytes(list);
    if (total <= this.sfxBudget) return;
    const looping = new Set([...this.loopVoices.values()].map((v) => v.name));
    const order = [...this.sfxBuf.keys()]
      .filter((g) => g !== loaded && !FIRST_SFX.includes(g) && !looping.has(g) && g !== 'flamer_loop')
      .sort((a, b) => (this.sfxUsed.get(a) ?? 0) - (this.sfxUsed.get(b) ?? 0));
    for (const g of order) {
      if (total <= this.sfxBudget) break;
      total -= bytes(this.sfxBuf.get(g));
      this.sfxBuf.delete(g);
    }
  }

  /** Phones: a stereo buffer folded to mono (half the memory; voices are panned or centred anyway) */
  _mono(buf) {
    const n = buf.length, out = this.ctx.createBuffer(1, n, buf.sampleRate), d = out.getChannelData(0);
    const ch = buf.numberOfChannels;
    for (let c = 0; c < ch; c++) { const s = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] += s[i] / ch; }
    return out;
  }

  /** Phones: long looping music cues stream (see the header); short cues and the heat layer decode */
  isStream(id) {
    const e = this.manifest?.music?.[id];
    return !!(this.stream && e && e.loop && e.dur > 20);
  }

  /** Two <audio> elements (crossfades) routed into the graph. Built inside the unlocking gesture: iOS lets an element
   *  play later without a gesture once it has played inside one (the source node isn't connected yet → silent). */
  _buildStreams() {
    for (let i = 0; i < 2; i++) {
      try {
        const el = new Audio();
        el.preload = 'auto';
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
        const node = this.ctx.createMediaElementSource(el);
        const file = this.manifest?.music?.[i ? 'combat' : 'title']?.file;
        if (file) {
          el.src = file;
          el.play().then(() => { if (!this.streams[i]?.busy) el.pause(); }).catch(() => {});
        }
        this.streams.push({ el, node, busy: false, since: 0, timer: 0, stopT: 0 });
      } catch (err) {
        console.warn('Audio: streaming music unavailable, decoding instead:', err.message || err);
        this.stream = false;
        return;
      }
    }
  }

  /** A source-like object for a streamed cue: connect(node), start(when), stop(when) in AudioContext time */
  streamSource(e) {
    const ctx = this.ctx;
    let s = this.streams.find((p) => !p.busy) || this.streams.slice().sort((a, b) => a.since - b.since)[0];
    this._releaseStream(s);
    s.busy = true;
    s.since = performance.now();
    const el = s.el;
    const url = new URL(e.file, location.href).href;
    if (el.src !== url) { el.src = e.file; el.load(); }
    try { el.pause(); } catch { /* ignore */ }
    const seek = (t) => { try { el.currentTime = t; } catch { /* metadata not loaded yet */ } };
    const at = (when, fn) => setTimeout(fn, Math.max(0, (when - ctx.currentTime) * 1000));
    return {
      /** Playback position of the element (s into the file) while it plays, else null: layers sync to it */
      get time() { return s.busy && !el.paused && el.readyState >= 2 ? el.currentTime : null; },
      connect: (node) => { try { s.node.disconnect(); } catch { /* not connected */ } s.node.connect(node); return node; },
      start: (when) => {
        seek(e.loopStart);
        if (el.readyState < 1) el.addEventListener('loadedmetadata', () => { if (s.busy && el.paused) seek(e.loopStart); }, { once: true });
        clearTimeout(s.startT);
        s.startT = at(when, () => { if (s.busy && !document.hidden) el.play().catch(() => {}); });
        // Loop between loopStart and loopEnd (the files carry 0.25 s of padding at both ends)
        clearInterval(s.timer);
        s.timer = setInterval(() => {
          if (!s.busy) return;
          if (el.ended || el.currentTime >= e.loopEnd - 0.03) { seek(e.loopStart); if (el.paused && !document.hidden) el.play().catch(() => {}); }
        }, 40);
      },
      stop: (when = 0) => { const mine = s.since; clearTimeout(s.stopT); s.stopT = at(when, () => { if (s.since === mine) this._releaseStream(s); }); }
    };
  }

  _releaseStream(s) {
    if (!s) return;
    clearInterval(s.timer);
    clearTimeout(s.startT);
    s.busy = false;
    try { s.el.pause(); } catch { /* ignore */ }
    try { s.node.disconnect(); } catch { /* not connected */ }
  }

  /** Keep decoded music under musicBudget: drop the least recently used long cues that nothing needs right now */
  _trimMusic(loaded) {
    const bytes = (m) => m.buffer.length * m.buffer.numberOfChannels * 4;
    let total = 0;
    for (const m of this.music.values()) total += bytes(m);
    if (total <= this.musicBudget) return;
    const md = this.md;
    const keep = new Set([loaded, md.want, md.cur?.id, ...md.stings.map((s) => s.id)]);
    if (md.cur?.id === 'combat') keep.add('combat_heat');
    if (md.state === 'prebos' || md.state === 'boss') for (const id of ['boss1', 'boss2_intro', 'boss2', 'boss3']) keep.add(id);
    if (md.state === 'victory' || md.state === 'gameover') keep.add('results');
    // Short cues (stingers, the heat layer) are cheap and timing-critical: only long ones are dropped
    const order = [...this.music.keys()]
      .filter((id) => !keep.has(id) && bytes(this.music.get(id)) > 8e6)
      .sort((a, b) => (this.musicUsed.get(a) ?? 0) - (this.musicUsed.get(b) ?? 0));
    for (const id of order) {
      if (total <= this.musicBudget) break;
      total -= bytes(this.music.get(id));
      this.music.delete(id);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  applyVolumes() {
    try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, enabled: this.enabled, announcer: this.announcer })); } catch { /* ignore */ }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Perceptual curve: slider² so the lower half of the slider is usable
    const curve = (v) => Math.max(0, Math.min(1, v)) ** 2;
    this.master.gain.setTargetAtTime(this.enabled ? curve(this.volume.master) * 1.2 : 0, t, 0.04);
    this.sfxVol.gain.setTargetAtTime(curve(this.volume.sfx) * 1.25, t, 0.04);
    this.musicVol.gain.setTargetAtTime(curve(this.volume.music) * 1.4, t, 0.04);
    this.voiceGain.gain.setTargetAtTime(this.announcer ? BUS_GAIN.voice : 0, t, 0.04);
    if (this.enabled && this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    this.applyVolumes();
  }

  setAnnouncer(on) {
    this.announcer = on;
    this.applyVolumes();
  }

  /** Camera position + forward vector (y optional) */
  setListener(x, a, b, c, d, e) {
    const L = this.listener;
    if (e === undefined) { L.x = x; L.z = a; L.fx = b; L.fz = c; L.y = 1.6; L.fy = 0; } else { L.x = x; L.y = a; L.z = b; L.fx = c; L.fy = d; L.fz = e; }
    if (!this.ctx) return;
    const li = this.ctx.listener;
    if (this._legacyListener) { li.setPosition(L.x, L.y, L.z); li.setOrientation(L.fx, L.fy, L.fz, 0, 1, 0); return; }
    const t = this.ctx.currentTime;
    li.positionX.setValueAtTime(L.x, t); li.positionY.setValueAtTime(L.y, t); li.positionZ.setValueAtTime(L.z, t);
    li.forwardX.setValueAtTime(L.fx, t); li.forwardY.setValueAtTime(L.fy, t); li.forwardZ.setValueAtTime(L.fz, t);
    li.upX.setValueAtTime(0, t); li.upY.setValueAtTime(1, t); li.upZ.setValueAtTime(0, t);
  }

  /** Muffles the music (level-up / pause / continue) */
  setMuffled(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicMuffle.frequency.setTargetAtTime(on ? 700 : 20000, t, 0.08);
  }

  /** Dip the music for a big moment (roar, name card): depth in dB, hold seconds */
  duck(db = -8, hold = 1, release = 0.8) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = 10 ** (db / 20);
    // Keep the deeper of overlapping ducks
    if (t < this.duckUntil && g > this.duckDepth) {
      // A shallower duck inside a deeper one only pushes the release back
      if (t + hold > this.duckUntil) {
        const p = this.musicDuck.gain;
        p.cancelScheduledValues(this.duckUntil);
        this.duckUntil = t + hold;
        p.setTargetAtTime(1, this.duckUntil, release / 3);
      }
      return;
    }
    this.duckDepth = g;
    this.duckUntil = t + hold;
    const p = this.musicDuck.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.setTargetAtTime(g, t, 0.04);
    p.setTargetAtTime(1, t + hold, release / 3);
  }

  // ------------------------------------------------------------------------------------------------------------------
  /**
   * play(name, { x, y, z, volume, pitch, range, follow, delay }) — x/z world position for 3D sounds (omit for 2D)
   * Returns the voice (or null when skipped).
   */
  play(name, opts = {}) {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return null;
    name = ALIAS[name] || name;
    if (name === 'death') { this.play('explosion_big', { volume: 1, pitch: 0.85 }); return this.play('hurt', { volume: 1, pitch: 0.7 }); }
    if (name === 'victory') return null; // the victory sting is music now
    if (name.startsWith('vo_') && !this.announcer) return null;
    const def = SFX[name];
    if (!def) return null;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    let st = this.byName.get(name);
    if (!st) { st = { count: 0, last: -9 }; this.byName.set(name, st); }
    if (now - st.last < (def.gap ?? 0.04) && !opts.force) return null;
    // Per-sound voice limit (steal the oldest of the same sound for weapons, otherwise skip)
    if (st.count >= (def.limit ?? 3)) {
      if (!def.steal) return null;
      const old = this.voices.find((v) => v.name === name);
      if (old) this._kill(old, 0.02);
    }
    let vol = (opts.volume ?? 1) * (def.vol ?? 0.5);
    let dist = 0;
    const spatial = opts.x !== undefined && opts.z !== undefined;
    if (spatial) {
      const L = this.listener;
      dist = Math.hypot(opts.x - L.x, opts.z - L.z);
      const range = opts.range ?? def.range ?? 90;
      vol *= 1 / (1 + (dist / (range * 0.35)) ** 2);
      if (vol < 0.015) return null;
    }
    // Global cap: steal the oldest voice of lower (or equal) priority
    if (this.voices.length >= this.maxVoices) {
      const prio = def.prio ?? 2;
      let victim = null;
      for (const v of this.voices) if (v.prio <= prio && (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0))) victim = v;
      if (!victim) return null;
      this._kill(victim, 0.015);
    }
    if (def.gainVar) vol *= 1 - Math.random() * def.gainVar;
    const pr = def.pitch ? def.pitch[0] + Math.random() * (def.pitch[1] - def.pitch[0]) : 1;
    const p = opts.pitch ?? 1;
    const list = this.sfxBuf.get(def.g || name);
    if (LOWMEM) this._wantSfx(def.g || name);
    const rate = (list ? (def.pmap ? 1 + (p - def.pmap[0]) * def.pmap[1] : p) : p) * pr;
    const when = now + 0.004 + (opts.delay || 0);
    const v = list ? this._sampleVoice(name, def, list, vol, rate, when, opts, dist) : this._recipeVoice(name, def, vol, rate, when, opts, dist);
    if (!v) return null;
    st.count++;
    st.last = now;
    this.voices.push(v);
    if (def.duck) this.duck(def.duck[0], def.duck[1] * (opts.dur ? Math.min(1.4, opts.dur / 2.6) : 1));
    for (const a of def.also || []) if (Math.random() < (a.chance ?? 1)) this.play(a.name, { ...opts, delay: (opts.delay || 0) + a.delay[0] + Math.random() * (a.delay[1] - a.delay[0]), volume: (opts.volume ?? 1) * (a.vol ?? 1), force: false, pitch: 1 });
    return v;
  }

  _chain(def, vol, when, opts, dist) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, when);
    let head = gain;
    let panner = null, air = null, send = null;
    if (opts.x !== undefined && opts.z !== undefined) {
      // Air absorption: far sounds lose their top end
      if (dist > 14) {
        air = ctx.createBiquadFilter();
        air.type = 'lowpass';
        air.frequency.value = Math.max(1400, 20000 * Math.exp(-dist / ((opts.range ?? def.range ?? 90) * 0.9)));
        air.connect(gain);
        head = air;
        this.heldNodes++;
      }
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.rolloffFactor = 0; // distance gain is ours (tuned curve above)
      const y = opts.y ?? def.y ?? 1.2;
      if (panner.positionX) { panner.positionX.value = opts.x; panner.positionY.value = y; panner.positionZ.value = opts.z; } else panner.setPosition(opts.x, y, opts.z);
      gain.connect(panner).connect(this.buses[def.bus] || this.buses.impacts);
    } else gain.connect(this.buses[def.bus] || this.buses.impacts);
    const out = panner || gain;
    if (def.verb || (dist > 40 && def.bus === 'creatures')) {
      send = ctx.createGain();
      send.gain.value = (def.verb || 0) + Math.min(0.25, dist / 400);
      out.connect(send).connect(this.reverbSend);
      this.heldNodes++;
    }
    return { gain, head, panner, air, send };
  }

  _sampleVoice(name, def, list, vol, rate, when, opts, dist) {
    const ctx = this.ctx;
    // Round-robin-ish: random, never the same variation twice in a row
    let idxs = def.pick ? def.pick(opts) : null;
    if (!idxs) idxs = list.map((_, i) => i);
    idxs = idxs.filter((i) => i < list.length);
    if (!idxs.length) idxs = [0];
    const last = this.lastPick.get(name);
    let i = idxs[Math.floor(Math.random() * idxs.length)];
    if (idxs.length > 1 && i === last) i = idxs[(idxs.indexOf(i) + 1) % idxs.length];
    this.lastPick.set(name, i);
    const { buffer, offset } = list[i];
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const c = this._chain(def, vol, when, opts, dist);
    src.connect(c.head);
    src.start(when, offset);
    const v = { name, prio: def.prio ?? 2, t0: when, src, gain: c.gain, panner: c.panner, air: c.air, send: c.send, follow: opts.follow || null, dead: false };
    src.onended = () => this._release(v);
    // stop() before the scheduled start does not fire onended, and a stolen voice would otherwise leave its
    // air filter and reverb send connected. The timer is the backstop; onended usually wins and cancels it.
    const dur = Math.max(0.05, (buffer.duration - Math.min(offset || 0, buffer.duration)) / Math.max(0.2, Math.abs(rate) || 1));
    v.timer = setTimeout(() => this._release(v), (dur + 1 + Math.max(0, when - ctx.currentTime)) * 1000);
    return v;
  }

  _recipeVoice(name, def, vol, rate, when, opts, dist) {
    const r = RECIPES[def.proc || name] || RECIPES[name];
    if (!r) return null;
    const c = this._chain(def, vol, when, opts, dist);
    const dur = r.fn(this.proc, c.head, when + 0.001, rate, opts) || 0.5;
    const v = { name, prio: def.prio ?? 2, t0: when, src: null, gain: c.gain, panner: c.panner, air: c.air, send: c.send, follow: opts.follow || null, dead: false };
    v.timer = setTimeout(() => this._release(v), (dur + 0.25) * 1000 + (when - this.ctx.currentTime) * 1000);
    return v;
  }

  _kill(v, fade = 0.03) {
    if (v.dead) return;
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + fade);
    clearTimeout(v.timer);
    if (v.src) { try { v.src.stop(t + fade + 0.01); } catch { /* not started: onended will not fire */ } }
    v.timer = setTimeout(() => this._release(v), (fade + 0.08) * 1000);
    this._release(v, true);
  }

  /** Bookkeeping when a voice ends (or is stolen: `soft` keeps the nodes until the fade has finished) */
  _release(v, soft = false) {
    if (!v.dead) {
      v.dead = true;
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
      const st = this.byName.get(v.name);
      if (st) st.count = Math.max(0, st.count - 1);
    }
    if (soft) return;
    clearTimeout(v.timer);
    this.heldNodes = Math.max(0, this.heldNodes - disconnectVoice(v));
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Positional loops (stampede of a charging Hornwall, …): key → voice that follows an object with x/z
  loopStart(key, name, opts = {}) {
    if (!this.ctx || this.loopVoices.has(key) || this.ctx.state !== 'running') return;
    const list = this.sfxBuf.get(name);
    if (LOWMEM) this._wantSfx(name);
    if (!list) return;
    const def = SFX[name] || { bus: 'creatures', range: 110 };
    const ctx = this.ctx;
    const { buffer, offset } = list[0];
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true; src.loopStart = offset; src.loopEnd = buffer.duration;
    const L = this.listener;
    const f = opts.follow || opts;
    const c = this._chain(def, 0, ctx.currentTime, { x: f.x, z: f.z, range: opts.range }, Math.hypot(f.x - L.x, f.z - L.z));
    c.gain.gain.setTargetAtTime(opts.volume ?? 0.6, ctx.currentTime, 0.15);
    src.connect(c.head);
    src.start(ctx.currentTime, offset + Math.random() * (buffer.duration - offset) * 0.9);
    this.loopVoices.set(key, { src, gain: c.gain, panner: c.panner, air: c.air, send: c.send, follow: opts.follow, vol: opts.volume ?? 0.6, range: opts.range ?? 110 });
  }

  loopStop(key, fade = 0.4) {
    const v = this.loopVoices.get(key);
    if (!v) return;
    this.loopVoices.delete(key);
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, fade / 3);
    v.src.stop(t + fade + 0.1);
    setTimeout(() => { this.heldNodes = Math.max(0, this.heldNodes - disconnectVoice(v)); }, (fade + 0.3) * 1000);
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Continuous loops: engine (follows speed), flamer, wind — set every frame
  _buildLoops() {
    const ctx = this.ctx;
    const amb = this.buses.ambience;
    // Engine: detuned saw + square sub through a resonant lowpass that follows the revs, plus road noise
    const eg = ctx.createGain(); eg.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 2.5;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 50;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 25.3;
    const o2g = ctx.createGain(); o2g.gain.value = 0.5;
    o1.connect(lp); o2.connect(o2g).connect(lp);
    lp.connect(eg).connect(amb);
    o1.start(); o2.start();
    const road = ctx.createBufferSource(); road.buffer = this.proc.brown; road.loop = true;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 500;
    const rg = ctx.createGain(); rg.gain.value = 0;
    road.connect(rlp).connect(rg).connect(amb); road.start();
    this.loops.engine = { gain: eg, filter: lp, o1, o2, road: rg };
    // Flamer: filtered noise until the sample loop has decoded
    const fg = ctx.createGain(); fg.gain.value = 0;
    const fn = ctx.createBufferSource(); fn.buffer = this.proc.noise; fn.loop = true;
    const fbp = ctx.createBiquadFilter(); fbp.type = 'bandpass'; fbp.frequency.value = 900; fbp.Q.value = 0.6;
    fn.connect(fbp).connect(fg).connect(this.buses.weapons);
    fn.start();
    this.loops.flamer = { gain: fg, src: fn };
    // Wind / speed rush
    const wg = ctx.createGain(); wg.gain.value = 0;
    const wn = ctx.createBufferSource(); wn.buffer = this.proc.noise; wn.loop = true;
    const whp = ctx.createBiquadFilter(); whp.type = 'bandpass'; whp.frequency.value = 1500; whp.Q.value = 0.4;
    wn.connect(whp).connect(wg).connect(amb);
    wn.start();
    this.loops.wind = { gain: wg, filter: whp };
    // Minigun body: one noise loop, one low saw, one square LFO. Created once — never per shot.
    // WebKit has been fine with the engine loops; this one is the same pattern.
    const mg = ctx.createGain(); mg.gain.value = 0;
    const mn = ctx.createBufferSource(); mn.buffer = this.proc.noise; mn.loop = true;
    const mbp = ctx.createBiquadFilter(); mbp.type = 'bandpass'; mbp.frequency.value = 1800; mbp.Q.value = 0.7;
    const chop = ctx.createGain(); chop.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 22;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.4;
    lfo.connect(lfoG).connect(chop.gain);
    const mo = ctx.createOscillator(); mo.type = 'sawtooth'; mo.frequency.value = 74;
    const moG = ctx.createGain(); moG.gain.value = 0.28;
    mn.connect(mbp).connect(chop).connect(mg);
    mo.connect(moG).connect(mg);
    mg.connect(this.buses.weapons);
    mn.start(); lfo.start(); mo.start();
    this.loops.minigun = { gain: mg, lfo };
  }

  _sampleFlamer() {
    const f = this.loops.flamer;
    const s = this.sfxBuf.get('flamer_loop')?.[0];
    if (!f || !s) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer; src.loop = true; src.loopStart = s.offset; src.loopEnd = s.buffer.duration;
    const g = ctx.createGain(); g.gain.value = 1.6;
    src.connect(g).connect(f.gain);
    src.start(ctx.currentTime, s.offset);
    try { f.src.stop(); f.src.disconnect(); } catch { /* ignore */ }
    if (f.sample) { try { f.sample.disconnect(); } catch { /* ignore */ } }
    if (f.sampleGain) { try { f.sampleGain.disconnect(); } catch { /* ignore */ } }
    f.sample = src;
    f.sampleGain = g;
  }

  updateLoops(speed, boosting, flamer, active, spin = 0) {
    if (!this.ctx || !this.loops.engine) return;
    this.loopsActive = active; // positional loops (stampede) fall silent while paused / levelling up / dead
    const t = this.ctx.currentTime;
    const e = this.loops.engine;
    const rev = 38 + speed * 3.2 + (boosting ? 25 : 0);
    e.o1.frequency.setTargetAtTime(rev, t, 0.08);
    e.o2.frequency.setTargetAtTime(rev * 0.502, t, 0.08);
    e.filter.frequency.setTargetAtTime(250 + speed * 28 + (boosting ? 900 : 0), t, 0.1);
    e.gain.gain.setTargetAtTime(active ? 0.05 + (boosting ? 0.04 : 0) : 0, t, 0.15);
    e.road.gain.setTargetAtTime(active ? Math.min(0.14, speed * 0.008) : 0, t, 0.2);
    this.loops.flamer.gain.gain.setTargetAtTime(active && flamer ? 0.14 : 0, t, 0.08);
    this.loops.wind.gain.gain.setTargetAtTime(active ? Math.min(0.09, speed * 0.0025) + (boosting ? 0.1 : 0) : 0, t, 0.2);
    this.loops.wind.filter.frequency.setTargetAtTime(800 + speed * 40, t, 0.2);
    const gun = this.loops.minigun;
    if (gun) {
      gun.gain.gain.setTargetAtTime(active && spin > 0.04 ? 0.04 + spin * 0.16 : 0, t, 0.04);
      gun.lfo.frequency.setTargetAtTime(16 + spin * 20, t, 0.05);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Music
  setMusic(state) {
    this.musicState = state;
    if (!this.ctx) return;
    this.md.set(state);
  }

  setBossPhase(n) { this.md.setBossPhase(n); }

  /** Per frame: music intensity + positional followers. info = { heat, calm, hot } */
  update(dt, info) {
    if (!this.ctx) return;
    this.md.update(dt, info);
    const L = this.listener;
    for (const v of this.voices) {
      if (!v.follow || !v.panner || !v.panner.positionX) continue;
      v.panner.positionX.value = v.follow.rx ?? v.follow.x;
      v.panner.positionZ.value = v.follow.rz ?? v.follow.z;
    }
    for (const lv of this.loopVoices.values()) {
      const f = lv.follow;
      if (!f || !lv.panner) continue;
      const x = f.rx ?? f.x, z = f.rz ?? f.z;
      if (lv.panner.positionX) { lv.panner.positionX.value = x; lv.panner.positionZ.value = z; }
      const d = Math.hypot(x - L.x, z - L.z);
      lv.gain.gain.setTargetAtTime(this.loopsActive === false ? 0 : lv.vol / (1 + (d / (lv.range * 0.35)) ** 2), this.ctx.currentTime, 0.1);
    }
  }

  /** Debug/tests: what's going on */
  stats() {
    const read = (an) => { if (!an) return null; an.getFloatTimeDomainData(this.meterBuf); let p = 0; for (let i = 0; i < this.meterBuf.length; i++) p = Math.max(p, Math.abs(this.meterBuf[i])); return +p.toFixed(3); };
    return {
      peak: read(this.meter), peakPre: read(this.meterPre),
      state: this.ctx?.state || 'none', voices: this.voices.length, loops: this.loopVoices.size, music: this.md.cur?.id || null, musicState: this.md.state,
      sfxLoaded: this.sfxBuf.size, sfxTotal: Object.keys(this.manifest?.sfx || {}).length, musicLoaded: [...this.music.keys()], musicMB: Math.round([...this.music.values()].reduce((t, m) => t + m.buffer.length * m.buffer.numberOfChannels * 4, 0) / 1e6), layer: +this.md.layerLevel.toFixed(2), heat: +this.md.heat.toFixed(2)
    };
  }
}

export { GameAudio, SFX };
