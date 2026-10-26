import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// js/game/props.js
// Procedural low-poly placeholder props (pickups, projectiles, debris, the taxi's weapon attachments). Each returns a
// non-indexed, flat-shaded BufferGeometry with `color` (linear RGB) and `emissive` (RGB glow) attributes — the same
// format a replacement GLB is baked into by assets.js. Units: metres; pivots documented per prop.

const C = {
  gunmetal: [0.07, 0.075, 0.085],
  steel: [0.32, 0.34, 0.37],
  dark: [0.025, 0.025, 0.03],
  yellow: [1.0, 0.62, 0.02],
  black: [0.02, 0.02, 0.02],
  red: [0.75, 0.04, 0.03],
  orange: [1.0, 0.32, 0.02],
  green: [0.1, 0.55, 0.18],
  white: [0.85, 0.85, 0.82],
  stone: [0.42, 0.40, 0.37],
  stoneDark: [0.3, 0.28, 0.26],
  blue: [0.08, 0.2, 0.6],
  cyanGlow: [0.3, 3.2, 3.8],
  orangeGlow: [4.0, 1.4, 0.2],
  redGlow: [4.0, 0.25, 0.15],
  greenGlow: [0.4, 3.6, 0.8],
  whiteGlow: [3, 3, 3]
};

/** One primitive with a flat color & glow, transformed: t = { p: [x,y,z], r: [x,y,z] (rad), s: [x,y,z] } */
function prim(geo, color, glow = null, t = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...(t.p || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(t.r || [0, 0, 0]), 'YXZ')),
    new THREE.Vector3(...(t.s || [1, 1, 1]))
  );
  g.applyMatrix4(m);
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const emi = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col.set(color, i * 3);
    if (glow) emi.set(glow, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('emissive', new THREE.BufferAttribute(emi, 3));
  return g;
}

