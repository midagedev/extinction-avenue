// js/game/highlight.js
// A short clip of the canvas, plus a poster card that always works.
// Desktop (not the phone profile) keeps a rolling ~15 s segment. Phones do not encode in the
// background — MediaRecorder plus a 2.2× canvas is a good way to get the tab killed — and instead
// record one shot when a set piece or the finale starts, if the browser can. Everywhere else the
// results card is the thing you screenshot. No per-frame font strings, no shadowBlur.

const ROLL_MS = 15000;
const SHOT_S = 14;

function pickMime() {
  const MR = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
  if (!MR) return '';
  const list = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return list.find((m) => { try { return MR.isTypeSupported(m); } catch { return false; } }) || '';
}

class HighlightReel {
  constructor(game, { disabled = false, lowmem = false } = {}) {
    this.game = game;
    this.disabled = disabled;
    this.lowmem = lowmem;
    this.rolling = false;
    this.rec = null;
    this.chunks = [];
    this.stream = null;
    this.segStart = 0;
    this.lastBlob = null;
    this.mime = '';
    this.can = false;
    this._rotateT = 0;
    if (!disabled) {
      try {
        const probe = document.createElement('canvas');
        this.can = !!(probe.captureStream && pickMime());
        this.mime = pickMime();
      } catch { this.can = false; }
    }
  }

  /** Desktop only: a rolling segment, restarted from _beginPlay. */
  beginRolling() {
    if (this.disabled || this.lowmem || !this.can || this.rolling) return;
    this.rolling = true;
    this._open(true);
  }

  /**
   * Phone (and a manual CLIP tap): start a one-shot.
   * 'whoa' does nothing if a clip is already cooking. 'finale' replaces it so the ending is what you keep.
   */
  mark(kind = 'whoa') {
    if (this.disabled || !this.can || this.rolling) return;
    if (kind !== 'finale' && (this.rec || this.lastBlob)) return;
    if (this.rec) this._close(true, () => this._open(false));
    else this._open(false);
  }

  /** Call when the run ends so the in-progress segment is the one on the results card. */
  cut() {
    if (this.disabled) return;
    this._close(true);
    this.rolling = false;
  }

  update(dt) {
    if (this.rec && !this.rolling && this._limit && (performance.now() - this.segStart) / 1000 >= this._limit) {
      this._close(true);
      return;
    }
    if (!this.rolling || !this.rec) return;
    this._rotateT += dt;
    if (this._rotateT < ROLL_MS / 1000) return;
    this._rotateT = 0;
    this._close(true, () => { if (this.rolling) this._open(true); });
  }

  _canvas() {
    return this.game.world?.renderer?.domElement || null;
  }

  _open(roll) {
    const canvas = this._canvas();
    if (!canvas?.captureStream || !this.mime) return;
    try {
      const stream = canvas.captureStream(this.lowmem ? 12 : 20);
      const rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: this.lowmem ? 1200000 : 2200000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start();
      this.stream = stream;
      this.rec = rec;
      this.chunks = chunks;
      this.segStart = performance.now();
      this._limit = roll ? 0 : SHOT_S;
    } catch {
      this.can = false;
      this._stopTracks();
    }
  }

  _close(keep, then) {
    const rec = this.rec;
    if (!rec) { then?.(); return; }
    const chunks = this.chunks;
    const mime = this.mime;
    const started = this.segStart;
    this.rec = null;
    this.chunks = [];
    const finish = () => {
      const dur = (performance.now() - started) / 1000;
      if (keep && dur >= 3 && chunks.length) this.lastBlob = new Blob(chunks, { type: mime || 'video/webm' });
      this._stopTracks();
      then?.();
    };
    rec.onstop = finish;
    try {
      if (rec.state !== 'inactive') rec.stop();
      else finish();
    } catch {
      this._stopTracks();
      then?.();
    }
    // Some WebKit builds never fire onstop. Drop the tracks either way; the blob is best-effort.
    setTimeout(() => this._stopTracks(), 1500);
  }

