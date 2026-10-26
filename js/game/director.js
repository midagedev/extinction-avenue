// js/game/director.js
// The run's pacing, arcade style: a script of BEATS instead of an endless swarm. Each beat sets the cab's speed (fast
// avenue chases, full stops in COMBAT ZONES), how many dinosaurs may be on screen, how many may attack at once and how
// long their telegraphs last, and runs a little program of spawns and set pieces (pursuers pouring down the road behind
// you, raptors smashing out of storefronts, side-street ambushes that swing the gunner's view, pterosaur raids, mini-
// bosses, supply drops). Normal beats keep 5–20 dinosaurs on screen; the stampede peaks briefly around 35. After the
// last beat comes the warning klaxon and GRIDLOCK (≈6:20 into a run, the fight itself takes a minute or two).
//
// Fairness: a grace period at the start (and after a continue), one attacker at a time early on, long telegraphs that
// shorten as the run goes on, a mercy repair drop when the hull runs low.

const _s = {};

// where: 'behind' (down the road), 'left' / 'right' (side street or storefront beside/behind the cab),
//        'storeL' / 'storeR' (smash out of a shop front), 'sky' (pterosaurs)
const BEATS = [
  {
    id: 'rollout', dur: 10, speed: 12, cap: 4, atk: 0, wind: 1.6, label: ['MIDTOWN · 7:14 PM', 'Unit 77 — hold the tailgate'],
    prog: [[1.5, 'spawn', 'compy', 2, 'behind'], [5, 'spawn', 'compy', 2, 'behind']]
  },
  {
    id: 'outbreak', dur: 40, speed: 13, cap: 8, min: 3, atk: 1, wind: 1.55, label: ['OUTBREAK', 'They\'re chasing the cab — shoot them before they jump'],
    trickle: { compy: 0.45 },
    prog: [[4, 'spawn', 'raptor', 1, 'behind'], [14, 'drop', 'overdrive'], [17, 'spawn', 'raptor', 1, 'behind'], [26, 'spawn', 'compy', 3, 'behind']]
  },
  {
    id: 'storefront', dur: 28, speed: 9, cap: 10, min: 4, atk: 1, wind: 1.5, label: ['STOREFRONT', 'Something in the shop windows…'],
    trickle: { compy: 0.25 },
    prog: [[2, 'spawn', 'raptor', 3, 'storeL'], [3, 'spawn', 'compy', 2, 'storeL'], [11, 'spawn', 'raptor', 2, 'storeR'], [14, 'cameo'], [20, 'spawn', 'compy', 3, 'right']]
  },
  {
    id: 'sky1', dur: 16, speed: 12, cap: 10, min: 3, atk: 1, wind: 1.45, label: ['INCOMING FROM ABOVE', 'Pterosaurs — shoot them out of the sky'],
    trickle: { compy: 0.2 },
    prog: [[0.5, 'spawn', 'ptero', 2, 'sky'], [0.5, 'look', 0, 0.22, 4]]
  },
  {
    id: 'zone1', dur: 55, minDur: 32, zone: true, speed: 0, cap: 15, min: 6, atk: 2, wind: 1.4, label: ['COMBAT ZONE', 'Hold the intersection'],
    prog: [
      [1, 'spawn', 'compy', 4, 'behind'], [1.5, 'spawn', 'raptor', 2, 'behind'],
      [7, 'ambush', 'left', [['raptor', 3], ['compy', 2]]],
      [17, 'ambush', 'right', [['raptor', 3], ['compy', 3]]],
      [24, 'spawn', 'brute', 1, 'behind'], [25, 'spawn', 'compy', 3, 'behind']
    ]
  },
  {
    id: 'chase1', dur: 45, speed: 18, cap: 13, min: 7, atk: 2, wind: 1.35, label: ['AVENUE CHASE', 'Floor it!'],
    trickle: { raptor: 0.4, compy: 0.45 },
    prog: [[8, 'drop', 'repair'], [18, 'spawn', 'ptero', 2, 'sky'], [26, 'spawn', 'brute', 1, 'behind']]
  },
  {
    id: 'alpha', dur: 50, minDur: 28, boss: true, speed: 15, cap: 12, min: 5, atk: 2, wind: 1.3, label: null,
    trickle: { raptor: 0.2, compy: 0.2 },
    prog: [[0.5, 'miniboss', 'brute', 'alpha', 'ALPHA RAVAGER', 'Pack leader · howls up Sicklejaws'], [1, 'spawn', 'raptor', 2, 'behind']]
  },
  {
    id: 'zone2', dur: 58, minDur: 38, zone: true, speed: 0, cap: 26, min: 9, atk: 3, wind: 1.3, label: ['COMBAT ZONE', 'Times Square — they\'re everywhere'],
    prog: [
      [1, 'spawn', 'trike', 1, 'behind'], [2, 'spawn', 'compy', 4, 'behind'],
      [9, 'spawn', 'raptor', 3, 'storeL'], [10, 'spawn', 'raptor', 2, 'storeR'],
      [16, 'spawn', 'ankylo', 1, 'behind'], [18, 'drop', 'airstrike'],
      [24, 'ambush', 'right', [['compy', 8], ['raptor', 3]]],
      [30, 'spawn', 'ptero', 2, 'sky'], [31, 'spawn', 'brute', 1, 'behind']
    ]
  },
  {
    id: 'broadway', dur: 32, speed: 15, cap: 14, min: 6, atk: 3, wind: 1.28, label: ['CROSSFIRE', 'Side streets — watch both flanks'],
    trickle: { raptor: 0.3, compy: 0.35 },
    prog: [[3, 'ambush', 'left', [['raptor', 3], ['compy', 3]]], [10, 'spawn', 'raptor', 3, 'storeR'], [15, 'ambush', 'right', [['raptor', 3], ['brute', 1]]], [22, 'spawn', 'ptero', 2, 'sky']]
  },
  {
    id: 'sky2', dur: 34, speed: 16, cap: 14, min: 6, atk: 3, wind: 1.25, label: ['SKY RAID', 'A whole flock'],
    trickle: { compy: 0.2 },
    prog: [[0.5, 'spawn', 'ptero', 5, 'sky'], [0.5, 'look', 0, 0.2, 7], [6, 'drop', 'repair'], [12, 'spawn', 'ptero', 1, 'sky', { elite: true }]]
  },
  {
    id: 'matriarch', dur: 48, minDur: 28, boss: true, speed: 17, cap: 12, min: 5, atk: 3, wind: 1.25, label: null,
    trickle: { raptor: 0.25, compy: 0.15 },
    prog: [[0.5, 'miniboss', 'trike', null, 'HORNWALL MATRIARCH', 'Charges down the lane · shoot her face to stop her']]
  },
  {
    id: 'stampede', dur: 42, speed: 14, cap: 40, min: 14, atk: 3, wind: 1.2, label: ['STAMPEDE', 'Everything in Midtown is behind you'],
    trickle: { compy: 1.1, raptor: 0.5 }, trickleUntil: 26, minUntil: 26,
    prog: [
      [2, 'spawn', 'compy', 12, 'behind'], [3, 'spawn', 'raptor', 5, 'behind'], [5, 'ambush', 'left', [['compy', 8], ['raptor', 3]]],
      [9, 'spawn', 'brute', 1, 'behind'], [12, 'ambush', 'right', [['compy', 8], ['raptor', 3]]], [16, 'drop', 'overdrive'], [20, 'spawn', 'trike', 1, 'behind']
    ]
  },
  {
    id: 'calm', dur: 16, speed: 12, cap: 6, min: 0, atk: 1, wind: 1.3, label: ['…QUIET', 'Too quiet'],
    prog: [[2, 'drop', 'repair'], [6, 'warning']]
  }
];

