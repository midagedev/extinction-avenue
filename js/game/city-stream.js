import * as THREE from 'three/webgpu';
import { STREAM, cellOf, cellKey, windowCells, loopReach, streamDiff } from '../device-profile.js';

// js/game/city-stream.js
// Phones (js/device-profile.js LOWMEM): city chunk streaming along the cab's route.
//
// The city builders emit Manhattan as a few thousand static meshes, many of them instanced batches or merged meshes
// spanning the whole island. After the build (and scene-culling's chunking), CityStream cuts every static city mesh
// into STREAM.cell squares of the world:
//   - instanced meshes: instances are split by cell (one InstancedMesh per cell sharing the source's vertex data and
//     material, so the same shader pipeline);
//   - merged meshes larger than a cell (road paint, curbs, the shore highway, ...): triangles are split by cell;
//   - smaller meshes go to the cell of their centre.
// Pieces bigger than a cell (the harbour water, a long seawall triangle, a huge ground box) are not streamed: they stay
// resident. Cells that no window along the whole loop ever reaches are freed at once ("dead": they could never be
// seen from the cab). The rest stream: only the cells in the window around the cab (device-profile.js streamCells:
// far down the street behind the cab, where the gunner looks, less far ahead, plus the straight sightline along the
// current heading) are in the scene. A cell leaving the window is removed and its GPU buffers are released; it is
// rebuilt from its CPU recipe (the vertex / instance arrays) when it comes back. Entering cells are added
// nearest-first under a per-frame upload budget, leaving ones are released a few per frame, so streaming never hitches.
//
// Not streamed: dynamic instance pools (rooftop props / fire escapes / awnings that cityBlocks.update refills around
// the camera, anything with frustumCulled = false), the tree LOD field, skinned / morphed / multi-material meshes and
// whatever the caller leaves out of `roots` (the landmarks and the borough skyline: the horizon).

const UPLOAD_BUDGET = 1.5e6; // bytes of vertex / instance data added per frame
const DROP_BUDGET = 24; // cells released per frame
const RESIDENT_LIMIT = STREAM.cell * 0.75; // larger than this (bounding radius / triangle / instance extent): resident
const MIN_TRIS = 64; // merged meshes with fewer triangles are not worth cutting

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();

/** The Object3D state a piece copies from its source (kept instead of the source, which holds the full arrays) */
function stateOf(src) {
  return {
    name: src.name, castShadow: src.castShadow, receiveShadow: src.receiveShadow, renderOrder: src.renderOrder,
    layers: { mask: src.layers.mask }, frustumCulled: src.frustumCulled, userData: { ...src.userData },
    position: src.position.clone(), quaternion: src.quaternion.clone(), scale: src.scale.clone(),
    matrixAutoUpdate: src.matrixAutoUpdate, matrix: src.matrix.clone(),
    onBeforeRender: Object.prototype.hasOwnProperty.call(src, 'onBeforeRender') ? src.onBeforeRender : undefined
  };
}

function copyState(dst, src) {
  dst.name = src.name;
  dst.castShadow = src.castShadow;
  dst.receiveShadow = src.receiveShadow;
  dst.renderOrder = src.renderOrder;
  dst.layers.mask = src.layers.mask;
  dst.frustumCulled = src.frustumCulled;
  dst.userData = { ...src.userData, streamed: true };
  dst.position.copy(src.position);
  dst.quaternion.copy(src.quaternion);
  dst.scale.copy(src.scale);
  dst.matrixAutoUpdate = src.matrixAutoUpdate;
  dst.matrix.copy(src.matrix);
  if (src.onBeforeRender && (!src.isObject3D || Object.prototype.hasOwnProperty.call(src, 'onBeforeRender'))) dst.onBeforeRender = src.onBeforeRender;
}

/** out[j] = src[ids[j]] for items of `size` components */
function gather(src, ids, size, out) {
  for (let j = 0; j < ids.length; j++) { const o = ids[j] * size; for (let q = 0; q < size; q++) out[j * size + q] = src[o + q]; }
  return out;
}

const bytesOf = (geo) => Object.values(geo.attributes).reduce((s, a) => s + (a.array?.byteLength || 0), 0) + (geo.index?.array?.byteLength || 0);

