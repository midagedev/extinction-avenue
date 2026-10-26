import * as THREE from 'three/webgpu';
import { buildDinoModel } from './dino-models.js';
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

  // Creatures (capacity = max simultaneous individuals drawn)
  compy: { kind: 'rig', url: null, placeholder: 'compy', capacity: 700 },
  raptor: { kind: 'rig', url: null, placeholder: 'raptor', capacity: 240 },
  brute: { kind: 'rig', url: null, placeholder: 'brute', capacity: 48 },
  trike: { kind: 'rig', url: null, placeholder: 'trike', capacity: 24 },
  ankylo: { kind: 'rig', url: null, placeholder: 'ankylo', capacity: 16 },
  ptero: { kind: 'rig', url: null, placeholder: 'ptero', capacity: 40 },
  trex: { kind: 'rig', url: null, placeholder: 'trex', capacity: 1 },

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
      if (def.kind === 'rig') {
        const placeholder = buildDinoModel(def.placeholder);
        entry = { kind: 'rig', def, model: def.url ? await loadRigGLB(def.url, placeholder) : placeholder };
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
