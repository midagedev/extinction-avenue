import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// js/game/dino-models.js
// Procedural low-poly "Neon Cretaceous" creature models (placeholder art) in the InstancedRig format (see rig.js).
// Every part is a merge of tiny primitives — mostly lofts (tapered n-gon tubes through a few rings) plus spikes, slabs
// and icosahedra — painted per face: darker back / lighter belly from the face normal, small per-face brightness jitter
// for the faceted toy look, and per-ring paint codes for stripes, glowing "containment tag" markings, claws and horns.
//
// CONVENTIONS (zero pose = natural standing pose, feet on y = 0; ptero: wings spread, origin at the body centre)
//   +z forward, +y up, +x the creature's LEFT. Rotations are joint Euler angles (x pitch, y yaw, z roll), order 'YXZ'.
//   +x on a jaw opens the mouth; +x on a tail segment lifts it; +x on a neck/head pitches it down;
//   +x on a thigh/leg/arm swings the foot backward (-x = step forward); +x on a shin bends the knee (foot goes back).
//   +z on wingL raises it; wingR mirrors (-z raises). Legs hang in -y, tails run along -z, necks/heads along +z.

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const DINO_IDS = ['compy', 'raptor', 'brute', 'trike', 'ankylo', 'ptero', 'trex'];

// ---- Colors (sRGB hex in, linear RGB out) ----------------------------------------------------------------------------
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const glow = (hex, k) => lin(hex).map((v) => v * k);
const ZERO = [0, 0, 0];

// ---- Triangle soup ---------------------------------------------------------------------------------------------------
// Positions + one paint tag (string) per triangle. Triangles are oriented to face away from an "inside" point.
const _ab = new V3(), _ac = new V3(), _n = new V3(), _m = new V3();
function addTri(s, a, b, c, inside, tag) {
  _ab.subVectors(b, a); _ac.subVectors(c, a); _n.crossVectors(_ab, _ac);
  _m.copy(a).add(b).add(c).divideScalar(3).sub(inside);
  if (_n.dot(_m) < 0) [b, c] = [c, b];
  s.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  s.tags.push(tag);
}
function soupGeo(s) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(s.p, 3));
  g.userData.tags = s.tags;
  return g;
}
// Strip a three.js primitive down to non-indexed positions
function raw(g) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  return g;
}
// Swap the 2nd/3rd vertex of every triangle (all attributes) — keeps faces outward after mirroring
function flip(g) {
  for (const key in g.attributes) {
    const a = g.attributes[key].array, s = g.attributes[key].itemSize;
    for (let t = 0; t < a.length; t += 3 * s) for (let k = 0; k < s; k++) {
      const tmp = a[t + s + k]; a[t + s + k] = a[t + 2 * s + k]; a[t + 2 * s + k] = tmp;
    }
  }
  return g;
}
function applyM(g, m) {
  g.applyMatrix4(m);
  if (m.determinant() < 0) flip(g);
  return g;
}
// Scale, rotate (Euler XYZ), translate
function xf(g, t = ZERO, r = ZERO, s = [1, 1, 1]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
  return applyM(g, new THREE.Matrix4().compose(new V3(...t), q, new V3(...s)));
}
// Concatenate raw (position + tags) geometries
function cat(geos) {
  const s = { p: [], tags: [] };
  for (const g of geos) {
    s.p.push(...g.attributes.position.array);
    const n = g.attributes.position.count / 3;
    for (let i = 0; i < n; i++) s.tags.push(g.userData.tags?.[i] || '');
  }
  return soupGeo(s);
}

// ---- Primitives ------------------------------------------------------------------------------------------------------
// Loft: tube through rings [x, y, z, rx, ry, code?, chev?]; a ring with rx = ry = 0 is an apex point.
// Ring frame: T along the path, X parallel-transported from +x (from -z for paths along ±x), Y = T × X (≈ +y for
// horizontal tubes, ≈ +z for legs). chev shifts ring vertices along T by chev·sin(angle) (top forward → chevrons).
// code paints the segment starting at that ring. o: { n sides, rot, cap0, cap1, marks: [[t, w, code, chev]] } where
// marks insert thin painted bands at path fraction t of width w (fraction).
function loft(rings, o = {}) {
  const n = o.n ?? 6, rot = o.rot ?? 0;
  if (o.marks) rings = withMarks(rings, o.marks);
  const L = rings.length;
  const C = rings.map((r) => new V3(r[0], r[1], r[2]));
  const T = new V3(), X = new V3(), Y = new V3();
  const R = [];
  for (let i = 0; i < L; i++) {
    T.subVectors(C[Math.min(i + 1, L - 1)], C[Math.max(i - 1, 0)]).normalize();
    if (i === 0) X.set(1, 0, 0);
    if (i === 0 && Math.abs(T.x) > 0.8) X.set(0, 0, -Math.sign(T.x));
    X.addScaledVector(T, -X.dot(T)).normalize();
    Y.crossVectors(T, X);
    const r = rings[i];
    if (!r[3] && !r[4]) { R.push(null); continue; }
    const ring = [];
    for (let k = 0; k < n; k++) {
      const a = rot + (TAU * k) / n, s = Math.sin(a);
      ring.push(C[i].clone().addScaledVector(X, Math.cos(a) * r[3]).addScaledVector(Y, s * r[4]).addScaledVector(T, (r[6] || 0) * s));
    }
    R.push(ring);
  }
  const s = { p: [], tags: [] }, mid = new V3();
  for (let i = 0; i < L - 1; i++) {
    mid.addVectors(C[i], C[i + 1]).multiplyScalar(0.5);
    const tag = rings[i][5] || '', A = R[i], B = R[i + 1];
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      if (A && B) { addTri(s, A[k], B[k], B[k1], mid, tag); addTri(s, A[k], B[k1], A[k1], mid, tag); }
      else if (A) addTri(s, A[k], A[k1], C[i + 1], mid, tag);
      else if (B) addTri(s, C[i], B[k], B[k1], mid, tag);
    }
  }
  if (R[0] && o.cap0 !== false) for (let k = 0; k < n; k++) addTri(s, C[0], R[0][k], R[0][(k + 1) % n], C[1], rings[0][5] || '');
  if (R[L - 1] && o.cap1 !== false) for (let k = 0; k < n; k++) addTri(s, C[L - 1], R[L - 1][k], R[L - 1][(k + 1) % n], C[L - 2], rings[L - 2][5] || '');
  return soupGeo(s);
}
function withMarks(rings, marks) {
  const d = [0];
  for (let i = 1; i < rings.length; i++) d.push(d[i - 1] + Math.hypot(rings[i][0] - rings[i - 1][0], rings[i][1] - rings[i - 1][1], rings[i][2] - rings[i - 1][2]));
  const total = d[d.length - 1];
  const at = (dist, code, chev) => {
    let i = 0;
    while (i < rings.length - 2 && d[i + 1] < dist) i++;
    const f = (dist - d[i]) / (d[i + 1] - d[i] || 1), a = rings[i], b = rings[i + 1];
    const r = [0, 1, 2, 3, 4].map((k) => a[k] + (b[k] - a[k]) * f);
    r.push(code ?? (a[5] || ''), chev);
    return { d: dist, r };
  };
  const list = rings.map((r, i) => ({ d: d[i], r }));
  for (const [t, w, code, chev = 0] of marks) list.push(at(t * total, code, chev), at((t + w) * total, null, chev));
  list.sort((a, b) => a.d - b.d);
  return list.map((e) => e.r);
}
// Cone-ish spike from base to tip (n sides, base radius r, flattened by ry/r); base cap omitted (embedded)
function spike(base, tip, r, n = 4, code = '', ry = r) {
  return loft([[...base, r, ry, code], [...tip, 0, 0]], { n, cap0: false });
}
// Curved tapering horn/claw/toe through points [[x,y,z,r]...] ending in an apex
function horn(pts, n = 5, code = '') {
  return loft(pts.map((p, i) => (i === pts.length - 1 ? [p[0], p[1], p[2], 0, 0] : [p[0], p[1], p[2], p[3], p[3], code])), { n, cap0: false });
}
// Low raised diamond lying on a surface (point p, normal nrm): cheap glowing spot / armor bump
function stud(p, nrm, r, h, n = 4, code = '') {
  const N = new V3(...nrm).normalize(), P = new V3(...p);
  const b = P.clone().addScaledVector(N, -h * 0.25), t = P.clone().addScaledVector(N, h);
  return spike(b.toArray(), t.toArray(), r, n, code);
}
const ico = (r, detail = 0) => raw(new THREE.IcosahedronGeometry(r, detail));
const octa = (r) => raw(new THREE.OctahedronGeometry(r, 0));
const box = (w, h, d) => raw(new THREE.BoxGeometry(w, h, d));
// Extruded flat polygon: pts are 2D (u, v); plane 'xy' (depth along z), 'yz' (u → z, v → y, depth along x) or
// 'xz' (u → x, v → z, depth along y). Centred on the plane.
function slab(pts, depth, plane = 'xy') {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = raw(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 }));
  g.translate(0, 0, -depth / 2);
  const m = new THREE.Matrix4();
  if (plane === 'yz') m.set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  else if (plane === 'xz') m.set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  return applyM(g, m);
}
// Interpolated ellipse ring of a z-monotonic loft at depth z → surface point/normal at angle a (rad, 0 = +x side)
function surf(rings, z, a, lift = 0) {
  let i = 0;
  while (i < rings.length - 2 && rings[i + 1][2] < z) i++;
  const A = rings[i], B = rings[i + 1], f = THREE.MathUtils.clamp((z - A[2]) / (B[2] - A[2]), 0, 1);
  const y = A[1] + (B[1] - A[1]) * f, rx = A[3] + (B[3] - A[3]) * f, ry = A[4] + (B[4] - A[4]) * f;
  const c = Math.cos(a), s = Math.sin(a);
  const nrm = new V3(c / Math.max(rx, 1e-3), s / Math.max(ry, 1e-3), 0).normalize();
  return { p: [c * rx + nrm.x * lift, y + s * ry + nrm.y * lift, z], n: nrm.toArray() };
}

