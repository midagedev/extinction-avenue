import * as THREE from 'three/webgpu';

// js/game/gunner.js
// The rear gunner's first-person view model: the tail gun and the gunner's gloved hands, parented to the camera at the
// bottom of the screen. It swivels toward whatever is under the crosshair, kicks back on every shot (with a muzzle
// flash light and a flash sprite at the muzzle), dips down and racks a fresh belt while reloading, and swaps to the
// Rail Lance model on evolution. muzzleWorld() is where tracers start.

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, 1);
const MUZZLE = new THREE.Vector3(0, 0.01, 1.4);

class GunnerView {
  constructor(camera, assets, material) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'GunnerViewModel';
    // Low and a little right of centre, like a pintle-mounted gun the gunner leans into
    this.root.position.set(0.17, -0.47, -1.0);
    camera.add(this.root);
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    const mk = (id) => {
      const m = new THREE.Mesh(assets.get(id).geometry, material);
      m.frustumCulled = false;
      m.renderOrder = 10;
      this.pivot.add(m);
      return m;
    };
    // Hatch coaming at the bottom corners (static in the view, sways with the cab's roll via the camera)
    this.rims = [];
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(assets.get('hatchRim').geometry, material);
      rim.position.set(s * 0.62, -0.46, -0.7);
      rim.rotation.set(0.25, 0, s * 0.32);
      rim.frustumCulled = false;
      rim.renderOrder = 9;
      camera.add(rim);
      this.rims.push(rim);
    }
    this.gun = mk('tailGun');
    this.rail = mk('tailRail');
    this.rail.visible = false;
    // Muzzle flash: additive star that pops for a frame or two
    const flashMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3.2, 1.7, 0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    // 8-point star (long and short spikes), facing along the barrel
    const shape = new THREE.Shape();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 0.028 : i % 4 === 0 ? 0.14 : 0.07;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const star = new THREE.ShapeGeometry(shape);
    this.flash = new THREE.Mesh(star, flashMat);
    this.flash.position.copy(MUZZLE).add(_v.set(0, 0, 0.12));
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 11;
    this.flash.visible = false;
    this.pivot.add(this.flash);
    // A second, side-on star gives the flash some volume
    this.flashB = this.flash.clone();
    this.flashB.rotation.y = Math.PI / 2;
    this.flashB.position.z += 0.15;
    this.pivot.add(this.flashB);
    this.light = new THREE.PointLight(0xffb060, 0, 3.2, 2);
    this.light.position.copy(MUZZLE);
    this.pivot.add(this.light);
    this.recoil = 0;
    this.flashT = 0;
    this.reload = 0; // 0..1 reload animation progress (0 = not reloading)
    this.yaw = 0;
    this.pitch = 0;
    this.spin = 0;
    this.visible = true;
  }

  setRail(on) {
    this.rail.visible = on;
    this.gun.visible = !on;
  }

  setVisible(on) {
    this.visible = on;
    this.root.visible = on;
    for (const r of this.rims) r.visible = on;
  }

  fire(strength = 1) {
    this.recoil = Math.min(1.4, this.recoil + 0.55 * strength);
    this.flashT = 0.045 + 0.02 * strength;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.42 + Math.random() * 0.22 * strength;
    this.flash.scale.setScalar(s);
    this.flashB.scale.set(s * 1.15, s * 0.4, 1);
  }

  /**
   * Points the gun at a world target (or along a camera-space direction when target is null).
   * @param {number} dt @param {THREE.Vector3} target world point under the crosshair
   */
  update(dt, target, reloadProgress = 0) {
    const cam = this.camera;
    // Aim: direction from the gun pivot to the target, in root space
    this.root.updateMatrixWorld(true);
    _v.copy(target);
    _m.copy(this.root.matrixWorld).invert();
    _v.applyMatrix4(_m);
    // Gun's +z must point at the target: yaw about y, pitch about x
    const yaw = Math.atan2(_v.x, _v.z);
    const pitch = -Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    this.yaw += (yaw - this.yaw) * Math.min(1, dt * 18);
    this.pitch += (pitch - this.pitch) * Math.min(1, dt * 18);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.reload = reloadProgress;
    const rl = reloadProgress > 0 ? Math.sin(Math.min(1, reloadProgress) * Math.PI) : 0;
    this.pivot.rotation.set(this.pitch - this.recoil * 0.06 + rl * 0.5, this.yaw + rl * 0.25, rl * 0.35, 'YXZ');
    this.pivot.position.set(rl * 0.05, -rl * 0.12 + Math.sin(performance.now() * 0.004) * 0.003, -this.recoil * 0.07);
    // Flash
    this.flashT -= dt;
    const on = this.flashT > 0 && this.visible;
    this.flash.visible = on;
    this.flashB.visible = on;
    this.light.intensity = on ? 0.85 : 0;
    void cam;
  }

  /** World position of the muzzle (tracers start here) */
  muzzleWorld(out) {
    this.pivot.updateWorldMatrix(true, false);
    return out.copy(MUZZLE).applyMatrix4(this.pivot.matrixWorld);
  }

  /** World direction the barrel points */
  barrelDir(out) {
    this.pivot.getWorldQuaternion(_q);
    return out.copy(FWD).applyQuaternion(_q);
  }
}

export { GunnerView };
