import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, positionView, metalness, roughness, vec2, vec3, vec4, float, smoothstep, uniform, Fn,
  dot, mix, max, min, pow, length, screenUV, screenSize, sin
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { buildCityGrid } from '../city-grid.js';
import { buildBoroughs } from '../boroughs.js';
import { buildLandmarks } from '../landmarks.js';
import { buildCityBlocks } from '../buildings.js';
import { buildStreetDetails } from '../street-details.js';
import { buildRoadNetwork } from '../road-network.js';
import { buildRoadPaint } from '../road-paint.js';
import { LightingSystem } from '../lighting.js';
import { setupSceneCulling, updateSceneCulling, sceneCullingList } from '../scene-culling.js';
import { LOWMEM, loopReach, setCityReach } from '../device-profile.js';
import { CityStream } from './city-stream.js';
import { Route } from './route.js';

// js/game/world.js
// The stage: the renderer, slop-newyork's Manhattan (grid, blocks, landmarks, street furniture, road paint; no ambient
// traffic or pedestrians — the city has been evacuated), the lighting rig, and the game's post-processing chain:
// optional SSR (High quality), HDR bloom tuned for the neon-emissive art direction, color grade, vignette, and the
// gameplay-driven effects (hurt vignette + chromatic aberration, slow-motion desaturation, white flash).

const QUALITY = {
  // pixel ratio cap, SSR, shadows, bloom resolution, MSAA samples of the scene pass (the canvas itself only receives
  // the post-processing quad, so it never multisamples), sharpen = contrast-adaptive sharpening amount (0 = off)
  high: { pixelRatio: 2.0, ssr: true, shadows: true, bloomScale: 0.5, samples: 4, sharpen: 0 },
  medium: { pixelRatio: 1.25, ssr: false, shadows: true, bloomScale: 0.5, samples: 4, sharpen: 0.25 },
  low: { pixelRatio: 0.75, ssr: false, shadows: false, bloomScale: 0.35, samples: 0, sharpen: 0.3 },
  // Phones / low-memory devices (js/device-profile.js LOWMEM): no SSR targets, a small bloom chain, and cheap sun
  // shadows near the cab only: 1024² cascades over the first ~120 m, no shadow stand-ins. A sharp picture comes first:
  // 2.2× pixel ratio (≈ 54 % of an iPhone's 3× pixels; 1.6× was 28 % and read as blurry) with 2× MSAA on the scene
  // pass and a light sharpening pass. js/game/quality-governor.js gives up shadows and stream reach before resolution
  // when frames run long, and never drops below 1.5×.
  phone: { pixelRatio: 2.2, ssr: false, shadows: true, shadowMap: 1024, shadowFar: 120, bloomScale: 0.35, samples: 2, sharpen: 0.35 }
};

const LOOKS = {
  // Twilight "neon Cretaceous": cool blue hour with saturated emissive accents. Bloom thresholds sit above what lit
  // surfaces reach (sky, sunlit facades, the wet street), so only emissives bloom — tracers, muzzle flashes,
  // explosions, lamps, creature eyes — instead of a low-resolution haze over the whole frame.
  twilight: { exposure: 1.1, contrast: 1.16, saturation: 1.14, balance: [1.0, 0.99, 1.03], bloom: 0.3, threshold: 1.45 },
  midnight: { exposure: 1.18, contrast: 1.14, saturation: 1.14, balance: [0.98, 1.0, 1.04], bloom: 0.34, threshold: 1.3 },
  golden: { exposure: 1.04, contrast: 1.14, saturation: 1.12, balance: [1.04, 1.0, 0.96], bloom: 0.28, threshold: 1.6 }
};