const BOSS_BEAT = BEATS.length; // index of the boss "beat"
const ENDLESS_LOOP = ['chase1', 'zone1', 'broadway', 'sky2', 'zone2', 'stampede', 'alpha', 'matriarch'];
// Nominal length of a beat (zones and mini-boss beats usually end early) and the nominal boss time (≈6:20)
const nominal = (b) => (b.zone ? b.dur * 0.85 : b.boss ? b.dur * 0.8 : b.dur);
const BOSS_TIME = Math.round(BEATS.reduce((a, b) => a + nominal(b), 0));

class Director {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset(startTime = 0) {
    this.time = 0;
    this.beatIdx = 0;
    this.beatT = 0;
    this.progIdx = 0;
    this.acc = {};
    this.bossActive = false;
    this.bossDone = false;
    this.endless = false;
    this.endlessT = 0;
    this.endlessIdx = 0;
    this.waveNumber = 1;
    this.lastRepair = -99;
    this.zoneClear = false;
    this.miniboss = null;
    this.speedOverride = null;
    // Jump ahead (debug / clip params): skip whole beats
    if (startTime > 0) {
      let t = 0;
      let i = 0;
      while (i < BEATS.length && t + nominal(BEATS[i]) <= startTime) { t += nominal(BEATS[i]); i++; }
      this.beatIdx = i;
      this.time = startTime;
      this.beatT = Math.max(0, startTime - t);
      if (this.beatIdx < BEATS.length) this.progIdx = this._beat().prog.findIndex((p) => p[0] >= this.beatT);
      if (this.progIdx < 0) this.progIdx = this._beat()?.prog.length ?? 0;
    }
    this._entered = false;
  }

