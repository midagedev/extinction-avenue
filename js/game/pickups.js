import { PropBatch } from './batches.js';

// js/game/pickups.js
// Gene cores (XP) and power-ups. Cores pop out of fossilized dinosaurs and stream to the gunner on their own (no driving
// to collect in a rail shooter). Four tiers by value (green 1, blue 5, violet 20, gold 60); when too many are around,
// new ones merge into an existing core. Power-ups: drops from elites fly in by themselves; SUPPLY DROPS float in the
// air behind the cab (a Cretagen drone dropped them) and drift away — shoot them to collect them, arcade style.
//   repair: +30 hull · crate: an extra level-up pick (4 cards) · airstrike: Skyhammer charged · overdrive: 8 s of
//   bottomless belt and +50% fire rate.

const GEM_MAX = 1200;
const TIERS = [
  { min: 0, color: [0.3, 1.0, 0.45], scale: 0.9 },
  { min: 5, color: [0.25, 0.65, 1.0], scale: 1.1 },
  { min: 20, color: [0.8, 0.35, 1.0], scale: 1.35 },
  { min: 60, color: [1.0, 0.75, 0.2], scale: 1.7 }
];
const POWERUPS = {
  crate: { geo: 'crate', glow: [0.4, 3, 4] },
  repair: { geo: 'repair', glow: [0.6, 4, 1.2] },
  overdrive: { geo: 'nitro', glow: [1, 2, 5] },
  airstrike: { geo: 'airstrike', glow: [5, 0.6, 0.4] }
};
const _s = {};

class Pickups {
  constructor(game, assets) {
    this.game = game;
    this.gemBatch = new PropBatch(assets.get('gem').geometry, GEM_MAX, { name: 'p.gems', glow: 2.2 });
    this.batches = {};
    for (const [id, def] of Object.entries(POWERUPS)) this.batches[id] = new PropBatch(assets.get(def.geo).geometry, 16, { name: `p.${id}`, glow: 1.5 });
    const f = (n) => new Float32Array(n);
    this.g = { n: 0, x: f(GEM_MAX), y: f(GEM_MAX), z: f(GEM_MAX), vx: f(GEM_MAX), vy: f(GEM_MAX), vz: f(GEM_MAX), v: f(GEM_MAX), t: f(GEM_MAX), pull: new Uint8Array(GEM_MAX) };
    this.items = [];
    this.time = 0;
    this.pitchStep = 0;
    this.pitchTimer = 0;
  }

  meshes() {
    return [this.gemBatch.mesh, ...Object.values(this.batches).map((b) => b.mesh)];
  }

  clear() {
    this.g.n = 0;
    this.items.length = 0;
  }

