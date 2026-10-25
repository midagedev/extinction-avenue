import { PropBatch } from './batches.js';

// js/game/pickups.js
// Gene cores (XP) and power-ups. Cores pop out of fossilized dinosaurs, sit glowing on the asphalt and fly to the cab
// once inside the magnet radius. Four tiers by value (green 1, blue 5, violet 20, gold 60); when too many are lying
// around, new ones merge into the nearest existing core instead (bounded cost, Vampire Survivors-style).

const GEM_MAX = 1200;
const TIERS = [
  { min: 0, color: [0.3, 1.0, 0.45], scale: 0.9 },
  { min: 5, color: [0.25, 0.65, 1.0], scale: 1.1 },
  { min: 20, color: [0.8, 0.35, 1.0], scale: 1.35 },
  { min: 60, color: [1.0, 0.75, 0.2], scale: 1.7 }
];
const POWERUPS = {
  crate: { radius: 3.4, glow: [0.4, 3, 4] },
  repair: { radius: 3, glow: [0.6, 4, 1.2] },
  nitro: { radius: 3, glow: [1, 2, 5] },
  vacuum: { radius: 3, glow: [1.5, 2.5, 5] },
  airstrike: { radius: 3, glow: [5, 0.6, 0.4] }
};

class Pickups {
  constructor(game, assets) {
    this.game = game;
    this.gemBatch = new PropBatch(assets.get('gem').geometry, GEM_MAX, { name: 'p.gems', glow: 2.2 });
    this.batches = {};
    for (const id of Object.keys(POWERUPS)) this.batches[id] = new PropBatch(assets.get(id).geometry, 16, { name: `p.${id}`, glow: 1.5 });
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
    G.vx[i] = Math.cos(a) * s; G.vz[i] = Math.sin(a) * s; G.vy[i] = 5 + Math.random() * 3;
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

  spawnItem(type, x, z) {
    if (this.items.length > 24) return;
    this.items.push({ type, x, z, y: 0, vy: 7, t: 0, life: 40 });
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    this.time += dt;
    const G = this.g;
    const magnet = 7.5 * p.stats.magnet;
    const m2 = magnet * magnet;
    const collect = 2.2;
    let gained = 0;
    this.pitchTimer -= dt;
    if (this.pitchTimer <= 0) this.pitchStep = 0;
    this.gemBatch.begin();
    for (let i = 0; i < G.n; i++) {
      G.t[i] += dt;
      const dx = p.x - G.x[i], dz = p.z - G.z[i];
      const d2 = dx * dx + dz * dz;
      if (G.pull[i] || (d2 < m2 && G.t[i] > 0.25 && p.alive)) {
        G.pull[i] = 1;
        const d = Math.sqrt(d2) || 1e-3;
        const sp = 18 + p.speed * 1.2 + G.t[i] * 6;
        G.vx[i] += (dx / d * sp - G.vx[i]) * Math.min(1, dt * 10);
        G.vz[i] += (dz / d * sp - G.vz[i]) * Math.min(1, dt * 10);
        G.vy[i] = (1.2 - G.y[i]) * 6;
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
      game.audio.play('gem', { volume: 0.4, pitch: Math.pow(2, this.pitchStep / 24) });
    }

    // Power-ups
    for (const b of Object.values(this.batches)) b.begin();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.life -= dt;
      it.vy -= 20 * dt;
      it.y = Math.max(0, it.y + it.vy * dt);
      if (it.y === 0) it.vy = 0;
      const def = POWERUPS[it.type];
      const d = Math.hypot(p.x - it.x, p.z - it.z);
      if (d < def.radius + 1.6 * p.stats.magnet && p.alive && it.t > 0.4) {
        game.collectItem(it.type, it.x, it.z);
        this.items.splice(i, 1);
        continue;
      }
      if (it.life <= 0 || d > 260) { this.items.splice(i, 1); continue; }
      const bob = 0.35 + Math.sin(it.t * 3) * 0.2;
      this.batches[it.type].add(it.x, it.y + bob, it.z, it.t * 1.5, 0, 0, 1.25, 1.25, 1.25, 1, 1, 1, 1.2 + Math.sin(it.t * 6) * 0.4);
      // Beacon: ground ring + light column so it reads from the chase cam
      game.vfx.ring(it.x, it.z, 1.6 + Math.sin(it.t * 4) * 0.2, def.glow[0] * 0.4, def.glow[1] * 0.4, def.glow[2] * 0.4, 0.5);
      if (Math.random() < dt * 8) game.vfx.glow.spawn(it.x + (Math.random() - 0.5) * 0.8, 0.3, it.z + (Math.random() - 0.5) * 0.8, 0, 3, 0, 0.7, 0.2, 0.05, ...def.glow);
    }
    for (const b of Object.values(this.batches)) b.end();
  }
}

export { Pickups };
