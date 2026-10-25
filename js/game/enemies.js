import * as THREE from 'three/webgpu';
import { InstancedRig, createPose } from './rig.js';
import { poseCreature } from './poses.js';

// js/game/enemies.js
// The dinosaurs: species stats, pooled individuals, steering AI with species behaviors (raptor pounces, triceratops
// charges, ankylosaur tail swipes, pterosaur dive-bombs, elite auras), ramming & launch physics, the fossilize death,
// and instanced rendering through one InstancedRig per species.

const SPECIES = {
  compy: { name: 'Scuttler', size: 1.45, hp: 7, speed: 16.5, dmg: 2, radius: 0.55, height: 0.7, xp: 1, score: 10, mass: 0.3, ramKill: true, stride: 2.6, sound: 'compy_chirp' },
  raptor: { name: 'Sicklejaw', size: 1.15, hp: 26, speed: 20.5, dmg: 6, radius: 0.95, height: 1.7, xp: 3, score: 40, mass: 1, ramKill: true, stride: 1.6, pounce: true, sound: 'raptor_screech' },
  brute: { name: 'Brute Raptor', hp: 120, speed: 17.5, dmg: 10, radius: 1.5, height: 2.8, xp: 9, score: 150, mass: 4, stride: 1.15, pounce: true, sound: 'brute_growl' },
  trike: { name: 'Hornwall', hp: 340, speed: 7, dmg: 22, radius: 2.4, height: 3, xp: 22, score: 400, mass: 12, stride: 0.75, charger: true, sound: 'trike_bellow' },
  ankylo: { name: 'Clubtail', hp: 520, speed: 4.5, dmg: 18, radius: 2.2, height: 2, xp: 26, score: 500, mass: 14, stride: 0.7, armor: 0.45, swipe: true, sound: 'ankylo_grunt' },
  ptero: { name: 'Skyreaver', hp: 18, speed: 24, dmg: 9, radius: 1.3, height: 1, xp: 4, score: 60, mass: 0.5, flyer: true, stride: 1, sound: 'ptero_cry' },
  // The boss: driven entirely by its controller (boss.js)
  trex: { name: 'GRIDLOCK', hp: 11000, speed: 20, dmg: 25, radius: 3.2, height: 6.4, xp: 0, score: 50000, mass: 80, stride: 0.5, sound: 'trex_roar', custom: true }
};
const SPECIES_IDS = Object.keys(SPECIES);
const CAR_RADIUS = 1.5;

class SpatialHash {
  constructor(cell = 6, size = 4096) {
    this.cell = cell;
    this.size = size;
    this.buckets = Array.from({ length: size }, () => []);
    this.used = [];
  }
  _key(ix, iz) {
    return (((ix * 73856093) ^ (iz * 19349663)) >>> 0) % this.size;
  }
  clear() {
    for (const k of this.used) this.buckets[k].length = 0;
    this.used.length = 0;
  }
  insert(e) {
    const k = this._key(Math.floor(e.x / this.cell), Math.floor(e.z / this.cell));
    const b = this.buckets[k];
    if (b.length === 0) this.used.push(k);
    b.push(e);
  }
  /** Calls fn(e) for every entity whose cell overlaps the circle (caller does the exact distance test) */
  query(x, z, r, fn) {
    const c = this.cell;
    const ix0 = Math.floor((x - r) / c), ix1 = Math.floor((x + r) / c);
    const iz0 = Math.floor((z - r) / c), iz1 = Math.floor((z + r) / c);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const b = this.buckets[this._key(ix, iz)];
        for (let i = 0; i < b.length; i++) if (fn(b[i]) === true) return;
      }
    }
  }
}

class Enemy {
  constructor(id) {
    this.id = id;
    this.alive = false;
  }
}

