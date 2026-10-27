# EXTINCTION AVENUE

**Rush hour just went Cretaceous.** Cretagen's specimens have broken containment in Midtown Manhattan, and they're
chasing your cab. Unit 77, an armored animal-control taxi, drives itself down the real avenues. You're the **rear
gunner**: you stand in the roof hatch facing backward over the tail gun, and you shoot everything that runs you down,
like in a classic arcade jeep-chase gun game. Raptors smash out of storefronts, pterosaurs dive at your face, and the
cab stops in combat zones to hold intersections. Level-ups add support guns and evolutions Vampire Survivors-style, but
the aimed gun is the star. The run ends with **GRIDLOCK**, a T. rex in a cracked containment collar that chases the cab
down the avenue, flanks it, and finally charges head-on.

It's a free browser game: a static site with no install and no build step. It's built with three.js `WebGPURenderer` +
TSL, with a WebGL2 fallback.

> Built on **[Slop New York](https://github.com/mrdoob/slop-newyork) by [mrdoob](https://github.com/mrdoob)**, an MIT-licensed
> three.js / WebGPU / TSL simulation of Manhattan. The city geometry, lighting, materials and the yellow cab all come
> from that project. This repo turns it into a game. The original free-roam sim is still here at [`sim.html`](sim.html).

## Play locally

The game uses ES modules and an import map (three.js loads from jsDelivr), so it has to be served over HTTP. Opening
`index.html` from `file://` won't work. Any static server will do:

```bash
# from the repo root
python3 -m http.server 8123
# or: npx serve .   /   npx http-server -p 8123
```

Then open <http://localhost:8123/>. Use a recent Chrome or Edge (WebGPU), Safari (WebGL2, see below) or Firefox (WebGPU
where it's available, WebGL2 otherwise). The first load builds Manhattan and compiles its shaders behind the loading screen, which
takes a few seconds.

To host it, push the folder to GitHub Pages or any static host. Nothing needs compiling.

### Safari / WebGPU

Safari 26 (macOS, iOS, iPadOS) turns WebGPU on by default, but on Safari the WebGPU device was lost when a run started:
the page reloaded and then showed a black game view. The renderer backend is chosen in `js/game/backend.js`
(`pickBackend`):

- **Safari and every iOS/iPadOS browser** (all WebKit) use the **WebGL2** backend. `?webgpu` opts back into WebGPU.
- **Chrome, Edge, Opera and Firefox** use WebGPU when `navigator.gpu` exists and WebGL2 otherwise. `?webgl` forces WebGL2.
- If the WebGPU device is lost, or reports more than 20 errors within 10 seconds, the loading screen says *"Graphics
  driver reset — restarting in compatibility mode (WebGL2)…"* and the page reloads with `?webgl`. If the player had
  already pressed START it also adds `?autostart`, so they go straight back into a run. The fallback never loops: on
  WebGL2 a device error shows the error screen instead.
- The game doesn't fail silently. If init fails, an uncaught error happens while loading (or keeps happening during the
  intro), or START hasn't reached gameplay after about 15 seconds with no frames being drawn, the loading screen shows
  the error and a **Retry (compatibility mode)** button that reloads with `?webgl&autostart`. Sound can't block START:
  every public audio method catches its own exceptions.
- WebKit browsers keep at most 140 MB of decoded music, the same budget as phones, because Safari kills tabs that use
  too much memory.

### Phones / low memory

iOS Safari kills a tab whose WebContent process outgrows its memory limit (roughly 1–1.5 GB on recent iPhones, less on
older ones) and then shows *"A problem repeatedly occurred on this page"*. The game used to build all of Manhattan at
1:1, use the High preset (SSR, a 4096×2048 shadow atlas) and decode most of the music at START, so iPhones crashed
around START. `js/device-profile.js` (`detectProfile`, unit-tested) now turns on a **low-memory profile** for iOS,
iPadOS (including iPads that report themselves as a Mac), Android / mobile browsers and `navigator.deviceMemory` ≤ 4:

- **Graphics:** the *Phone* preset: 2.2× pixel ratio (see *Screen clarity* below), no MSAA, a light sharpening pass, no SSR, bloom at 0.35× resolution, and sun shadows near the cab: 512² cascades over the first
  120 m, cast only by the cab and received only by the street (asphalt, sidewalks). Letting every city material cast/receive would cost ~160 MB of JS heap in three.js shader builds; this
  costs ~12 MB. A saved High / Medium setting becomes Phone; the settings menu offers Phone and Low. `?shadows=0|1`
  overrides the preset.
- **Quality governor** (`js/game/quality-governor.js`): while playing, when 3 s windows of frames run slower than
  ~36 fps, when the JS heap passes 70 % of its limit (where the browser reports it) or when the renderer's own GPU
  allocations pass 260 MB (iOS has no memory API, so the budget is counted), it steps down one notch at a time:
  shadows off, city stream window 70 %, pixel ratio 1.85, stream window 50 %, pixel ratio 1.5 — resolution goes last
  and never below 1.5×. It never steps back up. `?governor=0` turns it off.
- **City chunk streaming** (`js/game/city-stream.js`): after the build, the static city is cut into 200 m cells
  (instanced meshes split by instance, big merged meshes split by triangle). Only the cells in a window along the
  cab's route are in the scene and on the GPU: 900 m behind the cab (the gunner looks back down the street), 450 m
  ahead, 260 m to the sides, plus the straight sightline along the current heading (the street continues past the
  corner just turned), with 120 m of hysteresis. Cells entering the window are added nearest-first under a per-frame
  upload budget; cells leaving it release their GPU buffers and render objects and are rebuilt from a compact CPU
  recipe when the loop brings the cab back. Cells that no window along the loop can ever reach are never built (the
  builders check `cityKeep()` against `loopReach()`). Pieces larger than a cell (the harbour, long seawall faces),
  the landmarks and the borough skyline stay resident. `?stream=0` turns streaming off. Typically ~45 of 212 cells
  are resident.
- **Creatures:** textures are capped at 1024 px; the GLTF loader caches (GLB bytes) are dropped after load.
- **Audio:** the long music loops stream through an `<audio>` element into the music bus instead of being decoded. Only
  the short stingers and the 8 s combat drum layer are decoded (the layer follows the streamed loop's clock and is
  re-phased if it drifts > 35 ms). SFX decode on first use (the frequent ones up front), in mono, under a 16 MB cap (24 MB before the 2.2× screen).

Desktop browsers are unchanged. `?lowmem` forces the profile on any device; `?lowmem=0` turns it off (a phone then gets
the full desktop build). The console logs `[lowmem] phone memory profile (<reason>)` and `[lowmem] city stream {...}`.

**Mid-game reloads (hotfix 2).** `tools/mem-long-probe.mjs` plays a long session on the phone profile (`?autoplay`
makes the game play itself, through GRIDLOCK into the next run) and samples memory every 15 s of game time
(`tools/mem-long-table.mjs` tabulates the log). What it found on the previous build: no JavaScript leak (the JS heap
stays at ~193 MB for 9 minutes), but memory that only goes up while playing. Every part of the city the cab reaches for
the first time gets render objects, geometries and vertex buffers that were never released (renderer geometries
1876 → 2612, render objects 2633 → 3373, until a full lap is done), plus SFX that decode on first use (up to their
24 MB cap) and pipelines for effects seen for the first time. Over 9 minutes the page process grew 490 → 572 MB and the
GPU process 549 → 660 MB, on top of a load peak of ~700 MB. That kind of slow climb is what gets a tab killed after a
while of playing.

With streaming, the city's render state stays bounded: render objects stay around 2650–2940 and move up and down as
cells come and go, and the renderer's GPU allocations are ~20 % lower (≈ 120 vs 150 MB). The opening view draws ~60 %
fewer triangles (1.1 M vs 2.6 M). The picture got sharper (1.6× vs 1.25×) and gained shadows at about the same
process memory. A slow page-process creep of ~+27 MB over 6 minutes remains in both builds in this emulation. With
the JS heap and the renderer's counts flat, it comes from lazily decoded SFX (bounded) and browser-side allocations.

