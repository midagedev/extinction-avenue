// js/game/audio-music.js
// Adaptive music director. Cues come from assets/audio/manifest.json (CC0 tracks + two original pieces, see ASSETS.md):
// looping cues play loopStart→loopEnd of a decoded buffer, one-shots play once. Every transition is quantised to the
// running cue's bar (or beat) grid and crossfaded there.
//
//   title            attract loop
//   run              three cues chosen by combat heat: breather ↔ combat ↔ combat_hi (hysteresis + minimum dwell).
//                    `combat` carries an original percussion layer at its exact tempo whose level follows the heat.
//   prebos           the boss-incoming sting; the loop fades out under it
//   boss             phase 1 boss1 · phase 2 boss2_intro → boss2 · phase 3 boss3 (swapped under the phase roar)
//   victory          victory sting, then the results loop
//   continue         countdown loop
//   gameover         game-over jingle, then the results loop
//   results          results loop
// Boss cues are lazy: they load when the run gets close to the boss (or on demand).

const RUN_CUES = ['breather', 'combat', 'combat_hi'];

export class MusicDirector {
  constructor(audio) {
    this.a = audio;
    this.state = 'off';
    this.cur = null; // { id, entry, srcs, gain, layer, t0, len, at, fadeIn, outAt }
    this.old = []; // cues fading out (their fade may still be scheduled on a future bar)
    this.stings = []; // playing one-shots: { id, src, gain }
    this.want = null; // cue id that should be playing (may still be loading)
    this.bossPhase = 1;
    this.heat = 0;
    this.layerLevel = 0;
    this.hotT = 0;
    this.calmT = 0;
    this.runCue = 'combat';
    this.since = 0;
    this.chain = 0; // timer: sting → results
  }

  get ctx() { return this.a.ctx; }
  entry(id) { return this.a.manifest?.music?.[id]; }
  ready(id) { return this.a.isStream(id) || !!this.a.music.get(id); }

  // ------------------------------------------------------------------------------------------------------------------
  /** High-level state from the game (see the header) */
  set(state) {
    if (state === this.state) return;
    // The victory sting / game-over jingle already chain into results
    if (state === 'results' && (this.state === 'victory' || this.state === 'gameover')) return;
    const prev = this.state;
    this.state = state;
    clearTimeout(this.chain);
    if (!this.ctx) return;
    // A one-shot only carries on into the state it leads to (sting → boss, victory / game over → results)
    if (state !== 'boss' && state !== 'results') this.stopStingers();
    switch (state) {
      case 'off': this._to(null, { fadeOut: 0.8 }); break;
      case 'title': this._to('title', { quant: 'now', fadeIn: 1.2, fadeOut: 0.8 }); break;
      case 'run': {
        // A fresh run opens on the breather (the roll-out is calm); a continue drops straight back into the fight
        this.runCue = prev === 'continue' || prev === 'boss' || prev === 'prebos' ? 'combat' : 'breather';
        this.calmT = this.runCue === 'breather' ? 3 : 0;
        this.since = 0;
        this._to(this.runCue, { quant: prev === 'continue' || prev === 'title' ? 'now' : 'bar', fadeIn: prev === 'title' ? 0.4 : 0.15, fadeOut: 0.8 });
        break;
      }
      case 'prebos':
        this._to(null, { quant: 'bar', fadeOut: 2.5 });
        this.a.loadMusic(['boss1', 'boss2_intro', 'boss2', 'boss3']);
        this.stinger('boss_sting', { at: 'beat' });
        break;
      case 'boss': this._to(this._bossCue(), { quant: 'now', fadeIn: 0.05, fadeOut: 0.3 }); break;
      case 'continue': this._to('continue', { quant: 'now', fadeIn: 0.3, fadeOut: 0.4 }); break;
      case 'victory': {
        this._to(null, { quant: 'beat', fadeOut: 0.25 });
        const len = this.stinger('victory', { at: 'beat' });
        this._chainTo('results', Math.max(1, len - 0.6));
        break;
      }
      case 'gameover': {
        this._to(null, { quant: 'now', fadeOut: 0.3 });
        const len = this.stinger('gameover', { at: 'now' });
        this._chainTo('results', Math.max(1, len - 0.3));
        break;
      }
      case 'results': this._to('results', { quant: 'now', fadeIn: 1.5, fadeOut: 1 }); break;
    }
  }

