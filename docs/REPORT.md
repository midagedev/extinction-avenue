# EXTINCTION AVENUE — Report (v2: first-person rear gunner · v3: rigged creatures & touch aiming)

**Repo:** `/workspace/dino-game` (local git, never pushed) · **Screenshots:** `/workspace/dino-game-shots/v2/`,
`/workspace/dino-game-shots/v3/`
**One-liner:** *Rush hour just went Cretaceous.* Cretagen's specimens are loose in Midtown and they're chasing your cab.
Unit 77 drives itself down the real avenues; you ride the tail gun, facing backward, and shoot everything that runs
you down. It ends with **GRIDLOCK**, a T. rex that chases the cab down the avenue, pulls up beside it, and finally
charges head-on.

The game is built on mrdoob's MIT-licensed [Slop New York](https://github.com/mrdoob/slop-newyork) (three.js
WebGPURenderer + TSL). The original free-roam sim still works at `sim.html`. The LICENSE, the OSM / NYC Open Data
attribution and mrdoob's credit are kept in the README, on the title screen and in ASSETS.md.

---

## v3: real creatures and touch aiming (2026-10-27)

The owner's v2 feedback: *"The enemy quality is too low. They're low-poly."* and *"On touch, my finger covers the
actual crosshair too much."* Screenshots: `/workspace/dino-game-shots/v3/` (close-ups, pack, pterosaur, chargers,
T. rex hero / chase / lunge, seven BEFORE/AFTER side-by-sides, phone portrait + landscape, model line-ups).

### Creatures

| Species | Model | Triangles (LOD0 / LOD1) | Animation |
|---|---|---|---|
| Scuttler, Sicklejaw, Brute, **GRIDLOCK** | damik's CC0 sculpt (colour + normal maps), **rigged here** (27 bones) | 22,294 / 6,689 | procedural keyframes: run & walk (leg IK, planted feet), idle, crouch, pounce, bite, roar, throw, hit, death |
| Hornwall | Quaternius CC0 Triceratops, refined (crease-aware Loop ×2) | 21,216 / 5,304 | its own 6 clips (run, walk, idle, attack, jump, death) |
| Spiketail (was Clubtail) | Quaternius CC0 Stegosaurus, refined | 36,448 / 9,112 | its own 6 clips |
| Skyreaver | procedural high-detail pterosaur (last resort, original CC0) | 17,508 | procedural fly, hover-screech, dive, hit, death |

- **Why this mix.** The only CC0 rigged+animated dinosaurs are Quaternius' 1.2–2.3k-triangle flat-shaded pack — the
  low-poly look the owner rejected. The only CC0 high-detail dinosaur (damik, 22k triangles, baked maps, modelled
  teeth) has no rig. So I rigged the sculpt (skeleton placed from measured orthographic views, neighbour-limited
  distance weights, geodesic jaw/skull split so the teeth follow the right jaw) and generated its clips; the
  Quaternius rigs I refined into smooth meshes that keep their skeletons and clips. No CC0 rigged ankylosaur or
  pterosaur exists: the armoured slot reuses the stegosaurus (renamed Spiketail, its tail-swing clip is the swipe), and
  the flyer is procedural. Details and license evidence: `ASSETS.md`, `assets/licenses/`.
- **One sculpt, four animals.** Bone-scale morphs baked through FK (non-inheriting scale, children re-attached at the
  scaled offsets): the compy has a juvenile head, the brute a heavier body, and GRIDLOCK a ×1.48 head, short thick neck,
  ×0.42 arms and a heavier body. Shader recolour by a luminance ramp keeps the sculpt's baked shading; rest-space
  stripes, blotches and countershading differ per species; every individual gets a small brightness/hue and scale
  variation so packs don't look cloned.
