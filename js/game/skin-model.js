import * as THREE from 'three/webgpu';

// js/game/skin-model.js
// Loads a rigged glTF/GLB creature into the SKINNED MODEL format drawn by skin-rig.js, and bakes its animation clips.
//
// SKINNED MODEL (one per species; species built from the same GLB share geometry):
//   {
//     id, kind: 'skinned', geometries: [LOD0, LOD1?]  (position, normal, uv, skinIndex, skinWeight [, color]) in MODEL
//     space: metres, +Y up, +Z forward (snout), feet on y = 0, rest pose = bind pose (every skinning matrix = identity),
//     bones: { names, parent: Int16Array, rest: Float32Array(n × 3) joint positions in model space (with the morph),
//              bind: the same in geometry space (without the morph) },
//     clips: [{ name, loop, fps, frames, duration, speed (model units/s, locomotion), data: Float32Array(frames × n × 12) }],
//     clipIndex: Map(name → index), baseScale (render scale of the model), length / height / width / radius (metres,
//     after baseScale), def (the manifest entry)
//   }
//   data holds, per frame and bone, the 3×4 SKINNING MATRIX (rows) that maps a rest-pose model-space point to its
//   animated model-space position. Blending, root transform and instancing happen in skin-rig.js.
//
// Clip sources:
//   - the GLB's own animations (Quaternius packs): sampled at 30 fps through an AnimationMixer, root drift removed
//   - procedural keyframes (creature-clips.js) for rigs without clips: joint rotations per frame → FK with per-bone
//     MORPH scales (non-inheriting, children re-attached at the scaled offsets): that is how one sculpt becomes a compy, a
//     raptor, a brute or a big-headed, tiny-armed T. rex.

const FPS = 30;
let loaderPromise = null;
const gltfCache = new Map();
const geoCache = new Map();

function getLoader() {
  loaderPromise ??= import('three/addons/loaders/GLTFLoader.js').then((m) => new m.GLTFLoader());
  return loaderPromise;
}

async function loadGLTF(url) {
  if (!gltfCache.has(url)) gltfCache.set(url, getLoader().then((l) => l.loadAsync(url)));
  return gltfCache.get(url);
}

/** Normalisation matrix for a GLB (model space): rotation about Y, uniform scale, then feet on the ground / centred */
function normMatrix(skin) {
  const m = new THREE.Matrix4().makeRotationY(skin.rotY || 0);
  if (skin.importScale) m.premultiply(new THREE.Matrix4().makeScale(skin.importScale, skin.importScale, skin.importScale));
  return m;
}

/**
 * Raw skinned data of a GLB (shared per url + import transform): merged geometry per LOD (material colours baked into a
 * vertex colour when the file has no textures), bone list, bind-pose joint positions, inverse bind matrices.
 */
