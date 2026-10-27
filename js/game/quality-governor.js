// js/game/quality-governor.js
// Phones (js/device-profile.js LOWMEM): steps the graphics down while playing when there is no headroom left.
//   - frame time: the mean frame of a 3 s window above FRAME_SLOW (two windows in a row) → one step down
//   - memory: where the browser tells (performance.memory: Chrome on Android) the JS heap above 70 % of its limit, and
//     everywhere the GPU allocations the renderer counts (renderer.info.memory.total) above GPU_BUDGET → one step down
//     (iOS has no memory API: the renderer's own counts are the budget there)
// Steps, in order: sun shadows off, the city stream window to 70 %, pixel ratio 2.2 → 1.85, the stream window to
// 50 %, pixel ratio 1.5. A sharp picture is what makes the dinosaurs readable on a phone, so everything else goes
// first and the pixel ratio never drops below PIXEL_RATIO_FLOOR (1.5).
// It never steps back up during a session (no oscillation); `?governor=0` turns it off.

const FRAME_SLOW = 1 / 36; // s
const WINDOW = 3; // s
const GPU_BUDGET = 260e6; // bytes the renderer may hold (buffers + textures + render targets)
const HEAP_FRACTION = 0.7;

const PIXEL_RATIO_FLOOR = 1.5;

const STEPS = [
  { shadows: false },
  { streamReach: 0.7 },
  { pixelRatio: 1.85 },
  { streamReach: 0.5 },
  { pixelRatio: PIXEL_RATIO_FLOOR }
];

class QualityGovernor {
  /** @param {{ world, onResize: () => void, log?: (msg: string) => void }} opts */
  constructor({ world, onResize, log = (m) => console.info(m) }) {
    this.world = world;
    this.onResize = onResize;
    this.log = log;
    this.step = 0;
    this.t = 0;
    this.frames = 0;
    this.sum = 0;
    this.slowWindows = 0;
    this.cooldown = 0;
  }

  /** Per rendered frame while playing: dt = real seconds since the last frame */
  update(dt) {
    if (this.step >= STEPS.length || dt <= 0 || dt > 0.5) return; // skip hitches from tab switches / loading
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.t += dt;
    this.frames++;
    this.sum += dt;
    if (this.t < WINDOW) return;
    const mean = this.sum / this.frames;
    this.t = this.sum = this.frames = 0;
    this.slowWindows = mean > FRAME_SLOW ? this.slowWindows + 1 : 0;
    const why = this.slowWindows >= 2 ? `frame ${(mean * 1000).toFixed(1)} ms` : this._memoryPressure();
    if (why && this.cooldown <= 0) {
      this.slowWindows = 0;
      this.cooldown = 6; // let the step take effect before judging again
      this.stepDown(why);
    }
  }

  _memoryPressure() {
    const pm = globalThis.performance?.memory;
    if (pm && pm.jsHeapSizeLimit && pm.usedJSHeapSize > pm.jsHeapSizeLimit * HEAP_FRACTION) return `JS heap ${(pm.usedJSHeapSize / 1048576).toFixed(0)} MB`;
    const total = this.world.renderer.info?.memory?.total;
    if (total > GPU_BUDGET) return `GPU ${(total / 1048576).toFixed(0)} MB`;
    return null;
  }

  stepDown(why) {
    const s = STEPS[this.step++];
    if (!s) return;
    const w = this.world;
    if (s.pixelRatio) {
      // never up (a device whose own ratio is lower keeps it), never below the floor
      const pr = Math.min(globalThis.devicePixelRatio || 1, Math.max(PIXEL_RATIO_FLOOR, s.pixelRatio), w.renderer.getPixelRatio());
      w.renderer.setPixelRatio(pr);
      this.onResize();
    }
    if (s.shadows === false) w.lighting.sunLight.castShadow = false;
    if (s.streamReach && w.stream) w.stream.setReach(s.streamReach);
    this.log(`[quality] step ${this.step}/${STEPS.length} (${why}): ${JSON.stringify(s)}`);
  }
}

export { QualityGovernor, STEPS as GOVERNOR_STEPS, PIXEL_RATIO_FLOOR };
