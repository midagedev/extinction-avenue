import * as THREE from 'three/webgpu';
import { buildDinoModel, buildCollar } from './dino-models.js';
import { loadSkinnedModel } from './skin-model.js';
import { CLIP_LIBRARY } from './creature-clips.js';
import { buildPropGeometry } from './props.js';

// js/game/assets.js
// THE ASSET MANIFEST. Every model the game draws is listed here and loaded through loadAssets(), so the procedural
// placeholders can be swapped for glTF/GLB files by filling in `url` — no code changes needed (see docs/ART_PIPELINE.md).
//
// kind 'rig'  — a creature: either a GLB whose nodes are named like the placeholder's parts (body, neck, head, jaw,
//               tail1…, see dino-models.js; node transforms give the joint pivots, meshes are baked per part) or, for a
//               GLB without matching names, all its meshes merged into a single 'body' part (procedural bob only).
// kind 'prop' — a single instanced mesh (pickups, projectiles, debris, car attachments): every mesh of the GLB is
//               merged into one geometry; material colors become vertex colors, emissive colors the glow attribute.
// Placeholders are generated in code: dino-models.js (creatures) and props.js (everything else). The player taxi body
// comes from the city's own lofted car generator (actor-models.js) unless `url` is set.
//
// Conventions for replacement files: metres, +Y up, creatures face +Z with their origin on the ground under the hips,
// props centred on their pivot (see ART_PIPELINE.md for per-asset pivots, budgets and animation clips).

// The rigged theropod (auto-rigged CC0 sculpt by damik, see ASSETS.md): one mesh + textures shared by four species
const THEROPOD = 'assets/models/theropod.glb';
const THEROPOD_TEX = { map: 'assets/models/theropod_albedo.jpg', normal: 'assets/models/theropod_normal.jpg' };
function theropod(o) {
  return {
    clips: 'theropod', textures: THEROPOD_TEX, feet: ['toeL', 'toeR'],
    aliases: { body: 'spine', neck: 'neck1' }, headCenter: [0, -0.12, 0.62], ...o
  };
}