- **Rendering: GPU-instanced skinning** (`skin-rig.js`). The CPU samples each individual's clips (two cross-fading
  clips + a hit-flinch overlay + procedural head-look and jaw) into 3×4 bone matrices, one texture row per individual;
  one instanced draw call per species and LOD skins them with texelFetch. LOD1 kicks in when an animal is small on
  screen; off-screen individuals are skipped. PBR material: albedo + tangent-space normal map (sculpt) or a procedural
  domed-scale bump that fades out below ~3 px per scale (no speckle), roughness from the albedo, a cool rim light for
  silhouettes, separate white hit flash and red-hot attack-telegraph glow, elite rim, stone blend for the fossilise /
  shatter death (unchanged, no gore).
- **Hero T. rex.** Roars on the reveal and the summon, crouches on every telegraph, bites on lunges and door hits, swings
  its head to throw cars, flinches on staggers, collapses on death; its head turns toward the gunner's camera in the
  reveal, roars, telegraphs and the chase. The glowing collar (weak point) is a rigid attachment on the neck bone.
- **Fallback.** `?procedural` (or a failed load) draws the v2 rigs.

### Touch aiming

- **Default: drag anywhere (trackpad).** The crosshair moves by the finger's delta (gain ×0.8–1.9 with speed, scaled to
  the screen, slowed to ×0.62 over a target), stays where it is when the finger lifts, and the finger never sits on it
  (measured minimum distance in the tests: 147–293 px).
- **Firing: target-gated auto-fire while the finger is down.** It fires while the crosshair is on a dinosaur, a thrown
  car or a supply drop (0.14 s grace). Why not a fire button: on a phone held in one hand (portrait) a second thumb
  isn't free, and a fire button competes with RELOAD/SKYHAMMER for the same thumb zone; gating on targets means a
  resting finger never wastes the belt.
- **Offset mode** (Settings → Touch aim): the crosshair floats 96 px above the finger and fires while held.
- **Mild aim assist (touch only):** a gentle pull toward the nearest head / collar / thrown car within ~10 % of the
  screen, too weak to drag the crosshair off a target the player is tracking.
- **Layout:** phones start in touch mode, the crosshair scales with the short side (62 px on a phone), portrait widens
  the vertical FOV to keep ~52° across, the belt sits bottom-left, RELOAD / SKYHAMMER own the right thumb zone.

### Measured

- **Performance** (`tools/perf-creatures.mjs`, 40 animated dinosaurs on screen: 12 raptors, 12 compies, 4 brutes,
  2 Hornwalls, 2 Spiketails, 8 pterosaurs): **8 creature draw calls** (v2 rigid parts: 54), ~0.75 M creature triangles
  per frame (the city draws ~9 M), **0.10 ms/frame** CPU for animation sampling + bone upload (v2: 0.085 ms). GPU frame
  time can't be measured headless (SwiftShader). Download: +6.7 MB of models/textures.
- **Balance unchanged** (average-skill bot, seed 2, final build): GRIDLOCK reached at 6:38, killed at 8:01, 2 continues
  during the boss, 20 hits taken (417 damage), 790 kills, 131 headshots, peak 19 on screen, 0 page errors.
- **Touch:** `tools/e2e-touch.mjs` (Playwright, Pixel-class emulation, CDP touch events), 12 checks × portrait and
  landscape, all pass. `node --test tests/`: 113/113.

### v3 known issues

- The sculpt was modelled with a half-open mouth; at the T. rex's widest bite/roar the mouth corners stretch.
- The Spiketail is a stegosaurus stand-in, and the pterosaur is procedural — both because no CC0 rigged originals exist.
- The procedural theropod clips are hand-authored curves, not motion capture; the quadrupeds' clips are Quaternius'
  stylised ones (no hit-react clip, so their flinch is the root tilt only).
- Real-device GPU cost is unmeasured: the creature triangle budget is high for low-end phones; `?procedural` and
  `?quality=low` are the escape hatches. Touch aiming is emulator-tested, not yet tested on a physical phone.

---


## 1. How to run

```bash
cd /workspace/dino-game
python3 -m http.server 8123        # any static server works; file:// does not (ES modules + import map)
# open http://localhost:8123/
```

