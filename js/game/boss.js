import * as THREE from 'three/webgpu';
import { PropBatch } from './batches.js';
import { setJoint } from './poses.js';

// js/game/boss.js
// GRIDLOCK — Cretagen Apex Specimen T-01, a Tyrannosaurus rex in a cracked containment collar.
//
// The boss lives on the route like the cab: its position is (arc length bs, lateral offset bd), so it can chase the
// car down the avenue through every corner. Three phases (100-66-33 %):
//   1  CHASE      — tails the cab; lunge bites down a telegraphed lane, stomp shockwaves (outrun them with nitro),
//                   hurls wrecked cars at where you'll be.
//   2  ENRAGED    — adds overtake + head-on charges (camera swings back to the chase view), roars up raptor packs.
//   3  DESPERATE  — faster, double lunges, the collar overloads (weak point ×3.5), more wrecks.
// Weak points: the glowing containment collar (×2.5, crits) and the thighs (×1.25). Phase changes stagger it.
// Death: hit-stop, slow motion, orbit camera; it topples, turns to stone, and shatters into a gene-core fountain.
// Also: cameo() — an invulnerable teaser walk-across in the first minute.

const SCALE = 1.55;
const _s = {};
const _v = new THREE.Vector3();
const COLLAR_LOCAL = new THREE.Vector3(0, 0.27, 0.42); // neck-local collar centre (model units, see dino-models.js)
const THIGH_LOCAL = new THREE.Vector3(0, -0.6, 0.2);

class TRexBoss {
  constructor(game, assets) {
    this.game = game;
    this.e = null;
    this.wrecks = [];
    this.wreckBatch = new PropBatch(assets.get('wreck').geometry, 8, { name: 'boss.wrecks', shadow: true });
    this.held = new PropBatch(assets.get('wreck').geometry, 1, { name: 'boss.held' });
    this.collar = new THREE.Vector3();
    this.thighs = [new THREE.Vector3(), new THREE.Vector3()];
    this.headPos = new THREE.Vector3();
    this.active = false;
    this.cameoPending = false;
  }

  meshes() {
    return [this.wreckBatch.mesh, this.held.mesh];
  }

  reset() {
    this.e = null;
    this.active = false;
    this.wrecks.length = 0;
    this.cameoPending = false;
  }

  // ------------------------------------------------------------------------------------------------------------------
  /** Finds a cross street ahead of the car: arc length where both sides are open ground */
  _findIntersection(from, to) {
    const g = this.game;
    for (let s = from; s < to; s += 3) {
      const r = g.route.sample(s, _s);
      let ok = true;
      for (const lat of [-34, -24, -16, 16, 24, 34]) {
        if (g.walk.isBlocked(r.x + r.rx * lat, r.z + r.rz * lat)) { ok = false; break; }
      }
      if (ok) return s + 4;
    }
    return null;
  }

  cameo() {
    const g = this.game;
    if (this.e) return;
    const p = g.player;
    const s = this._findIntersection(p.s + 75, p.s + 150);
    if (s === null) { this.cameoPending = 4; return; }
    const r = g.route.sample(s, _s);
    const side = Math.random() < 0.5 ? 1 : -1;
    const e = g.enemies.spawn('trex', r.x + r.rx * 38 * side, r.z + r.rz * 38 * side, { boss: true, scale: SCALE, ctrl: this, heading: Math.atan2(-r.rx * side, -r.rz * side) });
    if (!e) return;
    e.ghost = true;
    e.mode = 'cameo';
    e.cs = s; e.cside = side; e.cd = 38 * side;
    e.scale = SCALE;
    this.e = e;
    g.audio.play('trex_roar', { volume: 0.7, pitch: 1.0, dur: 2.2 });
    g.cam.addTrauma(0.2);
  }

