// main.js: Cruz Missile on red dirt under a sun, rendered "before" (plain MeshStandardMaterial) or with the comic look.
// URL params: look=on|off  view=hero|side|thumb|pack  w,h (canvas px)  backend=webgpu|webgl  bench=N (frames to time)
//   dbg=id|shade|normal|depth|edge|halftone|glow (show one channel)  outline=ids  fringe=N  nofxaa  and any look uniform: speed=0.9 grainAmt=0 ...
// region: scene-imports
import * as THREE from 'three/webgpu';
import { texture, color, positionWorld } from 'three/tsl';
import { build, DEFAULT_P } from '/spikes/art-pipeline/J-cruze-lowpoly/model.js';   // Spike J: the Cruz Missile model script
import { makeAtlas } from '/spikes/art-pipeline/J-cruze-lowpoly/atlas.js';          // its code-drawn atlas (white paint when asked)
import { createLook, addDayRig, orbitCamera, tierFor, updateLookCamera, addCarAttributes, paintKey, damageCreep, makeComicMaterial, comicPipeline, aCar, aState } from './look.js';
// endregion

// region: renderer
// setPixelRatio(1) makes the canvas size equal device pixels, so the tile height H given to tierFor() is real pixels.
// shadowMap.enabled is required: without it the sun casts no shadow, so there is nothing for the halftone to key on.
// antialias stays false for the comic chain (it ends in FXAA); forceWebGL: true selects WebGPURenderer's WebGL2 backend.
async function createRenderer(canvas, W, H, { forceWebGL = false, antialias = false } = {}) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias, forceWebGL });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  await renderer.init();
  return renderer;
}
// endregion

// region: views
// Camera and sun azimuths of the captures (degrees, 0 = in front of the car, + toward its right side). Camera minus sun is
// 75-140 degrees, so one flank is lit, the other is in halftone, and the cast shadow lands beside the car.
const VIEWS = {
  hero: { az: 38, el: 11, dist: 10.5, fov: 24, at: [0, 0.75, 0], sunAz: -42 },
  side: { az: 90, el: 9, dist: 13.5, fov: 22, at: [0, 0.8, 0], sunAz: -50 },
  thumb: { az: 38, el: 11, dist: 8.8, fov: 24, at: [0, 0.75, 0], sunAz: -42 },
  pack: { az: 30, el: 22, dist: 20, fov: 28, at: [0, 0.6, 2.2], sunAz: -45 },
};
// endregion

// region: wiring
const RED_EARTH = '#C8622E';                                      // art/ui/tokens.json palette.red-earth
// One InstancedMesh per part type. build() returns one Mesh per part (name = part id, userData.rest = its offset from the
// origin). Every part is its own type except the four wheels, which share one geometry (left wheels are mirrored by a Y rotation).
function groupParts(template) {
  const groups = {};
  for (const [name, mesh] of Object.entries(template.parts)) (groups[name.startsWith('wheel') ? 'wheel' : name] ??= []).push(mesh);
  return groups;
}
// cars: any number of { x, z, yaw, paint: '#hex', damage?, dust? }. One material for all of them; per-car paint, id and damage
// ride instanced attributes. The ground must receiveShadow, or it shows neither the cast shadow nor the halftone.
function addComicWorld(scene, look, P, cars) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), makeComicMaterial(look, { colorNode: color(RED_EARTH), grit: { space: positionWorld, cell: 28, patchFreq: 0.35 } }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const atlas = makeAtlas({ paint: '#ffffff' });                  // paint key: pure white paint texels take the per-car colour
  const texel = texture(atlas.map).rgb;
  const carMaterial = makeComicMaterial(look, {
    colorNode: damageCreep(paintKey(texel), texel),
    emissiveNode: texture(atlas.emissiveMap).rgb.mul(1.6),
    dynamicId: aCar.w,
    grit: { dust: aState.y },
  });
  const m4 = new THREE.Matrix4(), carM = new THREE.Matrix4(), off = new THREE.Matrix4();
  for (const [key, meshes] of Object.entries(groupParts(build(P, 0)))) {
    const geo = meshes[0].geometry.clone();                       // correct for every group: a part type has exactly one geometry
    const im = new THREE.InstancedMesh(geo, carMaterial, cars.length * meshes.length);
    const perInstance = []; let k = 0;
    cars.forEach((car, i) => {
      carM.makeRotationY(car.yaw).setPosition(car.x, 0, car.z);
      for (const pm of meshes) {
        off.makeTranslation(...pm.userData.rest);
        if (key === 'wheel' && pm.name.endsWith('L')) off.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
        im.setMatrixAt(k++, m4.multiplyMatrices(carM, off));
        perInstance.push({ paint: car.paint, id: i + 1, damage: car.damage, dust: car.dust });   // id: any integer, no cap
      }
    });
    addCarAttributes(geo, perInstance);
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im);
  }
}
// endregion