It's a pure static site with no build step, so it works on GitHub Pages as is (all paths are relative). three.js
loads from jsDelivr, **pinned to the dev-branch commit `3efcf0f` (2026-10-25)** instead of the moving `@dev` tag; see
§5 for why it isn't the npm release. Useful URL parameters: `?quality=high|medium|low`, `?webgl`, `?boss` (start just
before GRIDLOCK with a mid-game build), `?t=SECONDS` (skip ahead to a beat), `?god`, `?nointro`, `?test` (headless
stepping). README.md has the full table, the controls and the test commands.

## 2. What v2 changed, and why

The owner's two notes on v1 were "you die almost immediately after starting" and "it doesn't feel like a first-person
arcade game". The brief was an arcade-cabinet gun game (Time Crisis, House of the Dead, Let's Go Jungle). The owner's
clarification asked for the player to be the **rear gunner**, with dinosaurs chasing the vehicle from behind, and for a
readable number of enemies instead of a Vampire Survivors swarm. v2 rebuilds the play around that and keeps the city,
the creatures, the VS upgrade layer and the T. rex.

| | v1 | v2 |
|---|---|---|
| View | Third-person chase cam above and behind the cab | First person in the roof hatch, looking back over the tail gun (`camera.js` gunner mode) |
| Player's job | Steer, boost, brake, aim a roof cannon | Aim and shoot. The cab is fully on rails; the director sets speed and lane |
| Main gun | Projectile cannon, reticle snapping | Hitscan heavy MG on the crosshair ray: 30-round belt, reload, heat bloom, recoil, muzzle flash, headshots ×1.6, range falloff, view model with the gunner's hands (`gunner.js`) |
| Enemies | 140–580 on screen, contact damage | 5–20 normally, peaks 22–26 measured (cap 40), each worth shooting (HP ×2–3, bigger Scuttlers) |
| Damage to you | Any touch = a bite (≈70 hits/min) | Only telegraphed attacks; attack tokens; must be on screen first; shooting during the windup staggers them |
| Pacing | Endless spawn rate + timed events | Scripted beats: chases, combat zones (cab stops), storefront and side-street ambushes (view swings), pterosaur raids, mini-bosses, stampede, breather (`director.js`) |
| Pickups | Drive over them | Gene cores stream into the cab; supply drops float behind the cab and you shoot them |
| Boss | Lane dodging with steering | First-person chase: lunge (stagger it via the collar), thrown cars you shoot down, flank (view swings to it), head-on charge (view swings forward) |
| Death | Results screen | **CONTINUE?** with a 10 s countdown; free, but resets the combo multiplier |
| Title | START SHIFT | PRESS START · INSERT COIN · FREE PLAY |

### The rear-gunner camera
`GameCamera` gained a `gunner` mode: the eye sits 2.15 m up in the roof hatch, rigidly attached to the cab (no lag),
looking back down the road with a slight downward pitch. The car heading is smoothed a little through corners (the
turret has inertia), there's a speed-dependent road rumble, the view sways a few degrees toward the crosshair, and
recoil kicks the pitch. Directors and the boss can **swing** the view: ±66° out the side for ambushes, toward the T. rex
when it flanks, a full 180° when it charges head-on, a slight upward tilt for pterosaur raids and the boss chase. The
transition from cinematics into the hatch is blended in car space, so it travels with the moving cab.

