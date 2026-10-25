import * as THREE from 'three/webgpu';

// js/game/camera.js
// Game camera rig: a high chase view that reads the swarm, a reverse "getaway" view for the T. rex chase (camera
// ahead of the car looking back at the car with the boss behind it), scripted cinematic moves (intro, boss roar,
// boss death orbit), and trauma-based screen shake.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function damp(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

class GameCamera {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.35, 60000);
    this.mode = 'title';
    this.pos = new THREE.Vector3(0, 60, 300);
    this.look = new THREE.Vector3(0, 0, 0);
    this.fov = 58;
    this.trauma = 0;
    this.shakeScale = 1;
    this.time = 0;
    this.headingS = 0; // smoothed route heading
    this.blend = 1; // mode blend (1 = settled)
    this.cine = null;
    this.reverseAmt = 0;
    this.fovKick = 0;
    this.lookAhead = 0;
  }

  addTrauma(t) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  setMode(mode, snap = false) {
    this.mode = mode;
    if (snap) this.snap = true;
  }

  /** Scripted shot: keyframes [{ pos, look, fov, t }] interpolated with smoothstep; holds the last one */
  playCinematic(keys, onDone = null) {
    this.cine = { keys, time: 0, onDone };
    this.mode = 'cinematic';
  }

  /** Orbit around a (possibly moving) target: used for the title attract mode and the boss death */
  orbit(target, radius, height, speed, angle = 0, fov = 50) {
    this.mode = 'orbit';
    this.orbitState = { target, radius, height, speed, angle, fov };
  }

  update(dt, player) {
    this.time += dt;
    const cam = this.camera;
    let desiredPos = _a, desiredLook = _b;
    let fov = 58;
    let lambda = 6;
    if (this.mode === 'chase' || this.mode === 'reverse') {
      // Smooth the route heading so the camera swings gently through corners
      let dh = player.routeHeading - this.headingS;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.headingS += dh * (1 - Math.exp(-3.2 * dt));
      if (this.snap) this.headingS = player.routeHeading;
      const fx = Math.sin(this.headingS), fz = Math.cos(this.headingS);
      const rx = -fz, rz = fx;
      this.reverseAmt = damp(this.reverseAmt, this.mode === 'reverse' ? 1 : 0, 2.2, dt);
      const rev = this.reverseAmt;
      const lat = player.d * 0.55;
      const speedK = THREE.MathUtils.clamp(player.speed / 28, 0, 1);
      // Chase: high and behind; looks well ahead so oncoming swarms are visible early
      const back = 12.5 + speedK * 2.5;
      const up = 7.4 + speedK * 0.8;
      const cx = player.x - rx * (player.d - lat);
      const cz = player.z - rz * (player.d - lat);
      const chasePos = [cx - fx * back, up, cz - fz * back];
      const chaseLook = [player.x + fx * 16, 0.6, player.z + fz * 16];
      // Reverse: ahead of the car, low, looking back down the avenue at the car and whatever chases it
      const revPos = [cx + fx * 10.5, 4.6, cz + fz * 10.5];
      const revLook = [player.x - fx * 16, 2.6, player.z - fz * 16];
      desiredPos.set(
        chasePos[0] + (revPos[0] - chasePos[0]) * rev,
        chasePos[1] + (revPos[1] - chasePos[1]) * rev + Math.sin(rev * Math.PI) * 4,
        chasePos[2] + (revPos[2] - chasePos[2]) * rev
      );
      // Swing around the side of the car while transitioning rather than through it
      if (rev > 0.02 && rev < 0.98) {
        const side = Math.sin(rev * Math.PI) * 9;
        desiredPos.x += rx * side;
        desiredPos.z += rz * side;
      }
      desiredLook.set(
        chaseLook[0] + (revLook[0] - chaseLook[0]) * rev,
        chaseLook[1] + (revLook[1] - chaseLook[1]) * rev,
        chaseLook[2] + (revLook[2] - chaseLook[2]) * rev
      );
      fov = 60 + (player.boosting ? 9 : 0) + rev * -4;
      lambda = 7;
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

    if (this.snap) {
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
    this.fov = damp(this.fov, fov + this.fovKick, 4, dt);
    this.fovKick = damp(this.fovKick, 0, 5, dt);

    // Trauma shake (squared for a punchy falloff)
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const sh = this.trauma * this.trauma * this.shakeScale;
    const t = this.time * 32;
    cam.position.set(
      this.pos.x + sh * 0.7 * (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5),
      this.pos.y + sh * 0.5 * (Math.sin(t * 1.7 + 1) + Math.sin(t * 2.9) * 0.5),
      this.pos.z + sh * 0.7 * (Math.sin(t * 1.3 + 2) + Math.sin(t * 3.1) * 0.5)
    );
    cam.lookAt(this.look);
    cam.rotateZ(sh * 0.05 * Math.sin(t * 0.9));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  onResize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Ground-plane point under the screen position (NDC), at height y */
  aimPoint(ndcX, ndcY, y, out) {
    _ndc.set(ndcX, ndcY);
    _ray.setFromCamera(_ndc, this.camera);
    _plane.constant = -y;
    if (!_ray.ray.intersectPlane(_plane, out)) {
      out.copy(_ray.ray.direction).multiplyScalar(200).add(_ray.ray.origin);
      out.y = y;
    }
    return out;
  }

  /** Screen-space NDC of a world point (z > 1 = behind) */
  project(x, y, z, out) {
    return out.set(x, y, z).project(this.camera);
  }
}

export { GameCamera };
