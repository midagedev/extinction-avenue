import * as THREE from 'three/webgpu';
import { InstancedRig, createPose } from './rig.js';
import { poseCreature } from './poses.js';
import { SkinnedCrowd } from './skin-rig.js';
import { animateCreature } from './creature-anim.js';

// js/game/enemies.js
// The dinosaurs, rebuilt for the rear-gunner view. Ground pursuers live in ROUTE SPACE (arc length s + lateral offset d
// along the cab's patrol route), so they always run down the road behind the cab, face the gunner and read clearly in
// first person. Spawns from side streets and smashed storefronts first MERGE onto the road in world space. Pterosaurs
// fly in world space around a hover point behind the cab and dive at the gunner.
//
// Fair-fight rules (the cure for v1's "you die almost immediately"):
//   - Nothing damages the cab by touching it. Damage only comes from ATTACKS, and every attack is telegraphed: a windup
//     (crouch / pawing / screech + a red danger ring drawn around it on screen) before the lunge, charge or dive.
//   - An enemy may only start an attack after it has been on screen for a while (shootable before it can hit you).
//   - The director hands out a limited number of ATTACK TOKENS (1 early on, up to 3–4 late), plus a grace period at
//     the start of a run and after a continue.
//   - Shooting an enemy during its windup or lunge staggers it (cancels the attack) once enough damage lands.
//
// Rendering: one SkinnedCrowd per species (rigged GLB models, GPU-instanced skinning, skin-rig.js; animation state in
// creature-anim.js) — or the v2 rigid-part InstancedRig (rig.js) when a species has no rigged model. Hit testing: two
// spheres per individual (body + head, head = weak point ×1.6 "HEADSHOT"), taken from the rest pose of each model.

const SPECIES = {
  //          hp: base HP · close: closing speed on the cab (m/s) · dmg: per landed attack · wind: telegraph seconds
  compy: { name: 'Scuttler', size: 2.7, hp: 18, close: 6.5, dmg: 3, radius: 0.55, height: 0.8, xp: 2, score: 100, mass: 0.3, stride: 2.6, wind: 1.25, gaps: [-8, -15], leap: true, headR: 0.22, sound: 'compy_chirp' },
  raptor: { name: 'Sicklejaw', size: 1.75, hp: 55, close: 7.5, dmg: 6, radius: 0.95, height: 1.7, xp: 5, score: 250, mass: 1, stride: 1.6, wind: 1.15, gaps: [-9, -18], leap: true, headR: 0.34, sound: 'raptor_screech' },
  brute: { name: 'Brute Raptor', hp: 260, close: 5.5, dmg: 11, radius: 1.5, height: 2.8, xp: 16, score: 800, mass: 4, stride: 1.15, wind: 1.35, gaps: [-12, -22], leap: true, headR: 0.5, stagger: 0.18, sound: 'brute_growl' },
  trike: { name: 'Hornwall', hp: 650, close: 4.5, dmg: 15, radius: 2.4, height: 3, xp: 35, score: 1500, mass: 12, stride: 0.75, wind: 1.7, gaps: [-24, -32], charger: true, headR: 1.0, stagger: 0.22, sound: 'trike_bellow' },
  ankylo: { name: 'Spiketail', hp: 800, close: 3.2, dmg: 12, radius: 2.2, height: 2, xp: 40, score: 2000, mass: 14, stride: 0.7, wind: 1.4, gaps: [-8, -12], armor: 0.4, swipe: true, headR: 0.6, stagger: 0.2, sound: 'ankylo_grunt' },
  ptero: { name: 'Skyreaver', size: 1.35, hp: 35, close: 9, dmg: 6, radius: 1.3, height: 1, xp: 6, score: 300, mass: 0.5, flyer: true, stride: 1, wind: 1.1, gaps: [-12, -21], headR: 0.35, sound: 'ptero_cry' },
  // The boss: driven entirely by its controller (boss.js)
  trex: { name: 'GRIDLOCK', hp: 16000, close: 8, dmg: 15, radius: 3.2, height: 6.4, xp: 0, score: 50000, mass: 80, stride: 0.5, sound: 'trex_roar', custom: true }
};
const SPECIES_IDS = Object.keys(SPECIES);
const CAR_RADIUS = 1.5;
const CAR_REAR = 2.3; // rear bumper, metres behind the cab's origin
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = {};

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

/** Ray–sphere: distance along the (normalized) ray to the first hit, or Infinity */
function raySphere(ray, cx, cy, cz, r) {
  const ox = ray.origin.x - cx, oy = ray.origin.y - cy, oz = ray.origin.z - cz;
  const d = ray.direction;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  if (t > 0) return t;
  const t2 = -b + Math.sqrt(disc);
  return t2 > 0 ? 0 : Infinity;
}

