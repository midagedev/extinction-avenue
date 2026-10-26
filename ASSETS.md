# EXTINCTION AVENUE — Asset Register

This file records **every asset the game ships**: where it came from, who made it and under which license. It must be
updated **in the same commit** that adds, replaces or removes an asset. Production specs live in
[`docs/ART_PIPELINE.md`](docs/ART_PIPELINE.md).

## 1. Current status

**The dinosaurs are rigged glTF models (v3); music and sound effects are recorded/rendered audio files (v4).** Props,
the cab, effects and icons are still generated procedurally in code. Shipped third-party files: four GLBs and two
JPEG textures in `assets/models/` (CC0, §2.1) and the MP3s in `assets/audio/` (CC0 / public-domain sources + original
work, §2.3). License evidence for every source: `assets/licenses/` and `assets/licenses/audio/`.

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
| Music (12 CC0 cues + 2 original pieces) | `assets/audio/music/*.mp3` (§2.3.1), played by `js/game/audio-music.js` |
| Sound effects (71 groups, 160 files) | `assets/audio/sfx/*.mp3` (§2.3.2), designed in `tools/audio/sfx.js` from CC0/PD recordings + synthesis, played by `js/game/audio.js` |
| Procedural fallback voices + engine/wind loops | `js/game/audio-recipes.js`, `js/game/audio.js` (WebAudio synthesis, this repo) |
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
| Fallback SFX recipes (36) + loops `engine`, `wind` | `js/game/audio-recipes.js`, `js/game/audio.js` | — | this repo | procedural (this repo, MIT) | Synthesized at runtime; only heard until the samples (§2.3) have decoded |

### 2.3 Audio (`assets/audio/`, v4, added 2026-10-27)

All audio is listed in `assets/audio/manifest.json` (generated). Build tools (dev only, not shipped):
`tools/audio-build.mjs` runs `tools/audio/music.js` / `tools/audio/sfx.js` in headless Chromium (OfflineAudioContext)
and encodes MP3 with LAME (WASM build from the `wasm-media-encoders` npm package, MIT, installed in `.tools/` only).
Raw downloads live in `.tools/dl/audio/` (gitignored); each source's license page excerpt is copied to
`assets/licenses/audio/<music|sfx>-<source>.txt`. Every source below was checked on its own page on 2026-10-27:
OpenGameArt entries list **only** "CC0" in their License(s) field; Kenney pages say "Creative Commons CC0"; BigSoundBank
pages say "CC0 (public domain)"; Wikimedia Commons files are "Public domain" (US National Park Service / own work) or
"CC0". No Freesound files (blocked without login), no film/TV/game rips, no elephant recordings (the T. rex roar must
not follow the film recipe), no real-brand sounds.

#### 2.3.1 Music (`assets/audio/music/`, MP3 96 kbps stereo 44.1 kHz, loudness-normalised)

Edits made to every CC0 track: decoded, MP3 padding trimmed to the exact musical loop, loudness-normalised (target in
the manifest), 0.25 s pre/post-roll added so the loop points are seamless, re-encoded. `boss3` is a 32-bar section
(bars 12–44) of the source with a 1-beat crossfaded seam.

