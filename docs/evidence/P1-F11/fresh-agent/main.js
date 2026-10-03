// Fresh-agent page: Cruz Missile on red dirt under a sun, with the jammers-look TSL recipes (look.js is generated verbatim from recipes.md).
import * as THREE from 'three/webgpu';
import { color, texture, positionWorld } from 'three/tsl';
import { build, DEFAULT_P } from '/spikes/art-pipeline/J-cruze-lowpoly/model.js';
import { makeAtlas } from '/spikes/art-pipeline/J-cruze-lowpoly/atlas.js';
import {
  tierFor, createLook, updateLookCamera, addDayRig, addCarAttributes, aCar, aState, paintKey, damageCreep,
  makeComicMaterial, comicPipeline,
} from './look.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'hero';
const W = 1280, H = 720;
const RED_EARTH = '#C8622E';                                   // art/ui/tokens.json world red-earth (named in SKILL.md)
const PAINTS = ['#22c3e6'];                                    // Spike J atlas default paint (cyan)
const STATE = {};
const nCars = 1;
const poses = [{ x: 0, z: 0, yaw: 0 }];

const canvas = document.getElementById('c');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL: q.has('webgl') });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;                              // not mentioned in the skill; shadows are off without it
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : renderer.backend.isWebGLBackend ? 'webgl2 (WebGPURenderer fallback)' : 'unknown';

const scene = new THREE.Scene();
const sun = addDayRig(scene, { sunAz: +(q.get('sunAz') ?? -42) });
if (q.has('sunY')) sun.position.y = +q.get('sunY');

const camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 200);
const VIEWS = {
  hero: { pos: [5.4, 2.3, 6.3], at: [0, 0.7, -0.2], fov: 28 },
  side: { pos: [12, 3.0, 0.2], at: [0, 0.7, 0], fov: 24 },
};
const V = VIEWS[view];
if (q.has('cam')) V.pos = q.get('cam').split(',').map(Number);
if (q.has('at')) V.at = q.get('at').split(',').map(Number);
if (q.has('fov')) V.fov = +q.get('fov');
camera.fov = V.fov; camera.position.set(...V.pos); camera.lookAt(...V.at); camera.updateProjectionMatrix();

const look = createLook(tierFor(H));
updateLookCamera(look, camera);
for (const k of ['halftone', 'grit', 'cell', 'inkPx', 'outline']) if (q.has(k)) look[k].value = +q.get(k);

// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial());
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// car: Spike J model, one InstancedMesh per part type (wheels share one geometry, mirrored by rotation)
const { group: carGroup } = build(DEFAULT_P, 0);
const groups = {};
for (const m of carGroup.children) (groups[m.name.startsWith('wheel') ? 'wheel' : m.name] ??= []).push(m);

// region: wiring (adapted from recipes.md main.js#wiring: groups/poses/PAINTS are mine; see NOTES.md)
function addComicCars() {
  const atlas = makeAtlas({ paint: '#ffffff' });                 // paint key: pure white paint texels take the per-car colour
  const carTexel = texture(atlas.map).rgb;
  const mat = makeComicMaterial(look, {
    colorNode: damageCreep(paintKey(carTexel), carTexel),
    emissiveNode: texture(atlas.emissiveMap).rgb.mul(1.6),
    dynamicId: aCar.w,
    grit: { dust: aState.y },
  });
  const m4 = new THREE.Matrix4(), carM = new THREE.Matrix4(), off = new THREE.Matrix4();
  for (const [key, meshes] of Object.entries(groups)) {
    const geo = meshes[0].geometry.clone();
    const im = new THREE.InstancedMesh(geo, mat, nCars * meshes.length);
    const cars = []; let k = 0;
    for (let i = 0; i < nCars; i++) {
      carM.makeRotationY(poses[i].yaw).setPosition(poses[i].x, 0, poses[i].z);
      for (const pm of meshes) {
        off.makeTranslation(...pm.userData.rest);
        if (key === 'wheel' && pm.name.endsWith('L')) off.multiply(new THREE.Matrix4().makeRotationY(Math.PI)); // mirror by rotation
        im.setMatrixAt(k++, m4.multiplyMatrices(carM, off));
        cars.push({ paint: PAINTS[i % PAINTS.length], id: i + 1, ...STATE[view]?.[i] });
      }
    }
    addCarAttributes(geo, cars);
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im);
  }
  ground.material = makeComicMaterial(look, { colorNode: color(RED_EARTH), grit: { space: positionWorld, cell: 28, patchFreq: 0.35 } });
}
addComicCars();

// region: frame (verbatim from recipes.md main.js#frame)
let draw;
const tier = tierFor(H);                                        // the tile's pixel height picks the effects; unused ones leave the graph
const { post } = comicPipeline(renderer, scene, camera, look, {
  bloom: tier.bloom > 0, halftone: tier.halftone > 0, speedLines: tier.speed > 0,
  outline: q.get('outline') === 'ids' ? 'ids' : true, fringe: q.has('fringe'), debug: q.get('dbg'), fxaa: !q.has('nofxaa'),   // outline/fringe/debug/fxaa: capture switches
});
draw = () => post.render();                                     // instead of renderer.render(scene, camera)

window.__info = { backend, view, tier: tier.name, inkPx: look.inkPx.value, cell: look.cell.value };
window.__frames = 0;
const errors = []; window.__errors = errors;
const loop = async () => { try { draw(); } catch (e) { errors.push(String(e)); } window.__frames++; requestAnimationFrame(loop); };
requestAnimationFrame(loop);