### The aimed gun is the star
`_updateAim()` casts a ray through the crosshair every tick; whatever is under it is the target, and the view-model
gun swivels toward it. Each round is a hitscan along that ray (with spread that grows while the trigger is held)
against two hit spheres per dinosaur (body + head, taken from each model's rest pose), the boss's weak-point spheres,
thrown wrecks and floating supply drops. Hits flash the dinosaur white, make it flinch (the whole rig tilts back), knock
it back along the road, and pop hit markers on the crosshair (gold for weak points, red on a kill). The belt holds 30
rounds (45 at level 3) and reloads by itself when empty (1.25 s, RELOAD! callout); R or right click reloads early.
The Tail Gun levels up like any VS weapon and evolves into the piercing **Rail Lance**. The support weapons now face
the pursuers (rear-facing sentries, tailgate buckshot, saws whirling behind the cab), and the passives that made no
sense on rails became Extended Mag, Stopping Power (stagger) and Gene Magnet (+XP).

### Enemies and fair attacks
Ground pursuers live in **route space** (arc length + lateral offset along the patrol loop), the same coordinate
system the boss used in v1. They always run down the road behind the cab, face the gunner and fill the frame. Spawns
from side streets and smashed storefronts first merge onto the road in world space (sliding along building walls).
Pterosaurs fly around a hover point behind the cab and dive at the gunner's face.

Every attack follows the same rules:
1. **Telegraph.** A windup (crouch / pawing with a red lane on the asphalt / screech), the rig pulsing red, and a red
   ring drawn on screen around its head that shrinks onto it as the attack comes, plus a rate-limited **DANGER!**.
2. **Attack tokens.** Only `maxAttackers` dinosaurs may be winding up or attacking at once: 0 during the 8 s opening
   grace, 1 early, 2–3 later, 2 during the boss fight.
3. **Shootable first.** A dinosaur may only start an attack after it has been on screen for 0.9 s and alive for 1.5 s.
4. **Stagger.** Damage landed during the windup or lunge builds a stagger meter (anything for a Scuttler or raptor,
   18–22 % of max HP for the big ones). Fill it and the attack is cancelled (STAGGER! +score).
5. **No contact damage.** Touching the cab does nothing; the cab only takes damage when an attack lands.

Hits on the player: camera shake, chromatic aberration, a red edge flash, a cracked-glass splat where the attacker
was, a big red damage number, the hull bar shakes, and the combo resets. A short invulnerability window (0.45 s)
prevents stacked hits.

### Arcade structure
`director.js` is a script of 13 beats (README and `docs/ROADMAP.md` list them). Each beat sets the cab's speed (0 in
combat zones, up to 18 m/s in the avenue chase), the cap and minimum of pursuers in play, attack tokens and telegraph
length, plus a small program of spawns and set pieces. Combat zones end when the area is cleared (ZONE CLEAR + a
bonus that shrinks with time + a repair drop) or when they time out. A mercy rule floats a repair drop behind the cab
when the hull falls below 40 % (at most once every 18 s). The T. rex cameo now crosses the street *behind* the cab,
in full view.

### GRIDLOCK
It still lives on the route at (arc length, lateral offset), now 22–27 m behind the cab, so it fills the rear view.
- **Phase 1:** lunge at the tailgate (1.6 s telegraph, a danger ring with a gold stagger meter around the collar) and
  wrecked cars thrown in high arcs that you can shoot out of the air (SHOT DOWN! +1500).
- **Phase 2 (66 %):** adds flank runs, where it pulls up beside the cab and the gunner's view swings to face it before
  the head-butt, and roars that call raptors.
- **Phase 3 (33 %):** faster telegraphs, double lunges, the collar at ×3.5, and the head-on charge. It overtakes,
  turns around ahead of the cab, the view swings forward over the hood, and it charges down a red lane.

Any attack can be stopped by landing about 2.6–3 % of its max HP during the telegraph (in practice: hit the collar),
which staggers it and opens a 2.2 s window of +50 % damage. The death sequence is unchanged (hit-stop, slow motion,
orbit camera, topple, stone, shatter, APEX DOWN, +50,000).

### Continue
On a wreck the camera orbits the burning cab, then **CONTINUE?** counts down from 10 (click / Enter / Space). Continuing
is free: full hull, every dinosaur near the cab is blasted away, a 4 s grace period, a fresh belt, and the boss (if it
was up) drops back to chase distance. It resets the combo multiplier, and the results screen and share text show the
number of continues ("with no continues" is a brag line).

## 3. Why players died "almost immediately" in v1 (diagnosis)

I reproduced it with real Playwright input before changing anything:
- **The live Pages build was byte-identical to the local HEAD** (`.tools/live-diff.mjs`), so it wasn't a deploy
  mismatch.