| Cue | File | Title | Author | Source URL | License | Use |
|---|---|---|---|---|---|---|
| `title` | `title.mp3` | Cyberpunk Moonlight Sonata (v2) | Joth | https://opengameart.org/content/cyberpunk-moonlight-sonata | CC0 | Title / attract loop (Beethoven's composition is public domain) |
| `combat` | `combat.mp3` | A Flawless Getaway (loop version) | vitalezzz | https://opengameart.org/content/a-flawless-getaway | CC0 | Main combat loop, 130 BPM × 92 bars |
| `combat_hi` | `combat_hi.mp3` | Hunter-class Lifeform | vitalezzz | https://opengameart.org/content/hunter-class-lifeform | CC0 | High-heat combat (mini-bosses, stampede) |
| `breather` | `breather.mp3` | Net Infiltration (loop version) | vitalezzz | https://opengameart.org/content/net-infiltration | CC0 | Breather between fights |
| `boss1` | `boss1.mp3` | Boss Battle #8 [Metal] (loop) | nene | https://opengameart.org/content/boss-battle-8-metal | CC0 | T. rex phase 1 (lazy-loaded) |
| `boss2_intro`, `boss2` | `boss2_intro.mp3`, `boss2.mp3` | Boss Battle #9 [Metal] (opening + loop) | nene | https://opengameart.org/content/boss-battle-9-metal | CC0 | T. rex phase 2 (lazy) |
| `boss3` | `boss3.mp3` | Unholy Surge (section) | vitalezzz | https://opengameart.org/content/unholy-surge | CC0 | T. rex phase 3 (lazy) |
| `victory` | `victory.mp3` | Victory Fanfare Short | cynicmusic | https://opengameart.org/content/victory-fanfare-short | CC0 | Boss defeated sting |
| `continue` | `continue.mp3` | Continue? Theme (loop) | CleytonKauffman | https://opengameart.org/content/continue-theme | CC0 | Continue countdown |
| `gameover` | `gameover.mp3` | Race Finish Bad (Jingle), from "Racing Game Finish & Jingle" | MintoDog | https://opengameart.org/content/racing-game-finish-jingle | CC0 | Game-over jingle |
| `results` | `results.mp3` | Race Finish Good (Loop), same pack | MintoDog | https://opengameart.org/content/racing-game-finish-jingle | CC0 | Results loop |
| `boss_sting` | `boss_sting.mp3` | "Apex Approaching" | this repo (original, `tools/audio/music.js`) | — | CC0 1.0 (original work) | Boss-incoming sting: no CC0 sting fit, so composed here (taiko heartbeat, low brass/choir cluster, reese drone, riser, hit) |
| `combat_heat` | `combat_heat.mp3` | "Heat layer" | this repo (original, `tools/audio/music.js`) | — | CC0 1.0 (original work) | 4-bar percussion layer at exactly 130 BPM, faded in over `combat` with combat heat |

#### 2.3.2 Sound effects (`assets/audio/sfx/`, MP3 64–112 kbps mono, peak-normalised)

Every file is **designed in `tools/audio/sfx.js`** (original work released here under CC0 1.0): the CC0 / PD source
recordings below are cut into single events, pitched, filtered, distorted and layered with synthesis (sub thumps,
clicks, formant growls, sweeps, reverb). Groups → sources:

| Group (variations) | CC0 / PD layers (source keys, see the table below) + synthesis |
|---|---|
| `gun` (6), `gun_tail` (3), `rail` (3) | firearm (near-distance rifle shots, pitched down) + sub thump + click; `rail` adds bmaczero-electricity / faxcorp hit + synth sweep |
| `gatling` (5), `shotgun` (3) | firearm (SMG single shots / shotgun shots) |
| `casing` (6) | kenney-impact (metal light), bmaczero-metal (clinks), pitched up |
| `dry_fire` (2), `reload_out` / `reload_in` (2+2), `bolt` (2) | qubodup-clicks, springyspringo-reloads, kenney-impact (plate), bsb-gun-loading |
| `overheat` (2) | bart-steam + kenney-impact pings |
| `hitmarker` (3), `headshot` (2) | kenney-interface ticks, kenney-impact bells + synth |
| `fossilize` (6), `shatter_big` (3) | rubberduck-breaking (rock breaking / falling), kenney-impact (mining), qubodup-crunch, themightyglider rock/boulder, starninjas-cave-in, kenney-interface glass + sub |
| `explosion` (4), `explosion_big` (2) | kenney-scifi (explosion crunch, low-frequency explosion), joth-explosion, springspring-mech-explosion, rubberduck-metal + sub + rumble |
| `missile` (3), `tesla` (4), `saw` (3), `mine`, `airstrike` (2), `flamer_loop` | mikeask-missile, qubodup-rocket; bmaczero/faxcorp electricity, kenney-digital zaps; springspring-buzzsaw; synth beeps; synth whistle; bsb-gasoline-fire + 0new4y-gas-leak |
| `hurt` (4), `glass` (3) | kenney-impact (plate heavy, glass light), rubberduck-metal sheets; bsb-glass-burst, bsb-mirror, tinyworlds-glass |
| `compy_chirp` (5), `raptor_call` (4) | NPS sandhill crane (pitched up / down) + synth chirps |
| `raptor_screech` (4) | NPS bald eagle, qubodup-peacock, commons cat hiss + synth formant rasp |
| `brute_growl` (3) | NPS grizzly roar, darsycho-troll |
| `trike_bellow` (3), `ankylo_grunt` (3) | NPS bison, commons alligator, bsb sika deer; antumdeluge-bear, bsb grumpy pig (mouth imitation) |
| `ptero_cry` (4) | nocturnalvanguard-screech, bsb barn owl + synth |
| `bite` (3), `tail_swipe` (2) | kenney-impact (wood light), artisticdude-swishes + synth |
| `footstep_heavy` (4), `stampede_loop`, `stomp` (4) | kenney-impact (concrete footsteps, heavy punches), tinyworlds-steps gravel, cinameng-rumble, mieki256-earthquake, rubberduck rock falling + sub |
| `trex_roar` (5: 2 long, 2 short, 1 death) | commons lion (PD), NPS grizzly, trazzz123 deep monster roar + **synth formant growl**, sub drop, chest rumble, breath, street reverb (original design; no elephant, no film roar) |
| `xp` (3), `pickup` (2), `heal`, `overdrive`, `levelup`, `card_show`, `card_pick` (2), `reroll`, `evolve`, `combo`, `danger`, `warning`, `ui_click` (2), `ui_hover`, `ui_back`, `count_tick`, `bell`, `zone_clear` | kenney-casino (chips, cards), kenney-interface, kenney-ui, kenney-digital (power-ups, zaps), kenney-jingles (Hit / Steel), rubberduck-retro power-up, faxcorp turbo / power-up, bonzille-alarm + synth plucks, bells, pads, sirens |
| `vo_*` (15 announcer lines) | Kenney Voiceover Pack (male: go, ready, level up, game over, new highscore, mission completed, hurry up, power up, look out) and Voiceover Pack: Fighter (combo, multi kill, flawless victory, prepare yourself, final round, winner); EQ + compression + room |

Source keys:

| Key | Title | Author | Source URL | License |
|---|---|---|---|---|
| firearm | The Free Firearm Sound Library (files used: M_21P, B_24P, W_29P, T_27P, E_25P, I_22P, D_32P, G_31P, P_30P, C_28P, K_22P, O_21P, H_21P) | Free Firearm Sound Library team (OGA upload: bart) | https://opengameart.org/content/the-free-firearm-sound-library | CC0 ("Our team holds CC0 NO RIGHTS RESERVED") |
| kenney-impact | Impact Sounds | Kenney | https://kenney.nl/assets/impact-sounds | CC0 |
| kenney-scifi | Sci-fi Sounds | Kenney | https://kenney.nl/assets/sci-fi-sounds | CC0 |
| kenney-interface | Interface Sounds | Kenney | https://kenney.nl/assets/interface-sounds | CC0 |
| kenney-ui | UI Audio | Kenney | https://kenney.nl/assets/ui-audio | CC0 |
| kenney-digital | Digital Audio | Kenney | https://kenney.nl/assets/digital-audio | CC0 |
| kenney-casino | Casino Audio | Kenney | https://kenney.nl/assets/casino-audio | CC0 |
| kenney-jingles | Music Jingles | Kenney | https://kenney.nl/assets/music-jingles | CC0 |
| kenney-voice | Voiceover Pack | Kenney (voice actors credited in the pack's Credits.txt) | https://kenney.nl/assets/voiceover-pack | CC0 |
| kenney-voice-fighter | Voiceover Pack: Fighter | Kenney | https://kenney.nl/assets/voiceover-pack-fighter | CC0 |
| rubberduck-breaking | 75 CC0 breaking / falling / hit sfx | rubberduck | https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx | CC0 |
| rubberduck-metal | 100 CC0 metal and wood SFX | rubberduck | https://opengameart.org/content/100-cc0-metal-and-wood-sfx | CC0 |
| rubberduck-retro | 50 CC0 retro / synth SFX | rubberduck | https://opengameart.org/content/50-cc0-retro-synth-sfx | CC0 |
| qubodup-clicks | 7 mechanical clicks and buzzes | qubodup | https://opengameart.org/content/7-mechanical-clicks-and-buzzes | CC0 |
| qubodup-crunch | 5 break, crunch impacts | qubodup | https://opengameart.org/content/5-break-crunch-impacts | CC0 |
| qubodup-peacock | Peacock scream | qubodup (released with the recordist's permission, per the page) | https://opengameart.org/content/peacock-scream | CC0 |
| qubodup-rocket | Rocket launch | qubodup | https://opengameart.org/content/rocket-launch | CC0 |
| springyspringo-reloads | Gun reload sounds | SpringySpringo | https://opengameart.org/content/gun-reload-sounds | CC0 |
| bart-steam | Steam release sounds | bart | https://opengameart.org/content/steam-release-sounds | CC0 |
| bmaczero-electricity | Electricity Sound Effects | BMacZero | https://opengameart.org/content/electricity-sound-effects-0 | CC0 |
| bmaczero-metal | Metal Impact Sounds | BMacZero | https://opengameart.org/content/metal-impact-sounds | CC0 |
| faxcorp | Electricity Game Sound Pack | faxcorp | https://opengameart.org/content/electricity-game-sound-pack | CC0 |
| themightyglider rock / boulder | Breaking Rock; Moving Boulder | themightyglider (derived from Freesound CC0 sounds, per the pages) | https://opengameart.org/content/breaking-rock, https://opengameart.org/content/moving-boulder | CC0 |
| starninjas-cave-in | Cave In | StarNinjas | https://opengameart.org/content/cave-in | CC0 |
| joth-explosion | Chunky Explosion | Joth | https://opengameart.org/content/chunky-explosion | CC0 |
| springspring-mech-explosion | Mechanical Explosion | Spring Spring | https://opengameart.org/content/mechanical-explosion | CC0 |
| springspring-buzzsaw | Buzzsaw Sound Effect | Spring Spring | https://opengameart.org/content/buzzsaw-sound-effect | CC0 |
| mikeask-missile | Missile sound | mikeask | https://opengameart.org/content/missile-sound | CC0 |
| 0new4y-gas-leak | Compressed Gas Leak SFX | 0new4y | https://opengameart.org/content/compressed-gas-leak-sfx | CC0 |
| tinyworlds-glass / -steps | Glass Break; Different steps on wood, stone, leaves, gravel and mud | TinyWorlds | https://opengameart.org/content/glass-break, https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud | CC0 |
| artisticdude-swishes | Swishes Sound Pack | artisticdude | https://opengameart.org/content/swishes-sound-pack | CC0 |
| cinameng-rumble | rumble fx | cinameng | https://opengameart.org/content/rumble-fx | CC0 |
| mieki256-earthquake | Earthquake and Open sesame | mieki256 | https://opengameart.org/content/earthquake-and-open-sesame | CC0 |
| darsycho-troll | Big scary troll sounds | Darsycho | https://opengameart.org/content/big-scary-troll-sounds | CC0 |
| trazzz123 | CC0 Deep Monster Roar | trazzz123 | https://opengameart.org/content/cc0-deep-monster-roar | CC0 |
| nocturnalvanguard-screech | Evil Screech 1 | Nocturnal_Vanguard | https://opengameart.org/content/evil-screech-1 | CC0 |
| antumdeluge-bear | Bear Growls | AntumDeluge | https://opengameart.org/content/bear-growls | CC0 |
| bonzille-alarm | Alarm Sound Effect | bonzille | https://opengameart.org/content/alarm-sound-effect | CC0 |
| bsb-gun-loading | Gun, loading #1 (s1988) | Joseph Sardin (BigSoundBank) | https://bigsoundbank.com/gun-loading-1-s1988.html | CC0 |
| bsb-gasoline-fire | Gasoline fire #1 (s1340) | Joseph Sardin (BigSoundBank) | https://bigsoundbank.com/gasoline-fire-1-s1340.html | CC0 |
| bsb-glass-burst | Glass Burst (s0148) | Joseph Sardin (BigSoundBank) | https://bigsoundbank.com/glass-burst-s0148.html | CC0 |
| bsb-mirror | A Mirror Explodes (s0387) | Joseph Sardin (BigSoundBank) | https://bigsoundbank.com/mirror-explodes-s0387.html | CC0 |
| bsb sika deer | Sika deer rut call #1 (s3617) | Joseph Sardin (BigSoundBank) | https://bigsoundbank.com/sika-deer-rut-call-1-s3617.html | CC0 |
| bsb grumpy pig | Grumpy Pig, with the Mouth #2 (s1659) | Joseph Sardin (BigSoundBank) | https://bigsoundbank.com/grumpy-pig-2-s1659.html | CC0 |
| bsb barn owl | Barn Owl #1 (s1400) | Joseph Sardin (BigSoundBank) | https://bigsoundbank.com/barn-owl-s1400.html | CC0 |
| commons lion | Lion raring-sound1TamilNadu178.ogg | த*உழவன் (own work) | https://commons.wikimedia.org/wiki/File:Lion_raring-sound1TamilNadu178.ogg | Public domain |
| commons alligator | Alligatorbellowedit.ogg | Borisblue | https://commons.wikimedia.org/wiki/File:Alligatorbellowedit.ogg | Public domain |
| commons cat hiss | Cat hissing - Zabuhailo.wav | Zabuhailo | https://commons.wikimedia.org/wiki/File:Cat_hissing_-_Zabuhailo.wav | CC0 |
| NPS bison | Bison.wav | US National Park Service | https://commons.wikimedia.org/wiki/File:Bison.wav | Public domain (US federal work) |
| NPS grizzly | Yellowstone sound library - Grizzly Bears Roar - 001 | NPS & MSU Acoustic Atlas / Jennifer Jerrett | https://commons.wikimedia.org/wiki/File:Yellowstone_sound_library_-_Grizzly_Bears_Roar_-_001.mp3 | Public domain |
| NPS bald eagle | Yellowstone sound library - Bald Eagle - 003 | NPS & MSU Acoustic Atlas / Jennifer Jerrett | https://commons.wikimedia.org/wiki/File:Yellowstone_sound_library_-_Bald_Eagle_-_003.mp3 | Public domain |
| NPS sandhill crane | Yellowstone sound library - Sandhill Crane - 001 | NPS & MSU Acoustic Atlas / Jennifer Jerrett | https://commons.wikimedia.org/wiki/File:Yellowstone_sound_library_-_Sandhill_Crane_-_001.mp3 | Public domain |

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
(see ART_PIPELINE §3). Apply the same CC0 rule to textures, sounds and music (public-domain recordings such as US
federal works are equivalent). Audio: add the source to §2.3 with its URL, save the license excerpt to
`assets/licenses/audio/`, and rebuild with `node tools/audio-build.mjs tools/audio/sfx.js` (or `music.js`). The one exception is fonts,
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
