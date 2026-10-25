import * as THREE from 'three/webgpu';
import { attribute, instancedDynamicBufferAttribute, vec3, vec4, float, uniform } from 'three/tsl';

// js/game/batches.js
// PropBatch: one InstancedMesh per prop type, refilled every frame (begin → add… → end). Geometry carries vertex
// `color` + `emissive` (see props.js); each instance adds an RGB tint (multiplies color & glow) and an alpha-like
// `glow` scalar. Lit batches use a standard material; additive batches are unlit HDR glow (muzzle flashes, sparks,
// tracers, fireballs) that the bloom pass picks up.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();

class PropBatch {
  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {number} capacity
   * @param {object} opts { additive, glow (emissive multiplier), roughness, metalness, depthWrite, name, shadow }
   */
  constructor(geometry, capacity, opts = {}) {
    this.capacity = capacity;
    this.count = 0;
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.tint.setUsage(THREE.DynamicDrawUsage);
    const tintNode = instancedDynamicBufferAttribute(this.tint, 'vec4');
    this.uGlow = uniform(opts.glow ?? 1);
    const vColor = attribute('color', 'vec3');
    const vEmissive = attribute('emissive', 'vec3');
    let mat;
    if (opts.additive) {
      mat = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide
      });
      // tint.rgb = HDR color, tint.a = intensity (fade); additive so black = invisible
      mat.colorNode = vec4(vColor.add(vEmissive).mul(tintNode.xyz).mul(tintNode.w).mul(this.uGlow), 1);
      mat.fog = opts.fog ?? false;
    } else {
      mat = new THREE.MeshStandardNodeMaterial({
        roughness: opts.roughness ?? 0.6,
        metalness: opts.metalness ?? 0.2,
        flatShading: true
      });
      mat.colorNode = vColor.mul(tintNode.xyz);
      mat.emissiveNode = vEmissive.mul(tintNode.xyz).mul(tintNode.w).mul(this.uGlow);
    }
    this.material = mat;
    this.mesh = new THREE.InstancedMesh(geometry, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!opts.shadow;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.name = opts.name || 'PropBatch';
    if (opts.renderOrder !== undefined) this.mesh.renderOrder = opts.renderOrder;
  }

  begin() {
    this.count = 0;
  }

  _tint(idx, r, g, b, a) {
    const t = this.tint.array;
    t[idx * 4] = r;
    t[idx * 4 + 1] = g;
    t[idx * 4 + 2] = b;
    t[idx * 4 + 3] = a;
  }

  /** Position + Euler (YXZ: yaw, pitch, roll) + scale (number or sx, sy, sz) */
  add(x, y, z, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = sx, sz = sx, r = 1, g = 1, b = 1, a = 1) {
    if (this.count >= this.capacity) return -1;
    const idx = this.count++;
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.mesh.setMatrixAt(idx, _m);
    this._tint(idx, r, g, b, a);
    return idx;
  }

  /** A unit +z prop stretched between two points (tracers, beams), thickness w×h */
  addSegment(x0, y0, z0, x1, y1, z1, w, h, r = 1, g = 1, b = 1, a = 1) {
    if (this.count >= this.capacity) return -1;
    const idx = this.count++;
    _dir.set(x1 - x0, y1 - y0, z1 - z0);
    const len = _dir.length() || 1e-4;
    _dir.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_fwd, _dir);
    _m.compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, _s.set(w, h, len));
    this.mesh.setMatrixAt(idx, _m);
    this._tint(idx, r, g, b, a);
    return idx;
  }

  addMatrix(matrix, r = 1, g = 1, b = 1, a = 1) {
    if (this.count >= this.capacity) return -1;
    const idx = this.count++;
    this.mesh.setMatrixAt(idx, matrix);
    this._tint(idx, r, g, b, a);
    return idx;
  }

  end() {
    const mesh = this.mesh;
    mesh.count = this.count;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, Math.max(1, this.count) * 16);
    mesh.instanceMatrix.needsUpdate = true;
    this.tint.clearUpdateRanges();
    this.tint.addUpdateRange(0, Math.max(1, this.count) * 4);
    this.tint.needsUpdate = true;
  }
}

export { PropBatch, _up as UP };
