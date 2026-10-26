# EXTINCTION AVENUE — Asset Register

This file records **every asset the game ships**: where it came from, who made it and under which license. It must be
updated **in the same commit** that adds, replaces or removes an asset. Production specs live in
[`docs/ART_PIPELINE.md`](docs/ART_PIPELINE.md).

## 1. Current status

**The dinosaurs are rigged glTF models (v3).** Everything else (props, the cab, effects, icons, audio) is still
generated procedurally in code. Shipped third-party files: four GLBs and two JPEG textures in `assets/models/`, all
CC0 (see §2.1 and the license evidence in `assets/licenses/`).

| Asset family | Source |
|---|---|
| Creature models (7 species) | `assets/models/*.glb` (§2.1), drawn by `js/game/skin-rig.js` (GPU-instanced skinning) |
| Creature animation | GLB clips (Quaternius Triceratops / Stegosaurus) and procedural keyframes (`js/game/creature-clips.js`), driven by `js/game/creature-anim.js` |
| Fallback creature rigs (v2, used with `?procedural` or if a GLB fails to load) | `js/game/dino-models.js` + `js/game/rig.js` + `js/game/poses.js` (this repo, MIT) |
| T. rex containment collar (attachment) | `buildCollar` in `js/game/dino-models.js` (this repo, MIT) |
| Props: car attachments, pickups, projectiles, debris | `js/game/props.js` |
| Player car (Unit 77 taxi body) | `createTaxiModel` in `js/controllers.js` (city car generator, with `js/actor-models.js`) |
| Visual effects (particles, rings, beams, telegraphs, damage numbers) | `js/game/vfx.js`, `js/game/batches.js` |
| Post-processing (bloom, grade, vignette) | `js/game/world.js`, `js/post-processing.js` |
| UI icons (60 SVG icons) | `js/game/icons.js` |
| Sound effects (36 recipes, 3 loops) and music (4 cues) | `js/game/audio.js` (WebAudio synthesis) |
| City (buildings, landmarks, trees, street furniture, sky, materials) | Inherited from slop-newyork: `js/buildings.js`, `js/landmarks.js`, `js/trees.js`, `js/street-details.js`, `js/fire-escapes.js`, `js/tsl-materials.js`, `js/lighting.js`, `js/city-grid.js`, `js/road-network.js`, `js/road-paint.js`, `js/boroughs.js`, … |
| City ambience audio (original sim) | Inherited: `js/audio-synthesis.js`, `js/audio-sources.js`, `js/audio-acoustics.js`, `js/audio-events.js`, `js/audio-system.js` |

Not shipped / dev-only: `.tools/` (Playwright test tooling and its bundled logos/icons, plus `.tools/baseline.png`, a
test screenshot, and the raw downloads in `.tools/dl/`) is not part of the game build. The asset build tools live in
`tools/lab/` (rigging, refinement, procedural pterosaur, texture conversion) and run headlessly through
`tools/model-lab.mjs`.

### 1.1 How the creature assets were made (v3)

1. **Sources searched** (CC0 only): Quaternius (pack page + Google Drive), Poly Pizza (CC0-filtered; CC-BY items
   rejected), OpenGameArt (CC0 filter), Kenney (no dinosaurs), GitHub (no licensed CC0 dinosaur repos), itch.io
   (Cloudflare-blocked), Sketchfab / BlendSwap (login required, skipped). The only CC0 **rigged + animated** dinosaurs
   are Quaternius' Animated Dinosaur Pack (1.2–2.3k flat-shaded triangles). The only CC0 **high-detail** dinosaur is
   damik's sculpt (22k triangles, colour + normal bakes) — **unrigged**.
2. **Theropods** (`theropod.glb`): the damik sculpt, rigged here (skeleton placed from measured orthographic views,
   `tools/lab/ortho.js`), with an LOD1. One mesh + texture set serves four species through runtime bone-scale morphs
   and shader recolours.
3. **Quadrupeds** (`triceratops.glb`, `stegosaurus.glb`): Quaternius rigs and clips kept as they are; the faceted
   meshes were refined into smooth ones (material boundaries and sharp edges kept as creases, skin weights interpolated
   with the same subdivision stencils). Hide detail (domed scales, blotches, bands, countershading) is procedural in the
   shader.
4. **Pterosaur** (`pterosaur.glb`): procedural (see the table) — the documented last resort.
5. License evidence for every file: `assets/licenses/`.

## 2. Asset table

Template:

| Asset id | File | Source URL | Author | License | Notes |
|---|---|---|---|---|---|
| `<manifest id>` | `assets/models/…/<id>.glb` | `https://…` | Name / handle | CC0 1.0 | tris, edits made, date added |