Measured in Chromium with iPhone emulation (393×852 @3x, iOS UA, WebGL2, SwiftShader), `?test&webgl&lowmem&god&autoplay`,
values are page (renderer) process / GPU process / JS heap in MB; GPU allocations = the renderer's own count
(`renderer.info.memory`). Logs: `mem-long-before.log` (9 min), `mem-long-after.log` (7 min).

| | 15 s into the run | 7 min in (420 s) | Drift 60–420 s: first → last third | Peak (page / GPU) | GPU allocations, MB | Renderer geometries (start → max) |
|---|---|---|---|---|---|---|
| Before (40158c5) | 490 / 549 / 192 | 543 / 639 / 194 | 518 → 545 / 596 → 634 / 192 → 196 | 707 / 680 | 145.5 → 150.9 | 1876 → 2612 |
| After | 480 / 548 / 188 | 525 / 658 / 186 | 515 → 542 / 604 → 666 / 188 → 189 | 691 / 697 | 115.6 → 120.5 | 1740 → 2410 |

Of the ~500 MB Chromium page process, the game's own data is about 200 MB (≈110 MB of JS objects + ≈90 MB of
ArrayBuffers, measured with a heap snapshot); the rest is the browser itself in this software-rendered emulation, so
these RSS numbers are an upper bound for what an iPhone's WebContent process holds.
Playwright WebKit with `devices['iPhone 15']` (`node tools/e2e-webkit.mjs <outDir> iphone`) reaches gameplay from START
with the profile, Phone quality and streaming on and no page errors. A real iPhone still hasn't been measured.

### Field of view and dinosaur size

On an upright iPhone the view felt *"too wide, the dinosaurs too small"*: portrait screens widened the vertical FOV
to keep ~52° across, so an iPhone (aspect ≈ 0.46) got ≈ 92° vertical. Now the gunner's FOV is 56° (was 64°), and
portrait screens widen it only up to 68° (`js/game/camera.js` `portraitFov`). The small species grew with their
gameplay scale, so hit spheres and contact distances follow: Scuttler ×1.35, Sicklejaw ×1.3, Skyreaver ×1.35. Their
chase slots moved ~1–3 m closer. A creature that would cover less than 5 % of the view height is drawn up to 1.45×
larger (`enemies.js` `minScreenBoost`, scaled about its feet); the aim raycast scales its hit spheres the same way.
The QA loop records the FOV and the enemy height in px (median and min) per shot, and fails when they regress.

### Screen clarity

Players (real iPhone and desktop) found the picture *"too blurry / milky — I can barely see the enemies."* Measured
with the QA loop's fixed-seed shots (`tools/qa-shots.mjs`), the causes were, in order of impact:

1. **Bloom as a veil.** Threshold 0.95 / strength 0.55 / radius 0.45 bloomed every lit surface (sky, sunlit facades, the
   wet street, the cab right under the camera) through a low-resolution chain, so a haze lay over the whole frame. On
   the phone, switching bloom off dropped the street's dark floor from luma 83 to 2. Now threshold 1.45, strength 0.3,
   radius 0.1: only emissives bloom (tracers, muzzle flashes, explosions, lamps, creature eyes), in tight halos.