class CityStream {
  /**
   * @param {THREE.Object3D[]} roots  the static city roots to stream
   * @param {{ storageInstances?: boolean, culled?: object[] }} opts
   *   storageInstances: WebGPU backend (instance matrices are storage buffers, see world.js)
   *   culled: scene-culling's distance-culled chunk list ({ mesh, x, y, z, r, d }): pieces cut from those chunks keep
   *   their cull distance (updateCulling) and the replaced chunks leave the list
   */
  constructor(roots, { storageInstances = false, culled = null, reach = null } = {}) {
    this.storageInstances = storageInstances;
    this.reachable = reach; // device-profile.js loopReach: cells outside it are never built (null: all)
    this.cells = new Map(); // key -> { key, cx, cz, pieces: [], resident, bytes }
    this.resident = new Set();
    this.strays = new Set(); // pieces added outside the window for the shader pre-compilation
    this.pending = [];
    this.dropQueue = [];
    this.sample = null;
    this.lastS = null;
    this.reach = 1;
    this.stats = { pieces: 0, kept: 0, cpuBytes: 0, residentBytes: 0, deadBytes: 0, adds: 0, drops: 0 };
    const cullD = new Map();
    if (culled) for (const c of culled) cullD.set(c.mesh, c.d);
    this.cullD = cullD;
    this._partition(roots);
    this.cullD = null;
    if (culled) for (let i = culled.length - 1; i >= 0; i--) if (!culled[i].mesh.parent) culled.splice(i, 1);
  }