const ASSET_MANIFEST = {
  // Player vehicle (Big Apple Animal Control — Unit 77)
  playerCar: { kind: 'car', url: null, placeholder: 'taxi' },
  turretBase: { kind: 'prop', url: null, placeholder: 'turretBase' },
  turretGun: { kind: 'prop', url: null, placeholder: 'turretGun' },
  railGun: { kind: 'prop', url: null, placeholder: 'railGun' },
  tailGun: { kind: 'prop', url: null, placeholder: 'tailGun' }, // first-person view model (gun + gunner's hands)
  tailRail: { kind: 'prop', url: null, placeholder: 'tailRail' },
  tailMount: { kind: 'prop', url: null, placeholder: 'tailMount' },
  hatchRim: { kind: 'prop', url: null, placeholder: 'hatchRim' },
  attGatling: { kind: 'prop', url: null, placeholder: 'attGatling' },
  attMissiles: { kind: 'prop', url: null, placeholder: 'attMissiles' },
  attTesla: { kind: 'prop', url: null, placeholder: 'attTesla' },
  attFlamer: { kind: 'prop', url: null, placeholder: 'attFlamer' },
  attShotgun: { kind: 'prop', url: null, placeholder: 'attShotgun' },
  attPlow: { kind: 'prop', url: null, placeholder: 'attPlow' },
  attArmor: { kind: 'prop', url: null, placeholder: 'attArmor' },

  // Creatures (capacity = max simultaneous individuals drawn). `skin` = rigged GLB drawn by skin-rig.js (instanced
  // skinning); without it (or if loading fails) the procedural placeholder rig is used.
  compy: { kind: 'rig', url: THEROPOD, placeholder: 'compy', capacity: 700, skin: theropod({
    targetHeight: 0.63, radius: 0.3, morph: { head: 1.3, jaw: 1.3, neck2: [0.95, 0.95, 0.95], thighL: [1, 1.05, 1], thighR: [1, 1.05, 1] },
    look: { ramp: [[0.03, 0.07, 0.015], [0.22, 0.4, 0.06], [0.78, 0.84, 0.42]], stripes: [10, 0.65], stripeColor: [0.18, 0.2, 0.1], belly: [1.6, 1.45, 1.05], roughness: 0.72 }
  }) },
  raptor: { kind: 'rig', url: THEROPOD, placeholder: 'raptor', capacity: 240, skin: theropod({
    targetHeight: 1.78, radius: 0.55, morph: { head: 1.06, jaw: 1.06 },
    look: { ramp: [[0.07, 0.025, 0.01], [0.55, 0.23, 0.07], [0.96, 0.8, 0.52]], stripes: [7, 0.75], stripeColor: [0.22, 0.12, 0.08], belly: [1.55, 1.45, 1.25], roughness: 0.75 }
  }) },
  brute: { kind: 'rig', url: THEROPOD, placeholder: 'brute', capacity: 48, skin: theropod({
    targetHeight: 3.28, radius: 1.05,
    morph: { root: [1.16, 1.1, 1], spine: [1.2, 1.14, 1], chest: [1.2, 1.14, 1], neck1: [1.18, 1.12, 1], neck2: [1.14, 1.08, 1], head: 1.16, jaw: 1.16, thighL: [1.14, 1.04, 1.14], thighR: [1.14, 1.04, 1.14], tail1: [1.12, 1.1, 1] },
    look: { ramp: [[0.02, 0.025, 0.04], [0.19, 0.24, 0.3], [0.68, 0.72, 0.76]], blotch: [1.6, 0.55], blotchColor: [0.35, 0.36, 0.45], belly: [1.5, 1.45, 1.4], roughness: 0.78 }
  }) },
  // Hornwall: Quaternius' CC0 Triceratops (rig + 6 clips), refined by tools/lab/refine-quaternius.js (crease-aware
  // Loop subdivision ×2, 1.3k → 21k triangles, LOD1 5.3k); procedural hide detail in the shader
  trike: { kind: 'rig', url: 'assets/models/triceratops.glb', placeholder: 'trike', capacity: 24, skin: {
    targetHeight: 3.27, radius: 1.5, patternScale: 1.8, feet: [],
    clips: { run: 'Triceratops_Run', walk: 'Triceratops_Walk', idle: 'Triceratops_Idle', bite: 'Triceratops_Attack', paw: 'Triceratops_Attack', pounce: 'Triceratops_Jump', death: 'Triceratops_Death' },
    once: ['bite', 'pounce', 'death'], speeds: { run: 24, walk: 7 },
    aliases: { body: 'Body', head: 'Head', neck: 'Neck', jaw: '_none' }, headCenter: [0, -0.5, 1.3],
    look: { tint: [2.3, 2.15, 1.8], blotch: [1.5, 0.5], blotchColor: [0.55, 0.5, 0.42], stripes: [2.2, 0.4], stripeColor: [0.55, 0.48, 0.38], belly: [1.9, 1.75, 1.45], scaleFreq: 7, scaleBump: 0.03, roughness: 0.82 }
  } },
  // Spiketail (id kept as 'ankylo'): no CC0 rigged ankylosaur exists, so Quaternius' CC0 Stegosaurus stands in —
  // refined like the Triceratops (2.3k → 36k triangles, LOD1 9k); its tail-swing clip is the telegraphed swipe
  ankylo: { kind: 'rig', url: 'assets/models/stegosaurus.glb', placeholder: 'ankylo', capacity: 16, skin: {
    targetHeight: 2.75, radius: 2.0, patternScale: 1.8, feet: [],
    clips: { run: 'Stegosaurus_Run', walk: 'Stegosaurus_Walk', idle: 'Stegosaurus_Idle', bite: 'Stegosaurus_Attack', paw: 'Stegosaurus_Attack', pounce: 'Stegosaurus_Jump', death: 'Stegosaurus_Death' },
    once: ['bite', 'pounce', 'death'], speeds: { run: 26, walk: 7 },
    aliases: { body: 'Body', head: 'Head', neck: 'Neck', jaw: '_none' }, headCenter: [0, -0.2, 0.7],
    look: { tint: [1.35, 1.3, 1.25], blotch: [1.3, 0.5], blotchColor: [0.5, 0.42, 0.34], stripes: [3, 0.35], stripeColor: [0.55, 0.45, 0.38], belly: [1.8, 1.7, 1.45], scaleFreq: 8, scaleBump: 0.03, roughness: 0.82 }
  } },
  // Skyreaver: no CC0 rigged pterosaur exists — a high-detail procedural model (tools/lab/build-ptero.js, 17.5k
  // triangles, smooth lofted body / beak / crest, membrane wings) with procedural flight clips
  ptero: { kind: 'rig', url: 'assets/models/pterosaur.glb', placeholder: 'ptero', capacity: 40, skin: {
    clips: 'pterosaur', ground: false, targetWidth: 6.4, height: 0.86, radius: 1.2, feet: [], lodK: 1e9,
    aliases: { body: 'root' }, headCenter: [0, -0.02, 0.3],
    look: { tint: [1.2, 1.15, 1.25], stripes: [18, 0.4], stripeColor: [0.45, 0.3, 0.42], blotch: [3, 0.4], blotchColor: [0.6, 0.45, 0.6], belly: [2.2, 1.9, 2.1], scaleFreq: 14, scaleBump: 0.005, roughness: 0.66, rim: [0.16, 0.1, 0.2] }
  } },
  // GRIDLOCK: the same sculpt as a T. rex — huge head, short thick neck, tiny arms, heavier body, dark olive hide
  trex: { kind: 'rig', url: THEROPOD, placeholder: 'trex', capacity: 1, skin: theropod({
    targetHeight: 5.23, radius: 3.2, lodK: 1e9, collar: [[0, 3.62, 1.8], [0, 0.53, 0.35], 0.44],
    morph: {
      root: [1.15, 1.1, 1.04], spine: [1.2, 1.15, 1.04], chest: [1.22, 1.16, 1.06], neck1: [1.38, 0.92, 0.95], neck2: [1.42, 0.9, 0.95],
      head: [1.48, 1.44, 1.38], jaw: [1.48, 1.44, 1.38], armL: 0.42, foreL: 0.42, handL: 0.42, armR: 0.42, foreR: 0.42, handR: 0.42,
      tail1: [1.16, 1.12, 1.02], tail2: [1.1, 1.08, 1.02], thighL: [1.12, 1.03, 1.12], thighR: [1.12, 1.03, 1.12]
    },
    look: { ramp: [[0.025, 0.03, 0.018], [0.19, 0.18, 0.1], [0.66, 0.56, 0.36]], blotch: [1.1, 0.6], blotchColor: [0.45, 0.42, 0.34], stripes: [3.2, 0.35], stripeColor: [0.4, 0.38, 0.3], belly: [1.7, 1.5, 1.15], roughness: 0.74, rim: [0.16, 0.18, 0.26] }
  }) },

  // Pickups
  gem: { kind: 'prop', url: null, placeholder: 'gem' },
  crate: { kind: 'prop', url: null, placeholder: 'crate' },
  repair: { kind: 'prop', url: null, placeholder: 'repair' },
  nitro: { kind: 'prop', url: null, placeholder: 'nitro' },
  vacuum: { kind: 'prop', url: null, placeholder: 'vacuum' },
  airstrike: { kind: 'prop', url: null, placeholder: 'airstrike' },

  // Projectiles & world FX meshes
  tracer: { kind: 'prop', url: null, placeholder: 'tracer' },
  missile: { kind: 'prop', url: null, placeholder: 'missile' },
  mine: { kind: 'prop', url: null, placeholder: 'mine' },
  saw: { kind: 'prop', url: null, placeholder: 'saw' },
  shard: { kind: 'prop', url: null, placeholder: 'shard' },
  boulder: { kind: 'prop', url: null, placeholder: 'boulder' },
  wreck: { kind: 'prop', url: null, placeholder: 'wreck' }
};