  start() {
    const g = this.game;
    const p = g.player;
    const old = this.e ? g.enemies.list.indexOf(this.e) : -1;
    if (old >= 0) g.enemies._remove(old);
    this.e = null;
    // Clear the street so the reveal reads: the small fry scatter (despawn), cores fly to the cab
    for (let i = g.enemies.list.length - 1; i >= 0; i--) {
      const o = g.enemies.list[i];
      if (o.boss || o.miniboss) continue;
      if (Math.hypot(o.x - p.x, o.z - p.z) < 90) g.enemies._remove(i);
    }
    g.pickups.collectAll();
    const bs = p.s - 34;
    const r = g.route.sample(bs, _s);
    const e = g.enemies.spawn('trex', r.x, r.z, { boss: true, scale: SCALE, ctrl: this, heading: r.heading, hpMult: 1 });
    if (!e) return;
    e.scale = SCALE;
    e.maxHp = e.hp = 30000 * (1 + Math.max(0, g.director.time - 450) / 600);
    e.mode = 'intro';
    e.bs = bs;
    e.bd = 0;
    e.phase = 1;
    e.v = 0;
    e.atkCd = 2.5;
    e.legDmg = 0;
    e.combo = 0;
    e.name = 'GRIDLOCK';
    this.e = e;
    this.active = true;
    // Bursting out: dust + shake
    for (let k = 0; k < 6; k++) g.vfx.dust(r.x + (Math.random() - 0.5) * 10, r.z + (Math.random() - 0.5) * 10, 3, 4);
    g.cam.addTrauma(0.8);
    g.audio.play('shatter_big', { volume: 1, pitch: 0.5 });
    g.audio.play('trex_roar', { volume: 1.2, pitch: 0.92, dur: 3.0 });
    g.audio.setMusic('boss');
    g.bossIntro(e);
  }

  /** Called by the weapons on every hit: damage multiplier for weak points (1 = none) */
  weakHit(e, x, y, z) {
    if (e !== this.e || e.mode === 'cameo') return 1;
    const r = 1.9 * SCALE * 0.75;
    if ((x - this.collar.x) ** 2 + (y - this.collar.y) ** 2 + (z - this.collar.z) ** 2 < r * r) {
      this.collarHits = (this.collarHits || 0) + 1;
      return e.phase >= 3 ? 3.5 : 2.5;
    }
    for (const t of this.thighs) {
      if ((x - t.x) ** 2 + (y - t.y) ** 2 + (z - t.z) ** 2 < (1.4 * SCALE) ** 2) {
        e.legDmg += 1;
        return 1.25;
      }
    }
    return 1;
  }

