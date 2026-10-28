# EXTINCTION AVENUE — working notes for agents

Plain ES modules, no bundler, no npm scripts. three.js is pinned to dev commit `3efcf0f` through the import map in
`index.html` (CDN); npm releases break the city's WebGL2 shaders. GitHub Pages serves `main` from the repo root under
`/extinction-avenue/`. Push only to `origin` (the fork), fast-forward only.

## Before every push: run the QA loop

```bash
node tools/qa.mjs                    # syntax, unit tests, page errors, fixed-seed shots + readability metrics vs baseline, WebKit iPhone e2e (~12 min)
node tools/qa.mjs --soak             # + the phone memory soak (240 game-s, ~25 min) — required when anything touches
                                     #   render targets, pixel ratio, shadows, textures, city streaming or audio buffers
node tools/qa.mjs --url https://midagedev.github.io/extinction-avenue/   # after the push: the live site
node tools/qa.mjs --steps shots --only phone                            # quick visual check of one profile
```

It prints one table (PASS / WARN / FAIL per check) and exits 1 on any FAIL. Artifacts (screenshots, metrics.json,
logs, summary.json) go to `.tools/qa/<timestamp>/` (gitignored). Do not push with a FAIL. A WARN needs a sentence in the
commit message. Look at the screenshots yourself as well — the metrics catch haze, blur and creatures sinking into the
street, not every kind of ugly.

- **Shots** (`tools/qa-shots.mjs`): Chromium + SwiftShader, `?test&webgl&god&nointro`, `Math.random` seeded and Web
  Audio disabled (its real-time voice limits would consume random numbers), a bot plays to game time 34 s and 62 s.
  Profiles: desktop 1440×900 @2x on High, iPhone 15 emulation (iOS UA → lowmem profile, Phone quality). Metrics on
  device-resolution screenshots without the HUD: sharpness (mean |Laplacian| ×10), luma p2/p50/p98 + spread, *veil* =
  p5 luma of the lower 45 % (the street; a milky bloom haze lifts it), creature-vs-street contrast (the frame is
  rendered again with the creatures hidden; the changed pixels are the creatures), silhouette edge contrast, enemy
  height in px.
- **Baselines** live in `tools/qa-baselines/` (baseline.json + thumbnails). After a deliberate visual change, check
  the new screenshots, then `node tools/qa.mjs --update-baselines` (add `--soak` to refresh the memory peaks) and commit
  the baseline with the change. Never refresh a baseline to make a regression pass.
- Gameplay changes (spawns, sizes, weapons) move the fixed-seed scenes; that is expected — compare the screenshots.

## Hard constraints

- **iPhone memory.** iOS kills the tab past ~1–1.5 GB. The phone profile (`js/device-profile.js` LOWMEM) peaks at
  ~700 MB page process in the soak. Pay for new visuals with shadows / stream reach / render-target precision first.
  Keep new city builders behind `cityKeep()`; city materials must not cast/receive shadows on phones.
- **Phone clarity.** Phone pixel ratio stays ≥ 2 (governor floor 1.5, `js/game/quality-governor.js`); bloom only on
  emissives (threshold ≥ 1.3, `js/game/quality-presets.js`); chromatic aberration only as the damage pulse. The unit
  tests in `tests/quality-presets.test.mjs` pin these.
- **Dinosaur size on screen.** Gunner FOV 56°, portrait capped at 68° (`js/game/camera.js`); far creatures get a
  minimum on-screen size (`enemies.js` `minScreenBoost`). The QA shots fail if the enemy height in px drops (median
  < 75 % or min < 60 % of the baseline). `node tools/qa.mjs --fast` = syntax + unit + shots (~7 min).
- **Everything spawned is pooled or released.** Particles, lights, beams and damage numbers already come from pools.
  A canvas `font` string has to be reused too (round the pixel size — Safari caches each distinct font until the tab
  is hidden, which is the "it gets slower until I background Safari" bug). Audio nodes a voice creates (the source,
  the air filter, the reverb send) are disconnected when the voice ends; `stop()` before the scheduled start does not
  fire `onended`, so a backup timer has to release a stolen voice. `node tools/qa.mjs --soak` runs
  `tools/perf-decay-probe.mjs` after the memory soak and fails if frame time, draw calls, scene objects, programs,
  geometries, textures, live audio nodes, held reverb sends or canvas font keys trend up.
- Headless: SwiftShader WebGPU presents nothing — drivers use `?test&webgl` and step the sim (`window.__game.step()`,
  `.render()`). Playwright lives in `.tools/node_modules` (gitignored).
