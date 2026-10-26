// tools/audio/sfx-util.js — helpers for cutting and layering CC0 source recordings in the offline SFX build.

/** Separate events in a recording: onset where the 5 ms peak envelope crosses `th` dB below the file peak after
 *  `gap` s of quiet; ends after `gap` s below th−20 dB. → [{ t, len, peak (dBFS), zcr (brightness proxy) }] */
export function findEvents(buf, { th = -30, gap = 0.12 } = {}) {
  const sr = buf.sampleRate, n = buf.length, win = Math.floor(sr * 0.005);
  const nw = Math.floor(n / win);
  const env = new Float32Array(nw);
  let P = 0;
  for (let w = 0; w < nw; w++) {
    let m = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = w * win; i < (w + 1) * win; i++) { const a = Math.abs(d[i]); if (a > m) m = a; } }
    env[w] = m; if (m > P) P = m;
  }
  const on = P * 10 ** (th / 20), off = on * 0.1, gw = Math.ceil(gap / 0.005);
  const ev = [];
  let cur = null;
  for (let w = 0; w < nw; w++) {
    if (!cur) {
      if (env[w] > on) { cur = { s: w, pk: env[w], below: 0 }; }
    } else {
      cur.pk = Math.max(cur.pk, env[w]);
      cur.below = env[w] < off ? cur.below + 1 : 0;
      if (cur.below >= gw || w === nw - 1) { ev.push(cur); cur = null; }
    }
  }
  const d0 = buf.getChannelData(0);
  return ev.map((e) => {
    const s = e.s * win;
    let z = 0; const zn = Math.min(Math.floor(sr * 0.1), n - s - 1);
    for (let i = s; i < s + zn; i++) if ((d0[i] >= 0) !== (d0[i + 1] >= 0)) z++;
    return { t: s / sr, len: Math.max(1, findEnd(env, e.s, off, gw)) * 0.005, peak: 20 * Math.log10(e.pk + 1e-9), zcr: z / Math.max(1, zn) };
  });
}

function findEnd(env, s, off, gw) {
  let below = 0;
  for (let w = s; w < env.length; w++) { below = env[w] < off ? below + 1 : 0; if (below >= gw) return w - gw - s + 1; }
  return env.length - s;
}

/** Copy a time range (seconds) to a new mono (or stereo) buffer, with short fades */
export function cut(buf, t, len, { mono = true, fadeIn = 0.0015, fadeOut = 0.02, pre = 0.002 } = {}) {
  const sr = buf.sampleRate;
  const s0 = Math.max(0, Math.floor((t - pre) * sr));
  const s1 = Math.min(buf.length, Math.floor((t + len) * sr));
  const ch = mono ? 1 : Math.min(2, buf.numberOfChannels);
  const out = new AudioBuffer({ numberOfChannels: ch, length: Math.max(1, s1 - s0), sampleRate: sr });
  const fi = Math.floor(fadeIn * sr), fo = Math.floor(fadeOut * sr), L = s1 - s0;
  for (let c = 0; c < ch; c++) {
    const d = out.getChannelData(c);
    if (mono) { for (let k = 0; k < buf.numberOfChannels; k++) { const s = buf.getChannelData(k); for (let i = 0; i < L; i++) d[i] += s[s0 + i] / buf.numberOfChannels; } }
    else d.set(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)).subarray(s0, s1));
    for (let i = 0; i < fi && i < L; i++) d[i] *= i / fi;
    for (let i = 0; i < fo && i < L; i++) d[L - 1 - i] *= i / fo;
  }
  return out;
}

/** Schedule a buffer on an offline context: { rate, gain, lp, hp, bp:[f,q], at, pan, curve (shaper k), from, len, env:[a,hold,r] } */
export function play(ctx, buf, dest, o = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = o.rate ?? 1;
  if (o.rateTo) src.playbackRate.linearRampToValueAtTime(o.rateTo, (o.at || 0) + (o.rateDur ?? buf.duration));
  let node = src;
  const f = (type, fr, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = fr; b.Q.value = q; node = node.connect(b); return b; };
  if (o.hp) f('highpass', o.hp);
  if (o.lp) f('lowpass', o.lp);
  if (o.bp) f('bandpass', o.bp[0], o.bp[1]);
  for (const [type, fr, gain, q] of o.eq || []) { const b = f(type, fr, q ?? 1); b.gain.value = gain; }
  if (o.curve) {
    const w = ctx.createWaveShaper();
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(o.curve * x) / Math.tanh(o.curve); }
    w.curve = c; w.oversample = '4x';
    node = node.connect(w);
  }
  const g = ctx.createGain();
  const at = o.at || 0;
  if (o.env) {
    const [a, hold, r] = o.env;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(o.gain ?? 1, at + a);
    g.gain.setValueAtTime(o.gain ?? 1, at + a + hold); g.gain.linearRampToValueAtTime(0, at + a + hold + r);
  } else g.gain.value = o.gain ?? 1;
  node = node.connect(g);
  if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; node = node.connect(p); }
  node.connect(dest);
  src.start(at, o.from || 0, o.len);
  return src;
}
