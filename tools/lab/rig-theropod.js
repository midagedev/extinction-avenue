// Lab script: rigs the damik "dinosaur" sculpt (OpenGameArt, CC0, unrigged) and exports assets/models/theropod.glb.
//
// 1. Skeleton: 33 joints placed by hand from orthographic side/front views of the sculpt (tools/lab/ortho.js), in game
//    model space (metres, +Y up, +Z = snout, feet on y = 0). Leaf bones get explicit tips.
// 2. Skin weights: each vertex picks its nearest bone segment, then blends (inverse 4th power of distance) only with
//    that bone's parent / children — no leakage across chains (e.g. chest → arm). Limb bones are side-gated by x.
//    The jaw is split from the skull by GEODESIC distance on the mesh graph from a skull seed and a lower-jaw seed, so
//    the gums and teeth follow the right jaw even where the open mouth's teeth overlap in height. Tooth islands that the
//    graph can't reach take the label of the nearest labelled vertex.
// 3. LOD1: a ~6k-triangle decimation (three's SimplifyModifier) whose vertices copy the skin data of the original vertex
//    at the same position.
// 4. Export: GLB with the skinned mesh (LOD0 + LOD1 sharing one skeleton), no animation clips (the game generates its
//    keyframes procedurally per species, js/game/creature-clips.js) and no textures (shipped as JPEGs next to it).
// args: { debug: true } renders weight / test-pose views instead of only exporting
import { loadSculpt } from './sculpt.js';

// name, parent, [x, y, z] joint, tip (leaf bones)
const J = [
  ['root', null, [0, 2.95, 0.1]],
  ['spine', 'root', [0, 2.98, 0.72]],
  ['chest', 'spine', [0, 3.05, 1.28]],
  ['neck1', 'chest', [0, 3.35, 1.6]],
  ['neck2', 'neck1', [0, 3.88, 1.95]],
  ['head', 'neck2', [0, 4.25, 2.4], [0, 4.12, 3.82]],
  ['jaw', 'head', [0, 4.12, 2.72], [0, 3.72, 3.64]],
  ['tail1', 'root', [0, 2.95, -0.55]],
  ['tail2', 'tail1', [0, 2.9, -1.5]],
  ['tail3', 'tail2', [0, 3.0, -2.5]],
  ['tail4', 'tail3', [0, 3.35, -3.5]],
  ['tail5', 'tail4', [0, 3.85, -4.5]],
  ['tail6', 'tail5', [0, 4.12, -5.3], [0, 4.02, -6.0]],
  ['thighL', 'root', [0.6, 2.62, 0.0]],
  ['shinL', 'thighL', [0.7, 1.66, 0.22]],
  ['footL', 'shinL', [0.74, 1.3, -0.78]],
  ['toeL', 'footL', [0.78, 0.2, -0.14], [0.8, 0.05, 0.62]],
  ['armL', 'chest', [0.58, 2.95, 1.1]],
  ['foreL', 'armL', [0.62, 2.28, 1.16]],
  ['handL', 'foreL', [0.58, 1.93, 2.42], [0.55, 1.6, 2.7]]
];
// Mirror the left limbs
for (const j of J.slice()) {
  if (!j[0].endsWith('L')) continue;
  const m = (p) => p && [-p[0], p[1], p[2]];
  J.push([j[0].replace(/L$/, 'R'), j[1].endsWith('L') ? j[1].replace(/L$/, 'R') : j[1], m(j[2]), m(j[3])]);
}

