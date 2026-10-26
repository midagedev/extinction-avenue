# EXTINCTION AVENUE — Art Bible & Asset Production Pipeline

> Status: every model, icon, effect and sound in the game is currently **procedural placeholder art generated in code**
> (see [`/ASSETS.md`](../ASSETS.md)). This document is the contract for replacing it with authored assets without
> touching gameplay code, plus the production plan for doing so.
>
> Source of truth (read these when in doubt — this doc is derived from them):
> `js/game/assets.js` (manifest + loader), `js/game/rig.js` (rig format + shader), `js/game/dino-models.js`
> (creature placeholders), `js/game/poses.js` (procedural animation), `js/game/props.js` (prop placeholders),
> `js/game/vfx.js` (effects), `js/game/icons.js` (UI icons), `js/game/audio.js` (sound + music),
> `js/game/player.js` (car mount points), `js/game/camera.js` (chase camera), `js/game/world.js` + `js/lighting.js`
> (post-processing, lighting looks).

---

## Contents

1. [Game & tone in one paragraph](#1-game--tone-in-one-paragraph)
2. [Target art style: "Neon Cretaceous"](#2-target-art-style-neon-cretaceous)
3. [IP & brand guardrails](#3-ip--brand-guardrails)
4. [Technical conventions](#4-technical-conventions)
5. [Full asset list & specs](#5-full-asset-list--specs)
6. [Production routes](#6-production-routes)
7. [Blender workflow](#7-blender-workflow)
8. [Validation checklist](#8-validation-checklist)
9. [Prioritized roadmap](#9-prioritized-roadmap)
10. [Known gaps in the code that affect art](#10-known-gaps-in-the-code-that-affect-art)

---

## 1. Game & tone in one paragraph

Specimens have escaped from **Cretagen**, a fictional biotech company, and flooded an evacuated Manhattan. You drive
**Unit 77**, an armored yellow cab run by **Big Apple Animal Control**, down the avenues in an on-rails arcade car
shooter that turns into a Vampire-Survivors-style bullet heaven: hundreds of dinosaurs on screen, an auto-firing build
that grows across the car's bodywork, and boss chases. Dinosaurs never bleed: they **fossilize**. They turn to stone,
shatter into stone shards and release glowing cyan **gene energy**, which you collect as XP. The tone is
**pulpy, loud and gore-free**: Saturday-morning creature feature meets a synthwave arcade cabinet.

---

## 2. Target art style: "Neon Cretaceous"

### 2.1 Pillars

| Pillar | What it means in practice |
|---|---|
| **Silhouette first** | Every creature must read by outline alone at chase-camera distance (see 2.3). Exaggerate the one feature that identifies the species: the sickle claw, the frill, the tail club, the wing crest, the huge skull. |
| **Faceted low-poly** | Flat-shaded triangles, visible facets, no smoothing groups. The rig material is `flatShading: true` and the loader recomputes normals, so smooth normals are thrown away anyway. |
| **Per-face color, no textures** | Color lives in vertex colors / material base colors (baked to vertex colors). Each face gets a small brightness jitter (placeholder: ×0.9–1.1) for the hand-cut toy look. |
| **Counter-shading** | Dark back, mid flank, light belly (placeholder blends by face normal: `back` for up-facing faces, `belly` for down-facing ones). This keeps forms readable under the low, warm blue-hour key light. |
| **Glowing containment tags** | Every specimen carries emissive Cretagen "containment tag" markings: stripes, studs, collar lights. They are what makes the creatures pop through the bloom at night. |
| **Twilight city** | Blue hour (19:15): cool fog, warm low sun, wet roads, neon emissives blooming. Creatures are the most saturated thing on screen; the city stays desaturated and cool. |

### 2.2 Palette rules

All values below are taken from the placeholders (`PAL` in `dino-models.js`, `C` in `props.js`). Hex values are
sRGB; glow multipliers are the HDR emissive intensity (emissive = color × multiplier).

**Creature base palettes (sRGB hex)**

| Species (game name) | back | base | belly | accents | tag glow (×intensity) |
|---|---|---|---|---|---|
| compy (Scuttler) | `#3f5a17` | `#86ad2c` | `#e4e9b4` | mouth `#7a2f2a`, claw `#2a2618` | lime `#c8ff3a` ×4.5 |
| raptor (Sicklejaw) | `#8a3a14` | `#d0682a` | `#f2dfb6` | stripe `#3e1e0e`, feather `#5a2814`, featherTip `#e8b070`, tooth `#f4ecd8` | cyan `#28e0ff` ×5 |
| brute (Brute) | `#23282f` | `#56677c` | `#a9b4c2` | stripe `#1b1f25`, feather `#2c3440`, featherTip `#8fa3b8` | mint `#14ffc0` ×4.5 |
| trike (Hornwall) | `#45461c` | `#8e8946` | `#d2c99c` | horn `#f2ecd8`, beak `#2a2520`, frill `#6e5a24`, frillIn `#9a3a14` | orange `#ff6a10` ×5.5 |
| ankylo (Clubtail) | `#8b6a3e` | `#c9a270` | `#e8d4a8` | armor `#4a3524`, armorLight `#6e5236`, horn `#e6dcc0` | amber `#ffa018` ×5 |
| ptero (Skyreaver) | `#2c1a5c` | `#5c3ea0` | `#d8caf2` | beak `#d8c8a0`, crest `#3a1f70` | magenta `#ff1ad0` ×5.5 |
| trex (GRIDLOCK) | `#1a2419` | `#33452d` | `#a38a50` | mottle `#0e140e`, armor `#3c4048`, armorLight `#5c626c`, tooth `#f0e6cc` | orange `#ff5a0a` ×5.5, eyes `#ff7a10` ×8 |

Rules:

- **Albedo range:** keep base colors between roughly sRGB 30 and 230 per channel (linear 0.01–0.8). Pure black
  disappears in the fog; pure white blooms when the hit-flash adds `+0.6` white.
- **One hue family per species** plus one tag-glow hue. Species must be distinguishable by color at a glance:
  green (compy), rust-orange (raptor), slate (brute), olive (trike), sand (ankylo), violet (ptero), near-black green (trex).
- **Glow lives only on tags.** No more than ~8–12 % of a creature's visible surface may be emissive; the rest must
  stay lit, so the fossilize effect (which kills emissive) visibly "switches the creature off".
- **Fossil stone** is fixed in the shader: `uStone` = linear (0.42, 0.40, 0.37), roughness → 0.95. Do not paint stone.

### 2.3 Readability at chase-camera distance

The chase camera (`camera.js`) sits **12.5–15 m behind and 7.4–8.2 m above** the car, looks **16 m ahead**, with a
**60° vertical FOV (69° while boosting)**. At 1080p that gives roughly:

| Distance to subject | Pixels per metre (1080p) | Scuttler (1.4 m) | Sicklejaw (4 m) | Hornwall (8 m) | GRIDLOCK (13 m) |
|---|---|---|---|---|---|
| 20 m | ~47 px/m | ~65 px | ~190 px | ~375 px | full screen |
| 40 m | ~23 px/m | ~33 px | ~92 px | ~185 px | ~300 px |
| 80 m | ~12 px/m | ~16 px | ~47 px | ~94 px | ~150 px |

Consequences:

- A Scuttler is **~30 px long** in typical play. It needs a single strong shape (wedge body + long tail + bright lime
  back studs); fine detail is wasted triangles.
- Design every creature from a **side silhouette and a top-down silhouette** (the camera mostly sees backs and
  flanks from above-behind). Glow tags belong on the **back and upper flanks**, where the camera sees them.
- Test in grayscale: if two species blur together as gray blobs at 40 m, push the silhouettes further apart.
- The rig shader adds a cool **rim light** (`(0.5, 0.65, 0.9) × rim³ × 0.35`) to keep silhouettes off dark asphalt;
  do not fight it with dark outlines.

### 2.4 Emissive color language (what each color *means*)

| Color | HDR value used in code | Meaning | Where |
|---|---|---|---|
| **Cyan** `#2cf6ff`-ish | gene energy glow (0.4, 3, 3.6); `cyanGlow` (0.3, 3.2, 3.8) | **Gene energy & friendly Cretagen/Animal Control tech**: good, collectable or yours | fossil-shatter wisps, turret strips, tesla rings, rail coils, crate seams, cyan-plasma explosions, big-text damage numbers |
| **Magenta** | elite rim `uEliteGlow` (4, 0.6, 2.4); elite shatter (4, 0.8, 3.5) | **Elite**: tougher than normal, drops a supply crate | Fresnel rim over the whole silhouette of elites (1.3× scale, 7× HP) |
| **Red / red-orange** | telegraphs (5, 0.4, 0.3); `redGlow` (4, 0.25, 0.15); threat arrows `#ff3b3b` | **Danger: get out of this area now** | ground circles and lanes before attacks, missile tubes, mine lights, off-screen threat arrows, player-damage numbers `#ff4040` |
| **Orange** | stomp telegraph (5, 0.9, 0.2); `orangeGlow` (4, 1.4, 0.2) | **Heat / impact / imminent area damage** | stomp & swipe rings, muzzles, saw teeth, exhaust nozzles, boss collar lock |
| **Green** | `greenGlow` (0.4, 3.6, 0.8); heal numbers `#4dffa0` | **Healing / repair** | repair kit plus sign |
| **Gold** | crit numbers `#ffd23a` | **Critical hit / top-tier reward** | crit numbers, gold gene cores |
| **White** | hit flash (+5 emissive), screen flash | **Impact feedback** | the frame a creature is hit; boss death and airstrike flashes |

Gene core tiers (`gem` prop tinted per instance): **green → blue → violet → gold** (tier 1→4).

**Rules of separation:**

1. **Ground = threat, body = identity.** Danger telegraphs are always flat, pulsing decals on the ground plane;
   creature tag glows are always on the body. Never put red/orange decals on a creature's body or tag colors on the ground.
2. **Magenta is reserved for the elite rim.** *Known conflict:* the Skyreaver placeholder uses magenta tags
   (`#ff1ad0`). Recommendation for authored art: shift Skyreaver tags to **ultraviolet `#9a5cff`** so elites stay unambiguous.
3. **Cyan is reserved for gene energy and the player's tech.** The Sicklejaw's cyan tags (`#28e0ff`) are allowed
   because they read as Cretagen containment hardware; don't add more cyan-tagged species.
4. Heavy species (Hornwall, Clubtail, GRIDLOCK) use **orange/amber tags**. That's acceptable because their attacks are
   telegraphed on the ground in red-orange. Keep their tags thin (stripes, studs, collar) so they never read as a decal.

### 2.5 Lighting, fog, bloom expectations

Author and review assets under the game's **twilight** look (`lighting.js` preset `twilight`, `world.js` `LOOKS.twilight`):

| Parameter | Value |
|---|---|
| Key light | sun `#ff9466`, intensity 3.1, low (elevation ~21°) |
| Hemisphere | sky `#4c6ca8` / ground `#6e5048`, intensity 0.85 |
| Sky | top `#102248` → horizon `#b86b6c` |
| Fog | `#353c58`, exp² density 0.00032 |
| Tone mapping | ACES Filmic; look exposure 1.1, contrast 1.14, saturation 1.12 |
| Bloom | strength 0.55, radius 0.45, **threshold 0.95** (midnight: 0.6 / 0.85; golden: 0.42 / 1.1) |

Implications for artists:

- **Only emissive should bloom.** Emissive values of 4–8× (HDR) bloom; lit albedo shouldn't. If a lit surface blooms,
  it's too bright.
- **Materials are not PBR-textured.** The rig material is roughness 0.72, metalness 0 for all creatures (stone: 0.95).
  Car props use roughness 0.5, metalness 0.35. Roughness/metalness in your files is **ignored**: express
  material differences with color value and facet size.
- Check every asset in the **midnight** and **golden** looks too, so it works across the three looks.

### 2.6 UI typography & iconography direction

| Role | Typeface | Notes |
|---|---|---|
| Display: titles, boss names, big numbers, damage numbers | **Bebas Neue** (Google Fonts, OFL) | Damage numbers already request `'Bebas Neue', 'Anton', Impact` in `vfx.js`. All caps, tracking +2–4 %, black 4 px stroke on world-space numbers. |
| HUD labels, weapon names, level-up cards | **Chakra Petch** 600/700 (Google Fonts, OFL) | Squared, "industrial terminal" feel for Cretagen/Animal Control UI. |
| Body copy, settings, credits | **Inter** (already loaded, OFL) | Inherited from slop-newyork. |
| Street-name signs (world) | **Overpass** (already loaded, OFL) | Inherited; Highway-Gothic-like signage. |

Icons (`icons.js`): **48 × 48 grid, solid duotone in `currentColor`**. Three tones: P primary (solid), S secondary
(same hue at 42 % opacity, "back" parts), K shade (black at 38 % for detail on P). Strokes 2–5 px with round
caps/joins. No ids/defs/clipPaths (so copies can be inlined freely). HUD colors follow the emissive language in 2.4.
Boss title cards: Bebas Neue, wide letterspacing, with a Cretagen specimen code beneath (e.g. `APEX SPECIMEN T-01`).

---

## 3. IP & brand guardrails

This is an **original** dinosaur property. Every asset, sound and text must pass these checks:

**Never use:**

- Any *Jurassic Park / Jurassic World* names, places, companies or logos (the park names, InGen, Isla Nublar/Sorna,
  Masrani, BioSyn, named film animals, the T. rex-skeleton-in-a-circle logo, the amber-mosquito motif, the
  gate design, park jeeps/khaki-and-red livery, film merchandise styling).
- Film creature designs: the **frilled, venom-spitting dilophosaur**, hybrid dinosaurs (Indominus, Indoraptor or anything
  similar), the films' raptor heads, color schemes or striped "squad" raptors, the films' Mosasaurus feeding-show framing.
- Film music or sound: no film score motifs (avoid heroic brass fanfares in that style), no film roars, no sampling of
  film/TV audio. The T. rex roar is synthesized (`trex_roar` recipe) and must stay original.
- Real-world brands: no car makes/badges/grilles traceable to a manufacturer, no taxi-company or
  TLC/medallion marks, no MTA/NYPD/FDNY logos, no real biotech names, no ad billboards with real brands.
  Shapes like a generic 2000s sedan, a checker band, and roof light are fine.

**Always:**

- Use the game's own names: Cretagen, Big Apple Animal Control, Unit 77, Scuttler, Sicklejaw, Brute (Alpha), Hornwall,
  Clubtail, Skyreaver, GRIDLOCK, The Hudson Leviathan, Skyline, Skyhammer, gene cores.
- Make creature designs from paleo reference + our style (glow tags, counter-shading, original crests and color), not from
  film stills. For AI generation, **never put film/franchise names in prompts** (see 6.2).
- Keep it gore-free: no blood, wounds, entrails or corpses. Damage = cracks, sparks, glowing gene-energy fissures,
  broken containment hardware. Death = fossilize + shatter.

> Note: the icon set contains `x-logo` (the X / Twitter mark) for a share link. That's a third-party trademark used
> nominatively; keep it limited to the share button, or replace it with a generic "share" glyph.

---

## 4. Technical conventions

### 4.1 Units, axes, origins

| Rule | Value |
|---|---|
| Units | **metres** (1 unit = 1 m). Author at real final size; no import scaling is applied. |
| Up axis | **+Y up** (glTF). In Blender: Z-up, the exporter converts. |
| Forward | Creatures, car and directional props face **+Z** (snout/nose/barrel/muzzle). In Blender: face **−Y**. |
| Handedness | Right-handed. For a creature facing +Z, **+X is the creature's LEFT**. Left-side parts end in `L` and sit at +X. |
| Creature origin | On the ground (y = 0), **under the hips**, in the natural standing zero pose with feet on y = 0. Exception: **ptero** (origin at the body centre, wings spread flat; altitude comes from gameplay). |
| Prop origin | Prop "pivot" as listed per prop in 5.4 (bottom centre for pickups, mount point for attachments, centre for projectiles/debris). |
| Rotation order | Joint rotations are Euler **YXZ** (yaw, then pitch, then roll), radians. |

**Joint rotation sign conventions** (from `dino-models.js` / `poses.js`). Author rest poses so these hold:

- `+x` on a **jaw** opens the mouth; on a **tail** segment lifts it; on a **neck/head** pitches it down.
- `+x` on a **thigh/leg/arm** swings the foot backward (−x steps forward); `+x` on a **shin** bends the knee.
- `+z` on **wingL** raises its tip; **wingR** mirrors (−z raises).
- Legs hang along −Y, tails run along −Z, necks/heads along +Z from their joints.

### 4.2 Asset ids and the manifest

Every drawable asset is an entry in `ASSET_MANIFEST` (`js/game/assets.js`):

```js
const ASSET_MANIFEST = {
  playerCar:  { kind: 'car',  url: null, placeholder: 'taxi' },
  turretGun:  { kind: 'prop', url: null, placeholder: 'turretGun' },
  raptor:     { kind: 'rig',  url: null, placeholder: 'raptor', capacity: 240 },
  // ...
};
```

- **`kind: 'rig'`** = creature (instanced rigid-part rig). **`kind: 'prop'`** = one merged instanced mesh.
  **`kind: 'car'`** = player car glTF (loaded as a full glTF scene).
- **`url: null`** = use the procedural placeholder. **Set `url` to a GLB to swap it in.** No other code changes needed
  for rigs and props.
- If the GLB fails to load, the game logs
  `[assets] <id>: <url> failed, using the placeholder` and falls back automatically.
- `capacity` = max simultaneous individuals of that species (instances allocated up front).

**Example: swapping in an authored Sicklejaw and gene core**

```js
// js/game/assets.js
raptor: { kind: 'rig',  url: './assets/models/creatures/raptor.glb', placeholder: 'raptor', capacity: 240 },
gem:    { kind: 'prop', url: './assets/models/pickups/gem.glb',      placeholder: 'gem' },
```

URLs are resolved relative to `index.html`. Proposed folder layout:

```
assets/
  models/creatures/<id>.glb      compy, raptor, brute, trike, ankylo, ptero, trex (+ trex_p2, trex_p3 later)
  models/car/<id>.glb            playerCar (+ variants), turret*, att*
  models/pickups/<id>.glb        gem, crate, repair, nitro, vacuum, airstrike
  models/fx/<id>.glb             tracer, missile, mine, saw, shard, boulder, wreck
  textures/vfx/<name>.png        (future, see 5.6)
  audio/sfx/<name>_<n>.ogg       (future, see 5.8)
  audio/music/<state>.ogg        (future)
  source/                        .blend / .spp source files (not shipped)
```

The **placeholder keeps supplying metadata** even when a GLB is used: `radius`, `length`, `height`, `width` and
**sockets** (mouth, weakNeck, …) come from the placeholder model. So **a replacement must match the placeholder's
proportions and feature positions** (±10 % on dimensions, sockets within ~5 cm). The tables in 5.3 list them.

### 4.3 The rig node-naming contract (creatures)

A creature GLB is converted by `loadRigGLB()`:

1. It searches the glTF for **nodes whose names exactly match the placeholder's part names** (case-sensitive).
2. If it finds `body` **and** at least 2 matching names, each named node becomes a rig part:
   - **pivot** = the node's world position expressed in its parent part's frame (root: relative to the creature origin);
   - **geometry** = every mesh under that node that isn't under a deeper named part, baked into the node's frame.
3. Otherwise **all meshes are merged into one `body` part**. The creature then becomes a rigid statue that slides
   around with only a procedural bob: not acceptable for shipping, but useful as a quick scale check.

Contract rules:

| # | Rule | Why |
|---|---|---|
| R1 | **Every part name of the species must exist** as a node (an empty with no mesh is OK). | A missing parent breaks the hierarchy (child parts would reference a part that isn't there). |
| R2 | The **glTF hierarchy must match the part hierarchy** (`shinL` under `thighL` under `body`, …). | Pivots are computed relative to the named parent node. |
| R3 | Joint nodes carry **translation only**: rotation 0, scale 1 in the rest pose. | The rig composes `pivot + pose rotation`; any rest rotation/scale on a node is baked into the geometry and lost from the joint frame. |
| R4 | The **rest pose is the natural standing pose** (= pose of all zeros), feet on y = 0. | Procedural animation adds rotations on top of zero. |
| R5 | Node names: `body neck head jaw tail1 tail2 tail3 thighL shinL footL thighR shinR footR armL armR legL legR legFL legFR legBL legBR tail wingL wingTipL wingR wingTipR` as applicable (see 5.3). Extra nodes are allowed: their meshes join the nearest named ancestor. | Names drive both loading and animation. |
| R6 | three.js sanitizes glTF node names: whitespace → `_`, and `. : / [ ]` are **removed**. So Blender's `thigh.L` arrives as `thighL`. Duplicate names get a `_1` suffix, so **never duplicate a part name**. | `GLTFLoader` → `PropertyBinding.sanitizeNodeName`. |
| R7 | **No skinning, no morph targets.** Armatures/skins are ignored; vertices are rigidly attached to the part they sit under. | See 4.5. |

### 4.4 Vertex-color & emissive baking

Both rigs and props are drawn with **vertex attributes only**: `position`, `normal`, `color` (linear RGB) and
`emissive` (linear RGB, HDR). `bakeMeshGeometry()` converts each glTF mesh:

- `color` = material **baseColorFactor × COLOR_0** (vertex color, if present).
- `emissive` = material **emissiveFactor × emissiveIntensity** (`KHR_materials_emissive_strength`). This is per
  *material*, so glowing tags must use a **separate emissive material**.
- **Textures are ignored** (baseColor, emissive, normal, ORM maps are all dropped). Anything painted in a texture must be
  baked into vertex colors (face-corner domain for crisp per-face color) before export.
- **Normals are recomputed** from the triangles (the geometry is de-indexed first), which gives the faceted look.
  Authored smooth normals are discarded.
- Multiple materials per object are fine: glTF splits them into primitives, and each is baked with its own material.

Recommended material setup in Blender: one `Skin` material (white base, vertex colors carry the paint), plus one
emissive material per glow hue (`Glow_Tag`, `Glow_Eye`) with **Emission Strength 4.5–8** to match the placeholder HDR range.

### 4.5 Instancing implications: why rigid parts, not skinning

- Each **part** is one `THREE.InstancedMesh`. **A whole species costs one draw call per part**, however many
  individuals are on screen. Current totals: compy 8 + raptor 12 + brute 12 + trike 7 + ankylo 8 + ptero 7 + trex 15 =
  **69 draw calls for every dinosaur in the game**.
- Each frame the CPU writes **one 4×4 matrix per part per individual** (64 bytes). Worst case for Scuttlers alone:
  700 × 8 parts = 5,600 matrices ≈ 358 KB/frame. **Adding parts costs CPU + bandwidth linearly**, and new part names
  also need code in `poses.js`. Keep part counts as they are.
- **One material per species** (`createRigMaterial`), shared by all parts. Per-individual effects (hit flash,
  fossilize-to-stone, elite rim) come from one shared per-instance `fx` attribute. Per-part materials, textures or
  extra shader variants aren't possible without code changes.
- **Why not skinned meshes?** three.js `SkinnedMesh` can't be instanced out of the box: every individual needs its own
  skeleton, bone-matrix upload and draw call. Hundreds of skinned raptors would mean hundreds of draw calls and
  thousands of bone updates per frame, far beyond the budget of a WebGPU browser game running a whole Manhattan.
  Rigid parts give the same toy-like articulation at a fraction of the cost and match the faceted art style.

**Future skinned/VAT path** (needs code; spec it before commissioning skinned assets):

1. **Baked rigid clips (cheapest, fits the current rig):** keep rigid parts, but author glTF animation clips that
   rotate the named joint nodes. At load time, sample each clip at 30 fps into `Float32Array(frames × parts × 3)`
   (Euler YXZ) and let `poses.js` blend sampled frames instead of sine waves. The clip specs in 5.3 are written for this.
2. **Vertex Animation Textures (VAT):** bake a skinned clip into a texture (one texel row per frame, one column per
   vertex, RGBA16F positions + octahedral normals). A TSL vertex shader samples it by per-instance `clip` / `time`
   attributes. Cost per clip ≈ vertices × frames × 8 B (raptor ~1,000 unique verts × 60 frames ≈ 480 KB). Still one
   draw call per species, with true deformation. Good for the Leviathan and Skyline.
3. **Instanced GPU skinning:** all bone matrices for all instances in one storage buffer/texture, skinning in the
   vertex shader with `instanceIndex`. The most flexible option, but it costs the most to build and maintain.

If you commission skinned animations now, ask for **both** a skinned master file and a rigid-part export
(the same mesh split by dominant bone, see 7.4) so the work is usable today and later.

---

## 5. Full asset list & specs

Legend: **Tris** = triangles (LOD0). **Cap** = manifest capacity. Placeholder tris marked "≤" are the budget comments
in `dino-models.js`; "~" are estimates (exact value: `buildDinoModel('<id>').triangles` in the browser console).
**Texture:** every model asset is **vertex colors only** (textures are ignored by the loader).

### 5.1 Global budgets

| Category | Target tris (LOD0) | Hard max | Worst-case on screen |
|---|---|---|---|
| All creatures together | ~620 k | 1.0 M | capacity × tris (see 5.3) |
| Player car incl. all attachments | 8 k | 12 k | 1 |
| Prop instance (pickups/projectiles) | 20–200 | 400 | hundreds |
| Boss (single instance) | 8–12 k | 15 k | 1 |

### 5.2 Player vehicle & attachments

**Vehicles.** Kind `car`. Placeholder: the city's lofted taxi generator (`createTaxiModel` in `controllers.js`).

| Asset id | Description | Size (L × W × H) | Tris target / max | Pivot | Material notes |
|---|---|---|---|---|---|
| `playerCar` — **Unit 77** (base) | Armored yellow cab, Big Apple Animal Control. Generic 2000s full-size sedan, steel push bar, roof light replaced by a turret mast, welded mesh over rear windows, checker band, door decal "ANIMAL CONTROL · UNIT 77", cyan strip lights. No real make/badges. | ~4.9 × 1.95 × 1.5 m (roof ~1.5 m) | 6 k / 9 k | Ground centre between axles, +Z forward | Taxi yellow `#ffb000`-ish (props use linear `yellow` (1.0, 0.62, 0.02)), gunmetal trim, cyan emissive strips ×3–4 |
| `playerCar_courier` — **Unit 41 "Bodega Runner"** (unlock) | Boxy delivery van with a reinforced cargo box, roll-up rear door, roof rack. Tougher, slower variant. | ~5.4 × 2.05 × 2.4 m | 7 k / 10 k | same | Teal `#1aa39a` + white, amber strobes |
| `playerCar_sweeper` — **Unit 09 "Street Sweeper"** (unlock) | Municipal street sweeper: front rotating brushes (a natural Ram Plow look), cab-forward. | ~5.8 × 2.3 × 2.7 m | 8 k / 12 k | same | Municipal white/orange with hazard chevrons |
| `playerCar_neon` (cosmetic livery) | Unit 77 in "Night Shift" black/cyan livery: same mesh, different vertex colors. | as Unit 77 | (same mesh) | same | Matte black, cyan emissive pinstripes |

Required named nodes for car GLBs (**proposed contract**; the `car` kind is loaded but `player.js` still builds the
procedural taxi, see §10): `body`, `wheelFL`, `wheelFR`, `wheelBL`, `wheelBR` (wheel pivots at the hub, spin about X),
`chassisPivot` (body-roll pivot), and mount empties `mount_turret`, `mount_gatlingL`, `mount_gatlingR`,
`mount_missiles`, `mount_tesla`, `mount_flamer`, `mount_shotgun`, `mount_plow`. Until mounts are read from the file,
**variants must keep the current mount positions** (car frame, metres):

| Mount | Position (x, y, z) | Notes |
|---|---|---|
| Turret base | (0, 1.50, −0.62) | Yaw pivot at (0, 1.98, −0.62); pitch group at the yaw pivot |
| Hood gatlings | (±0.62, 0.86, 1.25) | Pair |
| Missile pod | (−0.35, 0.95, −1.95), scale 0.8 | Trunk |
| Tesla coil | (0.55, 0.95, −1.75) | Trunk |
| Exhaust flamer | (0, 0.42, −2.30) | Rear bumper, nozzles −Z |
| Bumper buckshot | (0, 0.36, 2.32) | Front bumper |
| Ram plow | (0, 0, 2.25) | Front |
| Armor plates | (0, 0, 0) | Side plates at x = ±0.96–0.99 |

**Turret & attachments.** Kind `prop`. Merged into one geometry each. Material at runtime: roughness 0.5, metalness 0.35.
Each attachment must look different enough to tell the build apart in screenshots.

| Asset id | Weapon / role | Placeholder tris | Target / max | Approx. size (W × H × L) | Pivot | Emissive |
|---|---|---|---|---|---|---|
| `turretBase` | Roof pedestal (all builds) | ~104 | 300 / 500 | 0.52 × 0.44 × 0.72 m | On the roof; top of ring mount at y = 0.42 | Cyan ring |
| `turretGun` | **Roof Cannon** (mouse-aimed main gun) | ~144 | 400 / 700 | 0.6 × 0.4 × 1.85 m | Yaw/pitch centre; barrel +Z, **muzzle at z ≈ 1.45** | Cyan side strips, orange muzzle ring |
| `railGun` | **Rail Lance** (Cannon evolution) | ~96 | 500 / 800 | 0.64 × 0.4 × 2.4 m | As `turretGun`; rails to z ≈ 1.95 | 4 cyan coils |
| `attGatling` | **Hood Gatlings** / Storm Gatlings (one side; used twice) | ~84 | 250 / 400 | 0.23 × 0.21 × 0.97 m | Mount point; barrels +Z | (Storm: add cyan arc rings) |
| `attMissiles` | **Swarm Missiles** / Cluster Barrage | ~168 | 300 / 500 | 0.72 × 0.38 × 0.58 m | Pod base centre; tubes +Z | Red tube mouths |
| `attTesla` | **Tesla Coil** / Thunderhead | ~256 | 300 / 500 | Ø 0.4 × 1.0 m | Base centre | Cyan rings + orb (1.5, 4, 5) |
| `attFlamer` | **Exhaust Flamer** / Inferno Wake | ~124 | 200 / 400 | 1.2 × 0.2 × 0.55 m | Bumper centre; nozzles −Z | Orange nozzles |
| `attShotgun` | **Bumper Buckshot** / Dragon's Breath | ~132 | 200 / 400 | 0.9 × 0.14 × 0.53 m | Bar centre; barrels +Z | — (Dragon's: orange) |
| `attPlow` | **Ram Plow** (passive) | ~148 | 300 / 500 | 2.2 × 0.85 × 0.6 m | Front bumper, centred | — (yellow/black hazard stripes) |
| `attArmor` | **Armor Plating** (passive) | ~144 | 250 / 400 | 2.0 × 0.34 × 2.52 m (both sides) | Car origin | — |
| *(new)* `attSaws` | **Hubcap Saws** mount hubs (blades are `saw`) | — | 150 / 300 | 4 hub caps | Wheel hubs | Orange teeth |
| *(new)* `attChassis` | **Reinforced Chassis** visual (roll cage / skid plates) | — | 300 / 500 | car-sized | Car origin | — |
| *(new)* `attTurbo` | **Turbo Kit** visual (hood scoop + side pipes) | — | 200 / 400 | — | Car origin | Blue-white pipe glow |

Evolutions: Rail Lance swaps `turretGun` → `railGun`. Storm Gatlings, Buzzsaw Halo, Cluster Barrage, Thunderhead,
Inferno Wake, Nova Mines and Dragon's Breath currently reuse their base mesh. Recommended: author an `*_evo` variant of each
(+20–40 % tris, extra cyan/orange emissive) so evolutions show on the car.

### 5.3 Creatures

Common to every species:

- **Elites** reuse the same model: runtime **1.3× scale** (±8 % random size variation for all individuals),
  **7× HP**, **magenta Fresnel rim**, faster windups, and they drop a Cretagen supply crate. No extra mesh needed.
  Optional later: a small `<id>_elite` variant with a broken-open containment tag.
- **Hit react** today = white flash (`fx.x`, +5 emissive) + knockback. **Fossilize** today = the pose freezes
  (jaw opens +0.5 rad) while `fx.y` blends the colors to stone and kills emissive; then `vfx.shatter()` bursts
  stone shards + cyan gene wisps. Nothing has to be modelled for either.
- **Animation today is procedural** (`poses.js`): the gait phase advances with *distance travelled*. One full stride
  cycle (left + right step) covers **2π / (stride × 1.6) metres**. GLB clips for the future baked-clip path (4.5)
  should be **in-place** (no root motion), exactly **one stride cycle long**, and note the cycle distance below so the
  runtime can retime them by speed. Clips are named exactly as in the tables (lowercase snake_case), sampled at 30 fps.

#### Scuttler — `compy` (swarm)

| Spec | Value |
|---|---|
| Role | Swarm fodder; dies to ram contact; chirps |
| Cap | **700** |
| Size | ~1.4 m long, ~0.6 m tall (hip 0.4 m); gameplay radius 0.55 (model radius 0.30) |
| Tris | placeholder **≤ 300**; target **300**, max **450** (700 × 450 = 315 k worst case) |
| Parts (parent-first) | `body`(root) · `neck`←body · `head`←neck · `jaw`←head · `tail1`←body · `tail2`←tail1 · `legL`←body · `legR`←body |
| Pivots (m, parent frame) | body (0, 0.40, 0) · neck (0, 0.04, 0.20) · head (0, 0.14, 0.10) · jaw (0, −0.012, −0.01) · tail1 (0, 0.02, −0.13) · tail2 (0, 0.016, −0.36) · legL (0.05, −0.02, 0) · legR (−0.05, −0.02, 0) |
| Sockets | `mouth` on head (0, −0.012, 0.18) |
| Look | Lime-green, pale belly, 3 glowing back studs + 2 tail studs, glowing eyes. Single-piece legs. |
| Stats context | HP 7, speed 16.5 m/s, stride 2.6 → **cycle 1.51 m** |

| Clip | Length | Loop | Notes |
|---|---|---|---|
| `idle` | 2.0 s | ✓ | Head tilts, tail sway |
| `run` | 0.35 s (1 cycle = 1.51 m) | ✓ | Low, fast scurry; body pitched forward |
| `bite` | 0.40 s | — | Jaw snap at car contact |
| `hit` | 0.20 s | — | Flinch (additive) |
| `launched` | 0.60 s | ✓ | Tumbling when rammed |
| `fossilize` | 0.30 s | hold last frame | Rigid recoil, jaw open; final frame held while turning to stone |

#### Sicklejaw — `raptor` (pouncer)

| Spec | Value |
|---|---|
| Role | Core mid enemy; pounces onto the car |
| Cap | **240** |
| Size | ~4.0 m long, ~2.0 m to head top (hip 1.0 m); gameplay radius 0.95, height 1.7 (model radius 0.55) |
| Tris | placeholder ~1.35 k; target **1,200**, max **1,800** (240 × 1.8 k = 432 k worst case) |
| Parts | `body` · `neck`←body · `head`←neck · `jaw`←head · `tail1`←body · `tail2`←tail1 · `thighL`←body · `shinL`←thighL · `thighR`←body · `shinR`←thighR · `armL`←body · `armR`←body (the foot is part of the shin) |
| Pivots | body (0, 1.0, 0) · neck (0, 0.15, 0.84) · head (0, 0.42, 0.27) · jaw (0, −0.05, −0.02) · tail1 (0, 0.05, −0.42) · tail2 (0, 0.04, −0.88) · thighL (0.17, −0.05, 0.02) · shinL (0, −0.43, 0.15) · thighR / shinR mirrored in X · armL (0.17, −0.02, 0.60) · armR mirrored |
| Sockets | `mouth` on head (0, −0.06, 0.56) |
| Look | Rust-orange with dark stripes; feathered: swept-back head crest, neck ruff, forearm feather vanes, tail-tip fan. **Cyan glowing chevron tags** on the back and tail. **Sickle claw with glowing tip**: the identifying feature. Original head shape: narrow, slightly hooked; not the film raptor. |
| Stats context | HP 26, speed 20.5 m/s, stride 1.6 → **cycle 2.45 m** |

| Clip | Length | Loop | Notes |
|---|---|---|---|
| `idle` | 2.4 s | ✓ | Breathing, head scan |
| `run` | 0.45 s (2.45 m) | ✓ | Body pitched ~0.06 rad, arms tucked |
| `pounce_windup` | 0.20 s | hold | Crouch (procedural: thigh −0.5, shin +0.9, head +0.25) |
| `pounce_leap` | 0.50 s | hold | Legs tucked forward (thigh −0.9, shin +1.1), arms out, tail up |
| `bite` | 0.35 s | — | On contact |
| `hit` | 0.25 s | — | Additive flinch |
| `launched` | 0.80 s | ✓ | Ragdoll-style tumble after a ram |
| `fossilize` | 0.30 s | hold | Rear back, jaw open |

#### Brute — `brute` (heavy pack hunter; elite "Alpha")

| Spec | Value |
|---|---|
| Role | Big raptor pack hunter; the **elite Alpha summons raptor packs** |
| Cap | **48** |
| Size | ~6.5 m long, ~3.6 m to head top (hip 1.75 m); the placeholder is the raptor build at **1.75× scale**, heavier (body ×1.18), tail ×0.82. **Author at final size.** Model radius 1.05, gameplay radius 1.5, height 2.8 |
| Tris | placeholder ~1.45 k; target **2,000**, max **2,800** |
| Parts | Same 12 as `raptor` |
| Pivots | body (0, 1.75, 0) · neck (0, 0.26, 1.47) · head (0, 0.735, 0.47) · jaw (0, −0.088, −0.035) · tail1 (0, 0.088, −0.735) · tail2 (0, 0.07, −1.26) · thighL (0.35, −0.088, 0.035) · shinL (0, −0.75, 0.26) · armL (0.35, −0.035, 1.05) · R mirrored |
| Sockets | `mouth` on head (0, −0.105, 1.03) |
| Look | Slate blue-grey, mane of dark feathers along neck and back, bigger crest, **mint glow tags**. Heavier jaw. Alpha (elite): magenta rim (runtime). Optional "Alpha" scar/broken collar variant. |
| Stats context | HP 120, speed 17.5 m/s, stride 1.15 → **cycle 3.41 m** |

| Clip | Length | Loop | Notes |
|---|---|---|---|
| `idle` | 2.8 s | ✓ | Heavy breathing, mane ruffle |
| `run` | 0.60 s (3.41 m) | ✓ | |
| `pounce_windup` | 0.32 s (elite 0.22 s) | hold | |
| `pounce_leap` | 0.60 s | hold | |
| `bite` | 0.40 s | — | |
| `roar_summon` | 1.60 s | — | Alpha calls a pack (head up, jaw wide) |
| `hit` | 0.30 s | — | |
| `launched` | 0.90 s | ✓ | |
| `fossilize` | 0.60 s | hold | |

#### Hornwall — `trike` (lane charger)

| Spec | Value |
|---|---|
| Role | Telegraphed **lane charge** (red lane decal), up to 3 charges for elites |
| Cap | **24** |
| Size | ~8.0 m long, ~3.2 m to frill top (hip 1.9 m), ~2.6 m wide; model radius 1.5, gameplay radius 2.4, height 3 |
| Tris | placeholder **≤ 1,400**; target **2,500**, max **3,500** |
| Parts | `body` · `head`←body · `tail`←body · `legFL`←body · `legFR`←body · `legBL`←body · `legBR`←body (**no neck, no jaw**: the head carries frill and beak) |
| Pivots | body (0, 1.9, 0) · head (0, −0.15, 1.85) · tail (0, 0.05, −2.10) · legFL (0.78, −0.30, 1.25) · legBL (0.70, −0.10, −1.30) · R mirrored |
| Sockets | `mouth` on head (0, −0.30, 1.75); `horn` on head (0, 1.10, 1.50) |
| Look | Olive with dark stripes; **scalloped original frill** tilted back (outer plate `#6e5a24`, inner panel `#9a3a14`), **glowing orange knobs on the frill edge**, two long brow horns + short nose horn + cheek horns, alternating glowing dorsal studs. |
| Stats context | HP 340, speed 7 m/s (charge 30 m/s, boss 34), stride 0.75 → **cycle 5.24 m** |

| Clip | Length | Loop | Notes |
|---|---|---|---|
| `idle` | 3.0 s | ✓ | Head sway |
| `walk` | 0.90 s (5.24 m) | ✓ | Trot, diagonal pairs |
| `charge_windup` | 2.2 s (boss 2.6 s) | ✓ | Head down, pawing (14 Hz head tremor) while the lane telegraph fills |
| `charge` | 0.55 s | ✓ | Gallop, amplitude ×1.5, head low and level |
| `recover` | 1.0 s | — | Skid stop, shake head |
| `hit` | 0.35 s | — | |
| `fossilize` | 0.60 s | hold | |

#### Clubtail — `ankylo` (armored tank)

| Spec | Value |
|---|---|
| Role | Slow armored tank (45 % damage reduction); **tail-swipe ring** (orange ground circle, radius 7 m × scale) |
| Cap | **16** |
| Size | ~7.0 m long, ~2.1 m tall, ~3.3 m wide incl. side spikes (hip 1.1 m); model radius 1.5, gameplay radius 2.2, height 2 |
| Tris | placeholder **≤ 1,400**; target **2,500**, max **3,500** |
| Parts | `body` · `head`←body · `tail1`←body · `tail2`←tail1 (club on tail2) · `legFL` · `legFR` · `legBL` · `legBR` (all ←body) |
| Pivots | body (0, 1.1, 0) · head (0, −0.05, 1.80) · tail1 (0, 0, −1.85) · tail2 (0, −0.08, −1.20) · legFL (0.74, −0.30, 1.10) · legBL (0.72, −0.25, −1.00) · R mirrored |
| Sockets | `mouth` on head (0, −0.10, 0.95) |
| Look | Sand-tan hide, rows of dark osteoderm pyramids, **amber glow spots between armor rows**, lateral flank spikes, armored head plates, **tail club with a glowing seam**. |
| Stats context | HP 520, speed 4.5 m/s, stride 0.7 → **cycle 5.61 m** |

| Clip | Length | Loop | Notes |
|---|---|---|---|
| `idle` | 3.2 s | ✓ | |
| `walk` | 1.1 s (5.61 m) | ✓ | |
| `swipe_windup` | 0.70 s | — | Tail wags at ~18 rad/s while the ring telegraph fills |
| `swipe` | 0.40 s | — | Full tail sweep; shockwave fires at the end |
| `hit` | 0.35 s | — | Barely flinches |
| `fossilize` | 0.60 s | hold | |

#### Skyreaver — `ptero` (dive-bomber)

| Spec | Value |
|---|---|
| Role | Flying dive-bomber (elites dive up to 3 times in a row) |
| Cap | **40** |
| Size | **~6.8 m wingspan**, ~2.4 m long; origin at body centre; model radius 1.2, gameplay radius 1.3 |
| Tris | placeholder **≤ 700**; target **700**, max **1,000** |
| Parts | `body` · `neck`←body · `head`←neck · `wingL`←body · `wingTipL`←wingL · `wingR`←body · `wingTipR`←wingR (**no jaw part**: the beak is one piece) |
| Pivots | body (0, 0, 0) · neck (0, 0.10, 0.45) · head (0, 0.12, 0.38) · wingL (0.14, 0.06, 0.12) · wingTipL (1.50, 0, 0.15) · wingR (−0.14, 0.06, 0.12) · wingTipR (−1.50, 0, 0.15) |
| Sockets | `mouth` on head (0, −0.05, 0.95); `claws` on body (0, −0.18, −0.55) |
| Look | Deep violet, pale belly, **original swept-back scimitar crest with a forked spur and glowing inlay**, glowing trailing-edge bands on both wing segments. Tags → ultraviolet `#9a5cff` recommended (2.4). |
| Stats context | HP 18, speed 24 m/s; flaps by time, not distance |

| Clip | Length | Loop | Notes |
|---|---|---|---|
| `glide` | 1.50 s | ✓ | Slow flap (4.2 rad/s), amplitude 0.45 |
| `climb` | 0.70 s | ✓ | Fast flap (9 rad/s), amplitude 0.7 (`recover` state) |
| `dive_windup` | 1.15 s (elite 0.85 s) | hold | Wings fold (yaw 0.9, tip 0.5), neck down |
| `dive` | 0.40 s | ✓ | Folded stoop |
| `hit` | 0.20 s | — | |
| `fossilize` | 0.40 s | hold | Wings lock half-open; it falls under gravity |

#### Boss 1 — GRIDLOCK — `trex` (fully specified)

**Cretagen Apex Specimen T-01.** A *Tyrannosaurus rex* in an armored containment collar, chasing Unit 77 down the
avenue. The reverse camera shows it head-on behind the car.

| Spec | Value |
|---|---|
| Cap | **1** (single instance, so it gets the most generous budget) |
| Size | **~13 m long**, hip **3.6 m**, head top ~5 m; model radius 3.2 |
| Tris | placeholder **≤ 4,000**; target **8,000–12,000**, max **15,000** per phase variant |
| Parts (15) | `body` · `neck`←body · `head`←neck · `jaw`←head · `tail1`←body · `tail2`←tail1 · `tail3`←tail2 · `thighL`←body · `shinL`←thighL · `footL`←shinL · `thighR` · `shinR` · `footR` · `armL`←body · `armR`←body |
| Pivots | body (0, 3.6, 0) · neck (0, 0.25, 2.45) · head (0, 0.60, 0.95) · jaw (0, −0.28, −0.10) · tail1 (0, 0.15, −1.60) · tail2 (0, 0.02, −2.20) · tail3 (0, −0.10, −2.10) · thighL (0.85, −0.25, 0.15) · shinL (0, −1.50, 0.55) · footL (0, −1.20, −0.50) · armL (0.72, −0.62, 1.80) · R mirrored |
| Sockets | `mouth` head (0, −0.40, 1.85) — wreck grab/throw origin · **`weakNeck` neck (0, 0.27, 0.42)** — collar centre · `weakThighL` thighL (0.30, −0.60, 0.20) · `weakThighR` thighR (−0.30, −0.60, 0.20) · `eyeL` head (0.47, 0.42, 0.12) · `eyeR` head (−0.47, 0.42, 0.12) |
| Look | Near-black green with dark mottling, ochre belly, dark dorsal scute row down the tail, brow ridges and small lacrimal horns, **glowing orange flank fissure stripes** (Cretagen tag lines), **three glowing claw-scar slashes across the left cheek**, burning orange eyes (×8). Original design: heavy, low-slung "street brawler" proportions, broad scarred skull; **no film paint scheme or film head sculpt**. |

**The containment collar (weak point).** Modelled on the `neck` part, centred at neck-local (0, 0.27, 0.42), tilted
−0.45 rad about X so it sits square on the throat. It has a 16-sided band with a **glowing seam ring**, **8 bolted
armor plates** (gunmetal `#3c4048`) with **glowing bolts**, and at the bottom (throat side) a **lock box**
(`#5c626c`) with an **emissive lock light** (`#ff7a10` ×8). The lock light is the aim point: it must be visible from
the chase camera when GRIDLOCK runs behind or beside the car, and fully readable from the reverse camera.

**Phase damage states.** The rig's vertex colors are static, so phases are delivered as **separate rig GLBs with the
identical node contract**, swapped by the boss controller at phase change (proposed manifest ids `trex`, `trex_p2`,
`trex_p3`, capacity 1 each, cheap because there's only one instance; needs a small code change):

| Phase | HP | Visual state | Attacks emphasised | Audio |
|---|---|---|---|---|
| **1 — "Containment"** (`trex`) | 100–66 % | Collar intact: 8 plates, seam glowing steady orange; flank fissures dim orange | Lunge bite, stomp shockwave | `trex_roar`, `stomp`, `bite` |
| **2 — "Breach"** (`trex_p2`) | 66–33 % | **3 collar plates blown off** (they fly off as `shard`/`wreck`-style debris at the transition); seam flickers; cracks of **cyan gene energy** appear on the exposed collar band; thigh armor straps visible = **`weakThighL/R` exposed** (orange glow) | + hurls wrecked cars (`wreck` prop from the `mouth` socket), head-on charge | Transition: `trex_roar` (pitch 0.9) + `explosion` |
| **3 — "Overload"** (`trex_p3`) | 33–0 % | **Collar broken open**: only 3 plates hang on; the lock light is exposed and **pulsing red**; flank fissures turn **cyan-white** (gene energy leaking: the creature is starting to "fossilize from inside"); eyes brighter | Everything faster + **roar summons Sicklejaw packs** | `trex_roar` dur 3.2, boss music intensity max |

**Attacks (telegraph → clip):**

| Attack | Telegraph (vfx) | Clips & lengths | Sockets |
|---|---|---|---|
| **Lunge bite** | `telegraphLane` (red, car-width) 0.6 s | `bite_windup` 0.6 s → `bite_lunge` 0.35 s → `bite_recover` 0.6 s | `mouth` |
| **Stomp shockwave** | `telegraphCircle` (orange) 0.7 s, then `shockwave` ring | `stomp_windup` 0.7 s (leg raised) → `stomp_slam` 0.15 s → `stomp_recover` 0.5 s | `footL`/`footR` (dust) |
| **Hurl wrecked car** | `telegraphCircle` at the landing spot | `grab` 0.6 s (head dips, wreck appears in jaws) → `throw` 0.45 s (neck whip) | `mouth` |
| **Head-on charge** | `telegraphLane` full road length | `charge_windup` 1.2 s → `charge` 0.7 s loop → `charge_skid` 0.8 s | — |
| **Roar summon** | screen-edge red `danger` pulse | `roar` **2.6 s** (matches the `trex_roar` default duration) | `mouth` (breath particles) |
| Locomotion | — | `idle` 3.0 s loop · `run` 1.0 s loop (one stride ≈ 7 m, in place) | — |
| Reactions | — | `hit_light` 0.3 s (additive) · `stagger` 1.8 s (phase transitions; head shake, collar sparks) | `weakNeck` (sparks) |

**Death sequence (≈ 6 s, slow motion):**

1. `death_stagger` 1.2 s: weak-point hit; collar explodes (sparks + `explosion` cyan at `weakNeck`), time scale drops to ~0.3, screen desaturates.
2. `death_fossilize` 1.5 s (hold last frame): reared up, jaw open, roar cut off. Stone creeps over the body. Today it's a
   uniform blend (`fx.y`); a future upgrade is a bottom-up height mask so stone climbs from the feet.
3. Freeze 0.6 s, the crack builds (`fossilize` layered, then `shatter_big`).
4. **Giant shatter**: `vfx.shatter(big = true)` with the max shard count (40), a huge cyan gene-energy burst, a white
   screen flash, ring shockwave, fall of `boulder` chunks, `victory` sting, results music.

#### Boss 2 (roadmap sketch) — THE HUDSON LEVIATHAN — mosasaur-type

| Spec | Value |
|---|---|
| Setting | Bursts from the Hudson along the **West Side Highway**; the car races the riverside lanes |
| Size | ~17 m long, mostly submerged; head ~2.2 m |
| Tris | 10–14 k (single instance) |
| Proposed parts | `body` · `neck` · `head` · `jaw` · `tail1` · `tail2` · `tail3` · `fluke` · `flipperFL/FR/BL/BR` (requires a new `poseSwimmer` in `poses.js`) |
| Look | Deep teal/black, pale throat, **bioluminescent cyan lateral line** + orange Cretagen tracking tags on the skull; double-hinged jaw with an original look (no feeding-show framing) |
| Attacks | Breach lunge across lanes (lane telegraph), tail slam wave (ring), spits pier debris, drags the car toward the river (vacuum-style pull) |
| New VFX/props | Water splash flipbook, foam decal, wake ribbon, `pierDebris` prop, wet-shine spray |
| Clips | `swim` 2.0 s loop, `breach` 2.4 s, `lunge` 1.2 s, `tail_slam` 1.4 s, `submerge` 1.5 s, `hit` 0.4 s, `death_fossilize` 3.0 s |

#### Boss 3 (roadmap sketch) — SKYLINE — sauropod

| Spec | Value |
|---|---|
| Setting | Rampages through **Central Park**, among the trees and over the park drives |
| Size | ~26 m long, head up to ~13 m (taller than park-edge brownstones) |
| Tris | 12–15 k |
| Proposed parts | `body` · `neck1` · `neck2` · `neck3` · `head` · `jaw` · `tail1`–`tail4` · `legFL/FR/BL/BR` (VAT recommended for the long neck/tail) |
| Look | Weathered grey-blue hide, dozens of glowing cable harness anchors (snapped Cretagen tether cables trailing from the shoulders: the weak points) |
| Attacks | Foot stomps (big ring telegraphs), neck sweep across the road (lane), tail whip, uproots trees thrown as `boulder`-style props |
| Clips | `walk` 3.0 s loop, `rear_up` 2.5 s, `stomp` 1.0 s, `neck_sweep` 2.0 s, `tail_whip` 1.6 s, `hit` 0.5 s, `death_fossilize` 4.0 s |

### 5.4 Pickups, projectiles & world FX meshes

All kind `prop`, vertex colors only. Placeholder tris are computed from the primitives in `props.js`.

| Asset id | Game name | Placeholder tris | Target / max | Size | Pivot | Notes |
|---|---|---|---|---|---|---|
| `gem` | **Gene core** (XP) | 16 | 60 / 120 | 0.48 × 0.8 m | Centre | **Author neutral white/grey**: the per-instance tint makes the 4 tiers (green/blue/violet/gold). Inner core emissive ×3, shell ×1.2. Hundreds on screen. |
| `crate` | **Cretagen supply crate** (elite drop) | ~120 | 300 / 500 | 1.34 × 1.13 × 1.04 m | Bottom centre | Gunmetal case, yellow/black hazard band, cyan seam + cyan beacon. Fictional Cretagen hex logo allowed. |
| `repair` | **Repair kit** | 48 | 150 / 300 | 0.9 × 0.62 × 0.52 m | Bottom centre | White toolbox, **green glowing plus** (not a red cross: that's a protected emblem) |
| `nitro` | **Nitro canister** | ~88 | 150 / 300 | Ø 0.46 × 0.98 m | Bottom centre | Orange cylinder, blue-white glow band |
| `vacuum` | **Vacuum magnet** | ~132 | 150 / 300 | 0.8 × 0.94 m | Bottom centre | Red horseshoe, glowing white-blue tips |
| `airstrike` | **Skyhammer beacon** | ~76 | 150 / 300 | Ø 0.72 × 1.0 m | Bottom centre | Gunmetal base, mast, pulsing red bulb |
| `tracer` | Cannon/gatling bolt | 12 | 12 / 24 | **Unit 1 × 1 × 1 box** | Centre | Scaled per shot along +Z; white emissive; keep a unit box (or an elongated hexagonal prism) |
| `missile` | Swarm missile | ~108 | 100 / 200 | Ø 0.16 (fins 0.3) × 0.84 m | Centre, nose +Z | White body, red nose, orange exhaust |
| `mine` | Flare mine | ~88 | 100 / 200 | Ø 0.8 × 0.28 m | Bottom centre | Red blinking light |
| `saw` | Hubcap saw blade | ~160 | 160 / 300 | Ø 1.48 × 0.1 m | Centre; **spins about Y** | 12 teeth with orange glow |
| `shard` | Fossil shard | 20 | 20 / 40 | 1 × 0.7 × 0.8 m (scaled 0.05–1.0 at spawn) | Centre | **Up to 1,400 alive**: keep it ≤ 40 tris. Stone colored (0.42, 0.40, 0.37) |
| `boulder` | Boss debris / thrown rock | 80 | 150 / 300 | Ø 2 × 1.7 m | Centre | Dark stone |
| `wreck` | Hurled wrecked car | ~164 | 600 / 1,000 | 1.9 × 1.4 × 4.4 m | Centre | Burnt generic sedan, crumpled; orange smoulder glow at the rear; no brand cues |

### 5.5 VFX (current recipes & future textures)

All current effects are **geometric** (no textures): instanced primitives with per-instance HDR color, additive blending
for glow. Pools are preallocated ring buffers (`vfx.js`).

| Element | Pool cap | Geometry | Blend | Used by recipes |
|---|---|---|---|---|
| `vfx.glow` | 2,200 | Icosahedron r 0.5 (20 tris) | Additive HDR | `muzzle`, `hitSpark`, `explosion` fireballs/core flash, `shatter` gene wisps, `lightning` end flash, elite embers |
| `vfx.streak` | 900 | Unit box, velocity-stretched | Additive | `sparks` (gravity 14, drag 1.5) |
| `vfx.shards` | 1,400 | `shard` prop | Lit (rough 0.95) | `shatter` stone shards (bounce 0.4), `explosion` debris |
| `vfx.smoke` | 500 | Icosahedron detail 1 (80 tris) | Lit (rough 1) | `explosion` smoke, `shatter` stone dust, `dust` (stomps, skids) |
| `vfx.rings` | 96 | Ring 0.82–1.0, 40 seg | Additive, double-sided | `explosion` ground ring, `shockwave`, big `shatter` ring |
| `vfx.discs` | 96 | Circle, 40 seg | Additive (immediate) | `telegraphCircle` fill |
| `vfx.ringsT` | 128 | Ring 0.9–1.0, 48 seg | Additive (immediate) | `telegraphCircle` edge, `ring` (aura/pickup radius) |
| `vfx.lanes` | 48 | Unit plane along +Z | Additive (immediate) | `telegraphLane` (charges, lunges) |
| `vfx.beams` | 400 | Unit box segment | Additive | `beam` (rail lance), `lightning` (6 jagged segments) |
| Point lights | 10 (fixed) | — | — | `light` (explosions 260 × size intensity) |
| Damage numbers | 160 | 2D canvas text | — | `number` kinds: 0 normal white, 1 crit gold ×1.35, 2 player dmg red, 3 heal/xp green, 4 big text cyan ×1.7 |
| Speed lines | 40 lines | 2D canvas | — | Boosting |
| Threat arrows | per threat | 2D canvas triangle | — | Off-screen chargers & boss (`#ff3b3b`) |

Explosion palettes: **fire** (8, 3.2, 0.7), **cyan plasma** (1.2, 5, 6), **magenta** (6, 1, 5).

**Texture & flipbook upgrades (optional; these need a textured additive batch in code):**

| Texture | Size | Frames | Format | Replaces / adds |
|---|---|---|---|---|
| `glow_soft` | 64 × 64 | 1 | PNG, alpha-premult, white | Soft radial sprite for glow blobs (camera-facing quad instead of icosahedron) |
| `spark_streak` | 64 × 16 | 1 | PNG | Sharper sparks |
| `smoke_puff` | 1024 × 1024 | 8 × 8 = 64 (128 px cells) | PNG/KTX2 later, grayscale + alpha | Smoke, stone dust |
| `explosion_fire` | 1024 × 1024 | 8 × 8 | PNG | Fireball flipbook (tinted per palette) |
| `muzzle_flash` | 256 × 64 | 4 | PNG | Cannon/gatling flashes (random frame) |
| `shockwave_ring` | 256 × 256 | 1 | PNG, gradient ring | Rings with a soft leading edge |
| `telegraph_circle` | 256 × 256 | 1 | PNG, hazard tick marks | Danger circles (still tinted red/orange) |
| `telegraph_lane` | 128 × 512 | 1, V-tiling | PNG, chevrons | Lane telegraphs with arrows showing direction |
| `lightning_strip` | 256 × 32 | 4 | PNG | Tesla/Thunderhead arcs |
| `gene_wisp` | 64 × 64 | 1 | PNG | Gene-energy wisps from shatters |
| `fossil_crack` | 256 × 256 | 1 | PNG, tileable | Future triplanar crack overlay during the fossilize blend |
| `water_splash` | 1024 × 1024 | 8 × 8 | PNG | Leviathan (Boss 2) |

Good CC0 base: **Kenney Particle Pack** (CC0), then recolor to white/grayscale (the color comes from instance tint).

### 5.6 UI icons

`icons.js` exports 60 icons (`ICON_IDS`), 48 × 48, duotone `currentColor`:

| Group | Icon ids |
|---|---|
| Weapons (8) | `cannon` (Roof Cannon), `gatling` (Hood Gatlings), `saws` (Hubcap Saws), `missiles` (Swarm Missiles), `tesla` (Tesla Coil), `flamer` (Exhaust Flamer), `mines` (Flare Mines), `shotgun` (Bumper Buckshot) |
| Evolutions (8) | `railgun` (Rail Lance), `storm_gatling` (Storm Gatlings), `buzzsaw` (Buzzsaw Halo), `cluster` (Cluster Barrage), `thunder` (Thunderhead), `inferno` (Inferno Wake), `nova` (Nova Mines), `dragon` (Dragon's Breath) |
| Passives (8) | `armor` (Armor Plating), `chassis` (Reinforced Chassis), `turbo` (Turbo Kit), `magnet` (Gene Magnet), `ram` (Ram Plow), `loader` (Autoloader), `hollow` (Hollow Points), `boom` (Blast Radius) |
| Pickups (7) | `repair`, `nitro`, `vacuum`, `crate`, `airstrike` (Skyhammer), `gem` (gene core), `score` |
| Creatures (7, side silhouettes facing right) | `compy`, `raptor`, `brute`, `trike`, `ankylo`, `ptero`, `trex` |
| UI (8) | `heart`, `skull`, `clock`, `star`, `x-logo`, `pause`, `sound`, `settings` |
| Extra glyphs (14) | `warn`, `reroll`, `play`, `help`, `close`, `back`, `bolt`, `flame`, `target`, `mouse`, `touch`, `trophy`, `speed`, `dna` |

Aliases: `x`/`xlogo`→`x-logo`, `storm`→`storm_gatling`, `rail`→`railgun`, `skyhammer`/`special`→`airstrike`,
`xp`/`gene`→`gem`, `medkit`/`heal`→`repair`, `ankylosaurus`→`ankylo`, `triceratops`→`trike`, `pteranodon`→`ptero`,
`tyrannosaurus`→`trex`, `settings_gear`/`gear`→`settings`, `kills`→`skull`, `time`→`clock`. Unknown ids fall back to `star`.

**Icons still needed:** `gridlock` (boss emblem: T. rex skull in the collar), `leviathan`, `skyline`, `elite` (magenta
crown-spike mark), `alpha`, `unit77` / `courier` / `sweeper` (car variants), `lock` (locked unlock), `levelup`
(arrow-up chevron), `route` (map pin), `music`, `fullscreen`, `gamepad`, `keyboard`, `share` (generic, to replace
`x-logo` if needed), `phase` (boss phase pip). Same grid/tone rules; deliver as SVG path data that
uses only `currentColor` + black overlay (no ids/defs/clipPaths/gradients).

### 5.7 Audio

> **v4 update (2026-10-27):** this section is the historical v1–v3 brief. The game now plays designed samples and
> CC0 / original music (`assets/audio/`, built by `tools/audio/sfx.js` and `tools/audio/music.js`, register in
> [ASSETS.md §2.3](../ASSETS.md), runtime in `js/game/audio.js` + `js/game/audio-music.js`, report in
> [REPORT.md v4](REPORT.md)). The recipes below survive as fallback voices in `js/game/audio-recipes.js`.

All audio is **synthesized at play time** with WebAudio (`audio.js`): oscillators, noise, filters, a waveshaper and a
shared 2.2 s convolution reverb. Every SFX has a voice limit and a minimum retrigger gap. World sounds are panned
and distance-attenuated relative to the camera (range 90 m).

**Replacing recipes with recorded/CC0 samples (proposed; needs code):** add a `SAMPLES` map
(`name → [url…]`) loaded into `AudioBuffer`s. In `play()`, if a sample exists for the name, pick a random variation,
set `playbackRate = pitch × (0.95–1.05)`, route through the same `out → panner → sfxBus` (+ reverb send), and keep
`SOUND_LIMITS`. Otherwise fall back to the recipe, so replacements can land one by one.
**Delivery format:** OGG Vorbis (or Opus in WebM; check Safari) 48 kHz, **mono for world SFX**, stereo for UI/music;
trim to the first transient (< 5 ms pre-roll); peak −1 dBFS; normalize categories to consistent loudness
(UI quietest, weapons mid, roars/explosions loudest). Provide **3–5 variations** for anything that repeats fast.

**SFX (36 recipes):**

| Name | Used for | Voices / min gap | Recipe (current) | Replacement brief | Variations |
|---|---|---|---|---|---|
| `gun` | Roof Cannon shot | 4 / 35 ms | Bandpassed noise crack + distorted sine thump, 0.18 s | Punchy heavy-caliber shot, short tail | 4 |
| `gatling` | Hood Gatlings | 5 / 30 ms | Tight noise tick + square blip, 0.07 s | Very short mechanical bark, no tail (loops at high rate) | 5 |
| `shotgun` | Bumper Buckshot | 3 / 60 ms | Lowpass noise sweep + sub, 0.36 s | Shotgun boom with slight mechanical rack | 3 |
| `missile` | Swarm Missile launch | 4 / 50 ms | Rising bandpassed noise whoosh, 0.45 s | Small rocket ignition + whoosh | 3 |
| `explosion` | Missiles, mines, airstrike (`big` = 1.6× length) | 6 / 40 ms | Brown-noise distorted boom + sub + crackle, 1.2 s | Layered: transient, body, debris crackle; 2 sizes | 4 + 2 big |
| `tesla` | Tesla Coil zap | 4 / 40 ms | FM saw buzz + noise snap, 0.2 s | Electric arc snap | 4 |
| `saw` | Hubcap Saws hit | 4 / 50 ms | High square whine + noise, 0.13 s | Metal grinder bite | 4 |
| `mine` | Flare mine arm | 3 / 100 ms | 1.4 kHz beep, 0.08 s | Electronic arming beep | 1 |
| `fossilize` | Small dino turns to stone | 7 / 25 ms | 4 granular stone cracks + thud, 0.14 s | Stone crackle / gravel crunch (very frequent, keep it short and bright) | 6 |
| `shatter_big` (alias `fossilize_big`) | Large dino/boss shatter | 4 / 60 ms | 9 cracks + sub drop, 0.55 s | Rock-slide crash + sub thump | 3 |
| `compy_chirp` | Scuttler | 3 / 80 ms | Two rising sine chirps, 0.16 s | Small bird/lizard chirp (designed, not a real bird species call) | 5 |
| `raptor_screech` | Sicklejaw | 3 / 180 ms | Formant saw sweep + vibrato, 0.5 s | Rasping screech, original design (layer bird + animal + vocal) | 4 |
| `brute_growl` | Brute | 2 / 300 ms | AM-distorted low saw, 0.85 s | Deep throaty growl | 3 |
| `trike_bellow` | Hornwall charge | 2 / 300 ms | Two-formant low saw, 1.05 s | Bellowing low honk | 3 |
| `ankylo_grunt` | Clubtail | 2 / 300 ms | Lowpassed saw grunt, 0.45 s | Short heavy grunt | 3 |
| `ptero_cry` | Skyreaver | 2 / 200 ms | Vibrato square cry, 0.55 s | Shrill descending cry | 3 |
| `trex_roar` | GRIDLOCK (default 2.6 s, `dur` option) | 1 / 500 ms | Layered saw formants + breath noise + sub, 2.8 s | **Signature original roar**: layered animal + processed vocal, long tail. Must not resemble the film roar. | 3 (short/long/death) |
| `stomp` | Boss/big footstep, shockwave | 4 / 70 ms | Sine drop + brown noise, 0.45 s | Heavy impact on asphalt with car-alarm-free debris | 4 |
| `bite` | Jaw snap | 3 / 70 ms | Noise click + square blip, 0.1 s | Teeth clack | 3 |
| `tail_swipe` | Clubtail swipe | 2 / 200 ms | Sweeping noise whoosh, 0.5 s | Heavy whoosh | 2 |
| `hurt` | Player car takes damage | 2 / 80 ms | Inharmonic metal partials + thud, 0.42 s | Sheet-metal impact | 4 |
| `ram` | Ramming a dino | 4 / 50 ms | Sine thump + noise, 0.18 s | Body thud + bumper clank | 4 |
| `gem` | Gene core pickup | 6 / 18 ms | Triangle blip upward, 0.1 s | Glassy tick (pitch rises with combo in code) | 2 |
| `heal` | Repair kit | 2 / 200 ms | Major arpeggio, 0.5 s | Positive shimmer | 1 |
| `levelup` | Level up | 1 / 200 ms | 7-note square arpeggio + air, 0.9 s | Arcade level-up fanfare (synth, original) | 1 |
| `evolve` | Weapon evolution | 1 / 500 ms | Detuned saw fifths stack, 1.3 s | Bigger, more "transformation" than levelup | 1 |
| `combo` | Kill-combo tick | 2 / 150 ms | Square chirp up, 0.15 s | Short arcade blip | 1 |
| `ui` | UI click | 3 / 30 ms | Triangle tick, 0.07 s | Soft click | 2 |
| `ui_hover` | UI hover | 2 / 40 ms | Very short sine tick, 0.04 s | Barely-there tick | 1 |
| `warning` | Boss incoming | 1 / 1 s | Alternating 620/460 Hz saw siren ×4, 1.8 s | Klaxon (no real emergency-service siren recordings) | 1 |
| `nitro` | Nitro boost | 1 / 300 ms | Rising noise whoosh, 0.7 s | Turbo blow-off + whoosh | 2 |
| `crate` | Supply crate open | 2 / 200 ms | Rising triangle arpeggio, 0.6 s | Latch clunk + reward jingle | 1 |
| `airstrike` | Skyhammer call-in | 2 / 300 ms | Falling sine whistle, 1.0 s | Incoming-shell whistle | 1 |
| `bell` | Notification bell | 1 / 300 ms | 3 inharmonic sine partials, 1.2 s | Clean bell ping | 1 |
| `death` | Player wrecked | 1 / 1 s | Big explosion + falling saw, 2 s | Explosion + power-down | 1 |
| `victory` | Boss defeated / run cleared | 1 / 1 s | 4-chord saw fanfare, 3 s | Original synth fanfare (no film-style brass motif) | 1 |

**Continuous loops (3):** `engine` (2 detuned oscillators through a lowpass that follow speed/boost: replace with 3
crossfaded engine loops idle/mid/high, 2–4 s seamless, 48 kHz mono), `flamer` (bandpassed noise: replace with a
seamless 3 s flame-thrower roar loop), `wind` (speed rush: replace with a 4 s wind/road-noise loop).
The code comment also mentions a boss breathing loop that isn't implemented yet: add `boss_breath` (4 s loop) when it is.

**Music (16-step sequencer "darksynth", 4 states):**

| State | BPM | Progression (MIDI chords) | Character | Replacement brief |
|---|---|---|---|---|
| `title` | 96 | Am – F – C – G | No drums; slow arp, pad | 16-bar seamless loop (40 s), moody synthwave |
| `run` | 128 | Am – F – C – G | Four-on-floor kick, offbeat hats, octave-pop bass, fast arp | 32-bar loop (60 s) delivered as **stems** (drums / bass / arp / pad) so the code's `intensity` can drop layers; the music is low-passed to 650 Hz during pause/level-up |
| `boss` | 148 | Dm – B♭ – Gm – A | Broken kick, 16th hats, distorted bass | 32-bar loop (~52 s), stems; a 2-bar intro hit to sync with `warning` |
| `results` | 84 | Am – Em – F – G | Sparse, reflective | 8-bar loop (~23 s) |

Music sources: commission (original), or CC0 tracks (e.g. OpenGameArt CC0 filter); match BPM/key so
transitions from the sequencer feel continuous. No film or franchise-style themes.

---

## 6. Production routes

### 6.1 CC0 packs (fastest, zero-risk license)

| Source | Use for | Notes |
|---|---|---|
| **Quaternius** (quaternius.com, also on Poly Pizza) | Creature bases: Quaternius' **animated dinosaur pack(s)** (low-poly T. rex, velociraptor, triceratops, stegosaurus, long-necks… check the current pack contents), plus animated animal and monster packs | CC0, flat-colored low-poly, close to our style. Usually **skinned with one armature**: convert to rigid parts (7.4), rename nodes, recolor to our palettes, add glow tags. Proportions need edits to match pivots/sockets. |
| **Kenney** (kenney.nl) | **Car Kit** (taxi, van, truck, police-free bodies: strip any markings), **Blaster/Weapon kits** (turret bits), **Particle Pack** (VFX textures), **Game Icons** (reference only; our icons are custom), **Impact / Sci-Fi / Interface Sounds** | All CC0. The car kit is a good blockout for Unit 77 and the variants. |
| **Poly Pizza** (poly.pizza) | Misc props (crates, rocks, wrecks, trees) | **Filter by license = CC0.** Many models are CC-BY: not allowed under our rule. |
| **OpenGameArt** (opengameart.org) | SFX, music, textures | Filter **CC0** only. |
| **Freesound** (freesound.org) | Raw SFX layers (stone cracks, metal impacts, animal vocal layers) | Filter **Creative Commons 0**. Record the sound id in ASSETS.md. |
| **Poly Haven / ambientCG** | Reference HDRIs, rock scans for color picking | CC0; we don't ship textures on models, but they're useful for lookdev. |

### 6.2 AI 3D generation (Meshy, Tripo, Rodin/Hyper3D, and others)

Use it for **blockouts and creature bases**, never as a final drop-in. Typical output is 20–500 k tris, triangulated
mush with baked PBR textures and no clean topology. Workflow:

1. **Prompt** with original descriptions only: species, our palette, "low-poly faceted, flat colors, glowing tag
   stripes, standing T-pose/neutral pose, side-on symmetric". **Never** include film/franchise names, "like the movie",
   or upload film stills or third-party concept art as image prompts.
2. Generate from **our own** concept sheet (side + top silhouettes) for consistency.
3. **Retopo / cleanup checklist:**
   - [ ] Decimate or retopologize to the tri target in 5.3 (Blender *Decimate → Collapse*, then manual cleanup; or
         *QuadriFlow* remesh → triangulate). Keep faceted planes large and readable.
   - [ ] Fix non-manifold geometry, interior faces, floating islands, flipped normals (*Mesh → Clean Up*).
   - [ ] Symmetrize (X), then split into the rig parts at the joints (7.3); cap the cut openings.
   - [ ] Reset rest pose to the standing zero pose with feet on y = 0; scale to the size in 5.3.
   - [ ] **Bake the texture to vertex colors** (7.5), then simplify: quantize to the species palette (back/base/belly
         + accents) and re-add the ×0.9–1.1 per-face jitter.
   - [ ] Re-author the glow tags as separate emissive-material faces (AI emissive maps are useless here).
   - [ ] Delete all textures/UVs from the export.
4. **Licensing caveats:**
   - Terms change often: **read the current ToS for your plan before generating.** Free tiers of several tools
     have published outputs publicly and/or licensed them CC BY 4.0, or restricted commercial use. Paid tiers usually
     grant private ownership.
   - Our rule is **CC0-only**: an AI output is admissible only if the plan gives you full rights with no attribution or
     use restrictions, so the rights holder can dedicate it CC0. CC BY outputs are **not** admissible.
   - Copyright in purely AI-generated output may be weak or absent in some jurisdictions. That's fine for CC0, but
     substantial manual rework is what makes the asset ours. Record the tool, plan, date, prompt and the rework done
     in ASSETS.md.
   - IP contamination: if a result resembles a film creature (frills on a dilophosaur, film raptor head, hybrid look),
     discard it.

### 6.3 Commissioning

**Brief template** (one per asset or batch):

```
Project: EXTINCTION AVENUE (browser game, three.js WebGPU). Style: "Neon Cretaceous": faceted low-poly,
flat-shaded, vertex colors only, emissive "containment tag" markings. Original IP; no Jurassic Park/World references.
Asset: <id> (<game name>), e.g. raptor (Sicklejaw)
Role & silhouette notes: <from 5.3>
Size: <m> | Tri budget: <target> (hard max <max>) | Parts & pivots: <table from 5.3> | Sockets: <list>
Palette: <hex table from 2.2>; glow hue <hex> at emission strength <n>
Deliverables: .blend source + .glb (rigid-part contract, 4.3) [+ skinned master + clips per 5.3, optional]
Pose conventions: rest = standing zero pose, +Z forward (Blender −Y), +X = creature's left
References: our concept sheet + paleo references (no film stills)
License: work-for-hire / full rights assignment; the asset will be released CC0 1.0 in our repo; artist may be credited.
Milestones & payment: see below
```

**Budget ranges (freelance, indicative 2026 USD; varies by region/seniority):**

| Asset | Rigid-part model + vertex color | + skinned rig & 6–10 clips |
|---|---|---|
| Swarm creature (Scuttler, Skyreaver) | $120–300 | +$150–400 |
| Mid creature (Sicklejaw, Brute) | $250–600 | +$300–700 |
| Large creature (Hornwall, Clubtail) | $350–800 | +$400–900 |
| Hero boss GRIDLOCK (3 phase variants, collar) | $900–2,500 | +$800–2,000 |
| Player car + 2 variants + livery | $400–1,200 | n/a (wheels/turret are code-driven) |
| Turret + 10 attachments + 8 evo variants | $400–1,000 | n/a |
| Pickups/projectiles (13 props) | $200–500 | n/a |
| Icon set extension (~18 icons) | $250–700 | n/a |
| SFX pass (36 sounds × variations) | $800–2,500 | — |
| Music (4 cues, stems) | $1,000–4,000 | — |

**Milestones** (payment split ~30/40/30):

1. **Concept**: side/top silhouette sheet + palette swatch, 3 options → pick one. (30 %)
2. **Blockout in engine**: rough GLB with the correct node names/pivots/size, tested via the manifest in the twilight look. (no payment gate; feedback only)
3. **Final mesh + vertex colors + glow tags**: passes the validation checklist (8). (40 %)
4. **In-game review & polish**: screenshot test at 20/40/80 m, elite rim and fossilize checks, final delivery of source + GLB. (30 %)

---

## 7. Blender workflow

(Blender 4.x; adjust menu names for your version.)

### 7.1 Scene setup

- Units: *Scene Properties → Units → Metric, Unit Scale 1.0, Length: Meters*.
- Model the creature **facing −Y** (it then looks at you in *Front* view, numpad 1). Its left side is **+X**.
- Ground plane at Z = 0; feet on the ground; hips over the world origin (ptero: body centre at the origin).
- Import the placeholder for reference: export it from the game (e.g. via three.js `GLTFExporter` in the browser
  console on the rig group), or rebuild it from the pivot tables in 5.3 as empties.

### 7.2 Modelling & paint

- Faceted low-poly: flat shading (*Object → Shade Flat*), no Subdivision in the export, no Auto Smooth.
- Paint with a **Color Attribute** in the **Face Corner** domain (byte color) for crisp per-face colors:
  back/base/belly gradient by facing, accents, ±10 % brightness jitter per face.
- Materials: `Skin` (Base Color white, uses the color attribute via a Color Attribute node) and one emissive material
  per glow hue (`Glow_Tag`, `Glow_Eye`: Emission color = tag hue, **Strength 4.5–8**). Avoid image textures entirely.

### 7.3 Rig-part hierarchy (creatures)

1. Create one **Empty** per part, named exactly per 5.3 (`body`, `neck`, `head`, `jaw`, …). Blender's `thigh.L` style
   also works, since three strips the dot → `thighL`; but don't mix both styles.
2. Place each empty **at the joint** (the pivot in 5.3, accumulated down the chain). **Rotation 0, scale 1** on every empty.
3. Parent the empties to match the hierarchy (*Ctrl+P → Object (Keep Transform)*), parent-first.
4. Split the mesh at the joints into per-part mesh objects (`head.geo`, …), cap holes, and parent each to its empty.
   Leave a little overlap at joints so rotations don't open gaps (the procedural gait swings thighs up to ~±0.8 rad).
5. **Apply transforms** on all mesh objects (*Ctrl+A → All Transforms*) **before** parenting, or use
   *Parent (Keep Transform)* and then apply the mesh objects' rotation/scale. The empties keep only location.
6. Test: rotate an empty about its local X by ±0.5 rad and check the part swings naturally (jaw opens with +X, tail lifts with +X).

### 7.4 Converting a skinned CC0/AI model to rigid parts

Put the armature in **Rest Position**, map source bones to our part names, and split faces by dominant bone weight:

```python
# Blender 4.x: split the active skinned mesh into rigid part meshes by dominant vertex group.
import bpy, bmesh
from collections import Counter

BONE_TO_PART = {  # edit for the source rig
    'Hips': 'body', 'Spine': 'body', 'Chest': 'body', 'Neck': 'neck', 'Head': 'head', 'Jaw': 'jaw',
    'Tail1': 'tail1', 'Tail2': 'tail2', 'Tail3': 'tail2',
    'Thigh.L': 'thighL', 'Shin.L': 'shinL', 'Foot.L': 'shinL',
    'Thigh.R': 'thighR', 'Shin.R': 'shinR', 'Foot.R': 'shinR',
    'Arm.L': 'armL', 'Arm.R': 'armR',
}
src = bpy.context.active_object
names = {vg.index: vg.name for vg in src.vertex_groups}
dom = []
for v in src.data.vertices:
    g = max(v.groups, key=lambda g: g.weight, default=None)
    dom.append(BONE_TO_PART.get(names[g.group], 'body') if g else 'body')
face_part = [Counter(dom[i] for i in p.vertices).most_common(1)[0][0] for p in src.data.polygons]

for part in sorted(set(face_part)):
    ob = src.copy(); ob.data = src.data.copy(); ob.name = part + '.geo'
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if face_part[f.index] != part], context='FACES')
    bm.to_mesh(ob.data); bm.free()
    ob.modifiers.clear(); ob.vertex_groups.clear(); ob.parent = None
print('split into', sorted(set(face_part)))
```

Then create the empties at the bone heads (7.3), parent each `*.geo` to its empty, delete the armature and the
original mesh. If the pack's clips are needed later, keep the original file: they can be retargeted to rotations on
the empties (bake action → *Visual Transform*) for the baked-clip path.

### 7.5 Decimation & vertex-color bake

- **Decimate** (*Modifier → Decimate → Collapse*), watching the triangle count in the viewport statistics overlay;
  aim for the target in 5.3, then fix silhouettes by hand. *Planar* decimation (angle 5–10°) is a good final pass for
  flat facets.
- **Texture → vertex color** (for AI/CC0 models with image textures): Cycles → *Bake → Type: Diffuse, Contributions:
  Color only → Output Target: Color Attributes* onto the Face Corner attribute; then flatten/quantize colors to the
  palette (or repaint by hand: usually faster and better at these budgets).
- Remove UV maps and image nodes before export.

### 7.6 glTF export settings (File → Export → glTF 2.0)

| Setting | Value |
|---|---|
| Format | **glTF Binary (.glb)** |
| Include | Selected Objects (select empties + meshes), Custom Properties off |
| Transform | **+Y Up: on** |
| Data → Mesh | Apply Modifiers **on**; UVs **off**; Normals optional (recomputed anyway); Tangents off; **Vertex Color: Active** (exports `COLOR_0`) |
| Data → Material | Export; **Images: None** |
| Data → Shape Keys / Skinning | **off** |
| Compression | **off**: the game's `GLTFLoader` has no Draco/Meshopt decoder or KTX2 transcoder configured |
| Animation | Props/cars: off. Rigs: off for now; for the future baked-clip path: on, *Always Sample*, 30 fps, one action per clip named per 5.3 |
| Lighting / cameras | off |

File naming: `<asset id>.glb` (lowercase, as in the manifest), sources as `<asset id>.blend` in `assets/source/`.

---

## 8. Validation checklist

Run for every asset before it lands in the manifest:

**File checks**

- [ ] **Khronos glTF-Validator** (`gltf_validator file.glb`, or the web validator): 0 errors; warnings reviewed.
- [ ] `npx @gltf-transform/cli inspect file.glb`: triangle count within budget (5.1–5.4), **no textures**, no
      skins/morphs, no compression extensions, materials ≤ 4.
- [ ] Bounding box matches 5.3/5.4 sizes (±10 %); origin per 4.1; forward +Z.
- [ ] Creatures: every part name present exactly once; hierarchy matches; joint nodes rotation 0 / scale 1;
      sockets (mouth, weakNeck, …) land on the right features (within ~5 cm).
- [ ] Gem is neutral white/grey (tinted at runtime); tracer is a unit box along +Z.

**In-game checks**

- [ ] Set `url` in `ASSET_MANIFEST`, reload, and confirm **no** `[assets] <id>: … failed, using the placeholder`
      warning in the console.
- [ ] Creature animates (legs, jaw, tail move). If it slides as a statue, the node names didn't match (4.3 fallback).
- [ ] Scale test next to the car and the placeholder. Proposed debug hook (not implemented yet): a URL parameter such
      as `?asset=raptor:./assets/models/creatures/raptor.glb` that overrides a manifest `url` without editing code,
      plus `?spawn=raptor` to spawn one in front of the car.
- [ ] Screenshot at **20 / 40 / 80 m** in twilight, midnight and golden looks; grayscale silhouette test against the
      other species.
- [ ] Hit flash reads (white), **elite** rim reads (magenta, 1.3×), **fossilize** turns it uniformly to stone and the
      glow switches off; shatter shards look right at the creature's size.
- [ ] Performance: spawn the species at full capacity; frame time doesn't regress more than ~1 ms vs the placeholder.
- [ ] Register the asset in `/ASSETS.md` (source, author, license, notes) **in the same commit**.

---

## 9. Prioritized roadmap

Ordered by **screenshot impact per hour**: what's in every trailer frame first.

| # | Asset(s) | Why first | Route | Est. effort |
|---|---|---|---|---|
| 1 | **GRIDLOCK** `trex` (phase 1) + collar | Key art, boss chase in every trailer; single instance so a big budget is free | Commission or Quaternius base + heavy rework | 3–5 days |
| 2 | **Sicklejaw** `raptor` | The most visible mid-size enemy, 240 on screen | Quaternius raptor → rigid split + restyle | 1–2 days |
| 3 | **Unit 77** `playerCar` + `turretGun` | Center of every frame (needs the car-kind consumer in `player.js`, see §10) | Kenney Car Kit base → armored rework | 2–3 days |
| 4 | Car attachments (all `att*`, `railGun`) | The visible build is a core screenshot hook | Kitbash (Kenney blaster parts) | 2 days |
| 5 | **Scuttler** `compy`, **Hornwall** `trike`, **Skyreaver** `ptero` | Swarm texture + the most dramatic silhouettes | CC0 bases / commission | 3–4 days |
| 6 | Pickups (`gem`, `crate`, …) + `shard`, `wreck` | Constantly on screen, cheap to make | In-house | 1 day |
| 7 | VFX textures (smoke/explosion flipbooks, telegraph decals) | Big polish win (needs a textured batch in code) | Kenney Particle Pack + in-house | 2 days + code |
| 8 | **Clubtail** `ankylo`, **Brute** `brute` | Fewer instances | CC0 / commission | 2–3 days |
| 9 | GRIDLOCK phase variants `trex_p2`, `trex_p3`; death polish | Boss arc | Same artist as #1 | 2 days + code |
| 10 | Audio: `trex_roar`, `fossilize`, `shatter_big`, weapons, then music stems | The procedural audio works; replace the signature sounds first | Commission + Freesound CC0 layers | 1–2 weeks |
| 11 | Car variants (Courier, Sweeper, Neon livery), extra icons | Meta-progression | Commission | 3–4 days |
| 12 | Boss 2 Hudson Leviathan, Boss 3 Skyline | New content (needs new rigs/poses or VAT) | Commission | 2–3 weeks each |

---

## 10. Known gaps in the code that affect art

These are observations only; this document doesn't change code.

1. **`playerCar` GLB isn't used yet:** `assets.js` loads `kind: 'car'` files, but `player.js` always calls
   `createTaxiModel()`. Car replacement needs a consumer that reads the GLB (and ideally the mount empties in 5.2).
2. **GRIDLOCK's pose lives in `boss.js`** (`TRexBoss.pose`, using `setJoint` from `poses.js`), not in `poses.js`.
   The boss clips in 5.3 are the spec for authored replacements of that procedural pose.
3. **Gait timing:** fixed. `poses.js` and `boss.js` now advance the gait phase by the game time elapsed since the
   creature was last posed, so it's frame-rate independent, which matters when tuning authored run cycles.
4. **Sockets and hit radii come from the placeholder,** not the GLB. Replacements must match placeholder proportions,
   or the loader should read `socket_*` empties from the file (recommended future change).
5. **Textures, roughness and metalness in GLBs are ignored** by design (vertex-color pipeline).
6. **Color-language conflicts in the placeholders:** Skyreaver magenta tags vs the elite magenta rim (2.4).
7. ~~No sample playback path in `audio.js` yet~~: done in v4 (sample voices, manifest, lazy loading; see 5.7).