  gem(x, z, value) {
    const G = this.g;
    if (G.n >= GEM_MAX - 50) {
      // Merge into the nearest core
      let best = -1, bd = Infinity;
      for (let i = 0; i < G.n; i += 3) {
        const d = (G.x[i] - x) ** 2 + (G.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) { G.v[best] += value; return; }
    }
    const i = G.n++;
    G.x[i] = x; G.y[i] = 0.6; G.z[i] = z;
    const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
    const p = this.game.player;
    G.vx[i] = Math.cos(a) * s + p.vx * 0.7; G.vz[i] = Math.sin(a) * s + p.vz * 0.7; G.vy[i] = 5 + Math.random() * 3;
    G.v[i] = value;
    G.t[i] = 0;
    G.pull[i] = 0;
  }

  /** Banks every core on the map instantly (keeps cinematic shots clean) */
  collectAll() {
    const G = this.g;
    let v = 0;
    for (let i = 0; i < G.n; i++) v += G.v[i];
    G.n = 0;
    if (v > 0) this.game.addXP(v);
  }

  /** Pull every core on the map to the cab */
  vacuum() {
    const G = this.g;
    for (let i = 0; i < G.n; i++) G.pull[i] = 1;
  }

  /** A drop that flies to the cab on its own (elite crates, rare kill drops) */
  spawnItem(type, x, z, y = 1) {
    if (this.items.length > 24 || !POWERUPS[type]) return null;
    const it = { type, x, z, y, vx: 0, vy: 7, vz: 0, t: 0, life: 12, auto: true, pull: false };
    this.items.push(it);
    return it;
  }

  /** A supply drop floating behind the cab (route-relative), collected by shooting it */
  spawnFloating(type, gap = -16, d = null, y = 3.2) {
    if (this.items.length > 24 || !POWERUPS[type]) return null;
    const p = this.game.player;
    const r = this.game.route.sample(p.s + gap, _s);
    const dd = d ?? (Math.random() - 0.5) * Math.max(2, r.halfWidth * 1.2);
    const it = { type, gap, d: dd, y, x: r.x + r.rx * dd, z: r.z + r.rz * dd, vx: 0, vy: 0, vz: 0, t: 0, life: 9, auto: false, float: true, pull: false };
    this.items.push(it);
    return it;
  }

  /** First floating drop hit by a ray: { item, t } or null */
  raycast(ray, maxT) {
    let best = null, bt = maxT;
    for (const it of this.items) {
      if (!it.float || it.pull) continue;
      const ox = ray.origin.x - it.x, oy = ray.origin.y - (it.y + 0.5), oz = ray.origin.z - it.z;
      const d = ray.direction;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const c = ox * ox + oy * oy + oz * oz - 1.5 * 1.5;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bt) { bt = t; best = it; }
    }
    return best ? { item: best, t: bt } : null;
  }

