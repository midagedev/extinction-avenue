import * as THREE from 'three/webgpu';
import { PropBatch } from './batches.js';
import { setJoint } from './poses.js';
import { raySphere } from './enemies.js';
import { AnimState, clipOf } from './creature-anim.js';

// js/game/boss.js
// GRIDLOCK — Cretagen Apex Specimen T-01, a Tyrannosaurus rex in a cracked containment collar.
//
// A first-person chase. The boss lives on the route like the cab, at (arc length bs, lateral offset bd), and runs down
// the avenue behind it — straight into the rear gunner's view. Three phases (100-66-33 %):
//   1  CHASE      — lunges at the tailgate (telegraphed: crouch, jaws, a red danger ring around its collar) and hurls
//                   wrecked cars in high arcs. Shoot the wrecks out of the air.
//   2  ENRAGED    — adds FLANK runs: it pulls up alongside the cab and the gunner's view swings to face it before it
//                   head-butts the door; it roars up raptor packs.
//   3  DESPERATE  — adds the HEAD-ON charge: it overtakes, turns around ahead of the cab and charges; the view swings
//                   forward over the hood. Faster telegraphs, the collar overloads (×3.5).
// Every attack can be STOPPED: land enough damage during the telegraph (the collar counts ×2.5/×3.5) and it staggers,
// the attack is cancelled and it takes +50% damage for a moment. Weak points: the collar (×2.5), the head (×1.3), the
// thighs (×1.2). Death: hit-stop, slow motion, orbit camera; it topples, turns to stone and shatters.
// Also: cameo() — an invulnerable teaser where it crosses the street behind the cab in the first minute.