  get bossTime() {
    return BOSS_TIME;
  }

  _beat() {
    if (this.endless) return BEATS.find((b) => b.id === ENDLESS_LOOP[this.endlessIdx % ENDLESS_LOOP.length]);
    return BEATS[this.beatIdx] || null;
  }

  get beat() {
    return this._beat();
  }

  /** Stage label for the HUD */
  get stageName() {
    if (this.bossActive) return 'APEX SPECIMEN';
    if (this.bossDone && !this.endless) return 'APEX DOWN';
    const b = this._beat();
    if (!b) return '';
    if (b.zone) return 'COMBAT ZONE';
    if (b.boss) return 'MINI-BOSS';
    return b.label ? b.label[0] : '';
  }

  /** Cruise speed of the cab along the route (m/s) */
  cruise() {
    if (this.speedOverride !== null) return this.speedOverride;
    if (this.bossActive) return 15;
    if (this.bossDone && !this.endless) return 10;
    const b = this._beat();
    if (!b) return 12;
    if (b.zone && this.zoneClear) return 14;
    return b.speed;
  }

  update(dt) {
    const g = this.game;
    this.time += dt;
    if (this.endless) this.endlessT += dt;
    const en = g.enemies;
    const t = this.time + (this.endless ? this.endlessT : 0);
    // Difficulty creep (HP and damage), on top of each beat's attack rules
    en.hpMult = 1 + t / 520 + (this.endless ? this.endlessT / 240 : 0);
    en.dmgMult = 1 + t / 700 + (this.endless ? this.endlessT / 400 : 0);
    en.speedMult = 1 + Math.min(0.2, t / 2000);

    if (this.bossActive || (this.bossDone && !this.endless)) {
      en.maxAttackers = 2;
      en.windMult = 1.05;
      this._mercy();
      return;
    }
    if (!this.endless && this.beatIdx >= BEATS.length) {
      // The boss
      this.bossActive = true;
      g.startBoss();
      return;
    }
    const b = this._beat();
    if (!this._entered) this._enter(b);
    this.beatT += dt;
    en.maxAttackers = b.atk + (this.endless ? 1 : 0);
    en.windMult = b.wind / 1.55 * (this.endless ? 0.9 : 1) * (g.assist ? 1.25 : 1);

    // Scripted program
    while (this.progIdx < b.prog.length && b.prog[this.progIdx][0] <= this.beatT) {
      this._run(b.prog[this.progIdx]);
      this.progIdx++;
    }
    // Trickle spawns (kept under the beat's cap)
    if (b.trickle && (!b.trickleUntil || this.beatT < b.trickleUntil)) {
      for (const type in b.trickle) {
        this.acc[type] = (this.acc[type] || 0) + b.trickle[type] * dt * (this.endless ? 1.3 : 1);
        while (this.acc[type] >= 1) {
          this.acc[type] -= 1;
          if (en.threatCount < b.cap) this.spawnGroup(type, type === 'compy' ? 2 : 1, Math.random() < 0.8 ? 'behind' : Math.random() < 0.5 ? 'left' : 'right');
        }
      }
    }
    // Minimum pressure: keep at least `min` pursuers in play (zones stop topping up once their script is done)
    const scriptRunning = this.progIdx < b.prog.length;
    if (b.min && (!b.zone || scriptRunning) && (!b.minUntil || this.beatT < b.minUntil) && this.beatT > 1.5) {
      this.minT = (this.minT || 0) - dt;
      if (this.minT <= 0 && en.threatCount < b.min) {
        this.minT = 1.1;
        const r = Math.random();
        const type = r < 0.55 ? 'compy' : r < 0.92 || this.time < 60 ? 'raptor' : 'brute';
        this.spawnGroup(type, type === 'compy' ? 2 : 1, Math.random() < 0.75 ? 'behind' : Math.random() < 0.5 ? 'left' : 'right');
      }
    }
    this._mercy();

    // End of the beat
    const scriptDone = this.progIdx >= b.prog.length;
    let done = this.beatT >= b.dur;
    if (b.zone && !this.zoneClear && this.beatT >= b.minDur && scriptDone && en.threatCount === 0) {
      this.zoneClear = true;
      this.zoneClearT = this.beatT;
      g.onZoneClear(this.beatT);
    }
    if (b.zone && this.zoneClear && this.beatT - this.zoneClearT > 2.5) done = true;
    if (b.boss && this.beatT >= b.minDur && this.miniboss && (!this.miniboss.alive || this.miniboss.hp <= 0) && en.threatCount <= 2) done = true;
    if (done) this._next();
  }

