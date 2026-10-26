// Lab script: renders skinned species through the game's runtime (skin-model.js + skin-rig.js + creature-clips.js).
// args: { ids: ['raptor', ...], clip: 'run', t: 0.2, yaw, pitch, dist, target, name, spacing, shots: [{ clip, t, name, yaw, pitch, dist, target }] }
export default async function species(lab, args) {
  const { THREE } = lab;
  const { ASSET_MANIFEST } = await import('/js/game/assets.js');
  const { loadSkinnedModel } = await import('/js/game/skin-model.js');
  const { SkinnedCrowd } = await import('/js/game/skin-rig.js');
  const { CLIP_LIBRARY } = await import('/js/game/creature-clips.js');
  lab.clear();
  lab.grid.visible = args.grid !== false;
  const crowds = [];
  const log = {};
  let x = 0;
  for (const id of args.ids) {
    const def = structuredCloneDef(ASSET_MANIFEST[id]);
    const m = await loadSkinnedModel(id, def, CLIP_LIBRARY);
    const c = new SkinnedCrowd(m, 4);
    lab.stage.add(c.group);
    crowds.push({ id, c, m, x });
    log[id] = { height: m.height, length: m.length, width: m.width, radius: +m.radius.toFixed(2), baseScale: +m.baseScale.toFixed(3), clips: m.clips.map((k) => `${k.name}:${k.frames}${k.speed ? '@' + k.speed.toFixed(1) : ''}`).join(' '), tris: m.triangles };
    x += (args.spacing ?? Math.max(1.5, m.length * 0.5));
  }
  const shots = args.shots || [{ clip: args.clip || 'idle', t: args.t || 0, name: args.name || 'species', yaw: args.yaw, pitch: args.pitch, dist: args.dist, target: args.target }];
  for (const s of shots) {
    for (const { c, m, x } of crowds) {
      c.begin();
      const a = m.clipIndex.get(s.clip) ?? 0;
      c.add(x, 0, 0, s.heading ?? 0, 1, { a, ta: s.t || 0, w: 0, wc: 0, jaw: s.jaw || 0, lookYaw: s.lookYaw || 0, lookPitch: s.lookPitch || 0 });
      c.end();
    }
    // frame on a box around all creatures
    lab.stage.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const { m, x } of crowds) box.union(new THREE.Box3(new THREE.Vector3(x - m.width / 2, 0, -m.length / 2), new THREE.Vector3(x + m.width / 2, m.height, m.length / 2)));
    const ctr = s.target ? new THREE.Vector3(...s.target) : box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() * 0.5;
    const yaw = THREE.MathUtils.degToRad(s.yaw ?? 40), pitch = THREE.MathUtils.degToRad(s.pitch ?? 10);
    const d = (r / Math.sin(THREE.MathUtils.degToRad(35) / 2)) * (s.dist ?? 0.8);
    lab.camera.fov = 35; lab.camera.updateProjectionMatrix();
    lab.camera.position.set(ctr.x + Math.sin(yaw) * Math.cos(pitch) * d, ctr.y + Math.sin(pitch) * d, ctr.z + Math.cos(yaw) * Math.cos(pitch) * d);
    lab.camera.lookAt(ctr);
    await lab.snap(s.name);
  }
  return { log };
}

// The manifest's skin defs are shared objects (textures cached on them); a shallow copy is enough for the lab
function structuredCloneDef(d) {
  const out = { ...d, url: '/' + d.url, skin: { ...d.skin } };
  if (d.skin.textures) out.skin.textures = Object.fromEntries(Object.entries(d.skin.textures).filter(([k]) => !k.endsWith('Tex')).map(([k, v]) => [k, '/' + v]));
  return out;
}
