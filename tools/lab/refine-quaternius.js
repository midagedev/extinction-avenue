// Lab script: turns a faceted low-poly rigged GLB (Quaternius CC0 packs) into a smooth, denser one that keeps its
// skeleton and animation clips.
//   1. Weld the primitives (split per flat-shaded face / per material) into one triangle mesh by position.
//   2. Crease-aware Loop subdivision, `levels` times. Edges between different materials, boundary edges and edges
//      sharper than `sharpDeg` are creases (no smoothing across them); materials listed in `linear` (horns, claws, eyes)
//      are tessellated without smoothing so their shapes don't shrink. Skin weights are interpolated with exactly the
//      same stencils as the positions (top 4 influences kept), so the refined mesh deforms like the original.
//   3. Re-split vertices per material, bake the material colour into COLOR_0, smooth normals within each material.
//   4. Export: LOD0 = `levels`, LOD1 = one level less (≥ 1), bound to the ORIGINAL skeleton, with the original clips.
// args: { src, out, levels: 2, sharpDeg: 70, linear: ['MaterialName', ...], tint: { name: [r, g, b] } }
export default async function refine(lab, args) {
  const { THREE } = lab;
  const gltf = await lab.load(args.src);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const skeleton = meshes[0].skeleton, bindMatrix = meshes[0].bindMatrix.clone();
  const boneIdx = new Map(skeleton.bones.map((b, i) => [b, i]));
  // ---- 1. weld --------------------------------------------------------------------------------------------------------
  const P = [], W = [], key = new Map(), faces = [], mats = [];
  const matId = new Map();
  for (const m of meshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!matId.has(mat.name)) { matId.set(mat.name, mats.length); mats.push(mat); }
    const mi = matId.get(mat.name);
    const g = m.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const map = [];
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
      let v = key.get(k);
      if (v === undefined) {
        v = P.length / 3; key.set(k, v);
        P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        const w = new Map();
        for (let c = 0; c < 4; c++) { const ww = sw.getComponent(i, c); if (ww > 0) { const b = boneIdx.get(m.skeleton.bones[si.getComponent(i, c)]); w.set(b, (w.get(b) || 0) + ww); } }
        W.push(w);
      }
      map.push(v);
    }
    const idx = g.index ? g.index.array : [...Array(pos.count).keys()];
    for (let t = 0; t < idx.length; t += 3) {
      const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]];
      if (a !== b && b !== c && a !== c) faces.push([a, b, c, mi]);
    }
  }
  const linear = new Set((args.linear || []).map((n) => matId.get(n)).filter((x) => x !== undefined));
  const log = { inVerts: P.length / 3, inTris: faces.length, materials: mats.map((m) => m.name) };
  const sharpCos = Math.cos(THREE.MathUtils.degToRad(args.sharpDeg ?? 70));

  // ---- 2. Loop subdivision ------------------------------------------------------------------------------------------
  function subdivide(P, W, faces) {
    const nv = P.length / 3;
    const edges = new Map(); // "a_b" (a<b) → { a, b, faces: [fi...], opp: [v...] }
    const ek = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const fn = faces.map(([a, b, c]) => {
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(...n) || 1;
      return n.map((x) => x / l);
    });
    faces.forEach(([a, b, c], fi) => {
      for (const [x, y, o] of [[a, b, c], [b, c, a], [c, a, b]]) {
        const k = ek(x, y);
        let e = edges.get(k);
        if (!e) { e = { a: Math.min(x, y), b: Math.max(x, y), faces: [], opp: [] }; edges.set(k, e); }
        e.faces.push(fi); e.opp.push(o);
      }
    });
    // creases
    const vCrease = Array.from({ length: nv }, () => []);
    const vNbr = Array.from({ length: nv }, () => new Set());
    const vLinear = new Uint8Array(nv);
    for (const f of faces) if (linear.has(f[3])) for (let k = 0; k < 3; k++) vLinear[f[k]] = 1;
    for (const e of edges.values()) {
      vNbr[e.a].add(e.b); vNbr[e.b].add(e.a);
      let crease = e.faces.length !== 2;
      if (!crease) {
        const [f0, f1] = e.faces;
        if (faces[f0][3] !== faces[f1][3]) crease = true;
        else { const n0 = fn[f0], n1 = fn[f1]; if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < sharpCos) crease = true; }
      }
      e.crease = crease;
      if (crease) { vCrease[e.a].push(e.b); vCrease[e.b].push(e.a); }
    }
    const NP = [], NW = [];
    const mixW = (terms) => { const m = new Map(); for (const [w, k] of terms) for (const [b, x] of w) m.set(b, (m.get(b) || 0) + x * k); return m; };
    // vertex points
    for (let v = 0; v < nv; v++) {
      const nb = [...vNbr[v]];
      let terms;
      if (vLinear[v] || vCrease[v].length > 2) terms = [[v, 1]];
      else if (vCrease[v].length === 2) terms = [[v, 0.75], [vCrease[v][0], 0.125], [vCrease[v][1], 0.125]];
      else {
        const n = nb.length, beta = n === 3 ? 3 / 16 : 3 / (8 * n);
        terms = [[v, 1 - n * beta], ...nb.map((u) => [u, beta])];
      }
      NP.push(...[0, 1, 2].map((c) => terms.reduce((s, [u, k]) => s + P[u * 3 + c] * k, 0)));
      NW.push(mixW(terms.map(([u, k]) => [W[u], k])));
    }
    // edge points
    const eIndex = new Map();
    for (const [k, e] of edges) {
      let terms;
      const lin = e.faces.some((f) => linear.has(faces[f][3]));
      if (e.crease || lin) terms = [[e.a, 0.5], [e.b, 0.5]];
      else terms = [[e.a, 0.375], [e.b, 0.375], [e.opp[0], 0.125], [e.opp[1], 0.125]];
      eIndex.set(k, NP.length / 3);
      NP.push(...[0, 1, 2].map((c) => terms.reduce((s, [u, kk]) => s + P[u * 3 + c] * kk, 0)));
      NW.push(mixW(terms.map(([u, kk]) => [W[u], kk])));
    }
    const NF = [];
    for (const [a, b, c, m] of faces) {
      const ab = eIndex.get(ek(a, b)), bc = eIndex.get(ek(b, c)), ca = eIndex.get(ek(c, a));
      NF.push([a, ab, ca, m], [ab, b, bc, m], [ca, bc, c, m], [ab, bc, ca, m]);
    }
    return [NP, NW, NF];
  }

  // ---- 3. build geometry ----------------------------------------------------------------------------------------------
  function build(P, W, faces) {
    const map = new Map(), pos = [], col = [], si = [], sw = [], idx = [];
    for (const f of faces) {
      for (let k = 0; k < 3; k++) {
        const v = f[k], kk = `${v}:${f[3]}`;
        let o = map.get(kk);
        if (o === undefined) {
          o = pos.length / 3; map.set(kk, o);
          pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          const mat = mats[f[3]];
          const tint = args.tint?.[mat.name];
          const c = tint ? new THREE.Color(...tint) : mat.color;
          col.push(c.r, c.g, c.b);
          const top = [...W[v]].filter(([, x]) => x > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
          const sum = top.reduce((s, [, x]) => s + x, 0) || 1;
          for (let q = 0; q < 4; q++) { si.push(top[q] ? top[q][0] : 0); sw.push(top[q] ? top[q][1] / sum : 0); }
        }
        idx.push(o);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const levels = args.levels ?? 2;
  let cur = [P, W, faces];
  const lodGeos = [];
  for (let l = 1; l <= levels; l++) {
    cur = subdivide(...cur);
    if (l === Math.max(1, levels - 1) || l === levels) lodGeos.push([l, build(...cur)]);
  }
  const lod0 = lodGeos[lodGeos.length - 1][1], lod1 = lodGeos.length > 1 ? lodGeos[0][1] : null;
  log.lod0Tris = lod0.index.count / 3; log.lod0Verts = lod0.attributes.position.count;
  if (lod1) log.lod1Tris = lod1.index.count / 3;

  // ---- 4. swap meshes and export -------------------------------------------------------------------------------------
  const parent = meshes[0].parent;
  for (const m of meshes) m.parent.remove(m);
  const mat = new THREE.MeshStandardMaterial({ name: 'Skin', vertexColors: true, roughness: 0.8 });
  const out = [];
  for (const [g, name] of [[lod0, 'Body_LOD0'], [lod1, 'Body_LOD1']]) {
    if (!g) continue;
    const sm = new THREE.SkinnedMesh(g, mat);
    sm.name = name;
    parent.add(sm);
    sm.bind(skeleton, bindMatrix);
    out.push(sm);
  }
  scene.updateMatrixWorld(true);
  if (args.preview) {
    lab.clear();
    lab.stage.add(scene);
    out[1] && (out[1].visible = false);
    const mixer = new THREE.AnimationMixer(scene);
    const clip = gltf.animations.find((a) => a.name.includes(args.previewClip || 'Walk'));
    if (clip) { mixer.clipAction(clip).play(); mixer.setTime(args.previewT || 0.3); }
    lab.frame({ yaw: 50, pitch: 12, dist: 0.7 });
    await lab.snap(args.preview);
    return { log };
  }
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: gltf.animations });
  const bytes = new Uint8Array(glb);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { log, files: { [args.out]: btoa(s) } };
}
