# EXTINCTION AVENUE

**Rush hour just went Cretaceous.** Cretagen's specimens have broken containment in Midtown Manhattan. You drive Unit 77,
an armored animal-control cab, down the real avenues and fight the stampede. The cab's weapons fire themselves,
Vampire Survivors-style. You aim the roof cannon with the mouse, steer around telegraphed attacks, ram the small ones,
and evolve your build. The run ends with **GRIDLOCK**, a T. rex in a cracked containment collar that chases you down
the avenue.

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
| Aim / fire Roof Cannon | Mouse + hold **left click** (the reticle locks onto targets and weak points) | Auto-fire; tap the street to aim |
| Steer across the avenue | **A / D** or **← / →** | Left-thumb stick |
| Nitro | **Shift** / **W** / **↑** | NITRO button |
| Brake | **S** / **↓** | — |
| Skyhammer air strike (charged by kills) | **Space** / **E** / **right click** | SKYHAMMER button |
| Level-up choice | Click a card or **1 / 2 / 3**, **R** rerolls | Tap |
| Pause / mute / toggle auto-fire | **Esc** or **P** / **M** / **F** | II button |

## The game in one minute

- **On rails.** The cab follows a real loop of Midtown streets: 5th Ave → W 34th St → 7th Ave through Times Square →
  W 57th St. You control lateral position and speed (nitro / brake), and the camera is free to frame the action.
- **Bullet heaven.** Gene cores drop from fossilized dinosaurs. Each level-up pauses the game and offers 3 upgrades
  (8 weapons, 8 passives). Max a weapon and own its partner passive to **evolve** it (Rail Lance, Storm Gatlings,
  Buzzsaw Halo, Cluster Barrage, Thunderhead, Inferno Wake, Nova Mines, Dragon's Breath).
- **Light-gun feel.** The aimed Roof Cannon is your strongest single-target damage, and it crits on weak points.
- **Escalating waves.** Scuttler swarms, Sicklejaw pack hunters, Brutes, Hornwall chargers (red lane telegraphs),
  Clubtail tail-swipes, Skyreaver dive-bombers. Elites and mini-bosses (Alpha Ravager, Hornwall Matriarch) drop
  supply crates.
- **GRIDLOCK, the T. rex boss (≈7:30).** A name-card reveal, then a three-phase chase. It lunge-bites down a
  telegraphed lane, sends out stomp shockwaves you have to outrun with nitro, hurls wrecked cars, overtakes you for
  head-on charges, and roars up raptor packs. Shoot the glowing collar. When it dies there's slow motion, it topples,
  turns to stone and shatters.
- **Results + Share on X.** You get your score, time, kills, combo, roadkill count and build, plus a one-click
  tweet. After a victory you can keep driving in endless mode.

## URL parameters

| Parameter | Effect |
|---|---|
| `?quality=high\|medium\|low` | High = SSR reflections + 1.5× pixel ratio; Medium = no SSR; Low = no shadows, 0.75× resolution |
| `?webgl` | Force the WebGL2 backend |
| `?boss` | Start 12 s before GRIDLOCK with a mid-game build (clip recording) |
| `?t=SECONDS` | Start later in the run (e.g. `?t=360` for the late-game swarms) |
| `?nointro` / `?autostart` | Skip the intro camera / start immediately |
| `?god` | Invulnerable (testing / filming) |
| `?test` | No animation loop: drive the game from `window.__game.step()` / `.render()` (headless tests) |

## Project layout

```
index.html            the game shell (HUD, menus, level-up, results)
css/game.css          game UI
js/game/              the game
  game.js             entry point, state machine, scoring, level-ups, cinematics, share
  world.js            renderer + city + post-processing (bloom, grade, CA, hurt/danger edges)
  assets.js           THE ASSET MANIFEST (swap placeholders for GLB files here)
  dino-models.js      procedural low-poly creature rigs   rig.js / poses.js   instanced rigid-part animation
  enemies.js          species, AI, spatial hash, ramming   director.js   waves, events, spawning
  boss.js             GRIDLOCK                              weapons.js / upgrades.js   arsenal + level-up rules
  pickups.js          gene cores + power-ups                vfx.js / batches.js   pooled instanced VFX
  player.js / route.js / camera.js / input.js / hud.js / audio.js (procedural WebAudio SFX + music) / icons.js
js/*.js               Slop New York city modules (mrdoob)
sim.html              the original free-roam simulation
docs/ART_PIPELINE.md  art bible, full asset list + specs, production routes
ASSETS.md             asset & license register
tools/                headless test drivers (Playwright) and data tools
```

## Testing

```bash
node --experimental-vm-modules tools/check-syntax.mjs                 # parse every game module
npm i -D playwright && npx playwright install chromium                # once
node tools/e2e-play.mjs http://127.0.0.1:8123/ ./shots full  '&quality=low&webgl'          # title → run → level-ups → swarm
node tools/e2e-play.mjs http://127.0.0.1:8123/ ./shots boss  '&quality=low&webgl&boss&god' # GRIDLOCK → death → results
node tools/e2e-play.mjs http://127.0.0.1:8123/ ./shots swarm '&quality=low&webgl&t=360&god'
node tools/e2e-play.mjs http://127.0.0.1:8123/ ./shots balance '&quality=low&webgl'        # bot plays a whole run
node tools/e2e-live.mjs 'http://127.0.0.1:8123/?quality=low' ./shots [mobile]               # real-time loop + touch
```

The original city's unit tests still live in `tests/`.

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