// ---- Painting --------------------------------------------------------------------------------------------------------
// spec: 'skin' (palette shading) or a palette key ('claw', 'horn', 'glow', 'eye', ...) or { c, e }.
// Tag codes (per loft segment): g glow on top faces, s dark stripe (upper/side faces), f glow on flank faces,
// o glow on outer (+x) faces, c glow all round, k claw, w horn/bone, b beak, a armor, d dark back color,
// m mouth color on top faces (inside of a jaw), M mouth color on bottom faces (palate).
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
const glowBase = (e) => { const m = Math.max(...e, 1e-3); return e.map((v) => 0.35 + 0.65 * v / m); };

function paint(g, spec, pal) {
  const pos = g.attributes.position.array, count = pos.length / 9, tags = g.userData.tags;
  const col = new Float32Array(pos.length), emi = new Float32Array(pos.length);
  if (typeof spec === 'string' && spec !== 'skin') {
    spec = spec === 'glow' ? { c: glowBase(pal.glow), e: pal.glow }
      : spec === 'eye' ? { c: glowBase(pal.eye || pal.glow), e: pal.eye || pal.glow }
      : { c: pal[spec] };
  }
  const a = new V3(), b = new V3(), c = new V3(), n = new V3();
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    a.fromArray(pos, o); b.fromArray(pos, o + 3); c.fromArray(pos, o + 6);
    n.subVectors(c, b).cross(_ab.subVectors(a, b)).normalize().negate();
    const mx = (a.x + b.x + c.x) / 3, my = (a.y + b.y + c.y) / 3, mz = (a.z + b.z + c.z) / 3;
    const h = hash(mx, my, mz);
    let C, E = ZERO;
    if (spec === 'skin' || spec.skin) {
      const P = spec.skin || pal;
      C = n.y >= 0 ? mixc(P.base, P.back, smooth(0.05, 0.85, n.y)) : mixc(P.base, P.belly, smooth(0.0, 0.6, -n.y));
      if (P.mottle && n.y > 0.15 && h > 0.6) C = mixc(C, P.mottle, 0.75);
    } else { C = spec.c; E = spec.e || ZERO; }
    for (const ch of (tags?.[t] || '')) {
      if (ch === 'g' && n.y > 0.45) { E = pal.glow; C = glowBase(E); }
      else if (ch === 'f' && Math.abs(n.y) < 0.6) { E = pal.glow; C = glowBase(E); }
      else if (ch === 'o' && n.x > 0.45) { E = pal.glow; C = glowBase(E); }
      else if (ch === 'c') { E = pal.glow; C = glowBase(E); }
      else if (ch === 's' && n.y > -0.35) C = pal.stripe;
      else if (ch === 'k') C = pal.claw;
      else if (ch === 'w') C = pal.horn;
      else if (ch === 'b') C = pal.beak;
      else if (ch === 'a') C = pal.armor;
      else if (ch === 'd') C = pal.back;
      else if (ch === 'm' && n.y > 0.3) C = pal.mouth;
      else if (ch === 'M' && n.y < -0.3) C = pal.mouth;
    }
    const j = E === ZERO ? 0.9 + 0.2 * h : 1;
    for (let v = 0; v < 3; v++) {
      col[o + v * 3] = C[0] * j; col[o + v * 3 + 1] = C[1] * j; col[o + v * 3 + 2] = C[2] * j;
      emi[o + v * 3] = E[0]; emi[o + v * 3 + 1] = E[1]; emi[o + v * 3 + 2] = E[2];
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('emissive', new THREE.BufferAttribute(emi, 3));
  return out;
}

// ---- Parts & models --------------------------------------------------------------------------------------------------
class Part {
  constructor(name, parent, pivot, pal) { Object.assign(this, { name, parent, pivot, pal, geos: [] }); }
  add(g, spec = 'skin') { this.geos.push(paint(g, spec, this.pal)); return this; }
  build() {
    if (!this.geometry) { this.geometry = mergeGeometries(this.geos); this.geometry.computeVertexNormals(); }
    return this.geometry;
  }
  // Right-side twin of a left part: mirrored geometry and pivot, parent name with L → R
  mirror(name, parent = this.parent && this.parent.replace(/L$/, 'R')) {
    const g = flip(this.build().clone());
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) p[i] = -p[i];
    g.computeVertexNormals();
    const m = new Part(name, parent, [-this.pivot[0], this.pivot[1], this.pivot[2]], this.pal);
    m.geometry = g;
    return m;
  }
}

function finish(id, parts, radius, sockets, scale = 1) {
  const out = parts.map((p) => ({ name: p.name, parent: p.parent, pivot: p.pivot.map((v) => v * scale), geometry: p.build() }));
  if (scale !== 1) for (const p of out) p.geometry.scale(scale, scale, scale);
  const origin = {}, box3 = new THREE.Box3();
  let tris = 0;
  for (const p of out) {
    const o = new V3(...p.pivot).add(origin[p.parent] || new V3());
    origin[p.name] = o;
    p.geometry.computeBoundingBox();
    box3.union(p.geometry.boundingBox.clone().translate(o));
    tris += p.geometry.attributes.position.count / 3;
  }
  for (const k in sockets) sockets[k].pos = sockets[k].pos.map((v) => v * scale);
  return {
    id, parts: out, sockets, radius: radius * scale, triangles: tris,
    length: +(box3.max.z - box3.min.z).toFixed(2),
    height: +(box3.max.y - Math.min(0, box3.min.y)).toFixed(2),
    width: +(box3.max.x - box3.min.x).toFixed(2)
  };
}

