// tools/audio/lab.js
// Page-side helpers for the offline audio build (tools/audio-build.mjs runs this page in headless Chromium):
// render a WebAudio graph with an OfflineAudioContext, decode CC0 source files, measure loudness, normalise, and hand
// finished PCM back to Node (which encodes MP3 and writes it into the repo).

const SR = 44100;

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const lab = {
  SR,

  /** Render `seconds` of audio; `build(ctx, dest)` schedules everything on the offline context */
  async render(seconds, build, { channels = 2, sampleRate = SR } = {}) {
    const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate);
    await build(ctx, ctx.destination);
    return ctx.startRendering();
  },

  /** Fetch + decode an audio file (served from the repo root, e.g. '.tools/dl/audio/…') at 44.1 kHz */
  async load(url) {
    const res = await fetch('/' + url.replace(/^\//, '').split('/').map(encodeURIComponent).join('/'));
    if (!res.ok) throw new Error(`load ${url}: ${res.status}`);
    const data = await res.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 1, SR);
    return ctx.decodeAudioData(data);
  },

  /** Peak (dBFS), RMS (dBFS) and an approximate integrated loudness (K-weighted, 400 ms blocks, −70/−10 gates) */
  async measure(buf) {
    let peak = 0, sum = 0, n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
      n += d.length;
    }
    // K-weighting through biquads (shelf + highpass), then gated block loudness
    const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const sh = ctx.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = 1500; sh.gain.value = 4;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
    src.connect(sh).connect(hp).connect(ctx.destination);
    src.start();
    const k = await ctx.startRendering();
    const blk = Math.floor(0.4 * buf.sampleRate), hop = Math.floor(0.1 * buf.sampleRate);
    const blocks = [];
    for (let s = 0; s + blk <= k.length; s += hop) {
      let e = 0;
      for (let c = 0; c < k.numberOfChannels; c++) { const d = k.getChannelData(c); for (let i = s; i < s + blk; i++) e += d[i] * d[i]; }
      blocks.push(e / blk);
    }
    const L = (ms) => -0.691 + 10 * Math.log10(ms + 1e-12);
    let g = blocks.filter((b) => L(b) > -70);
    const rel = L(g.reduce((a, b) => a + b, 0) / Math.max(1, g.length)) - 10;
    g = g.filter((b) => L(b) > rel);
    const lufs = g.length ? L(g.reduce((a, b) => a + b, 0) / g.length) : -99;
    return { peak: 20 * Math.log10(peak + 1e-12), rms: 10 * Math.log10(sum / n + 1e-12), lufs, dur: buf.duration };
  },

  /** Copy/scale/trim a buffer: { gain, trimStart (threshold dB), trimEnd (dB), fadeOut (s), mono, start, end } */
  shape(buf, o = {}) {
    const chans = o.mono ? 1 : buf.numberOfChannels;
    let s0 = Math.floor((o.start || 0) * buf.sampleRate);
    let s1 = o.end ? Math.min(buf.length, Math.floor(o.end * buf.sampleRate)) : buf.length;
    const amp = (i) => { let a = 0; for (let c = 0; c < buf.numberOfChannels; c++) a = Math.max(a, Math.abs(buf.getChannelData(c)[i])); return a; };
    if (o.trimStart !== undefined) { const th = 10 ** (o.trimStart / 20); while (s0 < s1 && amp(s0) < th) s0++; s0 = Math.max(0, s0 - Math.floor(0.002 * buf.sampleRate)); }
    if (o.trimEnd !== undefined) { const th = 10 ** (o.trimEnd / 20); while (s1 > s0 + 1 && amp(s1 - 1) < th) s1--; }
    const len = Math.max(1, s1 - s0);
    const out = new AudioBuffer({ numberOfChannels: chans, length: len, sampleRate: buf.sampleRate });
    const gain = o.gain ?? 1;
    const fo = Math.floor((o.fadeOut || 0) * buf.sampleRate);
    for (let c = 0; c < chans; c++) {
      const d = out.getChannelData(c);
      if (o.mono && buf.numberOfChannels > 1) {
        const a = buf.getChannelData(0), b = buf.getChannelData(1);
        for (let i = 0; i < len; i++) d[i] = (a[s0 + i] + b[s0 + i]) * 0.5 * gain;
      } else {
        const a = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
        for (let i = 0; i < len; i++) d[i] = a[s0 + i] * gain;
      }
      for (let i = 0; i < fo && i < len; i++) d[len - 1 - i] *= i / fo;
    }
    return out;
  },

  /** Scale so the sample peak sits at `db` dBFS */
  normalize(buf, db = -1) {
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
    const k = peak > 0 ? 10 ** (db / 20) / peak : 1;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
    return k;
  },

  /** Send a finished buffer to Node: encoded to MP3 at `path` (repo-relative). opts: { kbps, wav } */
  async save(path, buf, opts = {}) {
    const chans = buf.numberOfChannels;
    const n = buf.length;
    const pcm = new Int16Array(n * chans);
    for (let c = 0; c < chans; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) pcm[i * chans + c] = Math.max(-32767, Math.min(32767, Math.round(d[i] * 32767)));
    }
    const stats = await lab.measure(buf);
    await window.labWrite(path, b64(new Uint8Array(pcm.buffer)), chans, buf.sampleRate, opts);
    stats.n = n; // sample count before encoding (the runtime uses it to detect the MP3 codec delay)
    return stats;
  }
};

export { lab };