function merge(list) {
  const g = mergeGeometries(list, false);
  g.computeVertexNormals();
  return g;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const X = Math.PI / 2;

const BUILDERS = {
  // Roof pedestal; origin on the roof, top of the ring mount at y = 0.42
  turretBase: () => merge([
    prim(box(0.5, 0.3, 0.7), C.gunmetal, null, { p: [0, 0.15, 0] }),
    prim(cyl(0.34, 0.4, 0.14, 10), C.steel, null, { p: [0, 0.36, 0] }),
    prim(box(0.52, 0.06, 0.72), C.yellow, null, { p: [0, 0.04, 0] }),
    prim(cyl(0.36, 0.36, 0.03, 10), C.dark, C.cyanGlow, { p: [0, 0.44, 0] })
  ]),
  // Roof cannon; pivot = yaw/pitch centre, barrel along +z, muzzle at z ≈ 1.45
  turretGun: () => merge([
    prim(box(0.56, 0.36, 0.72), C.gunmetal, null, { p: [0, 0.05, -0.05] }),
    prim(box(0.6, 0.1, 0.5), C.yellow, null, { p: [0, 0.25, -0.1] }),
    prim(box(0.05, 0.05, 0.4), C.dark, C.cyanGlow, { p: [0.29, 0.08, 0.05] }),
    prim(box(0.05, 0.05, 0.4), C.dark, C.cyanGlow, { p: [-0.29, 0.08, 0.05] }),
    prim(cyl(0.09, 0.11, 1.0, 8), C.steel, null, { p: [0, 0.05, 0.75], r: [X, 0, 0] }),
    prim(cyl(0.14, 0.14, 0.22, 8), C.gunmetal, null, { p: [0, 0.05, 1.32], r: [X, 0, 0] }),
    prim(cyl(0.07, 0.07, 0.05, 8), C.dark, C.orangeGlow, { p: [0, 0.05, 1.44], r: [X, 0, 0] })
  ]),
  // Rail Lance (evolved cannon): twin rails with glowing coils
  railGun: () => merge([
    prim(box(0.62, 0.38, 0.8), C.gunmetal, null, { p: [0, 0.05, -0.05] }),
    prim(box(0.1, 0.12, 1.9), C.steel, null, { p: [0.16, 0.05, 1.0] }),
    prim(box(0.1, 0.12, 1.9), C.steel, null, { p: [-0.16, 0.05, 1.0] }),
    ...[0.4, 0.8, 1.2, 1.6].map((z) => prim(box(0.46, 0.2, 0.08), C.dark, C.cyanGlow, { p: [0, 0.05, z] })),
    prim(box(0.64, 0.08, 0.6), C.yellow, null, { p: [0, 0.26, -0.1] })
  ]),
  // First-person tail gun (the rear gunner's view model): heavy twin-grip machine gun with the gunner's gloved hands.
  // Pivot = the aiming centre on the receiver, barrel along +z, muzzle at z ≈ 1.3, spade grips toward -z.
  tailGun: () => merge([
    prim(box(0.24, 0.2, 0.6), C.gunmetal, null, { p: [0, 0, 0.02] }),
    prim(box(0.25, 0.03, 0.5), C.steel, null, { p: [0, 0.115, 0.04] }),
    prim(box(0.04, 0.032, 0.5), C.yellow, null, { p: [0.09, 0.12, 0.04] }),
    prim(box(0.02, 0.03, 0.4), C.dark, C.cyanGlow, { p: [0.125, 0.03, 0.05] }),
    prim(box(0.02, 0.03, 0.4), C.dark, C.cyanGlow, { p: [-0.125, 0.03, 0.05] }),
    prim(cyl(0.07, 0.07, 0.5, 10), C.steel, null, { p: [0, 0.01, 0.55], r: [X, 0, 0] }),
    ...[0.38, 0.48, 0.58, 0.68].map((z) => prim(cyl(0.075, 0.075, 0.025, 10), C.dark, null, { p: [0, 0.01, z], r: [X, 0, 0] })),
    prim(cyl(0.04, 0.04, 0.5, 8), C.gunmetal, null, { p: [0, 0.01, 1.03], r: [X, 0, 0] }),
    prim(cyl(0.06, 0.055, 0.12, 8), C.gunmetal, null, { p: [0, 0.01, 1.3], r: [X, 0, 0] }),
    prim(cyl(0.032, 0.032, 0.02, 8), C.dark, C.orangeGlow, { p: [0, 0.01, 1.365], r: [X, 0, 0] }),
    // ammo can on the left, feed tray, rear sight ring + front post
    prim(box(0.16, 0.2, 0.3), C.green, null, { p: [-0.21, -0.03, 0.02] }),
    prim(box(0.165, 0.04, 0.31), C.yellow, null, { p: [-0.21, 0.05, 0.02] }),
    prim(box(0.08, 0.05, 0.12), C.gunmetal, null, { p: [-0.12, 0.06, 0.05] }),
    prim(box(0.05, 0.05, 0.012), C.dark, null, { p: [0, 0.16, -0.12] }),
    prim(box(0.012, 0.012, 0.014), C.dark, C.redGlow, { p: [0, 0.18, -0.12] }),
    prim(box(0.012, 0.07, 0.012), C.dark, C.cyanGlow, { p: [0, 0.12, 1.22] }),
    // spade grips + trigger plate
    prim(box(0.3, 0.05, 0.05), C.gunmetal, null, { p: [0, -0.02, -0.3] }),
    prim(cyl(0.025, 0.025, 0.2, 6), C.dark, null, { p: [0.13, -0.02, -0.34] }),
    prim(cyl(0.025, 0.025, 0.2, 6), C.dark, null, { p: [-0.13, -0.02, -0.34] }),
    prim(box(0.08, 0.03, 0.04), C.red, C.redGlow, { p: [0, 0.02, -0.33] }),
    // gloved hands on the grips, sleeves running back toward the camera (hi-vis Animal Control jacket)
    ...[-1, 1].flatMap((s) => [
      prim(box(0.09, 0.13, 0.1), [0.06, 0.045, 0.035], null, { p: [s * 0.13, -0.02, -0.36] }),
      prim(box(0.035, 0.05, 0.08), [0.06, 0.045, 0.035], null, { p: [s * 0.095, 0.04, -0.32] }),
      prim(cyl(0.06, 0.07, 0.42, 7), [0.09, 0.1, 0.085], null, { p: [s * 0.17, -0.1, -0.58], r: [X - 0.45, 0, s * 0.25] }),
      prim(cyl(0.072, 0.072, 0.05, 7), C.yellow, [0.5, 0.35, 0.02], { p: [s * 0.15, -0.06, -0.44], r: [X - 0.45, 0, s * 0.25] })
    ])
  ]),
  // Rail Lance view model (evolved tail gun), same pivot/axes as tailGun
  tailRail: () => merge([
    prim(box(0.28, 0.22, 0.62), C.gunmetal, null, { p: [0, 0, 0.02] }),
    prim(box(0.06, 0.07, 1.25), C.steel, null, { p: [0.08, 0.01, 0.85] }),
    prim(box(0.06, 0.07, 1.25), C.steel, null, { p: [-0.08, 0.01, 0.85] }),
    ...[0.45, 0.7, 0.95, 1.2].map((z) => prim(box(0.26, 0.12, 0.05), C.dark, C.cyanGlow, { p: [0, 0.01, z] })),
    prim(box(0.29, 0.04, 0.5), C.yellow, null, { p: [0, 0.13, 0.04] }),
    prim(box(0.3, 0.05, 0.05), C.gunmetal, null, { p: [0, -0.02, -0.3] }),
    ...[-1, 1].flatMap((s) => [
      prim(box(0.09, 0.13, 0.1), [0.06, 0.045, 0.035], null, { p: [s * 0.14, -0.02, -0.36] }),
      prim(cyl(0.06, 0.07, 0.42, 7), [0.09, 0.1, 0.085], null, { p: [s * 0.18, -0.1, -0.58], r: [X - 0.45, 0, s * 0.25] }),
      prim(cyl(0.072, 0.072, 0.05, 7), C.yellow, [0.5, 0.35, 0.02], { p: [s * 0.16, -0.06, -0.44], r: [X - 0.45, 0, s * 0.25] })
    ])
  ]),
  // Roof-hatch coaming seen at the bottom corners of the gunner's view: a hazard-striped rim, bolted plate and a grab
  // handle. Bar along +x, centred, origin at its middle.
  hatchRim: () => merge([
    ...Array.from({ length: 10 }, (_, i) => prim(box(0.12, 0.07, 0.09), i % 2 ? C.black : C.yellow, null, { p: [-0.54 + i * 0.12, 0, 0] })),
    prim(box(1.24, 0.03, 0.16), C.gunmetal, null, { p: [0, -0.05, 0.02] }),
    prim(box(1.24, 0.14, 0.03), C.gunmetal, null, { p: [0, -0.1, 0.09] }),
    ...[-0.45, -0.15, 0.15, 0.45].map((x) => prim(cyl(0.012, 0.012, 0.01, 6), C.steel, null, { p: [x, -0.035, 0.05] })),
    prim(cyl(0.015, 0.015, 0.3, 6), C.steel, null, { p: [0.2, 0.06, -0.02], r: [0, 0, X] }),
    prim(box(0.03, 0.02, 0.03), C.dark, C.orangeGlow, { p: [-0.55, 0.045, 0] })
  ]),
  // Rear deck gun mount (the ring the tail gun sits on), origin on the car roof
  tailMount: () => merge([
    prim(box(1.5, 0.12, 0.9), C.gunmetal, null, { p: [0, 0.06, 0] }),
    prim(box(1.52, 0.05, 0.2), C.yellow, null, { p: [0, 0.13, -0.38] }),
    ...[-0.6, -0.2, 0.2, 0.6].map((x, i) => prim(box(0.2, 0.051, 0.2), i % 2 ? C.black : C.yellow, null, { p: [x, 0.135, -0.38] })),
    prim(cyl(0.3, 0.34, 0.14, 12), C.steel, null, { p: [0, 0.2, 0] }),
    prim(cyl(0.31, 0.31, 0.02, 12), C.dark, C.cyanGlow, { p: [0, 0.28, 0] })
  ]),
  // Hood gun pod (one side); origin at its mount, barrels along +z
  attGatling: () => merge([
    prim(box(0.22, 0.18, 0.5), C.gunmetal, null, { p: [0, 0.09, 0] }),
    ...[0, 1, 2].map((k) => prim(cyl(0.025, 0.025, 0.55, 5), C.steel, null, { p: [Math.cos(k * 2.1) * 0.05, 0.1 + Math.sin(k * 2.1) * 0.05, 0.45], r: [X, 0, 0] })),
    prim(box(0.23, 0.04, 0.2), C.yellow, null, { p: [0, 0.19, -0.1] })
  ]),
  // Trunk missile pod, tubes along +z
  attMissiles: () => merge([
    prim(box(0.7, 0.34, 0.55), C.gunmetal, null, { p: [0, 0.17, 0] }),
    ...[-0.22, 0, 0.22].flatMap((x) => [0.1, 0.24].map((y) => prim(cyl(0.07, 0.07, 0.05, 6), C.dark, C.redGlow, { p: [x, y, 0.28], r: [X, 0, 0] }))),
    prim(box(0.72, 0.05, 0.57), C.yellow, null, { p: [0, 0.35, 0] })
  ]),
  // Tesla spire on the trunk, origin at its base
  attTesla: () => merge([
    prim(cyl(0.16, 0.2, 0.18, 8), C.gunmetal, null, { p: [0, 0.09, 0] }),
    prim(cyl(0.05, 0.07, 0.65, 6), C.steel, null, { p: [0, 0.5, 0] }),
    ...[0.35, 0.52, 0.69].map((y, i) => prim(cyl(0.16 - i * 0.03, 0.16 - i * 0.03, 0.04, 10), C.dark, C.cyanGlow, { p: [0, y, 0] })),
    prim(ico(0.11, 1), C.dark, [1.5, 4, 5], { p: [0, 0.9, 0] })
  ]),
  // Twin exhaust flamers at the rear bumper; nozzles toward -z
  attFlamer: () => merge([
    ...[-0.5, 0.5].flatMap((x) => [
      prim(cyl(0.08, 0.1, 0.42, 7), C.steel, null, { p: [x, 0, -0.1], r: [X, 0, 0] }),
      prim(cyl(0.06, 0.06, 0.04, 7), C.dark, C.orangeGlow, { p: [x, 0, -0.32], r: [X, 0, 0] })
    ]),
    prim(box(1.1, 0.08, 0.12), C.gunmetal, null, { p: [0, 0, 0.05] })
  ]),
  // Bumper buckshot bar, barrels along +z
  attShotgun: () => merge([
    prim(box(0.9, 0.14, 0.18), C.gunmetal, null, { p: [0, 0, 0] }),
    ...[-0.32, -0.16, 0, 0.16, 0.32].map((x) => prim(cyl(0.04, 0.045, 0.3, 6), C.steel, null, { p: [x, 0, 0.2], r: [X, 0, 0] }))
  ]),
  // Front ram plow (wedge with hazard stripes and spikes); origin at the front bumper, centred
  attPlow: () => {
    const parts = [];
    for (let i = 0; i < 8; i++) {
      const x = -0.98 + i * 0.28 + 0.14;
      const back = Math.abs(x) * 0.28;
      parts.push(prim(box(0.28, 0.6, 0.08), i % 2 ? C.black : C.yellow, null, { p: [x, 0.42, 0.3 - back], r: [-0.35, x > 0 ? -0.28 : 0.28, 0] }));
    }
    for (const x of [-0.6, -0.2, 0.2, 0.6]) parts.push(prim(cone(0.06, 0.32, 5), C.steel, null, { p: [x, 0.4, 0.5 - Math.abs(x) * 0.28], r: [X, 0, 0] }));
    parts.push(prim(box(1.6, 0.1, 0.18), C.gunmetal, null, { p: [0, 0.18, 0.05] }));
    return merge(parts);
  },
  // Bolted side armor plates (both sides), origin at the car origin
  attArmor: () => merge([-1, 1].flatMap((s) => [
    prim(box(0.06, 0.34, 2.5), C.gunmetal, null, { p: [s * 0.96, 0.52, 0.05] }),
    prim(box(0.07, 0.06, 2.52), C.yellow, null, { p: [s * 0.965, 0.7, 0.05] }),
    ...[-0.9, -0.3, 0.3, 0.9].map((z) => prim(box(0.08, 0.06, 0.06), C.steel, null, { p: [s * 0.99, 0.5, z] }))
  ])),

  // Gene core (XP): elongated octahedron, centred; instance color tints the glow
  gem: () => merge([
    prim(new THREE.OctahedronGeometry(0.32, 0), [0.6, 0.6, 0.6], [1.2, 1.2, 1.2], { s: [0.75, 1.25, 0.75] }),
    prim(new THREE.OctahedronGeometry(0.18, 0), [1, 1, 1], [3, 3, 3], { s: [0.7, 1.3, 0.7] })
  ]),
  // Cretagen supply crate (from elites), origin at the bottom centre
  crate: () => merge([
    prim(box(1.3, 0.9, 1.0), C.gunmetal, null, { p: [0, 0.45, 0] }),
    ...[-0.5, -0.17, 0.17, 0.5].map((x, i) => prim(box(0.33, 0.2, 1.02), i % 2 ? C.black : C.yellow, null, { p: [x, 0.65, 0] })),
    prim(box(1.34, 0.08, 0.2), C.dark, C.cyanGlow, { p: [0, 0.3, 0] }),
    prim(box(0.12, 0.94, 1.04), C.steel, null, { p: [0.62, 0.45, 0] }),
    prim(box(0.12, 0.94, 1.04), C.steel, null, { p: [-0.62, 0.45, 0] }),
    prim(cyl(0.08, 0.1, 0.25, 6), C.dark, C.cyanGlow, { p: [0, 1.0, 0] })
  ]),
  // Repair kit: toolbox with a glowing green plus, origin at the bottom centre
  repair: () => merge([
    prim(box(0.9, 0.5, 0.5), C.white, null, { p: [0, 0.25, 0] }),
    prim(box(0.5, 0.08, 0.08), C.gunmetal, null, { p: [0, 0.58, 0] }),
    prim(box(0.36, 0.1, 0.52), C.green, C.greenGlow, { p: [0, 0.27, 0] }),
    prim(box(0.1, 0.36, 0.52), C.green, C.greenGlow, { p: [0, 0.27, 0] })
  ]),
  // Nitro canister, origin at the bottom centre
  nitro: () => merge([
    prim(cyl(0.22, 0.22, 0.8, 8), C.orange, null, { p: [0, 0.4, 0] }),
    prim(cyl(0.23, 0.23, 0.1, 8), C.dark, [0.6, 1.6, 4], { p: [0, 0.55, 0] }),
    prim(cyl(0.08, 0.1, 0.18, 6), C.steel, null, { p: [0, 0.89, 0] })
  ]),
  // Vacuum (pull every gene core): horseshoe magnet, origin at the bottom centre
  vacuum: () => {
    const parts = [];
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * (i / 6);
      parts.push(prim(box(0.18, 0.18, 0.2), C.red, null, { p: [Math.cos(a) * 0.3, 0.55 + Math.sin(a) * 0.3, 0], r: [0, 0, a] }));
    }
    parts.push(prim(box(0.2, 0.36, 0.2), C.red, null, { p: [0.3, 0.33, 0] }));
    parts.push(prim(box(0.2, 0.36, 0.2), C.red, null, { p: [-0.3, 0.33, 0] }));
    parts.push(prim(box(0.21, 0.14, 0.21), C.white, [1, 2.5, 5], { p: [0.3, 0.1, 0] }));
    parts.push(prim(box(0.21, 0.14, 0.21), C.white, [1, 2.5, 5], { p: [-0.3, 0.1, 0] }));
    return merge(parts);
  },
  // Skyhammer beacon (air strike pickup), origin at the bottom centre
  airstrike: () => merge([
    prim(cyl(0.3, 0.36, 0.25, 8), C.gunmetal, null, { p: [0, 0.12, 0] }),
    prim(cyl(0.1, 0.12, 0.5, 6), C.steel, null, { p: [0, 0.5, 0] }),
    prim(ico(0.16, 0), C.red, C.redGlow, { p: [0, 0.85, 0] })
  ]),

  // Tracer: unit-length bolt along +z (scaled per shot), centred
  tracer: () => merge([prim(box(1, 1, 1), [1, 1, 1], [1, 1, 1])]),
  // Homing missile, nose toward +z, centred
  missile: () => merge([
    prim(cyl(0.07, 0.07, 0.6, 6), C.white, null, { r: [X, 0, 0] }),
    prim(cone(0.07, 0.18, 6), C.red, null, { p: [0, 0, 0.39], r: [X, 0, 0] }),
    ...[0, 1, 2, 3].map((k) => prim(box(0.02, 0.14, 0.14), C.gunmetal, null, { p: [Math.cos(k * X) * 0.08, Math.sin(k * X) * 0.08, -0.24], r: [0, 0, k * X] })),
    prim(cyl(0.05, 0.05, 0.04, 6), C.dark, C.orangeGlow, { p: [0, 0, -0.31], r: [X, 0, 0] })
  ]),
  // Flare mine, origin at the bottom centre
  mine: () => merge([
    prim(cyl(0.35, 0.4, 0.14, 8), C.gunmetal, null, { p: [0, 0.07, 0] }),
    prim(cyl(0.22, 0.26, 0.08, 8), C.yellow, null, { p: [0, 0.17, 0] }),
    prim(cyl(0.07, 0.07, 0.08, 6), C.dark, C.redGlow, { p: [0, 0.24, 0] })
  ]),
  // Hubcap saw blade (spins around y), centred
  saw: () => {
    const parts = [prim(cyl(0.55, 0.55, 0.06, 14), C.steel), prim(cyl(0.2, 0.2, 0.1, 8), C.yellow, null, {})];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      parts.push(prim(cone(0.1, 0.24, 3), C.white, C.orangeGlow, { p: [Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62], r: [0, -a, -X] }));
    }
    return merge(parts);
  },
  // Fossil shard (debris when a dinosaur turns to stone), centred
  shard: () => merge([prim(ico(0.5, 0), C.stone, null, { s: [1, 0.7, 0.8] })]),
  boulder: () => merge([prim(ico(1, 1), C.stoneDark, null, { s: [1, 0.85, 0.9] })]),
  // Abandoned car hulk the T. rex hurls (low poly), origin at its centre
  wreck: () => merge([
    prim(box(1.9, 0.7, 4.4), [0.55, 0.08, 0.06], null, { p: [0, 0.0, 0] }),
    prim(box(1.6, 0.55, 2.0), [0.12, 0.13, 0.15], null, { p: [0, 0.6, -0.2], r: [0.05, 0, 0.04] }),
    ...[-0.85, 0.85].flatMap((x) => [-1.4, 1.4].map((z) => prim(cyl(0.36, 0.36, 0.25, 8), C.dark, null, { p: [x, -0.35, z], r: [0, 0, X] }))),
    prim(box(1.5, 0.12, 0.1), C.dark, C.orangeGlow, { p: [0, 0.05, -2.2] })
  ])
};

function buildPropGeometry(id) {
  const b = BUILDERS[id];
  if (!b) throw new Error(`no placeholder prop "${id}"`);
  return b();
}

export { buildPropGeometry };