// ---- Palettes --------------------------------------------------------------------------------------------------------
const PAL = {
  compy: { back: lin(0x3f5a17), base: lin(0x86ad2c), belly: lin(0xe4e9b4), mouth: lin(0x7a2f2a), claw: lin(0x2a2618), glow: glow(0xc8ff3a, 4.5) },
  raptor: {
    back: lin(0x8a3a14), base: lin(0xd0682a), belly: lin(0xf2dfb6), stripe: lin(0x3e1e0e), feather: lin(0x5a2814),
    featherTip: lin(0xe8b070), mouth: lin(0x6a1e1e), claw: lin(0x1e1a18), tooth: lin(0xf4ecd8), glow: glow(0x28e0ff, 5)
  },
  brute: {
    back: lin(0x23282f), base: lin(0x56677c), belly: lin(0xa9b4c2), stripe: lin(0x1b1f25), feather: lin(0x2c3440),
    featherTip: lin(0x8fa3b8), mouth: lin(0x5a1c22), claw: lin(0x141416), tooth: lin(0xeee6d2), glow: glow(0x14ffc0, 4.5)
  },
  trike: {
    back: lin(0x45461c), base: lin(0x8e8946), belly: lin(0xd2c99c), stripe: lin(0x3a3a18), horn: lin(0xf2ecd8),
    beak: lin(0x2a2520), claw: lin(0xe8e0c8), frill: lin(0x6e5a24), frillIn: lin(0x9a3a14), glow: glow(0xff6a10, 5.5)
  },
  ankylo: {
    back: lin(0x8b6a3e), base: lin(0xc9a270), belly: lin(0xe8d4a8), armor: lin(0x4a3524), armorLight: lin(0x6e5236),
    beak: lin(0x2e2620), claw: lin(0x3a2c20), horn: lin(0xe6dcc0), glow: glow(0xffa018, 5)
  },
  ptero: {
    back: lin(0x2c1a5c), base: lin(0x5c3ea0), belly: lin(0xd8caf2), beak: lin(0xd8c8a0), claw: lin(0x1a1420),
    crest: lin(0x3a1f70), glow: glow(0xff1ad0, 5.5)
  },
  trex: {
    back: lin(0x1a2419), base: lin(0x33452d), belly: lin(0xa38a50), mottle: lin(0x0e140e), stripe: lin(0x141c13),
    mouth: lin(0x5a1a1a), claw: lin(0x1a1612), tooth: lin(0xf0e6cc), armor: lin(0x3c4048), armorLight: lin(0x5c626c),
    glow: glow(0xff5a0a, 5.5), eye: glow(0xff7a10, 8)
  }
};

// ---- Compy (≤ 300 tris) ----------------------------------------------------------------------------------------------
function compy() {
  const pal = PAL.compy, P = (n, par, pv) => new Part(n, par, pv, pal);
  const bodyRings = [[0, 0.02, -0.13, 0.05, 0.058], [0, 0.01, 0.0, 0.07, 0.08], [0, 0.0, 0.12, 0.062, 0.075], [0, 0.05, 0.22, 0.038, 0.045]];
  const body = P('body', null, [0, 0.4, 0]).add(loft(bodyRings, { n: 5, rot: Math.PI / 2 }));
  for (const z of [-0.06, 0.04, 0.13]) { const s = surf(bodyRings, z, Math.PI / 2, -0.004); body.add(stud(s.p, s.n, 0.026, 0.012, 4), 'glow'); }
  for (const x of [0.045, -0.045]) body.add(horn([[x, -0.02, 0.15, 0.014], [x * 1.15, -0.07, 0.17, 0.008], [x * 1.15, -0.08, 0.21]], 3));
  const neck = P('neck', 'body', [0, 0.04, 0.2]).add(loft([[0, 0, -0.02, 0.04, 0.045], [0, 0.08, 0.06, 0.03, 0.033], [0, 0.14, 0.1, 0.027, 0.03]], { n: 5, rot: Math.PI / 2, cap0: false, cap1: false }));
  const head = P('head', 'neck', [0, 0.14, 0.1])
    .add(loft([[0, 0.02, -0.035, 0.034, 0.034], [0, 0.022, 0.025, 0.04, 0.038, 'M'], [0, 0.0, 0.1, 0.024, 0.022, 'M'], [0, -0.008, 0.155, 0.012, 0.013]], { n: 4, rot: Math.PI / 4 }));
  for (const x of [0.03, -0.03]) head.add(xf(octa(0.014), [x, 0.035, 0.03]), 'glow');
  const jaw = P('jaw', 'head', [0, -0.012, -0.01]).add(loft([[0, -0.006, -0.01, 0.028, 0.012, 'm'], [0, -0.01, 0.08, 0.019, 0.01, 'm'], [0, -0.008, 0.15, 0, 0]], { n: 4, rot: Math.PI / 4 }));
  const tail1Rings = [[0, 0, 0.02, 0.05, 0.058], [0, 0.012, -0.2, 0.035, 0.04], [0, 0.016, -0.36, 0.025, 0.028]];
  const tail1 = P('tail1', 'body', [0, 0.02, -0.13]).add(loft(tail1Rings, { n: 5, rot: Math.PI / 2, cap0: false, cap1: false }));
  for (const z of [-0.08, -0.22]) { const s = surf([...tail1Rings].reverse(), z, Math.PI / 2, -0.003); tail1.add(stud(s.p, s.n, 0.02, 0.01, 4), 'glow'); }
  const tail2 = P('tail2', 'tail1', [0, 0.016, -0.36]).add(loft([[0, 0, 0.01, 0.025, 0.028], [0, -0.008, -0.2, 0.014, 0.016], [0, -0.02, -0.42, 0, 0]], { n: 4, rot: Math.PI / 4, cap0: false }));
  const legL = P('legL', 'body', [0.05, -0.02, 0.0])
    .add(loft([[0, 0.035, -0.01, 0.034, 0.05], [0, -0.13, 0.05, 0.03, 0.036], [0, -0.25, -0.04, 0.012, 0.014], [0, -0.355, -0.012, 0.011, 0.012, 'k'], [0, -0.372, 0.05, 0.014, 0.008, 'k'], [0, -0.378, 0.095, 0, 0]], { n: 4 }));
  return finish('compy', [body, neck, head, jaw, tail1, tail2, legL, legL.mirror('legR', 'body')], 0.3,
    { mouth: { part: 'head', pos: [0, -0.012, 0.18] } });
}

