// js/game/quality-presets.js
// The graphics presets (renderer + post-processing) and the time-of-day looks. Plain data, no three.js import, so the
// unit tests (tests/quality-presets.test.mjs) can pin the decisions the screen-clarity pass made: phones render at
// >= 2x, desktop caps at 2x, and bloom only catches emissives. js/game/world.js applies them.

const QUALITY = {
  // pixel ratio cap, SSR, shadows, bloom resolution, MSAA samples of the scene pass (the canvas itself only receives
  // the post-processing quad, so it never multisamples), sharpen = contrast-adaptive sharpening amount (0 = off)
  high: { pixelRatio: 2.0, ssr: true, shadows: true, bloomScale: 0.5, samples: 4, sharpen: 0 },
  medium: { pixelRatio: 1.25, ssr: false, shadows: true, bloomScale: 0.5, samples: 4, sharpen: 0.25 },
  low: { pixelRatio: 0.75, ssr: false, shadows: false, bloomScale: 0.35, samples: 0, sharpen: 0.3 },
  // Phones / low-memory devices (js/device-profile.js LOWMEM): no SSR targets, a small bloom chain, and cheap sun
  // shadows near the cab only: 1024² cascades over the first ~120 m, no shadow stand-ins. A sharp picture comes first:
  // 2.2× pixel ratio (≈ 54 % of an iPhone's 3× pixels; 1.6× was 28 % and read as blurry) with 2× MSAA on the scene
  // pass and a light sharpening pass. js/game/quality-governor.js gives up shadows and stream reach before resolution
  // when frames run long, and never drops below 1.5×.
  phone: { pixelRatio: 2.2, ssr: false, shadows: true, shadowMap: 1024, shadowFar: 120, bloomScale: 0.35, samples: 2, sharpen: 0.35 }
};

const LOOKS = {
  // Twilight "neon Cretaceous": cool blue hour with saturated emissive accents. Bloom thresholds sit above what lit
  // surfaces reach (sky, sunlit facades, the wet street), so only emissives bloom — tracers, muzzle flashes,
  // explosions, lamps, creature eyes — instead of a low-resolution haze over the whole frame.
  twilight: { exposure: 1.1, contrast: 1.16, saturation: 1.14, balance: [1.0, 0.99, 1.03], bloom: 0.3, threshold: 1.45 },
  midnight: { exposure: 1.18, contrast: 1.14, saturation: 1.14, balance: [0.98, 1.0, 1.04], bloom: 0.34, threshold: 1.3 },
  golden: { exposure: 1.04, contrast: 1.14, saturation: 1.12, balance: [1.04, 1.0, 0.96], bloom: 0.28, threshold: 1.6 }
};

export { QUALITY, LOOKS };
