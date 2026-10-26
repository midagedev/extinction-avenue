// Lab script: builds the procedural high-detail pterosaur (Skyreaver) and exports assets/models/pterosaur.glb.
// No CC0 rigged pterosaur exists (see ASSETS.md), so this is the documented last-resort path: a smooth mesh generated
// in code — Catmull-Rom lofted tubes (24 sides) for body, neck, skull + upper beak, lower jaw, limbs and tail, a
// swept crest blade, a wing membrane with thickness and a concave trailing edge, eyes and claws — with skin weights
// assigned ANALYTICALLY from the generation parameters (each ring / membrane strip knows which bones it belongs to),
// bound to a 22-bone skeleton. Model space: metres, +Z forward, +Y up, origin at the body centre, wings spread.
// Animation clips are procedural (js/game/creature-clips.js, 'pterosaur').
// args: { preview: name } renders instead of exporting

const BONES = [
  ['root', null, [0, 0, 0]], ['neck', 'root', [0, 0.06, 0.4]], ['head', 'neck', [0, 0.19, 0.93]], ['jaw', 'head', [0, 0.13, 1.0]],
  ['tail', 'root', [0, 0.0, -0.45]],
  ['armL', 'root', [0.13, 0.06, 0.26]], ['foreL', 'armL', [0.55, 0.06, 0.2]], ['handL', 'foreL', [0.98, 0.07, 0.3]],
  ['finger1L', 'handL', [1.05, 0.07, 0.26]], ['finger2L', 'finger1L', [2.15, 0.05, 0.02]],
  ['thighL', 'root', [0.1, -0.07, -0.3]], ['shinL', 'thighL', [0.16, -0.1, -0.55]]
];
for (const b of BONES.slice()) if (b[0].endsWith('L')) BONES.push([b[0].replace(/L$/, 'R'), b[1].endsWith('L') ? b[1].replace(/L$/, 'R') : b[1], [-b[2][0], b[2][1], b[2][2]]]);