  // ------------------------------------------------------------------------------------------------------------------
  /** EnemyManager hands control of the entity here every frame; return 'remove' to despawn */
  updateEntity(e, dt) {
    const g = this.game;
    e.animT += dt;
    e.stateT += dt;
    e.flash = Math.max(0, e.flash - dt * 10);
    e.jaw = Math.max(0, e.jaw - dt * 1.5);
    if (e.mode === 'cameo') return this._cameo(e, dt);
    if (e.state === 'dying') return this._death(e, dt);
    const p = g.player;
    const route = g.route;
    const gap = route.delta(p.s, e.bs);
    const hp = e.hp / e.maxHp;
    // Phase changes
    if (e.phase === 1 && hp < 0.66) this._phase(e, 2);
    else if (e.phase === 2 && hp < 0.33) this._phase(e, 3);
    const P = e.phase;
    const fast = P === 3 ? 1.25 : P === 2 ? 1.1 : 1;
    let desiredGap = P === 1 ? -17 : -14;
    let lateralTarget = p.d * 0.7;
    let reverseHeading = false;
    let speedOverride = null;
    e.atkCd -= dt;

    switch (e.mode) {
      case 'intro':
        // Stand and roar behind the car, then give chase
        // (runs in slow motion under the reveal cinematic: ~1 s of game time ≈ 3.5 s on screen)
        speedOverride = e.stateT < 1.0 ? 0 : null;
        e.roar = e.stateT < 1.15 ? Math.min(1, e.stateT * 4) : 0;
        if (e.stateT > 1.4) { this._set(e, 'chase'); e.atkCd = 2.2; }
        break;
      case 'chase':
        if (e.atkCd <= 0 && gap < -8 && gap > -40) this._chooseAttack(e, gap);
        break;
      case 'lunge_tele': {
        // Lane locked at the car's lateral position; head low, jaws opening
        const T = (P === 3 ? 0.6 : 0.85);
        desiredGap = -13;
        lateralTarget = e.laneD;
        this._lane(e, e.laneD, e.stateT / T, -1);
        e.crouch = Math.min(1, e.stateT / T);
        e.jaw = 0.5;
        if (e.stateT > T) { this._set(e, 'lunge'); g.audio.play('trex_roar', { x: e.x, z: e.z, volume: 0.7, pitch: 1.3, dur: 0.8 }); }
        break;
      }
      case 'lunge': {
        // Snap forward: the head reaches past the car's lane position
        desiredGap = 1;
        lateralTarget = e.laneD;
        speedOverride = p.speed + 38;
        e.crouch = 0;
        e.lungeAmt = Math.min(1, e.stateT / 0.25);
        e.jaw = e.stateT < 0.2 ? 1 : 0;
        if (!e.bit && e.stateT > 0.22) {
          e.bit = true;
          g.audio.play('bite', { x: e.x, z: e.z, volume: 1, pitch: 0.55 });
          g.cam.addTrauma(0.25);
          if (Math.abs(p.d - e.laneD) < 2.6 && gap > -12) g.hurtPlayer(24 * g.enemies.dmgMult, e.x, e.z, 'bite');
        }
        if (e.stateT > 0.55) {
          e.lungeAmt = 0;
          if (P === 3 && e.combo < 1) { e.combo++; e.laneD = p.d; this._set(e, 'lunge_tele'); e.stateT = 0.3; }
          else { e.combo = 0; this._set(e, 'chase'); e.atkCd = 1.6 / fast; }
        }
        break;
      }
      case 'stomp_tele': {
        const T = 1.15;
        desiredGap = -16;
        e.rear = Math.min(1, e.stateT / T);
        const R = 26;
        g.vfx.telegraphCircle(e.x, e.z, R, e.stateT / T, 6, 0.5, 0.15);
        if (e.stateT > 0.3) g.hud.prompt('BOOST!', 'nitro');
        if (e.stateT > T) {
          e.rear = 0;
          g.audio.play('stomp', { volume: 1.3, pitch: 0.5 });
          g.audio.play('explosion', { x: e.x, z: e.z, volume: 0.8, pitch: 0.5, big: true });
          g.vfx.shockwave(e.x, e.z, R, 6, 3, 1, 0.7);
          g.vfx.shockwave(e.x, e.z, R * 0.6, 4, 2, 0.6, 0.5);
          for (let k = 0; k < 10; k++) g.vfx.dust(e.x + (Math.random() - 0.5) * R, e.z + (Math.random() - 0.5) * R, 2.5, 2);
          g.cam.addTrauma(0.7);
          if (Math.hypot(p.x - e.x, p.z - e.z) < R + 1) g.hurtPlayer(20 * g.enemies.dmgMult, e.x, e.z, 'stomp');
          // Shockwave tramples small dinosaurs too
          g.weapons.blast(e.x, e.z, R, 80, 0, 'boss', false);
          this._set(e, 'chase');
          e.atkCd = 1.8 / fast;
        }
        break;
      }
      case 'throw': {
        desiredGap = -24;
        e.holding = e.stateT < 0.7;
        e.throwAmt = Math.min(1, e.stateT / 0.7);
        if (!e.thrown && e.stateT > 0.7) {
          e.thrown = true;
          const n = P === 3 ? 3 : P === 2 ? 2 : 1;
          for (let k = 0; k < n; k++) this._throwWreck(e, k);
          g.audio.play('tail_swipe', { x: e.x, z: e.z, volume: 1, pitch: 0.6 });
        }
        if (e.stateT > 1.2) { this._set(e, 'chase'); e.atkCd = 1.4 / fast; e.throwAmt = 0; }
        break;
      }
      case 'roar':
        speedOverride = p.speed * 0.8;
        e.roar = Math.min(1, e.stateT * 3);
        if (!e.summoned && e.stateT > 0.4) {
          e.summoned = true;
          g.audio.play('trex_roar', { volume: 1.1, pitch: 0.95, dur: 2.2 });
          g.vfx.shockwave(e.x, e.z, 18, 3, 1.2, 0.4, 0.8);
          g.cam.addTrauma(0.45);
          const n = P === 3 ? 9 : 6;
          for (let k = 0; k < n; k++) g.director.spawnGroup(k % 3 === 0 && P === 3 ? 'brute' : 'raptor', 1, k % 2 ? 'side' : 'ahead');
        }
        if (e.stateT > 2.0) { e.roar = 0; this._set(e, 'chase'); e.atkCd = 1.2; }
        break;
      case 'overtake':
        // Sprint past the car on one side, get well ahead
        desiredGap = 50;
        lateralTarget = e.passSide * 6;
        speedOverride = p.speed + 22;
        if (gap > 42) { this._set(e, 'turn'); }
        break;
      case 'turn':
        speedOverride = p.speed;
        desiredGap = 48;
        e.turnAmt = Math.min(1, e.stateT / 0.6);
        reverseHeading = e.turnAmt > 0.5;
        if (e.stateT > 0.6) { e.laneD = p.d; this._set(e, 'charge_tele'); g.audio.play('trike_bellow', { x: e.x, z: e.z, volume: 1, pitch: 0.55 }); }
        break;
      case 'charge_tele': {
        reverseHeading = true;
        speedOverride = p.speed;
        lateralTarget = e.laneD;
        const T = P === 3 ? 0.9 : 1.15;
        this._lane(e, e.laneD, e.stateT / T, 1);
        e.crouch = Math.min(1, e.stateT / T) * 0.6;
        if (e.stateT > 0.3) g.hud.prompt('DODGE!', 'dodge');
        if (e.stateT > T) { this._set(e, 'charge'); e.crouch = 0; }
        break;
      }
      case 'charge':
        reverseHeading = true;
        lateralTarget = e.laneD;
        speedOverride = p.speed - 30; // closes at 30 m/s relative
        e.jaw = 0.8;
        if (!e.bit && Math.abs(gap) < 4) {
          e.bit = true;
          if (Math.abs(p.d - e.bd) < 3.4) {
            g.hurtPlayer(30 * g.enemies.dmgMult, e.x, e.z, 'charge');
            p.vd += (p.d > e.bd ? 1 : -1) * 14;
            p.speed *= 0.5;
          } else {
            g.hud.prompt('CLOSE CALL!', 'good');
            g.addScore(1500, 'Near miss');
          }
          g.cam.addTrauma(0.6);
          g.audio.play('stomp', { volume: 1, pitch: 0.6 });
        }
        if (gap < -30) { this._set(e, 'turnback'); }
        break;
      case 'turnback':
        speedOverride = p.speed + 4;
        e.turnAmt = 1 - Math.min(1, e.stateT / 0.6);
        reverseHeading = e.turnAmt > 0.5;
        if (e.stateT > 0.6) { this._set(e, 'chase'); e.atkCd = 1.2; e.turnAmt = 0; }
        break;
      case 'stagger':
        speedOverride = p.speed * 0.4;
        e.staggerAmt = Math.sin(Math.min(1, e.stateT / 1.6) * Math.PI);
        if (e.stateT > 1.6) {
          e.staggerAmt = 0;
          this._set(e, 'roar');
          e.summoned = false;
        }
        break;
    }

    // Movement along the route: close the gap to the desired one
    const err = desiredGap - gap;
    const target = speedOverride ?? p.speed + THREE.MathUtils.clamp(err * 1.6, -10, 14) * fast;
    e.v += (target - e.v) * Math.min(1, dt * (e.mode === 'lunge' || e.mode === 'charge' ? 10 : 3));
    e.bs = route.wrap(e.bs + e.v * dt);
    e.bd += (lateralTarget - e.bd) * Math.min(1, dt * (e.mode === 'charge' || e.mode === 'lunge' ? 4 : 1.6));
    const r = route.sample(e.bs, _s);
    e.bd = THREE.MathUtils.clamp(e.bd, -r.halfWidth + 2, r.halfWidth - 2);
    const turn = e.turnAmt || 0;
    e.heading = r.heading + Math.PI * turn;
    e.rx = r.x + r.rx * e.bd;
    e.rz = r.z + r.rz * e.bd;
    // Collision center sits forward of the hips (between body and neck)
    const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
    e.x = e.rx + fx * 2.2 * SCALE;
    e.z = e.rz + fz * 2.2 * SCALE;
    e.radius = 3.6 * SCALE;
    e.moveSpeed = Math.abs(e.v);
    e.dirx = fx; e.dirz = fz;
    // Footfalls
    this._footsteps(e, dt);
    // Body contact (outside scripted attacks): a shove + damage
    if (e.mode === 'chase' && gap > -9 && Math.abs(p.d - e.bd) < 3 && (e.attackCd -= dt) <= 0) {
      e.attackCd = 1.2;
      e.jaw = 1;
      g.hurtPlayer(14 * g.enemies.dmgMult, e.x, e.z, 'bite');
      g.audio.play('bite', { x: e.x, z: e.z, pitch: 0.6 });
    }
    // Threat arrow when off screen
    g.vfx.threats.push({ x: e.x, z: e.z, color: '#ff3b2f' });
    // Camera: reverse (getaway) view while it's behind, chase view when it's ahead
    if (g.state === 'playing') g.cam.setMode(gap < 4 ? 'reverse' : 'chase');
    return null;
  }

