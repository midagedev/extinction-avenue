// Lab script: dumps bind joints vs geometry bounds for a skinned model (debugging socket positions)
export default async function dbg(lab, args) {
  const { ASSET_MANIFEST } = await import('/js/game/assets.js');
  const { loadSkinnedModel } = await import('/js/game/skin-model.js');
  const { CLIP_LIBRARY } = await import('/js/game/creature-clips.js');
  const d = ASSET_MANIFEST[args.id];
  const m = await loadSkinnedModel(args.id, { ...d, url: '/' + d.url, skin: { ...d.skin } }, CLIP_LIBRARY);
  const g = m.geometries[0];
  g.computeBoundingBox();
  const out = { box: [g.boundingBox.min.toArray().map((v) => +v.toFixed(2)), g.boundingBox.max.toArray().map((v) => +v.toFixed(2))], joints: {} };
  const b = m.bones;
  for (const n of args.bones || b.names) { const i = b.index.get(n); out.joints[n] = { bind: [0, 1, 2].map((k) => +b.bind[i * 3 + k].toFixed(2)), rest: [0, 1, 2].map((k) => +b.rest[i * 3 + k].toFixed(2)) }; }
  const c = m.clips[m.clipIndex.get('idle')];
  const hi = b.index.get('Head');
  if (c && hi !== undefined) out.headM = Array.from(c.data.slice(hi * 12, hi * 12 + 12)).map((v) => +v.toFixed(3));
  const gl = await lab.load('/' + d.url);
  const meshes = [];
  gl.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  out.bindMatrix = meshes[0].bindMatrix.elements.map((v) => +v.toFixed(3));
  out.headWorld = meshes[0].skeleton.bones.find((x) => x.name === 'Head').getWorldPosition(new lab.THREE.Vector3()).toArray().map((v) => +v.toFixed(2));
  return { log: out };
}