  /** The cell at (x, z), or null when no window along the loop ever reaches it (the piece is dropped right away) */
  _cell(x, z) {
    const [cx, cz] = cellOf(x, z);
    const key = cellKey(cx, cz);
    if (this.reachable && !this.reachable.has(key)) return null;
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, (c = { key, cx, cz, pieces: [], resident: false, bytes: 0 }));
    return c;
  }

  _addPiece(cellObj, piece) {
    cellObj.pieces.push(piece);
    cellObj.bytes += piece.bytes;
    this.stats.pieces++;
    this.stats.cpuBytes += piece.bytes;
  }

  _partition(roots) {
    const sources = [];
    for (const root of roots) {
      root.updateMatrixWorld(true);
      const visit = (o) => {
        if (o.name === 'Trees' || o.userData.noStream) return; // the tree LOD field manages its own cells
        if (o.isMesh) { if (this._streamable(o)) sources.push(o); return; }
        for (const c of o.children) visit(c);
      };
      visit(root);
    }
    for (const o of sources) {
      if (o.isInstancedMesh) this._splitInstanced(o);
      else this._splitMesh(o);
    }
  }

  _streamable(o) {
    if (!o.visible || o.isSkinnedMesh || o.morphTargetInfluences || o.frustumCulled === false || o.userData.shadowProxy) return false;
    if (Array.isArray(o.material) || !o.geometry?.attributes?.position) return false;
    const g = o.geometry;
    if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
    if (o.isInstancedMesh) {
      if (o.count === 0 || o.count !== o.instanceMatrix.count || o.instanceMatrix.usage === THREE.DynamicDrawUsage) return false;
      if (o.instanceMatrix.isStorageBufferAttribute && !this.storageInstances) return false;
      return true;
    }
    if (!(g.attributes.position.array?.length > 0)) return false; // vertex copy already released
    if (g.groups.length > 1) return false;
    if (Object.values(g.attributes).some((a) => a.isInterleavedBufferAttribute)) return false;
    return true;
  }

  // ---- instanced meshes: per-cell instance subsets --------------------------------------------------------------
  _splitInstanced(mesh) {
    const n = mesh.count;
    const src = mesh.instanceMatrix.array;
    const W = mesh.matrixWorld;
    const geo0 = mesh.geometry;
    if (!geo0.boundingBox) geo0.computeBoundingBox();
    if (!geo0.boundingSphere) geo0.computeBoundingSphere();
    const r0 = geo0.boundingSphere.radius;
    const groups = new Map(); // cell | 'keep' -> ids
    for (let i = 0; i < n; i++) {
      _m.fromArray(src, i * 16).premultiply(W);
      _s.setFromMatrixScale(_m);
      const r = r0 * Math.max(_s.x, _s.y, _s.z);
      _v.copy(geo0.boundingSphere.center).applyMatrix4(_m);
      const k = r > RESIDENT_LIMIT ? 'keep' : this._cell(_v.x, _v.z);
      if (k === null) continue;
      let ids = groups.get(k);
      if (!ids) groups.set(k, (ids = []));
      ids.push(i);
    }
    const shared = [];
    const own = [];
    for (const [name, a] of Object.entries(geo0.attributes)) (a.isInstancedBufferAttribute ? own : shared).push([name, a]);
    // what the pieces need of the source: its vertex data (shared), never its per-instance arrays
    const tpl = { index: geo0.index, groups: geo0.groups.map((g) => ({ ...g })), drawRange: { ...geo0.drawRange }, boundingBox: geo0.boundingBox, boundingSphere: geo0.boundingSphere };
    const state = stateOf(mesh);
    const cullD = this.cullD.get(mesh) || 0;
    for (const [k, ids] of groups) {
      const m = ids.length;
      const matrices = new Float32Array(m * 16);
      gather(src, ids, 16, matrices);
      const colors = mesh.instanceColor ? gather(mesh.instanceColor.array, ids, 3, new Float32Array(m * 3)) : null;
      const extra = own.map(([name, a]) => {
        const s = a.itemSize;
        const arr = new a.array.constructor(m * s);
        gather(a.array, ids, s, arr);
        return { name, arr, s, normalized: a.normalized, mpa: a.meshPerAttribute };
      });
      // bounds of the subset in world space (for the cull distance)
      const box = new THREE.Box3();
      for (let j = 0; j < m; j++) {
        _m.fromArray(matrices, j * 16).premultiply(W);
        _s.setFromMatrixScale(_m);
        _v.copy(geo0.boundingSphere.center).applyMatrix4(_m);
        box.expandByPoint(_a.copy(_v).addScalar(-r0 * Math.max(_s.x, _s.y, _s.z)));
        box.expandByPoint(_b.copy(_v).addScalar(r0 * Math.max(_s.x, _s.y, _s.z)));
      }
      const piece = {
        kind: 'inst', state, parent: mesh.parent, material: mesh.material, tpl, shared, extra, matrices, colors, count: m,
        sphere: box.getBoundingSphere(new THREE.Sphere()), cullD, obj: null,
        bytes: matrices.byteLength + (colors ? colors.byteLength : 0) + extra.reduce((s, e) => s + e.arr.byteLength, 0)
      };
      if (k === 'keep') {
        // resident for good: in the scene now, like any static mesh
        piece.obj = this._makeInstanced(piece);
        piece.obj.userData.streamed = false;
        piece.parent.add(piece.obj);
        this.stats.kept++;
      } else this._addPiece(k, piece);
    }
    mesh.parent.remove(mesh);
    mesh.dispose();
  }

  // ---- plain meshes: whole (small) or cut by triangle (large) -----------------------------------------------------
  _splitMesh(mesh) {
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const W = mesh.matrixWorld;
    const r = g.boundingSphere.radius * W.getMaxScaleOnAxis();
    const cullD = this.cullD.get(mesh) || 0;
    const pos = g.attributes.position;
    const idx = g.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    if (r <= RESIDENT_LIMIT) {
      _v.copy(g.boundingSphere.center).applyMatrix4(W);
      const cellObj = this._cell(_v.x, _v.z);
      const parent = mesh.parent;
      parent.remove(mesh); // added back when its cell is resident
      if (!cellObj) { g.dispose(); this.stats.deadBytes += bytesOf(g); return; } // never in view
      mesh.userData.streamed = true;
      this._addPiece(cellObj, { kind: 'mesh', parent, obj: mesh, geometry: g, sphere: new THREE.Sphere(_v.clone(), r), cullD, bytes: bytesOf(g) });
      return;
    }
    if (triCount < MIN_TRIS) return; // the harbour water, sky domes, ...: resident
    // Cut: every triangle goes to the cell of its centroid; triangles larger than a cell stay resident
    const start = g.drawRange.start;
    const end = Math.min(idx ? idx.count : pos.count, start + (Number.isFinite(g.drawRange.count) ? g.drawRange.count : Infinity));
    const tris = new Map(); // cell | 'keep' -> vertex indices
    const lim2 = (RESIDENT_LIMIT * 2) ** 2;
    for (let t = start; t + 2 < end; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(W);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(W);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(W);
      const big = _a.distanceToSquared(_b) > lim2 || _b.distanceToSquared(_c) > lim2 || _c.distanceToSquared(_a) > lim2;
      const k = big ? 'keep' : this._cell((_a.x + _b.x + _c.x) / 3, (_a.z + _b.z + _c.z) / 3);
      if (k === null) continue; // never in view
      let list = tris.get(k);
      if (!list) tris.set(k, (list = []));
      list.push(i0, i1, i2);
    }
    const names = Object.keys(g.attributes);
    for (const [k, verts] of tris) {
      const geo = new THREE.BufferGeometry();
      for (const name of names) {
        const a = g.attributes[name];
        const s = a.itemSize;
        const arr = new a.array.constructor(verts.length * s);
        const src = a.array;
        for (let j = 0; j < verts.length; j++) { const o = verts[j] * s; for (let q = 0; q < s; q++) arr[j * s + q] = src[o + q]; }
        geo.setAttribute(name, new THREE.BufferAttribute(arr, s, a.normalized));
      }
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const piece = new THREE.Mesh(geo, mesh.material);
      copyState(piece, mesh);
      if (k === 'keep') {
        piece.userData.streamed = false;
        mesh.parent.add(piece);
        this.stats.kept++;
        continue;
      }
      const sphere = geo.boundingSphere.clone().applyMatrix4(W);
      this._addPiece(k, { kind: 'mesh', parent: mesh.parent, obj: piece, geometry: geo, sphere, cullD, bytes: bytesOf(geo) });
    }
    mesh.parent.remove(mesh);
    g.dispose();
  }

  // ---- residency --------------------------------------------------------------------------------------------------
  _makeInstanced(p) {
    const geo = new THREE.BufferGeometry();
    if (p.tpl.index) geo.setIndex(p.tpl.index);
    for (const [name, a] of p.shared) geo.setAttribute(name, a);
    for (const e of p.extra) geo.setAttribute(e.name, new THREE.InstancedBufferAttribute(e.arr, e.s, e.normalized, e.mpa));
    for (const gr of p.tpl.groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
    geo.setDrawRange(p.tpl.drawRange.start, p.tpl.drawRange.count);
    geo.boundingBox = p.tpl.boundingBox;
    geo.boundingSphere = p.tpl.boundingSphere;
    const mesh = new THREE.InstancedMesh(geo, p.material, 0);
    mesh.count = p.count;
    mesh.instanceMatrix = this.storageInstances ? new THREE.StorageInstancedBufferAttribute(p.matrices, 16) : new THREE.InstancedBufferAttribute(p.matrices, 16);
    if (p.colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(p.colors, 3);
    copyState(mesh, p.state);
    mesh.computeBoundingSphere();
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  _show(p) {
    if (p.kind === 'inst' && !p.obj) p.obj = this._makeInstanced(p);
    if (!p.obj.parent) p.parent.add(p.obj);
  }

  _release(p) {
    const o = p.obj;
    if (!o) return;
    o.parent?.remove(o);
    if (p.kind === 'inst') {
      // render objects + the subset's own buffers; the shared template attributes are detached first so the
      // geometry's dispose() does not delete buffers that other cells still draw with
      const g = o.geometry;
      o.dispose();
      g.index = null;
      for (const [name] of p.shared) g.deleteAttribute(name);
      g.dispose();
      o.instanceMatrix?.dispose?.();
      o.instanceColor?.dispose?.();
      p.obj = null; // rebuilt from the recipe on re-entry
    } else {
      o.dispose?.();
      p.geometry.dispose(); // GPU buffers; the CPU arrays stay for the re-upload
    }
  }

  _add(cellObj) {
    for (const p of cellObj.pieces) { this.strays.delete(p); this._show(p); }
    cellObj.resident = true;
    this.resident.add(cellObj.key);
    this.stats.adds++;
    this.stats.residentBytes += cellObj.bytes;
    return cellObj.bytes;
  }

  _drop(cellObj) {
    for (const p of cellObj.pieces) this._release(p);
    cellObj.resident = false;
    this.resident.delete(cellObj.key);
    this.stats.drops++;
    this.stats.residentBytes -= cellObj.bytes;
  }

  /** Bind the route (Route-like: sample(s, out) -> { x, z, hx, hz }, length) and free the cells no window reaches */
  setRoute(route) {
    this.sample = (s, out = {}) => route.sample(s, out);
    const reach = this.reachable || loopReach(this.sample, route.length);
    for (const [key, c] of this.cells) {
      if (reach.has(key)) continue;
      for (const p of c.pieces) {
        if (p.obj?.parent) this._release(p);
        if (p.kind === 'mesh') p.geometry.dispose();
        this.stats.deadBytes += p.bytes;
        this.stats.cpuBytes -= p.bytes;
        this.stats.pieces--;
      }
      this.cells.delete(key);
    }
  }

  _window(s, pad, reach = this.reach) {
    return windowCells(this.sample, s, { reach, pad });
  }

  /** Shrink (or restore) the window: 1 = STREAM as configured (quality-governor.js steps it down under pressure) */
  setReach(reach) {
    this.reach = reach;
    this.lastS = null;
  }

  /** The window around arc length s resident right now (start of a run, teleports, the title) */
  prime(s) {
    this.lastS = null;
    this.update(s, Infinity);
    this.dropStrays();
  }

  /** For the shader pre-compilation: one piece of every material / instancing kind that is not resident yet */
  addRepresentatives() {
    const seen = new Set();
    const key = (p) => `${p.kind}:${p.kind === 'inst' ? p.material.uuid : p.obj.material.uuid}:${p.obj?.castShadow ?? p.state.castShadow}`;
    for (const k of this.resident) for (const p of this.cells.get(k).pieces) seen.add(key(p));
    for (const c of this.cells.values()) {
      if (c.resident) continue;
      for (const p of c.pieces) {
        const k = key(p);
        if (seen.has(k)) continue;
        seen.add(k);
        this._show(p);
        this.strays.add(p);
      }
    }
    return this.strays.size;
  }

  dropStrays() {
    for (const p of this.strays) this._release(p);
    this.strays.clear();
  }

  /**
   * Per frame: recompute the window when the cab moved > 20 m along the route, then add / drop cells under budget.
   * @param {number} s  the cab's arc length    @param {number} budget  bytes to add this frame
   */
  update(s, budget = UPLOAD_BUDGET) {
    if (!this.sample) return;
    if (this.lastS === null || Math.abs(s - this.lastS) > 20) {
      this.lastS = s;
      const want = this._window(s, 0);
      const keep = this._window(s, STREAM.hysteresis);
      const p = this.sample(s, {});
      const dist = (k) => { const c = this.cells.get(k); return ((c.cx + 0.5) * STREAM.cell - p.x) ** 2 + ((c.cz + 0.5) * STREAM.cell - p.z) ** 2; };
      const wantHere = new Set([...want].filter((k) => this.cells.has(k)));
      const { add, drop } = streamDiff(this.resident, wantHere, keep, dist);
      this.pending = add;
      this.dropQueue = drop;
    }
    let spent = 0;
    while (this.pending.length && spent < budget) {
      const c = this.cells.get(this.pending.shift());
      if (c && !c.resident) spent += this._add(c) || 1;
    }
    let dropped = 0;
    while (this.dropQueue.length && dropped < DROP_BUDGET) {
      const c = this.cells.get(this.dropQueue.shift());
      if (c?.resident) { this._drop(c); dropped++; }
    }
  }

  /** Distance culling of pieces cut from scene-culling's culled chunks (their cull distance carries over) */
  updateCulling(x, y, z) {
    for (const key of this.resident) {
      for (const p of this.cells.get(key).pieces) {
        if (!p.cullD || !p.obj) continue;
        const c = p.sphere.center;
        p.obj.visible = Math.hypot(c.x - x, c.y - y, c.z - z) - p.sphere.radius < p.cullD;
      }
    }
  }

  info() {
    const MB = (b) => +(b / 1048576).toFixed(1);
    return { cells: this.cells.size, resident: this.resident.size, pending: this.pending.length, pieces: this.stats.pieces, kept: this.stats.kept,
      residentMB: MB(this.stats.residentBytes), cpuMB: MB(this.stats.cpuBytes), deadMB: MB(this.stats.deadBytes), adds: this.stats.adds, drops: this.stats.drops };
  }
}

export { CityStream };