### 2.1 Models (`ASSET_MANIFEST`)

| Asset id | File | Source URL | Author | License | Notes |
|---|---|---|---|---|---|
| `playerCar` | `js/controllers.js` (`createTaxiModel`) | — | slop-newyork contributors | procedural (this repo, MIT) | Unit 77 taxi body; `kind: 'car'` |
| `turretBase` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `turretGun` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Roof Cannon |
| `railGun` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Rail Lance |
| `attGatling` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Hood Gatlings |
| `attMissiles` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Swarm Missiles |
| `attTesla` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Tesla Coil |
| `attFlamer` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Exhaust Flamer |
| `attShotgun` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Bumper Buckshot |
| `attPlow` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Ram Plow |
| `attArmor` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Armor Plating |
| `compy` | `assets/models/theropod.glb` + `theropod_albedo.jpg` + `theropod_normal.jpg` | https://opengameart.org/content/dinosaur-1 | damik | CC0 1.0 | Scuttler. Same sculpt as `raptor`/`brute`/`trex` (22,294 tris, LOD1 6,689, 2048² colour + normal maps). **Rigged by this project** (27 bones, `tools/lab/rig-theropod.js`); species = runtime bone-scale morph + recolour. Added 2026-10-26 |
| `raptor` | `assets/models/theropod.glb` (+ textures) | https://opengameart.org/content/dinosaur-1 | damik | CC0 1.0 | Sicklejaw (orange, striped) |
| `brute` | `assets/models/theropod.glb` (+ textures) | https://opengameart.org/content/dinosaur-1 | damik | CC0 1.0 | Brute / Alpha (heavier body morph, slate) |
| `trike` | `assets/models/triceratops.glb` | https://poly.pizza/m/IGvrUqGrRM (pack: https://quaternius.com/packs/animateddinosaurs.html) | Quaternius (via Poly Pizza) | CC0 1.0 | Hornwall. Original 1,332 tris, 29 bones, 6 clips; **refined by this project** (crease-aware Loop subdivision ×2 → 21,216 tris, LOD1 5,304, recoloured; `tools/lab/refine-quaternius.js`). Added 2026-10-26 |
| `ankylo` | `assets/models/stegosaurus.glb` | https://poly.pizza/m/eFcNbOlpvl (pack as above) | Quaternius (via Poly Pizza) | CC0 1.0 | **Spiketail** (renamed from Clubtail): no CC0 rigged ankylosaur exists, the closest good CC0 model stands in. 2,282 → 36,448 tris, LOD1 9,112, 6 clips |
| `ptero` | `assets/models/pterosaur.glb` | — | this repo | CC0 1.0 (original work) | Skyreaver. **Last-resort procedural model** (no CC0 rigged pterosaur exists): smooth lofted mesh, 17,508 tris, 19 bones, analytic skin weights, generated by `tools/lab/build-ptero.js`; procedural clips |
| `trex` | `assets/models/theropod.glb` (+ textures) | https://opengameart.org/content/dinosaur-1 | damik | CC0 1.0 | GRIDLOCK: the sculpt morphed into a T. rex (head ×1.48, short thick neck, arms ×0.42, heavier body), dark olive hide, procedural roar/bite/throw/crouch/hit/death clips, collar attachment (`buildCollar`, this repo) |
| `gem` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Gene core |
| `crate` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Cretagen supply crate |
| `repair` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `nitro` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `vacuum` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `airstrike` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Skyhammer beacon |
| `tracer` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `missile` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `mine` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `saw` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `shard` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | Fossil shard |
| `boulder` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |
| `wreck` | `js/game/props.js` | — | this repo | procedural (this repo, MIT) | |

### 2.2 Effects, icons, audio

| Asset id | File | Source URL | Author | License | Notes |
|---|---|---|---|---|---|
| VFX pools & recipes (glow, streak, shards, smoke, rings, telegraphs, beams, numbers) | `js/game/vfx.js` | — | this repo | procedural (this repo, MIT) | Geometric, no textures |
| Icon set (60 ids, see `ICON_IDS`) | `js/game/icons.js` | — | this repo | procedural (this repo, MIT) | Original SVG paths. **Exception:** `x-logo` depicts the X (Twitter) mark, a trademark of X Corp., used only to label a share link |
| SFX recipes (36) + loops `engine`, `flamer`, `wind` | `js/game/audio.js` | — | this repo | procedural (this repo, MIT) | Synthesized at runtime, no samples |
| Music cues `title`, `run`, `boss`, `results` | `js/game/audio.js` | — | this repo | procedural (this repo, MIT) | Original chord progressions, step sequencer |

