// tools/audio/sheet.js — contact sheet of waveforms + spectrograms for eyeballing rendered sounds (no ears needed):
// envelope shape, length, clipping, where the energy sits in the spectrum.
//   node tools/audio-build.mjs tools/audio/sheet.js '{"files":["assets/audio/sfx/gun_0.mp3",…],"out":".tools/audio-analysis/sheet.png"}'

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export default async function (lab, args) {
  const files = args.files;
  const W = 460, H = 150, cols = args.cols || 3;
  const rows = Math.ceil(files.length / cols);
  const cv = document.createElement('canvas'); cv.width = W * cols; cv.height = H * rows;
  const g = cv.getContext('2d');
  g.fillStyle = '#0c0c0f'; g.fillRect(0, 0, cv.width, cv.height);
  const maxDur = args.maxDur || 0;
  for (let fi = 0; fi < files.length; fi++) {
    const b = await lab.load(files[fi]);
    const d = b.getChannelData(0);
    const x0 = (fi % cols) * W, y0 = Math.floor(fi / cols) * H;
    const dur = maxDur || b.duration;
    // spectrogram (top 90 px), log frequency 40 Hz – 16 kHz
    const N = 1024, hop = Math.max(128, Math.floor((dur * b.sampleRate) / (W - 10)));
    const img = g.createImageData(W - 10, 90);
    for (let x = 0; x < W - 10; x++) {
      const s = x * hop;
      if (s + N >= d.length) break;
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let i = 0; i < N; i++) re[i] = d[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      fft(re, im);
      for (let y = 0; y < 90; y++) {
        const f = 40 * Math.pow(16000 / 40, 1 - y / 89);
        const bin = Math.min(N / 2 - 1, Math.round((f / b.sampleRate) * N));
        const mag = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
        const db = 20 * Math.log10(mag + 1e-9);
        const v = Math.max(0, Math.min(1, (db + 30) / 60));
        const o = (y * (W - 10) + x) * 4;
        img.data[o] = 255 * Math.min(1, v * 1.8); img.data[o + 1] = 255 * Math.max(0, v * 1.6 - 0.5); img.data[o + 2] = 120 * v + 40 * (1 - v); img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, x0 + 5, y0 + 18);
    // waveform (bottom 36 px)
    g.strokeStyle = '#4c9'; g.beginPath();
    const cols2 = W - 10;
    for (let x = 0; x < cols2; x++) {
      const s0 = Math.floor((x / cols2) * dur * b.sampleRate), s1 = Math.floor(((x + 1) / cols2) * dur * b.sampleRate);
      let mx = 0; for (let i = s0; i < Math.min(s1, d.length); i++) mx = Math.max(mx, Math.abs(d[i]));
      g.moveTo(x0 + 5 + x, y0 + 128 - mx * 18); g.lineTo(x0 + 5 + x, y0 + 128 + mx * 18);
    }
    g.stroke();
    let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    g.fillStyle = '#ddd'; g.font = '12px monospace';
    g.fillText(`${files[fi].split('/').pop()}  ${b.duration.toFixed(2)}s  pk ${(20 * Math.log10(pk)).toFixed(1)}dB`, x0 + 5, y0 + 13);
  }
  await window.labFile(args.out || '.tools/audio-analysis/sheet.png', cv.toDataURL('image/png').split(',')[1]);
  return {};
}