export default async function rig(lab, args) {
  const { THREE } = lab;
  const { g } = await loadSculpt(lab);
  g.computeBoundingBox();
  const bb0 = g.boundingBox;
  g.translate(-(bb0.min.x + bb0.max.x) / 2, -bb0.min.y, 0);
  g.computeVertexNormals();
  const pos = g.attributes.position, n = pos.count;
  const names = J.map((j) => j[0]);
  const idx = new Map(names.map((nm, i) => [nm, i]));
  const parent = J.map((j) => (j[1] ? idx.get(j[1]) : -1));
  const P = J.map((j) => new THREE.Vector3(...j[2]));
  const children = names.map(() => []);
  parent.forEach((p, i) => { if (p >= 0) children[p].push(i); });
  // segment end: the (first) child's joint, or the tip
  const E = J.map((j, i) => (j[3] ? new THREE.Vector3(...j[3]) : children[i].length ? P[children[i].find((c) => !names[c].match(/^(thigh|arm|tail1)/)) ?? children[i][0]].clone() : P[i].clone()));
  // root segment runs from the pelvis to the spine; chest to neck base
  const segDist = (v, i) => {
    const a = P[i], b = E[i];
    const ab = _ab.subVectors(b, a), t = THREE.MathUtils.clamp(_av.subVectors(v, a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
    return _c.copy(a).addScaledVector(ab, t).distanceTo(v);
  };
  const _ab = new THREE.Vector3(), _av = new THREE.Vector3(), _c = new THREE.Vector3(), v = new THREE.Vector3();
  const side = (nm) => (nm.endsWith('L') ? 1 : nm.endsWith('R') ? -1 : 0);
  const isArm = (nm) => /^(arm|fore|hand)/.test(nm);
  const isLeg = (nm) => /^(thigh|shin|foot|toe)/.test(nm);

  // --- jaw / skull split (geodesic Voronoi on the mesh graph, head region only) ---------------------------------------
  const index = g.index.array;
  const inHead = new Uint8Array(n);
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i); inHead[i] = v.z > 2.25 && v.y > 3.35 ? 1 : 0; }
  const adj = Array.from({ length: n }, () => []);
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k], b = index[t + (k + 1) % 3];
      if (!inHead[a] || !inHead[b]) continue;
      adj[a].push(b); adj[b].push(a);
    }
  }
  const nearestVert = (p) => { let best = -1, bd = 1e9; for (let i = 0; i < n; i++) { if (!inHead[i]) continue; v.fromBufferAttribute(pos, i); const d = v.distanceToSquared(p); if (d < bd) { bd = d; best = i; } } return best; };
  const dijkstra = (seed) => {
    const dist = new Float64Array(n).fill(Infinity);
    dist[seed] = 0;
    // binary heap
    const heap = [[0, seed]];
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    while (heap.length) {
      const [d, i] = pop();
      if (d > dist[i]) continue;
      a.fromBufferAttribute(pos, i);
      for (const j of adj[i]) {
        const nd = d + a.distanceTo(b.fromBufferAttribute(pos, j));
        if (nd < dist[j]) { dist[j] = nd; push([nd, j]); }
      }
    }
    return dist;
  };
  const skullSeed = nearestVert(new THREE.Vector3(0, 4.62, 3.0));
  const jawSeed = nearestVert(new THREE.Vector3(0, 3.62, 3.25));
  const dS = dijkstra(skullSeed), dJ = dijkstra(jawSeed);
  const label = new Int8Array(n).fill(-1); // 0 skull, 1 jaw
  for (let i = 0; i < n; i++) if (inHead[i] && (isFinite(dS[i]) || isFinite(dJ[i]))) label[i] = dJ[i] < dS[i] ? 1 : 0;
  // unreachable islands (teeth): nearest labelled vertex
  const labelled = [];
  for (let i = 0; i < n; i++) if (label[i] >= 0) labelled.push(i);
  let islands = 0;
  for (let i = 0; i < n; i++) {
    if (!inHead[i] || label[i] >= 0) continue;
    v.fromBufferAttribute(pos, i);
    let best = -1, bd = 1e9;
    const w = new THREE.Vector3();
    for (const j of labelled) { const d = w.fromBufferAttribute(pos, j).distanceToSquared(v); if (d < bd) { bd = d; best = j; } }
    label[i] = best >= 0 ? label[best] : 0;
    islands++;
  }

  // --- weights ---------------------------------------------------------------------------------------------------------
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  const JAW = idx.get('jaw'), HEAD = idx.get('head');
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const d = names.map((nm, b) => {
      const s = side(nm);
      if (s && Math.sign(v.x) !== s && Math.abs(v.x) > 0.04) return Infinity;
      if (isArm(nm) && (v.z < 0.75 || v.y > 3.25)) return Infinity;
      if (isLeg(nm) && (v.y > 3.0 || v.z > 1.0 || v.z < -1.4)) return Infinity;
      if (b === JAW || b === HEAD) { if (!inHead[i]) return Infinity; if ((label[i] === 1) !== (b === JAW)) return Infinity; }
      return segDist(v, b);
    });
    let b0 = 0;
    for (let b = 1; b < d.length; b++) if (d[b] < d[b0]) b0 = b;
    const allowed = new Set([b0, ...children[b0]]);
    if (parent[b0] >= 0) allowed.add(parent[b0]);
    // the jaw blends with the neck behind the hinge (throat), the skull with the neck
    if (b0 === JAW) { allowed.add(idx.get('neck2')); allowed.delete(HEAD); }
    const cand = [...allowed].filter((b) => isFinite(d[b])).map((b) => [b, 1 / Math.pow(Math.max(d[b], 0.02), 4)]);
    cand.sort((a, b) => b[1] - a[1]);
    const top = cand.slice(0, 4);
    const sum = top.reduce((s, c) => s + c[1], 0);
    top.forEach(([b, w], k) => { skinIndex[i * 4 + k] = b; skinWeight[i * 4 + k] = w / sum; });
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  // --- LOD1 ------------------------------------------------------------------------------------------------------------
  const { SimplifyModifier } = await import('three/addons/modifiers/SimplifyModifier.js');
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', pos.clone());
  base.setAttribute('normal', g.attributes.normal.clone());
  base.setAttribute('uv', g.attributes.uv.clone());
  base.setIndex(g.index.clone());
  const t0 = performance.now();
  const lod = await new SimplifyModifier().modify(base, Math.floor(n * (1 - (args.lodRatio ?? 0.3))));
  const simplifyMs = performance.now() - t0;
  const lp = lod.attributes.position;
  const key = (x, y, z) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
  const map = new Map();
  for (let i = 0; i < n; i++) map.set(key(pos.getX(i), pos.getY(i), pos.getZ(i)), i);
  const lsi = new Uint16Array(lp.count * 4), lsw = new Float32Array(lp.count * 4);
  let missing = 0;
  for (let i = 0; i < lp.count; i++) {
    let o = map.get(key(lp.getX(i), lp.getY(i), lp.getZ(i)));
    if (o === undefined) { missing++; o = 0; }
    for (let k = 0; k < 4; k++) { lsi[i * 4 + k] = skinIndex[o * 4 + k]; lsw[i * 4 + k] = skinWeight[o * 4 + k]; }
  }
  lod.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(lsi, 4));
  lod.setAttribute('skinWeight', new THREE.Float32BufferAttribute(lsw, 4));
  lod.computeVertexNormals();

  // --- skeleton + export -----------------------------------------------------------------------------------------------
  const bones = J.map((j) => { const b = new THREE.Bone(); b.name = j[0]; return b; });
  bones.forEach((b, i) => {
    const p = parent[i];
    b.position.copy(P[i]).sub(p >= 0 ? P[p] : new THREE.Vector3());
    if (p >= 0) bones[p].add(b);
  });
  const root = new THREE.Group();
  root.name = 'Theropod';
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const mat = new THREE.MeshStandardMaterial({ name: 'TheropodSkin', color: 0xffffff, roughness: 0.62 });
  const mesh0 = new THREE.SkinnedMesh(g, mat); mesh0.name = 'Theropod_LOD0';
  const mesh1 = new THREE.SkinnedMesh(lod, mat); mesh1.name = 'Theropod_LOD1';
  for (const m of [mesh0, mesh1]) { root.add(m); m.bind(skeleton); }
  const out = { log: { verts: n, tris: g.index.count / 3, lodVerts: lp.count, lodTris: lod.index.count / 3, simplifyMs: Math.round(simplifyMs), lodMissing: missing, toothIslandVerts: islands, bones: names.length } };

  if (args.debug) {
    // weight view: colour by dominant bone
    const pal = names.map((nm, i) => new THREE.Color().setHSL((i * 0.618) % 1, 0.75, 0.55));
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const c = pal[skinIndex[i * 4]]; col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const dbgMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    mesh0.material = dbgMat;
    lab.clear();
    lab.stage.add(root);
    mesh1.visible = false;
    for (const [yaw, nm] of [[90, 'rig-weights-side'], [0, 'rig-weights-front'], [140, 'rig-weights-back']]) { lab.frame({ yaw, pitch: 8, dist: 0.62 }); await lab.snap(nm); }
    // test pose
    const R = (nm, x, y = 0, z = 0) => bones[idx.get(nm)].rotation.set(x, y, z);
    R('jaw', 0.35); R('neck1', 0.2, 0.3); R('head', -0.2, 0.2); R('thighL', -0.6); R('shinL', 0.9); R('footL', -0.6); R('thighR', 0.5); R('shinR', 0.3);
    R('tail2', 0, 0.3); R('tail3', 0.1, 0.3); R('tail4', 0, 0.3); R('armL', -0.5); R('foreL', 0.4);
    root.updateMatrixWorld(true);
    lab.frame({ yaw: 70, pitch: 8, dist: 0.62 }); await lab.snap('rig-pose-weights');
    mesh0.material = mat;
    const tl = new THREE.TextureLoader();
    mat.map = await tl.loadAsync('/.tools/dl/oga-damik-dinosaur/x/model/textures/creature_color_bake.png');
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.normalMap = await tl.loadAsync('/.tools/dl/oga-damik-dinosaur/x/model/textures/creature_normal.png');
    mat.needsUpdate = true;
    lab.frame({ yaw: 70, pitch: 8, dist: 0.62 }); await lab.snap('rig-pose-textured');
    lab.frame({ yaw: 60, pitch: 5, dist: 0.25, target: [0, 4.0, 3.0] }); await lab.snap('rig-pose-head');
    mesh0.visible = false; mesh1.visible = true;
    lab.frame({ yaw: 70, pitch: 8, dist: 0.62 }); await lab.snap('rig-pose-lod1');
    return out;
  }
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  const bytes = new Uint8Array(glb);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  out.files = { 'assets/models/theropod.glb': btoa(s) };
  return out;
}