// ---- Raptor / Brute (shared build; brute = heavier, more feathers, shorter tail, scaled up) -------------------------
function raptorLike(id, pal, h, ts, scale, radius) {
  const P = (n, par, pv) => new Part(n, par, pv, pal);
  const hj = 1 + h * 0.28, bw = 1 + h * 0.18;
  const R2 = Math.PI / 2;
  const body = P('body', null, [0, 1.0, 0]).add(loft([
    [0, 0.05, -0.44, 0.15 * bw, 0.17 * bw],
    [0, 0.04, -0.12, 0.22 * bw, 0.25 * bw],
    [0, -0.01, 0.3, 0.25 * bw, 0.31 * bw],
    [0, 0.06, 0.66, 0.2 * bw, 0.25 * bw],
    [0, 0.15, 0.88, 0.13 * bw, 0.15 * bw]
  ], { n: 6, rot: R2, marks: [[0.1, 0.05, 'g', 0.06], [0.2, 0.07, 's', 0.08], [0.33, 0.05, 'g', 0.06], [0.43, 0.07, 's', 0.08], [0.56, 0.05, 'g', 0.06], [0.67, 0.07, 's', 0.08], [0.8, 0.05, 'g', 0.06]] }));
  // Brute: feather ridge along the back
  if (h) for (let i = 0; i < 4; i++) { const z = 0.55 - i * 0.26; body.add(spike([0, 0.25 * bw + 0.02 - i * 0.012, z], [0, 0.37 * bw - i * 0.03, z - 0.3], 0.05, 4, '', 0.015), 'feather'); }

  const nw = 1 + h * 0.25;
  const neck = P('neck', 'body', [0, 0.15, 0.84]).add(loft([
    [0, -0.02, -0.08, 0.13 * nw, 0.15 * nw], [0, 0.12, 0.1, 0.105 * nw, 0.12 * nw], [0, 0.3, 0.2, 0.09 * nw, 0.1 * nw], [0, 0.42, 0.28, 0.085 * nw, 0.095 * nw]
  ], { n: 6, rot: R2, marks: [[0.3, 0.12, 's', 0.03], [0.65, 0.12, 's', 0.03]] }));
  // Neck ruff feathers (mane on the brute)
  for (let i = 0; i < (h ? 4 : 2); i++) {
    const t = 0.25 + i * 0.22, y = 0.06 + t * 0.36, z = -0.02 + t * 0.3;
    neck.add(spike([0, y + 0.1 * nw, z], [0, y + 0.1 * nw + 0.08, z - 0.22 - h * 0.06], 0.045 * nw, 4, '', 0.014), 'feather');
  }

  const head = P('head', 'neck', [0, 0.42, 0.27]).add(loft([
    [0, 0.04, -0.1, 0.09 * hj, 0.09 * hj],
    [0, 0.05, 0.03, 0.12 * hj, 0.12 * hj, 'M'],
    [0, 0.02, 0.18, 0.095 * hj, 0.095 * hj, 'M'],
    [0, -0.01, 0.34, 0.07 * hj, 0.072 * hj, 'M'],
    [0, -0.03, 0.47, 0.045 * hj, 0.05 * hj]
  ], { n: 6 }));
  for (const sx of [1, -1]) {
    head.add(xf(ico(0.034 * hj), [sx * 0.094 * hj, 0.09 * hj, 0.05]), 'eye');
    head.add(xf(box(0.07 * hj, 0.03, 0.14), [sx * 0.08 * hj, 0.135 * hj, 0.06], [0.15, 0, sx * -0.45]), { c: pal.back });
    for (let i = 0; i < 4; i++) { const z = 0.13 + i * 0.09, x = sx * (0.045 - i * 0.006) * hj, y = (-0.065 - i * 0.003) * hj; head.add(spike([x, y + 0.01, z], [x, y - 0.035 * hj, z + 0.01], 0.012 * hj, 3), { c: pal.tooth }); }
  }
  // Swept-back feather crest
  for (let i = 0; i < (h ? 5 : 3); i++) {
    const x = (i - (h ? 2 : 1)) * 0.035;
    head.add(spike([x, 0.12 * hj, 0.02], [x * 2.2, 0.21 * hj + (h ? 0.03 : 0) - Math.abs(x) * 0.8, -0.27 - h * 0.08], 0.035, 4, '', 0.012), i % 2 ? 'feather' : { c: pal.featherTip });
  }

  const jaw = P('jaw', 'head', [0, -0.05, -0.02]).add(loft([
    [0, -0.015, -0.03, 0.085 * hj, 0.042 * hj, 'm'], [0, -0.035, 0.18, 0.07 * hj, 0.042 * hj, 'm'], [0, -0.03, 0.47, 0.035 * hj, 0.025 * hj]
  ], { n: 6 }));
  for (const sx of [1, -1]) for (let i = 0; i < 3; i++) { const z = 0.17 + i * 0.1, x = sx * (0.035 - i * 0.006) * hj; jaw.add(spike([x, -0.01, z], [x, 0.028 * hj, z - 0.008], 0.01 * hj, 3), { c: pal.tooth }); }

  const tail1 = P('tail1', 'body', [0, 0.05, -0.42]).add(loft([
    [0, 0, 0.1, 0.15 * bw, 0.17 * bw], [0, 0.03, -0.45 * ts, 0.115 * bw, 0.125 * bw], [0, 0.04, -0.88 * ts, 0.08 * bw, 0.085 * bw]
  ], { n: 6, rot: R2, marks: [[0.12, 0.08, 's', 0.06], [0.3, 0.06, 'g', 0.06], [0.48, 0.08, 's', 0.06], [0.66, 0.06, 'g', 0.06], [0.84, 0.08, 's', 0.05]] }));
  const tail2 = P('tail2', 'tail1', [0, 0.04, -0.88 * ts]).add(loft([
    [0, 0, 0.05, 0.08 * bw, 0.085 * bw], [0, -0.01, -0.42 * ts, 0.05 * bw, 0.052 * bw], [0, -0.03, -0.84 * ts, 0, 0]
  ], { n: 6, rot: R2, cap0: false, marks: [[0.1, 0.08, 's', 0.04], [0.3, 0.06, 'g', 0.04], [0.5, 0.08, 's', 0.03]] }));
  // Tail-tip feather fan
  for (const sx of [1, -1]) for (let i = 0; i < 3; i++) {
    const z = (-0.36 - i * 0.14) * ts;
    tail2.add(spike([sx * 0.025, 0, z], [sx * (0.16 + h * 0.04 - i * 0.03), -0.01, z - 0.28], 0.04, 4, '', 0.01), i === 1 ? { c: pal.featherTip } : 'feather');
  }

  const thighL = P('thighL', 'body', [0.17 * bw, -0.05, 0.02]).add(loft([
    [0, 0.08, -0.04, 0.1 * bw, 0.15 * bw], [0, -0.14, 0.04, 0.11 * bw, 0.16 * bw], [0, -0.34, 0.12, 0.07 * bw, 0.09 * bw], [0, -0.43, 0.15, 0.052 * bw, 0.06 * bw]
  ], { n: 6, marks: [[0.3, 0.12, 's', 0.05], [0.6, 0.1, 's', 0.04]] }));
  const shinL = P('shinL', 'thighL', [0, -0.43, 0.15]).add(loft([
    [0, 0.04, 0, 0.058 * bw, 0.068 * bw], [0, -0.18, -0.07, 0.052 * bw, 0.06 * bw], [0, -0.33, -0.13, 0.038 * bw, 0.044 * bw], [0, -0.47, -0.07, 0.034 * bw, 0.04 * bw], [0, -0.495, -0.03, 0.03 * bw, 0.034 * bw]
  ], { n: 5 }));
  for (const x of [0.03, 0.0]) shinL.add(loft([[x, -0.485, -0.05, 0.03, 0.026], [x + 0.008, -0.493, 0.08, 0.025, 0.02], [x + 0.01, -0.5, 0.12, 0.018, 0.015, 'k'], [x + 0.01, -0.52, 0.19, 0, 0]], { n: 4, cap0: false }));
  // Sickle claw with glowing tip
  shinL.add(loft([[-0.03, -0.47, -0.03, 0.025, 0.028, 'k'], [-0.036, -0.4, 0.04, 0.02, 0.022, 'kc'], [-0.038, -0.415, 0.13, 0, 0]], { n: 4, cap0: false }));

  const armL = P('armL', 'body', [0.17 * bw, -0.02, 0.6]).add(loft([
    [0, 0.05, 0, 0.06, 0.07], [0.02, -0.16, -0.05, 0.045, 0.05], [0.03, -0.24, 0.13, 0.034, 0.04]
  ], { n: 5 }));
  for (const x of [0.012, 0.048]) armL.add(horn([[x, -0.24, 0.13, 0.022], [x, -0.29, 0.21, 0.014], [x, -0.36, 0.22]], 4), 'claw');
  // Forearm feathers hanging behind the arm
  armL.add(slab([[-0.04, -0.15], [0.13, -0.23], [0.05, -0.33 - h * 0.05], [-0.07, -0.3 - h * 0.04], [-0.1, -0.2]], 0.014, 'yz').translate(0.04, 0, 0), 'feather');

  const s = (p) => p;
  return finish(id, [body, neck, head, jaw, tail1, tail2, thighL, shinL, thighL.mirror('thighR'), shinL.mirror('shinR'), armL, armL.mirror('armR')],
    radius, { mouth: { part: 'head', pos: s([0, -0.06, 0.56 * (1 + h * 0.05)]) } }, scale);
}
const raptor = () => raptorLike('raptor', PAL.raptor, 0, 1, 1, 0.55);
const brute = () => raptorLike('brute', PAL.brute, 1, 0.82, 1.75, 0.6);