- **There was no crash and no one-shot kill.** Stepping the simulation at 60 Hz with real DOM mouse/keyboard events,
  I ran six newcomer profiles: mouse wiggler, idle, holding W like a gas pedal, holding S, mashing the arrows, and a
  player who never fires and only picks passives. None died in the first minute. The real-time loop can't be timed in
  this sandbox (SwiftShader renders about 0.4 fps), but it runs the same `tick()` with dt clamped to 50 ms, so it
  behaves the same.
- **What the player experienced instead** (`.tools/repro-visibility.mjs`, 60 s with the mouse held down):
  - the first hit landed at **2.5 s**;
  - **70 hits in the first minute**, every one with a red flash, shake, a −2 number and a hurt sound;
  - **up to 215 dinosaurs on screen**, 1,740 kills in the first minute;
  - a stampede of 45 at 0:04 and of 90 at 0:26;
  - every hit was untelegraphed contact damage: a Scuttler touching the cab bit it.

  The hull bar visibly drained from the second second while the screen flashed red, and the cause was buried in a
  swarm. A player who didn't realize they had to *hold* the button (clicking does very little) and picked passives
  died at **1:54**, inside the first raptor stampede. That's what "you die almost immediately" describes.

**The fix is structural, not a number tweak.**
- Nothing damages the cab by contact any more.
- Every attack is telegraphed, gated by attack tokens, needs the attacker to have been on screen first, and can be
  cancelled by shooting it.
- An 8 s grace period at the start and 4 s after a continue.
- The first minute runs with one attacker at a time and the longest telegraphs (1.15–1.25 s windups).
- Low early damage: Scuttlers deal 3, raptors 6.
- Health comes from shootable repair drops, including a mercy drop when the hull falls below 40 %.
- Readable enemy counts.

## 4. Balance numbers (measured)

All runs: `tools/e2e-v2.mjs`, headless Chromium, real Playwright mouse events, sim stepped at 30 Hz, seeded RNG.
The bot picks the most urgent on-screen threat (attackers first, then thrown cars, then the closest, supply drops when
calm). It reacts to a new target after a human delay, moves the mouse at a capped speed, aims with drifting Gaussian
noise, and only holds the trigger when the crosshair is near the target. It picks upgrades as a player would
(evolution > Tail Gun > new weapon > passive) by clicking the cards.

| Profile | Reaction | Mouse speed | Aim noise σ | Reached GRIDLOCK | Boss fight | Deaths | Hits taken (dmg) | Peak on screen |
|---|---|---|---|---|---|---|---|---|
| Idle (never touches anything) | — | — | — | — (wrecked at **62.8 s**) | — | 1 | first hit at 11–16 s | 20 |
| Weak (skill 0.35, seed 6) | 0.37–0.64 s | 1,065 px/s | 40 px | **6:35** | 81 s | 1 (at 7:17, mid-boss; continued and won) | 23 (416) | 19 |
| Average (skill 0.6, seed 4) | 0.28–0.49 s | 1,394 px/s | 23 px | **6:34** | 75 s | 0 (lowest hull 6) | 14 (265) | 26 |
| Average (skill 0.6, seed 7, after the pterosaur fix) | 0.28–0.49 s | 1,394 px/s | 23 px | **6:35** | 86 s | 1 (phase 3 at 7:36; continued, won at 8:01) | 20 (424) | 24 |
| Attentive (skill 1, seed 5) | 0.22–0.38 s | 1,800 px/s | 14 px | **6:35** | 43 s | 0 | 3 (64) | 15 |
| Attentive (skill 1, seed 3, boss HP 21k) | 0.22–0.38 s | 1,800 px/s | 14 px | 6:35 | 45 s | 0 | 8 (185) | 22 |

Other measured numbers: 790–1,000 kills per run, 12–20 % of kills were headshots, 10–44 staggers per run, level
19–25 by the boss. For comparison, the v1 bot died at about 4:00 and never reached the 7:30 boss. Now the nominal
boss time is 7:17 and in practice it's 6:30–6:35, because combat zones and mini-boss beats end early when cleared.

