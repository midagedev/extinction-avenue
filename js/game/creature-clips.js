// js/game/creature-clips.js
// Procedural KEYFRAME generators for rigs shipped without animation clips (the auto-rigged theropod sculpt). Each clip
// is { name, loop, duration, speed, frame(t, rot, off) }: frame() writes per-bone local rotations (Euler YXZ: x pitch,
// y yaw, z roll) and a root offset for time t; skin-model.js bakes them through FK (with the species' morph scales) into
// skinning matrices at 30 fps. Conventions (joint frames are model-aligned at rest): +x on a neck/head pitches it down,
// +x on the jaw opens it, +x on a tail segment raises it, +x on a downward leg segment swings it backward.
//
// Locomotion uses planar 2-bone IK per leg (thigh + shin reach the ankle; the metatarsus rolls through the stance and
// folds in the swing; toes stay flat on the ground in stance), so feet plant instead of sliding. `speed` is the ground
// speed (model units / s) the cycle was authored for; the game scales the playback rate to the creature's real speed.

const TAU = Math.PI * 2;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ang = (z, y) => Math.atan2(z, y);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Theropod (compy / raptor / brute / T. rex) — bone names from tools/lab/rig-theropod.js */
function theropod(sk, opts = {}) {
  const I = (n) => sk.index.get(n);
  const R = sk.morphRest;
  const J = (n) => { const i = I(n); return { x: R[i * 3], y: R[i * 3 + 1], z: R[i * 3 + 2] }; };
  const root = J('root');
  const S = (n, k) => sk.scales[I(n) * 3 + k];
  const add = (rot, n, x, y = 0, z = 0) => { const i = I(n); if (i === undefined) return; rot[i * 3] += x; rot[i * 3 + 1] += y; rot[i * 3 + 2] += z; };
  // Leg geometry (sagittal plane z, y), from the morphed rest joints
  const legs = ['L', 'R'].map((s) => {
    const H = J(`thigh${s}`), K = J(`shin${s}`), A = J(`foot${s}`), B = J(`toe${s}`);
    const tip = { z: B.z + 0.76 * S(`toe${s}`, 2), y: B.y - 0.15 * S(`toe${s}`, 1) };
    const L1 = Math.hypot(K.z - H.z, K.y - H.y), L2 = Math.hypot(A.z - K.z, A.y - K.y), L3 = Math.hypot(B.z - A.z, B.y - A.y);
    const t1 = ang(K.z - H.z, K.y - H.y), t2 = ang(A.z - K.z, A.y - K.y), t3 = ang(B.z - A.z, B.y - A.y), t4 = ang(tip.z - B.z, tip.y - B.y);
    const kneeSide = Math.sign((A.z - H.z) * (K.y - H.y) - (A.y - H.y) * (K.z - H.z)) || 1;
    return { s, H, B, L1, L2, L3, t1, t2, t3, t4, kneeSide, hr: { y: H.y - root.y, z: H.z - root.z } };
  });
  const legLen = legs[0].L1 + legs[0].L2 + legs[0].L3;
  const k = legLen / 3.32; // gait sizes are authored for the unmorphed sculpt (leg 3.32 units)

  /** Places one leg: ball of the foot at (bz, by) model space; metatarsus roll dm; toe curl tc; body offset + pitch */
  function leg(rot, L, bz, by, dm, tc, off, pitch) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    const hy = root.y + off.y + L.hr.y * c - L.hr.z * s, hz = root.z + off.z + L.hr.y * s + L.hr.z * c;
    const phi = L.t3 + dm;
    const ay = by - L.L3 * Math.cos(phi), az = bz - L.L3 * Math.sin(phi);
    let dy = ay - hy, dz = az - hz;
    let d = Math.hypot(dy, dz);
    const dmax = L.L1 + L.L2 - 1e-3, dmin = Math.abs(L.L1 - L.L2) + 1e-3;
    if (d > dmax) { dy *= dmax / d; dz *= dmax / d; d = dmax; } else if (d < dmin) { dy *= dmin / d; dz *= dmin / d; d = dmin; }
    const a = ang(dz, dy), b = Math.acos(Math.min(1, Math.max(-1, (L.L1 * L.L1 + d * d - L.L2 * L.L2) / (2 * L.L1 * d))));
    let th1 = a + b;
    // knee on the same side of the hip→ankle line as at rest (forward)
    const ky = Math.cos(th1) * L.L1, kz = Math.sin(th1) * L.L1;
    if (Math.sign(dz * ky - dy * kz) !== L.kneeSide) th1 = a - b;
    const kyy = hy + Math.cos(th1) * L.L1, kzz = hz + Math.sin(th1) * L.L1;
    const th2 = ang(hz + dz - kzz, hy + dy - kyy);
    const w1 = wrap(th1 - L.t1), w2 = wrap(th2 - L.t2), w3 = wrap(phi - L.t3), w4 = tc;
    add(rot, `thigh${L.s}`, w1 - pitch);
    add(rot, `shin${L.s}`, w2 - w1);
    add(rot, `foot${L.s}`, w3 - w2);
    add(rot, `toe${L.s}`, w4 - w3);
  }

  /** Standing feet (rest positions, optional stance spread) */
  function stand(rot, off, pitch, spread = 0, dmL = 0, dmR = 0) {
    leg(rot, legs[0], legs[0].B.z + spread, legs[0].B.y, dmL, 0, off, pitch);
    leg(rot, legs[1], legs[1].B.z - spread, legs[1].B.y, dmR, 0, off, pitch);
  }

  const tail = ['tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'];
  function tailWave(rot, t, f, ampY, ampX, lift = 0) {
    tail.forEach((n, i) => add(rot, n, lift * (i < 2 ? 1 : 0.4) + ampX * Math.sin(TAU * f * t - i * 0.7), ampY * (0.5 + i * 0.25) * Math.sin(TAU * f * t - i * 0.6)));
  }
  function arms(rot, x, fore, hand = 0) {
    for (const s of ['L', 'R']) { add(rot, `arm${s}`, x, 0, s === 'L' ? 0.08 : -0.08); add(rot, `fore${s}`, fore); add(rot, `hand${s}`, hand); }
  }

  // --- Locomotion -------------------------------------------------------------------------------------------------------
  function gait(name, T, duty, stride, lift, bob, pose) {
    const St = stride * k;
    const speed = St / (duty * T);
    return {
      name, loop: true, duration: T, speed,
      frame(t, rot, off) {
        const ph = t / T;
        // body: two bobs per cycle (low at mid-stance), lean over the stance leg, slight forward pitch
        const bobv = -bob * k * Math.cos(TAU * (2 * ph - duty));
        off.set(0, bobv - pose.crouch * k, pose.fwd * k);
        const pitch = pose.pitch + 0.02 * Math.sin(TAU * 2 * ph);
        add(rot, 'root', pitch, 0.05 * Math.sin(TAU * ph), 0.045 * Math.sin(TAU * ph));
        add(rot, 'spine', 0.02, -0.03 * Math.sin(TAU * ph));
        add(rot, 'chest', 0.01, -0.03 * Math.sin(TAU * ph));
        // head stays steady: the neck soaks up the bob and the pitch
        add(rot, 'neck1', pose.neck1 - pitch * 0.6 + 0.03 * Math.cos(TAU * (2 * ph - duty)), 0.04 * Math.sin(TAU * ph));
        add(rot, 'neck2', pose.neck2 - 0.02 * Math.cos(TAU * (2 * ph - duty)));
        add(rot, 'head', pose.head - pitch * 0.4 + 0.05 * Math.cos(TAU * (2 * ph - duty) + 0.6), -0.03 * Math.sin(TAU * ph));
        add(rot, 'jaw', pose.jaw + 0.05 * Math.sin(TAU * 2 * ph));
        tailWave(rot, t, 1 / T, pose.tailYaw, 0.035, pose.tailLift);
        arms(rot, pose.arm + 0.12 * Math.sin(TAU * ph), pose.fore, 0.1);
        for (const [i, L] of legs.entries()) {
          const p = (ph + i * 0.5) % 1;
          const z0 = L.B.z + pose.foot * St;
          let bz, by, dm, tc;
          if (p < duty) {
            const u = p / duty;
            bz = z0 + St / 2 - St * u; by = L.B.y; dm = -0.12 + 0.62 * sm(0.05, 1, u); tc = 0;
          } else {
            const u = (p - duty) / (1 - duty);
            bz = z0 - St / 2 + St * (0.5 - 0.5 * Math.cos(Math.PI * u));
            by = L.B.y + lift * k * Math.sin(Math.PI * u) * (1 + 0.4 * (1 - u));
            dm = 0.5 - 0.62 * u + 0.45 * Math.sin(Math.PI * u);
            tc = 0.7 * Math.sin(Math.PI * u);
          }
          leg(rot, L, bz, by, dm, tc, off, pitch);
        }
      }
    };
  }
  const run = gait('run', opts.runT ?? 0.62, 0.34, opts.runStride ?? 3.4, 0.95, 0.16,
    { crouch: 0.12, fwd: 0, pitch: 0.06, neck1: 0.28, neck2: 0.12, head: -0.22, jaw: 0.12, tailYaw: 0.06, tailLift: -0.02, arm: -0.35, fore: -0.25, foot: 0.12 });
  const walk = gait('walk', opts.walkT ?? 1.25, 0.62, 2.2, 0.5, 0.07,
    { crouch: 0.03, fwd: 0, pitch: 0.02, neck1: 0.08, neck2: 0.04, head: -0.06, jaw: 0.06, tailYaw: 0.1, tailLift: 0.0, arm: -0.2, fore: -0.15, foot: 0.05 });

  // --- Idle / windup / pounce -------------------------------------------------------------------------------------------
  const idle = {
    name: 'idle', loop: true, duration: 4, speed: 0,
    frame(t, rot, off) {
      const b = Math.sin(TAU * t / 2); // breath
      off.set(0, (-0.04 + 0.025 * b) * k, 0);
      add(rot, 'root', 0.0, 0.03 * Math.sin(TAU * t / 4));
      add(rot, 'chest', -0.015 * b);
      add(rot, 'neck1', 0.05 - 0.02 * b, 0.22 * Math.sin(TAU * t / 4 + 0.5));
      add(rot, 'head', -0.04 + 0.08 * Math.sin(TAU * t / 4 + 1.6), 0.18 * Math.sin(TAU * t / 4 + 1.1), 0.05 * Math.sin(TAU * t / 2));
      add(rot, 'jaw', 0.06 + 0.06 * Math.max(0, Math.sin(TAU * t / 2)));
      tailWave(rot, t, 0.25, 0.12, 0.02, 0.02);
      arms(rot, -0.15 + 0.03 * b, -0.1, 0.05);
      stand(rot, off, 0, 0.18 * k);
    }
  };
  const crouch = {
    name: 'crouch', loop: true, duration: 1, speed: 0,
    frame(t, rot, off) {
      const tr = 0.012 * Math.sin(TAU * 13 * t);
      off.set(0, -0.42 * k + tr * k, 0.1 * k);
      const pitch = 0.2;
      add(rot, 'root', pitch, 0.02 * Math.sin(TAU * t), tr);
      add(rot, 'spine', 0.04);
      add(rot, 'neck1', 0.1 - pitch * 0.5);
      add(rot, 'neck2', 0.02);
      add(rot, 'head', -0.22, 0.05 * Math.sin(TAU * 2 * t), 0.04 * Math.sin(TAU * 3 * t));
      add(rot, 'jaw', 0.55 + 0.08 * Math.sin(TAU * 5 * t));
      tailWave(rot, t, 1, 0.08, 0.03, 0.07);
      arms(rot, -0.6, -0.35, 0.25);
      stand(rot, off, pitch, 0.32 * k, -0.25, -0.25);
    }
  };
  const pounce = {
    name: 'pounce', loop: true, duration: 0.8, speed: 0,
    frame(t, rot, off) {
      const pitch = -0.12;
      off.set(0, 0, 0);
      add(rot, 'root', pitch);
      add(rot, 'neck1', 0.45 - pitch);
      add(rot, 'neck2', 0.22);
      add(rot, 'head', -0.3, 0, 0.03 * Math.sin(TAU * t / 0.8));
      add(rot, 'jaw', 0.95);
      tailWave(rot, t, 1.25, 0.04, 0.02, 0.05);
      arms(rot, -0.62, -0.15, 0.4);
      // legs tucked forward under the body, claws forward
      for (const L of legs) {
        const hy = root.y + L.hr.y, hz = root.z + L.hr.z;
        leg(rot, L, hz + 0.95 * k, hy - 1.45 * k, -0.9, -0.5, off, pitch);
      }
    }
  };

  // --- Attacks ----------------------------------------------------------------------------------------------------------
  const bite = {
    name: 'bite', loop: false, duration: 0.62, speed: 0,
    frame(t, rot, off) {
      const draw = sm(0, 0.18, t) * (1 - sm(0.18, 0.3, t));
      const lunge = sm(0.16, 0.3, t) * (1 - sm(0.42, 0.62, t));
      const open = sm(0.0, 0.15, t) * (1 - sm(0.3, 0.37, t));
      const pitch = 0.04 + 0.12 * lunge - 0.06 * draw;
      off.set(0, (-0.08 * draw - 0.05 * lunge) * k, (0.35 * lunge - 0.1 * draw) * k);
      add(rot, 'root', pitch);
      add(rot, 'neck1', -0.22 * draw + 0.5 * lunge - pitch * 0.5);
      add(rot, 'neck2', -0.1 * draw + 0.25 * lunge);
      add(rot, 'head', -0.15 * draw + 0.08 * lunge, 0, 0.06 * lunge);
      add(rot, 'jaw', 0.06 + 0.92 * open);
      tailWave(rot, t, 1.5, 0.05, 0.02, 0.05 * lunge);
      arms(rot, -0.3 - 0.6 * lunge, -0.2 - 0.3 * lunge, 0.3 * lunge);
      stand(rot, off, pitch, 0.3 * k);
    }
  };
  const roar = {
    name: 'roar', loop: false, duration: 2.4, speed: 0,
    frame(t, rot, off) {
      const rear = sm(0, 0.3, t) * (1 - sm(0.3, 0.5, t));
      const thrust = sm(0.3, 0.5, t) * (1 - sm(1.85, 2.35, t));
      const open = sm(0.15, 0.55, t) * (1 - sm(1.8, 2.2, t));
      const shake = thrust * sm(0.6, 0.8, t);
      const pitch = -0.2 * rear + 0.06 * thrust;
      off.set(0, (0.08 * rear - 0.12 * thrust) * k, (-0.12 * rear + 0.15 * thrust) * k);
      add(rot, 'root', pitch);
      add(rot, 'chest', -0.05 * rear + 0.03 * Math.sin(TAU * 7 * t) * shake);
      add(rot, 'neck1', -0.35 * rear + 0.12 * thrust - pitch * 0.4, 0.07 * Math.sin(TAU * 4.5 * t) * shake);
      add(rot, 'neck2', -0.18 * rear + 0.02 * thrust);
      add(rot, 'head', -0.3 * rear - 0.2 * thrust, 0.08 * Math.sin(TAU * 9 * t) * shake, 0.06 * Math.sin(TAU * 6 * t) * shake);
      add(rot, 'jaw', 0.06 + 1.05 * open + 0.05 * Math.sin(TAU * 11 * t) * shake);
      tailWave(rot, t, 0.8, 0.1, 0.04, 0.08 * thrust + 0.03 * rear);
      arms(rot, -0.4 - 0.5 * thrust, -0.4 * thrust, 0.5 * thrust);
      stand(rot, off, pitch, 0.42 * k);
    }
  };
  const swipe = {
    name: 'throw', loop: false, duration: 1.3, speed: 0,
    frame(t, rot, off) {
      // head swings aside (holding a car), then flings it across: release at 0.9 s
      const wind = sm(0, 0.8, t) * (1 - sm(0.82, 1.0, t));
      const fling = sm(0.82, 1.0, t) * (1 - sm(1.05, 1.3, t));
      off.set(0, -0.05 * k, 0);
      add(rot, 'root', 0.03, -0.12 * wind + 0.15 * fling);
      add(rot, 'neck1', 0.1 * wind - 0.1 * fling, -0.6 * wind + 0.75 * fling);
      add(rot, 'neck2', 0, -0.3 * wind + 0.35 * fling);
      add(rot, 'head', -0.1 * fling, -0.2 * wind + 0.25 * fling, 0.15 * wind);
      add(rot, 'jaw', 0.3 * wind + 0.8 * fling);
      tailWave(rot, t, 0.8, 0.08, 0.02, 0.03);
      arms(rot, -0.3, -0.2, 0.1);
      stand(rot, off, 0.03, 0.35 * k);
    }
  };

  // --- Reactions --------------------------------------------------------------------------------------------------------
  const hit = {
    name: 'hit', loop: false, duration: 0.45, speed: 0,
    frame(t, rot, off) {
      const e = Math.pow(Math.sin(Math.PI * Math.min(1, t / 0.45)), 0.7);
      const pitch = -0.1 * e;
      off.set(0, 0.03 * e * k, -0.18 * e * k);
      add(rot, 'root', pitch, 0.08 * e, 0.06 * e);
      add(rot, 'chest', -0.06 * e);
      add(rot, 'neck1', -0.32 * e, 0.22 * e);
      add(rot, 'neck2', -0.1 * e);
      add(rot, 'head', -0.12 * e, 0.3 * e, 0.18 * e);
      add(rot, 'jaw', 0.06 + 0.55 * e);
      tailWave(rot, t, 2, 0.1 * e, 0.0, 0.06 * e);
      arms(rot, -0.4 * e, -0.3 * e, 0.3 * e);
      stand(rot, off, pitch, 0.2 * k);
    }
  };
  const death = {
    name: 'death', loop: false, duration: 1.3, speed: 0,
    frame(t, rot, off) {
      const c = sm(0, 1.0, t);
      const drop = (root.y - legs[0].B.y) * 0.62;
      const pitch = 0.22 * c;
      off.set(0, -drop * c, 0.1 * c * k);
      add(rot, 'root', pitch, 0, 0.08 * c);
      add(rot, 'neck1', 0.45 * c - pitch * 0.3, 0.15 * c);
      add(rot, 'neck2', 0.3 * c);
      add(rot, 'head', 0.25 * c, 0.1 * c);
      add(rot, 'jaw', 0.06 + 0.65 * sm(0, 0.3, t));
      tail.forEach((n, i) => add(rot, n, -0.12 * c * (i < 2 ? 1 : 0.5), 0.05 * i * c));
      arms(rot, 0.3 * c, 0.6 * c, 0.5 * c);
      stand(rot, off, pitch, 0.35 * k, -0.9 * c, -0.9 * c);
    }
  };
  return [run, walk, idle, crouch, pounce, bite, roar, swipe, hit, death];
}

const CLIP_LIBRARY = { theropod };

export { CLIP_LIBRARY };