## 3. Third-party code, fonts & data

| Dependency | How it's used | Source | License |
|---|---|---|---|
| **three.js** (dev branch builds pinned to commit `3efcf0f`: `three.webgpu.js`, `three.tsl.js`, `examples/jsm` addons: `GLTFLoader`, `BufferGeometryUtils`, `BloomNode`, `ClusteredLighting`, …; the asset tools also use `ColladaLoader`, `GLTFExporter`, `SimplifyModifier`) | Loaded at runtime via the import map in `index.html` | jsDelivr CDN: `https://cdn.jsdelivr.net/gh/mrdoob/three.js@3efcf0f…/` | MIT |
| **slop-newyork** (the base project) | Forked codebase: city, controllers, cameras, audio sim | https://github.com/mrdoob/slop-newyork | MIT (© 2026 Mr.doob, see `LICENSE`) |
| **Inter** (UI fallback, taxi decals) | Google Fonts stylesheet in `index.html` (game) and `sim.html` | https://fonts.google.com/specimen/Inter | SIL Open Font License 1.1 |
| **Overpass** (street-name signs, free-roam sim) | Google Fonts stylesheet in `sim.html` | https://fonts.google.com/specimen/Overpass | SIL Open Font License 1.1 |
| **Bebas Neue** (display type, damage numbers) | Google Fonts stylesheet in `index.html` | https://fonts.google.com/specimen/Bebas+Neue | SIL Open Font License 1.1 |
| **Chakra Petch** (HUD / menu type) | Google Fonts stylesheet in `index.html` | https://fonts.google.com/specimen/Chakra+Petch | SIL Open Font License 1.1 |
| **Anton** (fallback named in `vfx.js`, not loaded) | Only used if installed locally | https://fonts.google.com/specimen/Anton | SIL Open Font License 1.1 |

Fonts are served by Google Fonts and not redistributed in this repo. If fonts are ever self-hosted, ship the OFL text
alongside them and keep the reserved font names unchanged.

**Geographic data** (inherited from slop-newyork; `js/nyc-geodata.js`, built by `tools/build-geodata.mjs` from
`tools/data/*.json`):

- NYC DCP Borough Boundaries, NYC Street Centerline (CSCL) and NYC Parks Properties: **NYC Open Data**.
- Central Park features, piers, landmark footprints and the New Jersey shore: **© OpenStreetMap contributors**,
  available under the **Open Database License (ODbL)**, https://www.openstreetmap.org/copyright.

The OpenStreetMap attribution must stay visible in the game's credits/about screen and in the README.

## 4. Rules for adding assets

**Only CC0 models may be added.** A model is admissible if it is either:

1. a third-party asset published under **CC0 1.0** (e.g. Kenney, Quaternius, Poly Pizza items filtered to CC0), or
2. **original work** (made in-house, commissioned under a full rights assignment, or AI-generated under a plan whose
   terms give us full ownership without attribution or use restrictions) that the rights holder releases here under
   **CC0 1.0**.

Not admissible: CC BY, CC BY-SA, CC BY-NC, "free for personal use", "royalty-free" store licenses, unclear or missing
licenses, rips from games/films, and anything resembling *Jurassic Park/World* IP or real-world brands
(see ART_PIPELINE §3). Apply the same CC0 rule to textures, sounds and music. The one exception is fonts,
which may be SIL OFL.

**Procedure for adding a model:**

1. **Verify the license** at the source page and save evidence: the URL, plus a screenshot or archived copy of the
   license statement, in `assets/licenses/<asset id>.txt` (or the pack's own `License.txt`).
2. **Prepare the file** per `docs/ART_PIPELINE.md` (units, axes, node-naming contract, vertex colors, budget) and
   place it at `assets/models/<group>/<asset id>.glb`, with the source `.blend` in `assets/source/`.
3. **Validate** with the checklist in ART_PIPELINE §8 (glTF-Validator, tri count, in-game scale/animation/fossilize checks).
4. **Swap it in** by setting `url` (and, for a rigged creature, a `skin` block: clip names, target height, look) on
   the manifest entry in `js/game/assets.js` — see the existing `trike` entry for a GLB with its own clips.
5. **Register it** in the table above: replace the row's File / Source URL / Author / License / Notes. In Notes, put
   tri count, modifications, date, and for AI-assisted work the tool, plan, date and summary of the manual rework.
6. Commit the GLB, the license evidence and this file **together**.
