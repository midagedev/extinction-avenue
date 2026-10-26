// Lab script: dimensions of the v2 procedural creature models (for matching the new models' gameplay sizes)
export default async function dims() {
  const { buildDinoModel, DINO_IDS } = await import('/js/game/dino-models.js');
  const out = {};
  for (const id of DINO_IDS) { const m = buildDinoModel(id); out[id] = { length: m.length, height: m.height, width: m.width, radius: m.radius, tris: m.triangles }; }
  return { log: out };
}