// ?procedural: draw the v2 procedural creature rigs instead of the rigged models (comparison / very old devices)
const NO_SKIN = typeof location !== 'undefined' && new URLSearchParams(location.search).has('procedural');

let gltfLoaderPromise = null;
function getGLTFLoader() {
  gltfLoaderPromise ??= import('three/addons/loaders/GLTFLoader.js').then((m) => new m.GLTFLoader());
  return gltfLoaderPromise;
}

/** Bakes a mesh's material colors into vertex attributes (color, emissive) for the instanced vertex-color shaders */
function bakeMeshGeometry(mesh, matrix) {
  let g = mesh.geometry.clone();
  if (g.index) g = g.toNonIndexed();
  g.applyMatrix4(matrix);
  const n = g.getAttribute('position').count;
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const base = mat?.color || new THREE.Color(0.7, 0.7, 0.7);
  const emis = mat?.emissive ? mat.emissive.clone().multiplyScalar(mat.emissiveIntensity ?? 1) : new THREE.Color(0, 0, 0);
  const color = new Float32Array(n * 3);
  const emissive = new Float32Array(n * 3);
  const vc = g.getAttribute('color');
  for (let i = 0; i < n; i++) {
    color[i * 3] = base.r * (vc ? vc.getX(i) : 1);
    color[i * 3 + 1] = base.g * (vc ? vc.getY(i) : 1);
    color[i * 3 + 2] = base.b * (vc ? vc.getZ(i) : 1);
    emissive[i * 3] = emis.r;
    emissive[i * 3 + 1] = emis.g;
    emissive[i * 3 + 2] = emis.b;
  }
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('emissive', new THREE.BufferAttribute(emissive, 3));
  g.computeVertexNormals();
  return g;
}

