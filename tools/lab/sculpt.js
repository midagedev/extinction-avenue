// Shared loader for the damik "dinosaur" sculpt (OpenGameArt, CC0): the Collada mesh as one indexed BufferGeometry in
// game space (metres, +Y up, +Z forward = snout, feet on y = 0, centred on x), plus its colour and normal textures.
const DAE = '/.tools/dl/oga-damik-dinosaur/x/model/dinosaur.dae';
const TEX = '/.tools/dl/oga-damik-dinosaur/x/model/textures/';

export async function loadSculpt(lab) {
  const { THREE } = lab;
  const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js');
  const res = await lab.load(DAE);
  res.scene.updateMatrixWorld(true);
  let mesh = null;
  res.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  let g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  g = mergeVertices(g, 1e-5);
  // Orientation: find the long axis and which end is the head (the head end is higher than the tail tip)
  g.computeBoundingBox();
  const bb = g.boundingBox, size = bb.getSize(new THREE.Vector3());
  const info = { rawMin: bb.min.toArray(), rawMax: bb.max.toArray(), rawSize: size.toArray() };
  return { g, info, mesh, THREE };
}

export async function loadTextures(lab) {
  const { THREE } = lab;
  const tl = new THREE.TextureLoader();
  const [map, normalMap] = await Promise.all([tl.loadAsync(TEX + 'creature_color_bake.png'), tl.loadAsync(TEX + 'creature_normal.png')]);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap };
}
