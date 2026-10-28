import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PropBatch } from './batches.js';
import { overlayFont } from './overlay-font.js';

// js/game/vfx.js
// All transient visual effects: pooled particles (additive HDR glow + lit solids), shockwave rings, beams, ground
// telegraphs, pooled point lights, and the 2D overlay (damage numbers, speed lines, off-screen threat arrows).
// Everything is struct-of-arrays and preallocated: no allocation per effect, hundreds of effects per second.

function attrGeo(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('emissive', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.computeVertexNormals();
  return g;
}

class ParticlePool {
  constructor(geometry, capacity, opts) {
    this.n = capacity;
    this.batch = new PropBatch(geometry, capacity, opts);
    const f = () => new Float32Array(capacity);
    this.x = f(); this.y = f(); this.z = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.max = f();
    this.s0 = f(); this.s1 = f();
    this.r = f(); this.g = f(); this.b = f();
    this.r1 = f(); this.g1 = f(); this.b1 = f();
    this.drag = f(); this.grav = f();
    this.rot = f(); this.spin = f();
    this.stretch = f();
    this.bounce = f();
    this.puff = !!opts.puff; // grow in, shrink out (dust & smoke)
    this.alive = 0;
    this.cursor = 0;
    this.active = new Uint8Array(capacity);
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, opts = null) {
    // Ring buffer: when full, the oldest particle is recycled
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.active[i] = 1;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.r[i] = r; this.g[i] = g; this.b[i] = b;
    this.r1[i] = opts?.r1 ?? r; this.g1[i] = opts?.g1 ?? g; this.b1[i] = opts?.b1 ?? b;
    this.drag[i] = opts?.drag ?? 0;
    this.grav[i] = opts?.grav ?? 0;
    this.rot[i] = Math.random() * 6.28;
    this.spin[i] = opts?.spin ?? 0;
    this.stretch[i] = opts?.stretch ?? 0;
    this.bounce[i] = opts?.bounce ?? 0;
    return i;
  }

  update(dt) {
    const b = this.batch;
    b.begin();
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.active[i] = 0; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= d; this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      if (this.bounce[i] > 0 && this.y[i] < 0.15) {
        this.y[i] = 0.15;
        if (this.vy[i] < 0) this.vy[i] *= -this.bounce[i];
        this.vx[i] *= 0.7; this.vz[i] *= 0.7;
        this.spin[i] *= 0.6;
      }
      this.rot[i] += this.spin[i] * dt;
      const t = 1 - this.life[i] / this.max[i];
      let s = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      if (this.puff) s *= Math.min(1, t / 0.1) * (1 - t * t);
      const cr = this.r[i] + (this.r1[i] - this.r[i]) * t;
      const cg = this.g[i] + (this.g1[i] - this.g[i]) * t;
      const cb = this.b[i] + (this.b1[i] - this.b[i]) * t;
      if (this.stretch[i] > 0) {
        const k = this.stretch[i];
        b.addSegment(this.x[i], this.y[i], this.z[i], this.x[i] - this.vx[i] * k, this.y[i] - this.vy[i] * k, this.z[i] - this.vz[i] * k, s, s, cr, cg, cb, 1);
      } else {
        b.add(this.x[i], this.y[i], this.z[i], this.rot[i], this.rot[i] * 0.7, 0, s, s, s, cr, cg, cb, 1);
      }
    }
    b.end();
  }

  clear() {
    this.active.fill(0);
  }
}

const NUM_MAX = 160;

class VFX {
  constructor(scene, assets) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'GameVFX';
    scene.add(this.group);

    // Additive glow blobs (fire, sparks, muzzle flashes, gene-energy wisps)
    this.glow = new ParticlePool(attrGeo(new THREE.IcosahedronGeometry(0.5, 0)), 2200, { additive: true, name: 'vfx.glow' });
    // Streaks (sparks with motion stretch) share the unit box
    this.streak = new ParticlePool(attrGeo(new THREE.BoxGeometry(1, 1, 1)), 900, { additive: true, name: 'vfx.streak' });
    // Lit solids: fossil shards & debris (stone colored), smoke & dust puffs
    this.shards = new ParticlePool(assets.get('shard').geometry, 1400, { roughness: 0.95, metalness: 0, name: 'vfx.shards' });
    this.smoke = new ParticlePool(attrGeo(new THREE.IcosahedronGeometry(0.5, 1)), 500, { roughness: 1, metalness: 0, name: 'vfx.smoke', puff: true });
    // Shockwave rings (flat, additive)
    const ring = new THREE.RingGeometry(0.82, 1, 40, 1);
    ring.rotateX(-Math.PI / 2);
    this.rings = new ParticlePool(attrGeo(ring), 96, { additive: true, doubleSide: true, name: 'vfx.rings' });
    for (const p of [this.glow, this.streak, this.shards, this.smoke, this.rings]) this.group.add(p.batch.mesh);