class EnemyManager {
  constructor(game, assets) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'Dinosaurs';
    this.rigs = {};
    this.poses = {};
    this.models = {};
    this.hitLocal = {}; // per species, rest-pose body/head centres (model space, metres): { bf, by, hf, hy }
    const glow = { trex: new THREE.Color(1.4, 1.4, 1.4) };
    for (const id of SPECIES_IDS) {
      const entry = assets.get(id);
      const model = entry.model;
      this.models[id] = model;
      const cap = Math.min(entry.def.capacity, id === 'compy' ? 90 : id === 'raptor' ? 60 : entry.def.capacity);
      const rig = model.kind === 'skinned'
        ? new SkinnedCrowd(model, id === 'compy' ? 48 : id === 'raptor' ? 48 : Math.min(cap, 24), { attachments: entry.attachments })
        : new InstancedRig(model, cap, { glow: glow[id] || new THREE.Color(1, 1, 1) });
      this.rigs[id] = rig;
      this.poses[id] = model.kind === 'skinned' ? null : createPose(model);
      this.group.add(rig.group);
      const sp = SPECIES[id];
      // Gameplay radius follows the model when a replacement asset changes the size
      if (model.radius && !sp.custom) sp.radius = Math.max(sp.radius * 0.7, Math.min(sp.radius * 1.4, model.radius));
      if (model.height && !sp.custom) sp.height = model.height;
      // Rest-pose hit sphere centres
      rig.begin();
      rig.add(0, 0, 0, 0, 1, this.poses[id]);
      const b = rig.partWorldPosition('body', new THREE.Vector3());
      const hc = model.def?.skin?.headCenter;
      const h = rig.partWorldPosition('head', new THREE.Vector3(), hc ? new THREE.Vector3(...hc) : null);
      rig.begin();
      rig.end();
      this.hitLocal[id] = { bf: b.z * 0.6, by: Math.max(b.y, sp.height * 0.45), hf: h.z, hy: h.y };
    }
    this.pool = [];
    this.list = []; // alive enemies
    this.hash = new SpatialHash(6);
    this.capacity = 120;
    this.countByType = Object.fromEntries(SPECIES_IDS.map((id) => [id, 0]));
    this._tmp = { x: 0, z: 0, hit: false };
    this.hpMult = 1;
    this.dmgMult = 1;
    this.speedMult = 1;
    this.windMult = 1;
    this.maxAttackers = 1;
    this.attackers = 0;
    this.attackGrace = 0; // seconds during which nobody may start an attack
    this.dangers = []; // on-screen telegraphs for the overlay: { x, y, z, k (0..1), r, kind }
    this.frozen = false;
  }

  get count() {
    return this.list.length;
  }

  /** Living, non-ghost enemies (not counting the boss) */
  get threatCount() {
    let n = 0;
    for (const e of this.list) if (!e.ghost && !e.boss && e.state !== 'dying' && e.state !== 'launched') n++;
    return n;
  }

  spawn(type, x, z, opts = {}) {
    const sp = SPECIES[type];
    if (!sp) return null;
    const rig = this.rigs[type];
    if (this.countByType[type] >= rig.capacity - (opts.elite || opts.boss ? 0 : 1)) return null;
    if (this.list.length >= this.capacity && !opts.boss) return null;
    const e = this.pool.pop() || new Enemy(this.list.length);
    const g = this.game;
    e.alive = true;
    e.type = type;
    e.sp = sp;
    e.x = x;
    e.z = z;
    e.y = sp.flyer ? (opts.y ?? 16 + Math.random() * 5) : 0;
    e.vx = 0; e.vz = 0; e.vy = 0;
    e.elite = opts.elite ? 1 : 0;
    e.boss = !!opts.boss;
    e.scale = (opts.scale ?? (e.elite ? 1.3 : 1)) * (sp.size || 1) * (0.93 + Math.random() * 0.14);
    e.maxHp = sp.hp * this.hpMult * (opts.hpMult ?? (e.elite ? 3.2 : 1));
    e.hp = e.maxHp;
    e.speed = sp.close * this.speedMult * (opts.speedMult ?? 1) * (0.9 + Math.random() * 0.2);
    e.radius = sp.radius * e.scale;
    e.heading = opts.heading ?? Math.random() * Math.PI * 2;
    e.state = opts.state || 'run';
    e.stateT = 0;
    e.animT = Math.random() * 10;
    e.flash = 0;
    e.stone = 0;
    e.attackCd = 1.2 + Math.random() * 1.5;
    e.abilityCd = 6 + Math.random() * 3;
    e.offA = Math.random() * Math.PI * 2;
    e.knock = 0;
    e.spin = 0;
    e.pitch = 0;
    e.roll = 0;
    e.jaw = 0;
    e.burn = 0;
    e.slowT = 0;
    e.flinch = 0;
    e.staggerAcc = 0;
    e.seenT = 0;
    e.onScreen = false;
    e.token = false;
    e.charges = 0;
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
    // Per-individual look: a slight brightness / hue shift so a pack doesn't read as clones (scale varies above)
    const v = 0.9 + Math.random() * 0.2, hshift = (Math.random() - 0.5) * 0.12;
    e.tint = e.tint || [1, 1, 1];
    e.tint[0] = v * (1 + hshift); e.tint[1] = v; e.tint[2] = v * (1 - hshift);
    e.flinchPrev = 0; e.flashPrev = 0;
    if (e.anim) { e.anim.a = -1; e.anim.w = 0; e.anim.wc = 0; e.anim.key = null; }
    e.poseT = undefined;
    e.rx = x; e.rz = z;
    e.moveSpeed = 0;
    e.gait = 0;
    e.frozenLift = 0;
    e.mode = null;
    e.kind = sp.flyer ? 'fly' : 'merge';
    e.vs = 0;
    e.s = 0; e.d = 0;
    e.gap = -999;
    e.slotGap = sp.gaps ? sp.gaps[0] + (sp.gaps[1] - sp.gaps[0]) * Math.random() : -15;
    e.slotD = 0;
    e.hoverGap = -16 - Math.random() * 8;
    e.hoverD = (Math.random() - 0.5) * 10;
    e.hoverY = 7 + Math.random() * 4;
    e.bx = x; e.by = 1; e.bz = z; e.hx = x; e.hy = 1; e.hz = z;
    if (!sp.flyer && !e.ctrl) {
      // Already on the roadway? Start in route space directly
      const p = g.player;
      const s = g.route.project(x, z, p.s, 160);
      const r = g.route.sample(s, _s);
      const d = (x - r.x) * r.rx + (z - r.z) * r.rz;
      if (Math.abs(d) < r.halfWidth + 0.5 || opts.onRoad) this._toRoute(e, s, THREE.MathUtils.clamp(d, -r.halfWidth + 1, r.halfWidth - 1));
    }
    if (opts.slotGap !== undefined) e.slotGap = opts.slotGap;
    this._pickSlot(e);
    this.list.push(e);
    this.countByType[type]++;
    return e;
  }

  _toRoute(e, s, d) {
    e.kind = 'chase';
    e.s = s;
    e.d = d;
    e.vs = this.game.player.speed;
  }

  _pickSlot(e) {
    const r = this.game.route.sample(this.game.player.s, _s);
    const w = Math.max(2, r.halfWidth - 1.2 - e.radius * 0.5);
    e.slotD = (Math.random() * 2 - 1) * w;
    const sp = e.sp;
    if (sp.gaps) e.slotGap = sp.gaps[0] + (sp.gaps[1] - sp.gaps[0]) * Math.random();
  }

  /**
   * Creature audio that isn't tied to an attack: a charging Hornwall drags a stampede loop along (follows it in 3D),
   * heavy walkers thud when they're close, and pack hunters call to each other now and then.
   */
  _sounds(e, dt, p) {
    const g = this.game;
    const a = g.audio;
    const sp = e.sp;
    const charging = e.state === 'charge' && !!sp.charger;
    if (charging !== !!e.stampede) {
      e.stampede = charging;
      if (charging) a.loopStart(e, 'stampede_loop', { follow: e, volume: 0.85, range: 120 });
      else a.loopStop(e, 0.6);
    }
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (sp.mass >= 4 && !sp.flyer && !charging && d < 45 && e.state !== 'stagger') {
      e.stepT = (e.stepT ?? Math.random()) - dt * (1.6 + Math.min(1.4, Math.abs(e.vs || p.speed || 0) * 0.06)) * (sp.mass > 10 ? 0.8 : 1);
      if (e.stepT <= 0) { e.stepT = 1; a.play('footstep_heavy', { x: e.x, z: e.z, volume: sp.mass > 10 ? 1 : 0.75, pitch: sp.mass > 10 ? 0.85 : 1 }); }
    }
    if ((e.type === 'raptor' || e.type === 'compy') && e.state === 'run' && d < 60) {
      e.callT = (e.callT ?? 2 + Math.random() * 6) - dt;
      if (e.callT <= 0) {
        e.callT = (e.type === 'raptor' ? 5 : 8) + Math.random() * 9;
        a.play(e.type === 'raptor' ? 'raptor_call' : 'compy_chirp', { x: e.x, z: e.z, volume: e.type === 'raptor' ? 0.8 : 0.5 });
      }
    }
  }

  _remove(i) {
    const e = this.list[i];
    if (e.stampede) { e.stampede = false; this.game.audio.loopStop(e, 0.3); }
    e.stepT = e.callT = undefined;
    if (e.token) { e.token = false; this.attackers--; }
    e.alive = false;
    this.countByType[e.type]--;
    const last = this.list.pop();
    if (i < this.list.length) this.list[i] = last;
    this.pool.push(e);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this._remove(i);
    this.attackers = 0;
  }

  _releaseToken(e) {
    if (e.token) { e.token = false; this.attackers = Math.max(0, this.attackers - 1); }
  }

  /**
   * Deals damage. opts: { crit, kx, kz (knockback impulse), source, noNumber, explosive, stagger (0..), head }
   * Returns true if the hit killed it.
   */
  damage(e, amount, opts = {}) {
    if (!e.alive || e.ghost || e.state === 'dying' || (e.state === 'launched' && e.hp <= 0)) return false;
    let a = amount;
    if (e.sp.armor && !opts.explosive && !opts.head) a *= 1 - e.sp.armor;
    if (e.ctrl?.damageTaken) a = e.ctrl.damageTaken(e, a);
    e.hp -= a;
    const game = this.game;
    // Hit reaction: a white flash scaled by how much it hurt; aimed hits also make it flinch and stagger
    e.flash = Math.max(e.flash, Math.min(0.9, (a / e.maxHp) * 2.5 + (opts.stagger ? 0.35 : 0)));
    game.stats.damageDealt += a;
    if (opts.stagger && !e.boss && !e.ctrl) {
      const k = opts.stagger * (game.weapons?.staggerMult || 1);
      e.flinch = Math.min(1, e.flinch + (0.35 + (a / e.maxHp) * 2) * k);
      e.vs -= (3.5 / Math.max(0.6, e.sp.mass * e.scale * 0.6)) * k;
      if (e.state === 'windup' || e.state === 'leap' || e.state === 'charge' || e.state === 'dive') {
        e.staggerAcc += a * k;
        const need = e.maxHp * (e.sp.stagger ?? 0.0001) * (e.elite ? 1.4 : 1);
        if (e.staggerAcc >= need && e.hp > 0) this._stagger(e);
      }
    }
    if (!opts.noNumber && (opts.crit || a >= 15 || e.elite || e.boss || e.miniboss)) {
      e.numAcc = (e.numAcc || 0) + a;
      e.numCrit = e.numCrit || !!opts.crit;
      const now = game.elapsed;
      if (e.hp <= 0 || now - (e.numT ?? -1) > (e.boss ? 0.14 : 0.2)) {
        game.vfx.number(e.hx, e.hy + 0.6 * e.scale, e.hz, e.numAcc, e.numCrit ? 1 : 0);
        e.numAcc = 0;
        e.numCrit = false;
        e.numT = now;
      }
    }
    if ((opts.kx || opts.kz) && !e.ctrl) {
      const m = 1 / Math.max(0.3, e.sp.mass * e.scale);
      if (e.kind === 'chase') {
        const r = game.route.sample(e.s, _s);
        e.vs += (opts.kx * r.hx + opts.kz * r.hz) * m;
        e.dKnock = (opts.kx * r.rx + opts.kz * r.rz) * m;
      } else {
        e.vx += opts.kx * m;
        e.vz += opts.kz * m;
      }
      e.knock = Math.min(0.35, e.knock + 0.12);
    }
    if (e.hp <= 0) {
      this.kill(e, opts.source || 'weapon', opts);
      return true;
    }
    return false;
  }

  _stagger(e) {
    const g = this.game;
    const wasAttacking = e.state !== 'run';
    this._releaseToken(e);
    e.state = 'stagger';
    e.stateT = 0;
    e.staggerAcc = 0;
    e.flinch = 1;
    e.vy = Math.min(e.vy, 0);
    e.attackCd = 1.8 + Math.random() * 1.5;
    if (wasAttacking) {
      g.onStagger(e);
    }
  }

  kill(e, cause = 'weapon', opts = {}) {
    if (e.state === 'dying') return;
    e.hp = 0;
    this._releaseToken(e);
    const g = this.game;
    if (e.stampede) { e.stampede = false; g.audio.loopStop(e, 0.25); }
    if (opts.launch) {
      e.state = 'launched';
      e.vy = opts.vy ?? 9;
      if (e.kind === 'chase') { e.kind = 'merge'; e.vx = (opts.lx ?? 0); e.vz = (opts.lz ?? 0); }
      else { e.vx = opts.lx ?? e.vx; e.vz = opts.lz ?? e.vz; }
      e.spin = (Math.random() - 0.5) * 12;
    } else {
      e.state = 'dying';
    }
    e.stateT = 0;
    g.onEnemyKilled(e, cause, opts);
  }

  _finishDeath(i) {
    const e = this.list[i];
    const g = this.game;
    const big = e.sp.mass * e.scale > 3;
    const h = e.sp.height * e.scale;
    const glow = e.elite ? [4, 0.8, 3.5] : [0.4, 3, 3.6];
    g.vfx.shatter(e.x, Math.max(0, e.y) + h * 0.25, e.z, e.radius * (e.sp.flyer ? 0.8 : 1), big, ...glow);
    g.audio.play(big ? 'shatter_big' : 'fossilize', { x: e.x, z: e.z, volume: big ? 1 : 0.6, pitch: 1.4 - Math.min(0.6, e.radius * 0.2) });
    if (big) g.cam.addTrauma(0.15);
    g.dropLoot(e);
    this._remove(i);
  }

  // ------------------------------------------------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const p = g.player;
    const list = this.list;
    const hash = this.hash;
    hash.clear();
    for (let i = 0; i < list.length; i++) if (list[i].state !== 'dying' && !list[i].ghost) hash.insert(list[i]);
    this.attackGrace = Math.max(0, this.attackGrace - dt);
    this.dangers.length = 0;
    const cam = g.cam.camera;

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
      e.flash = Math.max(0, e.flash - dt * 8);
      e.flinch = Math.max(0, e.flinch - dt * 3.5);
      e.knock = Math.max(0, e.knock - dt);
      e.attackCd -= dt;
      e.abilityCd -= dt;
      e.sawCd -= dt;
      e.flameCd -= dt;
      e.jaw = Math.max(0, e.jaw - dt * 2);

      // --- Death & launch ------------------------------------------------------------------------------------
      if (e.state === 'dying') {
        e.stone = Math.min(1, e.stateT / 0.2);
        if (e.kind === 'chase') { e.vs += (p.speed * 0.6 - e.vs) * Math.min(1, dt * 3); this._routeMove(e, dt); }
        if (sp.flyer && e.y > 0) { e.vy -= 30 * dt; e.y = Math.max(0, e.y + e.vy * dt); e.x += e.vx * dt * 0.5; e.z += e.vz * dt * 0.5; }
        if (e.stateT > 0.26 && (!sp.flyer || e.y <= 0.5 || e.stateT > 1.0)) this._finishDeath(i);
        continue;
      }
      if (e.state === 'launched') {
        e.stone = Math.min(1, e.stateT / 0.3);
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
        if (Math.random() < dt * 8) g.vfx.glow.spawn(e.x + (Math.random() - 0.5) * e.radius, e.y + Math.random() * sp.height * e.scale, e.z + (Math.random() - 0.5) * e.radius, 0, 2.5, 0, 0.35, 0.5, 0.1, 6, 2, 0.3);
        if (Math.random() < dt * 3) { if (this.damage(e, g.weapons.burnDps * 0.33, { source: 'flamer' })) continue; }
      }
      if (e.slowT > 0) e.slowT -= dt;

      // --- Behaviour by locomotion kind ------------------------------------------------------------------------
      if (e.kind === 'fly') this._updateFlyer(e, dt, p);
      else if (e.kind === 'merge') this._updateMerge(e, dt, p);
      else this._updateChase(e, dt, p);
      if (!e.alive) continue;
      this._sounds(e, dt, p);

      // Recycle stragglers that fell far behind (or got stuck off the road)
      if (e.spawnT > 3 && !e.boss) {
        const dist = Math.hypot(p.x - e.x, p.z - e.z);
        if ((e.kind === 'chase' && (e.gap < -120 || e.gap > 40)) || dist > 170 || (e.kind === 'merge' && e.spawnT > 22)) {
          this._remove(i);
          continue;
        }
      }

      // Hit spheres (body + head) from the rest-pose offsets, following heading, flinch and lift
      const H = this.hitLocal[e.type];
      const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
      const back = e.flinch * 0.25 * e.scale;
      e.bx = e.x + fx * (H.bf * e.scale - back * 0.5); e.by = e.y + H.by * e.scale; e.bz = e.z + fz * (H.bf * e.scale - back * 0.5);
      e.hx = e.x + fx * (H.hf * e.scale - back); e.hy = e.y + (H.hy + (sp.flyer ? 0 : e.flinch * 0.15)) * e.scale; e.hz = e.z + fz * (H.hf * e.scale - back);
      if (sp.flyer) { e.hx = e.x + fx * H.hf * e.scale * 0.8; e.hz = e.z + fz * H.hf * e.scale * 0.8; e.hy = e.y + 0.2 * e.scale; e.by = e.y; }

      // On screen? (attacks need it; the bot and the overlay use it too)
      _v.set(e.bx, e.by, e.bz).project(cam);
      e.onScreen = _v.z < 1 && Math.abs(_v.x) < 0.94 && Math.abs(_v.y) < 0.94;
      e.seenT = e.onScreen ? e.seenT + dt : Math.max(0, e.seenT - dt * 2);
      e.sx = _v.x; e.sy = _v.y;

      // Telegraph rings for the overlay
      if (e.state === 'windup' || e.state === 'dive' || (e.state === 'charge' && sp.charger)) {
        const T = e.windT || 1;
        const k = e.state === 'windup' ? Math.min(1, e.stateT / T) : 1;
        this.dangers.push({ x: e.hx, y: e.hy, z: e.hz, k, r: Math.max(0.6, sp.headR * e.scale * 2.2), e });
      }
    }
    this._separate();
  }

  /** May this enemy start an attack now? */
  _canAttack(e) {
    return e.attackCd <= 0 && !e.token && this.attackGrace <= 0 && this.attackers < this.maxAttackers && e.seenT > 0.9 && e.spawnT > 1.5 && this.game.player.alive && this.game.state === 'playing';
  }

  _takeToken(e) {
    e.token = true;
    this.attackers++;
  }

  _routeMove(e, dt) {
    const g = this.game;
    e.s = g.route.wrap(e.s + e.vs * dt);
    if (e.dKnock) { e.d += e.dKnock * dt * 4; e.dKnock *= Math.max(0, 1 - dt * 6); }
    const r = g.route.sample(e.s, _s);
    const lim = r.halfWidth - 0.6;
    if (e.d > lim) e.d = lim; else if (e.d < -lim) e.d = -lim;
    const nx = r.x + r.rx * e.d, nz = r.z + r.rz * e.d;
    e.vx = (nx - e.x) / Math.max(dt, 1e-4);
    e.vz = (nz - e.z) / Math.max(dt, 1e-4);
    if (Math.hypot(e.vx, e.vz) > 80 || dt === 0) { e.vx = r.hx * e.vs; e.vz = r.hz * e.vs; }
    e.x = nx; e.z = nz;
    e.rhx = r.hx; e.rhz = r.hz;
    e.gap = g.route.delta(g.player.s, e.s);
  }

  _updateChase(e, dt, p) {
    const g = this.game;
    const sp = e.sp;
    const vfx = g.vfx;
    const gap = g.route.delta(p.s, e.s);
    e.gap = gap;
    const contact = -(CAR_REAR + e.radius * 0.9);
    let targetGap = e.slotGap;
    let rel; // speed relative to the cab
    let lat = e.slotD + Math.sin(e.animT * 0.9 + e.offA) * 0.8;
    const slow = e.slowT > 0 ? 0.55 : 1;
    switch (e.state) {
      case 'run': {
        const err = targetGap - gap;
        // Sprint in from far back, then settle into the slot
        rel = THREE.MathUtils.clamp(err * 1.1, -6, e.speed * slow * (err > 10 ? 1.8 : 1));
        if (e.attackCd <= 0 && Math.abs(err) < 6 && this._canAttack(e)) {
          this._takeToken(e);
          e.state = 'windup';
          e.stateT = 0;
          e.staggerAcc = 0;
          e.windT = sp.wind * this.windMult * (e.elite ? 0.85 : 1);
          e.laneD = p.d;
          g.onTelegraph(e);
          g.audio.play(sp.sound, { x: e.x, z: e.z, volume: 0.75, pitch: 0.95 + Math.random() * 0.15 });
        }
        // Alpha mini-boss: howls up the pack now and then
        if (e.behavior === 'alpha' && e.abilityCd <= 0) {
          e.abilityCd = 10;
          g.audio.play('brute_growl', { x: e.x, z: e.z, pitch: 0.8, volume: 1.2 });
          vfx.shockwave(e.x, e.z, 12, 4, 0.8, 3.5, 0.7);
          for (let k = 0; k < 3; k++) g.director.spawnChaser('raptor', k % 2 ? 'left' : 'right');
        }
        break;
      }
      case 'windup': {
        // Hold position, crouch / paw / growl. Chargers show their lane on the asphalt.
        rel = THREE.MathUtils.clamp((targetGap - gap) * 1.5, -3, 3);
        e.jaw = 0.6;
        lat = e.d;
        if (sp.charger) {
          const r = g.route.sample(e.s, _s);
          vfx.telegraphLane(e.x, e.z, r.heading, Math.max(4, -gap), e.radius * 2, e.stateT / e.windT);
          if (Math.random() < dt * 10) vfx.dust(e.x - r.hx * e.radius, e.z - r.hz * e.radius, 0.6, 1);
        } else if (sp.swipe) {
          vfx.telegraphCircle(e.x, e.z, 4.5 * e.scale, e.stateT / e.windT, 5, 0.9, 0.2);
        }
        if (e.stateT > e.windT) {
          e.stateT = 0;
          e.staggerAcc *= 0.5;
          if (sp.charger) { e.state = 'charge'; g.audio.play('stomp', { x: e.x, z: e.z, volume: 0.9 }); }
          else if (sp.swipe) {
            // Tail swipe at the tailgate
            g.audio.play('tail_swipe', { x: e.x, z: e.z });
            vfx.shockwave(e.x, e.z, 4.5 * e.scale, 3, 2, 0.6);
            if (gap > contact - 6) this._land(e, 'swipe');
            this._endAttack(e, 1.0);
          } else {
            e.state = 'leap';
            e.vy = 5.2 + e.scale;
            g.audio.play(sp.sound, { x: e.x, z: e.z, volume: 0.8, pitch: 1.1 + Math.random() * 0.2 });
          }
        }
        break;
      }
      case 'leap': {
        // Pounce at the tailgate / the gunner: a fast arc that ends on the cab
        rel = 17 + e.scale * 2;
        lat = p.d * 0.6;
        e.vy -= 16 * dt;
        e.y = Math.max(0, e.y + e.vy * dt);
        e.jaw = 1;
        if (gap >= contact) { this._land(e, 'pounce'); this._endAttack(e, 1); }
        else if (e.stateT > 1.6) this._endAttack(e, 0.5);
        break;
      }
      case 'charge': {
        rel = 15 + (e.elite ? 3 : 0);
        lat = e.laneD;
        if (Math.random() < dt * 14) vfx.dust(e.x, e.z, 0.8, 1);
        if (gap >= contact) { this._land(e, 'charge'); this._endAttack(e, 1.4); }
        else if (e.stateT > 4) this._endAttack(e, 0.5);
        break;
      }
      case 'recoil':
        rel = -9;
        if (e.stateT > 0.75) { e.state = 'run'; e.stateT = 0; this._pickSlot(e); }
        break;
      case 'stagger':
        rel = -6 * (1 - e.stateT / 0.7);
        e.y = Math.max(0, e.y - dt * 8);
        if (e.stateT > 0.7) { e.state = 'run'; e.stateT = 0; }
        break;
      default:
        rel = 0;
    }
    // Integrate along the route
    const targetVs = Math.max(0, p.speed + rel);
    e.vs += (targetVs - e.vs) * Math.min(1, dt * (e.state === 'leap' || e.state === 'charge' ? 8 : 3 + 2 / Math.max(0.5, sp.mass)));
    e.d += THREE.MathUtils.clamp(lat - e.d, -1, 1) * Math.min(1, dt * 3.5) * (e.state === 'leap' ? 3 : 1);
    if (e.y > 0 && e.state !== 'leap') e.y = Math.max(0, e.y - dt * 6);
    this._routeMove(e, dt);
    // Never inside the cab
    if (e.gap > contact + 0.5 && e.state !== 'leap') {
      e.s = g.route.wrap(p.s + contact + 0.5);
      e.vs = Math.min(e.vs, p.speed);
    }
    // Face the cab
    const dx = p.x - e.x, dz = p.z - e.z;
    let dh = Math.atan2(dx, dz) - e.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    e.heading += dh * Math.min(1, dt * (e.state === 'windup' ? 14 : 8));
    e.moveSpeed = e.state === 'leap' ? 0 : Math.min(12, Math.max(1.5, e.vs));
    e.pitch = -e.flinch * 0.32;
    e.roll = e.state === 'stagger' ? Math.sin(e.stateT * 20) * 0.12 * (1 - e.stateT / 0.7) : 0;
  }

  _land(e, kind) {
    const g = this.game;
    const m = e.elite ? 1.4 : 1;
    g.hurtPlayer(e.sp.dmg * this.dmgMult * m, e.x, e.z, kind, e);
    e.jaw = 1;
  }

  _endAttack(e, cd) {
    this._releaseToken(e);
    e.state = 'recoil';
    e.stateT = 0;
    e.attackCd = (2.6 + Math.random() * 2) * cd / Math.max(0.6, this.windMult);
  }

  _updateMerge(e, dt, p) {
    // Off-road (side street, storefront): run toward the slot behind the cab, sliding along walls
    const g = this.game;
    const r = g.route.sample(p.s + e.slotGap, _s);
    const tx = r.x + r.rx * e.slotD, tz = r.z + r.rz * e.slotD;
    const L = Math.hypot(tx - e.x, tz - e.z) || 1;
    const sp = (e.speed + 9 + p.speed * 0.6) * (e.slowT > 0 ? 0.55 : 1) * (e.state === 'stagger' ? 0.2 : 1);
    if (e.state === 'stagger' && e.stateT > 0.7) { e.state = 'run'; e.stateT = 0; }
    if (e.state !== 'run' && e.state !== 'stagger') { e.state = 'run'; }
    e.vx += ((tx - e.x) / L * sp - e.vx) * Math.min(1, dt * 4);
    e.vz += ((tz - e.z) / L * sp - e.vz) * Math.min(1, dt * 4);
    const tmp = this._tmp;
    g.walk.move(e.x, e.z, e.vx * dt, e.vz * dt, tmp);
    if (tmp.hit) { e.stuck += dt; if (e.stuck > 1.2) { e.slotD = -e.slotD; e.stuck = 0; } } else e.stuck = Math.max(0, e.stuck - dt);
    e.x = tmp.x; e.z = tmp.z;
    if (e.y > 0) e.y = Math.max(0, e.y - dt * 6);
    const vsp = Math.hypot(e.vx, e.vz);
    if (vsp > 0.5) {
      let dh = Math.atan2(e.vx, e.vz) - e.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      e.heading += dh * Math.min(1, dt * 10);
    }
    e.moveSpeed = vsp;
    e.pitch = -e.flinch * 0.32;
    // Reached the roadway: switch to route space
    const s = g.route.project(e.x, e.z, p.s + e.slotGap, 80);
    const rr = g.route.sample(s, _s);
    const d = (e.x - rr.x) * rr.rx + (e.z - rr.z) * rr.rz;
    if (Math.abs(d) < rr.halfWidth - 0.5) {
      this._toRoute(e, s, d);
      e.vs = Math.max(0, e.vx * rr.hx + e.vz * rr.hz);
      e.gap = g.route.delta(p.s, s);
    }
  }

  _updateFlyer(e, dt, p) {
    const g = this.game;
    const vfx = g.vfx;
    const fx = p.fx, fz = p.fz, rx = p.rx, rz = p.rz;
    const eye = g.cam.camera.position;
    if (e.state === 'run' || e.state === 'stagger' || e.state === 'recover') {
      // Circle around a hover point behind the cab
      const ang = e.animT * 0.8 + e.offA;
      const hg = e.hoverGap + Math.sin(ang * 0.7) * 3;
      const tx = p.x + fx * hg + rx * (e.hoverD + Math.cos(ang) * 4);
      const tz = p.z + fz * hg + rz * (e.hoverD + Math.cos(ang) * 4);
      const ty = e.hoverY + Math.sin(e.animT * 1.4 + e.offA) * 1.2 + (e.state === 'recover' ? 4 : 0);
      const L = Math.hypot(tx - e.x, tz - e.z) || 1;
      const close = Math.min(e.speed * 2.2, L * 1.2);
      const k = Math.min(1, dt * (e.state === 'stagger' ? 0.8 : 2.2));
      e.vx += (p.vx + (tx - e.x) / L * close - e.vx) * k;
      e.vz += (p.vz + (tz - e.z) / L * close - e.vz) * k;
      e.y += (ty - e.y) * Math.min(1, dt * 1.6);
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      const rvx = e.vx - p.vx, rvz = e.vz - p.vz;
      e.heading = Math.hypot(rvx, rvz) > 2 ? Math.atan2(rvx, rvz) : Math.atan2(p.x - e.x, p.z - e.z);
      e.roll = THREE.MathUtils.clamp((rvx * Math.cos(e.heading) - rvz * Math.sin(e.heading)) * 0.05, -0.6, 0.6);
      e.pitch = -e.flinch * 0.4;
      if (e.state !== 'run' && e.stateT > 0.9) { e.state = 'run'; e.stateT = 0; }
      if (e.state === 'run' && L < 12 && this._canAttack(e)) {
        this._takeToken(e);
        e.state = 'windup';
        e.stateT = 0;
        e.staggerAcc = 0;
        e.windT = e.sp.wind * this.windMult * (e.elite ? 0.85 : 1);
        g.onTelegraph(e);
        g.audio.play('ptero_cry', { x: e.x, z: e.z, volume: 0.9 });
      }
    } else if (e.state === 'windup') {
      // Hang in the air screeching, dropping toward eye level so it stays in the gunner's view
      // (danger ring drawn by the overlay)
      e.vx += (p.vx - e.vx) * Math.min(1, dt * 3);
      e.vz += (p.vz - e.vz) * Math.min(1, dt * 3);
      e.x += e.vx * dt; e.z += e.vz * dt;
      e.y += (Math.min(e.hoverY, eye.y + 3.5) - e.y) * Math.min(1, dt * 2.5);
      e.heading = Math.atan2(eye.x - e.x, eye.z - e.z);
      e.pitch = -0.35 - e.flinch * 0.3;
      e.jaw = 0.6;
      if (e.stateT > e.windT) {
        e.state = 'dive';
        e.stateT = 0;
        e.sx0 = e.x - p.x; e.sy0 = e.y; e.sz0 = e.z - p.z;
        e.staggerAcc *= 0.5;
      }
    } else if (e.state === 'dive') {
      // Swoop down to eye level ~8 m behind the cab, then straight at the gunner's face (relative to the moving cab):
      // it grows in the middle of the screen instead of leaving through the top edge
      const T = 0.9;
      const u = Math.min(1, e.stateT / T);
      const ex = eye.x - p.x, ey = eye.y, ez = eye.z - p.z;
      const wx = ex - p.fx * 8, wz = ez - p.fz * 8; // waypoint 8 m behind the eye
      const wy = ey + 0.4;
      let nx, ny, nz;
      if (u < 0.5) {
        const k = u / 0.5, ek = 1 - (1 - k) * (1 - k);
        nx = e.sx0 + (wx - e.sx0) * ek; ny = e.sy0 + (wy - e.sy0) * ek; nz = e.sz0 + (wz - e.sz0) * ek;
      } else {
        const k = (u - 0.5) / 0.5, ek = k * k;
        nx = wx + (ex - wx) * ek; ny = wy + (ey - 0.25 - wy) * ek; nz = wz + (ez - wz) * ek;
      }
      nx += p.x; nz += p.z;
      e.vx = (nx - e.x) / Math.max(dt, 1e-3); e.vz = (nz - e.z) / Math.max(dt, 1e-3);
      e.x = nx; e.y = ny; e.z = nz;
      e.heading = Math.atan2(eye.x - e.x, eye.z - e.z);
      e.pitch = u < 0.5 ? 0.35 : 0.05;
      e.jaw = 1;
      if (u >= 1) {
        this._land(e, 'dive');
        g.onWindowHit?.(e);
        this._releaseToken(e);
        e.state = 'recover';
        e.stateT = 0;
        e.attackCd = 3.5 + Math.random() * 2.5;
        e.vx = p.vx + p.rx * (Math.random() < 0.5 ? -14 : 14);
        e.vz = p.vz + p.rz * (Math.random() < 0.5 ? -14 : 14);
      }
    }
    if (e.state === 'stagger') {
      e.y = Math.max(4, e.y - dt * 4);
    }
    e.moveSpeed = 6;
    void vfx;
  }

  _separate() {
    // Cheap pairwise separation for the (few) pursuers, in route space for chasers
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.ctrl || a.state === 'dying' || a.state === 'launched' || a.kind === 'fly') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.ctrl || b.state === 'dying' || b.state === 'launched' || b.kind === 'fly') continue;
        const dx = a.x - b.x, dz = a.z - b.z;
        const rr = (a.radius + b.radius) * 0.95;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5;
        const wa = b.sp.mass / (a.sp.mass + b.sp.mass), wb = 1 - wa;
        const nx = dx / d, nz = dz / d;
        if (a.kind === 'chase') { const r = this.game.route.sample(a.s, _s); a.s += (nx * r.hx + nz * r.hz) * push * wa; a.d += (nx * r.rx + nz * r.rz) * push * wa; }
        else { a.x += nx * push * wa; a.z += nz * push * wa; }
        if (b.kind === 'chase') { const r = this.game.route.sample(b.s, _s); b.s -= (nx * r.hx + nz * r.hz) * push * wb; b.d -= (nx * r.rx + nz * r.rz) * push * wb; }
        else { b.x -= nx * push * wb; b.z -= nz * push * wb; }
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  /**
   * First hit along a ray (the gunner's crosshair). Returns { e, t, head, weak } or null.
   * The boss supplies its own spheres (weak points first) through its controller.
   */
  raycast(ray, maxDist = 220, out = {}, skip = null, seen = null) {
    let best = null, bt = maxDist, head = false, weak = 1;
    for (const e of this.list) {
      if (e.state === 'dying' || e.state === 'launched' || e.ghost || e === skip || seen?.has(e)) continue;
      if (e.ctrl) {
        const h = e.ctrl.raycast?.(e, ray, bt);
        if (h && h.t < bt) { bt = h.t; best = e; head = h.weak > 1; weak = h.weak; }
        continue;
      }
      // far individuals are drawn larger (render: e.vis, scaled about the feet); the hit spheres follow
      const v = e.vis || 1;
      const hr = e.sp.headR * e.scale * 1.25 * v;
      const th = raySphere(ray, e.x + (e.hx - e.x) * v, e.y + (e.hy - e.y) * v, e.z + (e.hz - e.z) * v, hr);
      const br = Math.max(e.radius * 0.95, e.sp.height * e.scale * 0.42) * v;
      const tb = raySphere(ray, e.x + (e.bx - e.x) * v, e.y + (e.by - e.y) * v, e.z + (e.bz - e.z) * v, br);
      if (th < bt && th <= tb + hr) { bt = th; best = e; head = true; weak = 1.6; }
      else if (tb < bt) { bt = tb; best = e; head = false; weak = 1; }
    }
    if (!best) return null;
    out.e = best; out.t = bt; out.head = head; out.weak = weak;
    return out;
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
      if (e.state === 'dying' || e.state === 'launched' || !e.alive) return;
      if ((e.x - x) ** 2 + (e.z - z) ** 2 < (r + e.radius) ** 2) out.push(e);
    });
    return out;
  }

  render(time) {
    const cam = this.game.cam?.camera;
    // Minimum on-screen size: an individual whose height would cover less than MIN_SCREEN of the view height is drawn
    // up to MAX_BOOST larger (far stragglers and fresh spawns never shrink to specks; raycast() scales its spheres too)
    const fovK = cam ? 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) : 0;
    for (const id of SPECIES_IDS) {
      const rig = this.rigs[id];
      if (rig.skinned && cam) rig.setView(cam);
      rig.begin();
    }
    for (const e of this.list) {
      const rig = this.rigs[e.type];
      const pose = this.poses[e.type];
      if (rig.skinned) {
        if (e.ctrl) {
          const lift = e.ctrl.animate(e, rig, time);
          rig.add(e.rx, lift * e.scale, e.rz, e.heading, e.scale, e.anim, e.flash, e.stone, 0, e.pitch, e.roll, e.tint, (e.teleK || 0) * (0.5 + 0.5 * Math.sin(time * 24)));
          e.ctrl.afterAdd(rig);
          continue;
        }
        animateCreature(e, rig, time, cam?.position);
        const tele = e.state === 'windup' ? 0.55 + 0.45 * Math.sin(time * 30) : 0;
        e.vis = cam ? minScreenBoost(e, cam.position, fovK) : 1;
        rig.add(e.x, e.y, e.z, e.heading, e.scale * e.vis, e.anim, e.flash, e.stone, e.elite ? 1 : 0, e.pitch, e.roll, e.tint, tele);
        continue;
      }
      if (e.ctrl) {
        const lift = e.ctrl.pose(e, pose, rig.partIndex, time);
        rig.add(e.rx, lift * e.scale, e.rz, e.heading, e.scale, pose, e.flash, e.stone, 0, e.pitch, e.roll);
        e.ctrl.afterAdd(rig);
        continue;
      }
      const lift = poseCreature(e.type, e, pose, rig.partIndex, time);
      // Telegraph: elites keep their magenta rim; attackers pulse red-hot through the flash channel
      const tele = e.state === 'windup' ? 0.25 + 0.25 * Math.sin(time * 30) : 0;
      rig.add(e.x, e.y + lift * e.scale, e.z, e.heading, e.scale, pose, Math.max(e.flash, tele), e.stone, e.elite ? 1 : 0, e.pitch, e.roll);
    }
    for (const id of SPECIES_IDS) this.rigs[id].end();
  }
}

const MIN_SCREEN = 0.05, MAX_BOOST = 1.45;
/** Visual scale factor (>= 1) that keeps a creature at least MIN_SCREEN of the view height tall */
function minScreenBoost(e, camPos, fovK) {
  const h = e.sp.flyer ? e.radius * 1.4 : e.sp.height * e.scale;
  const d = Math.max(1, Math.hypot(e.x - camPos.x, e.y - camPos.y, e.z - camPos.z));
  const frac = h / (d * fovK);
  return frac >= MIN_SCREEN ? 1 : Math.min(MAX_BOOST, MIN_SCREEN / frac);
}

export { EnemyManager, minScreenBoost, MIN_SCREEN, MAX_BOOST, SPECIES, SPECIES_IDS, SpatialHash, CAR_RADIUS, CAR_REAR, raySphere };
