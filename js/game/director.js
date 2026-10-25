// js/game/director.js
// The run's pacing: a timeline of waves (species mix, spawn rate, population cap), scripted events (stampedes pouring
// out of cross streets, pterosaur flocks, elites, mini-bosses, the T. rex cameo and boss), difficulty scaling, and
// spawn placement on walkable ground around the route (ahead, behind, side streets).

const BOSS_TIME = 450; // 7:30 — GRIDLOCK arrives

const WAVES = [
  { t: 0, mix: { compy: 1 }, rate: 12, cap: 140 },
  { t: 20, mix: { compy: 0.85, raptor: 0.15 }, rate: 14, cap: 180 },
  { t: 55, label: ['WAVE 2', 'PACK HUNTERS'], mix: { compy: 0.62, raptor: 0.38 }, rate: 16, cap: 230 },
  { t: 95, mix: { compy: 0.58, raptor: 0.3, ptero: 0.12 }, rate: 17, cap: 270 },
  { t: 140, label: ['WAVE 3', 'BRUTE FORCE'], mix: { compy: 0.52, raptor: 0.3, brute: 0.08, ptero: 0.1 }, rate: 19, cap: 320 },
  { t: 200, mix: { compy: 0.5, raptor: 0.28, brute: 0.1, ptero: 0.08, trike: 0.04 }, rate: 21, cap: 380 },
  { t: 250, label: ['WAVE 4', 'HEAVY TRAFFIC'], mix: { compy: 0.46, raptor: 0.27, brute: 0.1, ptero: 0.08, trike: 0.05, ankylo: 0.04 }, rate: 24, cap: 440 },
  { t: 320, label: ['WAVE 5', 'APEX HOUR'], mix: { compy: 0.5, raptor: 0.25, brute: 0.11, ptero: 0.07, trike: 0.04, ankylo: 0.03 }, rate: 28, cap: 520 },
  { t: 390, mix: { compy: 0.48, raptor: 0.27, brute: 0.12, ptero: 0.07, trike: 0.03, ankylo: 0.03 }, rate: 30, cap: 580 },
  { t: BOSS_TIME, boss: true, mix: { compy: 0.5, raptor: 0.4, brute: 0.1 }, rate: 7, cap: 120 },
  // Endless (after the boss)
  { t: BOSS_TIME + 1, endless: true, label: ['ENDLESS', 'Manhattan never sleeps'], mix: { compy: 0.42, raptor: 0.28, brute: 0.13, ptero: 0.08, trike: 0.05, ankylo: 0.04 }, rate: 26, cap: 520 }
];

const EVENTS = [
  { t: 4, type: 'stampede', species: 'compy', count: 45, banner: ['OUTBREAK', 'Cretagen containment breach — Midtown'] },
  { t: 26, type: 'stampede', species: 'compy', count: 90 },
  { t: 48, type: 'cameo' },
  { t: 75, type: 'flock', count: 6 },
  { t: 105, type: 'stampede', species: 'raptor', count: 30, banner: ['STAMPEDE', 'They came from 42nd Street'] },
  { t: 125, type: 'elite', species: 'raptor', name: 'Sicklejaw Alpha' },
  { t: 170, type: 'miniboss', species: 'brute', behavior: 'alpha', name: 'ALPHA RAVAGER', sub: 'Pack leader · summons Sicklejaws' },
  { t: 215, type: 'stampede', species: 'compy', count: 160, banner: ['SWARM', 'Scuttlers everywhere'] },
  { t: 235, type: 'flock', count: 10 },
  { t: 280, type: 'miniboss', species: 'trike', name: 'HORNWALL MATRIARCH', sub: 'Triple charge · dodge the red lane' },
  { t: 330, type: 'stampede', species: 'raptor', count: 60 },
  { t: 350, type: 'elite', species: 'ankylo', name: 'Clubtail Bulwark' },
  { t: 375, type: 'stampede', species: 'compy', count: 200, banner: ['MEGA SWARM', 'Floor it'] },
  { t: 400, type: 'flock', count: 12, elite: true },
  { t: 420, type: 'elite', species: 'brute', name: 'Ravager' },
  { t: BOSS_TIME - 9, type: 'warning' },
  { t: BOSS_TIME, type: 'boss' }
];