2. **Phone resolution.** 1.6× on a 3× iPhone is 28 % of the screen's pixels. Now 2.2× (54 %) plus contrast-adaptive
   sharpening in the post pass (it pre-compensates the blur of the browser's upscale); the governor gives up shadows and stream reach before resolution and stops
   at 1.5×. Desktop High caps at 2× (was 1.5×).
3. **Dinosaurs the colour of the street.** Dark olive / grey-blue / maroon hides and a weak navy rim. Now saturated
   species colours against the grey-blue city (lime compy, orange raptor, crimson brute, violet Hornwall, teal
   Spiketail, magenta Skyreaver, bronze GRIDLOCK), a strong warm rim, a soft camera-side key, glowing eyes (found on
   each sculpt's eyeballs) and a faint glow on the head, the weak point. Compys are 24 % and raptors 10 % taller. All
   of it is in the one instanced skinning shader: no extra lights, passes or draw calls.
4. Smaller softeners: a constant chromatic aberration (now only the damage pulse), a 0.28 vignette (0.14) and a heavy
   split tone (lighter). Fog was not a cause and is unchanged.

**Memory** (iPhone emulation, `tools/mem-long-probe.mjs`, page process / GPU process, MB). The first 2.2× build with 2×
MSAA cost ~95 MB more in the GPU process (SwiftShader rounds 2× up to 4×), so phones dropped MSAA. The canvas lost its
unused depth buffer, the phone shadow cascades went to 512² (only the cab casts), and the phone SFX cache went from 24
to 16 MB.

| 300 game-s soak | page peak | page mean / max in play | GPU-process peak | GPU-process mean | renderer allocations (max) |
|---|---|---|---|---|---|
| Before (1.6×, 397bb90) | 704 | 520 / 538 | 654 | 610 | 120 MB |
| 2.2× + 2× MSAA (6511244) | 638 | 530 / 552 | 754 | 695 | 143 MB |
| 2.2×, no MSAA, 512² shadows, no canvas depth (660f1bb) | 735 * | 532 / 550 | **647** | **601** | 131 MB |

\* The page-process peak is the load spike (GC timing). It varies 630–745 MB between runs of the same build. Paired
load probes (load + 15 s): before 714 / 712, after 709 / 724, FOV pass 705.

Before (397bb90) → after, fixed seed, `node tools/qa-shots.mjs` (BEFORE served from a worktree of the old commit). The
scenes share the seed but not every frame: bigger compys and raptors change hits and spawns.

| metric | desktop-t34 before → after | desktop-t62 before → after | phone-t34 before → after | phone-t62 before → after |
|---|---|---|---|---|
| camera FOV (vertical °) | 64 → **56** | 64 → **56** | 92.2 → **68** | 92.2 → **68** |
| pixel ratio | 1.5 → **2** | 1.5 → **2** | 1.6 → **2.2** | 1.6 → **2.2** |
| sharpness | 35.51 → **81.37** | 45.43 → **98.55** | 31.9 → **88.97** | 23.85 → **103.55** |
| edge px % | 3.84 → **6.16** | 5.29 → **6.39** | 4.01 → **8.22** | 2.32 → **9.54** |
| street veil (p5 luma) | 18 → **10** | 27 → **20** | 87 → **10** | 178 → **4** |
| luma p2 | 4 → **2** | 3 → **1** | 18 → **3** | 25 → **2** |
| luma p50 | 108 → **104** | 97 → **90** | 150 → **74** | 197 → **80** |
| luma spread p2-p98 | 246 → **248** | 245 → **245** | 234 → **233** | 229 → **231** |
| inspector contrast p5-p95 | 232 → **230** | 222 → **218** | 224 → **212** | 217 → **209** |
| color entropy bits | 7.14 → **7.02** | 7.42 → **7.07** | 7.4 → **7.08** | 6.61 → **7.08** |
| edge density | 0.488 → **0.534** | 0.47 → **0.495** | 0.388 → **0.437** | 0.286 → **0.457** |
| creature vs street dLuma | 27.6 → **41.5** | 40.6 → **66.4** | 34.1 → **55** | 20 → **61.4** |
| creature vs street dRGB | 54.8 → **77.9** | 73.9 → **111.8** | 61 → **99.2** | 39.6 → **114.8** |
| silhouette edge contrast | 15.7 → **44.2** | 29.4 → **46.7** | 4.2 → **20.5** | 6.2 → **32.5** |
| enemies measured | 5 → **4** | 7 → **4** | 7 → **3** | 6 → **5** |
| enemy median height px | 168 → **453** | 83 → **233** | 66 → **298** | 121 → **296** |
| enemy min height px | 46 → **238** | 73 → **174** | 35 → **282** | 35 → **147** |
| renderer GPU alloc MB | 444.5 → **569.3** | 444.7 → **569.5** | 110 → **115.5** | 109.8 → **115.5** |

## Controls

| | Desktop | Touch |
|---|---|---|
| Aim the tail gun | Mouse (the crosshair turns red over a dinosaur, gold over a weak point) | **Drag anywhere** — the crosshair moves by your finger's movement like a trackpad, so your finger never covers it (mild aim assist). Settings → *Touch aim* switches to a crosshair floating 96 px above the finger |
| Fire | Hold **left click** | Keep the finger down: it fires while the crosshair is on a dinosaur, a thrown car or a supply drop (offset mode: fires while held) |
| Reload | Automatic when the belt runs dry; **R** or **right click** reloads early | RELOAD button |
| Skyhammer air strike (charged by kills) | **Space** (lands where the crosshair meets the street) | SKYHAMMER button |
| Level-up choice | Click a card or **1 / 2 / 3 / 4**, **R** rerolls | Tap |
| Continue after a wreck | **Enter** / **Space** / click PRESS START | Tap |
| Pause / mute / auto-fire | **Esc** or **P** / **M** / **F** (fires whenever the crosshair is on a dinosaur) | II button (SOUND ON/OFF in the pause menu) |

## Sound

Music and sound start with your first click, tap or key press (browser autoplay rules). **Settings → AUDIO** has a
mute toggle, master / music / effects volume and the arcade announcer voice. All of it is remembered in
`localStorage`. **M** toggles mute in game.

- **Music** (CC0 tracks from OpenGameArt + two original pieces, see [ASSETS.md §2.3](ASSETS.md)) is adaptive. The
  title theme plays first. During a run a breather, the main combat track and a high-heat track crossfade on the bar
  as the fight heats up, and an original percussion layer locked to the combat track's tempo fades in with combat heat.
  The boss warning brings in an original sting. The T. rex fight changes track at each phase. After it come a victory
  sting, a continue countdown loop, a game-over jingle and a results loop. Music dips under big moments (roars, the
  boss name card, the announcer). The boss music loads lazily, about 1.5 minutes before the boss.
- **Sound effects** (160 files, 71 groups) are designed from CC0 / public-domain recordings layered with synthesis:
  - tail-gun shots with variation, plus shell casings and a street echo when you release the trigger
  - reload foley, overheat steam, hit markers and headshot dings
  - stone-crack shatters on kills, explosions and every support weapon
  - cab damage, a DANGER alert, creature calls, footsteps and stampedes
  - a layered T. rex roar (lion and grizzly pitched down, a CC0 monster roar, a synthetic formant growl, sub, reverb)
  - Kenney's CC0 announcer voice
  - Positioning: enemy sounds are in 3D (PannerNode + camera listener, distance attenuation, air absorption).
  - Mixing: a voice cap with priority stealing keeps busy fights clean, and a glue compressor plus a limiter on the
    master keep it from clipping.
- Total audio: about 12 MB of MP3. About 1.4 MB loads at the title screen; the rest streams in behind the first run,
  and the boss suite (2.2 MB) loads later.

## The game in one minute

- **On rails, first person.** You never steer. The cab drives a loop of real Midtown streets (5th Ave → W 34th St → 7th
  Ave through Times Square → W 57th St), speeds up for avenue chases and stops dead in **combat zones**. The camera is
  the gunner's eye: looking back down the road at the pursuers, swinging to the side for ambushes and forward when the
  T. rex comes at you head-on.
- **Readable fights, not swarms.** Usually 5 to 20 dinosaurs are in play, with short peaks around 30 to 40 in the
  stampede. Each one is worth shooting: Scuttlers (2 hits), Sicklejaw raptors, Brutes, Hornwall chargers, Spiketail
  tanks and Skyreaver pterosaurs, plus elites and two mini-bosses.
- **Real creatures (v3).** Rigged, animated models with physically based skin: a 22k-triangle sculpted theropod
  (colour + normal maps) rigged in this repo becomes the Scuttler, the Sicklejaw, the Brute and — with a big head, tiny
  arms and a heavier body — GRIDLOCK; refined Quaternius rigs for the Hornwall (triceratops) and the Spiketail
  (stegosaurus); a high-detail procedural Skyreaver. Run cycles with planted feet, crouch / pounce / bite / roar / hit
  clips, flinches, heads that track the gunner, cross-fades, per-animal size and colour variation. All CC0 —
  see [ASSETS.md](ASSETS.md).
- **Fair, telegraphed attacks.** Nothing hurts you by touching the cab. A dinosaur that's about to jump you crouches,
  glows red and gets a shrinking red ring on screen (DANGER!). Shoot it before the ring closes and it STAGGERs out of
  the attack. Only a few may attack at once, and only after they've been on screen long enough to be shot.
- **Light-gun feel.** Hitscan heavy machine gun with a 30-round belt, reload, recoil, muzzle flash, spread that blooms
  when you hold the trigger, headshots (1.6x), hit markers, cracked glass and a red flash when you get hit, a combo
  multiplier (up to x8), score popping off every kill, and arcade callouts.
- **Arcade structure.** Beats instead of an endless spawn: OUTBREAK → STOREFRONT → pterosaurs → COMBAT ZONE → AVENUE
  CHASE → ALPHA RAVAGER → Times Square COMBAT ZONE → CROSSFIRE → SKY RAID → HORNWALL MATRIARCH → STAMPEDE → quiet →
  WARNING → GRIDLOCK (6:30–7:15 in). Supply drops float behind the cab (repair, overdrive, Skyhammer): shoot them to
  grab them.
- **Survivors layer.** Gene cores stream into the cab. Level-ups offer 3 cards: support weapons (Sentry Guns, Swarm
  Missiles, Tesla Coil, Exhaust Flamer, Flare Mines, Hubcap Saws, Tailgate Buckshot), passives (Hollow Points,
  Autoloader, Extended Mag, Stopping Power, Armor, Chassis, Gene Magnet, Blast Radius) and 8 evolutions, including the
  Tail Gun's own: the piercing **Rail Lance**.
- **GRIDLOCK, the T. rex.** A slow-motion reveal, then a three-phase chase. It lunges at the tailgate (shoot the collar
  during the telegraph to stagger it), throws wrecked cars you can shoot out of the air, pulls up beside the cab (the
  view swings to face it), and in phase 3 overtakes and charges head-on. When it dies there's slow motion, it topples,
  turns to stone and shatters.
- **Continue?** When the cab is wrecked you get a 10-second CONTINUE countdown. Continuing is free (no coins needed) but
  resets your combo multiplier, so everyone gets to see the T. rex. Results show your score, headshots, max combo and
  continues, and there's a one-click post to X.

## URL parameters

| Parameter | Effect |
|---|---|
| `?quality=high\|medium\|low\|phone` | High = SSR reflections + 1.5× pixel ratio; Medium = no SSR; Low = no shadows, 0.75× resolution; Phone = no SSR / shadows, 1.25× (the low-memory default; High / Medium become Phone there) |
| `?lowmem` / `?lowmem=0` | Force the phone / low-memory profile on / off (see *Phones / low memory*) |
| `?stream=0` / `?shadows=0\|1` / `?governor=0` | Phones: no city streaming / shadows off or on / no automatic quality step-down |
| `?autoplay` | The game plays itself (memory soaks, `tools/mem-long-probe.mjs`) |
| `?webgl` | Force the WebGL2 backend |
| `?webgpu` | Use WebGPU on Safari / iOS, which default to WebGL2 (see *Safari / WebGPU*) |
| `?boss` | Start just before GRIDLOCK with a mid-game build (clip recording) |
| `?t=SECONDS` | Skip ahead to the beat at that time (e.g. `?t=230` for the second combat zone) |
| `?nointro` / `?autostart` | Skip the intro camera / start immediately |
| `?god` | Invulnerable (testing / filming) |
| `?test` | No animation loop: drive the game from `window.__game.step()` / `.render()` (headless tests) |
| `?procedural` | Draw the v2 procedural low-poly creatures instead of the rigged models (comparison / very old devices) |

## Project layout

```
index.html            the game shell (HUD, menus, level-up, results)
css/game.css          game UI
js/game/              the game
  game.js             entry point, state machine (title → intro → play → continue → results), scoring, aim ray, share
  world.js            renderer + city + post-processing (bloom, grade, CA, hurt/danger edges)
  city-stream.js      phones: the static city in 200 m cells, only the window along the cab's route resident
  quality-governor.js phones: steps shadows / stream window / pixel ratio down under frame-time or memory pressure
  quality-presets.js  graphics presets (pixel ratio, MSAA, sharpen, shadows, bloom scale) and time-of-day looks
  assets.js           THE ASSET MANIFEST (GLB files, species skins: morphs, clips, looks)
  skin-model.js       GLB → skinned model; bakes GLB clips / procedural keyframes (FK + bone-scale morphs) to matrices
  skin-rig.js         GPU-instanced skinning (one draw call per species & LOD), PBR creature material
  creature-clips.js   procedural keyframes (theropod gait with leg IK, pounce, bite, roar…; pterosaur flight)
  creature-anim.js    gameplay state → clips, cross-fades, speed-matched gait, flinch, head-look
  dino-models.js      v2 procedural rigs (fallback) + the T. rex collar   rig.js / poses.js   v2 rigid-part animation
  enemies.js          species, route-space pursuer AI, telegraphs + attack tokens, hit spheres
  director.js         the beat script: chases, combat zones, ambushes, set pieces, mini-bosses
  camera.js / gunner.js  first-person gunner camera (scripted swings) + tail-gun view model
  boss.js             GRIDLOCK                              weapons.js / upgrades.js   arsenal + level-up rules
  pickups.js          gene cores + power-ups                vfx.js / batches.js   pooled instanced VFX
  audio.js            sound system: buses, limiter, voice pool, 3D panning, ducking, loading   audio-music.js   adaptive music
  audio-recipes.js    procedural fallback voices (until samples decode)
  player.js / route.js / input.js / hud.js / icons.js
js/*.js               Slop New York city modules (mrdoob)
sim.html              the original free-roam simulation
docs/ART_PIPELINE.md  art bible, full asset list + specs, production routes
docs/ROADMAP.md       stage 1 beat sheet, stage 2/3 boss sketches (Hudson Leviathan, Skyline), elites & mini-bosses
ASSETS.md             asset & license register        assets/models, assets/licenses   CC0 models + evidence
assets/audio/         music/ + sfx/ MP3s and manifest.json (generated)   assets/licenses/audio   per-source license excerpts
tools/                headless test drivers (Playwright) and data tools
tools/lab/            asset lab: rig the sculpt, refine Quaternius rigs, build the pterosaur (node tools/model-lab.mjs)
tools/audio/          audio lab: music.js (CC0 track prep + original sting / heat layer), sfx.js (SFX design), synth.js,
                      analyze.js / slices.js / sheet.js (tempo, events, waveform+spectrogram sheets); run through
                      node tools/audio-build.mjs <script> (headless Chromium OfflineAudioContext → LAME/WASM MP3)
```

## Testing

**Run the QA loop before every push** (see also `CLAUDE.md`):

```bash
node tools/qa.mjs                  # syntax + unit tests + page errors + fixed-seed shots with readability metrics vs tools/qa-baselines + WebKit iPhone e2e
node tools/qa.mjs --soak           # + the phone memory soak (needed for anything touching render targets, resolution, shadows, streaming, audio buffers)
node tools/qa.mjs --url https://midagedev.github.io/extinction-avenue/   # the deployed build
node tools/qa.mjs --steps shots --only phone [--update-baselines]       # one profile; refresh the baseline after a deliberate visual change
```

It prints a PASS / WARN / FAIL table (sharpness, street veil, luma spread, creature-vs-street contrast, silhouette edge,
enemy size in px, pixel ratio, page errors, WebKit checks, memory peaks) and exits 1 on a FAIL. Artifacts go to
`.tools/qa/<timestamp>/`.

The individual drivers:

```bash
node --experimental-vm-modules tools/check-syntax.mjs     # parse every game module
node --test tests/                                         # unit tests (142: the city's 113 + backend choice / fallback URLs + phone profile / stream window + quality presets / governor)
npm i -D playwright && npx playwright install chromium     # once (or keep it in .tools/node_modules)
python3 -m http.server 8123 &
node tools/e2e-v2.mjs smoke  ./shots          # title → start → 20 s of bot play → first-person screenshot
node tools/e2e-v2.mjs idle   ./shots          # a player who never touches anything: how long does the cab last?
node tools/e2e-v2.mjs bot    ./shots '' 3     # a human-like bot (reaction delay, capped mouse speed, aim noise) plays a whole run, seed 3
node tools/e2e-v2.mjs shots  ./shots          # screenshot set (title, first person, combat zone, level-up, pterosaur, T. rex, continue, results)
node tools/e2e-touch.mjs ./shots all          # phone emulation (portrait + landscape) with CDP touch events: 32 touch-aim / HUD / audio-unlock checks
node tools/e2e-gallery.mjs ./shots after-     # fixed creature framings; add '' '&procedural' (prefix before-) for the v2 rigs
python3 -I tools/lab/compare.py ./shots ./cmp # BEFORE / AFTER side-by-sides
node tools/perf-creatures.mjs                 # 40 animated dinosaurs: draw calls, triangles, CPU pose cost
node tools/e2e-audio.mjs ./shots              # audio (30 checks): gesture-only AudioContext, settings persistence across reloads, cue transitions (run/boss/victory/continue/game over), phone memory budget, voice cap, master peak, no console errors / autoplay warnings
node tools/shots-v4.mjs ./shots [phone]       # v4 screenshot set: combat, boss, audio settings + pause sound toggle (desktop and phone)
node tools/qa-shots.mjs ./shots [--only phone] [--native]  # the QA loop's fixed-seed shots + metrics.json (--native: the phone frame again at 3×)
node tools/e2e-webkit.mjs ./shots             # Safari smoke (Playwright WebKit, real-time loop, served under /extinction-avenue/): title → START → playing, WebGL2 backend, not-black 3D view, no errors
```

All drivers except `e2e-webkit` open the page with `?test&webgl` (no animation loop; the sim is stepped through `window.__game.step()`)
and send real mouse events through Playwright, so input goes through the game's own DOM handlers. Headless Chromium
renders through SwiftShader, so a frame takes seconds; that's why the loop is stepped instead of run in real time.

## License, credits and data

- Code: [MIT License](LICENSE). This is a fork of [Slop New York](https://github.com/mrdoob/slop-newyork) by
  [mrdoob](https://github.com/mrdoob) and contributors. All the game code in `js/game/` is under the same license.
- Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
  Third-party data and dependencies keep their own licenses.
- Rendering: [three.js](https://threejs.org/) (MIT), loaded from jsDelivr. Fonts: Bebas Neue, Chakra Petch and Inter
  from Google Fonts (SIL OFL).
- Models: CC0 (damik, Quaternius) plus original work. Music: CC0 tracks by Joth, vitalezzz, nene, cynicmusic,
  CleytonKauffman and MintoDog (OpenGameArt) plus original pieces. Sound effects: designed in this repo from CC0 /
  public-domain recordings (Kenney, OpenGameArt, BigSoundBank, US National Park Service via Wikimedia Commons). The
  announcer is Kenney's CC0 Voiceover Pack. Every source, with URL and license, is in [ASSETS.md](ASSETS.md); see also
  [docs/ART_PIPELINE.md](docs/ART_PIPELINE.md).
- EXTINCTION AVENUE, Cretagen, Unit 77, GRIDLOCK and all creature names are original and fictional. The game isn't
  affiliated with any film franchise, and the storefronts and billboards in the city use fictional brands.