  _set(e, mode) {
    e.mode = mode;
    e.stateT = 0;
    e.bit = false;
    e.thrown = false;
  }

  _chooseAttack(e, gap) {
    const g = this.game;
    const P = e.phase;
    const r = Math.random();
    const p = g.player;
    if (P >= 2 && r < 0.22) {
      e.passSide = p.d > 0 ? -1 : 1;
      this._set(e, 'overtake');
      g.audio.play('trex_roar', { x: e.x, z: e.z, volume: 0.8, pitch: 1.15, dur: 1.2 });
    } else if (r < (P >= 2 ? 0.55 : 0.5)) {
      e.laneD = p.d;
      this._set(e, 'lunge_tele');
    } else if (r < (P >= 2 ? 0.75 : 0.75)) {
      this._set(e, 'stomp_tele');
    } else {
      this._set(e, 'throw');
    }
    void gap;
  }

  _phase(e, n) {
    const g = this.game;
    e.phase = n;
    this._set(e, 'stagger');
    g.hitStop(0.12);
    g.cam.addTrauma(0.6);
    g.vfx.explosion(this.collar.x, this.collar.y, this.collar.z, 1.2, 1);
    g.vfx.sparks(this.collar.x, this.collar.y, this.collar.z, 40, 16, 1.5, 5, 7);
    g.audio.play('explosion', { x: e.x, z: e.z, volume: 1 });
    g.audio.play('trex_roar', { volume: 1.2, pitch: 0.85, dur: 2.4 });
    g.hud.banner(n === 2 ? 'ENRAGED' : 'DESPERATE', n === 2 ? 'Collar breached — it calls the pack' : 'Collar overloading — hit the weak point!', 'boss');
    g.hud.setBossPhase(n);
    g.vfx.number(this.collar.x, this.collar.y + 2, this.collar.z, n === 2 ? 'PHASE 2' : 'PHASE 3', 4);
  }