// ---- Trike (≤ 1400 tris) ---------------------------------------------------------------------------------------------
function trike() {
  const pal = PAL.trike, P = (n, par, pv) => new Part(n, par, pv, pal);
  const bodyRings = [[0, 0.05, -2.2, 0.42, 0.45], [0, 0.2, -1.6, 0.85, 0.85], [0, 0.2, -0.5, 1.05, 1.0], [0, 0.05, 0.6, 1.0, 0.95], [0, -0.05, 1.45, 0.8, 0.8], [0, -0.1, 1.95, 0.55, 0.6]];
  const body = P('body', null, [0, 1.9, 0]).add(loft(bodyRings, { n: 8, rot: Math.PI / 8,
    marks: [[0.14, 0.04, 's', 0.25], [0.26, 0.04, 's', 0.25], [0.38, 0.04, 's', 0.25], [0.5, 0.04, 's', 0.25], [0.62, 0.04, 's', 0.25], [0.74, 0.04, 's', 0.2]] }));
  // Low dorsal ridge of knobs with a few glowing tag lights
  for (let i = 0; i < 6; i++) { const z = -1.5 + i * 0.6, s = surf(bodyRings, z, Math.PI / 2, -0.02); body.add(stud(s.p, s.n, 0.13, 0.1, 4), i % 2 ? 'glow' : { c: pal.back }); }

  const head = P('head', 'body', [0, -0.15, 1.85]).add(loft([
    [0, 0.25, -0.3, 0.5, 0.45], [0, 0.2, 0.3, 0.45, 0.45], [0, 0.02, 0.85, 0.3, 0.33], [0, -0.15, 1.3, 0.19, 0.24, 'b'], [0, -0.32, 1.58, 0.06, 0.1]
  ], { n: 6 }));
  for (const sx of [1, -1]) {
    head.add(xf(ico(0.09), [sx * 0.37, 0.4, 0.42]), 'eye');
    head.add(xf(box(0.22, 0.08, 0.3), [sx * 0.33, 0.52, 0.44], [0, 0, sx * -0.35]), { c: pal.back });
    head.add(horn([[sx * 0.27, 0.55, 0.4, 0.13], [sx * 0.36, 0.95, 0.8, 0.085], [sx * 0.42, 1.12, 1.25, 0.04], [sx * 0.42, 1.1, 1.55]], 6), 'horn');
    // cheek horn
    head.add(spike([sx * 0.4, -0.05, 0.1], [sx * 0.68, -0.25, 0.05], 0.1, 4), 'horn');
  }
  head.add(horn([[0, 0.15, 1.05, 0.1], [0, 0.4, 1.2, 0.05], [0, 0.5, 1.35]], 5), 'horn');
  // Frill: scalloped plate tilted back, darker inner panel, glowing orange edge knobs
  const fr = [], inner = [], knobs = [];
  const NF = 17;
  for (let i = 0; i < NF; i++) {
    const a = -0.35 + (Math.PI + 0.7) * i / (NF - 1), r = i % 2 ? 0.88 : 1.0;
    fr.push([Math.cos(a) * 1.2 * r, Math.sin(a) * 1.0 * r + 0.1]);
    inner.push([Math.cos(a) * 0.82, Math.sin(a) * 0.66 + 0.12]);
    if (i % 2 === 0) knobs.push(spike([Math.cos(a) * 1.12, Math.sin(a) * 0.93 + 0.1, 0], [Math.cos(a) * 1.32, Math.sin(a) * 1.1 + 0.1, 0], 0.09, 4, '', 0.07));
  }
  fr.push([0.5, -0.45], [-0.5, -0.45]);
  const frillM = (g) => xf(g, [0, 0.45, -0.25], [-0.6, 0, 0]);
  head.add(frillM(slab(fr, 0.12)), { c: pal.frill });
  head.add(frillM(slab(inner, 0.16)), { c: pal.frillIn });
  head.add(frillM(cat(knobs)), 'glow');

  const tail = P('tail', 'body', [0, 0.05, -2.1]).add(loft([
    [0, 0, 0.1, 0.42, 0.45], [0, -0.2, -0.8, 0.26, 0.28], [0, -0.45, -1.7, 0.11, 0.11], [0, -0.55, -2.3, 0, 0]
  ], { n: 6, rot: Math.PI / 2, cap0: false, marks: [[0.12, 0.05, 's', 0.15], [0.32, 0.05, 's', 0.12], [0.52, 0.05, 's', 0.1]] }));

  const legBL = P('legBL', 'body', [0.7, -0.1, -1.3]).add(loft([
    [0, 0.35, 0, 0.32, 0.55], [0, -0.35, -0.05, 0.3, 0.42], [0, -0.95, 0.1, 0.2, 0.24], [0, -1.45, 0.0, 0.16, 0.18], [0, -1.65, 0.05, 0.22, 0.25], [0, -1.8, 0.1, 0.25, 0.28]
  ], { n: 6, cap0: false }));
  const legFL = P('legFL', 'body', [0.78, -0.3, 1.25]).add(loft([
    [0, 0.3, 0, 0.26, 0.4], [0.12, -0.45, -0.1, 0.22, 0.28], [0.1, -0.95, 0.08, 0.15, 0.17], [0.06, -1.42, 0.06, 0.17, 0.2], [0.06, -1.6, 0.1, 0.2, 0.23]
  ], { n: 6, cap0: false }));
  for (const x of [-0.12, 0, 0.12]) {
    legBL.add(spike([x, -1.72, 0.28], [x * 1.2, -1.79, 0.44], 0.07, 4), 'claw');
    legFL.add(spike([0.06 + x, -1.53, 0.25], [0.06 + x * 1.2, -1.59, 0.4], 0.06, 4), 'claw');
  }
  return finish('trike', [body, head, tail, legFL, legFL.mirror('legFR', 'body'), legBL, legBL.mirror('legBR', 'body')], 1.5,
    { mouth: { part: 'head', pos: [0, -0.3, 1.75] }, horn: { part: 'head', pos: [0, 1.1, 1.5] } });
}