export default async function build(lab, args) {
  const { THREE } = lab;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const names = BONES.map((b) => b[0]);
  const B = new Map(names.map((n, i) => [n, i]));
  const pos = [], col = [], si = [], sw = [], idx = [];
  const push = (p, c, w) => {
    pos.push(p.x, p.y, p.z); col.push(...c);
    const e = Object.entries(w).filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = e.reduce((t, [, v]) => t + v, 0) || 1;
    for (let k = 0; k < 4; k++) { si.push(e[k] ? B.get(e[k][0]) : 0); sw.push(e[k] ? e[k][1] / s : 0); }
    return pos.length / 3 - 1;
  };
  // lofted tube through control points [x, y, z, rx, ry]; colour; weight(u) → { bone: w }
  function tube(ctrl, color, weight, { seg = 24, rings = 28, capStart = true, capEnd = true, roll = 0 } = {}) {
    const curve = new THREE.CatmullRomCurve3(ctrl.map((c) => V(c[0], c[1], c[2])));
    const rad = (u) => { const f = u * (ctrl.length - 1), i = Math.min(ctrl.length - 2, Math.floor(f)), t = f - i; return [ctrl[i][3] + (ctrl[i + 1][3] - ctrl[i][3]) * t, ctrl[i][4] + (ctrl[i + 1][4] - ctrl[i][4]) * t]; };
    const ringIdx = [];
    let N = new THREE.Vector3(), up = V(0, 1, 0);
    for (let r = 0; r <= rings; r++) {
      const u = r / rings, p = curve.getPointAt(u), T = curve.getTangentAt(u);
      const side = new THREE.Vector3().crossVectors(Math.abs(T.y) > 0.95 ? V(1, 0, 0) : up, T).normalize();
      N.crossVectors(T, side).normalize();
      const [rx, ry] = rad(u);
      const w = weight(u);
      const ring = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2 + roll;
        const q = p.clone().addScaledVector(side, Math.cos(a) * rx).addScaledVector(N, Math.sin(a) * ry);
        ring.push(push(q, color, w));
      }
      ringIdx.push(ring);
    }
    for (let r = 0; r < rings; r++) for (let k = 0; k < seg; k++) {
      const a = ringIdx[r][k], b = ringIdx[r][(k + 1) % seg], c = ringIdx[r + 1][k], d = ringIdx[r + 1][(k + 1) % seg];
      idx.push(a, c, b, b, c, d);
    }
    const cap = (ring, u, flip) => {
      const p = curve.getPointAt(u), c = push(p, color, weight(u));
      for (let k = 0; k < seg; k++) { const a = ring[k], b = ring[(k + 1) % seg]; if (flip) idx.push(c, a, b); else idx.push(c, b, a); }
    };
    if (capStart) cap(ringIdx[0], 0, false);
    if (capEnd) cap(ringIdx[rings], 1, true);
  }
  const lerpW = (pairs, u) => { // [[u0, bone], [u1, bone]...] piecewise linear blend
    for (let i = 0; i < pairs.length - 1; i++) {
      const [u0, b0] = pairs[i], [u1, b1] = pairs[i + 1];
      if (u <= u1) { const t = (u - u0) / (u1 - u0 || 1); return b0 === b1 ? { [b0]: 1 } : { [b0]: 1 - t, [b1]: t }; }
    }
    return { [pairs[pairs.length - 1][1]]: 1 };
  };
  const C = { body: [0.1, 0.07, 0.2], wing: [0.24, 0.06, 0.17], beak: [0.66, 0.58, 0.44], crest: [0.62, 0.13, 0.06], eye: [0.015, 0.015, 0.02], claw: [0.08, 0.07, 0.07] };
  // body + tail
  tube([[0, 0.0, -0.78, 0.0, 0.0], [0, 0.0, -0.5, 0.06, 0.06], [0, 0.0, -0.3, 0.13, 0.13], [0, 0.0, 0.0, 0.18, 0.19], [0, 0.03, 0.28, 0.16, 0.17], [0, 0.06, 0.46, 0.1, 0.1]], C.body,
    (u) => lerpW([[0, 'tail'], [0.25, 'tail'], [0.42, 'root'], [0.85, 'root'], [1, 'neck']], u), { rings: 34 });
  // neck
  tube([[0, 0.04, 0.36, 0.1, 0.1], [0, 0.08, 0.6, 0.075, 0.08], [0, 0.15, 0.85, 0.07, 0.075], [0, 0.19, 0.98, 0.075, 0.085]], C.body,
    (u) => lerpW([[0, 'root'], [0.2, 'neck'], [0.85, 'neck'], [1, 'head']], u), { capStart: false, capEnd: false });
  // skull + upper beak (deep, narrow)
  tube([[0, 0.2, 0.86, 0.06, 0.07], [0, 0.21, 0.96, 0.085, 0.1], [0, 0.19, 1.12, 0.07, 0.085], [0, 0.155, 1.45, 0.04, 0.055], [0, 0.12, 1.8, 0.02, 0.03], [0, 0.1, 2.02, 0.0, 0.0]], C.beak,
    (u) => ({ head: 1 }), { rings: 34 });
  // lower jaw
  tube([[0, 0.12, 0.98, 0.055, 0.03], [0, 0.105, 1.2, 0.045, 0.028], [0, 0.085, 1.55, 0.028, 0.02], [0, 0.07, 1.92, 0.0, 0.0]], C.beak,
    (u) => (u < 0.06 ? { jaw: 0.6, head: 0.4 } : { jaw: 1 }), { rings: 24, seg: 16 });
  // crest blade sweeping back
  tube([[0, 0.25, 1.02, 0.012, 0.03], [0, 0.33, 0.86, 0.016, 0.07], [0, 0.42, 0.62, 0.014, 0.06], [0, 0.48, 0.42, 0.008, 0.03], [0, 0.5, 0.32, 0.0, 0.0]], C.crest, () => ({ head: 1 }), { rings: 26, seg: 14 });
  // eyes
  for (const s of [1, -1]) {
    const g = new THREE.SphereGeometry(0.028, 16, 12).toNonIndexed();
    const p = g.attributes.position;
    const start = pos.length / 3;
    for (let i = 0; i < p.count; i++) push(V(p.getX(i) + s * 0.072, p.getY(i) + 0.225, p.getZ(i) + 1.0), C.eye, { head: 1 });
    for (let i = 0; i < p.count; i++) idx.push(start + i);
  }
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? 1 : -1;
    const X = (x) => x * sx;
    // arm bones along the leading edge (shoulder → elbow → wrist) and the wing finger
    tube([[X(0.1), 0.06, 0.26, 0.06, 0.06], [X(0.3), 0.07, 0.24, 0.055, 0.05], [X(0.55), 0.065, 0.2, 0.045, 0.042], [X(0.78), 0.068, 0.25, 0.04, 0.036], [X(1.0), 0.07, 0.29, 0.042, 0.038]], C.body,
      (u) => lerpW([[0, 'root'], [0.12, `arm${s}`], [0.48, `arm${s}`], [0.56, `fore${s}`], [0.95, `fore${s}`], [1, `hand${s}`]], u), { capStart: false, seg: 18 });
    tube([[X(1.0), 0.07, 0.28, 0.036, 0.032], [X(1.6), 0.07, 0.16, 0.03, 0.026], [X(2.15), 0.05, 0.02, 0.024, 0.02], [X(2.75), 0.03, -0.12, 0.016, 0.013], [X(3.25), 0.0, -0.3, 0.0, 0.0]], C.body,
      (u) => lerpW([[0, `hand${s}`], [0.06, `finger1${s}`], [0.48, `finger1${s}`], [0.56, `finger2${s}`]], u), { seg: 14 });
    // three small hand claws at the wrist, pointing forward
    for (let c = 0; c < 3; c++) tube([[X(0.98 + c * 0.03), 0.06, 0.3, 0.012, 0.012], [X(1.0 + c * 0.03), 0.04 - c * 0.01, 0.4, 0.007, 0.007], [X(1.0 + c * 0.03), 0.01, 0.44, 0, 0]], C.claw, () => ({ [`hand${s}`]: 1 }), { seg: 8, rings: 6 });
    // legs trailing back, small feet
    tube([[X(0.1), -0.06, -0.28, 0.045, 0.05], [X(0.15), -0.09, -0.52, 0.03, 0.032], [X(0.17), -0.11, -0.78, 0.02, 0.02], [X(0.18), -0.12, -0.9, 0.0, 0.0]], C.body,
      (u) => lerpW([[0, 'root'], [0.1, `thigh${s}`], [0.45, `thigh${s}`], [0.6, `shin${s}`]], u), { seg: 14, capStart: false });
    // membrane: leading edge L(t) along the arm + finger, trailing edge concave toward the thigh; 2 surfaces + rim
    const lead = new THREE.CatmullRomCurve3([V(X(0.12), 0.05, 0.22), V(X(0.55), 0.055, 0.17), V(X(1.0), 0.06, 0.25), V(X(2.15), 0.04, -0.0), V(X(3.22), 0.0, -0.3)]);
    const NS = 46, NC = 12, thick = 0.014;
    const grid = [[], []];
    for (let i = 0; i <= NS; i++) {
      const t = i / NS, L = lead.getPointAt(t);
      // chord shrinks toward the tip, scalloped trailing edge, hind attachment near the thigh
      const chord = 0.62 * Math.pow(1 - t, 0.75) + 0.02 - 0.06 * Math.sin(Math.PI * t) * Math.sin(Math.PI * t * 3);
      const Tr = V(L.x * (1 - 0.15 * (1 - t)), L.y - 0.02, L.z - chord - 0.05 * Math.sin(Math.PI * t));
      // weights along the span (which bone carries this strip)
      const span = lerpW([[0, 'root'], [0.06, `arm${s}`], [0.15, `arm${s}`], [0.2, `fore${s}`], [0.27, `fore${s}`], [0.31, `finger1${s}`], [0.58, `finger1${s}`], [0.66, `finger2${s}`]], t);
      for (let side = 0; side < 2; side++) {
        const row = [];
        for (let j = 0; j <= NC; j++) {
          const c = j / NC;
          const p = L.clone().lerp(Tr, c);
          p.y += (side ? -1 : 1) * thick * (1 - c * 0.7) * (1 - t * 0.6) - 0.012 * Math.sin(Math.PI * c); // slight billow
          const w = { ...span };
          if (c > 0.6 && t < 0.25) { const k = (c - 0.6) / 0.4 * (1 - t / 0.25); for (const n of Object.keys(w)) w[n] *= 1 - k * 0.6; w[`thigh${s}`] = (w[`thigh${s}`] || 0) + k * 0.6; }
          row.push(push(p, C.wing, w));
        }
        grid[side].push(row);
      }
    }
    const flipL = sx > 0;
    for (let i = 0; i < NS; i++) for (let j = 0; j < NC; j++) {
      for (let side = 0; side < 2; side++) {
        const g = grid[side], a = g[i][j], b = g[i + 1][j], c = g[i][j + 1], d = g[i + 1][j + 1];
        const up = (side === 0) !== flipL;
        if (up) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    }
    // trailing-edge rim joins top and bottom
    for (let i = 0; i < NS; i++) {
      const a = grid[0][i][NC], b = grid[0][i + 1][NC], c = grid[1][i][NC], d = grid[1][i + 1][NC];
      if (flipL) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // skeleton
  const bones = BONES.map((b) => { const o = new THREE.Bone(); o.name = b[0]; return o; });
  bones.forEach((b, i) => {
    const p = BONES[i][1] ? B.get(BONES[i][1]) : -1;
    b.position.set(...BONES[i][2]);
    if (p >= 0) { b.position.sub(V(...BONES[p][2])); bones[p].add(b); }
  });
  const root = new THREE.Group(); root.name = 'Pterosaur';
  root.add(bones[0]);
  root.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones);
  const mat = new THREE.MeshStandardMaterial({ name: 'PteroSkin', vertexColors: true, roughness: 0.7, side: THREE.FrontSide });
  const mesh = new THREE.SkinnedMesh(g, mat); mesh.name = 'Pterosaur_LOD0';
  root.add(mesh); mesh.bind(skel);
  const log = { verts: pos.length / 3, tris: idx.length / 3, bones: bones.length };
  if (args.preview) {
    lab.clear(); lab.stage.add(root);
    const R = (n, x, y = 0, z = 0) => bones[B.get(n)].rotation.set(x, y, z);
    if (args.pose) { R('armL', 0, 0, 0.35); R('armR', 0, 0, -0.35); R('finger1L', 0, 0, -0.2); R('finger1R', 0, 0, 0.2); R('jaw', 0.4); R('neck', 0.1); }
    root.updateMatrixWorld(true);
    lab.frame({ yaw: args.yaw ?? 35, pitch: args.pitch ?? 25, dist: args.dist ?? 0.6 });
    await lab.snap(args.preview);
    return { log };
  }
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  const bytes = new Uint8Array(glb);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { log, files: { 'assets/models/pterosaur.glb': btoa(s) } };
}
