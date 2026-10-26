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

Then open <http://localhost:8123/>. Use a recent Chrome or Edge (WebGPU). Safari and Firefox use WebGPU where they
support it and fall back to WebGL2 otherwise. The first load builds Manhattan and compiles its shaders behind the loading screen, which
takes a few seconds.

To host it, push the folder to GitHub Pages or any static host. Nothing needs compiling.

## Controls

| | Desktop | Touch |
|---|---|---|
| Aim the tail gun | Mouse (the crosshair turns red over a dinosaur, gold over a weak point) | **Drag anywhere** — the crosshair moves by your finger's movement like a trackpad, so your finger never covers it (mild aim assist). Settings → *Touch aim* switches to a crosshair floating 96 px above the finger |
| Fire | Hold **left click** | Keep the finger down: it fires while the crosshair is on a dinosaur, a thrown car or a supply drop (offset mode: fires while held) |
| Reload | Automatic when the belt runs dry; **R** or **right click** reloads early | RELOAD button |
| Skyhammer air strike (charged by kills) | **Space** (lands where the crosshair meets the street) | SKYHAMMER button |
| Level-up choice | Click a card or **1 / 2 / 3 / 4**, **R** rerolls | Tap |
| Continue after a wreck | **Enter** / **Space** / click PRESS START | Tap |
| Pause / mute / auto-fire | **Esc** or **P** / **M** / **F** (fires whenever the crosshair is on a dinosaur) | II button |

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
| `?quality=high\|medium\|low` | High = SSR reflections + 1.5× pixel ratio; Medium = no SSR; Low = no shadows, 0.75× resolution |
| `?webgl` | Force the WebGL2 backend |
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
  player.js / route.js / input.js / hud.js / audio.js (procedural WebAudio SFX + music) / icons.js
js/*.js               Slop New York city modules (mrdoob)
sim.html              the original free-roam simulation
docs/ART_PIPELINE.md  art bible, full asset list + specs, production routes
docs/ROADMAP.md       stage 1 beat sheet, stage 2/3 boss sketches (Hudson Leviathan, Skyline), elites & mini-bosses
ASSETS.md             asset & license register        assets/models, assets/licenses   CC0 models + evidence
tools/                headless test drivers (Playwright) and data tools
tools/lab/            asset lab: rig the sculpt, refine Quaternius rigs, build the pterosaur (node tools/model-lab.mjs)
```

## Testing

```bash
node --experimental-vm-modules tools/check-syntax.mjs     # parse every game module
node --test tests/                                         # the original city's unit tests (113)
npm i -D playwright && npx playwright install chromium     # once (or keep it in .tools/node_modules)
python3 -m http.server 8123 &
node tools/e2e-v2.mjs smoke  ./shots          # title → start → 20 s of bot play → first-person screenshot
node tools/e2e-v2.mjs idle   ./shots          # a player who never touches anything: how long does the cab last?
node tools/e2e-v2.mjs bot    ./shots '' 3     # a human-like bot (reaction delay, capped mouse speed, aim noise) plays a whole run, seed 3
node tools/e2e-v2.mjs shots  ./shots          # screenshot set (title, first person, combat zone, level-up, pterosaur, T. rex, continue, results)
node tools/e2e-touch.mjs ./shots all          # phone emulation (portrait + landscape) with CDP touch events: 24 touch-aim / HUD checks
node tools/e2e-gallery.mjs ./shots after-     # fixed creature framings; add '' '&procedural' (prefix before-) for the v2 rigs
python3 -I tools/lab/compare.py ./shots ./cmp # BEFORE / AFTER side-by-sides
node tools/perf-creatures.mjs                 # 40 animated dinosaurs: draw calls, triangles, CPU pose cost
```

All drivers open the page with `?test&webgl` (no animation loop; the sim is stepped through `window.__game.step()`)
and send real mouse events through Playwright, so input goes through the game's own DOM handlers. Headless Chromium
renders through SwiftShader, so a frame takes seconds; that's why the loop is stepped instead of run in real time.

## License, credits and data

- Code: [MIT License](LICENSE). This is a fork of [Slop New York](https://github.com/mrdoob/slop-newyork) by
  [mrdoob](https://github.com/mrdoob) and contributors. All the game code in `js/game/` is under the same license.
- Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
  Third-party data and dependencies keep their own licenses.
- Rendering: [three.js](https://threejs.org/) (MIT), loaded from jsDelivr. Fonts: Bebas Neue, Chakra Petch and Inter
  from Google Fonts (SIL OFL).
- Every model, icon, sound and piece of music in the game is generated procedurally in code, so no third-party art or
  audio ships with it. See [ASSETS.md](ASSETS.md) and [docs/ART_PIPELINE.md](docs/ART_PIPELINE.md).
- EXTINCTION AVENUE, Cretagen, Unit 77, GRIDLOCK and all creature names are original and fictional. The game isn't
  affiliated with any film franchise, and the storefronts and billboards in the city use fictional brands.