const _s = {};

class Director {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset(startTime = 0) {
    this.time = startTime;
    this.waveIdx = -1;
    this.eventIdx = EVENTS.findIndex((e) => e.t >= startTime);
    if (this.eventIdx < 0) this.eventIdx = EVENTS.length;
    this.acc = 0;
    this.bossActive = false;
    this.bossDone = false;
    this.endless = false;
    this.endlessT = 0;
    this.wave = WAVES[0];
    this.waveNumber = 1;
  }

  get bossTime() {
    return BOSS_TIME;
  }

  /** Cruise speed of the cab along the route (m/s): picks up through the run */
  cruise() {
    if (this.bossActive) return 19;
    return 13 + Math.min(4, this.time / 120);
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    if (this.endless) this.endlessT += dt;
    // Waves
    let wi = 0;
    for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      if (w.t > this.time) break;
      if ((w.boss && !this.bossActive) || (w.endless && !this.endless)) continue;
      wi = i;
    }
    if (wi !== this.waveIdx) {
      this.waveIdx = wi;
      this.wave = WAVES[wi];
      if (this.wave.label) {
        g.hud.banner(this.wave.label[0], this.wave.label[1], 'wave');
        this.waveNumber = parseInt(this.wave.label[0].replace(/\D/g, ''), 10) || this.waveNumber;
      }
    }
    // Difficulty
    const en = g.enemies;
    const t = this.time;
    en.hpMult = 1 + (t / 60) * 0.2 + (this.endless ? (this.endlessT / 60) * 0.5 : 0);
    en.dmgMult = 1 + t / 1200 + (this.endless ? this.endlessT / 200 : 0);
    en.speedMult = 1 + Math.min(0.15, t / 3000);

    // Events
    while (this.eventIdx < EVENTS.length && EVENTS[this.eventIdx].t <= this.time) {
      this._event(EVENTS[this.eventIdx]);
      this.eventIdx++;
    }