// ---- Ankylo (≤ 1400 tris) --------------------------------------------------------------------------------------------
function ankylo() {
  const pal = PAL.ankylo, P = (n, par, pv) => new Part(n, par, pv, pal);
  const bodyRings = [[0, 0.0, -1.9, 0.45, 0.3], [0, 0.12, -1.35, 0.95, 0.55], [0, 0.18, -0.3, 1.2, 0.68], [0, 0.12, 0.8, 1.1, 0.62], [0, 0.02, 1.5, 0.78, 0.48], [0, -0.02, 1.85, 0.45, 0.32]];
  const body = P('body', null, [0, 1.1, 0]).add(loft(bodyRings, { n: 8, rot: Math.PI / 8 }));
  // Osteoderm rows (dark armor pyramids), amber glow spots between them, lateral spikes along the flank edge
  const rows = [-1.3, -0.8, -0.3, 0.2, 0.7, 1.2];
  rows.forEach((z, ri) => {
    const angles = ri % 2 ? [Math.PI / 2, 1.05, Math.PI - 1.05, 0.55, Math.PI - 0.55] : [1.3, Math.PI - 1.3, 0.8, Math.PI - 0.8, 0.3, Math.PI - 0.3];
    for (const a of angles) { const s = surf(bodyRings, z, a, -0.03); body.add(stud(s.p, s.n, 0.17, 0.16, 4), { c: a > 1.2 && a < 1.9 ? pal.armorLight : pal.armor }); }
    if (ri < rows.length - 1) for (const a of [Math.PI / 2 + 0.28, Math.PI / 2 - 0.28]) { const s = surf(bodyRings, z + 0.25, a, -0.015); body.add(stud(s.p, s.n, 0.09, 0.03, 4), 'glow'); }
  });
  for (const sx of [1, -1]) for (const [z, len] of [[-1.2, 0.3], [-0.6, 0.38], [0.0, 0.42], [0.6, 0.45], [1.25, 0.55]]) {
    const s = surf(bodyRings, z, sx > 0 ? 0.05 : Math.PI - 0.05, -0.05);
    body.add(spike(s.p, [s.p[0] + sx * len, s.p[1] - 0.12, z - 0.12], 0.12, 4), 'horn');
  }

  const head = P('head', 'body', [0, -0.05, 1.8]).add(loft([
    [0, 0.05, -0.15, 0.42, 0.28], [0, 0.06, 0.25, 0.44, 0.27], [0, -0.02, 0.6, 0.28, 0.2, 'b'], [0, -0.1, 0.82, 0.12, 0.1]
  ], { n: 6 }));
  for (const sx of [1, -1]) {
    head.add(xf(ico(0.065), [sx * 0.36, 0.17, 0.33]), 'eye');
    head.add(spike([sx * 0.36, 0.14, 0.0], [sx * 0.62, 0.24, -0.25], 0.1, 4), 'horn');
    head.add(spike([sx * 0.38, -0.1, 0.05], [sx * 0.6, -0.2, -0.15], 0.08, 4), 'horn');
    head.add(stud([sx * 0.18, 0.28, 0.2], [sx * 0.3, 1, 0], 0.14, 0.07, 4), 'armor');
  }
  head.add(stud([0, 0.29, 0.0], [0, 1, -0.2], 0.16, 0.08, 4), 'armor');

  const tail1 = P('tail1', 'body', [0, 0.0, -1.85]).add(loft([
    [0, 0, 0.1, 0.42, 0.28], [0, -0.05, -0.65, 0.28, 0.2], [0, -0.08, -1.2, 0.18, 0.14]
  ], { n: 6, cap0: false, marks: [[0.3, 0.07, 'g', 0], [0.65, 0.07, 'g', 0]] }));
  for (const sx of [1, -1]) for (const [z, w] of [[-0.25, 0.36], [-0.75, 0.25]]) tail1.add(spike([sx * w * 0.8, -0.03, z], [sx * (w + 0.22), -0.05, z - 0.2], 0.08, 4), 'horn');
  const tail2 = P('tail2', 'tail1', [0, -0.08, -1.2]).add(loft([
    [0, 0, 0.05, 0.18, 0.14], [0, -0.02, -0.6, 0.12, 0.1], [0, -0.03, -0.95, 0.1, 0.08]
  ], { n: 6, cap0: false, marks: [[0.4, 0.1, 'g', 0]] }));
  // Tail club: two armored lobes + glowing seam
  tail2.add(xf(ico(0.34, 0), [0, -0.03, -1.15], [0, 0.3, 0], [1.25, 0.6, 1.0]), 'armor');
  for (const sx of [1, -1]) tail2.add(xf(ico(0.24, 0), [sx * 0.25, -0.03, -1.1], [0.2, sx, 0], [1, 0.75, 1.1]), 'armorLight');
  tail2.add(loft([[0, -0.03, -0.92, 0.36, 0.17, 'c'], [0, -0.03, -0.98, 0.42, 0.19]], { n: 8, rot: Math.PI / 8 }));

  const legBL = P('legBL', 'body', [0.72, -0.25, -1.0]).add(loft([
    [0, 0.3, 0, 0.26, 0.38], [0, -0.3, 0.0, 0.23, 0.27], [0, -0.62, 0.05, 0.16, 0.18], [0, -0.78, 0.08, 0.2, 0.22], [0, -0.85, 0.1, 0.21, 0.23]
  ], { n: 6, cap0: false }));
  const legFL = P('legFL', 'body', [0.74, -0.3, 1.1]).add(loft([
    [0, 0.3, 0, 0.22, 0.32], [0.06, -0.28, -0.05, 0.19, 0.22], [0.05, -0.58, 0.05, 0.14, 0.15], [0.05, -0.73, 0.08, 0.17, 0.19], [0.05, -0.8, 0.1, 0.18, 0.2]
  ], { n: 6, cap0: false }));
  for (const x of [-0.1, 0, 0.1]) {
    legBL.add(spike([x, -0.78, 0.25], [x * 1.2, -0.84, 0.36], 0.06, 4), 'claw');
    legFL.add(spike([0.05 + x, -0.73, 0.24], [0.05 + x * 1.2, -0.79, 0.34], 0.05, 4), 'claw');
  }
  return finish('ankylo', [body, head, tail1, tail2, legFL, legFL.mirror('legFR', 'body'), legBL, legBL.mirror('legBR', 'body')], 1.5,
    { mouth: { part: 'head', pos: [0, -0.1, 0.95] } });
}

