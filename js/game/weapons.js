import * as THREE from 'three/webgpu';
import { PropBatch } from './batches.js';
import { WEAPONS, PASSIVES, EVOLUTIONS } from './upgrades.js';

// js/game/weapons.js
// The cab's arsenal at runtime: the aimed Roof Cannon (the player's light-gun element) plus auto-firing weapons in the
// Vampire Survivors mould, their evolutions, and the Skyhammer air strike special. Projectiles are struct-of-arrays
// pools drawn through instanced batches; hits go through the enemy spatial hash.

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = [];
const _tmp2 = [];
const BULLET_MAX = 900;
const MISSILE_MAX = 96;
const MINE_MAX = 48;
const FIRE_MAX = 90;

class WeaponSystem {
  constructor(game, assets) {
    this.game = game;
    this.weapons = new Map([['cannon', 1]]); // id -> level
    this.passives = new Map();
    this.evolved = new Set();
    this.cd = {};
    this.group = new THREE.Group();
    this.group.name = 'Weapons';
    this.tracers = new PropBatch(assets.get('tracer').geometry, BULLET_MAX, { additive: true, name: 'w.tracers' });
    this.missileBatch = new PropBatch(assets.get('missile').geometry, MISSILE_MAX, { name: 'w.missiles', glow: 1 });
    this.mineBatch = new PropBatch(assets.get('mine').geometry, MINE_MAX, { name: 'w.mines' });
    this.sawBatch = new PropBatch(assets.get('saw').geometry, 12, { name: 'w.saws', metalness: 0.8, roughness: 0.3 });
    this.wreckBatch = null;
    for (const b of [this.tracers, this.missileBatch, this.mineBatch, this.sawBatch]) this.group.add(b.mesh);
    // Bullets
    const f = (n) => new Float32Array(n);
    this.b = { n: 0, x: f(BULLET_MAX), y: f(BULLET_MAX), z: f(BULLET_MAX), vx: f(BULLET_MAX), vy: f(BULLET_MAX), vz: f(BULLET_MAX),
      life: f(BULLET_MAX), dmg: f(BULLET_MAX), pierce: f(BULLET_MAX), r: f(BULLET_MAX), boom: f(BULLET_MAX), kind: new Uint8Array(BULLET_MAX),
      cr: f(BULLET_MAX), cg: f(BULLET_MAX), cb: f(BULLET_MAX), w: f(BULLET_MAX), len: f(BULLET_MAX), last: Array.from({ length: BULLET_MAX }, () => null), burn: f(BULLET_MAX) };
    this.missiles = [];
    this.mines = [];
    this.fires = []; // burning ground patches (Inferno Wake)
    this.sawAngle = 0;
    this.special = { charge: 0.35, active: null };
    this.aim = { x: 0, y: 1, z: 0, target: null, weak: false };
    this.firing = false;
    this.burnDps = 10;
    this.shotsFired = 0;
    this.recomputeStats();
  }

  reset() {
    this.weapons = new Map([['cannon', 1]]);
    this.passives = new Map();
    this.evolved = new Set();
    this.cd = {};
    this.b.n = 0;
    this.missiles.length = 0;
    this.mines.length = 0;
    this.fires.length = 0;
    this.special = { charge: 0.35, active: null };
    this.recomputeStats();
  }

  has(id) {
    return this.weapons.has(id) || this.evolved.has(id);
  }

  level(id) {
    return this.weapons.get(id) || 0;
  }

  /** Applies a level-up choice */
  apply(choice) {
    if (choice.kind === 'weapon') this.weapons.set(choice.id, (this.weapons.get(choice.id) || 0) + 1);
    else if (choice.kind === 'passive') {
      this.passives.set(choice.id, (this.passives.get(choice.id) || 0) + 1);
      if (choice.id === 'chassis') this.game.player.heal(25);
    } else if (choice.kind === 'evolution') {
      const evo = EVOLUTIONS[choice.id];
      this.weapons.delete(evo.from);
      this.evolved.add(choice.id);
    }
    this.recomputeStats();
  }

