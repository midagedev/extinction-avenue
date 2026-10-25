# EXTINCTION AVENUE — Final Report

**Repo:** `/workspace/dino-game` (local git, never pushed) · **Screenshots:** `/workspace/dino-game-shots/`
**One-liner:** *Rush hour just went Cretaceous.* Cretagen's specimens are loose in Midtown. You drive Unit 77, an
armored cab, down real Manhattan avenues. Its weapons fire themselves, Vampire Survivors-style; you aim the roof
cannon, dodge telegraphed attacks, evolve your build, and take down **GRIDLOCK**, a T. rex chasing you down 5th Avenue.

The game is built on mrdoob's MIT-licensed [Slop New York](https://github.com/mrdoob/slop-newyork) (three.js
WebGPURenderer + TSL). The original free-roam sim still works at `sim.html`. The LICENSE, the OSM / NYC Open Data
attribution and mrdoob's credit are kept in the README, on the title screen and in ASSETS.md.

---

## 1. How to run

```bash
cd /workspace/dino-game
python3 -m http.server 8123        # any static server works; file:// does not (ES modules + import map)
# open http://localhost:8123/
```

It's a pure static site with no build step, so it can go to GitHub Pages as is. three.js comes from jsDelivr and the
fonts from Google Fonts. Useful URL parameters: `?quality=high|medium|low`, `?webgl`, `?boss` (start 12 s before the
T. rex), `?t=360` (late-game swarm), `?god`, `?nointro`, `?test` (headless stepping). README.md has the full table,
the controls and the test commands.

## 2. Gameplay

**Core loop (10 minutes or so per run).** The cab rides a closed loop of real streets: 5th Ave ↓, W 34th ↓, 7th Ave ↑
through Times Square, W 57th →. You steer across the full width of the roadway, boost with nitro or brake, aim the
**Roof Cannon** with the mouse (hold left click), and call in the **Skyhammer** air strike (Space or right click)
once kills have charged it. Everything else fires on its own.

- **Arsenal (VS-style).** 8 weapons: Roof Cannon (aimed), Hood Gatlings, Hubcap Saws, Swarm Missiles, Tesla Coil,
  Exhaust Flamer, Flare Mines, Bumper Buckshot. 8 passives: armor, hull, turbo, magnet, ram, fire rate, damage/crit,
  area. Max a weapon and own its paired passive to unlock **8 evolutions** (Rail Lance, Storm Gatlings, Buzzsaw Halo,
  Cluster Barrage, Thunderhead, Inferno Wake, Nova Mines, Dragon's Breath). There are 6 weapon slots and 6 passive
  slots. Each level-up pauses and offers 3 cards (4 from supply crates), you get 3 rerolls, and evolutions take
  priority. Owned weapons appear on the car body (hood guns, trunk missile pod, tesla spire, plow, armor plates,
  rail turret), so builds show up in screenshots.
- **Enemies.** Scuttlers (compy swarms), Sicklejaws (pouncing raptors), Brutes, Hornwalls (triceratops-style
  chargers with red lane telegraphs that trample other dinosaurs), Clubtails (armored ankylosaur-style tanks with
  tail-swipe rings), and Skyreavers (pterosaur dive-bombers with shadow telegraphs). Elites are bigger, glow magenta,
  get special behaviors and drop crates.
- **Pacing.** Scuttlers stampede at 0:04 and the first level-up arrives within seconds. At **0:48 GRIDLOCK makes a
  cameo**, crossing the avenue ahead and roaring. After that come flocks, elites, two mini-bosses (Alpha Ravager at
  2:50, Hornwall Matriarch at 4:40), mega swarms of 200+, a warning klaxon at 7:21 and the boss at 7:30. Defeat ends
  in **CITY SAVED** with an option to keep driving in endless mode; dying ends in **FOSSILIZED**.
- **Feel.** Ramming small dinos launches them. A combo multiplier goes up to x8 and halves when you get hit. There
  are callouts (RAMPAGE, MASS EXTINCTION…), hit-stop on heavy kills, trauma-based screen shake, chromatic aberration
  and a red edge when you're hurt, slow motion on big moments, aggregated damage numbers, off-screen threat arrows,
  and a reticle that locks onto targets and shows WEAK POINT.
- **No gore.** Dinosaurs *fossilize*: they turn to stone and shatter into shards and cyan "gene energy".

**GRIDLOCK, the headline boss.** A warning klaxon, then it bursts onto the avenue behind you. The reveal is a
letterboxed, slow-motion, low-angle hero shot with a roar and a name card, after which the camera swings into a
reverse "getaway" view: your cab in the foreground, the T. rex behind it.

- **Phase 1, Chase.** Lunge bites down a telegraphed lane (steer out), stomp shockwaves with a 26 m radius (a BOOST!
  prompt; you outrun them with nitro), and hurled wrecked cars with landing circles.
- **Phase 2, Enraged** (at 66%, with a stagger, a collar explosion and a banner). It overtakes you, turns, and charges
  head-on down a red lane; the camera swings back to the chase view, and a near miss pays a bonus. It also roars up
  raptor packs.
- **Phase 3, Desperate.** Faster, with double lunges, and the collar weak point goes from ×2.5 to ×3.5.
- **Weak points.** The glowing containment collar (the reticle snaps to it) and the thighs.
- **Death.** Hit-stop, slow motion and an orbit camera. It staggers, topples onto its side, kicks up a dust ring,
  turns to stone and shatters in a flash with a fountain of gene cores, followed by the APEX DOWN banner, a +50,000
  bonus and the victory screen.

**Later bosses and the per-stage roadmap** are in `docs/ROADMAP.md`. Stage 2 is the **Hudson Leviathan** (a
mosasaur-type that bursts out of the Hudson onto the West Side Highway). Stage 3 is **Skyline** (a sauropod-type
rampaging through Central Park). Both stages get their own elites and mini-bosses.

## 3. Design decisions (and why)

- **On rails with lateral steering, not free driving.** The game is about aiming, dodging and reading the swarm, not
  navigating Manhattan's grid. Rails keep the car moving through the most photogenic streets (Times Square, 5th Ave
  canyons) and let the camera be art-directed. They also let the T. rex **share the route as a coordinate system**
  (arc length + lateral offset), so it can chase, overtake and charge head-on through corners without any
  pathfinding. Steering stays meaningful because telegraphs are lanes and rings across the roadway.