  /** Red lane telegraph from the boss toward the car (dir -1: lunge forward along travel... both run along the route) */
  _lane(e, d, progress, dir) {
    const g = this.game;
    const p = g.player;
    // Lane from the boss's head toward and past the car at lateral d
    const r = g.route.sample(e.bs + (dir < 0 ? 0 : 0), _s);
    const x = r.x + r.rx * d, z = r.z + r.rz * d;
    const heading = dir < 0 ? r.heading : r.heading + Math.PI;
    const len = Math.abs(g.route.delta(e.bs, p.s)) + 14;
    g.vfx.telegraphLane(x, z, heading, len, 5.2, progress, 6, 0.35, 0.15);
  }

  _throwWreck(e, k) {
    const g = this.game;
    const p = g.player;
    const T = 1.25;
    const ahead = p.speed * T + (k - 0.5) * 9;
    const r = g.route.sample(p.s + ahead, _s);
    const lat = k === 0 ? p.d : p.d + (Math.random() - 0.5) * 9;
    const tx = r.x + r.rx * lat, tz = r.z + r.rz * lat;
    const sx = this.headPos.x, sy = this.headPos.y, sz = this.headPos.z;
    const G = 30;
    this.wrecks.push({ x: sx, y: sy, z: sz, vx: (tx - sx) / T, vz: (tz - sz) / T, vy: (0.6 - sy) / T + 0.5 * G * T, G, tx, tz, t: 0, T, spin: (Math.random() - 0.5) * 6, yaw: Math.random() * 6 });
  }