  /** Real-time chain (works without frame updates, e.g. while the game is paused) */
  _chainTo(state, seconds) {
    const from = this.state;
    this.chain = setTimeout(() => { if (this.state === from) { this.state = 'chain'; this.set(state); } }, seconds * 1000);
  }

  setBossPhase(n) {
    if (n === this.bossPhase) return;
    this.bossPhase = n;
    if (this.state === 'boss' && this.ctx) this._to(this._bossCue(), { quant: 'beat', fadeIn: 0.05, fadeOut: 0.35 });
  }

  _bossCue() {
    const id = this.bossPhase >= 3 ? 'boss3' : this.bossPhase === 2 ? 'boss2' : 'boss1';
    if (this.ready(id)) return id;
    // Not loaded yet: keep the heaviest combat cue going meanwhile
    this.a.loadMusic([id]);
    return this.ready('combat_hi') ? 'combat_hi' : 'combat';
  }

  /** A one-shot over everything (boss sting, victory, game over). Returns its length in seconds. */
  stinger(id, { at = 'now', gain = 1 } = {}) {
    const buf = this.a.music.get(id);
    if (!buf) { this.a.loadMusic([id]); return 2; }
    const ctx = this.ctx;
    const when = at === 'beat' ? this._nextGrid('beat') : ctx.currentTime + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = buf.buffer;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.a.stingBus);
    src.start(when, buf.offset);
    const st = { id, src, gain: g };
    this.stings.push(st);
    this.a.musicUsed.set(id, performance.now());
    src.onended = () => { try { g.disconnect(); } catch { /* gone */ } this.stings = this.stings.filter((s) => s !== st); };
    return buf.buffer.duration - buf.offset + (when - ctx.currentTime);
  }

  /** Fade out any playing one-shot (e.g. "Again" pressed while the game-over jingle still plays) */
  stopStingers(fade = 0.3) {
    const t = this.ctx.currentTime;
    for (const s of this.stings) {
      s.gain.gain.cancelScheduledValues(t);
      s.gain.gain.setValueAtTime(s.gain.gain.value, t);
      s.gain.gain.linearRampToValueAtTime(0, t + fade);
      try { s.src.stop(t + fade + 0.02); } catch { /* not started */ }
    }
    this.stings = [];
  }

  // ------------------------------------------------------------------------------------------------------------------
  /** Per frame: info = { heat 0–1, calm bool, hot bool } (only used in the run state) */
  update(dt, info) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // A wanted cue finished loading → start it
    if (this.want && (!this.cur || this.cur.id !== this.want) && this.ready(this.want)) this._to(this.want, { quant: 'now', fadeIn: 0.4, fadeOut: 0.6 });
    if (this.state === 'boss' && this.cur && this.cur.id !== this._bossCueId() && this.ready(this._bossCueId())) this._to(this._bossCueId(), { quant: 'bar', fadeIn: 0.1, fadeOut: 0.5 });
    if (info) {
      this.heat += ((info.heat || 0) - this.heat) * Math.min(1, dt / 1.2);
      this.calmHint = info.calm;
      if (this.state === 'run') this._runLogic(dt, info);
    }
    // Heat layer on the combat cue
    const c = this.cur;
    if (c && c.id === 'combat' && c.stream) {
      if (!c.layer) { if (this.a.music.has('combat_heat')) this._attachLayer(c); } else this._syncLayer(c, dt);
    }
    if (c && c.layer) {
      const target = c.id === 'combat' ? smooth((this.heat - 0.35) / 0.45) * 0.95 : 0;
      this.layerLevel += (target - this.layerLevel) * Math.min(1, dt * 1.5);
      c.layer.gain.gain.setTargetAtTime(this.layerLevel, now, 0.1);
    }
  }

  _bossCueId() { return this.bossPhase >= 3 ? 'boss3' : this.bossPhase === 2 ? 'boss2' : 'boss1'; }

  _runLogic(dt, info) {
    this.since += dt;
    this.hotT = info.hot || this.heat > 0.8 ? this.hotT + dt : Math.max(0, this.hotT - dt * 2);
    this.calmT = info.calm ? this.calmT + dt : 0;
    let want = 'combat';
    if (this.calmT > 2.5) want = 'breather';
    else if (info.hot || this.hotT > 6) want = 'combat_hi';
    if (want === this.runCue) return;
    // Minimum dwell (shorter when things blow up)
    const dwell = want === 'combat_hi' && info.hot ? 3 : want === 'breather' ? 10 : 12;
    if (this.since < dwell || !this.ready(want)) { if (!this.ready(want)) this.a.loadMusic([want]); return; }
    this.runCue = want;
    this.since = 0;
    this._to(want, { quant: 'bar', fadeIn: 0.12, fadeOut: want === 'breather' ? 1.6 : 0.6 });
  }

  // ------------------------------------------------------------------------------------------------------------------
  /** Next bar / beat boundary of the playing cue (or now) */
  _nextGrid(kind) {
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.06;
    const c = this.cur;
    if (!c || !c.entry.bpm) return now;
    const beat = 60 / c.entry.bpm;
    const unit = kind === 'bar' ? beat * (c.entry.beatsPerBar || 4) : beat;
    const k = Math.ceil((now - c.t0 - (c.entry.firstBeat || 0)) / unit);
    let t = c.t0 + (c.entry.firstBeat || 0) + k * unit;
    // Very slow bars: settle for the next beat instead of waiting
    if (t - now > 2.4) t = c.t0 + (c.entry.firstBeat || 0) + Math.ceil((now - c.t0) / beat) * beat;
    return Math.max(now, t);
  }

  /** Crossfade to cue `id` (null = silence) at the quantised time */
  _to(id, { quant = 'bar', fadeIn = 0.1, fadeOut = 0.5 } = {}) {
    const ctx = this.ctx;
    this.want = id;
    if (this.cur && this.cur.id === id) return;
    if (id && !this.ready(id)) { this.a.loadMusic([id]); if (!this.cur) return; }
    const when = quant === 'now' ? ctx.currentTime + 0.03 : this._nextGrid(quant);
    // Fade out whatever plays now, and bring forward fades still waiting for a later bar
    for (const o of this.old) if (o.outAt > when) this._fadeOut(o, when, Math.min(fadeOut, 0.5));
    if (this.cur) {
      this._fadeOut(this.cur, when, fadeOut);
      this.cur = null;
    }
    if (!id || !this.ready(id)) return;
    this.cur = this._start(id, when, fadeIn);
  }

  /** Fade cue `c` out from `when` (a cue that hasn't started by then is dropped outright) */
  _fadeOut(c, when, fadeOut) {
    const ctx = this.ctx;
    const g = c.gain.gain;
    const stopAll = (t) => { for (const s of c.srcs) { try { s.stop(t); } catch { /* not started */ } } };
    clearTimeout(c.disc);
    if (when <= c.at) {
      g.cancelScheduledValues(0);
      g.setValueAtTime(0, ctx.currentTime);
      stopAll(ctx.currentTime);
      c.outAt = ctx.currentTime;
    } else {
      // Level at `when` along the fade-in ramp (reading gain.value would give the level now, not then)
      const level = Math.max(0, Math.min(1, (when - c.at) / c.fadeIn));
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(when); // keeps a fade-in that is still ramping intact up to `when`
      else g.cancelScheduledValues(when);
      g.setValueAtTime(level, when);
      g.linearRampToValueAtTime(0, when + fadeOut);
      stopAll(when + fadeOut + 0.05);
      c.outAt = when;
    }
    if (!this.old.includes(c)) this.old.push(c);
    c.disc = setTimeout(() => {
      try { c.gain.disconnect(); } catch { /* gone */ }
      this.old = this.old.filter((o) => o !== c);
    }, (c.outAt - ctx.currentTime + fadeOut + 0.3) * 1000);
  }

  _start(id, when, fadeIn) {
    const ctx = this.ctx;
    const m = this.a.music.get(id);
    const e = this.entry(id);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + Math.max(0.01, fadeIn));
    gain.connect(this.a.musicBus);
    const srcs = [];
    let len = 0, t0 = when;
    // Chained intro (boss2_intro → boss2)
    const intro = id === 'boss2' && this.a.music.get('boss2_intro');
    let loopAt = when;
    if (intro) {
      const s = ctx.createBufferSource();
      s.buffer = intro.buffer;
      s.connect(gain);
      s.start(when, intro.offset);
      srcs.push(s);
      loopAt = when + intro.buffer.duration - intro.offset - 0.002;
    }
    // Phones: long loops stream from an <audio> element (GameAudio.streamSource); the heat layer follows its clock
    const stream = this.a.isStream(id);
    const s = stream ? this.a.streamSource(e) : ctx.createBufferSource();
    if (stream) {
      len = e.loopEnd - e.loopStart;
      s.start(loopAt);
    } else if (e.loop) {
      s.buffer = m.buffer;
      s.loop = true;
      s.loopStart = e.loopStart + m.offset;
      s.loopEnd = e.loopEnd + m.offset;
      len = e.loopEnd - e.loopStart;
      s.start(loopAt, e.loopStart + m.offset);
    } else {
      s.buffer = m.buffer;
      s.start(loopAt, m.offset);
    }
    s.connect(gain);
    srcs.push(s);
    t0 = loopAt;
    const cue = { id, entry: e, srcs, gain, t0, len, layer: null, at: when, fadeIn: Math.max(0.01, fadeIn), outAt: Infinity, stream: stream ? s : null };
    this.a.musicUsed.set(id, performance.now());
    if (intro) this.a.musicUsed.set('boss2_intro', performance.now());
    // Heat layer: same tempo, 4-bar loop that divides the combat loop exactly → started on the same grid
    if (id === 'combat') this._attachLayer(cue);
    return cue;
  }

  /** Phase (s into the 4-bar layer loop) the layer should be at, ctx time `at`; null while a stream isn't playing */
  _layerPhase(cue, at, llen) {
    if (!cue.stream) return (((at - cue.t0) % llen) + llen) % llen;
    const t = cue.stream.time;
    if (t === null) return null;
    const pos = t - cue.entry.loopStart + (at - this.ctx.currentTime);
    return ((pos % llen) + llen) % llen;
  }

  _attachLayer(cue) {
    const L = this.a.music.get('combat_heat');
    const le = this.entry('combat_heat');
    if (!L || !le) { this.a.loadMusic(['combat_heat']); return; }
    const ctx = this.ctx;
    const llen = le.loopEnd - le.loopStart;
    const start = Math.max(cue.t0, ctx.currentTime + 0.05);
    const pos = this._layerPhase(cue, start, llen);
    if (pos === null) return; // streamed cue not playing yet: update() retries
    let lg = cue.layer?.gain;
    if (!lg) {
      lg = ctx.createGain();
      lg.gain.value = this.layerLevel;
      lg.connect(cue.gain);
    }
    const s = ctx.createBufferSource();
    s.buffer = L.buffer;
    s.loop = true;
    s.loopStart = le.loopStart + L.offset;
    s.loopEnd = le.loopEnd + L.offset;
    s.start(start, le.loopStart + L.offset + pos);
    s.connect(lg);
    cue.srcs.push(s);
    cue.layer = { src: s, gain: lg, t0: start - pos, llen, checkT: 2 };
  }

  /** Phones: the streamed combat loop runs on the <audio> element's clock (and re-seeks at its loop point); every 2 s
   *  the layer is re-started on its phase if it drifted by more than 35 ms (while it is quiet, if possible) */
  _syncLayer(cue, dt) {
    const ly = cue.layer;
    if ((ly.checkT -= dt) > 0) return;
    ly.checkT = 2;
    const now = this.ctx.currentTime;
    const want = this._layerPhase(cue, now, ly.llen);
    if (want === null) return;
    const have = (((now - ly.t0) % ly.llen) + ly.llen) % ly.llen;
    let err = Math.abs(want - have);
    err = Math.min(err, ly.llen - err);
    if (err < 0.035 || (err < 0.12 && this.layerLevel > 0.15)) return;
    try { ly.src.stop(now + 0.06); } catch { /* already stopped */ }
    cue.srcs = cue.srcs.filter((x) => x !== ly.src);
    this._attachLayer(cue);
  }

  /** The layer finished loading after the combat cue started */
  onLoaded(id) {
    if (id === 'combat_heat' && this.cur && this.cur.id === 'combat' && !this.cur.layer) this._attachLayer(this.cur);
    // The cue we were waiting for: start it right away (don't wait for the next frame update)
    if (this.want === id && (!this.cur || this.cur.id !== id)) this._to(id, { quant: this.cur ? 'bar' : 'now', fadeIn: 0.4, fadeOut: 0.6 });
    if (this.state === 'boss' && id === this._bossCueId() && this.cur && this.cur.id !== id) this._to(id, { quant: 'bar', fadeIn: 0.1, fadeOut: 0.5 });
  }
}

const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export { RUN_CUES };