  /** Shot a floating drop: it pops and streams to the cab */
  shoot(it) {
    if (it.pull) return;
    it.pull = true;
    it.t = 0.4;
    const g = this.game;
    g.vfx.sparks(it.x, it.y + 0.5, it.z, 14, 9, ...POWERUPS[it.type].glow);
    g.vfx.shockwave(it.x, it.z, 3, ...POWERUPS[it.type].glow.map((c) => c * 0.4), 0.4);
    g.audio.play('pickup');
    g.onPickupShot?.(it);
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    this.time += dt;
    const G = this.g;
        // Collected well before reaching the gunner's eye (they'd fill the screen), aimed low at the cab body
        const collect = 6;
    let gained = 0;
    this.pitchTimer -= dt;
    if (this.pitchTimer <= 0) this.pitchStep = 0;
    this.gemBatch.begin();
    for (let i = 0; i < G.n; i++) {
      G.t[i] += dt;
      const dx = p.x - G.x[i], dz = p.z - G.z[i];
      const d2 = dx * dx + dz * dz;
      if (G.pull[i] || (G.t[i] > 0.45 && p.alive)) {
        G.pull[i] = 1;
        const d = Math.sqrt(d2) || 1e-3;
        const sp = 18 + p.speed * 1.2 + G.t[i] * 6;
        G.vx[i] += (p.vx + dx / d * sp - G.vx[i]) * Math.min(1, dt * 10);
        G.vz[i] += (p.vz + dz / d * sp - G.vz[i]) * Math.min(1, dt * 10);
        G.vy[i] = (0.7 - G.y[i]) * 4;
        if (d < collect) {
          gained += G.v[i];
          const j = --G.n;
          if (i !== j) {
            for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'v', 't']) G[k][i] = G[k][j];
            G.pull[i] = G.pull[j];
          }
          i--;
          continue;
        }
      } else {
        G.vx[i] *= 1 - Math.min(1, dt * 3);
        G.vz[i] *= 1 - Math.min(1, dt * 3);
        G.vy[i] -= 22 * dt;
        if (G.y[i] < 0.55 && G.vy[i] < 0) { G.y[i] = 0.55; G.vy[i] *= -0.3; }
        // Too far behind: recycle into the bank (keeps XP flowing on rails)
        if (d2 > 140 * 140) { gained += G.v[i] * 0.5; G.v[i] = 0; G.pull[i] = 1; G.x[i] = p.x; G.z[i] = p.z; }
      }
      G.x[i] += G.vx[i] * dt; G.y[i] += G.vy[i] * dt; G.z[i] += G.vz[i] * dt;
      const v = G.v[i];
      const tier = v >= 60 ? 3 : v >= 20 ? 2 : v >= 5 ? 1 : 0;
      const T = TIERS[tier];
      const bob = Math.sin(this.time * 3 + i) * 0.12;
      this.gemBatch.add(G.x[i], G.y[i] + bob, G.z[i], this.time * 2.2 + i, 0, 0, T.scale, T.scale, T.scale, T.color[0], T.color[1], T.color[2], 1.6);
    }
    this.gemBatch.end();
    if (gained > 0) {
      game.addXP(gained);
      this.pitchStep = Math.min(24, this.pitchStep + 1);
      this.pitchTimer = 0.5;
      game.audio.play('xp', { pitch: Math.pow(2, this.pitchStep / 24) });
    }

    // Power-ups
    for (const b of Object.values(this.batches)) b.begin();
    const route = game.route;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.life -= dt;
      const def = POWERUPS[it.type];
      if (it.float && !it.pull) {
        // Drift back down the road behind the cab, bobbing; gone if nobody shoots it
        it.gap -= dt * 2.6;
        const r = route.sample(p.s + it.gap, _s);
        it.x = r.x + r.rx * it.d;
        it.z = r.z + r.rz * it.d;
        it.y = 3.2 + Math.sin(it.t * 2.2) * 0.35;
        if (it.life <= 0) { game.vfx.sparks(it.x, it.y, it.z, 6, 4, 2, 2, 2); this.items.splice(i, 1); continue; }
        game.vfx.ring(it.x, it.z, 1.8 + Math.sin(it.t * 4) * 0.2, def.glow[0] * 0.5, def.glow[1] * 0.5, def.glow[2] * 0.5, 0.6);
        if (Math.random() < dt * 14) game.vfx.glow.spawn(it.x + (Math.random() - 0.5) * 1.2, it.y + Math.random(), it.z + (Math.random() - 0.5) * 1.2, 0, 1.5, 0, 0.6, 0.25, 0.05, ...def.glow);
        // Drone rotor glow above it
        if (Math.random() < dt * 30) game.vfx.glow.spawn(it.x + Math.cos(it.t * 30) * 0.9, it.y + 1.6, it.z + Math.sin(it.t * 30) * 0.9, 0, 0, 0, 0.08, 0.3, 0.1, 4, 4, 4);
      } else {
        if (!it.pull && it.t > (it.auto ? 0.5 : 0.4)) it.pull = true;
        if (it.pull) {
          const dx = p.x - it.x, dy = 0.8 - it.y, dz = p.z - it.z;
          const d = Math.hypot(dx, dy, dz) || 1e-3;
          const sp = 16 + p.speed + it.t * 10;
          it.vx += (p.vx + dx / d * sp - it.vx) * Math.min(1, dt * 8);
          it.vy += (dy / d * sp - it.vy) * Math.min(1, dt * 8);
          it.vz += (p.vz + dz / d * sp - it.vz) * Math.min(1, dt * 8);
          if (d < 5.5 && p.alive) {
            game.collectItem(it.type, it.x, it.z);
            this.items.splice(i, 1);
            continue;
          }
        } else {
          it.vy -= 20 * dt;
        }
        it.x += it.vx * dt; it.y = Math.max(0.3, it.y + it.vy * dt); it.z += it.vz * dt;
        if (it.life <= 0) { this.items.splice(i, 1); continue; }
      }
      const pulse = 1.2 + Math.sin(it.t * 6) * 0.4;
      this.batches[it.type].add(it.x, it.y, it.z, it.t * 1.5, 0, 0, it.float ? 1.5 : 1.1, it.float ? 1.5 : 1.1, it.float ? 1.5 : 1.1, 1, 1, 1, pulse);
    }
    for (const b of Object.values(this.batches)) b.end();
  }
}

export { Pickups };