  _stopTracks() {
    const s = this.stream;
    this.stream = null;
    if (!s) return;
    for (const t of s.getTracks()) { try { t.stop(); } catch { /* gone */ } }
  }

  async shareClip() {
    if (this.rec) this._close(true);
    const blob = this.lastBlob;
    if (!blob) return this.shareCard();
    const name = `extinction-avenue.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
    const file = new File([blob], name, { type: blob.type || 'video/webm' });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: 'EXTINCTION AVENUE', text: this.game.shareText() });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  shareCard() {
    const blob = this.cardBlob();
    if (!blob) return;
    const file = new File([blob], 'extinction-avenue.png', { type: 'image/png' });
    const go = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'extinction-avenue.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    if (navigator.share) {
      navigator.share({ files: [file], title: 'EXTINCTION AVENUE', text: this.game.shareText() }).catch((err) => {
        if (!err || err.name !== 'AbortError') go();
      });
    } else go();
  }

  /** Poster. A handful of integer font sizes, set once per export — not per frame. */
  cardBlob() {
    const r = this.game.lastResult;
    if (!r) return null;
    const c = document.createElement('canvas');
    c.width = 1080;
    c.height = 1350;
    const x = c.getContext('2d');
    x.fillStyle = '#07090f';
    x.fillRect(0, 0, 1080, 1350);
    x.fillStyle = '#14100c';
    x.fillRect(0, 0, 1080, 280);
    x.fillStyle = '#ff6a1a';
    x.fillRect(0, 280, 1080, 10);
    x.fillStyle = '#ffb02e';
    x.font = '700 28px sans-serif';
    x.textAlign = 'center';
    x.fillText('A CRETAGEN INCIDENT', 540, 90);
    x.fillStyle = '#ffffff';
    x.font = '400 132px sans-serif';
    x.fillText('EXTINCTION', 540, 230);
    x.font = '400 84px sans-serif';
    x.fillStyle = '#0c6b47';
    x.fillRect(250, 300, 580, 110);
    x.fillStyle = '#ffffff';
    x.fillText('AVENUE', 540, 382);
    x.fillStyle = '#ffb02e';
    x.font = '700 36px sans-serif';
    x.fillText(r.stageName || 'MIDTOWN', 540, 500);
    x.fillStyle = '#ffffff';
    x.font = '400 92px sans-serif';
    const title = (r.title || 'GAME OVER').slice(0, 18);
    x.fillText(title, 540, 620);
    if (r.stars) {
      x.font = '400 72px sans-serif';
      x.fillStyle = '#ffc21a';
      x.fillText('★'.repeat(r.stars) + '☆'.repeat(Math.max(0, 3 - r.stars)), 540, 720);
    }
    x.fillStyle = '#ffb02e';
    x.font = '700 28px sans-serif';
    x.fillText('SCORE', 540, 830);
    x.fillStyle = '#ffffff';
    x.font = '400 120px sans-serif';
    x.fillText(Math.round(r.score || 0).toLocaleString('en-US'), 540, 960);
    x.font = '700 32px sans-serif';
    x.fillStyle = '#c9d0dc';
    const line = `${r.kills || 0} FOSSILIZED   ·   ${r.headshots || 0} HEADSHOTS   ·   ${r.maxCombo || 0}x`;
    x.fillText(line, 540, 1060);
    x.font = '700 28px sans-serif';
    x.fillStyle = '#8b93a3';
    x.fillText('Rush hour just went Cretaceous', 540, 1220);
    x.fillText('midagedev.github.io/extinction-avenue', 540, 1280);
    let blob = null;
    try {
      const url = c.toDataURL('image/png');
      const bin = atob(url.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: 'image/png' });
    } catch { blob = null; }
    return blob;
  }
}

export { HighlightReel };
