// Lab script: render models. args: { items: [{ url, clip?, t?, x?, scale?, smooth? }], yaw, pitch, dist, name }
export default async function view(lab, args) {
  const { THREE } = lab;
  lab.clear();
  const log = [];
  for (const it of args.items) {
    const res = await lab.load(it.url);
    const root = (res.scene || res.scene).clone ? (await import('three/addons/utils/SkeletonUtils.js')).clone(res.scene) : res.scene;
    root.position.x = it.x || 0;
    root.scale.setScalar(it.scale || 1);
    if (it.rotY) root.rotation.y = it.rotY;
    if (it.rotX) root.rotation.x = it.rotX;
    lab.stage.add(root);
    if (res.animations?.length && it.clip) {
      const mixer = new THREE.AnimationMixer(root);
      const clip = res.animations.find((c) => c.name.includes(it.clip)) || res.animations[0];
      const a = mixer.clipAction(clip);
      a.play();
      mixer.setTime(it.t || 0);
    }
    root.traverse((o) => {
      if (o.isMesh && it.smooth) {
        o.material = Array.isArray(o.material) ? o.material.map((m) => { m = m.clone(); m.flatShading = false; return m; }) : o.material;
      }
    });
    log.push({ url: it.url, anims: (res.animations || []).map((c) => c.name) });
  }
  const f = lab.frame({ yaw: args.yaw ?? 35, pitch: args.pitch ?? 12, dist: args.dist ?? 1 });
  await lab.snap(args.name || 'view');
  return { log: { log, f } };
}
