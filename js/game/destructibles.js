import * as THREE from 'three/webgpu';
import { PropBatch } from './batches.js';

// js/game/destructibles.js
// Shootable street dressing along the patrol: cars, hydrants, lamps, newsstands, glass, and the big
// chunks a set piece drops (scaffolding, a billboard, a water tower). Nothing here is the streamed
// city — those meshes stay untouched. A fixed pool, a capped "already broken" set, and the existing
// particle pools, so a long run cannot grow geometries, programs or audio nodes.

const POOL = 24;
const STEP = 12;
const BROKEN_CAP = 220;
const _s = {};

function hash(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

const KINDS = ['car', 'car', 'car', 'hydrant', 'post', 'kiosk', 'glass', 'post'];

class Destructibles {
  constructor(game, assets) {
    this.game = game;
    this.booms = 5;
    this.broken = new Set();
    this.brokenQ = [];
    this.props = Array.from({ length: POOL }, () => ({
      alive: false, key: -1, kind: 'post', x: 0, y: 0, z: 0, yaw: 0,
      sx: 1, sy: 1, sz: 1, cr: 1, cg: 1, cb: 1, hp: 1, radius: 1, fuse: 99,
      launch: 0, vy: 0, baseY: 0, s: 0
    }));
    const lit = (geo, name) => new PropBatch(geo, POOL, { name, roughness: 0.62, metalness: 0.18 });
    this.batches = {
      car: lit(assets.get('wreck').geometry, 'd.car'),
      hydrant: lit(assets.get('hydrant').geometry, 'd.hydrant'),
      post: lit(assets.get('streetPost').geometry, 'd.post'),
      kiosk: lit(assets.get('kiosk').geometry, 'd.kiosk'),
      glass: lit(assets.get('glassPane').geometry, 'd.glass'),
      chunk: lit(assets.get('streetChunk').geometry, 'd.chunk')
    };
    this.group = new THREE.Group();
    this.group.name = 'Destructibles';
    for (const b of Object.values(this.batches)) this.group.add(b.mesh);
    game.world?.scene?.add(this.group);
  }

  reset() {
    for (const p of this.props) { p.alive = false; p.key = -1; p.launch = 0; p.fuse = 99; }
    this.blockedClear();
    this.booms = 5;
    this._draw();
  }

  blockedClear() {
    this.broken.clear();
    this.brokenQ.length = 0;
  }

  _remember(key) {
    if (key < 0 || this.broken.has(key)) return;
    this.broken.add(key);
    this.brokenQ.push(key);
    if (this.brokenQ.length > BROKEN_CAP) this.broken.delete(this.brokenQ.shift());
  }

  _alloc() {
    for (const p of this.props) if (!p.alive) return p;
    let far = null;
    let farD = -1;
    const g = this.game;
    for (const p of this.props) {
      if (!p.alive || p.kind === 'chunk') continue;
      const d = Math.abs(g.route.delta(g.player.s, p.s));
      if (d > farD) { farD = d; far = p; }
    }
    if (far) { far.alive = false; far.key = -1; return far; }
    return null;
  }

  _place(p, s, lat, kind) {
    const g = this.game;
    const r = g.route.sample(s, _s);
    let L = lat;
    let x = r.x + r.rx * L;
    let z = r.z + r.rz * L;
    if (g.walk.isBlocked(x, z)) {
      L = Math.sign(L || 1) * Math.max(1.4, r.halfWidth - 1.1);
      x = r.x + r.rx * L;
      z = r.z + r.rz * L;
      if (g.walk.isBlocked(x, z)) return false;
    }
    p.alive = true;
    p.kind = kind;
    p.x = x; p.z = z; p.s = r.s;
    p.yaw = r.heading;
    p.launch = 0; p.vy = 0; p.fuse = 99;
    p.cr = 1; p.cg = 1; p.cb = 1;
    if (kind === 'car') {
      const tint = hash(p.key + 3) % 5;
      const pal = [[1.4, 0.85, 0.05], [0.9, 0.12, 0.1], [0.15, 0.22, 0.55], [0.85, 0.85, 0.82], [0.2, 0.22, 0.2]];
      [p.cr, p.cg, p.cb] = pal[tint];
      p.y = 0.85; p.baseY = 0.85;
      p.sx = 1; p.sy = 1; p.sz = 1;
      p.hp = 34; p.radius = 2.1;
    } else if (kind === 'hydrant') {
      p.y = 0; p.baseY = 0; p.sx = p.sy = p.sz = 1;
      p.hp = 16; p.radius = 0.7;
      p.cr = 1.3; p.cg = 0.15; p.cb = 0.1;
    } else if (kind === 'post') {
      p.y = 0; p.baseY = 0; p.sx = p.sy = p.sz = 1;
      p.hp = 18; p.radius = 0.6;
    } else if (kind === 'kiosk') {
      p.y = 0; p.baseY = 0;
      p.sx = 1; p.sy = hash(p.key) % 3 === 0 ? 0.4 : 1; p.sz = 1;
      p.hp = 20; p.radius = 1.3;
    } else if (kind === 'glass') {
      p.y = 1.5; p.baseY = 1.5;
      p.sx = 1; p.sy = 1; p.sz = 1;
      p.hp = 1; p.radius = 1.2;
      p.cr = 0.7; p.cg = 0.85; p.cb = 1;
    } else {
      p.y = 0; p.baseY = 0;
      p.sx = 1.3; p.sy = 1.6; p.sz = 1.1;
      p.hp = 80; p.radius = 2.4;
    }
    return true;
  }

  _fill() {
    const g = this.game;
    const p = g.player;
    const route = g.route;
    const origin = Math.floor(route.wrap(p.s - 84) / STEP) * STEP;
    for (let i = 0; i < 8; i++) {
      const s = route.wrap(origin + i * STEP);
      const ahead = route.delta(p.s, s);
      if (ahead > -4 || ahead < -96) continue;
      const key = Math.floor(s / STEP);
      if (this.broken.has(key)) continue;
      let taken = false;
      for (const prop of this.props) if (prop.alive && prop.key === key) { taken = true; break; }
      if (taken) continue;
      const prop = this._alloc();
      if (!prop) return;
      prop.key = key;
      const h = hash(key);
      const kind = KINDS[h % KINDS.length];
      const sign = h & 1 ? 1 : -1;
      const r = route.sample(s, _s);
      const lat = kind === 'car'
        ? sign * (r.halfWidth * 0.62)
        : sign * (r.halfWidth + 1.6 + (h % 3) * 0.4);
      if (!this._place(prop, s, lat, kind)) { prop.alive = false; prop.key = -1; }
    }
    for (const prop of this.props) {
      if (!prop.alive || prop.kind === 'chunk' || prop.fuse < 90 || prop.launch) continue;
      const d = route.delta(p.s, prop.s);
      if (d > 18 || d < -120) { prop.alive = false; prop.key = -1; }
    }
  }

  update(dt) {
    if (this.game.state === 'playing' || this.game.state === 'intro') {
      this.booms = Math.min(5, this.booms + dt * 2.5);
      this._fill();
    }
    for (const p of this.props) {
      if (!p.alive) continue;
      if (p.launch) {
        p.vy -= 18 * dt;
        p.y += p.vy * dt;
        p.yaw += dt * 2.4;
        if (p.y <= p.baseY) { p.y = p.baseY; p.launch = 0; this.break(p); continue; }
      } else if (p.fuse < 90) {
        p.fuse -= dt;
        if (p.fuse <= 0) this.break(p);
      }
    }
    this._draw();
  }

  _draw() {
    for (const b of Object.values(this.batches)) b.begin();
    for (const p of this.props) {
      if (!p.alive) continue;
      const b = this.batches[p.kind] || this.batches.chunk;
      b.add(p.x, p.y, p.z, p.yaw, 0, 0, p.sx, p.sy, p.sz, p.cr, p.cg, p.cb, 1);
    }
    for (const b of Object.values(this.batches)) b.end();
  }

  /** First alive prop the ray meets, within maxT. */
  raycast(ray, maxT) {
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    const dx = ray.direction.x, dy = ray.direction.y, dz = ray.direction.z;
    let best = null;
    let bestT = maxT;
    for (const p of this.props) {
      if (!p.alive) continue;
      const cy = p.y + (p.kind === 'car' ? 0.2 : p.kind === 'post' ? 2 : p.kind === 'chunk' ? 2.5 : 0.8);
      const lx = p.x - ox, ly = cy - oy, lz = p.z - oz;
      const t = lx * dx + ly * dy + lz * dz;
      if (t < 0.4 || t > bestT) continue;
      const qx = ox + dx * t - p.x, qy = oy + dy * t - cy, qz = oz + dz * t - p.z;
      if (qx * qx + qy * qy + qz * qz > (p.radius + 0.35) * (p.radius + 0.35)) continue;
      bestT = t;
      best = p;
    }
    return best ? { t: bestT, p: best } : null;
  }

  /** Bullet damage. Glass pops and does not stop the round. */
  hit(p, dmg) {
    if (!p?.alive) return false;
    if (p.kind === 'glass') { this.break(p); return false; }
    p.hp -= dmg;
    this.game.vfx.hitSpark(p.x, p.y + 0.6, p.z, 6, 3.2, 1);
    if (p.hp <= 0) this.break(p);
    return true;
  }

  /** Area damage from an explosion. Cars catch a fuse instead of popping in the same call. */
  shock(x, z, radius) {
    let lit = 0;
    for (const p of this.props) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > radius + p.radius) continue;
      if (p.kind === 'car') {
        if (lit < 3) { this.ignite(p, 0.08 + d * 0.035); lit++; }
      } else {
        p.hp -= 28;
        if (p.hp <= 0) this.break(p);
      }
    }
  }

  ignite(p, delay) {
    if (!p?.alive || p.kind !== 'car') return;
    if (p.fuse < delay) return;
    p.fuse = delay;
  }

  break(p) {
    if (!p?.alive) return;
    p.alive = false;
    p.launch = 0;
    const key = p.key;
    p.key = -1;
    if (key >= 0) this._remember(key);
    const g = this.game;
    const v = g.vfx;
    const n = p.kind === 'chunk' ? 10 : p.kind === 'car' ? 7 : p.kind === 'glass' ? 8 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = 3 + (i % 3) * 1.4;
      if (p.kind === 'glass') {
        v.streak.spawn(p.x, p.y, p.z, Math.cos(a) * sp, 2 + (i % 4), Math.sin(a) * sp,
          0.55, 0.08, 0.02, 2.2, 2.8, 3.2, { grav: 14, drag: 0.6, stretch: 0.02, bounce: 0.25 });
      } else {
        v.shards.spawn(p.x, p.y + 0.4, p.z, Math.cos(a) * sp, 3 + (i % 3), Math.sin(a) * sp,
          0.9, p.kind === 'chunk' ? 0.45 : 0.22, 0.08, 0.35, 0.32, 0.28, { grav: 18, spin: 8, bounce: 0.3 });
      }
    }
    v.sparks(p.x, p.y + 0.5, p.z, p.kind === 'glass' ? 2 : 5, 8, 6, 3, 0.6, 0.25);
    if (p.kind === 'car') {
      if (this.booms > 0) {
        this.booms--;
        g.weapons.blast(p.x, p.z, 6.2, 24, 0, 'car', true);
        g.hitStop(0.03);
        g.cam.fovKick -= 1.5;
      } else {
        v.explosion(p.x, 0.5, p.z, 0.7, 0);
        g.audio.play('explosion', { x: p.x, z: p.z, volume: 0.4 });
      }
    } else if (p.kind === 'chunk') {
      v.explosion(p.x, 1.6, p.z, 1.7, 0);
      v.dust(p.x, p.z, 2.4, 8);
      g.audio.play('explosion_big', { x: p.x, z: p.z, volume: 0.75 });
      g.cam.addTrauma(0.42);
      g.slowmo(0.5, 0.55);
    } else if (p.kind === 'glass') {
      g.audio.play('glass', { x: p.x, z: p.z, volume: 0.65 });
    } else {
      v.dust(p.x, p.z, 0.8, 3);
      g.audio.play('shatter_big', { x: p.x, z: p.z, volume: 0.32, pitch: 1.35 });
    }
  }

  /** Scripted: every car in view catches in sequence. */
  chain() {
    const cars = [];
    for (const p of this.props) if (p.alive && p.kind === 'car') cars.push(p);
    const s = this.game.player.s;
    const route = this.game.route;
    cars.sort((a, b) => Math.abs(route.delta(s, a.s)) - Math.abs(route.delta(s, b.s)));
    const n = Math.min(5, cars.length);
    for (let i = 0; i < n; i++) this.ignite(cars[i], 0.06 + i * 0.16);
    if (!n) this.game.vfx.dust(this.game.player.x, this.game.player.z, 1, 3);
  }

  /** A pterosaur yanks the nearest car off the asphalt. */
  snatch() {
    const route = this.game.route;
    const s = this.game.player.s;
    let best = null;
    let bestD = 1e9;
    for (const p of this.props) {
      if (!p.alive || p.kind !== 'car' || p.launch) continue;
      const d = Math.abs(route.delta(s, p.s));
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return;
    best.launch = 1;
    best.vy = 16;
    best.fuse = 99;
    this.game.audio.play('ptero_cry', { x: best.x, z: best.z, volume: 1 });
  }

  /** Subway grate under the lane behind the cab. */
  grate() {
    const g = this.game;
    const r = g.route.sample(g.player.s - 12, _s);
    g.vfx.dust(r.x, r.z, 2.2, 8);
    g.vfx.explosion(r.x, 0.15, r.z, 0.65, 0);
    g.vfx.rings.spawn(r.x, 0.1, r.z, 0, 0, 0, 0.45, 0.4, 7, 4, 2, 0.4, { r1: 0.2, g1: 0.05, b1: 0 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.vfx.shards.spawn(r.x, 0.2, r.z, Math.cos(a) * 5, 6 + (i % 3), Math.sin(a) * 5,
        0.8, 0.28, 0.08, 0.28, 0.26, 0.24, { grav: 20, spin: 9, bounce: 0.28 });
    }
    g.audio.play('stomp', { x: r.x, z: r.z, volume: 0.95, pitch: 0.8 });
  }

  /** Storefront: the existing glass burst, plus two panes that shatter a beat later. */
  burst(side) {
    const g = this.game;
    const sign = side === 'storeR' || side === 'right' ? 1 : -1;
    const r = g.route.sample(g.player.s - 14, _s);
    let face = r.halfWidth + 2;
    for (let lat = r.halfWidth + 1; lat < r.halfWidth + 16; lat += 0.8) {
      if (g.walk.isBlocked(r.x + r.rx * lat * sign, r.z + r.rz * lat * sign)) { face = lat - 0.7; break; }
    }
    const x = r.x + r.rx * face * sign;
    const z = r.z + r.rz * face * sign;
    g.onStorefront(x, z, sign, r);
    for (let i = 0; i < 2; i++) {
      const p = this._alloc();
      if (!p) break;
      p.key = -1;
      p.kind = 'glass';
      p.alive = true;
      p.x = x + r.hx * (i - 0.5) * 2.2;
      p.z = z + r.hz * (i - 0.5) * 2.2;
      p.y = 1.6; p.baseY = 1.6;
      p.yaw = r.heading;
      p.sx = 1.1; p.sy = 1.15; p.sz = 1;
      p.hp = 1; p.radius = 1.2;
      p.cr = 0.75; p.cg = 0.9; p.cb = 1;
      p.launch = 0; p.vy = 0;
      p.fuse = 0.08 + i * 0.12;
      p.s = r.s;
    }
  }

  /** Scaffolding / billboard / tank coming down beside the lane. */
  collapse() {
    const g = this.game;
    const r = g.route.sample(g.player.s - 18, _s);
    g.vfx.dust(r.x, r.z, 2, 6);
    g.audio.play('stomp', { x: r.x, z: r.z, volume: 1, pitch: 0.7 });
    for (let i = 0; i < 2; i++) {
      const p = this._alloc();
      if (!p) return;
      const sign = i === 0 ? 1 : -1;
      p.key = -1;
      p.kind = 'chunk';
      p.alive = true;
      p.s = r.s;
      p.x = r.x + r.rx * sign * (r.halfWidth + 1.2);
      p.z = r.z + r.rz * sign * (r.halfWidth + 1.2);
      p.y = 0; p.baseY = 0;
      p.yaw = r.heading + i;
      p.sx = 1.15; p.sy = 1.3 + i * 0.55; p.sz = 1;
      p.hp = 90; p.radius = 2.6;
      p.cr = 1; p.cg = 1; p.cb = 1;
      p.launch = 0; p.vy = 0;
      p.fuse = 0.18 + i * 0.32;
    }
  }
}

export { Destructibles };