class EnemyManager {
  constructor(game, assets) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'Dinosaurs';
    this.rigs = {};
    this.poses = {};
    this.models = {};
    const glow = { trex: new THREE.Color(1.4, 1.4, 1.4) };
    for (const id of SPECIES_IDS) {
      const entry = assets.get(id);
      const model = entry.model;
      this.models[id] = model;
      const rig = new InstancedRig(model, entry.def.capacity, { glow: glow[id] || new THREE.Color(1, 1, 1) });
      this.rigs[id] = rig;
      this.poses[id] = createPose(model);
      this.group.add(rig.group);
      const sp = SPECIES[id];
      // Gameplay radius follows the model when a replacement asset changes the size
      if (model.radius && !sp.custom) sp.radius = Math.max(sp.radius * 0.7, Math.min(sp.radius * 1.4, model.radius));
      if (model.height && !sp.custom) sp.height = model.height;
    }
    this.pool = [];
    this.list = []; // alive enemies
    this.hash = new SpatialHash(6);
    this.capacity = 900;
    this.countByType = Object.fromEntries(SPECIES_IDS.map((id) => [id, 0]));
    this._tmp = { x: 0, z: 0, hit: false };
    this.hpMult = 1;
    this.dmgMult = 1;
    this.speedMult = 1;
    this.frozen = false;
  }

  get count() {
    return this.list.length;
  }

  spawn(type, x, z, opts = {}) {
    const sp = SPECIES[type];
    if (!sp) return null;
    const rig = this.rigs[type];
    if (this.countByType[type] >= rig.capacity - (opts.elite || opts.boss ? 0 : 1)) return null;
    if (this.list.length >= this.capacity && !opts.boss) return null;
    const e = this.pool.pop() || new Enemy(this.list.length);
    e.alive = true;
    e.type = type;
    e.sp = sp;
    e.x = x;
    e.z = z;
    e.y = sp.flyer ? 12 + Math.random() * 5 : 0;
    e.vx = 0;
    e.vz = 0;
    e.vy = 0;
    e.elite = opts.elite ? 1 : 0;
    e.boss = !!opts.boss;
    e.scale = (opts.scale ?? (e.elite ? 1.3 : 1)) * (sp.size || 1) * (0.92 + Math.random() * 0.16);
    e.maxHp = sp.hp * this.hpMult * (opts.hpMult ?? (e.elite ? 7 : 1));
    e.hp = e.maxHp;
    e.speed = sp.speed * this.speedMult * (opts.speedMult ?? 1) * (0.9 + Math.random() * 0.2);
    e.radius = sp.radius * e.scale;
    e.heading = opts.heading ?? Math.random() * Math.PI * 2;
    e.state = opts.state || 'run';
    e.stateT = 0;
    e.animT = Math.random() * 10;
    e.flash = 0;
    e.stone = 0;
    e.attackCd = 1 + Math.random();
    e.abilityCd = 2 + Math.random() * 3;
    e.offA = Math.random() * Math.PI * 2;
    e.offR = 1 + Math.random() * 2.5;
    e.knock = 0;
    e.spin = 0;
    e.pitch = 0;
    e.roll = 0;
    e.jaw = 0;
    e.burn = 0;
    e.slowT = 0;
    e.tx = 0; e.tz = 0; // locked attack target
    e.dirx = 0; e.dirz = 1;
    e.charges = 0;
    e.lastHitBy = null;
    e.sawCd = 0;
    e.flameCd = 0;
    e.behavior = opts.behavior || null;
    e.dropCrate = !!opts.dropCrate || !!e.elite;
    e.stuck = 0;
    e.spawnT = 0;
    e.name = opts.name || null;
    e.numAcc = 0; e.numT = -1; e.numCrit = false;
    e.ctrl = opts.ctrl || null;
    e.ghost = false;
    e.miniboss = false;
    e.rx = x; e.rz = z;
    e.moveSpeed = 0;
    e.gait = 0;
    e.frozenLift = 0;
    e.mode = null;
    this.list.push(e);
    this.countByType[type]++;
    return e;
  }

  _remove(i) {
    const e = this.list[i];
    e.alive = false;
    this.countByType[e.type]--;
    const last = this.list.pop();
    if (i < this.list.length) this.list[i] = last;
    this.pool.push(e);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this._remove(i);
  }

  /**
   * Deals damage. opts: { crit, kx, kz (knockback impulse), source, noNumber, explosive }
   * Returns true if the hit killed it.
   */
  damage(e, amount, opts = {}) {
    if (!e.alive || e.ghost || e.state === 'dying' || e.state === 'launched' && e.hp <= 0) return false;
    let a = amount;
    if (e.sp.armor && !opts.explosive) a *= 1 - e.sp.armor;
    e.hp -= a;
    // Flash scales with how much the hit hurt, so swarms under constant fire keep their colours
    e.flash = Math.max(e.flash, Math.min(0.8, (e.boss ? 0.05 : 0.1) + (a / e.maxHp) * 2.5));
    const game = this.game;
    game.stats.damageDealt += a;
    // Numbers for hits that matter: crits, big hits, elites and bosses (a swarm of 15s is just noise)
    if (!opts.noNumber && (opts.crit || a >= 20 || e.elite || e.boss || e.miniboss)) {
      // One number per individual per short window (sums rapid hits instead of stacking dozens of labels)
      e.numAcc = (e.numAcc || 0) + a;
      e.numCrit = e.numCrit || !!opts.crit;
      const now = game.elapsed;
      if (e.hp <= 0 || now - (e.numT ?? -1) > (e.boss ? 0.14 : 0.22)) {
        const top = e.ctrl ? 8 * e.scale : e.sp.height * e.scale * 0.8 + 0.4;
        game.vfx.number(e.x, e.y + top, e.z, e.numAcc, e.numCrit ? 1 : 0);
        e.numAcc = 0;
        e.numCrit = false;
        e.numT = now;
      }
    }
    if (opts.kx || opts.kz) {
      const m = 1 / Math.max(0.3, e.sp.mass * e.scale);
      e.vx += opts.kx * m;
      e.vz += opts.kz * m;
      e.knock = Math.min(0.35, e.knock + 0.12);
    }
    if (e.hp <= 0) {
      this.kill(e, opts.source || 'weapon', opts);
      return true;
    }
    return false;
  }

  kill(e, cause = 'weapon', opts = {}) {
    if (e.state === 'dying') return;
    e.hp = 0;
    const g = this.game;
    if (opts.launch) {
      e.state = 'launched';
      e.vy = opts.vy ?? 9;
      e.vx = opts.lx ?? e.vx;
      e.vz = opts.lz ?? e.vz;
      e.spin = (Math.random() - 0.5) * 16;
    } else {
      e.state = 'dying';
    }
    e.stateT = 0;
    g.onEnemyKilled(e, cause);
  }

  _finishDeath(i) {
    const e = this.list[i];
    const g = this.game;
    const big = e.sp.mass * e.scale > 3;
    const h = e.sp.height * e.scale;
    const glow = e.elite ? [4, 0.8, 3.5] : [0.4, 3, 3.6];
    g.vfx.shatter(e.x, Math.max(0, e.y) + h * 0.25, e.z, e.radius * (e.sp.flyer ? 0.8 : 1), big, ...glow);
    g.audio.play(big ? 'shatter_big' : 'fossilize', { x: e.x, z: e.z, volume: big ? 1 : 0.55, pitch: 1.4 - Math.min(0.6, e.radius * 0.2) });
    if (big) g.cam.addTrauma(0.18);
    g.dropLoot(e);
    this._remove(i);
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const vfx = g.vfx;
    const list = this.list;
    const hash = this.hash;
    hash.clear();
    for (let i = 0; i < list.length; i++) if (list[i].state !== 'dying' && !list[i].ghost) hash.insert(list[i]);
    const route = g.route;
    const walk = g.walk;
    const tmp = this._tmp;
    const carSpeed = p.speed;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const sp = e.sp;
      if (e.ctrl) {
        if (e.ctrl.updateEntity(e, dt) === 'remove') this._remove(i);
        continue;
      }
      e.animT += dt;
      e.stateT += dt;
      e.spawnT += dt;
      e.flash = Math.max(0, e.flash - dt * 10);
      e.knock = Math.max(0, e.knock - dt);
      e.attackCd -= dt;
      e.abilityCd -= dt;
      e.sawCd -= dt;
      e.flameCd -= dt;
      e.jaw = Math.max(0, e.jaw - dt * 2);

      // --- Death & launch ------------------------------------------------------------------------------------
      if (e.state === 'dying') {
        e.stone = Math.min(1, e.stateT / 0.22);
        e.vx *= 0.85; e.vz *= 0.85;
        e.x += e.vx * dt; e.z += e.vz * dt;
        if (sp.flyer && e.y > 0) { e.vy -= 30 * dt; e.y = Math.max(0, e.y + e.vy * dt); }
        if (e.stateT > (e.boss ? 0.6 : 0.28) && (!sp.flyer || e.y <= 0.5 || e.stateT > 1.2)) this._finishDeath(i);
        continue;
      }
      if (e.state === 'launched') {
        e.stone = Math.min(1, e.stateT / 0.35);
        e.vy -= 26 * dt;
        e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
        e.pitch += e.spin * dt;
        e.roll += e.spin * 0.6 * dt;
        if (e.y <= 0 && e.vy < 0) { e.y = 0; this._finishDeath(i); }
        continue;
      }
      // Burning (flamer DoT)
      if (e.burn > 0) {
        e.burn -= dt;
        if (Math.random() < dt * 8) vfx.glow.spawn(e.x + (Math.random() - 0.5) * e.radius, e.y + Math.random() * sp.height * e.scale, e.z + (Math.random() - 0.5) * e.radius, 0, 2.5, 0, 0.35, 0.5, 0.1, 6, 2, 0.3);
        if (Math.random() < dt * 3) { if (this.damage(e, g.weapons.burnDps * 0.33, { noNumber: false, source: 'flamer' })) continue; }
      }

      // --- Distance / culling --------------------------------------------------------------------------------
      const dx = p.x - e.x, dz = p.z - e.z;
      const dist = Math.hypot(dx, dz) || 1e-3;
      if (!e.boss && e.spawnT > 2) {
        const ahead = (e.x - p.x) * p.fx + (e.z - p.z) * p.fz;
        if (dist > 230 || (ahead < -80 && dist > 70)) {
          // Left far behind: recycle silently (it never reached the car)
          this._remove(i);
          continue;
        }
      }

      // --- Behaviour -----------------------------------------------------------------------------------------
      let speed = e.speed * (e.slowT > 0 ? 0.5 : 1);
      if (e.slowT > 0) e.slowT -= dt;
      let tx = p.x + e.vx * 0, tz = p.z;
      // Lead the target by the car's motion so pursuers intercept instead of trailing
      const lead = Math.min(1.1, dist / (speed + carSpeed + 1));
      tx = p.x + p.vx * lead + Math.cos(e.offA) * e.offR;
      tz = p.z + p.vz * lead + Math.sin(e.offA) * e.offR;
      let mvx = 0, mvz = 0;

      if (sp.flyer) {
        this._updatePtero(e, dt, p);
        continue;
      }

      if (e.state === 'run') {
        if (sp.charger && dist < 85 && e.abilityCd <= 0 && e.spawnT > 1) {
          const ahead = (e.x - p.x) * p.fx + (e.z - p.z) * p.fz;
          if (ahead > 8) {
            e.state = 'windup';
            e.stateT = 0;
            e.tx = p.x + p.vx * 1.2; e.tz = p.z + p.vz * 1.2;
            const L = Math.hypot(e.tx - e.x, e.tz - e.z) || 1;
            e.dirx = (e.tx - e.x) / L; e.dirz = (e.tz - e.z) / L;
            g.audio.play('trike_bellow', { x: e.x, z: e.z, pitch: e.boss ? 0.7 : 1 });
          }
        } else if (sp.pounce && dist < (e.type === 'brute' ? 11 : 9) && dist > 3 && e.abilityCd <= 0) {
          e.state = 'windup';
          e.stateT = 0;
          if (Math.random() < 0.35) g.audio.play(sp.sound, { x: e.x, z: e.z, volume: 0.6 });
        } else if (sp.swipe && dist < 8 && e.abilityCd <= 0) {
          e.state = 'windup';
          e.stateT = 0;
        }
        if (sp.charger || sp.swipe) {
          // Heavies lumber into the car's path ahead instead of chasing
          const ax = p.x + p.fx * 25, az = p.z + p.fz * 25;
          const ahead = (e.x - p.x) * p.fx + (e.z - p.z) * p.fz;
          if (ahead > 10) { tx = ax + Math.cos(e.offA) * 3; tz = az + Math.sin(e.offA) * 3; }
        }
        const L = Math.hypot(tx - e.x, tz - e.z) || 1;
        mvx = ((tx - e.x) / L) * speed;
        mvz = ((tz - e.z) / L) * speed;
      } else if (e.state === 'windup') {
        if (sp.charger) {
          const wind = e.boss ? 0.9 : e.elite ? 0.75 : 1.05;
          vfx.telegraphLane(e.x, e.z, Math.atan2(e.dirx, e.dirz), 70, e.radius * 2.2, e.stateT / wind);
          e.heading = Math.atan2(e.dirx, e.dirz);
          if (Math.random() < dt * 10) vfx.dust(e.x - e.dirx * e.radius, e.z - e.dirz * e.radius, 0.6, 1);
          if (e.stateT > wind) {
            e.state = 'charge';
            e.stateT = 0;
            g.audio.play('stomp', { x: e.x, z: e.z, volume: 0.8 });
          }
        } else if (sp.pounce) {
          // Crouch, then leap at where the car will be
          e.heading = Math.atan2(dx, dz);
          e.jaw = 0.6;
          if (e.stateT > (e.elite ? 0.22 : 0.32)) {
            e.state = 'leap';
            e.stateT = 0;
            const T = 0.5;
            const ltx = p.x + p.vx * T, ltz = p.z + p.vz * T;
            e.vx = (ltx - e.x) / T;
            e.vz = (ltz - e.z) / T;
            e.vy = 6.5;
            g.audio.play(sp.sound, { x: e.x, z: e.z, volume: 0.7, pitch: 1 + Math.random() * 0.2 });
          }
        } else if (sp.swipe) {
          vfx.telegraphCircle(e.x, e.z, 7 * e.scale, e.stateT / 0.7, 5, 0.9, 0.2);
          if (e.stateT > 0.7) {
            g.audio.play('tail_swipe', { x: e.x, z: e.z });
            vfx.shockwave(e.x, e.z, 7 * e.scale, 3, 2, 0.6);
            if (dist < 7 * e.scale + CAR_RADIUS) g.hurtPlayer(sp.dmg * this.dmgMult * (e.elite ? 1.5 : 1), e.x, e.z, 'swipe');
            e.state = 'run';
            e.abilityCd = 3 + Math.random() * 2;
          }
        }
      } else if (e.state === 'leap') {
        e.vy -= 22 * dt;
        e.y = Math.max(0, e.y + e.vy * dt);
        e.x += e.vx * dt;
        e.z += e.vz * dt;
        e.heading = Math.atan2(e.vx, e.vz);
        e.jaw = 0.8;
        if (dist < e.radius + CAR_RADIUS + 0.4 && e.attackCd <= 0) {
          g.hurtPlayer(sp.dmg * this.dmgMult * 1.3 * (e.elite ? 1.3 : 1), e.x, e.z, 'pounce');
          e.attackCd = 0.9;
          g.audio.play('bite', { x: e.x, z: e.z, volume: 0.5, pitch: 1.5 });
        }
        if (e.y <= 0 && e.stateT > 0.1) {
          e.state = 'run';
          e.abilityCd = (e.elite ? 1.4 : 2.6) + Math.random() * 2;
          e.vx *= 0.3; e.vz *= 0.3;
        }
        this._separate(e, dt);
        continue;
      } else if (e.state === 'charge') {
        const cs = (e.boss ? 34 : 30) * this.speedMult;
        mvx = e.dirx * cs;
        mvz = e.dirz * cs;
        e.heading = Math.atan2(e.dirx, e.dirz);
        if (Math.random() < dt * 14) vfx.dust(e.x, e.z, 0.8, 1);
        // Trample anything small in the way
        hash.query(e.x, e.z, e.radius + 1.5, (o) => {
          if (o === e || o.state === 'dying' || o.state === 'launched' || o.sp.mass > 3) return;
          if (Math.hypot(o.x - e.x, o.z - e.z) < e.radius + o.radius) {
            this.kill(o, 'trample', { launch: true, vy: 10, lx: e.dirx * 18 + (Math.random() - 0.5) * 8, lz: e.dirz * 18 + (Math.random() - 0.5) * 8 });
          }
        });
        if (e.stateT > (e.boss ? 2.6 : 2.2)) {
          e.charges++;
          const maxCharges = e.boss ? 3 : e.elite ? 3 : 1;
          if (e.charges < maxCharges) {
            e.state = 'windup';
            e.stateT = 0.3;
            e.tx = p.x + p.vx * 1.2; e.tz = p.z + p.vz * 1.2;
            const L = Math.hypot(e.tx - e.x, e.tz - e.z) || 1;
            e.dirx = (e.tx - e.x) / L; e.dirz = (e.tz - e.z) / L;
          } else {
            e.state = 'run';
            e.charges = 0;
            e.abilityCd = (e.boss ? 3 : 5) + Math.random() * 3;
          }
        }
      }

      // Elite auras / abilities
      if (e.behavior === 'alpha' && e.abilityCd <= 0 && e.state === 'run') {
        e.abilityCd = 9;
        g.audio.play('brute_growl', { x: e.x, z: e.z, pitch: 0.8, volume: 1.2 });
        vfx.shockwave(e.x, e.z, 14, 4, 0.8, 3.5, 0.7);
        for (let k = 0; k < 5; k++) g.director.spawnNear('raptor', e.x, e.z, 10);
        hash.query(e.x, e.z, 16, (o) => { if (o.type === 'raptor' || o.type === 'compy') o.speed *= 1.15; });
      }

      // --- Integrate with steering, separation and walls -------------------------------------------------------
      const turn = e.state === 'charge' ? 20 : 4 + 4 / Math.max(0.5, sp.mass * 0.5);
      if (e.knock > 0) {
        e.vx *= 1 - Math.min(1, dt * 3);
        e.vz *= 1 - Math.min(1, dt * 3);
      } else {
        e.vx += (mvx - e.vx) * Math.min(1, dt * turn);
        e.vz += (mvz - e.vz) * Math.min(1, dt * turn);
      }
      walk.move(e.x, e.z, e.vx * dt, e.vz * dt, tmp);
      if (tmp.hit) {
        e.stuck += dt;
        if (e.state === 'charge') { e.state = 'run'; e.abilityCd = 3; vfx.dust(e.x, e.z, 1.5, 6); g.audio.play('stomp', { x: e.x, z: e.z }); }
        if (e.stuck > 1.5) { e.offA += 1.7; e.stuck = 0; }
      } else e.stuck = Math.max(0, e.stuck - dt);
      e.x = tmp.x;
      e.z = tmp.z;
      if (e.y > 0) e.y = Math.max(0, e.y - dt * 6);
      const vs = Math.hypot(e.vx, e.vz);
      if (vs > 0.5 && e.state !== 'windup') {
        let dh = Math.atan2(e.vx, e.vz) - e.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        e.heading += dh * Math.min(1, dt * 10);
      }
      e.moveSpeed = vs;
      this._separate(e, dt);

      // --- Contact with the car ------------------------------------------------------------------------------
      const cd = Math.hypot(p.x - e.x, p.z - e.z);
      if (cd < e.radius + CAR_RADIUS && e.y < 2 && p.alive) {
        const nx = (e.x - p.x) / (cd || 1), nz = (e.z - p.z) / (cd || 1);
        const front = nx * p.fx + nz * p.fz;
        const ramSpeed = p.speed * Math.max(0, front) + Math.abs(p.vd) * Math.abs(nx * -p.fz + nz * p.fx) * 0.6;
        if (ramSpeed > 8 && e.state !== 'charge') {
          // Rammed!
          const ramDmg = ramSpeed * 3.2 * p.stats.ram * (p.boosting ? 1.6 : 1);
          g.onRam(e, ramSpeed);
          if (sp.ramKill || ramDmg >= e.hp) {
            const out = 8 + ramSpeed * 0.5;
            if (this.damage(e, ramDmg, { source: 'ram', noNumber: false })) {
              e.state = 'launched';
              // Thrown ahead and off to the side (not up into the chase camera)
              e.vy = 4.5 + ramSpeed * 0.18;
              const side = (nx * -p.fz + nz * p.fx) >= 0 ? 1 : -1;
              e.vx = p.fx * ramSpeed * 1.15 - p.fz * side * out;
              e.vz = p.fz * ramSpeed * 1.15 + p.fx * side * out;
              e.spin = (Math.random() - 0.5) * 18;
            }
          } else {
            this.damage(e, ramDmg, { source: 'ram', kx: nx * 14, kz: nz * 14 });
            g.hurtPlayer(sp.dmg * this.dmgMult * 0.6 / p.stats.ram, e.x, e.z, 'ram');
            p.speed *= 0.6;
          }
        } else if (e.state === 'charge') {
          g.hurtPlayer(sp.dmg * this.dmgMult * (e.boss ? 1.5 : 1), e.x, e.z, 'charge');
          p.speed *= 0.4;
          p.vd += nx * -p.fz * 8;
          e.state = 'run';
          e.abilityCd = 3;
          g.cam.addTrauma(0.6);
        } else if (e.attackCd <= 0) {
          e.attackCd = 0.75 + Math.random() * 0.3;
          e.jaw = 1;
          g.hurtPlayer(sp.dmg * this.dmgMult * (e.elite ? 1.5 : 1), e.x, e.z, 'bite');
        }
        // Push out of the car
        const push = e.radius + CAR_RADIUS - cd;
        e.x += nx * push;
        e.z += nz * push;
      }
    }
  }

  _separate(e, dt) {
    // Cheap boids-style separation via position correction
    const r = e.radius;
    let px = 0, pz = 0;
    let n = 0;
    this.hash.query(e.x, e.z, r + 2.5, (o) => {
      if (o === e || o.state === 'dying') return;
      const ddx = e.x - o.x, ddz = e.z - o.z;
      const d2 = ddx * ddx + ddz * ddz;
      const rr = r + o.radius;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const w = (rr - d) / d;
        const share = o.sp.mass / (o.sp.mass + e.sp.mass);
        px += ddx * w * share;
        pz += ddz * w * share;
        if (++n > 8) return true;
      }
    });
    if (n) {
      e.x += px * 0.5;
      e.z += pz * 0.5;
    }
  }

  _updatePtero(e, dt, p) {
    const g = this.game;
    const vfx = g.vfx;
    if (e.state === 'run') {
      // Circle ahead of the car at altitude
      const ang = e.animT * 0.9 + e.offA;
      const tx = p.x + p.fx * (28 + Math.sin(ang * 0.7) * 10) + Math.cos(ang) * 14;
      const tz = p.z + p.fz * (28 + Math.sin(ang * 0.7) * 10) + Math.sin(ang) * 14;
      const ty = 13 + Math.sin(e.animT * 1.3 + e.offA) * 2;
      const L = Math.hypot(tx - e.x, tz - e.z) || 1;
      const sp = e.speed + p.speed;
      e.vx += ((tx - e.x) / L * sp - e.vx) * Math.min(1, dt * 1.8);
      e.vz += ((tz - e.z) / L * sp - e.vz) * Math.min(1, dt * 1.8);
      e.y += (ty - e.y) * Math.min(1, dt * 1.5);
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      e.heading = Math.atan2(e.vx, e.vz);
      e.roll = THREE.MathUtils.clamp((e.vx * Math.cos(e.heading) - e.vz * Math.sin(e.heading)) * 0.04, -0.6, 0.6);
      e.pitch = 0;
      if (e.abilityCd <= 0 && Math.hypot(p.x - e.x, p.z - e.z) < 60) {
        e.state = 'windup';
        e.stateT = 0;
        e.diveT = e.elite ? 0.85 : 1.15;
        e.tx = p.x + p.vx * e.diveT;
        e.tz = p.z + p.vz * e.diveT;
        e.sx = e.x; e.sy = e.y; e.sz = e.z;
        g.audio.play('ptero_cry', { x: e.x, z: e.z, volume: 0.8 });
      }
    } else if (e.state === 'windup') {
      // Dive along a curve onto the locked target; the shadow circle telegraphs it
      const u = Math.min(1, e.stateT / e.diveT);
      vfx.telegraphCircle(e.tx, e.tz, 2.8, u, 6, 0.3, 2.5);
      const ease = u * u;
      const nx = e.sx + (e.tx - e.sx) * u, nz = e.sz + (e.tz - e.sz) * u;
      const ny = e.sy * (1 - ease) + 0.9 * ease;
      e.vx = (nx - e.x) / Math.max(dt, 1e-3); e.vz = (nz - e.z) / Math.max(dt, 1e-3);
      e.x = nx; e.z = nz; e.y = ny;
      e.heading = Math.atan2(e.tx - e.sx, e.tz - e.sz);
      e.pitch = 0.5 * (1 - u) + 0.2;
      e.jaw = 0.7;
      if (u >= 1) {
        if (Math.hypot(p.x - e.x, p.z - e.z) < 3.2) g.hurtPlayer(e.sp.dmg * this.dmgMult * (e.elite ? 1.6 : 1), e.x, e.z, 'dive');
        vfx.dust(e.x, e.z, 0.8, 3);
        e.state = 'recover';
        e.stateT = 0;
        e.vy = 9;
        if (e.elite && (e.charges = (e.charges || 0) + 1) < 3) e.abilityCd = 0.6;
        else { e.charges = 0; e.abilityCd = 3.5 + Math.random() * 3; }
      }
    } else if (e.state === 'recover') {
      e.y += e.vy * dt;
      e.vy = Math.max(2, e.vy - dt * 4);
      e.x += e.vx * dt * 0.6;
      e.z += e.vz * dt * 0.6;
      e.pitch = -0.4;
      if (e.y > 11) { e.state = 'run'; e.pitch = 0; }
    }
  }

  /** Nearest living enemy to a point within range (optional filter); flyers count with their altitude */
  nearest(x, z, range, filter = null) {
    let best = null;
    let bd = range * range;
    for (const e of this.list) {
      if (e.state === 'dying' || e.state === 'launched' || e.ghost) continue;
      if (filter && !filter(e)) continue;
      const d2 = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  /** Enemies within a radius (exact), via the spatial hash */
  within(x, z, r, out) {
    out.length = 0;
    this.hash.query(x, z, r, (e) => {
      if (e.state === 'dying' || e.state === 'launched') return;
      if ((e.x - x) ** 2 + (e.z - z) ** 2 < (r + e.radius) ** 2) out.push(e);
    });
    return out;
  }

  render(time) {
    for (const id of SPECIES_IDS) this.rigs[id].begin();
    for (const e of this.list) {
      const rig = this.rigs[e.type];
      const pose = this.poses[e.type];
      if (e.ctrl) {
        const lift = e.ctrl.pose(e, pose, rig.partIndex, time);
        rig.add(e.rx, lift * e.scale, e.rz, e.heading, e.scale, pose, e.flash, e.stone, 0, e.pitch, e.roll);
        e.ctrl.afterAdd(rig);
        continue;
      }
      const lift = poseCreature(e.type, e, pose, rig.partIndex, time);
      rig.add(e.x, e.y + lift * e.scale, e.z, e.heading, e.scale, pose, e.flash, e.stone, e.elite ? 1 : 0, e.pitch, e.roll);
    }
    for (const id of SPECIES_IDS) this.rigs[id].end();
  }
}

export { EnemyManager, SPECIES, SPECIES_IDS, SpatialHash, CAR_RADIUS };
