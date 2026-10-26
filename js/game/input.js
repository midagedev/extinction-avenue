// js/game/input.js
// Light-gun style input. Mouse: the crosshair follows the pointer, hold the left button to fire, right click reloads.
// Keyboard: R reload, SPACE Skyhammer, ESC/P pause, 1-4 pick cards, ENTER start / continue, M mute, F auto-fire toggle
// (accessibility: fires whenever the crosshair is on a dinosaur).
//
// Touch never puts the crosshair under the finger. Two aim modes (Settings → Touch aim):
//   'drag'   (default) TRACKPAD: drag anywhere and the crosshair moves by the finger's delta (with a little pointer
//            acceleration); lift the finger and the crosshair stays put. While a finger is down the gun fires whenever
//            the crosshair is on something shootable (a dinosaur, a thrown car, a supply drop), so a single thumb aims and
//            shoots and never wastes the belt on empty asphalt. Firing resumes as you slide back onto a target.
//   'offset' ABSOLUTE: the crosshair sits OFFSET_PX above the touch point and the gun fires while the finger is down
//            (the classic light gun, minus the finger covering the target).
// Mild aim assist (touch only, game.js): slows the crosshair over a target and pulls it gently toward the nearest one.
// RELOAD / SKYHAMMER / PAUSE are buttons in the right thumb zone.

const OFFSET_PX = 96;

class Input {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    // mouse.x / y IS the crosshair position (CSS px) for every input method
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight * 0.45, down: false, moved: false };
    this.touchMode = false;
    // Active aiming touch: id, last finger position, finger speed (px/s) for acceleration, start position
    this.touchAim = { id: null, lx: 0, ly: 0, fx: 0, fy: 0, speed: 0, t: 0, x0: 0, y0: 0 };
    this.touchSettings = { mode: 'drag', sens: 1.5, assist: true };
    this.assistSlow = 1; // set by game.js aim assist: < 1 while the crosshair is over a target (friction)
    this.onAction = null; // (name) => void: 'pause', 'special', 'reload', 'mute', 'pick1'..'pick4', 'reroll', 'confirm', 'fire'
    this._bind();
    // Phones/tablets start in touch mode, so the very first touch already aims (instead of only switching modes)
    if (window.matchMedia?.('(pointer: coarse)').matches && navigator.maxTouchPoints > 0) this.setTouchMode(true);
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
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.touchAim.id = null; });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.moved = true;
      if (this.touchMode && e.pointerType === 'mouse') this.setTouchMode(false);
    });
    const canvasArea = document.getElementById('canvas-container');
    const isGameSurface = (t) => t === canvasArea || t?.id === 'fx-overlay' || canvasArea?.contains(t) || t?.id === 'hud' || (t?.closest?.('#hud') && !t.closest('button'));
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (!isGameSurface(e.target)) return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (e.button === 0) { this.mouse.down = true; this.onAction?.('fire', e); }
      if (e.button === 2) this.onAction?.('reroll', e);
    });
    window.addEventListener('pointerup', (e) => { if (e.button === 0) this.mouse.down = false; });
    window.addEventListener('contextmenu', (e) => { if (isGameSurface(e.target)) e.preventDefault(); });

    // Touch aiming surface (covers the play field under the HUD buttons)
    const tz = document.getElementById('touch-zone');
    if (tz) {
      tz.addEventListener('touchstart', (e) => this._touch(e, 'start'), { passive: false });
      tz.addEventListener('touchmove', (e) => this._touch(e, 'move'), { passive: false });
      tz.addEventListener('touchend', (e) => this._touch(e, 'end'), { passive: false });
      tz.addEventListener('touchcancel', (e) => this._touch(e, 'end'), { passive: false });
    }
    this.pad = document.getElementById('touch-pad');
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
    };
    tap('t-reload', () => this.onAction?.('reroll'));
    tap('t-special', () => this.onAction?.('special'));
    tap('t-pause', () => this.onAction?.('pause'));
    window.addEventListener('touchstart', () => { if (!this.touchMode) this.setTouchMode(true); }, { passive: true });
  }

  setTouchMode(on) {
    this.touchMode = on;
    document.body.classList.toggle('touch', on);
  }

  /** Is a finger currently aiming? */
  get touching() {
    return this.touchMode && this.touchAim.id !== null;
  }

  _clamp() {
    const m = 10, W = window.innerWidth, H = window.innerHeight;
    this.mouse.x = Math.min(W - m, Math.max(m, this.mouse.x));
    this.mouse.y = Math.min(H - m, Math.max(m, this.mouse.y));
  }

  _touch(e, phase) {
    e.preventDefault();
    const a = this.touchAim, s = this.touchSettings;
    const now = performance.now();
    for (const t of e.changedTouches) {
      if (phase === 'start') {
        if (a.id !== null) continue;
        a.id = t.identifier;
        a.lx = a.x0 = t.clientX; a.ly = a.y0 = t.clientY;
        a.t = now; a.speed = 0;
        if (s.mode === 'offset') {
          this.mouse.x = t.clientX;
          this.mouse.y = t.clientY - OFFSET_PX;
          this._clamp();
        }
        this.mouse.moved = true;
        this._showPad(t.clientX, t.clientY, true);
        this.onAction?.('fire');
      } else if (phase === 'move') {
        if (t.identifier !== a.id) continue;
        const dx = t.clientX - a.lx, dy = t.clientY - a.ly;
        const dtm = Math.max(1, now - a.t);
        a.speed += (Math.hypot(dx, dy) / dtm * 1000 - a.speed) * 0.5;
        a.lx = t.clientX; a.ly = t.clientY; a.t = now;
        if (s.mode === 'offset') {
          this.mouse.x = t.clientX;
          this.mouse.y = t.clientY - OFFSET_PX;
        } else {
          // Trackpad gain: base sensitivity, ×0.8 for slow precise drags up to ×1.9 for fast flicks, scaled to the
          // screen so a thumb-length swipe crosses about the same share of a phone or a tablet; aim-assist friction
          const screenK = Math.max(0.8, Math.min(1.6, Math.min(window.innerWidth, window.innerHeight) / 420));
          const accel = Math.min(1.9, 0.8 + a.speed / 1400);
          const gain = s.sens * accel * screenK * this.assistSlow;
          this.mouse.x += dx * gain;
          this.mouse.y += dy * gain;
        }
        this._clamp();
        this._showPad(t.clientX, t.clientY, true);
      } else if (t.identifier === a.id) {
        a.id = null;
        this._showPad(0, 0, false);
      }
    }
  }

  /** Faint ring under the finger: where the drag started from (drag mode) */
  _showPad(x, y, on) {
    const p = this.pad;
    if (!p) return;
    p.classList.toggle('on', on);
    if (on) p.style.transform = `translate(${x}px, ${y}px)`;
  }

  update(dt) {
    void dt;
  }

  get fire() {
    return this.mouse.down;
  }
}

export { Input, OFFSET_PX };
