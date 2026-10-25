import * as THREE from 'three/webgpu';
import { attribute, instancedDynamicBufferAttribute, mix, vec3, float, uniform, normalWorld, cameraPosition, positionWorld, dot, normalize, pow, max } from 'three/tsl';

// js/game/rig.js
// Instanced rigid-part rigs: every creature type is a small hierarchy of rigid parts (body, neck, head, jaw, tail
// segments, legs, arms, wings…). Each part is one InstancedMesh, so a whole swarm of one species costs one draw call
// per part no matter how many individuals are on screen. Poses (run cycles, lunges, death slumps) are computed on the
// CPU per instance as a handful of joint rotations and composed down the hierarchy here.
//
// RIG MODEL FORMAT (produced by dino-models.js placeholders or by a glTF/GLB with matching node names, see assets.js):
//   {
//     id, parts: [{ name, parent (name | null), pivot: [x, y, z], geometry }],
//     length, height, radius   // metres, used for gameplay hit radii and the fossil-shard burst
//   }
//   - pivot: the joint position in the parent's joint frame (root part: relative to the creature's ground origin).
//   - geometry: in the part's joint frame (origin = joint). +z = forward (snout), +y = up, +x = the creature's left.
//     Non-indexed triangles with attributes position, normal, color (linear RGB) and emissive (RGB glow multiplier).
//
// POSE FORMAT: Float32Array(parts × 3) of joint rotations (x pitch, y yaw, z roll) in radians, Euler order 'YXZ'.

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _t = new THREE.Matrix4();

function createRigMaterial(opts = {}) {
  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.0,
    flatShading: true
  });
  return mat;
}

class InstancedRig {
  /**
   * @param {object} model rig model (see above)
   * @param {number} capacity max instances
   * @param {object} opts { glow: THREE.Color multiplier for emissive markings, stone: THREE.Color for fossilized look }
   */
  constructor(model, capacity, opts = {}) {
    this.model = model;
    this.capacity = capacity;
    this.group = new THREE.Group();
    this.group.name = `Rig_${model.id}`;
    this.count = 0;
    this.parts = model.parts;
    const nameToIndex = new Map(model.parts.map((p, i) => [p.name, i]));
    this.partIndex = nameToIndex;
    this.parentIndex = model.parts.map((p) => (p.parent ? nameToIndex.get(p.parent) : -1));
    // Parts must be listed parent-first
    this.parentIndex.forEach((pi, i) => {
      if (pi >= i) throw new Error(`rig ${model.id}: part ${model.parts[i].name} listed before its parent`);
    });
    this.pivots = model.parts.map((p) => new THREE.Vector3(...(p.pivot || [0, 0, 0])));
    this.worldMats = model.parts.map(() => new THREE.Matrix4());

    // Per-instance FX: x = hit flash (0..1), y = fossilize (0..1 turns the creature to stone), z = elite glow boost
    this.fx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.fx.setUsage(THREE.DynamicDrawUsage);
    const fxNode = instancedDynamicBufferAttribute(this.fx, 'vec3');

    this.uGlow = uniform(opts.glow ? opts.glow.clone() : new THREE.Color(1, 1, 1));
    this.uEliteGlow = uniform(opts.eliteGlow ? opts.eliteGlow.clone() : new THREE.Color(4, 0.6, 2.4));
    this.uStone = uniform(opts.stone ? opts.stone.clone() : new THREE.Color(0.2, 0.19, 0.175));
    this.uTint = uniform(opts.tint ? opts.tint.clone() : new THREE.Color(1, 1, 1));

    const mat = createRigMaterial(opts);
    const vColor = attribute('color', 'vec3');
    const vEmissive = attribute('emissive', 'vec3');
    const flash = fxNode.x;
    const stone = fxNode.y;
    const elite = fxNode.z;
    mat.colorNode = mix(vColor.mul(this.uTint), vec3(this.uStone), stone).add(vec3(flash.mul(0.15)));
    // Rim light keeps silhouettes readable against dark streets (stylized, cheap)
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const rim = pow(float(1).sub(max(dot(normalWorld, viewDir), 0)), 3.0);
    const glow = vEmissive.mul(this.uGlow).mul(float(1).sub(stone));
    const eliteRim = vec3(this.uEliteGlow).mul(elite).mul(rim.mul(2.2).add(0.15));
    mat.emissiveNode = glow.add(vec3(1.0, 0.85, 0.7).mul(flash.mul(0.9))).add(eliteRim).add(vec3(0.5, 0.65, 0.9).mul(rim.mul(0.35)).mul(float(1).sub(stone)));
    mat.roughnessNode = mix(float(opts.roughness ?? 0.72), float(0.95), stone);
    this.material = mat;

    this.meshes = model.parts.map((p) => {
      const g = p.geometry;
      if (!g.getAttribute('color')) {
        const c = new Float32Array(g.getAttribute('position').count * 3).fill(0.6);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      }
      if (!g.getAttribute('emissive')) {
        g.setAttribute('emissive', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3));
      }
      // The FX attribute (fxNode) is shared by every part of the rig: all parts of one individual flash together
      const mesh = new THREE.InstancedMesh(g, mat, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.name = `${model.id}.${p.name}`;
      this.group.add(mesh);
      return mesh;
    });
    this.rootMatrix = new THREE.Matrix4();
  }

