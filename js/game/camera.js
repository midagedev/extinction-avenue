import * as THREE from 'three/webgpu';

// js/game/camera.js
// Game camera rig. The game is played from the GUNNER seat: a first-person camera standing in the roof hatch of
// Unit 77, looking back over the tail gun at whatever is chasing the cab (classic arcade jeep-chase framing). The
// view can be swung by scripted beats (side-street ambush, the T. rex flanking or charging head-on from the front)
// and sways a little toward the crosshair. Scripted cinematic moves (intro, boss reveal) and an orbit (title attract,
// boss death, wreck) are kept for the set pieces; trauma-based shake on top of everything.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// Gunner eye point in car space (x = car left, y = up, z = car forward): standing in the roof hatch, behind the sign
const EYE = { x: 0, y: 2.15, z: -0.4 };
const BASE_PITCH = -0.15; // looking slightly down the road behind the cab
// Vertical FOV of the gunner's view. 64° made the chase read small; 56° frames the street and the pack closer.
const GUNNER_FOV = 56;
// Portrait phones: the vertical FOV is widened so the view keeps some width across, but never past this (an upright
// iPhone, aspect ≈ 0.46, used to get ≈ 92° and the dinosaurs became specks)
const PORTRAIT_MAX_FOV = 68;

function damp(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Vertical FOV for the screen's aspect: below 1.15 (portrait / square) widened to keep ~46° across, capped */
function portraitFov(fov, aspect) {
  if (aspect >= 1.15) return fov;
  const keepAcross = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(Math.min(fov, 56) * 0.82 / 2)) / aspect) * 180 / Math.PI;
  return Math.max(fov, Math.min(keepAcross, PORTRAIT_MAX_FOV));
}

class GameCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(GUNNER_FOV, window.innerWidth / window.innerHeight, 0.08, 60000);
    this.mode = 'title';
    this.pos = new THREE.Vector3(0, 60, 300);
    this.look = new THREE.Vector3(0, 0, 0);
    this.fov = GUNNER_FOV;
    this.trauma = 0;
    this.shakeScale = 1;
    this.time = 0;
    this.headingS = 0; // smoothed car heading
    this.cine = null;
    this.fovKick = 0;
    // Gunner view state
    this.swingYaw = 0; // scripted swing relative to "looking back" (π = facing forward over the hood)
    this.swingTarget = 0;
    this.swingPitch = 0;
    this.swingPitchTarget = 0;
    this.swingRate = 3;
    this.swingHold = 0;
    this.sway = { x: 0, y: 0 }; // crosshair-driven look sway (NDC)
    this.kick = 0; // recoil pitch kick (radians)
    this.blend = 1; // 0..1 blend from the previous shot into the gunner view
    this.blendFrom = { f: 0, r: 0, y: 0, lf: 0, lr: 0, ly: 0 };
    this.bob = 0;
  }

  addTrauma(t) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  setMode(mode, snap = false) {
    if (mode === 'gunner' && this.mode !== 'gunner' && !snap && this._player) this._captureBlend(this._player);
    if (mode === 'gunner' && snap) this.blend = 1;
    this.mode = mode;
    if (snap) this.snap = true;
  }

  /** Swing the gunner view: yaw relative to looking back (radians, +π/2 = out the car's right side, π = forward over
   *  the hood), optional pitch, rate, and hold time after which it swings back to the rear */
  swing(yaw, pitch = 0, rate = 3, hold = 0) {
    this.swingTarget = yaw;
    this.swingPitchTarget = pitch;
    this.swingRate = rate;
    this.swingHold = hold;
  }

  /** Swing angle (for swing()) that points the gunner view at a world point */
  yawToward(x, z, player) {
    const dx = x - player.x, dz = z - player.z;
    return wrapAngle(Math.atan2(-dx, -dz) - player.heading);
  }

  /** Scripted shot: keyframes [{ pos, look, fov, t }] interpolated with smoothstep; holds the last one */
  playCinematic(keys, onDone = null) {
    this.cine = { keys, time: 0, onDone };
    this.mode = 'cinematic';
  }

  /** Orbit around a (possibly moving) target: used for the title attract mode, the wreck and the boss death */
  orbit(target, radius, height, speed, angle = 0, fov = 50) {
    this.mode = 'orbit';
    this.orbitState = { target, radius, height, speed, angle, fov };
  }

  _carBasis(p) {
    return { fx: Math.sin(this.headingS), fz: Math.cos(this.headingS) };
  }

  _captureBlend(p) {
    // Remember where the camera is in car space, so the blend into the gunner seat travels with the moving cab
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    const rx = -fz, rz = fx;
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    const lx = this.look.x - p.x, lz = this.look.z - p.z;
    this.blendFrom = { f: dx * fx + dz * fz, r: dx * rx + dz * rz, y: this.pos.y, lf: lx * fx + lz * fz, lr: lx * rx + lz * rz, ly: this.look.y, fov: this.fov };
    this.blend = 0;
    this.headingS = p.heading;
  }

  /** Gunner eye position and look direction (world) for the current car pose */
  gunnerPose(p, outPos, outDir) {
    const h = this.headingS;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = -fz, rz = fx;
    outPos.set(p.x + fx * EYE.z + rx * EYE.x, EYE.y + this.bob, p.z + fz * EYE.z + rz * EYE.x);
    const yaw = h + this.swingYaw + this.sway.x * -0.1;
    const pitch = BASE_PITCH + this.swingPitch + this.sway.y * 0.06 + this.kick;
    // Camera yaw θ looks toward (-sin θ, -cos θ): θ = car heading looks straight back
    _e.set(pitch, yaw, 0, 'YXZ');
    outDir.set(0, 0, -1).applyEuler(_e);
    return outPos;
  }

  update(dt, player) {
    this._player = player;
    this.time += dt;
    const cam = this.camera;
    const desiredPos = _a, desiredLook = _b;
    let fov = 58;
    let lambda = 6;
    let rigid = false;
    if (this.mode === 'gunner') {
      // Smooth the car heading a little: the turret has some inertia through corners
      const dh = wrapAngle(player.heading - this.headingS);
      this.headingS += dh * (1 - Math.exp(-7 * dt));
      if (this.snap) this.headingS = player.heading;
      // Scripted swing
      if (this.swingHold > 0) { this.swingHold -= dt; if (this.swingHold <= 0) { this.swingTarget = 0; this.swingPitchTarget = 0; this.swingRate = 2.5; } }
      this.swingYaw += wrapAngle(this.swingTarget - this.swingYaw) * (1 - Math.exp(-this.swingRate * dt));
      this.swingPitch = damp(this.swingPitch, this.swingPitchTarget, this.swingRate, dt);
      this.kick = damp(this.kick, 0, 14, dt);
      // Road rumble / step bob
      const sp = Math.min(1, (player.speed || 0) / 20);
      this.bob = Math.sin(this.time * 11) * 0.012 * sp + Math.sin(this.time * 23.7) * 0.006 * sp;
      this.gunnerPose(player, desiredPos, _c);
      desiredLook.copy(desiredPos).addScaledVector(_c, 20);
      fov = GUNNER_FOV;
      rigid = true;
      if (this.blend < 1) {
        this.blend = Math.min(1, this.blend + dt / 0.85);
        const u = this.blend * this.blend * (3 - 2 * this.blend);
        const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
        const rx = -fz, rz = fx;
        const B = this.blendFrom;
        const px = player.x + fx * B.f + rx * B.r, pz = player.z + fz * B.f + rz * B.r;
        const lx = player.x + fx * B.lf + rx * B.lr, lz = player.z + fz * B.lf + rz * B.lr;
        desiredPos.set(px + (desiredPos.x - px) * u, B.y + (desiredPos.y - B.y) * u, pz + (desiredPos.z - pz) * u);
        desiredLook.set(lx + (desiredLook.x - lx) * u, B.ly + (desiredLook.y - B.ly) * u, lz + (desiredLook.z - lz) * u);
        fov = (B.fov ?? fov) + (fov - (B.fov ?? fov)) * u;
      }
    } else if (this.mode === 'orbit') {
      const o = this.orbitState;
      o.angle += o.speed * dt;
      const t = o.target;
      desiredPos.set(t.x + Math.sin(o.angle) * o.radius, (t.y || 0) + o.height, t.z + Math.cos(o.angle) * o.radius);
      desiredLook.set(t.x, (t.y || 0) + (o.lookY ?? 2), t.z);
      fov = o.fov;
      lambda = o.lambda ?? 2.5;
    } else if (this.mode === 'cinematic' && this.cine) {
      const c = this.cine;
      c.time += dt;
      const keys = c.keys;
      let i = 0;
      while (i < keys.length - 1 && c.time > keys[i + 1].t) i++;
      const k0 = keys[i];
      const k1 = keys[Math.min(i + 1, keys.length - 1)];
      const span = Math.max(1e-3, k1.t - k0.t);
      let u = THREE.MathUtils.clamp((c.time - k0.t) / span, 0, 1);
      u = u * u * (3 - 2 * u);
      const p0 = typeof k0.pos === 'function' ? k0.pos() : k0.pos;
      const p1 = typeof k1.pos === 'function' ? k1.pos() : k1.pos;
      const l0 = typeof k0.look === 'function' ? k0.look() : k0.look;
      const l1 = typeof k1.look === 'function' ? k1.look() : k1.look;
      desiredPos.lerpVectors(p0, p1, u);
      desiredLook.lerpVectors(l0, l1, u);
      fov = (k0.fov ?? 50) + ((k1.fov ?? 50) - (k0.fov ?? 50)) * u;
      lambda = 14;
      if (c.time >= keys[keys.length - 1].t && c.onDone) {
        const done = c.onDone;
        c.onDone = null;
        done();
      }
    } else {
      desiredPos.copy(this.pos);
      desiredLook.copy(this.look);
    }

    if (this.snap || rigid) {
      this.pos.copy(desiredPos);
      this.look.copy(desiredLook);
      this.snap = false;
    } else {
      this.pos.x = damp(this.pos.x, desiredPos.x, lambda, dt);
      this.pos.y = damp(this.pos.y, desiredPos.y, lambda, dt);
      this.pos.z = damp(this.pos.z, desiredPos.z, lambda, dt);
      this.look.x = damp(this.look.x, desiredLook.x, lambda * 1.3, dt);
      this.look.y = damp(this.look.y, desiredLook.y, lambda * 1.3, dt);
      this.look.z = damp(this.look.z, desiredLook.z, lambda * 1.3, dt);
    }
    this.fov = rigid ? fov + this.fovKick : damp(this.fov, fov + this.fovKick, 4, dt);
    this.fovKick = damp(this.fovKick, 0, 5, dt);

    // Trauma shake (squared for a punchy falloff); first person gets mostly rotational shake
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma * this.shakeScale;
    const t = this.time * 32;
    const posK = this.mode === 'gunner' ? 0.12 : 0.7;
    cam.position.set(
      this.pos.x + sh * posK * (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5),
      this.pos.y + sh * posK * 0.7 * (Math.sin(t * 1.7 + 1) + Math.sin(t * 2.9) * 0.5),
      this.pos.z + sh * posK * (Math.sin(t * 1.3 + 2) + Math.sin(t * 3.1) * 0.5)
    );
    const lookK = this.mode === 'gunner' ? 0.9 : 0;
    _c.set(
      this.look.x + sh * lookK * Math.sin(t * 0.83 + 0.3),
      this.look.y + sh * lookK * Math.sin(t * 1.21 + 1.7),
      this.look.z + sh * lookK * Math.sin(t * 0.97 + 2.9)
    );
    cam.lookAt(_c);
    cam.rotateZ(sh * 0.06 * Math.sin(t * 0.9));
    const fovOut = portraitFov(this.fov, cam.aspect);
    if (Math.abs(cam.fov - fovOut) > 0.01) {
      cam.fov = fovOut;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  onResize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Ray through a screen point (NDC) from the current camera */
  ray(ndcX, ndcY) {
    _ndc.set(ndcX, ndcY);
    _ray.setFromCamera(_ndc, this.camera);
    return _ray.ray;
  }

  /** Ground-plane point under the screen position (NDC), at height y */
  aimPoint(ndcX, ndcY, y, out) {
    const ray = this.ray(ndcX, ndcY);
    _plane.constant = -y;
    if (!ray.intersectPlane(_plane, out)) {
      out.copy(ray.direction).multiplyScalar(200).add(ray.origin);
      out.y = y;
    }
    return out;
  }

  /** Screen-space NDC of a world point (z > 1 = behind) */
  project(x, y, z, out) {
    return out.set(x, y, z).project(this.camera);
  }
}

export { GameCamera, EYE as GUNNER_EYE };
