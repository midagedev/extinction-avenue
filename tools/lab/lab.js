// Model lab: a bare three.js page for inspecting, rigging and exporting creature models headlessly
// (driven by tools/model-lab.mjs through window.lab). WebGL2 backend so it renders under SwiftShader.
import * as THREE from 'three/webgpu';

const W = +(new URLSearchParams(location.search).get('w') || 960);
const H = +(new URLSearchParams(location.search).get('h') || 640);
const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: true });
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x30343c);
const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 500);
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x40362c, 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
sun.position.set(5, 9, 6);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x8fb8ff, 1.6);
rim.position.set(-6, 4, -8);
scene.add(rim);
const grid = new THREE.GridHelper(40, 40, 0x666666, 0x444444);
scene.add(grid);
const stage = new THREE.Group();
scene.add(stage);

const cache = new Map();
async function load(url) {
  if (cache.has(url)) return cache.get(url);
  let p;
  if (url.endsWith('.dae')) {
    p = import('three/addons/loaders/ColladaLoader.js').then((m) => new m.ColladaLoader().loadAsync(url));
  } else {
    p = import('three/addons/loaders/GLTFLoader.js').then((m) => new m.GLTFLoader().loadAsync(url));
  }
  cache.set(url, p);
  return p;
}

function clear() {
  while (stage.children.length) stage.remove(stage.children[0]);
}

/** Frame the camera on the stage: yaw/pitch in degrees around the bounding-box centre */
function frame({ yaw = 35, pitch = 12, dist = 1.0, target = null, fov = 35 } = {}) {
  stage.updateMatrixWorld(true);
  const box = new THREE.Box3();
  stage.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) { o.computeBoundingBox?.(); }
    const b = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
    box.union(b.clone().applyMatrix4(o.matrixWorld));
  });
  const c = target ? new THREE.Vector3(...target) : box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() * 0.5;
  camera.fov = fov;
  camera.updateProjectionMatrix();
  const d = (r / Math.sin(THREE.MathUtils.degToRad(fov) / 2)) * dist;
  const y = THREE.MathUtils.degToRad(yaw), x = THREE.MathUtils.degToRad(pitch);
  camera.position.set(c.x + Math.sin(y) * Math.cos(x) * d, c.y + Math.sin(x) * d, c.z + Math.cos(y) * Math.cos(x) * d);
  camera.lookAt(c);
  grid.position.y = 0;
  return { center: c.toArray(), radius: r, box: [box.min.toArray(), box.max.toArray()] };
}

async function render() {
  renderer.render(scene, camera);
  await new Promise((r) => requestAnimationFrame(r));
}

window.lab = { THREE, renderer, scene, camera, stage, grid, sun, hemi, rim, load, clear, frame, render, W, H };
window.labReady = true;
