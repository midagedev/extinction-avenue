import { BLOCKS } from '../city-config.js';

// js/game/route.js
// The patrol loop the armored cab follows through Midtown, and a walkability grid for the dinosaurs.
//
// The car runs "on rails" along a closed loop of real Manhattan streets (5th Ave south past the Empire State Building,
// west on 34th St, north up 7th Ave through Times Square, east on 57th St) with rounded corners. The player controls
// lateral position within the roadway and throttle; the route supplies position, heading and roadway width.
//
// World frame (see city-config.js): 1 unit = 1 m, x = grid east, z = grid south. Heading h faces (sin h, cos h);
// the right-hand side of travel is (-cos h, sin h).

const LOOP = [
  // [x, z, half roadway width of the leg that STARTS here, leg name]
  [0.4, -1204.3, 7.3, '5th Ave'],
  [0.4, 640.5, 7.9, 'W 34th St'],
  [-584.8, 640.5, 9.15, '7th Ave'],
  [-584.8, -1204.3, 9.15, 'W 57th St']
];
const CORNER_RADIUS = 16;

class Route {
  constructor(points = LOOP, radius = CORNER_RADIUS) {
    // Build a sampled centreline: straight legs joined by circular arcs (1 m steps), closed loop.
    const xs = [];
    const zs = [];
    const hw = [];
    const legOf = [];
    const n = points.length;
    const push = (x, z, w, leg) => { xs.push(x); zs.push(z); hw.push(w); legOf.push(leg); };
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const c = points[(i + 2) % n];
      const dx1 = b[0] - a[0], dz1 = b[1] - a[1];
      const L1 = Math.hypot(dx1, dz1);
      const ux1 = dx1 / L1, uz1 = dz1 / L1;
      const dx2 = c[0] - b[0], dz2 = c[1] - b[1];
      const L2 = Math.hypot(dx2, dz2);
      const ux2 = dx2 / L2, uz2 = dz2 / L2;
      // Straight part of leg i: from a + r*u1 to b - r*u1
      const start = radius, end = L1 - radius;
      for (let s = start; s < end; s += 1) push(a[0] + ux1 * s, a[1] + uz1 * s, a[2], i);
      // Corner arc at b, turning from u1 to u2 (90° turns; generic for any angle)
      const turn = Math.atan2(ux1 * uz2 - uz1 * ux2, ux1 * ux2 + uz1 * uz2); // signed angle
      const p0x = b[0] - ux1 * radius, p0z = b[1] - uz1 * radius;
      const p1x = b[0] + ux2 * radius, p1z = b[1] + uz2 * radius;
      const steps = Math.max(4, Math.ceil(Math.abs(turn) * radius));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        // Quadratic Bezier through the corner (close to a circular arc for 90° turns, and stays smooth)
        const q0x = p0x + (b[0] - p0x) * t, q0z = p0z + (b[1] - p0z) * t;
        const q1x = b[0] + (p1x - b[0]) * t, q1z = b[1] + (p1z - b[1]) * t;
        push(q0x + (q1x - q0x) * t, q0z + (q1z - q0z) * t, Math.min(a[2], b[2]) + (b[2] - Math.min(a[2], b[2])) * t, i);
      }
    }
    // Re-parameterize by arc length
    const count = xs.length;
    this.count = count;
    this.x = new Float32Array(count);
    this.z = new Float32Array(count);
    this.s = new Float32Array(count + 1);
    this.halfWidth = new Float32Array(count);
    this.leg = new Uint8Array(count);
    let acc = 0;
    for (let i = 0; i < count; i++) {
      this.x[i] = xs[i];
      this.z[i] = zs[i];
      this.halfWidth[i] = hw[i];
      this.leg[i] = legOf[i];
      this.s[i] = acc;
      const j = (i + 1) % count;
      acc += Math.hypot(xs[j] - xs[i], zs[j] - zs[i]);
    }
    this.s[count] = acc;
    this.length = acc;
    this.legNames = points.map((p) => p[3]);
    this.corners = points.map((p) => ({ x: p[0], z: p[1] }));
    this._idx = 0;
  }

  wrap(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  _index(s) {
    s = this.wrap(s);
    // Samples are ~1 m apart: start from a direct guess and walk
    let i = Math.min(this.count - 1, Math.max(0, Math.floor((s / this.length) * this.count)));
    while (i > 0 && this.s[i] > s) i--;
    while (i < this.count - 1 && this.s[i + 1] <= s) i++;
    return i;
  }

  /** Fills out = { x, z, hx, hz (unit tangent), rx, rz (unit right), heading, halfWidth, leg } at arc length s */
  sample(s, out = {}) {
    s = this.wrap(s);
    const i = this._index(s);
    const j = (i + 1) % this.count;
    const seg = this.s[i + 1] - this.s[i] || 1;
    const t = (s - this.s[i]) / seg;
    const x = this.x[i] + (this.x[j] - this.x[i]) * t;
    const z = this.z[i] + (this.z[j] - this.z[i]) * t;
    // Smoothed tangent over a few metres so corners turn gradually
    const k0 = (i - 2 + this.count) % this.count;
    const k1 = (i + 3) % this.count;
    let hx = this.x[k1] - this.x[k0];
    let hz = this.z[k1] - this.z[k0];
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl; hz /= hl;
    out.x = x;
    out.z = z;
    out.hx = hx;
    out.hz = hz;
    out.rx = -hz;
    out.rz = hx;
    // right = (-cos h, sin h) with forward (sin h, cos h): (-hz, hx)
    out.heading = Math.atan2(hx, hz);
    out.halfWidth = this.halfWidth[i];
    out.leg = this.leg[i];
    out.s = s;
    return out;
  }

  /** Nearest arc length to a world point, searching around a hint (cheap local search) or globally */
  project(x, z, hint = null, window = 120) {
    let best = Infinity;
    let bestI = 0;
    if (hint === null) {
      for (let i = 0; i < this.count; i += 2) {
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < best) { best = d; bestI = i; }
      }
    } else {
      const c = this._index(hint);
      for (let k = -window; k <= window; k++) {
        const i = (c + k + this.count) % this.count;
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < best) { best = d; bestI = i; }
      }
    }
    return this.s[bestI];
  }

  /** Signed forward distance from s0 to s1 along the loop, in (-L/2, L/2] */
  delta(s0, s1) {
    let d = this.wrap(s1 - s0);
    if (d > this.length / 2) d -= this.length;
    return d;
  }

  legName(s) {
    return this.legNames[this.leg[this._index(s)]];
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Walkability: building lots (axis-aligned rects inside every curb island) rasterized on a 2 m grid around the route.
// Streets, sidewalks and plazas are walkable; dinosaurs slide along building walls instead of walking through them.
// ---------------------------------------------------------------------------------------------------------------------
const CELL = 2;

class WalkGrid {
  constructor(route, margin = 260) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < route.count; i++) {
      minX = Math.min(minX, route.x[i]); maxX = Math.max(maxX, route.x[i]);
      minZ = Math.min(minZ, route.z[i]); maxZ = Math.max(maxZ, route.z[i]);
    }
    this.minX = Math.floor((minX - margin) / CELL) * CELL;
    this.minZ = Math.floor((minZ - margin) / CELL) * CELL;
    this.w = Math.ceil((maxX + margin - this.minX) / CELL);
    this.h = Math.ceil((maxZ + margin - this.minZ) / CELL);
    this.blocked = new Uint8Array(this.w * this.h);
    const x1 = this.minX + this.w * CELL, z1 = this.minZ + this.h * CELL;
    for (const b of BLOCKS) {
      if (b.maxX < this.minX || b.minX > x1 || b.maxZ < this.minZ || b.minZ > z1) continue;
      if (b.park) continue; // parks & plazas stay walkable (dinosaurs trample the flower beds)
      for (const r of b.rects || []) {
        // Shrink by half a cell so sidewalks stay open next to the facades
        this._fill(r[0] + 0.6, r[1] - 0.6, r[2] + 0.6, r[3] - 0.6);
      }
    }
  }

  _fill(x0, x1, z0, z1) {
    const i0 = Math.max(0, Math.floor((x0 - this.minX) / CELL));
    const i1 = Math.min(this.w - 1, Math.floor((x1 - this.minX) / CELL));
    const j0 = Math.max(0, Math.floor((z0 - this.minZ) / CELL));
    const j1 = Math.min(this.h - 1, Math.floor((z1 - this.minZ) / CELL));
    for (let j = j0; j <= j1; j++) this.blocked.fill(1, j * this.w + i0, j * this.w + i1 + 1);
  }

  isBlocked(x, z) {
    const i = Math.floor((x - this.minX) / CELL);
    const j = Math.floor((z - this.minZ) / CELL);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return true;
    return this.blocked[j * this.w + i] === 1;
  }

  /** Moves (x, z) by (dx, dz) sliding along blocked cells; returns the new position in out */
  move(x, z, dx, dz, out) {
    let nx = x + dx, nz = z + dz;
    if (!this.isBlocked(nx, nz)) { out.x = nx; out.z = nz; out.hit = false; return out; }
    if (!this.isBlocked(x + dx, z)) { out.x = x + dx; out.z = z; out.hit = true; return out; }
    if (!this.isBlocked(x, z + dz)) { out.x = x; out.z = z + dz; out.hit = true; return out; }
    out.x = x; out.z = z; out.hit = true;
    return out;
  }
}

export { Route, WalkGrid, LOOP };
