import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { createTaxiModel } from '../controllers.js';

// js/game/player.js
// Unit 77: the armored taxi. It rides the patrol route (route.js) "on rails": the player steers its lateral position
// within the roadway and works the throttle (nitro boost / brake); the roof cannon turret tracks the mouse aim.
// Weapon attachments appear on the body as they're acquired, so the build is visible in screenshots.

const _v = new THREE.Vector3();

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
    const mk = (id, parent, x, y, z, ry = 0, sx = 1) => {
      const m = new THREE.Mesh(assets.get(id).geometry, this.propMaterial);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.scale.x = sx;
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const chassis = car.chassisPivot;
    // Roof turret: base on a short mast above the taxi sign, yaw group, pitch group, gun
    this.turretBase = mk('turretBase', chassis, 0, 1.5, -0.62);
    this.turretYaw = new THREE.Group();
    this.turretYaw.position.set(0, 1.98, -0.62);
    chassis.add(this.turretYaw);
    this.turretPitch = new THREE.Group();
    this.turretYaw.add(this.turretPitch);
    this.turretGun = mk('turretGun', this.turretPitch, 0, 0, 0);
    this.railGun = mk('railGun', this.turretPitch, 0, 0, 0);
    this.railGun.visible = false;
    this.recoil = 0;
    // Build attachments (hidden until acquired)
    this.attachments = {
      gatling: [mk('attGatling', chassis, 0.62, 0.86, 1.25), mk('attGatling', chassis, -0.62, 0.86, 1.25)],
      missiles: [mk('attMissiles', chassis, 0, 0.95, -1.95)],
      tesla: [mk('attTesla', chassis, 0.55, 0.95, -1.75)],
      flamer: [mk('attFlamer', chassis, 0, 0.42, -2.3)],
      shotgun: [mk('attShotgun', chassis, 0, 0.36, 2.32)],
      ram: [mk('attPlow', chassis, 0, 0, 2.25)],
      armor: [mk('attArmor', chassis, 0, 0, 0)]
    };
    for (const list of Object.values(this.attachments)) for (const m of list) m.visible = false;
    // The missile pod sits left of the tesla spire on the trunk
    this.attachments.missiles[0].position.x = -0.35;
    this.attachments.missiles[0].scale.setScalar(0.8);
    this.muzzleLocal = new THREE.Vector3(0, 0.05, 1.5);
    this.gatlingMuzzles = [new THREE.Vector3(0.62, 0.96, 1.8), new THREE.Vector3(-0.62, 0.96, 1.8)];
    this.sample = {};
    this.reset(0);
  }

  reset(s) {
    this.s = s;
    this.d = 2.5;
    this.vd = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.nitro = 1;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.boosting = false;
    this.braking = false;
    this.alive = true;
    this.accel = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.wheelSpin = 0;
    this.roll = 0;
    this.pitch = 0;
    this.steerVis = 0;
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.heading = 0;
    this.fx = 0; this.fz = 1; this.rx = -1; this.rz = 0;
    this.edgeScrape = 0;
    this.autoDrive = false;
    this.mesh.visible = true;
    this.stats = { maxHp: 100, armor: 0, speedMult: 1, regen: 0, ram: 1, magnet: 1 };
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
    this.railGun.visible = has('railgun');
    this.turretGun.visible = !has('railgun');
  }

  /**
   * @param {number} dt
   * @param {object} input { steer -1..1, boost bool, brake bool }
   * @param {number} cruise base cruise speed (m/s) from the director
   */
  update(dt, input, cruise = 15) {
    const st = this.stats;
    const r = this.route.sample(this.s, this.sample);
    let steer = this.alive ? input.steer : 0;
    let boost = this.alive && input.boost && this.nitro > 0.02;
    let brake = this.alive && input.brake;
    if (this.autoDrive) { steer = 0; boost = false; brake = false; }
    this.boosting = boost;
    this.braking = brake;
    const top = (boost ? 28 : cruise) * st.speedMult;
    this.targetSpeed = !this.alive ? 0 : brake ? 3 : top;
    const prev = this.speed;
    const rate = this.speed < this.targetSpeed ? (boost ? 16 : 7) : brake || !this.alive ? 18 : 5;
    this.speed += Math.sign(this.targetSpeed - this.speed) * Math.min(Math.abs(this.targetSpeed - this.speed), rate * dt);
    this.accel = (this.speed - prev) / Math.max(dt, 1e-4);
    if (boost) this.nitro = Math.max(0, this.nitro - dt * 0.28);
    else this.nitro = Math.min(1, this.nitro + dt * 0.075);

    // Lateral control within the roadway (route corners narrow the usable half-width a little)
    const limit = Math.max(1.2, r.halfWidth - 1.25);
    const latMax = 12 * Math.sqrt(st.speedMult);
    const targetVd = steer * latMax;
    this.vd += (targetVd - this.vd) * Math.min(1, dt * 7);
    this.d += this.vd * dt;
    this.edgeScrape = 0;
    if (this.d > limit) { this.d = limit; if (this.vd > 0) { this.edgeScrape = this.vd; this.vd *= -0.25; } }
    if (this.d < -limit) { this.d = -limit; if (this.vd < 0) { this.edgeScrape = -this.vd; this.vd *= -0.25; } }

    this.s = this.route.wrap(this.s + this.speed * dt);
    this.route.sample(this.s, r);
    const px = this.x, pz = this.z;
    this.x = r.x + r.rx * this.d;
    this.z = r.z + r.rz * this.d;
    this.vx = (this.x - px) / Math.max(dt, 1e-4);
    this.vz = (this.z - pz) / Math.max(dt, 1e-4);
    if (Math.hypot(this.vx, this.vz) > 80) { this.vx = r.hx * this.speed; this.vz = r.hz * this.speed; }
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
    // Chassis: roll into lateral moves, squat on acceleration, nose-dive on braking
    const targetRoll = THREE.MathUtils.clamp(-this.vd * 0.012, -0.07, 0.07);
    const targetPitch = THREE.MathUtils.clamp(-this.accel * 0.004, -0.05, 0.05);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 6);
    car.chassisPivot.rotation.z = this.roll;
    car.chassisPivot.rotation.x = this.pitch;
    this.wheelSpin = (this.wheelSpin + (this.speed / 0.35) * dt) % (Math.PI * 2);
    this.steerVis += (THREE.MathUtils.clamp(-this.vd * 0.05, -0.45, 0.45) - this.steerVis) * Math.min(1, dt * 10);
    for (const w of car.wheels) {
      w.tire.rotation.x = this.wheelSpin + (w.isFront ? 0 : 0.55);
      if (w.isFront) w.steerPivot.rotation.y = this.steerVis;
    }
    if (car.carState) car.carState.value.x = this.braking || this.speed < 0.5 ? 1 : 0;
    // Turret
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.turretYaw.rotation.y = this.aimYaw;
    this.turretPitch.rotation.x = this.aimPitch;
    this.turretGun.position.z = -this.recoil * 0.25;
    this.railGun.position.z = -this.recoil * 0.3;
    this.mesh.updateMatrixWorld(true);
  }

  /** Points the turret at a world target (yaw relative to the car, pitch clamped) */
  aimAt(x, y, z, dt) {
    this.turretYaw.updateWorldMatrix(true, false);
    const tp = this.turretYaw.getWorldPosition(_v);
    const dx = x - tp.x, dy = y - tp.y, dz = z - tp.z;
    const worldYaw = Math.atan2(dx, dz);
    let yaw = worldYaw - this.heading;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const pitch = THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.6, 0.35);
    // Smooth slew (fast but not instant so it feels mechanical)
    let dyaw = yaw - this.aimYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.aimYaw += dyaw * Math.min(1, dt * 22);
    this.aimPitch += (pitch - this.aimPitch) * Math.min(1, dt * 22);
  }

  /** World position of the cannon muzzle and its direction */
  muzzle(outPos, outDir) {
    const gun = this.railGun.visible ? this.railGun : this.turretGun;
    gun.updateWorldMatrix(true, false);
    outPos.copy(this.muzzleLocal);
    if (gun === this.railGun) outPos.z = 1.9;
    outPos.applyMatrix4(gun.matrixWorld);
    outDir.set(0, 0, 1).transformDirection(gun.matrixWorld);
    return outPos;
  }

  /** Local car-space point → world */
  toWorld(local, out) {
    return out.copy(local).applyMatrix4(this.mesh.matrixWorld);
  }

  hurt(amount) {
    if (!this.alive || this.invuln > 0) return 0;
    const dealt = Math.max(1, amount - this.stats.armor);
    this.hp -= dealt;
    this.invuln = 0.6;
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
}

export { Player, createPropMaterial };