// ---- Ptero (≤ 700 tris) — origin at the body centre, wings spread flat ------------------------------------------------
function ptero() {
  const pal = PAL.ptero, P = (n, par, pv) => new Part(n, par, pv, pal);
  const body = P('body', null, [0, 0, 0]).add(loft([
    [0, 0.02, -0.6, 0, 0], [0, 0.02, -0.4, 0.1, 0.11], [0, 0.0, 0.0, 0.19, 0.2], [0, 0.05, 0.33, 0.16, 0.17], [0, 0.1, 0.5, 0.1, 0.11]
  ], { n: 6, rot: Math.PI / 2, marks: [[0.35, 0.06, 'g', 0.05], [0.55, 0.06, 'g', 0.05]] }));
  for (const sx of [1, -1]) body.add(loft([[sx * 0.1, -0.08, -0.2, 0.05, 0.05], [sx * 0.13, -0.13, -0.42, 0.03, 0.03, 'k'], [sx * 0.14, -0.16, -0.58, 0, 0]], { n: 4, cap0: false }));

  const neck = P('neck', 'body', [0, 0.1, 0.45]).add(loft([[0, 0, -0.05, 0.09, 0.1], [0, 0.08, 0.2, 0.07, 0.075], [0, 0.12, 0.38, 0.065, 0.07]], { n: 5, rot: Math.PI / 2, cap0: false }));
  const head = P('head', 'neck', [0, 0.12, 0.38]).add(loft([
    [0, 0.02, -0.08, 0.075, 0.085], [0, 0.03, 0.06, 0.085, 0.1], [0, 0.0, 0.25, 0.05, 0.06, 'b'], [0, -0.03, 0.6, 0.025, 0.03, 'b'], [0, -0.05, 0.9, 0, 0]
  ], { n: 6 }));
  for (const sx of [1, -1]) head.add(xf(octa(0.028), [sx * 0.068, 0.07, 0.05]), 'eye');
  // Original crest: swept-back scimitar blade with a short forked spur; glowing inlay line
  head.add(slab([[0.1, 0.08], [-0.05, 0.22], [-0.5, 0.44], [-0.66, 0.42], [-0.32, 0.22], [-0.4, 0.1], [-0.08, 0.06]], 0.03, 'yz'), 'crest');
  head.add(slab([[-0.02, 0.18], [-0.5, 0.39], [-0.56, 0.38], [-0.06, 0.15]], 0.045, 'yz'), 'glow');

  const R = (pts, k = 1) => pts.map(([x, z]) => [x, z * k]);
  const wingL = P('wingL', 'body', [0.14, 0.06, 0.12]).add(loft([[0, 0, 0, 0.07, 0.06], [0.75, 0.03, 0.08, 0.06, 0.05], [1.5, 0.0, 0.15, 0.045, 0.04]], { n: 4, cap0: false }), { c: pal.back });
  const trail1 = [[1.5, -0.3], [0.9, -0.55], [0.3, -0.7], [0, -0.62]];
  wingL.add(slab([[0, 0.1], [0.75, 0.12], [1.5, 0.15], ...trail1], 0.03, 'xz'));
  wingL.add(slab([...trail1, ...R(trail1.slice().reverse()).map(([x, z]) => [x, z + 0.07])], 0.045, 'xz'), 'glow');
  const wingTipL = P('wingTipL', 'wingL', [1.5, 0, 0.15]).add(loft([[0, 0, 0, 0.045, 0.04], [0.9, 0, -0.1, 0.03, 0.025], [1.75, 0, -0.5, 0, 0]], { n: 4, cap0: false }), { c: pal.back });
  const trail2 = [[1.72, -0.47], [1.0, -0.5], [0, -0.45]];
  wingTipL.add(slab([[0, 0.03], [0.9, -0.07], ...trail2], 0.03, 'xz'));
  wingTipL.add(slab([...trail2, [0, -0.38], [1.0, -0.43], [1.62, -0.42]], 0.045, 'xz'), 'glow');
  wingTipL.add(spike([0.05, 0, 0.04], [0.15, -0.03, 0.18], 0.025, 3), 'claw');

  return finish('ptero', [body, neck, head, wingL, wingTipL, wingL.mirror('wingR', 'body'), wingTipL.mirror('wingTipR', 'wingR')], 1.2,
    { mouth: { part: 'head', pos: [0, -0.05, 0.95] }, claws: { part: 'body', pos: [0, -0.18, -0.55] } });
}

// ---- T. rex hero (≤ 4000 tris) ---------------------------------------------------------------------------------------
function trex() {
  const pal = PAL.trex, P = (n, par, pv) => new Part(n, par, pv, pal);
  const N = 10, RT = Math.PI / 10;
  const bodyRings = [[0, 0.15, -1.7, 0.72, 0.76], [0, 0.12, -1.0, 0.96, 0.98], [0, -0.05, 0.0, 1.1, 1.05], [0, -0.25, 0.95, 1.08, 1.12], [0, -0.15, 1.8, 0.92, 0.98], [0, 0.18, 2.5, 0.7, 0.78]];
  const body = P('body', null, [0, 3.6, 0]).add(loft(bodyRings, { n: N, rot: RT,
    marks: [[0.2, 0.025, 'f', 0.5], [0.27, 0.02, 'f', 0.5], [0.52, 0.025, 'f', 0.45], [0.7, 0.02, 's', 0.2], [0.1, 0.03, 's', 0.2]] }));
  for (let i = 0; i < 7; i++) { const z = -1.5 + i * 0.6, s = surf(bodyRings, z, Math.PI / 2, -0.03); body.add(stud(s.p, s.n, 0.16, 0.16 - i * 0.008, 4), { c: pal.back }); }

  const armL = P('armL', 'body', [0.72, -0.62, 1.8]).add(loft([[0, 0.08, -0.05, 0.14, 0.16], [0.04, -0.35, 0.08, 0.1, 0.11], [0.04, -0.48, 0.42, 0.08, 0.08]], { n: 6 }));
  for (const x of [0.0, 0.08]) armL.add(horn([[x, -0.48, 0.42, 0.05], [x, -0.55, 0.55, 0.03], [x, -0.66, 0.56]], 4), 'claw');

  const neckRings = [[0, -0.05, -0.15, 0.7, 0.76], [0, 0.28, 0.42, 0.66, 0.7], [0, 0.56, 0.98, 0.56, 0.6]];
  const neck = P('neck', 'body', [0, 0.25, 2.45]).add(loft(neckRings, { n: N, rot: RT, marks: [[0.12, 0.05, 'f', 0.3], [0.8, 0.05, 's', 0.1]] }));
  // Armored containment collar: glowing seam band + 8 bolted plates + front lock light (weak point)
  const collar = [loft([[0, 0, -0.17, 0.74, 0.74, 'c'], [0, 0, 0.17, 0.74, 0.74]], { n: 16, cap0: false, cap1: false })];
  const plates = [], bolts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * TAU / 8, c = Math.cos(a), s = Math.sin(a);
    plates.push(xf(box(0.48, 0.12, 0.32), [c * 0.8, s * 0.8, 0], [0, 0, a - Math.PI / 2]));
    bolts.push(xf(octa(0.05), [c * 0.87, s * 0.87, 0], [0, 0, a]));
  }
  const collarM = (g) => xf(g, [0, 0.27, 0.42], [-0.45, 0, 0]);
  neck.add(collarM(collar[0]), 'skin');
  neck.add(collarM(cat(plates)), { c: pal.armor });
  neck.add(collarM(cat(bolts)), 'glow');
  neck.add(collarM(xf(box(0.3, 0.2, 0.42), [0, -0.86, 0])), { c: pal.armorLight });
  neck.add(collarM(xf(box(0.16, 0.06, 0.24), [0, -0.97, 0])), { c: glowBase(pal.eye), e: pal.eye });

  const head = P('head', 'neck', [0, 0.6, 0.95]).add(loft([
    [0, 0.1, -0.38, 0.48, 0.42], [0, 0.18, 0.05, 0.56, 0.5, 'M'], [0, 0.07, 0.55, 0.45, 0.42, 'M'], [0, -0.04, 1.05, 0.35, 0.34, 'M'], [0, -0.1, 1.45, 0.28, 0.27, 'M'], [0, -0.13, 1.64, 0.19, 0.2]
  ], { n: 8, rot: Math.PI / 8 }));
  for (const sx of [1, -1]) {
    head.add(xf(ico(0.09, 0), [sx * 0.45, 0.42, 0.12]), 'eye');
    head.add(xf(box(0.24, 0.1, 0.42), [sx * 0.38, 0.57, 0.16], [0.1, sx * 0.15, sx * -0.4]), { c: pal.back }); // brow ridge
    head.add(spike([sx * 0.33, 0.6, 0.32], [sx * 0.38, 0.78, 0.4], 0.09, 4), { c: pal.back }); // lacrimal horn
    head.add(xf(box(0.1, 0.05, 0.12), [sx * 0.16, 0.08, 1.48]), { c: pal.mottle }); // nostril
    for (let i = 0; i < 7; i++) {
      const z = 0.2 + i * 0.2, x = sx * (0.3 - i * 0.02), y = -0.33;
      head.add(spike([x, y + 0.04, z], [x, y - 0.14 + i * 0.008, z + 0.03], 0.045, 3), { c: pal.tooth });
    }
  }
  // Scar slashes across the cheek
  head.add(loft([[0, 0.05, 0.5, 0.46, 0.43, 'o', 0.3], [0, 0.05, 0.56, 0.45, 0.42]], { n: 8, rot: Math.PI / 8, cap0: false, cap1: false }));

  const jaw = P('jaw', 'head', [0, -0.28, -0.1]).add(loft([
    [0, -0.08, -0.18, 0.47, 0.24, 'm'], [0, -0.15, 0.5, 0.42, 0.25, 'm'], [0, -0.14, 1.1, 0.31, 0.17, 'm'], [0, -0.1, 1.6, 0.2, 0.11]
  ], { n: 8, rot: Math.PI / 8 }));
  for (const sx of [1, -1]) for (let i = 0; i < 5; i++) {
    const z = 0.45 + i * 0.22, x = sx * (0.24 - i * 0.025);
    jaw.add(spike([x, 0.0, z], [x, 0.13, z - 0.02], 0.04, 3), { c: pal.tooth });
  }

  const tail1 = P('tail1', 'body', [0, 0.15, -1.6]).add(loft([
    [0, 0, 0.15, 0.72, 0.76], [0, 0.05, -1.1, 0.55, 0.58], [0, 0.02, -2.2, 0.38, 0.41]
  ], { n: N, rot: RT, cap0: false, marks: [[0.15, 0.03, 'f', 0.4], [0.24, 0.025, 'f', 0.4], [0.5, 0.05, 's', 0.2], [0.7, 0.03, 'f', 0.3], [0.88, 0.05, 's', 0.2]] }));
  const tail2 = P('tail2', 'tail1', [0, 0.02, -2.2]).add(loft([
    [0, 0, 0.05, 0.38, 0.41], [0, -0.05, -1.05, 0.27, 0.29], [0, -0.1, -2.1, 0.17, 0.18]
  ], { n: N, rot: RT, cap0: false, marks: [[0.2, 0.05, 's', 0.15], [0.45, 0.035, 'f', 0.25], [0.72, 0.05, 's', 0.12]] }));
  const tail3 = P('tail3', 'tail2', [0, -0.1, -2.1]).add(loft([
    [0, 0, 0.05, 0.17, 0.18], [0, -0.04, -1.1, 0.09, 0.1], [0, -0.04, -2.2, 0, 0]
  ], { n: 8, rot: Math.PI / 8, cap0: false, marks: [[0.2, 0.05, 's', 0.1], [0.4, 0.04, 'f', 0.12]] }));
  [[tail1, -0.2, 0.68, 5, 0.38], [tail2, -0.1, 0.36, 4, 0.5], [tail3, -0.1, 0.16, 3, 0.45]].forEach(([part, z0, r, cnt, step], ti) => {
    for (let i = 0; i < cnt; i++) {
      const z = z0 - i * step, y = (ti === 0 ? 0.76 : ti === 1 ? 0.41 : 0.18) * (1 - i / (cnt + 2.5)) + (ti === 0 ? 0.03 : -0.02);
      part.add(spike([0, y - 0.03, z], [0, y + 0.13 - ti * 0.03, z - 0.15], 0.1 - ti * 0.02, 4), { c: pal.back });
    }
  });

  const thighL = P('thighL', 'body', [0.85, -0.25, 0.15]).add(loft([
    [0, 0.45, -0.15, 0.55, 0.92], [0, -0.35, 0.1, 0.6, 0.88], [0, -1.15, 0.45, 0.36, 0.45], [0, -1.5, 0.55, 0.27, 0.3]
  ], { n: N, rot: RT, marks: [[0.38, 0.03, 'o', 0.45], [0.46, 0.025, 'o', 0.45]] }));
  const shinL = P('shinL', 'thighL', [0, -1.5, 0.55]).add(loft([
    [0, 0.1, 0, 0.3, 0.34], [0, -0.6, -0.28, 0.25, 0.28], [0, -1.15, -0.5, 0.18, 0.2]
  ], { n: 8, rot: Math.PI / 8, cap0: false }));
  const footL = P('footL', 'shinL', [0, -1.2, -0.5]).add(loft([
    [0, 0.1, -0.02, 0.19, 0.2], [0, -0.32, 0.1, 0.17, 0.2], [0, -0.5, 0.2, 0.22, 0.24]
  ], { n: 8, rot: Math.PI / 8 }));
  for (const x of [-0.13, 0, 0.13]) {
    const l = x ? 0.85 : 1;
    footL.add(loft([[x, -0.5, 0.18, 0.11, 0.1], [x * 1.8, -0.55, 0.18 + 0.45 * l, 0.09, 0.08, 'k'], [x * 2.1, -0.6, 0.2 + 0.7 * l, 0.06, 0.05, 'k'], [x * 2.3, -0.65, 0.25 + 0.85 * l, 0, 0]], { n: 6, cap0: false }));
  }
  footL.add(spike([-0.12, -0.3, -0.02], [-0.16, -0.48, -0.18], 0.06, 4), 'claw'); // dewclaw

  return finish('trex', [body, neck, head, jaw, tail1, tail2, tail3, thighL, shinL, footL, thighL.mirror('thighR'), shinL.mirror('shinR'), footL.mirror('footR'), armL, armL.mirror('armR')], 3.2, {
    mouth: { part: 'head', pos: [0, -0.4, 1.85] },
    weakNeck: { part: 'neck', pos: [0, 0.27, 0.42] },
    weakThighL: { part: 'thighL', pos: [0.3, -0.6, 0.2] },
    weakThighR: { part: 'thighR', pos: [-0.3, -0.6, 0.2] },
    eyeL: { part: 'head', pos: [0.47, 0.42, 0.12] },
    eyeR: { part: 'head', pos: [-0.47, 0.42, 0.12] }
  });
}