  _enter(b) {
    const g = this.game;
    this._entered = true;
    this.zoneClear = false;
    this.miniboss = null;
    this.acc = {};
    if (b.label) g.hud.banner(b.label[0], b.label[1], b.zone ? 'miniboss' : 'wave');
    if (b.zone) g.onZoneEnter(b);
  }

  _next() {
    const b = this._beat();
    if (b?.zone && !this.zoneClear) this.game.onZoneTimeout?.();
    this.beatT = 0;
    this.progIdx = 0;
    this._entered = false;
    this.waveNumber++;
    if (this.endless) this.endlessIdx++;
    else this.beatIdx++;
  }

  _mercy() {
    // A repair drop when the hull runs low (not more than one every 18 s)
    const g = this.game;
    const p = g.player;
    if (p.alive && p.hp / p.maxHp < 0.4 && this.time - this.lastRepair > 18 && g.state === 'playing') {
      this.lastRepair = this.time;
      g.pickups.spawnFloating('repair', -13);
      g.hud.prompt('SHOOT THE REPAIR DROP!', 'good');
    }
  }

  _run(step) {
    const g = this.game;
    const [, op] = step;
    switch (op) {
      case 'spawn': {
        const [, , type, n, where, opts] = step;
        if (type === 'ptero') {
          for (let k = 0; k < n; k++) this.spawnChaser('ptero', 'sky', opts || {});
          g.audio.play('ptero_cry', { volume: 1 });
          if (!this._pteroIntro) { this._pteroIntro = true; g.hud.callout('PTEROSAURS!', 'danger'); }
        } else this.spawnGroup(type, n, where, opts);
        if (type === 'brute' || type === 'trike' || type === 'ankylo') g.hud.callout(type === 'trike' ? 'HORNWALL!' : type === 'ankylo' ? 'CLUBTAIL!' : 'BRUTE!', 'danger');
        break;
      }
      case 'ambush': {
        const [, , side, groups] = step;
        const sign = side === 'right' ? 1 : -1;
        g.cam.swing(sign * 1.15, 0, 2.6, 6.5);
        g.hud.callout(side === 'right' ? 'AMBUSH — RIGHT!' : 'AMBUSH — LEFT!', 'danger');
        g.audio.play('raptor_screech', { volume: 1 });
        for (const [type, n] of groups) this.spawnGroup(type, n, side, { ambush: true });
        break;
      }
      case 'look': {
        const [, , yaw, pitch, hold] = step;
        g.cam.swing(yaw, pitch, 2, hold);
        break;
      }
      case 'drop':
        g.pickups.spawnFloating(step[2], -14);
        if (step[2] === 'repair') this.lastRepair = this.time;
        g.hud.prompt(step[2] === 'repair' ? 'SHOOT THE REPAIR DROP!' : 'SHOOT THE SUPPLY DROP!', 'good');
        break;
      case 'miniboss': {
        const [, , type, behavior, name, sub] = step;
        const e = this.spawnChaser(type, 'behind', { elite: true, scale: 1.55, hpMult: type === 'trike' ? 7 : 9, name, behavior, dropCrate: true });
        if (e) {
          e.miniboss = true;
          e.slotGap = type === 'trike' ? -26 : -14;
          this.miniboss = e;
          g.hud.banner(name, sub, 'miniboss');
          g.audio.play(type === 'trike' ? 'trike_bellow' : 'brute_growl', { volume: 1.2, pitch: 0.75 });
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
    }
  }

  /** Places n of a species around one anchor */
  spawnGroup(type, n, where = 'behind', opts = {}) {
    let c = 0;
    for (let k = 0; k < n; k++) if (this.spawnChaser(type, where, opts, k)) c++;
    return c;
  }

  /** One pursuer. where: behind | left | right | storeL | storeR | sky */
  spawnChaser(type, where = 'behind', opts = {}, k = 0) {
    const g = this.game;
    const p = g.player;
    const en = g.enemies;
    if (type === 'ptero' || where === 'sky') {
      const r = g.route.sample(p.s - 55 - Math.random() * 20, _s);
      const lat = (Math.random() - 0.5) * 20;
      return en.spawn('ptero', r.x + r.rx * lat, r.z + r.rz * lat, { y: 18 + Math.random() * 6, ...opts });
    }
    if (where === 'behind') {
      for (let tries = 0; tries < 6; tries++) {
        const gap = -(30 + Math.random() * 12 + k * 1.2);
        const r = g.route.sample(p.s + gap, _s);
        const lat = (Math.random() * 2 - 1) * (r.halfWidth - 1.5);
        const x = r.x + r.rx * lat, z = r.z + r.rz * lat;
        if (g.walk.isBlocked(x, z)) continue;
        return en.spawn(type, x, z, { onRoad: true, heading: r.heading, ...opts });
      }
      return null;
    }
    const sign = where === 'right' || where === 'storeR' ? 1 : -1;
    const store = where === 'storeL' || where === 'storeR';
    if (!store) {
      // A cross street beside / behind the cab: both lateral probes open ground
      const a = this._sideStreet(sign);
      if (a) {
        const lat = sign * (a.lat + Math.random() * 10 + k * 1.2);
        const r = g.route.sample(a.s + (Math.random() - 0.5) * 6, _s);
        const x = r.x + r.rx * lat, z = r.z + r.rz * lat;
        if (!g.walk.isBlocked(x, z)) return en.spawn(type, x, z, { heading: Math.atan2(-r.rx * sign, -r.rz * sign), ...opts });
      }
    }
    // Storefront: the first building face beside the road
    for (let tries = 0; tries < 8; tries++) {
      const gap = -(6 + Math.random() * 20);
      const r = g.route.sample(p.s + gap, _s);
      let face = null;
      for (let lat = r.halfWidth + 1; lat < r.halfWidth + 14; lat += 0.75) {
        if (g.walk.isBlocked(r.x + r.rx * lat * sign, r.z + r.rz * lat * sign)) { face = lat - 0.9; break; }
      }
      if (face === null) continue;
      const x = r.x + r.rx * face * sign, z = r.z + r.rz * face * sign;
      if (g.walk.isBlocked(x, z)) continue;
      const e = en.spawn(type, x, z, { heading: Math.atan2(-r.rx * sign, -r.rz * sign), ...opts });
      if (e && store) g.onStorefront(x, z, sign, r);
      return e;
    }
    return this.spawnChaser(type, 'behind', opts, k);
  }

  _sideStreet(sign) {
    const g = this.game;
    const p = g.player;
    for (let s = p.s - 8; s > p.s - 55; s -= 3) {
      const r = g.route.sample(s, _s);
      let ok = true;
      for (const lat of [r.halfWidth + 4, r.halfWidth + 12, r.halfWidth + 20]) {
        if (g.walk.isBlocked(r.x + r.rx * lat * sign, r.z + r.rz * lat * sign)) { ok = false; break; }
      }
      if (ok) return { s, lat: r.halfWidth + 14 };
    }
    return null;
  }

  /** Spawn near a point (boss roar summons) */
  spawnNear(type, x, z, r, opts = {}) {
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.4 + Math.random() * 0.6);
      const sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d;
      if (this.game.walk.isBlocked(sx, sz)) continue;
      return this.game.enemies.spawn(type, sx, sz, opts);
    }
    return null;
  }
}

export { Director, BOSS_TIME, BEATS };