    // Immediate-mode ground telegraphs and beams (re-submitted every frame)
    const disc = new THREE.CircleGeometry(1, 40);
    disc.rotateX(-Math.PI / 2);
    const ringT = new THREE.RingGeometry(0.9, 1, 48, 1);
    ringT.rotateX(-Math.PI / 2);
    const lane = new THREE.PlaneGeometry(1, 1);
    lane.rotateX(-Math.PI / 2);
    lane.translate(0, 0, 0.5); // unit lane along +z from its origin
    this.discs = new PropBatch(attrGeo(disc), 96, { additive: true, doubleSide: true, name: 'vfx.discs', renderOrder: 2 });
    this.ringsT = new PropBatch(attrGeo(ringT), 128, { additive: true, doubleSide: true, name: 'vfx.ringsT', renderOrder: 2 });
    this.lanes = new PropBatch(attrGeo(lane), 48, { additive: true, doubleSide: true, name: 'vfx.lanes', renderOrder: 2 });
    this.beams = new PropBatch(attrGeo(new THREE.BoxGeometry(1, 1, 1)), 400, { additive: true, name: 'vfx.beams' });
    for (const b of [this.discs, this.ringsT, this.lanes, this.beams]) this.group.add(b.mesh);
    this.beamList = [];

    // Pooled point lights (fixed count: adding/removing lights would recompile shaders)
    this.lights = [];
    for (let i = 0; i < 10; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 30, 2);
      l.position.set(0, -100, 0);
      this.group.add(l);
      this.lights.push({ light: l, life: 0, max: 1, intensity: 0 });
    }
    this.lightCursor = 0;

    // Damage numbers (drawn on the 2D overlay)
    this.nums = Array.from({ length: NUM_MAX }, () => ({ alive: false, x: 0, y: 0, z: 0, text: '', life: 0, max: 1, kind: 0, vy: 0, size: 1 }));
    this.numCursor = 0;
    this.showNumbers = true;

    this.overlay = document.getElementById('fx-overlay');
    this.ctx = this.overlay ? this.overlay.getContext('2d') : null;
    this._v = new THREE.Vector3();
    this.speedLines = 0;
    this.threats = []; // off-screen arrows: { x, z, color }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Recipes
  // ---------------------------------------------------------------------------------------------------------------
  light(x, y, z, color, intensity, distance, life) {
    const L = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    L.light.position.set(x, y, z);
    L.light.color.setHex(color);
    L.light.distance = distance;
    L.intensity = intensity;
    L.life = life;
    L.max = life;
  }

  /** One brass casing. Uses the shard pool — no extra geometry, and the pool recycles. */
  shell(x, y, z, rx, rz) {
    this.shards.spawn(x, y, z, rx * 4.2, 3.4, rz * 4.2, 0.85, 0.055, 0.03, 0.72, 0.55, 0.22, { grav: 16, spin: 11, bounce: 0.42 });
  }

  muzzle(x, y, z, dx, dy, dz, size = 1, r = 6, g = 3.2, b = 0.8) {
    this.glow.spawn(x, y, z, dx * 4, dy * 4, dz * 4, 0.06, 0.55 * size, 0.2 * size, r, g, b);
    this.glow.spawn(x + dx * 0.4 * size, y + dy * 0.4 * size, z + dz * 0.4 * size, dx * 8, dy * 8, dz * 8, 0.05, 0.4 * size, 0.1 * size, r, g * 0.8, b * 0.5);
  }

  sparks(x, y, z, count, speed, r = 6, g = 3, b = 0.6, life = 0.35) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 0.9 + 0.1;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.streak.spawn(x, y, z, Math.cos(a) * sp * u, sp * (0.3 + Math.random() * 0.8), Math.sin(a) * sp * u,
        life * (0.6 + Math.random() * 0.6), 0.07, 0.02, r, g, b, { grav: 14, drag: 1.5, stretch: 0.035, r1: r * 0.4, g1: g * 0.2, b1: 0 });
    }
  }

  hitSpark(x, y, z, r = 5, g = 3, b = 1) {
    this.glow.spawn(x, y, z, 0, 0.5, 0, 0.08, 0.5, 0.15, r, g, b);
    this.sparks(x, y, z, 3, 7, r, g, b, 0.22);
  }

  explosion(x, y, z, size = 1, color = 0) {
    // color 0 = fire, 1 = cyan plasma, 2 = magenta
    const pal = color === 1 ? [1.2, 5, 6] : color === 2 ? [6, 1, 5] : [8, 3.2, 0.7];
    // Core flash
    this.glow.spawn(x, y + 0.5, z, 0, 0, 0, 0.12, 2.2 * size, 3.4 * size, 14, 12, 9);
    // Fireball blobs
    const nb = Math.round(7 + 5 * size);
    for (let i = 0; i < nb; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.2 * size;
      this.glow.spawn(x + Math.cos(a) * r, y + 0.6 + Math.random() * 1.2 * size, z + Math.sin(a) * r,
        Math.cos(a) * 3 * size, 2 + Math.random() * 3 * size, Math.sin(a) * 3 * size,
        0.35 + Math.random() * 0.3, 1.1 * size, 2.4 * size, pal[0], pal[1], pal[2],
        { r1: 0.5, g1: 0.08, b1: 0.02, drag: 3 });
    }
    this.sparks(x, y + 0.5, z, Math.round(10 + 14 * size), 14 * Math.sqrt(size), pal[0], pal[1] * 0.9, pal[2]);
    // Smoke
    for (let i = 0; i < Math.min(8, 3 + 3 * size); i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(x + Math.cos(a) * size, y + 0.8, z + Math.sin(a) * size, Math.cos(a) * 1.5, 1.6 + Math.random() * 1.5, Math.sin(a) * 1.5,
        1.0 + Math.random() * 0.8, Math.min(2, 0.9 * size), Math.min(3.2, 2.4 * size), 0.07, 0.065, 0.06, { drag: 1.2, r1: 0.04, g1: 0.04, b1: 0.04 });
    }
    // Debris
    for (let i = 0; i < 3 + 3 * size; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 8 * size;
      this.shards.spawn(x, y + 0.5, z, Math.cos(a) * sp, 5 + Math.random() * 8, Math.sin(a) * sp, 1.2 + Math.random(), 0.35 * size, 0.1,
        0.12, 0.1, 0.09, { grav: 22, spin: 9, bounce: 0.35 });
    }
    this.rings.spawn(x, 0.12, z, 0, 0, 0, 0.42, 0.6 * size, 7.5 * size, pal[0] * 0.6, pal[1] * 0.6, pal[2] * 0.6, { r1: 0, g1: 0, b1: 0 });
    this.light(x, y + 1.5, z, color === 1 ? 0x55eeff : color === 2 ? 0xff44dd : 0xff8833, 260 * size, 26 * Math.sqrt(size), 0.35);
  }

  /** A dinosaur turned to stone shattering into fossil shards (the signature, gore-free death) */
  shatter(x, y, z, radius = 1, big = false, glowR = 0.4, glowG = 3, glowB = 3.6) {
    const n = Math.min(40, Math.round(5 + radius * radius * 3.2));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (2.5 + Math.random() * 5) * (0.6 + radius * 0.3);
      const tone = 0.75 + Math.random() * 0.4;
      this.shards.spawn(x + Math.cos(a) * radius * 0.5, y + Math.random() * radius, z + Math.sin(a) * radius * 0.5,
        Math.cos(a) * sp, 3 + Math.random() * 6 * (big ? 1.6 : 1), Math.sin(a) * sp,
        0.9 + Math.random() * 1.1, (0.2 + Math.random() * 0.35) * Math.min(3, 0.6 + radius * 0.5), 0.05,
        0.26 * tone, 0.245 * tone, 0.22 * tone, { grav: 20, spin: 10, bounce: 0.4 });
    }
    const nd = radius < 1 ? (Math.random() < 0.5 ? 1 : 0) : Math.min(6, 1 + Math.round(radius * 1.5));
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(x + Math.cos(a) * radius * 0.6, y + 0.4, z + Math.sin(a) * radius * 0.6, Math.cos(a) * 2, 0.8 + Math.random(), Math.sin(a) * 2,
        0.6 + Math.random() * 0.5, 0.5 * radius, 1.3 * radius, 0.24, 0.22, 0.2, { drag: 2.5, r1: 0.14, g1: 0.13, b1: 0.12 });
    }
    // Escaping gene energy
    for (let i = 0; i < 3 + radius * 2; i++) {
      this.glow.spawn(x + (Math.random() - 0.5) * radius, y + Math.random() * radius, z + (Math.random() - 0.5) * radius,
        (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.4, 0.3, 0.05, glowR, glowG, glowB, { drag: 1 });
    }
    if (big) {
      this.rings.spawn(x, 0.12, z, 0, 0, 0, 0.6, radius, radius * 5, 2, 1.8, 1.5, { r1: 0, g1: 0, b1: 0 });
    }
  }

  /** Puff of dust at the feet (stomps, landings, skids) */
  dust(x, z, size = 1, count = 4) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(x + Math.cos(a) * size * 0.5, 0.3, z + Math.sin(a) * size * 0.5, Math.cos(a) * 3 * size, 0.6 + Math.random(), Math.sin(a) * 3 * size,
        0.5 + Math.random() * 0.4, 0.5 * size, 1.3 * size, 0.22, 0.2, 0.18, { drag: 3, r1: 0.12, g1: 0.11, b1: 0.1 });
    }
  }

  shockwave(x, z, radius, r = 3, g = 2, b = 1.2, life = 0.5) {
    this.rings.spawn(x, 0.15, z, 0, 0, 0, life, radius * 0.1, radius, r, g, b, { r1: 0, g1: 0, b1: 0 });
  }

  beam(x0, y0, z0, x1, y1, z1, width, r, g, b, life = 0.1) {
    this.beamList.push({ x0, y0, z0, x1, y1, z1, width, r, g, b, life, max: life });
  }

  /** Jagged lightning between two points */
  lightning(x0, y0, z0, x1, y1, z1, r = 1.5, g = 4, b = 6, life = 0.12, width = 0.09) {
    const segs = 6;
    let px = x0, py = y0, pz = z0;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const j = i === segs ? 0 : 0.9;
      const nx = x0 + (x1 - x0) * t + (Math.random() - 0.5) * j;
      const ny = y0 + (y1 - y0) * t + (Math.random() - 0.5) * j;
      const nz = z0 + (z1 - z0) * t + (Math.random() - 0.5) * j;
      this.beam(px, py, pz, nx, ny, nz, width, r, g, b, life);
      px = nx; py = ny; pz = nz;
    }
    this.glow.spawn(x1, y1, z1, 0, 0, 0, life, 0.8, 0.3, r, g, b);
  }

  // Immediate-mode telegraphs: call every frame while the threat is pending
  telegraphCircle(x, z, radius, progress, r = 5, g = 0.4, b = 0.3) {
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.02);
    this.ringsT.add(x, 0.14, z, 0, 0, 0, radius, 1, radius, r, g, b, 0.45 * pulse + 0.2);
    this.discs.add(x, 0.12, z, 0, 0, 0, radius * Math.min(1, progress), 1, radius * Math.min(1, progress), r, g, b, 0.045);
  }

  telegraphLane(x, z, heading, length, width, progress, r = 5, g = 0.4, b = 0.3) {
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.025);
    this.lanes.add(x, 0.13, z, heading, 0, 0, width, 1, length, r, g, b, 0.12 + 0.12 * pulse);
    this.lanes.add(x, 0.135, z, heading, 0, 0, width, 1, length * Math.min(1, progress), r, g, b, 0.22);
  }

  ring(x, z, radius, r, g, b, a) {
    this.ringsT.add(x, 0.14, z, 0, 0, 0, radius, 1, radius, r, g, b, a);
  }

  number(x, y, z, value, kind = 0) {
    if (!this.showNumbers) return;
    const n = this.nums[this.numCursor];
    this.numCursor = (this.numCursor + 1) % NUM_MAX;
    n.alive = true;
    n.x = x + (Math.random() - 0.5) * 0.8;
    n.y = y;
    n.z = z + (Math.random() - 0.5) * 0.8;
    n.text = typeof value === 'number' ? String(Math.round(value)) : value;
    n.kind = kind; // 0 normal, 1 crit, 2 player damage, 3 heal / xp, 4 big text
    n.life = n.max = kind === 4 ? 1.4 : kind === 1 ? 0.85 : 0.65;
    n.vy = kind === 4 ? 1.4 : 2.6;
    n.size = kind === 1 ? 1.35 : kind === 4 ? 1.7 : 1;
  }

  // ---------------------------------------------------------------------------------------------------------------
  update(dt) {
    this.glow.update(dt);
    this.streak.update(dt);
    this.shards.update(dt);
    this.smoke.update(dt);
    this.rings.update(dt);
    // Beams fade
    this.beams.begin();
    let w = 0;
    for (const bm of this.beamList) {
      bm.life -= dt;
      if (bm.life <= 0) continue;
      const a = bm.life / bm.max;
      this.beams.addSegment(bm.x0, bm.y0, bm.z0, bm.x1, bm.y1, bm.z1, bm.width * (0.5 + a * 0.5), bm.width * (0.5 + a * 0.5), bm.r, bm.g, bm.b, a);
      this.beamList[w++] = bm;
    }
    this.beamList.length = w;
    this.beams.end();
    for (const L of this.lights) {
      if (L.life > 0) {
        L.life -= dt;
        const t = Math.max(0, L.life / L.max);
        L.light.intensity = L.intensity * t * t;
        if (L.life <= 0) { L.light.intensity = 0; L.light.position.y = -100; }
      }
    }
    for (const n of this.nums) {
      if (!n.alive) continue;
      n.life -= dt;
      if (n.life <= 0) { n.alive = false; continue; }
      n.y += n.vy * dt;
      n.vy *= 1 - 2.5 * dt;
    }
  }

  /** Telegraph batches are immediate-mode: call before game logic submits this frame's telegraphs */
  beginTelegraphs() {
    this.discs.begin();
    this.ringsT.begin();
    this.lanes.begin();
  }

  endTelegraphs() {
    this.discs.end();
    this.ringsT.end();
    this.lanes.end();
  }

  clear() {
    for (const p of [this.glow, this.streak, this.shards, this.smoke, this.rings]) p.clear();
    this.beamList.length = 0;
    for (const n of this.nums) n.alive = false;
    for (const L of this.lights) { L.life = 0; L.light.intensity = 0; }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // 2D overlay: damage numbers, speed lines, off-screen threat arrows
  // ---------------------------------------------------------------------------------------------------------------
  resizeOverlay() {
    if (!this.overlay) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(window.innerWidth * dpr);
    this.overlay.height = Math.round(window.innerHeight * dpr);
    this.overlayScale = dpr;
  }

  drawOverlay(camera, dangers = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    // save/restore around the danger rings puts the canvas font back; don't reuse a cached string across that
    this._font = null;
    if (!this.overlayScale || this.overlay.width !== Math.round(window.innerWidth * this.overlayScale)) this.resizeOverlay();
    const W = this.overlay.width, H = this.overlay.height;
    const k = this.overlayScale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Speed lines while boosting
    if (this.speedLines > 0.02) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.speedLines) * 0.5;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * k;
      const cx = W / 2, cy = H * 0.45;
      const t = performance.now() * 0.001;
      for (let i = 0; i < 40; i++) {
        const a = i * 2.39996 + Math.floor(t * 12 + i) * 0.7;
        const r0 = Math.hypot(W, H) * (0.36 + ((i * 0.137 + t * 2.5) % 1) * 0.3);
        const r1 = r0 + 60 * k + 120 * k * this.speedLines;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.7);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Damage numbers
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const v = this._v;
    for (const n of this.nums) {
      if (!n.alive) continue;
      v.set(n.x, n.y, n.z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * W;
      const sy = (-v.y * 0.5 + 0.5) * H;
      const t = 1 - n.life / n.max;
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.7 : 1.3 - Math.min(0.3, (t - 0.12) * 1.2);
      const alpha = n.life < 0.2 ? n.life / 0.2 : 1;
      ctx.globalAlpha = alpha;
      const font = overlayFont(k, n.size, pop, n.kind === 4 ? 900 : 800);
      if (this._font !== font) { this._font = font; ctx.font = font; }
      ctx.lineWidth = 4 * k;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(n.text, sx, sy);
      ctx.fillStyle = n.kind === 1 ? '#ffd23a' : n.kind === 2 ? '#ff4040' : n.kind === 3 ? '#4dffa0' : n.kind === 4 ? '#2cf6ff' : '#ffffff';
      ctx.fillText(n.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    // Danger rings: a red ring around every dinosaur winding up an attack, shrinking onto it as the attack comes
    // (shoot it before the ring closes to stagger it). The boss ring carries a stagger meter; wrecks get a target.
    if (dangers) {
      const now = performance.now();
      const fy = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      for (const d of dangers) {
        v.set(d.x, d.y, d.z);
        const dist = v.distanceTo(camera.position);
        v.project(camera);
        if (v.z > 1 || v.z < -1) continue;
        const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
        const base = Math.max(18 * k, (d.r / Math.max(1, dist * fy)) * H * 0.5);
        const kk = Math.min(1, d.k);
        const rad = base * (1 + (1 - kk) * 1.6);
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.03);
        ctx.save();
        ctx.translate(sx, sy);
        if (d.wreck) {
          ctx.strokeStyle = `rgba(255, 150, 40, ${0.6 + 0.4 * pulse})`;
          ctx.lineWidth = 3 * k;
          ctx.setLineDash([10 * k, 6 * k]);
          ctx.rotate(now * 0.004);
          ctx.beginPath(); ctx.arc(0, 0, base * 1.3, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          continue;
        }
        // A wider dim stroke stands in for shadowBlur. Safari keeps a full shadow raster for every
        // blurred draw and gets slower until the tab is hidden.
        ctx.lineWidth = (10 + kk * 6) * k;
        ctx.strokeStyle = `rgba(255, 32, 16, ${0.22 + 0.1 * pulse})`;
        ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = (3 + kk * 3) * k;
        ctx.strokeStyle = `rgba(255, ${Math.round(60 - kk * 50)}, 30, ${0.55 + 0.45 * pulse})`;
        ctx.stroke();
        // corner ticks
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * rad * 1.08, Math.sin(a) * rad * 1.08);
          ctx.lineTo(Math.cos(a) * (rad * 1.08 + 10 * k), Math.sin(a) * (rad * 1.08 + 10 * k));
          ctx.stroke();
        }
        if (d.boss && d.meter !== undefined) {
          ctx.strokeStyle = 'rgba(255, 176, 46, 0.35)';
          ctx.lineWidth = 12 * k;
          ctx.beginPath(); ctx.arc(0, 0, rad + 12 * k, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * d.meter); ctx.stroke();
          ctx.strokeStyle = '#ffd23a';
          ctx.lineWidth = 6 * k;
          ctx.stroke();
        }
        ctx.font = `900 ${Math.round(22 * k)}px 'Bebas Neue', Impact, sans-serif`;
        ctx.fillStyle = '#ff3b2f';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4 * k;
        ctx.strokeText('!', 0, -rad - 14 * k);
        ctx.fillText('!', 0, -rad - 14 * k);
        ctx.restore();
      }
    }
    // Off-screen threat arrows (e.g. a charging triceratops behind, the boss)
    for (const th of this.threats) {
      v.set(th.x, 1.5, th.z).project(camera);
      const behind = v.z > 1;
      let sx = v.x, sy = -v.y;
      if (behind) { sx = -sx; sy = -sy; }
      if (!behind && Math.abs(sx) < 0.92 && Math.abs(sy) < 0.88) continue;
      const m = Math.max(Math.abs(sx) / 0.92, Math.abs(sy) / 0.82, 1e-3);
      sx /= m; sy /= m;
      const px = (sx * 0.5 + 0.5) * W, py = (sy * 0.5 + 0.5) * H;
      const ang = Math.atan2(sy, sx);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() * 0.015);
      ctx.fillStyle = th.color || '#ff3b3b';
      ctx.beginPath();
      ctx.moveTo(16 * k, 0);
      ctx.lineTo(-10 * k, -12 * k);
      ctx.lineTo(-5 * k, 0);
      ctx.lineTo(-10 * k, 12 * k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

export { VFX, attrGeo };