  recomputeStats() {
    const P = (id) => this.passives.get(id) || 0;
    this.dmgMult = 1 + P('hollow') * 0.12;
    this.crit = 0.06 + P('hollow') * 0.03;
    this.cdMult = Math.pow(0.92, P('loader'));
    this.areaMult = 1 + P('boom') * 0.12;
    const player = this.game.player;
    if (player) {
      const st = player.stats;
      st.armor = P('armor') * 1.5;
      const maxHp = 150 + P('chassis') * 30;
      if (maxHp > player.maxHp) player.hp += maxHp - player.maxHp;
      player.maxHp = maxHp;
      st.speedMult = 1 + P('turbo') * 0.07;
      st.nitroRegen = 1 + P('turbo') * 0.25;
      st.magnet = 1 + P('magnet') * 0.35;
      st.ram = 1 + P('ram') * 0.35;
      st.regen = 0.8 + P('chassis') * 0.3 + (this.evolved.has('dragon') ? 1.5 : 0);
      player.setBuild(new Set([...this.weapons.keys(), ...this.evolved, ...this.passives.keys()]));
    }
    this.burnDps = (8 + this.level('flamer') * 3) * this.dmgMult * (this.evolved.has('inferno') ? 2.5 : 1);
  }

  /** Owned items for the HUD: [{ id, icon, level, max, kind, evolved }] */
  buildList() {
    const out = [];
    for (const id of this.evolved) out.push({ id, icon: EVOLUTIONS[id].icon, level: 'EVO', kind: 'weapon', evolved: true, name: EVOLUTIONS[id].name, color: EVOLUTIONS[id].color });
    for (const [id, l] of this.weapons) out.push({ id, icon: WEAPONS[id].icon, level: l, max: WEAPONS[id].max, kind: 'weapon', name: WEAPONS[id].name, color: WEAPONS[id].color });
    for (const [id, l] of this.passives) out.push({ id, icon: PASSIVES[id].icon, level: l, max: PASSIVES[id].max, kind: 'passive', name: PASSIVES[id].name, color: PASSIVES[id].color });
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------------
  _ready(id, period) {
    this.cd[id] = (this.cd[id] ?? Math.random() * period * 0.5) - this._dt;
    if (this.cd[id] > 0) return false;
    this.cd[id] += period * this.cdMult;
    if (this.cd[id] < 0) this.cd[id] = 0;
    return true;
  }

  _rollCrit(base = 1) {
    return Math.random() < this.crit ? 2 * base : base;
  }

  /** Spawns a bullet. kind: 0 plain, 1 cannon, 2 rail (unused; hitscan), 3 pellet */
  bullet(x, y, z, dx, dy, dz, speed, dmg, opts = {}) {
    const B = this.b;
    if (B.n >= BULLET_MAX) return;
    const i = B.n++;
    B.x[i] = x; B.y[i] = y; B.z[i] = z;
    B.vx[i] = dx * speed; B.vy[i] = dy * speed; B.vz[i] = dz * speed;
    B.life[i] = opts.life ?? 0.6;
    B.dmg[i] = dmg;
    B.pierce[i] = opts.pierce ?? 0;
    B.r[i] = opts.radius ?? 0.5;
    B.boom[i] = opts.boom ?? 0;
    B.kind[i] = opts.kind ?? 0;
    B.cr[i] = opts.color?.[0] ?? 6; B.cg[i] = opts.color?.[1] ?? 3.5; B.cb[i] = opts.color?.[2] ?? 1;
    B.w[i] = opts.width ?? 0.09;
    B.len[i] = opts.len ?? 2.2;
    B.last[i] = null;
    B.burn[i] = opts.burn ?? 0;
  }

  update(dt, input) {
    this._dt = dt;
    const g = this.game;
    const p = g.player;
    if (!p.alive) { this._updateProjectiles(dt); return; }
    const L = (id) => this.weapons.get(id) || 0;
    const E = (id) => this.evolved.has(id);

    // --- Roof Cannon / Rail Lance (aimed) ---------------------------------------------------------------------------
    p.aimAt(this.aim.x, this.aim.y, this.aim.z, dt);
    const wantFire = input.fire || (input.autoFire && this.aim.target);
    if (wantFire && (L('cannon') || E('railgun'))) {
      if (E('railgun')) {
        if (this._ready('railgun', 0.26)) this._fireRail();
      } else {
        const lvl = L('cannon');
        const rate = 5.5 * (lvl >= 4 ? 1.3 : 1);
        if (this._ready('cannon', 1 / rate)) {
          p.muzzle(_pos, _dir);
          // Aim straight at the aim point from the muzzle
          _dir.set(this.aim.x - _pos.x, this.aim.y - _pos.y, this.aim.z - _pos.z).normalize();
          const dmg = 16 * (lvl >= 2 ? 1.3 : 1) * this.dmgMult;
          this.bullet(_pos.x, _pos.y, _pos.z, _dir.x, _dir.y, _dir.z, 150, dmg, {
            kind: 1, pierce: lvl >= 3 ? 1 : 0, radius: 0.75, boom: lvl >= 5 ? 2.8 * this.areaMult : 0,
            color: [1.2, 5, 7], width: 0.16, len: 3.6, life: 0.9
          });
          g.vfx.muzzle(_pos.x, _pos.y, _pos.z, _dir.x, _dir.y, _dir.z, 1.3, 1.2, 5, 7);
          g.vfx.light(_pos.x, _pos.y, _pos.z, 0x55eeff, 40, 10, 0.06);
          p.recoil = 1;
          g.audio.play('gun', { volume: 0.55, pitch: 0.95 + Math.random() * 0.1 });
          g.cam.addTrauma(0.025);
          this.shotsFired++;
        }
      }
    }

    // --- Hood Gatlings / Storm Gatlings ----------------------------------------------------------------------------
    const gl = L('gatling');
    if (gl || E('storm_gatling')) {
      const storm = E('storm_gatling');
      const rate = storm ? 30 : 9 * (gl >= 3 ? 1.4 : 1) * (gl >= 5 ? 1.4 : 1);
      const range = storm ? 60 : gl >= 4 ? 50 : 40;
      if (this._ready('gatling', 1 / rate)) {
        const side = (this.gatSide = 1 - (this.gatSide || 0));
        p.toWorld(p.gatlingMuzzles[side], _pos);
        const t = g.enemies.nearest(p.x, p.z, range, storm ? null : (e) => (e.x - p.x) * p.fx + (e.z - p.z) * p.fz > -4);
        if (t) {
          const ty = t.y + t.sp.height * t.scale * 0.5;
          const lead = Math.hypot(t.x - _pos.x, t.z - _pos.z) / 110;
          _dir.set(t.x + t.vx * lead - _pos.x, ty - _pos.y, t.z + t.vz * lead - _pos.z).normalize();
          _dir.x += (Math.random() - 0.5) * 0.04; _dir.z += (Math.random() - 0.5) * 0.04;
          const dmg = (storm ? 11 : 6 * (gl >= 2 ? 1.35 : 1) * (gl >= 4 ? 1.35 : 1)) * this.dmgMult;
          this.bullet(_pos.x, _pos.y, _pos.z, _dir.x, _dir.y, _dir.z, 110, dmg, { pierce: storm ? 3 : gl >= 5 ? 1 : 0, radius: 0.55, color: [7, 4.5, 1.2], width: 0.07, len: 2.4 });
          g.vfx.muzzle(_pos.x, _pos.y, _pos.z, _dir.x, _dir.y, _dir.z, 0.6);
          g.audio.play('gatling', { volume: 0.32, pitch: 0.9 + Math.random() * 0.2 });
        }
      }
    }

    // --- Bumper Buckshot / Dragon's Breath ------------------------------------------------------------------------
    const sl = L('shotgun');
    if (sl || E('dragon')) {
      const dragon = E('dragon');
      const period = dragon ? 0.75 : sl >= 4 ? 0.85 : 1.15;
      const t = g.enemies.nearest(p.x + p.fx * 10, p.z + p.fz * 10, 18, (e) => (e.x - p.x) * p.fx + (e.z - p.z) * p.fz > 0);
      if (t && this._ready('shotgun', period)) {
        const pellets = dragon ? 16 : 8 + (sl >= 2 ? 3 : 0) + (sl >= 5 ? 4 : 0);
        const dmg = (dragon ? 16 : 9 * (sl >= 3 ? 1.35 : 1) * (sl >= 5 ? 1.35 : 1)) * this.dmgMult;
        p.toWorld(_pos.set(0, 0.45, 2.5), _pos);
        const base = Math.atan2(t.x - _pos.x, t.z - _pos.z);
        for (let k = 0; k < pellets; k++) {
          const a = base + (Math.random() - 0.5) * 0.55;
          const sp = 70 + Math.random() * 25;
          this.bullet(_pos.x, _pos.y, _pos.z, Math.sin(a), 0.02, Math.cos(a), sp, dmg, {
            kind: 3, life: 0.3, radius: 0.7, color: dragon ? [8, 2.5, 0.4] : [6, 4.5, 1.5], width: 0.08, len: 1.6,
            boom: dragon ? 1.6 * this.areaMult : 0, burn: dragon ? 2 : 0
          });
        }
        g.vfx.muzzle(_pos.x, _pos.y, _pos.z, p.fx, 0, p.fz, 2.4, 8, dragon ? 2.5 : 4, dragon ? 0.4 : 1);
        g.vfx.light(_pos.x, _pos.y, _pos.z, 0xffaa44, 80, 14, 0.08);
        g.audio.play('shotgun', { volume: 0.6 });
        g.cam.addTrauma(0.06);
      }
    }

    // --- Swarm Missiles / Cluster Barrage --------------------------------------------------------------------------
    const ml = L('missiles');
    if (ml || E('cluster')) {
      const cluster = E('cluster');
      const period = cluster ? 2.2 : ml >= 4 ? 2.0 : 2.5;
      if (this._ready('missiles', period)) {
        const count = cluster ? 8 : 2 + (ml >= 2) + (ml >= 4) + (ml >= 5);
        g.enemies.within(p.x, p.z, 75, _tmp);
        // Prefer big targets
        _tmp.sort((a, b) => b.sp.mass * b.scale - a.sp.mass * a.scale);
        if (_tmp.length) {
          for (let k = 0; k < count; k++) {
            const t = _tmp[k % Math.min(_tmp.length, Math.max(3, count))];
            p.toWorld(_pos.set((k % 2 ? 0.25 : -0.25) - 0.35, 1.25, -1.9), _pos);
            const a = p.heading + Math.PI + (k - (count - 1) / 2) * 0.35;
            this.missiles.push({
              x: _pos.x, y: _pos.y, z: _pos.z, vx: Math.sin(a) * 8 + p.vx, vy: 9 + Math.random() * 3, vz: Math.cos(a) * 8 + p.vz,
              target: t, life: 3, dmg: (cluster ? 34 : 32 * (ml >= 3 ? 1.35 : 1)) * this.dmgMult,
              radius: (cluster ? 4 : ml >= 5 ? 4.5 : 3.5) * this.areaMult, cluster, t: 0
            });
          }
          g.audio.play('missile', { volume: 0.5 });
        }
      }
    }

    // --- Tesla Coil / Thunderhead ----------------------------------------------------------------------------------
    const tl = L('tesla');
    if (tl || E('thunder')) {
      const thunder = E('thunder');
      const period = thunder ? 0.7 : tl >= 4 ? 1.0 : 1.3;
      if (this._ready('tesla', period)) {
        p.toWorld(_pos.set(0.55, 1.85, -1.75), _pos);
        const chains = thunder ? 14 : 2 + (tl >= 2) + (tl >= 4) * 2 + (tl >= 5) * 2;
        const dmg = (thunder ? 34 : 20 * (tl >= 3 ? 1.35 : 1) * (tl >= 5 ? 1.4 : 1)) * this.dmgMult;
        let cur = g.enemies.nearest(p.x, p.z, 26);
        let fx = _pos.x, fy = _pos.y, fz = _pos.z;
        const hit = new Set();
        for (let k = 0; k <= chains && cur; k++) {
          hit.add(cur);
          const ty = cur.y + cur.sp.height * cur.scale * 0.55;
          g.vfx.lightning(fx, fy, fz, cur.x, ty, cur.z, 1.5, 4, 7, 0.14);
          fx = cur.x; fy = ty; fz = cur.z;
          g.enemies.damage(cur, dmg * this._rollCrit(), { source: 'tesla' });
          cur.slowT = 0.6;
          let best = null, bd = 12 * 12;
          g.enemies.within(fx, fz, 12, _tmp2);
          for (const o of _tmp2) {
            if (hit.has(o)) continue;
            const d2 = (o.x - fx) ** 2 + (o.z - fz) ** 2;
            if (d2 < bd) { bd = d2; best = o; }
          }
          cur = best;
        }
        if (hit.size) {
          g.audio.play('tesla', { volume: 0.5 });
          g.vfx.light(_pos.x, _pos.y + 0.5, _pos.z, 0x66ccff, 60, 12, 0.1);
        }
        if (thunder) {
          // Sky strikes on 3 random enemies
          g.enemies.within(p.x + p.fx * 15, p.z + p.fz * 15, 40, _tmp);
          for (let k = 0; k < 3 && _tmp.length; k++) {
            const e = _tmp[(Math.random() * _tmp.length) | 0];
            g.vfx.lightning(e.x + (Math.random() - 0.5) * 4, 40, e.z + (Math.random() - 0.5) * 4, e.x, 0.3, e.z, 2, 4.5, 8, 0.2, 0.22);
            this.blast(e.x, e.z, 4.5 * this.areaMult, 40 * this.dmgMult, 1, 'thunder', false);
          }
        }
      }
    }

    // --- Exhaust Flamer / Inferno Wake -----------------------------------------------------------------------------
    const fl = L('flamer');
    this.flaming = false;
    if (fl || E('inferno')) {
      const inferno = E('inferno');
      const range = (inferno ? 14 : 8 * (fl >= 2 ? 1.3 : 1) * (fl >= 4 ? 1.3 : 1)) * this.areaMult;
      p.toWorld(_pos.set(0, 0.45, -2.5), _pos);
      const bx = -p.fx, bz = -p.fz;
      // Flame particles stream out of the exhaust
      for (let k = 0; k < 3; k++) {
        const sp = 12 + Math.random() * 6;
        const a = Math.atan2(bx, bz) + (Math.random() - 0.5) * 0.5;
        g.vfx.glow.spawn(_pos.x + (Math.random() - 0.5) * 0.8, _pos.y, _pos.z, Math.sin(a) * sp + p.vx * 0.85, 0.5 + Math.random() * 1.5, Math.cos(a) * sp + p.vz * 0.85,
          range / 16, 0.35, 1.4 * (inferno ? 1.4 : 1), 7, 2.4, 0.4, { r1: 1.5, g1: 0.2, b1: 0.05, drag: 1.2 });
      }
      this.flaming = true;
      if (this._ready('flamer', 0.15)) {
        const dmg = (inferno ? 10 : 4.5 * (fl >= 3 ? 1.4 : 1) * (fl >= 5 ? 1.5 : 1)) * this.dmgMult;
        g.enemies.within(_pos.x + bx * range * 0.5, _pos.z + bz * range * 0.5, range * 0.55, _tmp);
        for (const e of _tmp) {
          g.enemies.damage(e, dmg, { source: 'flamer', noNumber: Math.random() < 0.6 });
          e.burn = Math.max(e.burn, fl >= 4 || inferno ? 3 : 2);
        }
      }
      if (inferno && this._ready('inferno_drop', 0.18)) {
        if (this.fires.length >= FIRE_MAX) this.fires.shift();
        this.fires.push({ x: _pos.x + bx * 3, z: _pos.z + bz * 3, life: 3.5, r: 3.2 * this.areaMult });
      }
    }

    // --- Flare Mines / Nova Mines ----------------------------------------------------------------------------------
    const mnl = L('mines');
    if (mnl || E('nova')) {
      const nova = E('nova');
      const period = nova ? 1.0 : mnl >= 3 ? 1.1 : 1.5;
      if (this._ready('mines', period)) {
        const count = mnl >= 5 || nova ? 2 : 1;
        for (let k = 0; k < count; k++) {
          if (this.mines.length >= MINE_MAX) this.mines.shift();
          p.toWorld(_pos.set((k - (count - 1) / 2) * 1.6, 0, -2.6), _pos);
          this.mines.push({ x: _pos.x, z: _pos.z, arm: 0.35, life: 14, nova, dmg: (nova ? 95 : 42 * (mnl >= 2 ? 1.4 : 1)) * this.dmgMult, radius: (nova ? 9 : 5 * (mnl >= 4 ? 1.3 : 1)) * this.areaMult, blink: Math.random() });
        }
        g.audio.play('mine', { volume: 0.3 });
      }
    }

    // --- Hubcap Saws / Buzzsaw Halo -------------------------------------------------------------------------------
    const swl = L('saws');
    this.sawBatch.begin();
    if (swl || E('buzzsaw')) {
      const buzz = E('buzzsaw');
      const count = buzz ? 8 : 2 + (swl >= 2) + (swl >= 4) + (swl >= 5);
      const radius = (buzz ? 6.2 : swl >= 4 ? 4.6 : 3.9) * Math.sqrt(this.areaMult);
      const spin = buzz ? 4.2 : swl >= 5 ? 3.8 : 3.0;
      this.sawAngle += spin * dt;
      const dmg = (buzz ? 34 : 13 * (swl >= 3 ? 1.4 : 1)) * this.dmgMult;
      const size = (buzz ? 1.5 : 1.0) * Math.sqrt(this.areaMult);
      for (let k = 0; k < count; k++) {
        const a = this.sawAngle + (k / count) * Math.PI * 2;
        const sx = p.x + Math.sin(a) * radius, sz = p.z + Math.cos(a) * radius;
        this.sawBatch.add(sx, 0.75, sz, this.sawAngle * 9, 0, 0, size, size, size, 1, 1, 1, buzz ? 2.5 : 1);
        g.enemies.within(sx, sz, 0.8 * size, _tmp);
        for (const e of _tmp) {
          if (e.sawCd > 0) continue;
          e.sawCd = 0.3;
          const tx = Math.cos(a), tz = -Math.sin(a); // tangential push
          g.enemies.damage(e, dmg * this._rollCrit(), { source: 'saw', kx: tx * (buzz ? 22 : 10), kz: tz * (buzz ? 22 : 10) });
          g.vfx.sparks(sx, 0.75, sz, 4, 9, 6, 3.5, 1);
          g.audio.play('saw', { x: sx, z: sz, volume: 0.35 });
        }
      }
    }
    this.sawBatch.end();

    this._updateProjectiles(dt);
    this._updateSpecial(dt);
  }

  /** Hitscan rail: pierces everything along the line to the aim point and beyond */
  _fireRail() {
    const g = this.game;
    const p = g.player;
    p.muzzle(_pos, _dir);
    _dir.set(this.aim.x - _pos.x, this.aim.y - _pos.y, this.aim.z - _pos.z).normalize();
    const len = 130;
    const ex = _pos.x + _dir.x * len, ey = _pos.y + _dir.y * len, ez = _pos.z + _dir.z * len;
    const dmg = 70 * this.dmgMult;
    // Walk the line in 3 m steps querying the hash
    const hit = new Set();
    const groundT = _dir.y < -0.01 ? Math.min(len, -_pos.y / _dir.y) : len;
    for (let s = 0; s < groundT + 2; s += 3) {
      const x = _pos.x + _dir.x * s, z = _pos.z + _dir.z * s, y = _pos.y + _dir.y * s;
      g.enemies.within(x, z, 1.8, _tmp);
      for (const e of _tmp) {
        if (hit.has(e)) continue;
        const top = e.y + e.sp.height * e.scale;
        if (y < e.y - 1 || y > top + 1.5) continue;
        hit.add(e);
        const weak = g.boss?.weakHit(e, x, y, z) ?? 1;
        g.enemies.damage(e, dmg * this._rollCrit(weak > 1 ? weak * 1.6 : 1), { source: 'rail', crit: weak > 1, kx: _dir.x * 8, kz: _dir.z * 8 });
      }
    }
    const endT = Math.min(len, groundT + 1);
    const hx = _pos.x + _dir.x * endT, hy = _pos.y + _dir.y * endT, hz = _pos.z + _dir.z * endT;
    g.vfx.beam(_pos.x, _pos.y, _pos.z, hx, hy, hz, 0.35, 2, 7, 9, 0.16);
    g.vfx.beam(_pos.x, _pos.y, _pos.z, hx, hy, hz, 0.12, 8, 10, 12, 0.1);
    if (endT < len) g.vfx.hitSpark(hx, hy + 0.2, hz, 2, 6, 9);
    g.vfx.muzzle(_pos.x, _pos.y, _pos.z, _dir.x, _dir.y, _dir.z, 2.2, 1.5, 6, 9);
    g.vfx.light(_pos.x, _pos.y, _pos.z, 0x66ffff, 90, 14, 0.1);
    p.recoil = 1;
    g.audio.play('gun', { volume: 0.8, pitch: 0.6 });
    g.audio.play('tesla', { volume: 0.3 });
    g.cam.addTrauma(0.07);
    g.cam.fovKick -= 1.2;
    this.shotsFired++;
    void ex; void ey; void ez;
  }

  /** Area damage with falloff; color 0 fire, 1 plasma, 2 magenta */
  blast(x, z, radius, dmg, color = 0, source = 'blast', vfx = true) {
    const g = this.game;
    g.enemies.within(x, z, radius, _tmp2);
    for (const e of _tmp2) {
      const d = Math.hypot(e.x - x, e.z - z);
      const k = 1 - Math.min(0.6, d / (radius + e.radius) * 0.6);
      const nx = (e.x - x) / (d || 1), nz = (e.z - z) / (d || 1);
      g.enemies.damage(e, dmg * k * this._rollCrit(), { source, explosive: true, kx: nx * 14 * k, kz: nz * 14 * k });
    }
    if (vfx) {
      g.vfx.explosion(x, 0.3, z, radius / 4, color);
      g.audio.play('explosion', { x, z, volume: Math.min(1, 0.35 + radius * 0.06), pitch: 1.2 - Math.min(0.5, radius * 0.04) });
      g.cam.addTrauma(Math.min(0.2, radius * 0.015));
    }
  }

  _updateProjectiles(dt) {
    const g = this.game;
    const B = this.b;
    const en = g.enemies;
    this.tracers.begin();
    for (let i = 0; i < B.n; i++) {
      B.life[i] -= dt;
      let dead = B.life[i] <= 0;
      const x0 = B.x[i], y0 = B.y[i], z0 = B.z[i];
      B.x[i] += B.vx[i] * dt; B.y[i] += B.vy[i] * dt; B.z[i] += B.vz[i] * dt;
      if (!dead && B.y[i] <= 0.05) {
        // Hit the street
        dead = true;
        g.vfx.hitSpark(B.x[i], 0.15, B.z[i], B.cr[i], B.cg[i], B.cb[i]);
        if (B.boom[i] > 0) this.blast(B.x[i], B.z[i], B.boom[i], B.dmg[i] * 0.8, B.kind[i] === 1 ? 1 : 0, 'blast');
      }
      if (!dead) {
        // Sweep test: sample midpoint and end (bullets move ≤ 2.5 m per frame at 150 m/s)
        const steps = 2;
        for (let s = 1; s <= steps && !dead; s++) {
          const t = s / steps;
          const x = x0 + (B.x[i] - x0) * t, y = y0 + (B.y[i] - y0) * t, z = z0 + (B.z[i] - z0) * t;
          en.within(x, z, B.r[i], _tmp);
          for (const e of _tmp) {
            if (e === B.last[i]) continue;
            const top = e.y + e.sp.height * e.scale + 0.4;
            if (y < e.y - 0.6 || y > top) continue;
            const weak = g.boss?.weakHit(e, x, y, z) ?? 1;
            const crit = this._rollCrit(weak);
            en.damage(e, B.dmg[i] * crit, { source: B.kind[i] === 1 ? 'cannon' : 'gun', crit: crit > 1, kx: B.vx[i] * 0.03, kz: B.vz[i] * 0.03 });
            if (B.burn[i] > 0) e.burn = Math.max(e.burn, B.burn[i]);
            g.vfx.hitSpark(x, y, z, B.cr[i], B.cg[i], B.cb[i]);
            if (B.kind[i] === 1) g.onCannonHit(e, weak > 1);
            if (B.boom[i] > 0) this.blast(x, z, B.boom[i], B.dmg[i] * 0.6, B.kind[i] === 1 ? 1 : 0, 'blast');
            B.last[i] = e;
            if (B.pierce[i] <= 0) { dead = true; break; }
            B.pierce[i]--;
          }
        }
      }
      if (dead) {
        // swap-remove
        const j = --B.n;
        if (i !== j) {
          for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'life', 'dmg', 'pierce', 'r', 'boom', 'kind', 'cr', 'cg', 'cb', 'w', 'len', 'burn']) B[k][i] = B[k][j];
          B.last[i] = B.last[j];
        }
        i--;
        continue;
      }
      const sp = Math.hypot(B.vx[i], B.vy[i], B.vz[i]) || 1;
      const L = B.len[i];
      this.tracers.addSegment(B.x[i], B.y[i], B.z[i], B.x[i] - (B.vx[i] / sp) * L, B.y[i] - (B.vy[i] / sp) * L, B.z[i] - (B.vz[i] / sp) * L,
        B.w[i], B.w[i], B.cr[i], B.cg[i], B.cb[i], 1);
    }
    this.tracers.end();