const SCALE = 1.55;
const _s = {};
const _v = new THREE.Vector3();
const COLLAR_LOCAL = new THREE.Vector3(0, 0.27, 0.42); // neck-local collar centre (model units, see dino-models.js)
const THIGH_LOCAL = new THREE.Vector3(0, -0.6, 0.2);
// Sockets on the rigged T. rex (geometry-space offsets from the joints of tools/lab/rig-theropod.js)
const SK = {
  collar: new THREE.Vector3(0, 0.27, 0.2), // neck1 → the collar ring (buildCollar)
  head: new THREE.Vector3(0, -0.12, 0.62), // head → middle of the skull
  thighL: new THREE.Vector3(0.08, -0.45, 0.12), thighR: new THREE.Vector3(-0.08, -0.45, 0.12),
  body: new THREE.Vector3(0, 0.1, 0), // spine
  chest: new THREE.Vector3(0, -0.25, 0.15) // chest
};
const HERO_LOOK = new Set(['intro', 'roar', 'cameo', 'lunge_tele', 'flank_tele', 'charge_tele', 'chase']);
const WRECK_HP = 70;

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
    this.bodyPos = new THREE.Vector3();
    this.chestPos = new THREE.Vector3();
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
  /** Finds a cross street (searching from `from` toward `to`): arc length where both sides are open ground */
  _findIntersection(from, to) {
    const g = this.game;
    const step = to > from ? 3 : -3;
    for (let s = from; step > 0 ? s < to : s > to; s += step) {
      const r = g.route.sample(s, _s);
      let ok = true;
      for (const lat of [-34, -24, -16, 16, 24, 34]) {
        if (g.walk.isBlocked(r.x + r.rx * lat, r.z + r.rz * lat)) { ok = false; break; }
      }
      if (ok) return s;
    }
    return null;
  }

  /** Teaser: it crosses the street behind the cab, roars at you, and walks off */
  cameo() {
    const g = this.game;
    if (this.e) return;
    const p = g.player;
    const s = this._findIntersection(p.s - 40, p.s - 110);
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
    // Clear the street so the reveal reads; cores fly to the cab
    for (let i = g.enemies.list.length - 1; i >= 0; i--) {
      if (!g.enemies.list[i].boss) g.enemies._remove(i);
    }
    g.pickups.collectAll();
    const bs = p.s - 42;
    const r = g.route.sample(bs, _s);
    const e = g.enemies.spawn('trex', r.x, r.z, { boss: true, scale: SCALE, ctrl: this, heading: r.heading, hpMult: 1 });
    if (!e) return;
    e.scale = SCALE;
    e.maxHp = e.hp = 30000 * (1 + Math.max(0, g.director.time - g.director.bossTime) / 900);
    e.mode = 'intro';
    e.bs = bs;
    e.bd = 0;
    e.phase = 1;
    e.v = 0;
    e.atkCd = 2.5;
    e.combo = 0;
    e.teleDmg = 0;
    e.vuln = 0;
    e.name = 'GRIDLOCK';
    e.flankSide = 1;
    this.e = e;
    this.active = true;
    for (let k = 0; k < 6; k++) g.vfx.dust(r.x + (Math.random() - 0.5) * 10, r.z + (Math.random() - 0.5) * 10, 3, 4);
    g.cam.addTrauma(0.8);
    g.audio.play('shatter_big', { volume: 1, pitch: 0.5 });
    g.audio.play('trex_roar', { volume: 1.2, pitch: 0.92, dur: 3.0 });
    g.audio.setMusic('boss');
    g.bossIntro(e);
  }

  /** Damage filter for every hit on the boss: the stagger window adds +50 %, telegraph damage builds toward a stagger */
  damageTaken(e, a) {
    if (e !== this.e) return a;
    if (e.vuln > 0) a *= 1.5;
    if (this._telegraphing(e)) {
      e.teleDmg += a;
      if (e.teleDmg >= this._staggerNeed(e)) this._stagger(e);
    }
    return a;
  }

  _telegraphing(e) {
    return e.mode === 'lunge_tele' || e.mode === 'flank_tele' || e.mode === 'charge_tele' || e.mode === 'charge';
  }

  _staggerNeed(e) {
    return e.maxHp * (e.phase === 3 ? 0.03 : 0.026);
  }

  /** Ray test against the weak points and the body. Returns { t, weak } or null */
  raycast(e, ray, maxT) {
    if (e.mode === 'cameo' || e.state === 'dying') return null;
    const P = e.phase || 1;
    let bt = maxT, weak = 0;
    const test = (c, r, w, bias = 0) => {
      const t = raySphere(ray, c.x, c.y, c.z, r);
      if (t - bias < bt) { bt = Math.max(0.01, t - bias); weak = w; }
    };
    test(this.bodyPos, 2.3 * SCALE * 0.75, 1);
    test(this.chestPos, 1.7 * SCALE * 0.75, 1);
    for (const th of this.thighs) test(th, 1.05 * SCALE, 1.2);
    test(this.headPos, 1.1 * SCALE * 0.75, 1.3, 0.4);
    test(this.collar, 1.2 * SCALE * 0.75, P >= 3 ? 3.5 : 2.5, 0.8);
    if (!weak) return null;
    if (weak >= 2.5) this.collarHits = (this.collarHits || 0) + 1;
    return { t: bt, weak };
  }

  /** Point test for projectiles from the support weapons */
  weakHit(e, x, y, z) {
    if (e !== this.e || e.mode === 'cameo') return 1;
    const r = 1.2 * SCALE * 0.75;
    if ((x - this.collar.x) ** 2 + (y - this.collar.y) ** 2 + (z - this.collar.z) ** 2 < r * r) return e.phase >= 3 ? 3.5 : 2.5;
    return 1;
  }

  raycastWrecks(ray, maxT) {
    let best = null, bt = maxT;
    for (const w of this.wrecks) {
      if (w.dead) continue;
      const t = raySphere(ray, w.x, w.y, w.z, 2.4);
      if (t < bt) { bt = t; best = w; }
    }
    return best ? { w: best, t: bt } : null;
  }

  shootWreck(w, dmg) {
    const g = this.game;
    w.hp -= dmg;
    g.vfx.hitSpark(w.x, w.y, w.z, 7, 3.5, 1);
    if (w.hp <= 0 && !w.dead) {
      w.dead = true;
      g.vfx.explosion(w.x, w.y, w.z, 2.2, 0);
      g.audio.play('explosion', { x: w.x, z: w.z, volume: 1, big: true });
      g.cam.addTrauma(0.25);
      g.addScore(1500 * g.comboMult());
      g.vfx.number(w.x, w.y + 1.5, w.z, 'SHOT DOWN!', 4);
      g.hud.callout('SHOT DOWN!', 'good');
    }
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
    e.gap = gap;
    const hp = e.hp / e.maxHp;
    e.vuln = Math.max(0, e.vuln - dt);
    // Phase changes
    if (e.phase === 1 && hp < 0.66) this._phase(e, 2);
    else if (e.phase === 2 && hp < 0.33) this._phase(e, 3);
    const P = e.phase;
    const fast = P === 3 ? 1.25 : P === 2 ? 1.1 : 1;
    let desiredGap = P === 1 ? -27 : P === 2 ? -24 : -22;
    let lateralTarget = Math.sin(e.animT * 0.35) * 2.5;
    let speedOverride = null;
    let turn = 0;
    e.atkCd -= dt;
    e.teleK = 0;
    const tele = (T) => { e.teleK = Math.min(1, e.stateT / T); };

    switch (e.mode) {
      case 'intro':
        speedOverride = e.stateT < 1.0 ? 0 : null;
        e.roar = e.stateT < 1.15 ? Math.min(1, e.stateT * 4) : 0;
        if (e.stateT > 1.4) { this._set(e, 'chase'); e.atkCd = 2.5; }
        break;
      case 'chase':
        if (e.atkCd <= 0 && gap < -12 && gap > -45 && g.enemies.attackGrace <= 0) this._chooseAttack(e);
        break;
      case 'lunge_tele': {
        const T = P === 3 ? 1.15 : P === 2 ? 1.35 : 1.6;
        desiredGap = -16;
        lateralTarget = p.d;
        e.crouch = Math.min(1, e.stateT / T);
        e.jaw = 0.5;
        tele(T);
        if (e.stateT > T) { this._set(e, 'lunge'); g.audio.play('trex_roar', { x: e.x, z: e.z, volume: 0.8, pitch: 1.3, dur: 0.8 }); }
        break;
      }
      case 'lunge': {
        desiredGap = -5;
        lateralTarget = p.d;
        speedOverride = p.speed + 26;
        e.crouch = 0;
        e.lungeAmt = Math.min(1, e.stateT / 0.25);
        e.jaw = e.stateT < 0.25 ? 1 : 0;
        if (!e.bit && (gap > -7.5 || e.stateT > 0.45)) {
          e.bit = true;
          g.audio.play('bite', { x: e.x, z: e.z, volume: 1, pitch: 0.55 });
          g.cam.addTrauma(0.5);
          g.hurtPlayer(16 * g.enemies.dmgMult, e.x, e.z, 'bite', e);
        }
        if (e.stateT > 0.7) {
          e.lungeAmt = 0;
          if (P === 3 && e.combo < 1) { e.combo++; this._set(e, 'lunge_tele'); e.stateT = 0.45; }
          else { e.combo = 0; this._set(e, 'chase'); e.atkCd = 2.2 / fast; }
        }
        break;
      }
      case 'throw': {
        desiredGap = -26;
        e.holding = e.stateT < 0.9;
        e.throwAmt = Math.min(1, e.stateT / 0.9);
        if (!e.thrown && e.stateT > 0.9) {
          e.thrown = true;
          const n = P === 3 ? 3 : P === 2 ? 2 : 1;
          for (let k = 0; k < n; k++) this._throwWreck(e, k);
          g.audio.play('tail_swipe', { x: e.x, z: e.z, volume: 1, pitch: 0.6 });
          g.hud.callout(n > 1 ? 'INCOMING CARS!' : 'INCOMING CAR!', 'danger');
        }
        if (e.stateT > 1.4) { this._set(e, 'chase'); e.atkCd = 2.0 / fast; e.throwAmt = 0; }
        break;
      }
      case 'roar':
        speedOverride = p.speed * 0.85;
        e.roar = Math.min(1, e.stateT * 3);
        if (!e.summoned && e.stateT > 0.4) {
          e.summoned = true;
          g.audio.play('trex_roar', { volume: 1.1, pitch: 0.95, dur: 2.2 });
          g.vfx.shockwave(e.x, e.z, 18, 3, 1.2, 0.4, 0.8);
          g.cam.addTrauma(0.45);
          const n = P === 3 ? 5 : 3;
          for (let k = 0; k < n; k++) g.director.spawnChaser(k === 0 && P === 3 ? 'brute' : 'raptor', k % 2 ? 'left' : 'behind');
        }
        if (e.stateT > 2.0) { e.roar = 0; this._set(e, 'chase'); e.atkCd = 1.5; }
        break;
      case 'flank':
        // Pull up alongside the cab; the gunner turns to face it
        desiredGap = 1.5;
        lateralTarget = e.flankSide * 7.5;
        p.laneTarget = -e.flankSide * 2.5;
        speedOverride = gap < -2 ? p.speed + 14 : p.speed;
        g.cam.swing(g.cam.yawToward(e.x, e.z, p), 0.12, 3.5, 0);
        if (gap > -1 && e.stateT > 0.6) { this._set(e, 'flank_tele'); g.hud.callout('LOOK OUT — SIDE!', 'danger'); }
        else if (e.stateT > 4) { this._set(e, 'chase'); this._clearView(); }
        break;
      case 'flank_tele': {
        const T = P === 3 ? 1.1 : 1.35;
        desiredGap = 1.5;
        lateralTarget = e.flankSide * 7.5;
        speedOverride = p.speed + (desiredGap - gap) * 2;
        e.crouch = Math.min(1, e.stateT / T) * 0.7;
        e.jaw = 0.6;
        tele(T);
        g.cam.swing(g.cam.yawToward(e.x, e.z, p), 0.12, 4, 0);
        if (e.stateT > T) this._set(e, 'flank_hit');
        break;
      }
      case 'flank_hit':
        desiredGap = 1.5;
        lateralTarget = e.flankSide * 3.2;
        speedOverride = p.speed;
        e.lungeAmt = Math.min(1, e.stateT / 0.2);
        if (!e.bit && e.stateT > 0.2) {
          e.bit = true;
          g.hurtPlayer(14 * g.enemies.dmgMult, e.x, e.z, 'charge', e);
          p.vd += -e.flankSide * 6;
          g.cam.addTrauma(0.6);
          g.audio.play('stomp', { volume: 1, pitch: 0.6 });
        }
        if (e.stateT > 0.6) { e.lungeAmt = 0; this._set(e, 'fallback'); this._clearView(); }
        break;
      case 'fallback':
        desiredGap = -20;
        speedOverride = p.speed - 9;
        if (gap < -12) { this._set(e, 'chase'); e.atkCd = 1.8 / fast; }
        break;
      case 'overtake':
        // Sprint past the cab (the gunner's view tracks it over the shoulder)
        desiredGap = 55;
        lateralTarget = e.flankSide * 7;
        p.laneTarget = -e.flankSide * 2.5;
        speedOverride = p.speed + 20;
        g.cam.swing(g.cam.yawToward(e.x, e.z, p), 0.05, 4, 0);
        if (gap > 45) this._set(e, 'turn');
        break;
      case 'turn':
        speedOverride = p.speed;
        desiredGap = 48;
        e.turnAmt = Math.min(1, e.stateT / 0.7);
        g.cam.swing(Math.PI, 0.02, 3, 0);
        if (e.stateT > 0.7) { e.laneD = p.d; this._set(e, 'charge_tele'); g.audio.play('trike_bellow', { x: e.x, z: e.z, volume: 1, pitch: 0.55 }); g.hud.callout('HEAD-ON!', 'danger'); }
        break;
      case 'charge_tele': {
        turn = 1;
        speedOverride = p.speed;
        lateralTarget = p.d;
        const T = 1.3;
        e.crouch = Math.min(1, e.stateT / T) * 0.6;
        tele(T);
        g.cam.swing(Math.PI, 0.02, 3, 0);
        this._lane(e, p.d, e.stateT / T);
        if (e.stateT > T) { this._set(e, 'charge'); e.crouch = 0; e.laneD = p.d; }
        break;
      }
      case 'charge':
        turn = 1;
        lateralTarget = e.laneD ?? p.d;
        speedOverride = p.speed - 26;
        e.jaw = 0.8;
        tele(1);
        g.cam.swing(Math.PI, 0.02, 3, 0);
        if (!e.bit && gap < 4.5) {
          e.bit = true;
          g.hurtPlayer(20 * g.enemies.dmgMult, e.x, e.z, 'charge', e);
          g.cam.addTrauma(0.9);
          g.audio.play('stomp', { volume: 1.2, pitch: 0.5 });
          p.speed *= 0.4;
        }
        if (gap < -6) { this._set(e, 'turnback'); e.turnAmt = 1; this._clearView(); }
        break;
      case 'turnback':
        speedOverride = p.speed + 2;
        e.turnAmt = 1 - Math.min(1, e.stateT / 0.7);
        if (e.stateT > 0.7) { this._set(e, 'chase'); e.atkCd = 1.8; e.turnAmt = 0; }
        break;
      case 'stagger':
        speedOverride = e.staggerAhead ? p.speed - 14 : p.speed - 7;
        e.staggerAmt = Math.sin(Math.min(1, e.stateT / 1.8) * Math.PI);
        if (e.staggerAhead) turn = 1;
        if (e.stateT > 1.8 || (e.staggerAhead && gap < -6)) {
          e.staggerAmt = 0;
          this._clearView();
          if (e.staggerAhead) { e.staggerAhead = false; this._set(e, 'turnback'); e.turnAmt = 1; break; }
          const roar = e.phaseRoar;
          e.phaseRoar = false;
          this._set(e, roar ? 'roar' : 'chase');
          e.summoned = false;
          e.atkCd = 1.6;
        }
        break;
    }
    if (turn) e.turnAmt = 1;
    else if (e.mode !== 'turn' && e.mode !== 'turnback') e.turnAmt = 0;
    const behind = ['chase', 'lunge_tele', 'lunge', 'throw', 'roar', 'stagger', 'fallback', 'intro'].includes(e.mode) && !e.staggerAhead;
    if (behind && g.state === 'playing') g.cam.swing(0, 0.12, 2.5, 0);

    // Movement along the route: close the gap to the desired one
    const err = desiredGap - gap;
    const target = speedOverride ?? p.speed + THREE.MathUtils.clamp(err * 1.4, -9, 12) * fast;
    e.v += (target - e.v) * Math.min(1, dt * (e.mode === 'lunge' || e.mode === 'charge' ? 10 : 3));
    e.bs = route.wrap(e.bs + e.v * dt);
    e.bd += (lateralTarget - e.bd) * Math.min(1, dt * (e.mode === 'charge' || e.mode === 'lunge' || e.mode === 'flank_hit' ? 4 : 1.6));
    const r = route.sample(e.bs, _s);
    e.bd = THREE.MathUtils.clamp(e.bd, -r.halfWidth - 1, r.halfWidth + 1);
    e.heading = r.heading + Math.PI * (e.turnAmt || 0);
    e.rx = r.x + r.rx * e.bd;
    e.rz = r.z + r.rz * e.bd;
    const fx = Math.sin(e.heading), fz = Math.cos(e.heading);
    e.x = e.rx + fx * 2.2 * SCALE;
    e.z = e.rz + fz * 2.2 * SCALE;
    e.radius = 3.6 * SCALE;
    e.moveSpeed = Math.abs(e.v);
    e.dirx = fx; e.dirz = fz;
    // Hit spheres for numbers / the bot
    e.hx = this.collar.x; e.hy = this.collar.y; e.hz = this.collar.z;
    e.bx = this.bodyPos.x; e.by = this.bodyPos.y; e.bz = this.bodyPos.z;
    this._footsteps(e, dt);
    // Danger ring around its collar while an attack winds up (with a stagger meter)
    if (e.teleK > 0) g.enemies.dangers.push({ x: this.collar.x, y: this.collar.y, z: this.collar.z, k: e.teleK, r: 2.4, e, boss: true, meter: Math.min(1, e.teleDmg / this._staggerNeed(e)) });
    g.vfx.threats.push({ x: e.x, z: e.z, color: '#ff3b2f' });
    return null;
  }

  _set(e, mode) {
    e.mode = mode;
    e.stateT = 0;
    e.bit = false;
    e.thrown = false;
    e.teleDmg = 0;
  }

  _clearView() {
    const g = this.game;
    g.cam.swing(0, 0.12, 2.5, 0);
    g.player.laneTarget = 0;
  }

  _stagger(e) {
    const g = this.game;
    e.staggerAhead = e.mode === 'charge' || e.mode === 'charge_tele';
    this._set(e, 'stagger');
    e.crouch = 0;
    e.lungeAmt = 0;
    e.vuln = 2.2;
    g.hitStop(0.1);
    g.cam.addTrauma(0.45);
    g.vfx.sparks(this.collar.x, this.collar.y, this.collar.z, 30, 14, 1.5, 5, 7);
    g.audio.play('trex_roar', { volume: 1, pitch: 1.35, dur: 1.0 });
    g.onStagger(e);
    g.player.laneTarget = 0;
  }

  _chooseAttack(e) {
    const g = this.game;
    const P = e.phase;
    const r = Math.random();
    e.flankSide = Math.random() < 0.5 ? 1 : -1;
    const table = P === 1 ? [['lunge', 0.6], ['throw', 1]]
      : P === 2 ? [['lunge', 0.35], ['throw', 0.6], ['flank', 0.85], ['roar', 1]]
        : [['lunge', 0.3], ['throw', 0.48], ['flank', 0.66], ['charge', 0.9], ['roar', 1]];
    let m = table.find(([, w]) => r <= w)[0];
    if (m === e.lastAttack && m !== 'lunge' && Math.random() < 0.6) m = 'lunge';
    e.lastAttack = m;
    if (m === 'lunge') { this._set(e, 'lunge_tele'); g.hud.callout('DANGER!', 'danger'); g.audio.play('brute_growl', { x: e.x, z: e.z, pitch: 0.5, volume: 1 }); }
    else if (m === 'throw') this._set(e, 'throw');
    else if (m === 'flank') { this._set(e, 'flank'); g.audio.play('trex_roar', { x: e.x, z: e.z, volume: 0.8, pitch: 1.15, dur: 1.2 }); }
    else if (m === 'charge') { this._set(e, 'overtake'); g.audio.play('trex_roar', { x: e.x, z: e.z, volume: 0.9, pitch: 1.1, dur: 1.2 }); }
    else { this._set(e, 'roar'); e.summoned = false; }
  }

  _phase(e, n) {
    const g = this.game;
    e.phase = n;
    this._set(e, 'stagger');
    e.phaseRoar = n === 2;
    e.staggerAhead = false;
    this._clearView();
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

  /** Red lane on the asphalt for the head-on charge */
  _lane(e, d, progress) {
    const g = this.game;
    const p = g.player;
    const r = g.route.sample(e.bs, _s);
    const x = r.x + r.rx * d, z = r.z + r.rz * d;
    const len = Math.abs(g.route.delta(e.bs, p.s)) + 6;
    g.vfx.telegraphLane(x, z, r.heading + Math.PI, len, 5.2, progress, 6, 0.35, 0.15);
  }

  _throwWreck(e, k) {
    const g = this.game;
    const p = g.player;
    const T = 1.9 + k * 0.35;
    // Aimed at where the cab's tail will be (the first dead on, the others bracket it)
    const r = g.route.sample(p.s + p.speed * T - 3, _s);
    const lat = p.d + (k === 0 ? 0 : (k % 2 ? 1 : -1) * (2 + Math.random() * 2));
    const tx = r.x + r.rx * lat, tz = r.z + r.rz * lat;
    const sx = this.headPos.x, sy = this.headPos.y, sz = this.headPos.z;
    const G = 18;
    this.wrecks.push({ x: sx, y: sy, z: sz, vx: (tx - sx) / T, vz: (tz - sz) / T, vy: (1.0 - sy) / T + 0.5 * G * T, G, tx, tz, t: 0, T, spin: (Math.random() - 0.5) * 4, yaw: Math.random() * 6, hp: WRECK_HP * (1 + (e.phase - 1) * 0.3), dead: false });
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
    if (e.stateT > 16 || Math.abs(e.cd) > 45 || g.route.delta(g.player.s, e.cs) < -160) {
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
    // Wrecks in flight (shootable)
    this.wreckBatch.begin();
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      if (w.dead) { this.wrecks.splice(i, 1); continue; }
      w.t += dt;
      w.vy -= w.G * dt;
      w.x += w.vx * dt; w.y += w.vy * dt; w.z += w.vz * dt;
      w.yaw += w.spin * dt;
      g.vfx.telegraphCircle(w.tx, w.tz, 4.5, Math.min(1, w.t / w.T), 6, 0.6, 0.15);
      if (Math.random() < dt * 20) g.vfx.glow.spawn(w.x, w.y, w.z, 0, 1, 0, 0.3, 0.6, 1.2, 6, 2, 0.4, { r1: 0.3, g1: 0.05, b1: 0 });
      g.enemies.dangers.push({ x: w.x, y: w.y, z: w.z, k: Math.min(1, w.t / w.T), r: 2.2, wreck: true });
      if (w.y <= 0.6 && w.vy < 0) {
        g.weapons.blast(w.x, w.z, 6, 120, 0, 'boss');
        g.vfx.explosion(w.x, 0.5, w.z, 2, 0);
        if (Math.hypot(g.player.x - w.x, g.player.z - w.z) < 5.5) g.hurtPlayer(11 * g.enemies.dmgMult, w.x, w.z, 'wreck');
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

  /**
   * Skinned T. rex: picks the clip for the current mode (roar on the reveal and the summon, crouch on every telegraph,
   * bite on lunges / door hits, the head-swing throw, a long stagger flinch, the death collapse), matches the run to its
   * speed, and turns the head toward the gunner's camera in the hero moments (reveal, roars, telegraphs, the chase).
   * Returns the extra root lift (metres, before scale).
   */
  animate(e, rig, time) {
    const m = rig.model;
    const an = e.anim || (e.anim = new AnimState());
    const dt = Math.min(0.1, Math.max(0, time - (e.poseT ?? time)));
    e.poseT = time;
    const ws = e.scale * m.baseScale;
    const sp = e.moveSpeed || 0;
    let clip = 'run', rate = 1, once = false, fade = 0.25;
    switch (e.mode) {
      case 'cameo': clip = e.roar > 0 ? 'roar' : 'walk'; once = clip === 'roar'; break;
      case 'intro': case 'roar': clip = 'roar'; once = true; fade = 0.3; break;
      case 'lunge_tele': case 'flank_tele': case 'charge_tele': clip = 'crouch'; fade = 0.3; break;
      case 'lunge': case 'flank_hit': clip = 'bite'; once = true; fade = 0.1; rate = 0.9; break;
      case 'throw': clip = 'throw'; once = true; break;
      case 'stagger': clip = 'hit'; once = true; rate = 0.32; fade = 0.08; break;
    }
    if (e.state === 'dying') { clip = 'death'; once = true; rate = 0.75; fade = 0.15; }
    if (clip === 'run' || clip === 'walk') {
      if (sp < 0.6 && e.mode !== 'cameo') clip = 'idle';
      else {
        const c = m.clips[clipOf(m, clip)];
        rate = Math.min(2.2, Math.max(0.55, sp / Math.max(0.1, (c?.speed || 8) * ws)));
      }
    }
    const key = e.state === 'dying' ? 'dying' : `${e.mode}:${clip}`;
    an.play(clipOf(m, clip), fade, rate, once && key !== an.key);
    an.key = key;
    // a flash spike (big hit) replays a light flinch on top
    if ((e.flash || 0) > (e.flashPrev || 0) + 0.3 && e.mode !== 'stagger') { an.c = clipOf(m, 'hit'); an.tc = 0; }
    e.flashPrev = e.flash || 0;
    an.wc = an.c >= 0 && an.tc < 0.45 && e.state !== 'dying' ? 0.35 : 0;
    // Hero look: the head swings toward the gunner (camera)
    const cam = this.game.cam.camera.position;
    let ly = 0, lp = 0;
    if (HERO_LOOK.has(e.mode) && e.state !== 'dying') {
      const dx = cam.x - this.headPos.x, dz = cam.z - this.headPos.z;
      const rel = Math.atan2(Math.sin(Math.atan2(dx, dz) - e.heading), Math.cos(Math.atan2(dx, dz) - e.heading));
      const k = e.mode === 'chase' ? 0.55 : 1;
      ly = THREE.MathUtils.clamp(rel, -0.9, 0.9) * k;
      lp = THREE.MathUtils.clamp(Math.atan2(this.headPos.y - cam.y, Math.hypot(dx, dz)), -0.4, 0.45) * 0.7 * k;
    }
    an.lookYaw += (ly - an.lookYaw) * Math.min(1, dt * 4);
    an.lookPitch += (lp - an.lookPitch) * Math.min(1, dt * 4);
    an.jaw = clip === 'run' || clip === 'crouch' || clip === 'idle' || clip === 'walk' ? (e.jaw || 0) * 0.4 : 0;
    if ((e.stone || 0) < 1) an.advance(dt);
    // gait phase for the footstep thumps (two steps per run cycle)
    const ac = m.clips[an.a];
    if (ac && (clip === 'run' || clip === 'walk')) e.gait = (an.ta / ac.duration) * Math.PI * 2;
    else e.gait = e.gait || 0;
    // death: the collapse clip drops it, then it topples sideways onto the street
    const fall = e.fall || 0;
    e.roll = fall * 1.35;
    e.pitch = 0;
    return fall * 0.35;
  }

  /** After the rig placed the individual: read weak point & head positions from the part matrices */
  afterAdd(rig) {
    if (rig.skinned) {
      rig.partWorldPosition('neck1', this.collar, SK.collar);
      rig.partWorldPosition('thighL', this.thighs[0], SK.thighL);
      rig.partWorldPosition('thighR', this.thighs[1], SK.thighR);
      rig.partWorldPosition('head', this.headPos, SK.head);
      rig.partWorldPosition('spine', this.bodyPos, SK.body);
      rig.partWorldPosition('chest', this.chestPos, SK.chest);
      return;
    }
    rig.partWorldPosition('neck', this.collar, COLLAR_LOCAL);
    rig.partWorldPosition('thighL', this.thighs[0], THIGH_LOCAL);
    rig.partWorldPosition('thighR', this.thighs[1], THIGH_LOCAL);
    rig.partWorldPosition('head', this.headPos, _v.set(0, -0.3, 1.4));
    rig.partWorldPosition('body', this.bodyPos, _v.set(0, 0.3, 0));
    rig.partWorldPosition('neck', this.chestPos, _v.set(0, -0.4, -0.3));
  }
}

export { TRexBoss, SCALE as TREX_SCALE };