// region: frame
// H = tile height in device pixels. `extra` forwards comicPipeline options. Call the returned function every frame instead of
// renderer.render(scene, camera); set look.speed.value (0..1) from the car's speed first if the speed lines should show.
function createDraw(renderer, scene, camera, look, H, extra = {}) {
  const tier = tierFor(H);                                        // the tile's pixel height picks the effects; unused ones leave the graph
  const { post } = comicPipeline(renderer, scene, camera, look, { bloom: tier.bloom > 0, halftone: tier.halftone > 0, speedLines: tier.speed > 0, ...extra });
  return () => post.render();
}
// endregion

// ---- this page: query params, the "before" scene, capture plumbing ----
const q = new URLSearchParams(location.search);
const on = q.get('look') !== 'off', view = q.get('view') ?? 'hero', W = +(q.get('w') ?? 1600), H = +(q.get('h') ?? 900);
const benchN = +(q.get('bench') ?? 0);
const PAINTS = ['#22c3e6', '#ff4fa3', '#ffd23f', '#7bd389'];     // Cruz cyan + the bench palette
const STATE = { pack: [{}, { damage: 0.35, dust: 0.2 }, { damage: 0.9 }, { dust: 0.8 }] }; // pack view: clean, scuffed, wrecked, dusty
const V = VIEWS[view];
const poses = view === 'pack'
  ? [[-3.2, -1.5, 0.2], [3.2, -1.5, -0.15], [-3.2, 5.0, 0.1], [3.2, 5.0, -0.2]].map(([x, z, yaw]) => ({ x, z, yaw }))
  : [{ x: 0, z: 0, yaw: 0 }];
const CARS = poses.map((p, i) => ({ ...p, paint: PAINTS[i % PAINTS.length], ...STATE[view]?.[i] }));

let P = DEFAULT_P;
try { P = await (await fetch('/spikes/art-pipeline/J-cruze-lowpoly/params.json', { cache: 'no-store' })).json(); } catch { /* defaults */ }

const canvas = document.getElementById('c');
const renderer = await createRenderer(canvas, W, H, { forceWebGL: q.get('backend') === 'webgl', antialias: !on });
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
const backendName = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (WebGPURenderer fallback backend)';

const scene = new THREE.Scene();
addDayRig(scene, on ? { sunAz: V.sunAz } : { sunAz: V.sunAz, sunIntensity: 2.4, hemiIntensity: 1.1 }); // plain PBR needs its own balance
const look = createLook(tierFor(H));

function addPlainWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: RED_EARTH, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const atlas = makeAtlas({});                                   // cyan Cruz livery baked into the atlas
  const mat = new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, flatShading: true, roughness: 0.55, metalness: 0.05 });
  const template = build(P, 0);
  for (const c of CARS) {
    const g = template.group.clone(); g.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(c.x, 0, c.z); g.rotation.y = c.yaw; scene.add(g);
  }
}
if (on) addComicWorld(scene, look, P, CARS); else addPlainWorld();

const camera = new THREE.PerspectiveCamera(V.fov, W / H, 0.5, 220);
orbitCamera(camera, V);
updateLookCamera(look, camera);
for (const k of ['halftone', 'bloomOn', 'grit', 'inkPx', 'speed', 'fringe', 'warm', 'vignette', 'grainAmt']) if (q.has(k)) look[k].value = +q.get(k); // tuning overrides, e.g. &speed=0.9

const draw = on
  ? createDraw(renderer, scene, camera, look, H, { outline: q.get('outline') === 'ids' ? 'ids' : true, fringe: q.has('fringe'), debug: q.get('dbg'), fxaa: !q.has('nofxaa') })
  : () => renderer.render(scene, camera);

for (let i = 0; i < 6; i++) { draw(); await new Promise((r) => requestAnimationFrame(r)); }   // pipelines compile asynchronously

let bench = null;
if (benchN > 0) {
  // Two numbers, both headless Chromium on the Mac (not a perf receipt; G-PERF owns that):
  //  pipelined = submit N frames back to back, wait for the GPU once (throughput bound)
  //  serial    = wait for the GPU after every frame (adds one queue round trip per frame, so it is an upper bound)
  const px1 = new Uint8Array(4);                                     // WebGL: gl.finish() does not block in Chromium, a 1 px readPixels does
  const sync = () => { if (renderer.backend.device) return renderer.backend.device.queue.onSubmittedWorkDone(); const gl = renderer.backend.gl; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); return Promise.resolve(); };
  await sync();
  let t0 = performance.now();
  for (let i = 0; i < benchN; i++) draw();
  await sync();
  const pipelined = (performance.now() - t0) / benchN;
  t0 = performance.now();
  for (let i = 0; i < benchN; i++) { draw(); await sync(); }
  const serial = (performance.now() - t0) / benchN;
  bench = { frames: benchN, pipelinedMsPerFrame: +pipelined.toFixed(2), serialMsPerFrame: +serial.toFixed(2) };
}
window.__look = { backend: backendName, view, on, W, H, tier: tierFor(H).name, bench };
document.title = 'READY';
