import * as THREE from 'three/webgpu';
import {
  Fn, texture, ivec2, int, attribute, vec4, vec3, dot, normalLocal, positionGeometry, normalGeometry, float, uniform,
  mix, normalize, cameraPosition, positionWorld, normalWorld, positionView, normalView, pow, max, varying, luminance,
  smoothstep, sin, cross, abs, sign, instancedDynamicBufferAttribute, mx_worley_noise_float, mx_noise_float, normalMap,
  uv
} from 'three/tsl';

// js/game/skin-rig.js
// GPU-INSTANCED SKINNING: every individual of a species is drawn by ONE instanced draw call per LOD, whatever the
// pack size. The CPU samples each individual's animation (two cross-fading clips + a hit-flinch overlay + procedural
// head-look / jaw overrides), multiplies by its root transform and writes its bone matrices (3 rows × 4 per bone) into
// one row of a float texture; the vertex shader skins with texelFetch from row `iData.x`.
//
// Shading (MeshStandardNodeMaterial, physically based): albedo texture (or baked flat colours) recoloured per species
// by a luminance ramp, rest-pose-space stripes and countershading (so packs share one texture yet read as different
// animals), per-instance tint, tangent-space normal map (or a procedural scale bump for untextured models), a cool
// rim light so silhouettes read against the city, hit flash, elite rim and the stone (fossilise) blend.
// LOD1 (decimated mesh) is used for individuals that are small on screen; individuals outside the view are skipped.

const _f = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _s = new THREE.Sphere();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();

class SkinnedCrowd {
  /**
   * @param {object} model skinned model (skin-model.js)
   * @param {number} capacity max individuals
   * @param {object} opts { look: { palette... } (see makeMaterial), attachments: [{ geometry, bone }] }
   */
  constructor(model, capacity, opts = {}) {
    this.skinned = true;
    this.model = model;
    this.capacity = capacity;
    this.nb = model.bones.names.length;
    this.partIndex = model.bones.index;
    this.aliases = { ...(model.def.skin.aliases || {}) };
    this.group = new THREE.Group();
    this.group.name = `Skin_${model.id}`;
    this.count = 0;
    const nb = this.nb;
    // bone texture: width nb × 3 texels (3 matrix rows), one row per individual
    this.texData = new Float32Array(nb * 3 * 4 * capacity);
    this.boneTex = new THREE.DataTexture(this.texData, nb * 3, capacity, THREE.RGBAFormat, THREE.FloatType);
    this.boneTex.minFilter = this.boneTex.magFilter = THREE.NearestFilter;
    this.boneTex.generateMipmaps = false;
    this.boneTex.needsUpdate = true;
    // scratch pose buffers (model space), last individual's final matrices (world) for sockets
    this.pose = new Float32Array(nb * 12);
    this.final = new Float32Array(nb * 12);
    this.tmpA = new Float32Array(12);
    // descendants per bone (for procedural subtree overrides)
    const par = model.bones.parent;
    this.subtree = Array.from({ length: nb }, (_, b) => { const out = []; for (let i = 0; i < nb; i++) { let p = i; while (p >= 0 && p !== b) p = par[p]; if (p === b) out.push(i); } return out; });
    this.lookA = this.partIndex.get(this.alias('neck')) ?? -1;
    this.lookB = this.partIndex.get(this.alias('head')) ?? -1;
    this.jawBone = this.partIndex.get(this.alias('jaw')) ?? -1;
    const look = opts.look || model.def.skin.look || {};
    this.lods = model.geometries.map((g, k) => this._makeLOD(g, look, k));
    if (opts.attachments?.length) this.attach = this._makeAttachment(opts.attachments);
    const h = model.height || 2;
    this.lodK = model.def.skin.lodK ?? 14; // LOD1 beyond lodK × body height
    this.cullR = Math.max(model.length, h) * 0.65;
    this.camPos = new THREE.Vector3();
    this.useFrustum = false;
  }

  alias(name) { return this.aliases[name] || name; }

  _instAttrs() {
    const cap = this.capacity;
    const iData = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const iTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    iData.setUsage(THREE.DynamicDrawUsage); iTint.setUsage(THREE.DynamicDrawUsage);
    return { iData, iTint };
  }