async function mergeGLB(url) {
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const gltf = await (await getGLTFLoader()).loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const geos = [];
  gltf.scene.traverse((o) => { if (o.isMesh) geos.push(bakeMeshGeometry(o, o.matrixWorld)); });
  return mergeGeometries(geos, false);
}

/** A GLB creature: nodes named like the placeholder rig's parts become the parts (pivot = node position) */
async function loadRigGLB(url, placeholder) {
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const gltf = await (await getGLTFLoader()).loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts = [];
  const byName = new Map();
  root.traverse((o) => { if (placeholder.parts.some((p) => p.name === o.name)) byName.set(o.name, o); });
  if (byName.size >= 2 && byName.has('body')) {
    for (const p of placeholder.parts) {
      const node = byName.get(p.name);
      if (!node) continue;
      const inv = node.matrixWorld.clone().invert();
      const geos = [];
      node.traverse((o) => {
        // Meshes under this node but not under a deeper named part belong to this part
        if (!o.isMesh) return;
        let a = o.parent;
        while (a && a !== node && !byName.has(a.name)) a = a.parent;
        if (a === node || o === node) geos.push(bakeMeshGeometry(o, inv.clone().multiply(o.matrixWorld)));
      });
      const parentNode = byName.get(p.parent);
      const pivot = parentNode
        ? node.getWorldPosition(new THREE.Vector3()).applyMatrix4(parentNode.matrixWorld.clone().invert())
        : node.getWorldPosition(new THREE.Vector3());
      parts.push({ name: p.name, parent: parentNode ? p.parent : null, pivot: pivot.toArray(), geometry: geos.length ? mergeGeometries(geos) : new THREE.BufferGeometry() });
    }
    return { ...placeholder, parts };
  }
  const geos = [];
  root.traverse((o) => { if (o.isMesh) geos.push(bakeMeshGeometry(o, o.matrixWorld)); });
  return { ...placeholder, parts: [{ name: 'body', parent: null, pivot: [0, 0, 0], geometry: mergeGeometries(geos) }] };
}

/**
 * Loads every manifest entry: GLB when `url` is set (falling back to the placeholder on error), else the placeholder.
 * Returns a Map id → { kind, def, model | geometry }.
 */
async function loadAssets(manifest = ASSET_MANIFEST, onProgress = null) {
  const out = new Map();
  const ids = Object.keys(manifest);
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    const def = manifest[id];
    let entry = null;
    try {
      if (def.kind === 'rig' && def.skin && def.url && !NO_SKIN) {
        entry = { kind: 'rig', def, model: await loadSkinnedModel(id, def, CLIP_LIBRARY) };
        if (def.skin.collar) entry.attachments = [{ geometry: buildCollar(...def.skin.collar), bone: def.skin.collarBone || 'neck1' }];
      } else if (def.kind === 'rig') {
        const placeholder = buildDinoModel(def.placeholder);
        entry = { kind: 'rig', def, model: def.url && !def.skin ? await loadRigGLB(def.url, placeholder) : placeholder };
      } else if (def.kind === 'prop') {
        entry = { kind: 'prop', def, geometry: def.url ? await mergeGLB(def.url) : buildPropGeometry(def.placeholder) };
      } else if (def.kind === 'car') {
        entry = { kind: 'car', def, gltf: def.url ? await (await getGLTFLoader()).loadAsync(def.url) : null };
      }
    } catch (err) {
      console.warn(`[assets] ${id}: ${def.url} failed, using the placeholder`, err);
      entry = def.kind === 'rig'
        ? { kind: 'rig', def, model: buildDinoModel(def.placeholder) }
        : def.kind === 'prop' ? { kind: 'prop', def, geometry: buildPropGeometry(def.placeholder) } : { kind: 'car', def, gltf: null };
    }
    out.set(id, entry);
    done++;
    if (onProgress) onProgress(done / ids.length);
  }));
  return out;
}

export { ASSET_MANIFEST, loadAssets };