    // Continuous spawning
    if (this.bossDone && !this.endless) return;
    const w = this.wave;
    const cap = w.cap * (this.endless ? 1 + this.endlessT / 240 : 1);
    const rate = w.rate * (this.endless ? 1 + this.endlessT / 180 : 1);
    if (en.count < cap) {
      this.acc += rate * dt;
      while (this.acc >= 1) {
        this.acc -= 1;
        const type = pick(w.mix);
        // Small fry come in clumps (better swarm reads, cheaper placement)
        const n = type === 'compy' ? 3 + ((Math.random() * 4) | 0) : type === 'raptor' ? 1 + ((Math.random() * 3) | 0) : 1;
        this.spawnGroup(type, n, this.bossActive ? 'behind' : null);
      }
    } else this.acc = 0;
  }

  _event(ev) {
    const g = this.game;
    if (ev.banner) g.hud.banner(ev.banner[0], ev.banner[1], 'wave');
    switch (ev.type) {
      case 'stampede': {
        // A torrent out of a side street ahead
        const p = g.player;
        const r = g.route.sample(p.s + 70 + Math.random() * 30, _s);
        const side = Math.random() < 0.5 ? 1 : -1;
        let placed = 0;
        for (let k = 0; k < ev.count; k++) {
          const lat = side * (14 + Math.random() * 45);
          const fwd = (Math.random() - 0.5) * 12;
          const x = r.x + r.rx * lat + r.hx * fwd, z = r.z + r.rz * lat + r.hz * fwd;
          if (g.walk.isBlocked(x, z)) continue;
          if (g.enemies.spawn(ev.species, x, z, { heading: Math.atan2(-r.rx * side, -r.rz * side) })) placed++;
        }
        // If the side street was a wall of buildings, pour them in from straight ahead instead
        for (let k = placed; k < ev.count * 0.6; k++) this.spawnGroup(ev.species, 1, 'ahead');
        g.audio.play(ev.species === 'compy' ? 'compy_chirp' : 'raptor_screech', { volume: 1 });
        break;
      }
      case 'flock':
        for (let k = 0; k < ev.count; k++) {
          const e = this.spawnOne('ptero', 'ahead', k === 0 && ev.elite ? { elite: true } : {});
          if (e) e.y = 18 + Math.random() * 8;
        }
        g.audio.play('ptero_cry', { volume: 1 });
        break;
      case 'elite': {
        const e = this.spawnOne(ev.species, 'ahead', { elite: true, name: ev.name });
        if (e) g.hud.banner('ELITE', ev.name, 'elite');
        break;
      }
      case 'miniboss': {
        const e = this.spawnOne(ev.species, 'ahead', { elite: true, scale: 1.7, hpMult: 22, name: ev.name, behavior: ev.behavior || null, dropCrate: true });
        if (e) {
          e.miniboss = true;
          g.hud.banner(ev.name, ev.sub, 'miniboss');
          g.audio.play(ev.species === 'trike' ? 'trike_bellow' : 'brute_growl', { volume: 1.2, pitch: 0.75 });
          g.trackMiniboss(e);
        }
        break;
      }
      case 'cameo':
        g.boss.cameo();
        break;
      case 'warning':
        g.hud.warning('APEX SPECIMEN APPROACHING');
        g.audio.play('warning', { volume: 1 });
        break;
      case 'boss':
        this.bossActive = true;
        g.startBoss();
        break;
    }
  }

  /** Places n of a species around one anchor point. where: 'ahead' | 'behind' | 'side' | null (weighted pick) */
  spawnGroup(type, n, where = null) {
    const anchor = this._anchor(type, where);
    if (!anchor) return 0;
    let c = 0;
    for (let k = 0; k < n; k++) {
      const x = anchor.x + (Math.random() - 0.5) * 6, z = anchor.z + (Math.random() - 0.5) * 6;
      if (this.game.walk.isBlocked(x, z)) continue;
      if (this.game.enemies.spawn(type, x, z, { heading: anchor.heading })) c++;
    }
    return c;
  }

  spawnOne(type, where, opts) {
    const anchor = this._anchor(type, where);
    if (!anchor) return null;
    return this.game.enemies.spawn(type, anchor.x, anchor.z, { heading: anchor.heading, ...opts });
  }

  /** Spawn n of a type near a point (used by alpha summons and the boss) */
  spawnNear(type, x, z, r, opts = {}) {
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.4 + Math.random() * 0.6);
      const sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d;
      if (this.game.walk.isBlocked(sx, sz)) continue;
      return this.game.enemies.spawn(type, sx, sz, opts);
    }
    return null;
  }

  _anchor(type, where) {
    const g = this.game;
    const p = g.player;
    if (!where) {
      const r = Math.random();
      if (type === 'trike' || type === 'ankylo') where = 'ahead';
      else if (type === 'ptero') where = r < 0.7 ? 'ahead' : 'side';
      else where = r < 0.6 ? 'ahead' : r < (type === 'compy' ? 0.95 : 0.85) ? 'side' : 'behind';
    }
    for (let tries = 0; tries < 8; tries++) {
      let s, lat;
      if (where === 'ahead') {
        s = p.s + 55 + Math.random() * 65;
        lat = (Math.random() - 0.5) * 2 * (Math.random() < 0.7 ? 9 : 30);
      } else if (where === 'behind') {
        s = p.s - 28 - Math.random() * 22;
        lat = (Math.random() - 0.5) * 16;
      } else {
        s = p.s + 15 + Math.random() * 60;
        lat = (Math.random() < 0.5 ? -1 : 1) * (16 + Math.random() * 35);
      }
      const r = g.route.sample(s, _s);
      const x = r.x + r.rx * lat, z = r.z + r.rz * lat;
      if (g.walk.isBlocked(x, z)) continue;
      // Never pop in right on top of the car
      if (Math.hypot(x - p.x, z - p.z) < 22) continue;
      return { x, z, heading: Math.atan2(p.x - x, p.z - z) };
    }
    return null;
  }
}

function pick(mix) {
  let total = 0;
  for (const k in mix) total += mix[k];
  let r = Math.random() * total;
  for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
  return Object.keys(mix)[0];
}

export { Director, BOSS_TIME, WAVES, EVENTS };
