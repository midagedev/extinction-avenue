// tools/audio/analyze.js — music analysis for picking/looping tracks without ears:
// tempo (onset autocorrelation, refined over the whole file), beat phase, loudness (integrated + 1 s short-term),
// leading/trailing silence, and a PNG plot (short-term loudness, onset envelope, beat grid) per file.
//   node tools/audio-build.mjs tools/audio/analyze.js '{"files":["…"],"out":".tools/audio-analysis"}'

export default async function (lab, args) {
  const out = args.out || '.tools/audio-analysis';
  const results = {};
  for (const f of args.files) {
    const buf = await lab.load(f);
    const m = await lab.measure(buf);
    const sr = buf.sampleRate;
    const n = buf.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
    // Onset envelope: log energy flux of a crude 2-band split (lows for kicks, highs for snares/hats)
    const hop = 441; // 10 ms
    const frames = Math.floor(n / hop);
    const env = new Float32Array(frames);
    let lo = 0, prevLo = 0, prevHi = 0;
    const ener = new Float32Array(frames);
    for (let k = 0; k < frames; k++) {
      let el = 0, eh = 0;
      for (let i = k * hop; i < (k + 1) * hop; i++) { lo += (mono[i] - lo) * 0.02; el += lo * lo; const h = mono[i] - lo; eh += h * h; }
      const L = Math.log(1e-9 + el), H = Math.log(1e-9 + eh);
      env[k] = Math.max(0, L - prevLo) + Math.max(0, H - prevHi);
      prevLo = L; prevHi = H;
      ener[k] = el + eh;
    }
    // remove local mean
    const w = 30;
    const on = new Float32Array(frames);
    for (let k = 0; k < frames; k++) { let s = 0, c = 0; for (let j = Math.max(0, k - w); j < Math.min(frames, k + w); j++) { s += env[j]; c++; } on[k] = Math.max(0, env[k] - s / c); }
    // Autocorrelation 60–190 BPM
    let best = 0, bestLag = 0;
    const acf = (lag) => { let s = 0; for (let k = 0; k + lag < frames; k++) s += on[k] * on[k + lag]; return s / (frames - lag); };
    const scores = [];
    for (let lag = Math.floor(6000 / 190); lag <= Math.ceil(6000 / 60); lag++) { const s = acf(lag) + 0.5 * acf(lag * 2); scores.push([lag, s]); if (s > best) { best = s; bestLag = lag; } }
    // Refine: comb energy over the whole file for fine BPM steps around the estimate
    const comb = (bpm) => {
      const P = 6000 / bpm; // frames per beat
      let bestPh = 0, bestE = -1;
      for (let ph = 0; ph < P; ph += 0.5) {
        let e = 0, c = 0;
        for (let t = ph; t < frames - 1; t += P) { const i = Math.floor(t), fr = t - i; e += on[i] * (1 - fr) + on[i + 1] * fr; c++; }
        e /= c;
        if (e > bestE) { bestE = e; bestPh = ph; }
      }
      return [bestE, bestPh];
    };
    const est = 6000 / bestLag;
    let bpm = est, ph = 0, eBest = -1;
    for (let b = est * 0.97; b <= est * 1.03; b += est * 0.0005) { const [e, p] = comb(b); if (e > eBest) { eBest = e; bpm = b; ph = p; } }
    // Contrast: comb energy on the grid vs off-grid (half-beat shift) — how confident is the grid?
    const P = 6000 / bpm;
    let onG = 0, offG = 0;
    for (let t = ph; t < frames - P; t += P) { onG += on[Math.round(t)]; offG += on[Math.round(t + P / 2)] || 0; }
    // Downbeat: which of the 4 beats carries most low-band onset energy
    const bars = [0, 0, 0, 0];
    let bi = 0;
    for (let t = ph; t < frames; t += P, bi++) bars[bi % 4] += env[Math.round(t)] || 0;
    const down = bars.indexOf(Math.max(...bars));
    // Short-term loudness (1 s windows, unweighted RMS dB) and silence at the edges
    const st = [];
    for (let s = 0; s < n; s += sr) { let e = 0; const e1 = Math.min(n, s + sr); for (let i = s; i < e1; i++) e += mono[i] * mono[i]; st.push(10 * Math.log10(e / (e1 - s) + 1e-12)); }
    let lead = 0; while (lead < n && Math.abs(mono[lead]) < 0.003) lead++;
    let tail = n - 1; while (tail > 0 && Math.abs(mono[tail]) < 0.003) tail--;
    results[f] = {
      dur: +buf.duration.toFixed(3), sr, ch: buf.numberOfChannels, lufs: +m.lufs.toFixed(1), peak: +m.peak.toFixed(1),
      bpm: +bpm.toFixed(3), firstBeat: +(ph / 100).toFixed(3), gridContrast: +(onG / Math.max(1e-9, offG)).toFixed(2), downbeatIndex: down,
      leadSilence: +(lead / sr).toFixed(3), tailSilence: +((n - 1 - tail) / sr).toFixed(3),
      barsInFile: +((buf.duration - ph / 100) / (240 / bpm)).toFixed(2),
      stStart: st.slice(0, 4).map((x) => Math.round(x)), stEnd: st.slice(-4).map((x) => Math.round(x)), stMin: Math.round(Math.min(...st.slice(1, -1))), stMax: Math.round(Math.max(...st))
    };
    // Plot
    const W = 1400, H = 260;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2a6'; g.beginPath();
    const px = W / frames;
    for (let k = 0; k < frames; k += 2) { const y = H - 20 - Math.min(1, on[k] / 3) * 100; if (k === 0) g.moveTo(k * px, y); else g.lineTo(k * px, y); }
    g.stroke();
    g.strokeStyle = '#fc4'; g.lineWidth = 2; g.beginPath();
    st.forEach((v, i) => { const x = (i / st.length) * W, y = 10 + (-v / 50) * 120; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
    g.stroke();
    g.fillStyle = 'rgba(255,80,80,0.6)';
    for (let t = ph, b = 0; t < frames; t += P * 4, b++) g.fillRect(t * px, 0, 1, H);
    g.fillStyle = '#fff'; g.font = '14px monospace';
    g.fillText(`${f.split('/').slice(-2).join('/')}  ${buf.duration.toFixed(1)}s  ${bpm.toFixed(2)} bpm  LUFS ${m.lufs.toFixed(1)}  contrast ${(onG / offG).toFixed(2)}`, 8, H - 4);
    const png = cv.toDataURL('image/png').split(',')[1];
    const name = f.split('/').slice(-2).join('_').replace(/[^\w.-]+/g, '_');
    await window.labFile(`${out}/${name}.png`, png);
  }
  await window.labFile(`${out}/analysis.json`, btoa(JSON.stringify(results, null, 1)));
  return { log: results };
}
