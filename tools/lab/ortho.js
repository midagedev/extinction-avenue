// Lab script: orthographic side / front / top views of the sculpt with a labelled metre grid (for placing joints).
// args: { rot: [x, y, z] euler (deg) applied to the raw sculpt, zoom: { name: [cx, cy, halfHeight] } }
import { loadSculpt, loadTextures } from './sculpt.js';

export default async function ortho(lab, args) {
  const { THREE } = lab;
  const { g } = await loadSculpt(lab);
  const tex = await loadTextures(lab);
  const r = (args.rot || [0, 0, 0]).map((d) => THREE.MathUtils.degToRad(d));
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2])));
  g.computeBoundingBox();
  const bb = g.boundingBox;
  // feet on the ground, centred on x
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, 0);
  g.computeBoundingBox();
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughness: 0.6 });
  lab.clear();
  const mesh = new THREE.Mesh(g, mat);
  lab.stage.add(mesh);
  lab.grid.visible = false;
  const box = g.boundingBox;
  // grid lines every 0.25 m (thicker every metre) drawn as line segments in each view plane
  const lines = (plane) => {
    const pts = [], strong = [];
    const ext = 12;
    for (let i = -ext * 4; i <= ext * 4; i++) {
      const v = i / 4, arr = i % 4 === 0 ? strong : pts;
      if (plane === 'side') { arr.push(0, v, -ext, 0, v, ext, 0, -ext, v, 0, ext, v); }
      if (plane === 'front') { arr.push(-ext, v, 0, ext, v, 0, v, -ext, 0, v, ext, 0); }
      if (plane === 'top') { arr.push(-ext, 0, v, ext, 0, v, v, 0, -ext, v, 0, ext); }
    }
    const grp = new THREE.Group();
    for (const [a, c, o] of [[pts, 0x5a6270, 0.5], [strong, 0xffd23a, 0.9]]) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      grp.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false })));
    }
    grp.renderOrder = 5;
    return grp;
  };
  const W = lab.W, H = lab.H, aspect = W / H;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  const views = { side: [new THREE.Vector3(1, 0, 0)], front: [new THREE.Vector3(0, 0, 1)], top: [new THREE.Vector3(0, 1, 0)] };
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const shots = [];
  const doView = async (name, plane, cx, cy, half) => {
    const gl = lines(plane);
    lab.scene.add(gl);
    const dir = views[plane][0];
    cam.position.copy(dir).multiplyScalar(30);
    cam.up.set(0, plane === 'top' ? 0 : 1, plane === 'top' ? -1 : 0);
    cam.lookAt(0, 0, 0);
    cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half;
    // pan
    const right = new THREE.Vector3().crossVectors(cam.up, dir).negate().normalize();
    cam.position.addScaledVector(right, cx).addScaledVector(cam.up, cy);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const old = lab.camera;
    // metre labels along the left and bottom edges (DOM overlay, captured by the screenshot)
    document.querySelectorAll('.lbl').forEach((e) => e.remove());
    const hAxis = plane === 'front' ? 'x' : 'z', vAxis = plane === 'top' ? 'z' : 'y';
    const toScreen = (p) => { const v = p.clone().project(cam); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
    for (let m = -12; m <= 12; m++) {
      for (const ax of [hAxis, vAxis]) {
        const p = new THREE.Vector3(); p[ax] = m;
        const [sx, sy] = toScreen(p);
        if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
        const d = document.createElement('div');
        d.className = 'lbl';
        d.textContent = `${ax}${m}`;
        d.style.cssText = `position:fixed;font:bold 13px monospace;color:#7cf;background:#000a;padding:0 2px;left:${ax === hAxis ? sx + 2 : 2}px;top:${ax === hAxis ? H - 18 : sy - 16}px`;
        document.body.appendChild(d);
      }
    }
    lab.renderer.render(lab.scene, cam);
    await new Promise((r) => requestAnimationFrame(r));
    lab.renderer.render(lab.scene, cam);
    await window.labSnap(name);
    lab.scene.remove(gl);
    shots.push(name);
    void old;
  };
  // side view: looking from +x toward -x, screen right = -z?  (labelled in the log)
  await doView('ortho-side', 'side', c.z, s.y / 2, Math.max(s.y, s.z / aspect) * 0.55);
  await doView('ortho-front', 'front', 0, s.y / 2, s.y * 0.55);
  await doView('ortho-top', 'top', 0, c.z, Math.max(s.z, s.x) * 0.55);
  for (const [name, [plane, cx, cy, half]] of Object.entries(args.zoom || {})) await doView(name, plane, cx, cy, half);
  return { log: { size: s.toArray().map((v) => +v.toFixed(3)), min: box.min.toArray().map((v) => +v.toFixed(3)), max: box.max.toArray().map((v) => +v.toFixed(3)), verts: g.attributes.position.count, tris: g.index.count / 3 } };
}