const BUILDERS = { compy, raptor, brute, trike, ankylo, ptero, trex };

/**
 * GRIDLOCK's cracked containment collar for the rigged T. rex: a glowing seam band, 10 bolted armour plates and the
 * front lock light (the weak point), as one geometry (position / normal / color / emissive) around a neck of radius r,
 * centred at `at` with its axis along `dir` (rest pose, model space). skin-rig.js binds it rigidly to the neck bone.
 */
function buildCollar(at = [0, 3.62, 1.8], dir = [0, 0.53, 0.35], r = 0.44) {
  const pal = PAL.trex;
  const parts = [];
  const band = loft([[0, 0, -0.13 * r / 0.74, r, r, 'c'], [0, 0, 0.13 * r / 0.74, r, r]], { n: 20, cap0: false, cap1: false });
  parts.push(paint(band, 'skin', pal));
  const plates = [], bolts = [];
  const K = 10;
  for (let k = 0; k < K; k++) {
    const a = (k + 0.5) * TAU / K, c = Math.cos(a), sn = Math.sin(a);
    plates.push(xf(box(r * 0.52, r * 0.15, r * 0.4), [c * r * 1.08, sn * r * 1.08, 0], [0, 0, a - Math.PI / 2]));
    bolts.push(xf(octa(r * 0.065), [c * r * 1.18, sn * r * 1.18, 0], [0, 0, a]));
  }
  parts.push(paint(cat(plates), { c: pal.armor }, pal));
  parts.push(paint(cat(bolts), 'glow', pal));
  // the lock housing hangs under the throat (−y side of the ring) and glows hot
  parts.push(paint(xf(box(r * 0.42, r * 0.28, r * 0.55), [0, -r * 1.16, 0]), { c: pal.armorLight }, pal));
  parts.push(paint(xf(box(r * 0.22, r * 0.09, r * 0.34), [0, -r * 1.32, 0]), { c: glowBase(pal.eye), e: pal.eye }, pal));
  const g = mergeGeometries(parts);
  const d = new V3(...dir).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), d);
  g.applyMatrix4(new THREE.Matrix4().compose(new V3(...at), q, new V3(1, 1, 1)));
  g.computeVertexNormals();
  return g;
}

/** Builds a NEW rig model for a species id (see DINO_IDS) */
function buildDinoModel(id) {
  const b = BUILDERS[id];
  if (!b) throw new Error(`unknown dino model ${id}`);
  return b();
}

export { buildDinoModel, buildCollar, DINO_IDS };
