// main-glsl.js: the Cruz Missile test scene on a plain WebGLRenderer with the GLSL route (glsl.js).
// URL params: view=hero|side|thumb|pack  w,h  bench=N  speed=0..1  grainAmt  (same views and rig as main.js)
import * as THREE from 'three';
import { build, DEFAULT_P } from '/spikes/art-pipeline/J-cruze-lowpoly/model.js';
import { makeAtlas } from '/spikes/art-pipeline/J-cruze-lowpoly/atlas.js';
import { createLook, makeRamp, makeToonMaterial, createPipeline, INK_PX } from './glsl.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'hero', W = +(q.get('w') ?? 1600), H = +(q.get('h') ?? 900), benchN = +(q.get('bench') ?? 0);
const PAINTS = ['#22c3e6', '#ff4fa3', '#ffd23f', '#7bd389'];
const VIEWS = {
  hero: { az: 38, el: 11, dist: 10.5, fov: 24, at: [0, 0.75, 0], sunAz: -42 },
  side: { az: 90, el: 9, dist: 13.5, fov: 22, at: [0, 0.8, 0], sunAz: -50 },
  thumb: { az: 38, el: 11, dist: 8.8, fov: 24, at: [0, 0.75, 0], sunAz: -42 },
  pack: { az: 30, el: 22, dist: 20, fov: 28, at: [0, 0.6, 2.2], sunAz: -45 },
}[view];

let P = DEFAULT_P;
try { P = await (await fetch('/spikes/art-pipeline/J-cruze-lowpoly/params.json', { cache: 'no-store' })).json(); } catch { /* defaults */ }

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;

// same day rig as look.js 'rig'
const scene = new THREE.Scene(), haze = '#F4DDB0';
scene.background = new THREE.Color(haze); scene.fog = new THREE.Fog(haze, 45, 190);
scene.add(new THREE.HemisphereLight('#D8E2FF', '#B07A66', 1.5));
const sun = new THREE.DirectionalLight('#FFF1D6', 2.1), sa = THREE.MathUtils.degToRad(VIEWS.sunAz);
sun.position.set(Math.sin(sa) * 9.5, 9, Math.cos(sa) * 9.5); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
scene.add(sun, sun.target);

const look = createLook(INK_PX.tv * (H / 1080)); look.cell.value = H >= 540 ? 8 : H >= 270 ? 6 : 5;
if (H < 270) { look.halftone.value = 0; look.grit.value = 0; look.inkPx.value = H < 110 ? 1 : 1.5; }
const ramp = makeRamp();
const atlas = makeAtlas({ paint: '#ffffff' });                    // white paint texels take the per-car instanceColor

const nCars = view === 'pack' ? 4 : 1;
const poses = view === 'pack' ? [[-3.2, -1.5, 0.2], [3.2, -1.5, -0.15], [-3.2, 5.0, 0.1], [3.2, 5.0, -0.2]].map(([x, z, yaw]) => ({ x, z, yaw })) : [{ x: 0, z: 0, yaw: 0 }];
const template = build(P, 0), groups = {};
for (const [id, mesh] of Object.entries(template.parts)) (groups[id.startsWith('wheel') ? 'wheel' : id] ??= []).push(mesh);

const carMat = makeToonMaterial(look, { map: atlas.map, emissiveMap: atlas.emissiveMap, ramp, paintKey: true });
const carMeshes = [], m4 = new THREE.Matrix4(), carM = new THREE.Matrix4(), off = new THREE.Matrix4(), col = new THREE.Color();
for (const [key, meshes] of Object.entries(groups)) {
  const geo = meshes[0].geometry.clone(), n = nCars * meshes.length, ids = new Float32Array(n);
  const im = new THREE.InstancedMesh(geo, carMat, n);
  let k = 0;
  for (let i = 0; i < nCars; i++) {
    carM.makeRotationY(poses[i].yaw).setPosition(poses[i].x, 0, poses[i].z);
    for (const pm of meshes) {
      off.makeTranslation(...pm.userData.rest);
      if (key === 'wheel' && pm.name.endsWith('L')) off.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      im.setMatrixAt(k, m4.multiplyMatrices(carM, off)); im.setColorAt(k, col.set(PAINTS[i % PAINTS.length])); ids[k++] = i + 1;
    }
  }
  geo.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));
  im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); carMeshes.push(im);
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), makeToonMaterial(look, { color: '#C8622E', ramp, grit: { cell: 28, patchFreq: 0.35, world: true } }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const camera = new THREE.PerspectiveCamera(VIEWS.fov, W / H, 0.5, 220);
{ const a = THREE.MathUtils.degToRad(VIEWS.az), e = THREE.MathUtils.degToRad(VIEWS.el);
  camera.position.set(VIEWS.at[0] + Math.sin(a) * Math.cos(e) * VIEWS.dist, VIEWS.at[1] + Math.sin(e) * VIEWS.dist, VIEWS.at[2] + Math.cos(a) * Math.cos(e) * VIEWS.dist);
  camera.lookAt(...VIEWS.at); camera.updateMatrixWorld(); }

const { render, uniforms } = createPipeline(renderer, scene, camera, look, { groundMeshes: [ground], carMeshes });
for (const [k, u] of [['speed', 'uSpeed'], ['grainAmt', 'uGrain'], ['warm', 'uWarm'], ['vignette', 'uVignette']]) if (q.has(k)) uniforms[u].value = +q.get(k);
for (let i = 0; i < 6; i++) { render(); await new Promise((r) => requestAnimationFrame(r)); }

let bench = null;
if (benchN > 0) {
  const gl = renderer.getContext(), px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  sync(); let t0 = performance.now();
  for (let i = 0; i < benchN; i++) render();
  sync(); const pipelined = (performance.now() - t0) / benchN;
  t0 = performance.now();
  for (let i = 0; i < benchN; i++) { render(); sync(); }
  bench = { frames: benchN, pipelinedMsPerFrame: +pipelined.toFixed(2), serialMsPerFrame: +((performance.now() - t0) / benchN).toFixed(2) };
}
window.__look = { backend: 'WebGL2 (plain WebGLRenderer, GLSL route)', view, on: true, W, H, bench };
document.title = 'READY';
