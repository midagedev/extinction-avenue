// js/game/input.js
// Light-gun style input. Mouse: the crosshair follows the pointer, hold the left button to fire, right click reloads.
// Touch: the finger IS the crosshair — touch and hold anywhere on the street to aim and fire there; on-screen
// RELOAD / SKYHAMMER / PAUSE buttons. Keyboard: R reload, SPACE Skyhammer, ESC/P pause, 1-4 pick cards, ENTER start /
// continue, M mute, F auto-fire toggle (accessibility: fires whenever the crosshair is on a dinosaur).

class Input {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight * 0.45, down: false, moved: false };
    this.touchMode = false;
    this.touchAim = { id: null };
    this.onAction = null; // (name) => void: 'pause', 'special', 'reload', 'mute', 'pick1'..'pick4', 'reroll', 'confirm', 'fire'
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

    // Touch: the finger is the light gun
    const tz = document.getElementById('touch-zone');
    if (tz) {
      tz.addEventListener('touchstart', (e) => this._touch(e, 'start'), { passive: false });
      tz.addEventListener('touchmove', (e) => this._touch(e, 'move'), { passive: false });
      tz.addEventListener('touchend', (e) => this._touch(e, 'end'), { passive: false });
      tz.addEventListener('touchcancel', (e) => this._touch(e, 'end'), { passive: false });
    }
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

  _touch(e, phase) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (phase === 'start') {
        if (this.touchAim.id === null) {
          this.touchAim.id = t.identifier;
          this.mouse.x = t.clientX; this.mouse.y = t.clientY; this.mouse.moved = true;
          this.onAction?.('fire');
        }
      } else if (phase === 'move') {
        if (t.identifier === this.touchAim.id) { this.mouse.x = t.clientX; this.mouse.y = t.clientY; }
      } else if (t.identifier === this.touchAim.id) this.touchAim.id = null;
    }
  }

  update(dt) {
    void dt;
  }

  get fire() {
    return this.mouse.down;
  }
}

export { Input };
