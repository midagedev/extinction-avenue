// js/game/input.js
// Keyboard + mouse (aim with the mouse, hold the left button to fire the Roof Cannon) and a touch fallback (left-thumb
// steering stick, auto-fire with aim assist, tap the street to aim, on-screen NITRO / SKYHAMMER / PAUSE buttons).

class Input {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight * 0.4, down: false, moved: false };
    this.touchMode = false;
    this.steer = 0;
    this.stick = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
    this.touchAim = { id: null };
    this.touchBoost = false;
    this.onAction = null; // (name) => void: 'pause', 'special', 'mute', 'pick1'..'pick3', 'reroll', 'confirm'
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      const act = {
        Escape: 'pause', KeyP: 'pause', Space: 'special', KeyE: 'special', KeyQ: 'special', KeyM: 'mute',
        Digit1: 'pick1', Digit2: 'pick2', Digit3: 'pick3', Digit4: 'pick4', KeyR: 'reroll', Enter: 'confirm', KeyF: 'autofire'
      }[e.code];
      if (act && !e.repeat) this.onAction?.(act, e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.moved = true;
      if (this.touchMode && e.pointerType === 'mouse') this.setTouchMode(false);
    });
    const canvasArea = document.getElementById('canvas-container');
    const isGameSurface = (t) => t === canvasArea || t?.id === 'fx-overlay' || canvasArea?.contains(t) || t?.id === 'hud' || t?.closest?.('#hud') && !t.closest('button');
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (!isGameSurface(e.target)) return;
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.onAction?.('special', e);
    });
    window.addEventListener('pointerup', (e) => { if (e.button === 0) this.mouse.down = false; });
    window.addEventListener('contextmenu', (e) => { if (isGameSurface(e.target)) e.preventDefault(); });

    // Touch
    const tz = document.getElementById('touch-zone');
    if (tz) {
      tz.addEventListener('touchstart', (e) => this._touch(e, 'start'), { passive: false });
      tz.addEventListener('touchmove', (e) => this._touch(e, 'move'), { passive: false });
      tz.addEventListener('touchend', (e) => this._touch(e, 'end'), { passive: false });
      tz.addEventListener('touchcancel', (e) => this._touch(e, 'end'), { passive: false });
    }
    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); off?.(); }, { passive: false });
    };
    hold('t-boost', () => { this.touchBoost = true; }, () => { this.touchBoost = false; });
    hold('t-special', () => this.onAction?.('special'));
    hold('t-pause', () => this.onAction?.('pause'));
    window.addEventListener('touchstart', () => { if (!this.touchMode) this.setTouchMode(true); }, { passive: true });
  }

  setTouchMode(on) {
    this.touchMode = on;
    document.body.classList.toggle('touch', on);
  }

  _touch(e, phase) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (phase === 'start') {
        if (t.clientX < window.innerWidth * 0.42 && this.stick.id === null) {
          Object.assign(this.stick, { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY });
        } else if (this.touchAim.id === null) {
          this.touchAim.id = t.identifier;
          this.mouse.x = t.clientX; this.mouse.y = t.clientY; this.mouse.moved = true;
        }
      } else if (phase === 'move') {
        if (t.identifier === this.stick.id) { this.stick.x = t.clientX; this.stick.y = t.clientY; }
        if (t.identifier === this.touchAim.id) { this.mouse.x = t.clientX; this.mouse.y = t.clientY; }
      } else {
        if (t.identifier === this.stick.id) this.stick.id = null;
        if (t.identifier === this.touchAim.id) this.touchAim.id = null;
      }
    }
    this._drawStick();
  }

  _drawStick() {
    const el = document.getElementById('t-stick');
    if (!el) return;
    if (this.stick.id === null) { el.classList.remove('on'); return; }
    el.classList.add('on');
    el.style.setProperty('--x0', `${this.stick.x0}px`);
    el.style.setProperty('--y0', `${this.stick.y0}px`);
    const dx = Math.max(-60, Math.min(60, this.stick.x - this.stick.x0));
    el.style.setProperty('--dx', `${dx}px`);
  }

  update(dt) {
    const k = this.keys;
    let target = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) target -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) target += 1;
    if (this.stick.id !== null) target = Math.max(-1, Math.min(1, (this.stick.x - this.stick.x0) / 55));
    // Slight ramp so taps make small corrections
    this.steer += (target - this.steer) * Math.min(1, dt * (target === 0 ? 14 : 9));
    if (Math.abs(this.steer) < 0.01) this.steer = 0;
  }

  get boost() {
    const k = this.keys;
    return k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyW') || k.has('ArrowUp') || this.touchBoost;
  }

  get brake() {
    return this.keys.has('KeyS') || this.keys.has('ArrowDown');
  }

  get fire() {
    return this.mouse.down;
  }
}

export { Input };