function createGamePost(renderer, sceneColor, reflections, quality) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const u = {
    exposure: uniform(1.0),
    contrast: uniform(1.0),
    saturation: uniform(1.0),
    balance: uniform(new THREE.Vector3(1, 1, 1)),
    hurt: uniform(0), // red edge vignette + chromatic aberration (0..1)
    aberration: uniform(0), // extra CA from big impacts
    desat: uniform(0), // slow-motion / pause wash (0..1)
    flash: uniform(0), // white flash (boss death, airstrike)
    time: uniform(0),
    danger: uniform(0) // boss red pulse at the edges
  };

  // Chromatic aberration only as a damage pulse (u.aberration is kicked by each hit the cab takes and decays): R and
  // B sampled with a radial offset (sceneColor is the pass texture node). Zero offset = a plain, sharp frame.
  const centered = screenUV.sub(0.5);
  const off = centered.mul(u.aberration.mul(0.012));
  let base = vec3(sceneColor.sample(screenUV.add(off)).r, sceneColor.g, sceneColor.sample(screenUV.sub(off)).b);
  if (quality.sharpen > 0) {
    // Contrast-adaptive sharpening (after AMD FidelityFX CAS): the 4 neighbours' local contrast sets a negative-lobe
    // weight, so edges blurred by the browser's upscale of a sub-native canvas get crisp without ringing on flat areas
    const texel = vec2(1).div(screenSize);
    const n = sceneColor.sample(screenUV.add(vec2(0, texel.y))).rgb, s = sceneColor.sample(screenUV.sub(vec2(0, texel.y))).rgb;
    const e = sceneColor.sample(screenUV.add(vec2(texel.x, 0))).rgb, w = sceneColor.sample(screenUV.sub(vec2(texel.x, 0))).rgb;
    const c = sceneColor.rgb;
    // weights from a tone-compressed copy (HDR highlights would otherwise saturate them)
    const tc = (v) => v.div(v.add(1));
    const mn = min(min(min(tc(n), tc(s)), min(tc(e), tc(w))), tc(c));
    const mx = max(max(max(tc(n), tc(s)), max(tc(e), tc(w))), tc(c));
    const amp = min(mn, vec3(1).sub(mx)).div(max(mx, 1e-4)).clamp(0, 1).sqrt();
    const wgt = amp.mul(float(-1).div(mix(8.0, 5.0, quality.sharpen)));
    const sharp = c.add(n.add(s).add(e).add(w).mul(wgt)).div(wgt.mul(4).add(1));
    base = max(base.add(sharp.sub(c)), vec3(0));
  }
  const scene = reflections ? base.add(reflections.rgb) : base;
  const exposed = max(scene, vec3(0)).mul(u.exposure).mul(u.balance);
  const peak = max(max(exposed.r, exposed.g), exposed.b);
  const bloomInput = vec4(exposed.mul(float(10.0).div(max(peak, 10.0))), 1.0);
  const bloomPass = bloom(bloomInput, 0.3, 0.1, 1.45); // small radius: tight halos around emissives, no full-frame haze
  bloomPass.smoothWidth.value = 0.35;
  bloomPass.setResolutionScale(quality.bloomScale);

  const outputNode = Fn(() => {
    const color = exposed.add(bloomPass.rgb).toVar();
    const luma = dot(color, vec3(0.2126, 0.7152, 0.0722)).toVar();
    // Teal shadows / warm highlights split tone (light: the street's darks stay neutral enough to separate creatures)
    const shadows = mix(vec3(0.975, 1.0, 1.035), vec3(1), smoothstep(0.02, 0.5, luma));
    const highlights = mix(vec3(1), vec3(1.03, 1.0, 0.965), smoothstep(0.6, 3.0, luma));
    color.mulAssign(shadows.mul(highlights));
    color.mulAssign(pow(max(luma, 0.0001).div(0.18), u.contrast.sub(1.0)));
    const gray = dot(color, vec3(0.2126, 0.7152, 0.0722));
    const sat = u.saturation.mul(float(1).sub(u.desat.mul(0.75)));
    color.assign(max(mix(vec3(gray), color, sat), vec3(0)));

    const aspect = screenSize.x.div(screenSize.y);
    const radius = length(screenUV.sub(0.5).mul(vec2(aspect, 1))).div(length(vec2(aspect, 1).mul(0.5)));
    const vignette = float(1).sub(smoothstep(0.45, 1.05, radius).mul(float(0.14).add(u.desat.mul(0.3))));
    color.mulAssign(vignette);
    // Hurt / danger edge glow
    const edge = smoothstep(0.45, 1.05, radius);
    const pulse = sin(u.time.mul(6.0)).mul(0.5).add(0.5);
    const red = edge.mul(u.hurt.mul(0.9).add(u.danger.mul(pulse).mul(0.35)));
    color.assign(mix(color, vec3(0.9, 0.02, 0.01), min(red, 0.85)));
    color.addAssign(vec3(u.flash.mul(3.0)));
    return vec4(color, 1.0);
  })();

  function applyLook(id) {
    const look = LOOKS[id] || LOOKS.twilight;
    u.exposure.value = look.exposure;
    u.contrast.value = look.contrast;
    u.saturation.value = look.saturation;
    u.balance.value.set(...look.balance);
    bloomPass.strength.value = look.bloom;
    bloomPass.threshold.value = look.threshold;
  }
  applyLook('twilight');
  return { outputNode, applyLook, uniforms: u, bloomPass };
}