  _skinNode(iData) {
    const tex = texture(this.boneTex);
    return Fn(() => {
      const row = int(iData.x);
      const si = attribute('skinIndex', 'uvec4');
      const sw = attribute('skinWeight', 'vec4');
      const fetch = (b, k) => tex.load(ivec2(int(b).mul(3).add(k), row));
      const blend = (k) => fetch(si.x, k).mul(sw.x).add(fetch(si.y, k).mul(sw.y)).add(fetch(si.z, k).mul(sw.z)).add(fetch(si.w, k).mul(sw.w));
      const r0 = blend(0).toVar(), r1 = blend(1).toVar(), r2 = blend(2).toVar();
      const p = vec4(positionGeometry, 1);
      const n = normalGeometry;
      normalLocal.assign(vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n)));
      return vec3(dot(r0, p), dot(r1, p), dot(r2, p));
    })();
  }

  _material(iData, iTint, look, hasColor) {
    const m = this.model;
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: look.roughness ?? 0.78, metalness: 0 });
    mat.positionNode = this._skinNode(iData);
    const flash = iData.y, stone = iData.z, elite = iData.w;
    const vRest = varying(positionGeometry, 'vRest');
    const vRestN = varying(normalGeometry, 'vRestN');
    const tx = m.def.skin.textures || {};
    const U = (c) => uniform(new THREE.Color(...c));
    let base;
    if (tx.mapTex) base = texture(tx.mapTex, uv()).rgb;
    else if (hasColor) base = attribute('color', 'vec3');
    else base = vec3(0.6);
    let col = base;
    const lum = luminance(base);
    if (look.ramp) {
      // luminance ramp recolour, keeping the sculpt's baked shading; the purple mouth interior keeps its own colour
      const [dark, mid, light] = look.ramp.map(U);
      const ramp = mix(mix(dark, mid, smoothstep(0.03, 0.2, lum)), light, smoothstep(0.2, 0.55, lum));
      const detail = lum.div(max(float(look.rampRef ?? 0.18), 0.01)).pow(0.35);
      const mouth = smoothstep(0.015, 0.09, base.b.sub(base.g)).mul(smoothstep(0.08, 0.16, lum));
      col = mix(ramp.mul(detail.clamp(0.6, 1.5)), base.mul(U(look.mouth || [1.1, 0.85, 0.85])), mouth);
    }
    if (look.tint) col = col.mul(U(look.tint));
    // countershading (rest-space belly lighter) and dorsal stripes / blotches
    const scaleK = float(1 / Math.max(0.2, m.def.skin.patternScale || 1));
    const belly = smoothstep(-0.15, -0.75, vRestN.y);
    if (look.belly) col = mix(col, col.mul(U(look.belly)), belly.mul(0.75));
    if (look.stripes) {
      const [freq, amt] = look.stripes;
      const wob = mx_noise_float(vRest.mul(scaleK.mul(1.3))).mul(1.2);
      const st = smoothstep(0.35, 0.8, sin(vRest.z.mul(scaleK).mul(freq).add(vRest.y.mul(scaleK).mul(freq * 0.35)).add(wob))).mul(smoothstep(-0.05, 0.55, vRestN.y));
      col = mix(col, col.mul(U(look.stripeColor || [0.25, 0.2, 0.18])), st.mul(amt));
    }
    if (look.blotch) {
      const b = smoothstep(0.55, 0.75, mx_noise_float(vRest.mul(scaleK.mul(look.blotch[0]))).mul(0.5).add(0.5)).mul(smoothstep(-0.2, 0.4, vRestN.y));
      col = mix(col, col.mul(U(look.blotchColor || [0.4, 0.35, 0.3])), b.mul(look.blotch[1]));
    }
    const iT = iTint.xyz;
    col = col.mul(iT);
    const stoneC = vec3(0.21, 0.2, 0.185).mul(float(0.85).add(mx_noise_float(vRest.mul(scaleK.mul(6))).mul(0.25)));
    mat.colorNode = mix(col, stoneC, stone).add(vec3(flash.mul(0.12)));
    // roughness: glossier mouth/teeth (bright or purple), dry stone
    mat.roughnessNode = mix(float(look.roughness ?? 0.78).sub(smoothstep(0.4, 0.75, lum).mul(0.18)), float(0.95), stone);
    // normals: the sculpt's normal map, or a procedural scale bump (worley cells in rest space) for untextured models
    if (tx.normalTex) {
      mat.normalNode = normalMap(texture(tx.normalTex, uv()), vec3(look.normalScale ?? 1.0).xy);
    } else if (look.scales !== false) {
      const freq = look.scaleFreq ?? 9;
      const cell = mx_worley_noise_float(vRest.mul(scaleK.mul(freq)));
      const h = smoothstep(0.0, 0.55, cell).mul(look.scaleBump ?? 0.035).add(mx_noise_float(vRest.mul(scaleK.mul(2.2))).mul(0.02));
      const dpx = positionView.dFdx(), dpy = positionView.dFdy();
      const dhx = h.dFdx(), dhy = h.dFdy();
      const N = normalView;
      const r1 = cross(dpy, N), r2 = cross(N, dpx);
      const det = dot(dpx, r1);
      const grad = sign(det).mul(r1.mul(dhx).add(r2.mul(dhy)));
      mat.normalNode = normalize(abs(det).mul(N).sub(grad));
    }
    // rim light (silhouettes against the street), hit flash, elite rim
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim = pow(float(1).sub(max(dot(normalWorld, viewDir), 0)), 3.0);
    const rimC = U(look.rim || [0.1, 0.14, 0.21]).mul(rim).mul(float(1).sub(stone));
    const eliteC = U([3.2, 0.5, 2.2]).mul(elite).mul(rim.mul(2.0).add(0.1));
    mat.emissiveNode = rimC.add(vec3(1.0, 0.82, 0.68).mul(flash.mul(0.8))).add(eliteC);
    return mat;
  }

  _makeLOD(g, look, k) {
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = g.index;
    for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color']) if (g.getAttribute(name)) ig.setAttribute(name, g.getAttribute(name));
    const { iData, iTint } = this._instAttrs();
    ig.setAttribute('iData', iData);
    ig.setAttribute('iTint', iTint);
    ig.instanceCount = 0;
    ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = this._material(instancedDynamicBufferAttribute(iData, 'vec4'), instancedDynamicBufferAttribute(iTint, 'vec4'), look, !!g.getAttribute('color'));
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    mesh.name = `${this.model.id}.lod${k}`;
    mesh.castShadow = mesh.receiveShadow = false;
    this.group.add(mesh);
    return { mesh, geo: ig, iData, iTint, n: 0 };
  }

  /** Rigid extras (e.g. the T. rex collar) skinned 100 % to one bone; geometry carries color + emissive attributes */
  _makeAttachment(list) {
    const geos = [];
    for (const { geometry, bone } of list) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      const n = g.getAttribute('position').count;
      const b = this.partIndex.get(this.alias(bone)) ?? 0;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = b; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      geos.push(g);
    }
    const ig = new THREE.InstancedBufferGeometry();
    const merged = geos.length === 1 ? geos[0] : mergeSimple(geos);
    for (const name of ['position', 'normal', 'color', 'emissive', 'skinIndex', 'skinWeight']) if (merged.getAttribute(name)) ig.setAttribute(name, merged.getAttribute(name));
    const { iData, iTint } = this._instAttrs();
    ig.setAttribute('iData', iData);
    ig.setAttribute('iTint', iTint);
    ig.instanceCount = 0;
    const d = instancedDynamicBufferAttribute(iData, 'vec4');
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.75 });
    mat.positionNode = this._skinNode(d);
    mat.colorNode = mix(attribute('color', 'vec3'), vec3(0.21, 0.2, 0.185), d.z).add(vec3(d.y.mul(0.1)));
    mat.emissiveNode = attribute('emissive', 'vec3').mul(float(1).sub(d.z)).mul(this.attachGlow = uniform(1));
    const mesh = new THREE.Mesh(ig, mat);
    mesh.frustumCulled = false;
    mesh.name = `${this.model.id}.attach`;
    this.group.add(mesh);
    return { mesh, geo: ig, iData, iTint, n: 0 };
  }

  /** Camera for LOD selection / culling (call once per frame before begin) */
  setView(camera) {
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _f.setFromProjectionMatrix(_pm);
    this.useFrustum = true;
  }

  begin() {
    this.count = 0;
    for (const l of this.lods) l.n = 0;
    if (this.attach) this.attach.n = 0;
  }

  /** Samples the animation state into this.pose (model space, before the root transform) */
  samplePose(anim) {
    const nb = this.nb, out = this.pose, clips = this.model.clips;
    if (!anim || anim.a < 0 || !clips[anim.a]) {
      const c = clips[this.model.clipIndex.get('idle') ?? 0];
      if (c) this._sample(c, 0, out, 1, false); else identity(out, nb);
      return out;
    }
    this._sample(clips[anim.a], anim.ta, out, 1, false);
    if (anim.w > 0 && anim.b >= 0 && clips[anim.b]) this._sample(clips[anim.b], anim.tb, out, anim.w, true);
    if (anim.wc > 0 && anim.c >= 0 && clips[anim.c]) this._sample(clips[anim.c], anim.tc, out, anim.wc, true);
    // procedural overrides: head look (yaw / pitch split over neck + head), extra jaw opening
    if (anim.lookYaw || anim.lookPitch) {
      if (this.lookA >= 0) this._rotSubtree(this.lookA, anim.lookYaw * 0.55, anim.lookPitch * 0.5);
      if (this.lookB >= 0) this._rotSubtree(this.lookB, anim.lookYaw * 0.45, anim.lookPitch * 0.5);
    }
    if (anim.jaw && this.jawBone >= 0) this._rotSubtree(this.jawBone, 0, anim.jaw, true);
    return out;
  }

  /** out = mix(out, clip(t), w) (or = clip(t) when !blend) */
  _sample(c, t, out, w, blend) {
    const nb = this.nb, d = c.data, F = c.frames;
    let ft;
    if (c.loop) { ft = (t / c.duration) * F; ft -= Math.floor(ft / F) * F; } else ft = Math.min(Math.max(0, t * c.fps), F - 1);
    const f0 = Math.floor(ft), fr = ft - f0;
    const f1 = c.loop ? (f0 + 1) % F : Math.min(f0 + 1, F - 1);
    const o0 = f0 * nb * 12, o1 = f1 * nb * 12, len = nb * 12;
    if (!blend) {
      for (let i = 0; i < len; i++) out[i] = d[o0 + i] + (d[o1 + i] - d[o0 + i]) * fr;
    } else {
      for (let i = 0; i < len; i++) { const v = d[o0 + i] + (d[o1 + i] - d[o0 + i]) * fr; out[i] += (v - out[i]) * w; }
    }
  }

  /** Rotates bone b's subtree about its current joint: yaw about model Y, pitch about the bone's own X axis */
  _rotSubtree(b, yaw, pitch, localOnly = false) {
    const P = this.pose, rest = this.model.bones.bind, o = b * 12;
    const rx = rest[b * 3], ry = rest[b * 3 + 1], rz = rest[b * 3 + 2];
    const cx = P[o] * rx + P[o + 1] * ry + P[o + 2] * rz + P[o + 3];
    const cy = P[o + 4] * rx + P[o + 5] * ry + P[o + 6] * rz + P[o + 7];
    const cz = P[o + 8] * rx + P[o + 9] * ry + P[o + 10] * rz + P[o + 11];
    // the bone's X axis (first column of its linear part)
    let ax = P[o], ay = P[o + 4], az = P[o + 8];
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    _q.setFromAxisAngle(_v.set(ax, ay, az), pitch);
    if (yaw && !localOnly) _q.premultiply(_q2.setFromAxisAngle(_v.set(0, 1, 0), yaw));
    _m.makeRotationFromQuaternion(_q);
    const e = _m.elements;
    const r00 = e[0], r01 = e[4], r02 = e[8], r10 = e[1], r11 = e[5], r12 = e[9], r20 = e[2], r21 = e[6], r22 = e[10];
    for (const j of this.subtree[b]) {
      const k = j * 12;
      for (let c = 0; c < 4; c++) {
        let x = P[k + c], y = P[k + 4 + c], z = P[k + 8 + c];
        if (c === 3) { x -= cx; y -= cy; z -= cz; }
        P[k + c] = r00 * x + r01 * y + r02 * z + (c === 3 ? cx : 0);
        P[k + 4 + c] = r10 * x + r11 * y + r12 * z + (c === 3 ? cy : 0);
        P[k + 8 + c] = r20 * x + r21 * y + r22 * z + (c === 3 ? cz : 0);
      }
    }
  }

  /**
   * Adds one individual. anim: animation state (creature-anim.js) or null (first frame of the first clip).
   * tint: [r, g, b] per-individual colour variation. Returns the row index (or -1 when full).
   */
  add(x, y, z, heading, scale, anim, flash = 0, stone = 0, elite = 0, pitch = 0, roll = 0, tint = null) {
    if (this.count >= this.capacity) return -1;
    const row = this.count++;
    const s = scale * this.model.baseScale;
    this.samplePose(anim);
    _e.set(pitch, heading, roll, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_v.set(x, y, z), _q, _v2.set(s, s, s));
    const R = _m.elements;
    const r = [R[0], R[4], R[8], R[12], R[1], R[5], R[9], R[13], R[2], R[6], R[10], R[14]];
    const P = this.pose, F = this.final, nb = this.nb;
    for (let b = 0; b < nb; b++) {
      const o = b * 12;
      for (let i = 0; i < 3; i++) {
        const a0 = r[i * 4], a1 = r[i * 4 + 1], a2 = r[i * 4 + 2];
        for (let c = 0; c < 4; c++) F[o + i * 4 + c] = a0 * P[o + c] + a1 * P[o + 4 + c] + a2 * P[o + 8 + c] + (c === 3 ? r[i * 4 + 3] : 0);
      }
    }
    // visibility + LOD
    const h = this.model.height * scale;
    const dist = Math.hypot(x - this.camPos.x, y + h * 0.5 - this.camPos.y, z - this.camPos.z);
    if (this.useFrustum) {
      _s.center.set(x, y + h * 0.5, z);
      _s.radius = this.cullR * scale + 1;
      if (!_f.intersectsSphere(_s)) return row;
    }
    this.texData.set(F, row * nb * 12);
    const lod = this.lods.length > 1 && dist > h * this.lodK ? this.lods[1] : this.lods[0];
    this._inst(lod, row, flash, stone, elite, tint);
    if (this.attach) this._inst(this.attach, row, flash, stone, elite, tint);
    return row;
  }

  _inst(l, row, flash, stone, elite, tint) {
    const k = l.n++;
    const d = l.iData.array, t = l.iTint.array;
    d[k * 4] = row; d[k * 4 + 1] = flash; d[k * 4 + 2] = stone; d[k * 4 + 3] = elite;
    t[k * 4] = tint ? tint[0] : 1; t[k * 4 + 1] = tint ? tint[1] : 1; t[k * 4 + 2] = tint ? tint[2] : 1; t[k * 4 + 3] = 0;
  }

  /** World position of a bone of the LAST added individual; local = offset from the joint in geometry (bind-pose)
   *  model units — the morph and the animation move it with the bone */
  partWorldPosition(partName, out, local = null) {
    const b = this.partIndex.get(this.alias(partName));
    if (b === undefined) return out.set(0, 0, 0);
    const rest = this.model.bones.bind, F = this.final, o = b * 12;
    const x = rest[b * 3] + (local ? local.x : 0), y = rest[b * 3 + 1] + (local ? local.y : 0), z = rest[b * 3 + 2] + (local ? local.z : 0);
    return out.set(
      F[o] * x + F[o + 1] * y + F[o + 2] * z + F[o + 3],
      F[o + 4] * x + F[o + 5] * y + F[o + 6] * z + F[o + 7],
      F[o + 8] * x + F[o + 9] * y + F[o + 10] * z + F[o + 11]
    );
  }

  end() {
    for (const l of [...this.lods, ...(this.attach ? [this.attach] : [])]) {
      l.geo.instanceCount = l.n;
      l.mesh.visible = l.n > 0;
      for (const a of [l.iData, l.iTint]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, l.n) * 4); a.needsUpdate = true; }
    }
    this.boneTex.needsUpdate = true;
  }

  /** Draw-call / triangle stats for the perf overlay */
  stats() {
    let calls = 0, tris = 0;
    for (const l of [...this.lods, ...(this.attach ? [this.attach] : [])]) {
      if (!l.n) continue;
      calls++;
      tris += (l.geo.index ? l.geo.index.count : l.geo.getAttribute('position').count) / 3 * l.n;
    }
    return { calls, tris, count: this.count };
  }

  dispose() {
    for (const l of this.lods) { l.geo.dispose(); l.mesh.material.dispose(); }
    this.boneTex.dispose();
  }
}

function identity(out, nb) {
  out.fill(0);
  for (let b = 0; b < nb; b++) { out[b * 12] = 1; out[b * 12 + 5] = 1; out[b * 12 + 10] = 1; }
}

function mergeSimple(geos) {
  const names = Object.keys(geos[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = geos[0].getAttribute(n).itemSize;
    const total = geos.reduce((s, g) => s + g.getAttribute(n).count, 0);
    const Arr = geos[0].getAttribute(n).array.constructor;
    const arr = new Arr(total * size);
    let o = 0;
    for (const g of geos) { arr.set(g.getAttribute(n).array, o); o += g.getAttribute(n).array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q2 = new THREE.Quaternion();

export { SkinnedCrowd };