  begin() {
    this.count = 0;
  }

  /**
   * Adds one posed individual.
   * @param {number} x @param {number} y @param {number} z ground position of the creature origin
   * @param {number} heading yaw (faces (sin h, cos h))
   * @param {number} scale uniform scale
   * @param {Float32Array} pose joint rotations (parts × 3)
   * @param {number} flash 0..1 @param {number} stone 0..1 @param {number} elite 0..1
   * @param {number} pitch / roll body tilt (whole creature)
   */
  add(x, y, z, heading, scale, pose, flash = 0, stone = 0, elite = 0, pitch = 0, roll = 0) {
    if (this.count >= this.capacity) return -1;
    const idx = this.count++;
    _e.set(pitch, heading, roll, 'YXZ');
    _q.setFromEuler(_e);
    this.rootMatrix.compose(_v.set(x, y, z), _q, _s.set(scale, scale, scale));
    const parts = this.parts.length;
    for (let i = 0; i < parts; i++) {
      const pi = this.parentIndex[i];
      const pv = this.pivots[i];
      _e.set(pose ? pose[i * 3] : 0, pose ? pose[i * 3 + 1] : 0, pose ? pose[i * 3 + 2] : 0, 'YXZ');
      _q.setFromEuler(_e);
      _t.compose(pv, _q, _one);
      const parent = pi < 0 ? this.rootMatrix : this.worldMats[pi];
      this.worldMats[i].multiplyMatrices(parent, _t);
      this.meshes[i].setMatrixAt(idx, this.worldMats[i]);
    }
    const f = this.fx.array;
    f[idx * 3] = flash;
    f[idx * 3 + 1] = stone;
    f[idx * 3 + 2] = elite;
    return idx;
  }

  /** World matrix of a part of the last added individual (e.g. to place a muzzle, weak point or VFX on the head) */
  partWorldPosition(partName, out, local = null) {
    const i = this.partIndex.get(partName);
    if (i === undefined) return out.set(0, 0, 0);
    out.copy(local || _zero).applyMatrix4(this.worldMats[i]);
    return out;
  }

  end() {
    for (const mesh of this.meshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.fx.clearUpdateRanges();
    this.fx.addUpdateRange(0, this.count * 3);
    this.fx.needsUpdate = true;
  }

  dispose() {
    for (const mesh of this.meshes) mesh.dispose();
    this.material.dispose();
  }
}

const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Vector3();

/** Allocates a zeroed pose buffer for a model */
function createPose(model) {
  return new Float32Array(model.parts.length * 3);
}

export { InstancedRig, createPose, createRigMaterial };