async function rawSkin(url, skin) {
  const key = `${url}|${skin.rotY || 0}|${skin.importScale || 1}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const p = (async () => {
    const gltf = await loadGLTF(url);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    if (!meshes.length) throw new Error(`${url}: no skinned mesh`);
    const skeleton = meshes[0].skeleton;
    const bones = skeleton.bones;
    const boneIndex = new Map(bones.map((b, i) => [b, i]));
    const N = normMatrix(skin);
    // Group meshes into LODs by name suffix (_LOD1), everything else is LOD0
    const lods = [[], []];
    for (const m of meshes) lods[/LOD1$/i.test(m.name) ? 1 : 0].push(m);
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const geometries = [];
    for (const list of lods) {
      if (!list.length) continue;
      const parts = list.map((m) => {
        let g = m.geometry.clone();
        const M = N.clone().multiply(m.bindMatrix);
        g.applyMatrix4(M);
        // remap joint indices to the shared skeleton
        const si = g.getAttribute('skinIndex');
        const out = new Uint16Array(si.count * 4);
        for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) out[i * 4 + k] = boneIndex.get(m.skeleton.bones[si.getComponent(i, k)]) ?? 0;
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out, 4));
        // material colour → vertex colour (flat-colour packs); textured materials keep white
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        if (!mat.map) {
          const c = mat.color || new THREE.Color(1, 1, 1);
          const col = new Float32Array(g.getAttribute('position').count * 3);
          for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        }
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color'].includes(k)) g.deleteAttribute(k);
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        return g;
      });
      const merged = parts.length > 1 ? mergeGeometries(parts.map((g) => (g.getAttribute('color') ? g : withWhite(g)))) : parts[0];
      geometries.push(merged);
    }
    // feet on the ground, centred on x (bind pose)
    const box = new THREE.Box3();
    geometries[0].computeBoundingBox();
    box.copy(geometries[0].boundingBox);
    const shift = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, 0);
    for (const g of geometries) { g.translate(shift.x, shift.y, shift.z); g.computeBoundingBox(); g.computeBoundingSphere(); }
    const T = new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z).multiply(N);
    const names = bones.map((b) => b.name.replace(/[.:]/g, '_'));
    const parent = new Int16Array(bones.map((b) => (boneIndex.has(b.parent) ? boneIndex.get(b.parent) : -1)));
    const rest = new Float32Array(bones.length * 3);
    const tmp = new THREE.Matrix4(), v = new THREE.Vector3();
    bones.forEach((b, i) => { tmp.copy(skeleton.boneInverses[i]).invert(); v.setFromMatrixPosition(tmp).applyMatrix4(T); rest.set([v.x, v.y, v.z], i * 3); });
    return { gltf, skeleton, bones, names, parent, rest, T, Tinv: T.clone().invert(), geometries };
  })();
  geoCache.set(key, p);
  return p;
}
function withWhite(g) {
  const col = new Float32Array(g.getAttribute('position').count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const texCache = new Map();
function loadTexture(url, srgb) {
  if (!texCache.has(url)) {
    texCache.set(url, new THREE.TextureLoader().loadAsync(url).then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    }));
  }
  return texCache.get(url);
}

// ---- Baking ----------------------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
function writeRows(out, o, m) {
  const e = m.elements; // column-major
  out[o] = e[0]; out[o + 1] = e[4]; out[o + 2] = e[8]; out[o + 3] = e[12];
  out[o + 4] = e[1]; out[o + 5] = e[5]; out[o + 6] = e[9]; out[o + 7] = e[13];
  out[o + 8] = e[2]; out[o + 9] = e[6]; out[o + 10] = e[10]; out[o + 11] = e[14];
}

/** Samples a GLB animation clip into skinning matrices (model space), removing horizontal root drift on loops */
function bakeGLBClip(raw, clip, { name, loop = true, speed = 0 }) {
  const { gltf, skeleton, bones, T, Tinv } = raw;
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.play();
  const dur = clip.duration;
  const frames = Math.max(2, Math.round(dur * FPS) + (loop ? 0 : 1));
  const n = bones.length;
  const data = new Float32Array(frames * n * 12);
  const rootPos = [];
  const v = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    const t = loop ? (f / frames) * dur : Math.min(dur, f / FPS);
    mixer.setTime(t);
    gltf.scene.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      _m.multiplyMatrices(bones[i].matrixWorld, skeleton.boneInverses[i]);
      _m2.multiplyMatrices(T, _m).multiply(Tinv);
      writeRows(data, (f * n + i) * 12, _m2);
    }
    v.setFromMatrixPosition(bones[0].matrixWorld).applyMatrix4(T);
    rootPos.push(v.clone());
  }
  // remove horizontal drift (root motion) so locomotion runs in place
  if (loop && frames > 2) {
    const d = rootPos[frames - 1].clone().sub(rootPos[0]).multiplyScalar(frames / (frames - 1));
    d.y = 0;
    for (let f = 0; f < frames; f++) {
      const k = f / frames;
      for (let i = 0; i < n; i++) { const o = (f * n + i) * 12; data[o + 3] -= d.x * k; data[o + 11] -= d.z * k; }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  return { name, loop, fps: FPS, frames, duration: dur, speed, data };
}

/**
 * FK bake of procedural keyframes with per-bone morph scales.
 * skel: { names, parent, rest (unmorphed joints) }; scales: Float32Array(n × 3); frameFn(t, rot (n × 3 euler YXZ), root
 * offset vec3) fills the pose of time t (seconds).
 */
function bakeFK(skel, scales, rest, clip, frameFn) {
  const n = skel.names.length;
  const frames = Math.max(2, Math.round(clip.duration * FPS) + (clip.loop ? 0 : 1));
  const data = new Float32Array(frames * n * 12);
  const rot = new Float32Array(n * 3), off = new THREE.Vector3();
  const wq = Array.from({ length: n }, () => new THREE.Quaternion());
  const wp = Array.from({ length: n }, () => new THREE.Vector3());
  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), d = new THREE.Vector3(), s = new THREE.Vector3();
  const M = new THREE.Matrix4(), Tm = new THREE.Matrix4();
  for (let f = 0; f < frames; f++) {
    const t = clip.loop ? (f / frames) * clip.duration : Math.min(clip.duration, f / FPS);
    rot.fill(0); off.set(0, 0, 0);
    frameFn(t, rot, off);
    for (let i = 0; i < n; i++) {
      const p = skel.parent[i];
      e.set(rot[i * 3], rot[i * 3 + 1], rot[i * 3 + 2], 'YXZ');
      q.setFromEuler(e);
      if (p < 0) {
        wp[i].set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]).add(off);
        wq[i].copy(q);
      } else {
        // offset from the parent's joint, in the parent's (rest = model-aligned) frame, stretched by the parent's scale
        d.set(skel.rest[i * 3] - skel.rest[p * 3], skel.rest[i * 3 + 1] - skel.rest[p * 3 + 1], skel.rest[i * 3 + 2] - skel.rest[p * 3 + 2]);
        d.multiply(s.set(scales[p * 3], scales[p * 3 + 1], scales[p * 3 + 2])).applyQuaternion(wq[p]);
        wp[i].copy(wp[p]).add(d);
        wq[i].multiplyQuaternions(wq[p], q);
      }
      // skinning matrix: T(world joint) · R · S(morph) · T(−unmorphed rest joint)
      M.compose(wp[i], wq[i], s.set(scales[i * 3], scales[i * 3 + 1], scales[i * 3 + 2]));
      Tm.makeTranslation(-skel.rest[i * 3], -skel.rest[i * 3 + 1], -skel.rest[i * 3 + 2]);
      M.multiply(Tm);
      writeRows(data, (f * n + i) * 12, M);
    }
  }
  return { name: clip.name, loop: !!clip.loop, fps: FPS, frames, duration: clip.duration, speed: clip.speed || 0, data };
}

/** Morphed rest joints (FK with zero rotations) */
function morphedRest(skel, scales) {
  const n = skel.names.length, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = skel.parent[i];
    for (let k = 0; k < 3; k++) {
      out[i * 3 + k] = p < 0 ? skel.rest[i * 3 + k] : out[p * 3 + k] + (skel.rest[i * 3 + k] - skel.rest[p * 3 + k]) * scales[p * 3 + k];
    }
  }
  return out;
}

/**
 * Builds a species model from a manifest entry: def.url (GLB) + def.skin:
 *   { rotY, importScale, baseScale, morph: { bone: [sx, sy, sz] }, clips: 'theropod' | { logical: 'GLB clip name' },
 *     speeds: { logical: model units / s }, once: [logical clips that don't loop], aliases, ... }
 * clipLib: { theropod: (skel, rest, opts) → [{ name, loop, duration, speed, frame(t, rot, off) }] } (creature-clips.js)
 */
async function loadSkinnedModel(id, def, clipLib) {
  const skin = def.skin;
  const raw = await rawSkin(def.url, skin);
  const n = raw.names.length;
  const idx = new Map(raw.names.map((nm, i) => [nm, i]));
  const scales = new Float32Array(n * 3).fill(1);
  for (const [bone, sc] of Object.entries(skin.morph || {})) {
    const i = idx.get(bone);
    if (i !== undefined) scales.set(Array.isArray(sc) ? sc : [sc, sc, sc], i * 3);
  }
  const skel = { names: raw.names, parent: raw.parent, rest: raw.rest };
  if (skin.textures) {
    const tx = skin.textures;
    if (tx.map && !tx.mapTex) tx.mapTex = await loadTexture(tx.map, true);
    if (tx.normal && !tx.normalTex) tx.normalTex = await loadTexture(tx.normal, false);
  }
  const rest = morphedRest(skel, scales);
  // keep the feet on the ground after the morph (lowest of the foot joints)
  let lift = 0;
  if (skin.feet) {
    let dy = 0, c = 0;
    for (const f of skin.feet) { const i = idx.get(f); if (i !== undefined) { dy += rest[i * 3 + 1] - raw.rest[i * 3 + 1]; c++; } }
    lift = c ? -dy / c : 0;
  }
  for (let i = 0; i < n; i++) if (raw.parent[i] < 0) rest[i * 3 + 1] += lift;
  const clips = [];
  if (typeof skin.clips === 'string') {
    const gen = clipLib[skin.clips];
    for (const c of gen({ ...skel, index: idx, morphRest: rest, scales }, skin.clipOpts || {})) {
      clips.push(bakeFK(skel, scales, rest, c, c.frame));
    }
  } else {
    for (const [logical, src] of Object.entries(skin.clips || {})) {
      const clip = raw.gltf.animations.find((a) => a.name === src || a.name.endsWith(`|${src}`) || a.name.endsWith(src));
      if (!clip) { console.warn(`[skin] ${id}: clip ${src} not found`); continue; }
      clips.push(bakeGLBClip(raw, clip, { name: logical, loop: !(skin.once || []).includes(logical), speed: skin.speeds?.[logical] || 0 }));
    }
  }
  let bs = skin.baseScale || 1;
  // Size of the morphed, posed mesh (first frame of the idle / first clip), for hit radii and spawn spacing
  const ci = Math.max(0, clips.findIndex((c) => c.name === 'idle'));
  const size = clips.length ? posedBox(raw.geometries[raw.geometries.length - 1], clips[ci], n) : raw.geometries[0].boundingBox.getSize(new THREE.Vector3());
  const maxY = size.y;
  // gameplay height target (keeps hit boxes, spawn spacing and framing of the v2 creatures)
  if (skin.targetHeight) { bs = skin.targetHeight / maxY; size.multiplyScalar(1); }
  return {
    id, kind: 'skinned', def, geometries: raw.geometries, baseScale: bs,
    // rest: morphed joints (clip authoring); bind: geometry-space joints (what the skinning matrices transform)
    bones: { names: raw.names, parent: raw.parent, rest, bind: raw.rest, index: idx },
    clips, clipIndex: new Map(clips.map((c, i) => [c.name, i])),
    length: +(size.z * bs).toFixed(2), height: +(maxY * bs).toFixed(2), width: +(size.x * bs).toFixed(2),
    radius: skin.radius ?? Math.max(size.x, size.z * 0.35) * bs,
    triangles: raw.geometries.map((g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3)
  };
}

/** Bounding-box size of a geometry posed by frame 0 of a baked clip */
function posedBox(g, clip, n) {
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const box = new THREE.Box3(), v = new THREE.Vector3();
  const d = clip.data;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (!w) continue;
      const o = si.getComponent(i, k) * 12;
      ox += w * (d[o] * x + d[o + 1] * y + d[o + 2] * z + d[o + 3]);
      oy += w * (d[o + 4] * x + d[o + 5] * y + d[o + 6] * z + d[o + 7]);
      oz += w * (d[o + 8] * x + d[o + 9] * y + d[o + 10] * z + d[o + 11]);
    }
    box.expandByPoint(v.set(ox, oy, oz));
  }
  void n;
  return box.getSize(new THREE.Vector3()).setY(box.max.y);
}

export { loadSkinnedModel, loadGLTF };
