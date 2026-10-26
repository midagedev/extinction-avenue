import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { createTaxiModel } from '../controllers.js';

// js/game/player.js
// Unit 77: the armored cab. It drives itself along the patrol route (route.js) — fully on rails, the player never
// steers. The director sets the cruise speed (fast chases, stops in combat zones) and the lane. The player rides in
// the roof hatch as the rear gunner (camera.js + gunner.js); support weapons bolted to the body appear as they are
// acquired, so the build is visible at the edges of the first-person view and in the third-person shots.

function createPropMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.35, flatShading: true });
  mat.colorNode = attribute('color', 'vec3');
  mat.emissiveNode = attribute('emissive', 'vec3');
  return mat;
}

class Player {
  constructor(scene, assets, route, livery = null) {
    this.scene = scene;
    this.route = route;
    const car = createTaxiModel(scene, livery);
    this.car = car;
    this.mesh = car.mesh;
    this.mesh.name = 'Unit77';
    this.propMaterial = createPropMaterial();
    const mk = (id, parent, x, y, z, ry = 0, s = 1) => {
      const m = new THREE.Mesh(assets.get(id).geometry, this.propMaterial);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.scale.setScalar(s);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const chassis = car.chassisPivot;
    // Rear-deck gun ring and roll bar where the gunner stands (the tail gun itself is the first-person view model)
    this.mount = mk('tailMount', chassis, 0, 1.38, -0.62);
    // Third-person stand-in for the tail gun (seen in cinematics / title / death orbit)
    this.tailGun = mk('turretGun', chassis, 0, 1.92, -0.75, Math.PI, 0.9);
    // Build attachments (hidden until acquired), placed to face the pursuers behind the cab
    this.attachments = {
      gatling: [mk('attGatling', chassis, 0.72, 1.36, -0.95, Math.PI), mk('attGatling', chassis, -0.72, 1.36, -0.95, Math.PI)],
      missiles: [mk('attMissiles', chassis, -0.48, 0.98, -1.75, Math.PI, 0.8)],
      tesla: [mk('attTesla', chassis, 0.52, 0.98, -1.75)],
      flamer: [mk('attFlamer', chassis, 0, 0.42, -2.3)],
      shotgun: [mk('attShotgun', chassis, 0, 0.55, -2.32, Math.PI)],
      ram: [mk('attPlow', chassis, 0, 0, 2.25)],
      armor: [mk('attArmor', chassis, 0, 0, 0)]
    };
    for (const list of Object.values(this.attachments)) for (const m of list) m.visible = false;
    this.gatlingMuzzles = [new THREE.Vector3(0.72, 1.46, -1.5), new THREE.Vector3(-0.72, 1.46, -1.5)];
    this.sample = {};
    this.reset(0);
  }

  reset(s) {
    this.s = s;
    this.d = 0;
    this.laneTarget = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.boosting = false;
    this.braking = false;
    this.alive = true;
    this.accel = 0;
    this.wheelSpin = 0;
    this.roll = 0;
    this.pitch = 0;
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.vd = 0;
    this.heading = 0;
    this.routeHeading = 0;
    this.fx = 0; this.fz = 1; this.rx = -1; this.rz = 0;
    this.mesh.visible = true;
    this.stats = { maxHp: 100, armor: 0, regen: 0, magnet: 1 };
    this.updatePose(0);
  }

  get dead() {
    return !this.alive;
  }

  /** Reflects owned weapons / passives on the car body */
  setBuild(owned) {
    const has = (id) => owned.has(id);
    this.attachments.gatling.forEach((m) => { m.visible = has('gatling') || has('storm_gatling'); });
    this.attachments.missiles[0].visible = has('missiles') || has('cluster');
    this.attachments.tesla[0].visible = has('tesla') || has('thunder');
    this.attachments.flamer[0].visible = has('flamer') || has('inferno');
    this.attachments.shotgun[0].visible = has('shotgun') || has('dragon');
    this.attachments.ram[0].visible = has('ram');
    this.attachments.armor[0].visible = has('armor');
  }

  /**
   * @param {number} dt
   * @param {number} cruise target speed along the route (m/s), set by the director
   */
  update(dt, cruise = 14) {
    const st = this.stats;
    const r = this.route.sample(this.s, this.sample);
    this.targetSpeed = !this.alive ? 0 : cruise;
    const prev = this.speed;
    const rate = this.speed < this.targetSpeed ? 6 : 9;
    this.speed += Math.sign(this.targetSpeed - this.speed) * Math.min(Math.abs(this.targetSpeed - this.speed), rate * dt);
    this.accel = (this.speed - prev) / Math.max(dt, 1e-4);
    this.braking = this.accel < -2 || this.speed < 0.5;

    // Scripted lane changes (smooth), clamped to the roadway
    const limit = Math.max(0.5, r.halfWidth - 2);
    const lane = THREE.MathUtils.clamp(this.laneTarget, -limit, limit);
    const targetVd = THREE.MathUtils.clamp((lane - this.d) * 1.5, -3, 3);
    this.vd += (targetVd - this.vd) * Math.min(1, dt * 3);
    this.d = THREE.MathUtils.clamp(this.d + this.vd * dt, -limit, limit);

    this.s = this.route.wrap(this.s + this.speed * dt);
    this.route.sample(this.s, r);
    const px = this.x, pz = this.z;
    this.x = r.x + r.rx * this.d;
    this.z = r.z + r.rz * this.d;
    this.vx = (this.x - px) / Math.max(dt, 1e-4);
    this.vz = (this.z - pz) / Math.max(dt, 1e-4);
    if (Math.hypot(this.vx, this.vz) > 80 || dt === 0) { this.vx = r.hx * this.speed; this.vz = r.hz * this.speed; }
    this.routeHeading = r.heading;
    this.heading = r.heading - Math.atan2(this.vd, Math.max(this.speed, 5)) * 0.85;
    this.fx = Math.sin(this.heading);
    this.fz = Math.cos(this.heading);
    this.rx = -this.fz;
    this.rz = this.fx;

    // Health
    if (this.alive && st.regen > 0) this.hp = Math.min(this.maxHp, this.hp + st.regen * dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    this.updatePose(dt);
  }

  updatePose(dt) {
    const car = this.car;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    // Chassis: roll into lane changes, squat on acceleration, nose-dive on braking
    const targetRoll = THREE.MathUtils.clamp(-this.vd * 0.02, -0.06, 0.06);
    const targetPitch = THREE.MathUtils.clamp(-this.accel * 0.004, -0.04, 0.04);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 6);
    car.chassisPivot.rotation.z = this.roll;
    car.chassisPivot.rotation.x = this.pitch;
    this.wheelSpin = (this.wheelSpin + (this.speed / 0.35) * dt) % (Math.PI * 2);
    for (const w of car.wheels) {
      w.tire.rotation.x = this.wheelSpin + (w.isFront ? 0 : 0.55);
      if (w.isFront) w.steerPivot.rotation.y = THREE.MathUtils.clamp(-this.vd * 0.08, -0.3, 0.3);
    }
    if (car.carState) car.carState.value.x = this.braking ? 1 : 0;
    this.mesh.updateMatrixWorld(true);
  }

  /** Local car-space point → world */
  toWorld(local, out) {
    return out.copy(local).applyMatrix4(this.mesh.matrixWorld);
  }

  hurt(amount) {
    if (!this.alive || this.invuln > 0) return 0;
    const dealt = Math.max(1, amount - this.stats.armor);
    this.hp -= dealt;
    this.invuln = 0.45;
    this.hurtFlash = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return dealt;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  revive() {
    this.alive = true;
    this.hp = this.maxHp;
    this.invuln = 3;
    this.hurtFlash = 0;
  }
}

export { Player, createPropMaterial };