Key tuning values: hull 100 (+20 per Reinforced Chassis); Scuttler 18 HP / 3 dmg; Sicklejaw 55 / 6; Brute 260 / 11;
Hornwall 650 / 15; Clubtail (v3: Spiketail) 800 (40 % armor except the head) / 12; Skyreaver 35 / 6; enemy HP ×(1 + t/520) and
damage ×(1 + t/700); windups scale from ×1.0 early to ×0.77 in the stampede (a raptor's 1.15 s → 0.9 s); Tail Gun 12 damage × 9 rounds/s, falloff to 55 % at
55 m+; GRIDLOCK 30,000 HP.

## 5. Verification

- **Screenshots** (`/workspace/dino-game-shots/v2/`, produced by `node tools/e2e-v2.mjs shots`):
  - `00` title (PRESS START / INSERT COIN)
  - `01` first-person view with crosshair, gun and a danger ring
  - `02` combat zone with an ambush
  - `03` level-up cards
  - `04` pterosaur diving at the gunner
  - `05` side-street ambush with the swung view
  - `06` CONTINUE? countdown
  - `07` T. rex reveal
  - `08` T. rex chase in first person
  - `09` lunge telegraph with the stagger meter
  - `10` flank (view swung to the side)
  - `11` phase 3 head-on charge (view forward over the hood)
  - `12` death
  - `13` results (from the weak-bot full run with one continue)
- **0 page errors** in every v2 run (smoke, idle, bots, shots).
- **`node --test tests/`: 113/113 pass** (the original sim's unit tests, `sim.html` unchanged apart from the pin).
- **three.js pin.** I first pinned to the npm release 0.186.1, which has every API the game imports, but the city's TSL
  materials then fail to compile on WebGL2 (`nodeAttribute… undeclared identifier`). Pinning to the exact dev-branch
  commit (`3efcf0f`, byte-identical to what `@dev` served on 2026-10-26) keeps the tested code and stops future dev
  pushes from breaking the live game. Both `index.html` and `sim.html` use it.

## 6. Known issues and limitations

- **Bot-tuned, not human-tuned.** The bots have human-like limits, but a real first-time player is still the real test.
  If players find it too easy, lower `wind` (telegraph length) and raise `atk` (attack tokens) per beat in
  `director.js`; the boss HP is one number in `boss.js`.
- **Real-GPU frame rate is unmeasured.** Headless SwiftShader renders at about 0.4 fps, so the real-time loop wasn't
  timed. The simulation is far cheaper than v1 (tens of dinosaurs instead of hundreds), and the city is unchanged.
  Phones will probably want `?quality=low`.
- **Touch** was reworked in v3 (drag aiming, see above); still untested on a real phone.
- **The view model is procedural low-poly** (gun + gloves + sleeves). It reads as a pintle MG, but a modelled gun and
  hands would be the single biggest visual upgrade (asset slots `tailGun` / `tailRail` / `hatchRim` in `assets.js`).
- **Audio** reuses the v1 procedural set and hasn't been mixed on speakers. There's no dedicated reload or "danger"
  sound yet (reused UI blips).
- **Hit spheres** come from the rest pose plus flinch and lift, not from the animated parts, so a lunging raptor's
  head sphere can be off by a few dozen centimetres. It's generous enough not to feel unfair.
- Corners: pursuers in route space follow the road around corners; the camera turns with the cab, so a pack can be
  out of view for a second after a turn (they can't attack while off screen).
- Debug flags (`?god`, `?boss`, `?t=`) stay public; they're handy for creators recording clips.

## 7. Next steps

1. **A human playtest pass:** five new players, one run each. Watch where they first take damage and whether they
   notice the red ring.
2. **Hero art:** the gun view model and gloves, then the T. rex (see `docs/ART_PIPELINE.md`).
3. **Light-gun polish:** a reload-by-shooting-offscreen option (true arcade style), recoil patterns per weapon,
   per-species death reactions, dedicated SFX for DANGER! and reload.
4. **Clip tools:** a `MediaRecorder` buffer of the last 15 s, saved on the boss kill.
5. **Stages 2 and 3** (`docs/ROADMAP.md`) fit the beat director as new beat lists and routes.