- **Auto weapons plus an aimed cannon.** Auto weapons give the bullet-heaven power fantasy and readable builds. The
  mouse cannon is the strongest single-target damage and is the only practical way to hit the T. rex's collar for
  crits, which keeps a light-gun skill element. Touch players get auto-fire with aim assist.
- **"Neon Cretaceous" art direction.** Flat-shaded low-poly creatures carry emissive "containment tag" markings
  (cyan gene energy, magenta elites, orange/red danger), set against mrdoob's realistic-but-stylized twilight
  Manhattan with HDR bloom, fog and SSR wet roads. One consistent look that survives compression in clips.
- **Rigid-part instanced rigs instead of skinned meshes.** Each body part of each species is one `InstancedMesh`, so a
  500-dinosaur swarm costs roughly 70 draw calls, and poses are a few Euler angles per instance. Measured CPU cost
  of the whole simulation (AI, spatial hash, weapons, VFX pools): **≈0.85 ms per 1/60 s tick with ~500 dinosaurs**
  (headless Chromium). Every particle, projectile and pickup is a preallocated struct-of-arrays pool drawn through
  instanced batches.
- **One asset manifest** (`js/game/assets.js`). Every creature, prop, pickup and projectile loads through it, and
  setting `url` swaps a procedural placeholder for a GLB with no code changes (node-name contract for rigs; vertex
  colour/emissive baking for props). `docs/ART_PIPELINE.md` has the full asset list, specs and production routes.
  All shipped art and audio is procedural (`ASSETS.md`).
- **Procedural audio.** Every SFX, including the layered T. rex roar, is synthesized in WebAudio with voice limiting
  and stereo/distance panning. There's an adaptive darksynth score (title / run / boss / results) that gets muffled
  during level-ups and pause.
- **IP hygiene.** The title, Cretagen, Unit 77, GRIDLOCK and all creature names are original. The creature designs are
  generic real-dinosaur archetypes, and the T. rex's containment collar is our own motif. While testing I found
  real-world brands on the inherited city's storefronts and billboards (a pharmacy chain, a stock exchange, a news
  channel, a ticket booth, a newspaper quote, the MetLife crown sign). I replaced them with fictional ones, including
  in-world jokes: a crashing Cretagen stock ticker in Times Square, and Cretagen on the Park Ave tower crown. The
  player cab got its own "Animal Control · Dino Response" livery in place of the NYC T&LC decals.

## 4. Verification done

All of this was automated with Playwright + headless Chromium (SwiftShader), driven by `tools/`:

- **Full flow:** title → intro → run with waves and level-ups → T. rex cameo → boss reveal → three phases → death
  sequence → results → Share on X. The tweet intent is generated correctly, for example
  `https://twitter.com/intent/tweet?text=I put down GRIDLOCK the T. rex in …&url=…`. **0 page errors** on the WebGL2
  path.