/**
 * Builds the renderer + city. onStatus(text, progress 0..1|null) drives the loading screen.
 * Returns { renderer, scene, lighting, city, post, renderPipeline, compile(camera), update(camera, elapsed), render() }
 */
async function createWorld(container, camera, { quality: qualityId = 'high', forceWebGL = false, onStatus = () => {} } = {}) {
  const quality = { ...(QUALITY[qualityId] || QUALITY.high) };
  const shadowParam = new URLSearchParams(location.search).get('shadows'); // ?shadows=0|1 overrides the preset
  if (shadowParam === '0' || shadowParam === '1') quality.shadows = shadowParam === '1';
  // No MSAA on the canvas: it only receives the post-processing quad. The scene pass multisamples (quality.samples).
  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    powerPreference: 'high-performance',
    reversedDepthBuffer: true,
    forceWebGL
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = quality.shadows;
  quality.id = qualityId in QUALITY ? qualityId : 'high';
  renderer.lighting = new ClusteredLighting(256, 32, 28, 48);
  container.appendChild(renderer.domElement);
  onStatus('Starting the renderer…', null);
  await renderer.init();

  const scene = new THREE.Scene();
  const lighting = new LightingSystem(scene, renderer);
  if (quality.shadowMap) lighting.sunLight.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  if (quality.shadowFar) lighting.shadowFarMax = quality.shadowFar;
  lighting.applyPreset('twilight');

  // Phones: the city streams in cells along the cab's route (js/game/city-stream.js; ?stream=0 turns it off). The
  // builders only emit what some window along the loop can reach (device-profile.js cityKeep / loopReach).
  const streaming = LOWMEM && new URLSearchParams(location.search).get('stream') !== '0' && !/sim\.html$/.test(location.pathname);
  const route = new Route();
  const reach = streaming ? loopReach((s, out) => route.sample(s, out), route.length) : null;
  setCityReach(reach);

  onStatus('Rebuilding Manhattan…', null);
  await nextFrame();
  const cityGrid = buildCityGrid(scene);
  const boroughs = buildBoroughs(scene, { sidewalks: cityGrid.sidewalks });
  const { colliders: landmarkColliders } = buildLandmarks(scene);
  onStatus('Raising the skyline…', null);
  await nextFrame();
  const cityBlocks = buildCityBlocks(scene);
  const allColliders = [...landmarkColliders, ...cityBlocks.colliders, ...boroughs.colliders, ...(cityGrid.colliders || [])];
  const streetDetails = buildStreetDetails(scene);
  onStatus('Painting the avenues…', null);
  await nextFrame();
  const network = buildRoadNetwork(cityGrid.sidewalks, [
    ...cityGrid.footprints,
    ...streetDetails.footprints,
    ...allColliders.filter((c) => !c.obb && (c.minY ?? 0) < 3.5)
  ], streetDetails.signalIntersections);
  buildRoadPaint(scene, network);

  const cullingRoots = ['ManhattanCityGrid', 'ManhattanCityBlocks', 'ManhattanStreetDetails', 'ManhattanLandmarks', 'Boroughs']
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean);
  // (no shadow stand-ins without shadows: they are position copies of the big casters)
  // (no stand-ins on phones either: they are position copies of the big casters, and the near cascades are small)
  setupSceneCulling(scene, cullingRoots, quality.shadows && !LOWMEM ? lighting.sunLight.shadow : null);
  // City instanced meshes are static: storage buffers upload once (see js/main.js)
  if (renderer.backend.isWebGPUBackend) {
    scene.traverse((object) => {
      if (object.isInstancedMesh) object.instanceMatrix = new THREE.StorageInstancedBufferAttribute(object.instanceMatrix.array, 16);
    });
  }
  if (!quality.shadows) lighting.sunLight.castShadow = false;
  // Phones: only the cab and the creatures cast, and only the street (asphalt, sidewalks) receives. Every material that
  // casts or receives gets a heavier shader build per pipeline: the whole city doing so cost ~160 MB of JS heap (three's
  // node builds) and ~75 extra programs; this way it costs a few MB.
  else if (LOWMEM) {
    for (const r of cullingRoots) r.traverse((o) => { o.castShadow = false; o.receiveShadow = !!o.material?.userData?.groundSurface; });
  }
  const stream = streaming
    ? new CityStream(['ManhattanCityGrid', 'ManhattanCityBlocks', 'ManhattanStreetDetails', 'RoadMarkings'].map((n) => scene.getObjectByName(n)).filter(Boolean),
      { storageInstances: !!renderer.backend.isWebGPUBackend, culled: sceneCullingList(), reach })
    : null;

  // --- Post-processing --------------------------------------------------------------------------------------------
  // (WebGPU only allows 1 or 4 samples; 2 is a WebGL2 / phone budget)
  const samples = renderer.backend.isWebGPUBackend && quality.samples > 0 ? 4 : quality.samples;
  const scenePass = pass(scene, camera, { samples });
  scenePass.renderTarget.storeMultisampledColorBuffer = false;
  let reflections = null;
  let sceneMRT = null;
  const scenePassColor = scenePass.getTextureNode('output');
  if (quality.ssr) {
    const { ssr } = await import('three/addons/tsl/display/SSRNode.js');
    const ssrFade = smoothstep(360.0, 180.0, positionView.z.negate());
    const maxSSRRoughness = 0.75;
    sceneMRT = mrt({
      output,
      normal: normalView,
      metalRough: vec2(roughness.lessThan(maxSSRRoughness).select(metalness.mul(ssrFade), 0), roughness)
    });
    sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending));
    sceneMRT.setBlendMode('metalRough', new THREE.BlendMode(THREE.MaterialBlending));
    scenePass.setMRT(sceneMRT);
    const metalRough = scenePass.getTextureNode('metalRough');
    const ssrPass = ssr(scenePassColor, scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), {
      metalnessNode: metalRough.r,
      roughnessNode: metalRough.g,
      camera
    });
    ssrPass.resolutionScale = 0.5;
    ssrPass.blurQuality = 1;
    ssrPass.maxDistance.value = 42;
    ssrPass.thickness.value = 0.85;
    ssrPass.quality.value = 0.25;
    ssrPass.binaryRefine = true;
    ssrPass.intensity.value = 0.55;
    ssrPass.screenEdgeFadeBlack = true;
    const reflectionMask = metalRough.r.greaterThan(0).select(smoothstep(maxSSRRoughness, 0.55, metalRough.g), 0);
    reflections = ssrPass.mul(reflectionMask);
  }
  const post = createGamePost(renderer, scenePassColor, reflections, quality);
  const renderPipeline = new THREE.RenderPipeline(renderer, post.outputNode);

  function update(cam, elapsed) {
    streetDetails.signalClock.value = elapsed;
    if (boroughs.update) boroughs.update(elapsed);
    cityBlocks.update(cam.position.x, cam.position.z);
    if (cityBlocks.updateLights) cityBlocks.updateLights(cam);
    if (streetDetails.update) streetDetails.update(cam);
    lighting.update(cam.position);
    updateSceneCulling(cam.position);
    stream?.updateCulling(cam.position.x, cam.position.y, cam.position.z);
    post.uniforms.time.value = elapsed;
  }

  /** Shader pre-compilation behind the loading screen (see js/main.js precompileShaders for the rationale) */
  async function compile(onProgress) {
    scene.visible = false;
    renderPipeline.render();
    scene.visible = true;
    const culled = [];
    const jobs = [];
    const jobByMaterial = new Map();
    const pipelines = new Set();
    scene.traverseVisible((o) => {
      if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      if (o.userData.shadowProxy) return;
      const pipeline = o.userData.sharesPipelineWith || o;
      if (pipelines.has(pipeline)) return;
      pipelines.add(pipeline);
      if (o.isInstancedMesh || Array.isArray(o.material)) { jobs.push([o]); return; }
      let job = jobByMaterial.get(o.material);
      if (!job) { job = []; jobByMaterial.set(o.material, job); jobs.push(job); }
      job.push(o);
    });
    renderer.setRenderTarget(scenePass.renderTarget);
    renderer.setMRT(sceneMRT);
    const nextTask = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (const object of job) {
          await nextTask();
          try {
            await renderer.compileAsync(object, camera, scene);
          } catch (e) {
            console.warn('[compile]', e);
          }
        }
        done++;
        onProgress?.(done / jobs.length);
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    renderer.setMRT(null);
    renderer.setRenderTarget(null);
    for (const o of culled) o.frustumCulled = true;
  }

  /** One frame with frustum culling off: compiles whatever compile() couldn't reach (shadow passes) */
  function warmup() {
    const culled = [];
    scene.traverseVisible((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    renderPipeline.render();
    for (const o of culled) o.frustumCulled = true;
  }

  /** Phones (js/device-profile.js LOWMEM): once the static city meshes are on the GPU, drop the CPU copies of their
   *  vertex data (three.js keeps them only for re-uploads, and these never change; nothing raycasts the city). Bounds
   *  are computed first, culling needs them. Instanced meshes keep theirs (building props stream through pools).
   *  Called after the warm-up frame and again once the run is under way (chunks that were hidden at the title). */
  function releaseStaticArrays() {
    if (!LOWMEM) return 0;
    let bytes = 0;
    const backend = renderer.backend;
    const release = (a) => {
      if (!a || !a.isBufferAttribute || a.isInterleavedBufferAttribute || a.isStorageBufferAttribute || a.isInstancedBufferAttribute) return;
      if (a.usage !== THREE.StaticDrawUsage || !a.array || a.array.length === 0) return;
      const d = backend.has?.(a) ? backend.get(a) : null;
      if (!d || !(d.bufferGPU || d.buffer)) return; // not uploaded yet
      bytes += a.array.byteLength;
      a.array = new a.array.constructor(0); // count, itemSize and the GPU buffer stay
    };
    for (const name of ['ManhattanCityGrid', 'ManhattanCityBlocks', 'ManhattanStreetDetails', 'ManhattanLandmarks', 'Boroughs']) {
      scene.getObjectByName(name)?.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.streamed) return; // streamed: re-uploads
        const g = o.geometry;
        if (!g.attributes.position?.array?.length) return;
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingBox) g.computeBoundingBox();
        for (const a of Object.values(g.attributes)) release(a);
        release(g.index);
      });
    }
    return bytes;
  }

  function setTimeOfDay(id) {
    lighting.applyPreset(id);
    post.applyLook(id);
  }

  function resize(w, h) {
    renderer.setSize(w, h);
  }

  return {
    renderer, scene, lighting, post, renderPipeline, quality, cityBlocks, streetDetails, stream,
    update, compile, warmup, setTimeOfDay, resize, releaseStaticArrays,
    render: () => renderPipeline.render()
  };
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export { createWorld, QUALITY };