    // Missiles: boost up, then home
    this.missileBatch.begin();
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.t += dt;
      m.life -= dt;
      let t = m.target;
      if (!t || !t.alive || t.state === 'dying' || t.state === 'launched') {
        t = m.target = en.nearest(m.x, m.z, 40);
      }
      if (m.t > 0.25 && t) {
        const ty = t.y + t.sp.height * t.scale * 0.5;
        const dx = t.x - m.x, dy = ty - m.y, dz = t.z - m.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sp = 46;
        const k = Math.min(1, dt * (4 + m.t * 6));
        m.vx += (dx / d * sp - m.vx) * k;
        m.vy += (dy / d * sp - m.vy) * k;
        m.vz += (dz / d * sp - m.vz) * k;
        if (d < 1.4 + t.radius * 0.5) m.life = 0;
      } else {
        m.vy -= 12 * dt;
      }
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      if (m.y < 0.2) m.life = 0;
      // Exhaust trail
      g.vfx.glow.spawn(m.x, m.y, m.z, 0, 0.3, 0, 0.18, 0.35, 0.05, 6, 2.5, 0.6);
      if (Math.random() < 0.5) g.vfx.smoke.spawn(m.x, m.y, m.z, (Math.random() - 0.5), 0.5, (Math.random() - 0.5), 0.6, 0.2, 0.9, 0.3, 0.3, 0.32, { drag: 2 });
      if (m.life <= 0) {
        this.blast(m.x, m.z, m.radius, m.dmg, 0, 'missile');
        if (m.cluster) {
          for (let k = 0; k < 4; k++) {
            const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 4;
            this.pendingBlasts = this.pendingBlasts || [];
            this.pendingBlasts.push({ x: m.x + Math.cos(a) * r, z: m.z + Math.sin(a) * r, t: 0.15 + k * 0.08, r: m.radius * 0.7, dmg: m.dmg * 0.6 });
          }
        }
        this.missiles.splice(i, 1);
        continue;
      }
      const yaw = Math.atan2(m.vx, m.vz), pitch = -Math.atan2(m.vy, Math.hypot(m.vx, m.vz));
      this.missileBatch.add(m.x, m.y, m.z, yaw, pitch, m.t * 12, 1.4, 1.4, 1.4, 1, 1, 1, 1);
    }
    this.missileBatch.end();
    if (this.pendingBlasts) {
      for (let i = this.pendingBlasts.length - 1; i >= 0; i--) {
        const pb = this.pendingBlasts[i];
        pb.t -= dt;
        if (pb.t <= 0) { this.blast(pb.x, pb.z, pb.r, pb.dmg, 0, 'missile'); this.pendingBlasts.splice(i, 1); }
      }
    }

    // Mines
    this.mineBatch.begin();
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mn = this.mines[i];
      mn.arm -= dt;
      mn.life -= dt;
      mn.blink += dt;
      let boom = mn.life <= 0;
      if (mn.arm <= 0 && !boom) {
        en.within(mn.x, mn.z, 2.4, _tmp);
        if (_tmp.length) boom = true;
      }
      if (boom) {
        this.blast(mn.x, mn.z, mn.radius, mn.dmg, mn.nova ? 1 : 0, 'mine');
        if (mn.nova) g.vfx.shockwave(mn.x, mn.z, mn.radius * 1.4, 1, 3, 6, 0.6);
        this.mines.splice(i, 1);
        continue;
      }
      const on = (mn.blink * 3) % 1 < 0.5 ? 2.5 : 0.4;
      this.mineBatch.add(mn.x, 0, mn.z, mn.blink, 0, 0, 1.3, 1.3, 1.3, mn.nova ? 0.6 : 1, mn.nova ? 0.7 : 1, 1, on);
      if (mn.arm <= 0) g.vfx.ring(mn.x, mn.z, 2.4, mn.nova ? 0.6 : 1.5, mn.nova ? 0.6 : 0.2, mn.nova ? 2 : 0.3, 0.12);
    }
    this.mineBatch.end();

    // Burning ground (Inferno Wake)
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.life -= dt;
      if (f.life <= 0) { this.fires.splice(i, 1); continue; }
      if (Math.random() < dt * 14) {
        g.vfx.glow.spawn(f.x + (Math.random() - 0.5) * f.r, 0.3, f.z + (Math.random() - 0.5) * f.r, 0, 2 + Math.random() * 2, 0, 0.5, 0.6, 1.4, 6, 1.8, 0.3, { r1: 1, g1: 0.15, b1: 0.02 });
      }
      f.tick = (f.tick || 0) - dt;
      if (f.tick <= 0) {
        f.tick = 0.3;
        en.within(f.x, f.z, f.r, _tmp);
        for (const e of _tmp) { en.damage(e, this.burnDps * 0.3, { source: 'flamer', noNumber: true }); e.burn = Math.max(e.burn, 2); }
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Skyhammer air strike: charged by kills, called onto the reticle
  addCharge(v) {
    this.special.charge = Math.min(1, this.special.charge + v);
  }

  triggerSpecial() {
    const s = this.special;
    if (s.charge < 1 || s.active) return false;
    s.charge = 0;
    const g = this.game;
    const tx = this.aim.x, tz = this.aim.z;
    const p = g.player;
    // Strikes walk along the car's heading through the target point
    s.active = { t: 0, x: tx, z: tz, fx: p.fx, fz: p.fz, n: 0 };
    g.audio.play('airstrike', { volume: 0.9 });
    g.hud.banner('SKYHAMMER INBOUND', 'Air strike on your mark', 'special');
    return true;
  }

  _updateSpecial(dt) {
    const s = this.special.active;
    if (!s) return;
    const g = this.game;
    s.t += dt;
    // Target marker
    const lead = 0.9;
    if (s.t < lead) {
      g.vfx.telegraphCircle(s.x, s.z, 14, s.t / lead, 6, 0.6, 0.2);
      return;
    }
    const strikes = 9;
    while (s.n < strikes && s.t > lead + s.n * 0.09) {
      const k = s.n - (strikes - 1) / 2;
      const x = s.x + s.fx * k * 4.5 + (Math.random() - 0.5) * 5;
      const z = s.z + s.fz * k * 4.5 + (Math.random() - 0.5) * 5;
      this.blast(x, z, 9 * this.areaMult, 170 * this.dmgMult, 0, 'skyhammer');
      g.vfx.beam(x, 60, z, x, 0, z, 0.6, 8, 4, 1, 0.12);
      s.n++;
    }
    if (s.n >= strikes) {
      g.cam.addTrauma(0.5);
      g.flash(0.25);
      g.hitStop(0.06);
      this.special.active = null;
    }
  }
}

export { WeaponSystem };