  _footsteps(e, dt) {
    const g = this.game;
    const prev = e.gaitPrev ?? 0;
    const ph = e.gait || 0;
    if (Math.floor(ph / Math.PI) !== Math.floor(prev / Math.PI) && e.moveSpeed > 2) {
      const d = Math.hypot(g.player.x - e.rx, g.player.z - e.rz);
      g.cam.addTrauma(Math.max(0, 0.22 - d * 0.004));
      g.audio.play('stomp', { x: e.rx, z: e.rz, volume: 0.9, pitch: 0.7 + Math.random() * 0.1, range: 160 });
      const side = Math.floor(ph / Math.PI) % 2 ? 1 : -1;
      const rx = Math.cos(e.heading), rz = -Math.sin(e.heading);
      g.vfx.dust(e.rx + rx * side * 1.4 * SCALE, e.rz + rz * side * 1.4 * SCALE, 1.6, 3);
    }
    e.gaitPrev = ph;
    void dt;
  }

  _cameo(e, dt) {
    const g = this.game;
    // Walk across the avenue, pause in the middle to roar, walk off
    const r = g.route.sample(e.cs, _s);
    const midT = 2.6;
    let v = 9;
    if (Math.abs(e.cd) < 2 && !e.roared) {
      e.roared = true;
      e.pauseT = 1.8;
      g.audio.play('trex_roar', { x: e.rx, z: e.rz, volume: 1.3, pitch: 0.95, dur: 2.4, range: 300 });
      g.cam.addTrauma(0.35);
      g.hud.banner('WHAT WAS THAT?!', 'Something big is loose in Midtown', 'cameo');
    }
    if (e.pauseT > 0) { e.pauseT -= dt; v = 0; e.roar = Math.min(1, 1.8 - e.pauseT); } else e.roar = 0;
    e.cd -= e.cside * v * dt;
    e.rx = r.x + r.rx * e.cd;
    e.rz = r.z + r.rz * e.cd;
    e.x = e.rx; e.z = e.rz;
    e.heading = Math.atan2(-r.rx * e.cside, -r.rz * e.cside);
    // Face the car while roaring
    if (e.pauseT > 0) {
      const toCar = Math.atan2(g.player.x - e.rx, g.player.z - e.rz);
      e.heading = toCar;
    }
    e.moveSpeed = v;
    this._footsteps(e, dt);
    void midT;
    if (e.stateT > 14 || Math.abs(e.cd) > 45 || g.route.delta(g.player.s, e.cs) < -30) {
      this.e = null;
      return 'remove';
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------------------------------
  _death(e, dt) {
    const g = this.game;
    // stateT runs in (slowed) game time
    const t = e.stateT;
    e.v *= 1 - Math.min(1, dt * 3);
    e.bs = g.route.wrap(e.bs + e.v * dt);
    const r = g.route.sample(e.bs, _s);
    e.rx = r.x + r.rx * e.bd;
    e.rz = r.z + r.rz * e.bd;
    e.moveSpeed = Math.abs(e.v) * 0.5;
    e.fall = THREE.MathUtils.smoothstep(t, 0.45, 1.25);
    if (!e.landed && t > 1.2) {
      e.landed = true;
      g.audio.play('stomp', { volume: 1.5, pitch: 0.4 });
      g.audio.play('explosion', { volume: 1, pitch: 0.4, big: true });
      g.cam.addTrauma(0.9);
      for (let k = 0; k < 14; k++) g.vfx.dust(e.rx + (Math.random() - 0.5) * 16, e.rz + (Math.random() - 0.5) * 16, 4, 2);
      g.vfx.shockwave(e.rx, e.rz, 30, 2, 1.8, 1.4, 0.9);
    }
    e.stone = THREE.MathUtils.clamp((t - 1.4) / 1.0, 0, 1);
    if (e.stone > 0 && Math.random() < 0.5) g.vfx.sparks(e.rx + (Math.random() - 0.5) * 8, 2 + Math.random() * 4, e.rz + (Math.random() - 0.5) * 8, 2, 4, 0.4, 3, 3.6);
    if (t > 2.7) {
      // SHATTER
      const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
      for (let k = -2; k <= 3; k++) {
        g.vfx.shatter(e.rx + fx * k * 2.6 * SCALE * 0.5, 2.5, e.rz + fz * k * 2.6 * SCALE * 0.5, 3.4, true, 0.6, 4, 5);
      }
      g.vfx.explosion(e.rx, 3, e.rz, 4, 1);
      g.vfx.light(e.rx, 6, e.rz, 0x66ffff, 1200, 80, 1.2);
      g.audio.play('shatter_big', { volume: 1.6, pitch: 0.45 });
      g.audio.play('explosion', { volume: 1.2, pitch: 0.6, big: true });
      g.cam.addTrauma(1);
      g.flash(0.3);
      for (let k = 0; k < 70; k++) g.pickups.gem(e.rx + (Math.random() - 0.5) * 12, e.rz + (Math.random() - 0.5) * 12, k < 10 ? 60 : 20);
      g.pickups.spawnItem('crate', e.rx, e.rz);
      g.pickups.spawnItem('repair', e.rx + 3, e.rz);
      g.pickups.vacuum();
      this.e = null;
      this.active = false;
      g.onBossDefeated(e);
      return 'remove';
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    if (this.cameoPending) {
      this.cameoPending -= dt;
      if (this.cameoPending <= 0) { this.cameoPending = false; this.cameo(); }
    }
    // Wrecks in flight
    this.wreckBatch.begin();
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      w.t += dt;
      w.vy -= w.G * dt;
      w.x += w.vx * dt; w.y += w.vy * dt; w.z += w.vz * dt;
      w.yaw += w.spin * dt;
      g.vfx.telegraphCircle(w.tx, w.tz, 5, Math.min(1, w.t / w.T), 6, 0.6, 0.15);
      if (Math.random() < dt * 20) g.vfx.glow.spawn(w.x, w.y, w.z, 0, 1, 0, 0.3, 0.6, 1.2, 6, 2, 0.4, { r1: 0.3, g1: 0.05, b1: 0 });
      if (w.y <= 0.6 && w.vy < 0) {
        g.weapons.blast(w.x, w.z, 6, 120, 0, 'boss');
        g.vfx.explosion(w.x, 0.5, w.z, 2, 0);
        if (Math.hypot(g.player.x - w.x, g.player.z - w.z) < 5.2) g.hurtPlayer(18 * g.enemies.dmgMult, w.x, w.z, 'wreck');
        this.wrecks.splice(i, 1);
        continue;
      }
      this.wreckBatch.add(w.x, w.y, w.z, w.yaw, w.t * 2, w.t * 1.3, 1, 1, 1, 1, 1, 1, 1);
    }
    this.wreckBatch.end();
    // The car in its jaws while winding up a throw
    this.held.begin();
    const e = this.e;
    if (e && e.holding && e.mode === 'throw') {
      this.held.add(this.headPos.x, this.headPos.y - 0.6, this.headPos.z, e.heading + Math.PI / 2, 0.3, 0.2, 0.9, 0.9, 0.9, 1, 1, 1, 1);
    }
    this.held.end();
  }

  // ------------------------------------------------------------------------------------------------------------------
  /** Rig pose; returns the extra root lift. Also sets the render position (rx, rz) via e.renderX/Z */
  pose(e, pose, idx, time) {
    const moving = Math.min(1, (e.moveSpeed || 0) / 8);
    const pdt = Math.min(0.1, Math.max(0, time - (e.poseT ?? time)));
    e.poseT = time;
    e.gait = (e.gait || 0) + (e.moveSpeed || 0) * pdt * 0.42;
    const ph = e.gait;
    const s = Math.sin(ph), c = Math.cos(ph);
    const amp = 0.15 + 0.5 * moving;
    const crouch = e.crouch || 0;
    const roar = e.roar || 0;
    const lunge = e.lungeAmt || 0;
    const rear = e.rear || 0;
    const stag = e.staggerAmt || 0;
    const fall = e.fall || 0;
    const thr = e.throwAmt || 0;
    for (const [side, p] of [['L', ph], ['R', ph + Math.PI]]) {
      const sw = Math.sin(p) * amp;
      const knee = Math.max(0, -Math.cos(p)) * 0.8 * amp;
      setJoint(pose, idx, `thigh${side}`, sw - crouch * 0.35 - rear * 0.3 + fall * 0.4 * (side === 'L' ? 1 : -0.5));
      setJoint(pose, idx, `shin${side}`, knee + crouch * 0.6 + rear * 0.3);
      setJoint(pose, idx, `foot${side}`, -sw * 0.6 - knee * 0.5 - crouch * 0.3);
    }
    const bodyPitch = 0.05 * moving + crouch * 0.18 - rear * 0.45 + lunge * 0.22 - roar * 0.15 + stag * 0.1;
    setJoint(pose, idx, 'body', bodyPitch, Math.sin(ph) * 0.05 * moving + stag * Math.sin(time * 9) * 0.15, 0);
    const sway = Math.sin(ph * 0.5 + 0.5);
    setJoint(pose, idx, 'tail1', 0.05 + c * 0.04 * moving - crouch * 0.1 + rear * 0.3, sway * 0.16 + thr * 0.3, 0);
    setJoint(pose, idx, 'tail2', 0.04 + rear * 0.15, sway * 0.22, 0);
    setJoint(pose, idx, 'tail3', 0.02, sway * 0.3 + Math.sin(time * 2) * 0.05, 0);
    const look = Math.sin(time * 0.8 + e.offA) * 0.12 * (1 - moving);
    setJoint(pose, idx, 'neck', -0.05 + crouch * 0.25 + lunge * 0.3 - roar * 0.35 + Math.sin(ph * 2) * 0.04 * moving - thr * 0.3 + fall * 0.2, look - thr * 0.6 * Math.sin(Math.min(1, thr) * Math.PI), 0);
    setJoint(pose, idx, 'head', crouch * 0.15 + lunge * 0.1 - roar * 0.35 + Math.sin(ph * 2 + 1) * 0.04 * moving + Math.sin(time * 30) * roar * 0.03, look * 0.5, Math.sin(time * 3) * roar * 0.05);
    setJoint(pose, idx, 'jaw', 0.06 + (e.jaw || 0) * 0.7 + roar * 0.75 + (e.stone > 0 ? 0.5 : 0));
    setJoint(pose, idx, 'armL', 0.3 + Math.sin(ph + 1) * 0.15 * moving - roar * 0.4, 0, 0);
    setJoint(pose, idx, 'armR', 0.3 + Math.sin(ph + 1 + Math.PI) * 0.15 * moving - roar * 0.4, 0, 0);
    // Whole-creature tilt via entity pitch/roll (read by the rig): topple sideways on death
    e.roll = fall * 1.45;
    e.pitch = -rear * 0.05 + stag * 0.05;
    // Rolling ~83° about the ground origin already lays the body on the street; lift it to rest on its side
    const lift = Math.abs(s) * 0.12 * moving - crouch * 0.35 + fall * 0.8 + rear * 0.3;
    return lift;
  }

  /** After the rig placed the individual: read weak point & head positions from the part matrices */
  afterAdd(rig) {
    rig.partWorldPosition('neck', this.collar, COLLAR_LOCAL);
    rig.partWorldPosition('thighL', this.thighs[0], THIGH_LOCAL);
    rig.partWorldPosition('thighR', this.thighs[1], THIGH_LOCAL);
    rig.partWorldPosition('head', this.headPos, _v.set(0, -0.3, 1.4));
  }
}

export { TRexBoss, SCALE as TREX_SCALE };