- **Real-time loop (no test hooks):** title → click START → 60 s of play on the **WebGPU backend**, the desktop and
  mobile (touch emulation) paths, and all 36 sound recipes played without throwing.
- **Balance bot** (holds fire at the screen centre, weaves, never dodges or uses nitro on purpose): it survives about
  3:50–4:00 at the current tuning. A human who dodges, boosts and aims should reach the 7:30 boss with a reasonable
  build. This is still **bot tuning, not human playtesting** (see known issues).
- **Screenshots** (`/workspace/dino-game-shots/`): title screen, first seconds, first-minute swarm (with the T. rex
  cameo in the background), level-up choice (two), a 500-dinosaur swarm, T. rex reveal, boss chase, boss weak-point
  fight, boss death, and the results screen with Share on X. `docs/og-image.png` is the social card.

## 5. Known issues and limitations

- **WebGPU support.** Best in current Chrome/Edge. Elsewhere three.js falls back to WebGL2 automatically, and
  `?webgl` forces it. If the WebGPU device is lost, the game reloads on WebGL2. The first visit compiles a lot of
  pipelines behind the loading screen: a few seconds on a real GPU, longer on weak laptops.
- **Headless WebGPU renders black.** In the sandbox, SwiftShader's WebGPU adapter accepts frames but presents nothing
  and logs `Instance dropped in popErrorScope`. The *original* `sim.html` behaves exactly the same, so it's an
  environment limitation, not a game bug. All screenshots were therefore rendered through the WebGL2 backend. I
  couldn't measure GPU frame rate on real hardware here, only CPU simulation cost.
- **Performance on low-end GPUs is unknown.** The base city is heavy (SSR, shadows, 1.1 MB geodata). `?quality=low`
  or Settings → Graphics drops SSR, shadows and resolution. Phones will probably need Low.
- **Balance** was tuned with a bot. Kill counts and XP pace are high (VS-like). The combo multiplier tends to stay at
  the cap under heavy fire, and boss HP (30k, scaling with time) may need adjusting after real playtests.
- **Touch** was tested only in emulation, not on a real phone; there's no haptics yet.
- **Audio** was only checked for runtime errors. Nobody has listened to the mix on speakers, so levels may need a pass.
- **Placeholders.** All creatures and props are procedural low-poly. The T. rex reads well, while the small fry are
  readable but simple. The `playerCar` GLB slot in the manifest isn't consumed yet (the cab is the city's procedural
  taxi).
- **Landmarks** are real NYC places by name (Empire State Building and so on). That's geography, not branding. Map
  labels only appear in the free-roam sim.
- The **X logo** icon is used only to label the Share on X button.
- Debug flags (`?god`, `?boss`, `?t=`) are public. That's harmless and handy for creators recording clips.

## 6. Next steps to make it more viral

1. **Instant clip capture.** A `MediaRecorder` buffer of the last 15 s (canvas + WebAudio), saved on the boss kill or
   with a hotkey, and exported as a ready-to-post vertical 9:16 MP4/WebM with the score burned in. Most viral game
   clips are vertical.
2. **Shareable seeded runs and daily challenges.** Put `?seed=` in the share URL ("beat my run on the same seed"), add
   a daily seed with a lightweight leaderboard (a serverless KV), and use a share text like "#3 today on Extinction
   Avenue".
3. **Dynamic share card.** Render a results image (score, build icons, a frozen frame of the T. rex) to a canvas, offer
   it as a download or Web Share API attachment, and serve per-run OG images so links unfurl with the player's own
   moment.
4. **Photo mode.** Pause, free camera, filters and a logo watermark. The city plus neon dinosaurs is screenshot bait.
5. **Shorter time-to-T. rex for first sessions.** Consider a "Rex Rush" quick mode (a 3-minute run straight to
   GRIDLOCK), since the cameo and the boss are the hook.
6. **Swap in hero art first:** the T. rex, the raptor and the cab. Follow the `docs/ART_PIPELINE.md` priorities:
   CC0 bases plus a commissioned hero rex.
7. **Stages 2 and 3** (Hudson Leviathan, Skyline). Each new boss is a new trailer moment, and each unlock gives
   players something to post.
8. **Creator hooks:** a clean `?clip` mode (no HUD, god mode, cinematic camera on boss events) and a press kit with
   GIFs.
9. **Performance on mobile:** a dedicated lightweight city LOD for phones, since a smooth mobile experience is what
   lets a share link convert.
