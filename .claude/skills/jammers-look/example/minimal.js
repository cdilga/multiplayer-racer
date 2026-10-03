// minimal.js: the recipes on ordinary meshes (no car, no atlas, no instancing): the shape W02-W04 item visuals and R10 props start from.
// A barrel, a crate, a cone and a glowing beacon on red dirt. Static props use makeComicMaterial with no id; the barrel and the
// beacon are "dynamic" (dynamicId) so they get silhouette outlines against the sky.
import * as THREE from 'three/webgpu';
import { color, float } from 'three/tsl';
import { createLook, addDayRig, tierFor, updateLookCamera, makeComicMaterial, comicPipeline } from './look.js';

const W = 1280, H = 720;
const renderer = new THREE.WebGPURenderer({ canvas: document.getElementById('c') });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
await renderer.init();

const scene = new THREE.Scene();
addDayRig(scene, { sunAz: -40 });
const look = createLook(tierFor(H));
const mesh = (geo, mat, x, z, y = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };

const ground = mesh(new THREE.PlaneGeometry(200, 200), makeComicMaterial(look, { colorNode: color('#C8622E'), grit: { space: undefined, cell: 28, patchFreq: 0.35 } }), 0, 0);
ground.rotation.x = -Math.PI / 2;
mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 10), makeComicMaterial(look, { colorNode: color('#1E5BFF'), dynamicId: float(1) }), -1.6, 0, 0.55);     // oil drum
mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), makeComicMaterial(look, { colorNode: color('#D9A441') }), 0.2, 0.6, 0.6).rotation.y = 0.5;                   // crate
mesh(new THREE.ConeGeometry(0.45, 1.0, 8), makeComicMaterial(look, { colorNode: color('#FF7A00') }), 1.9, -0.2, 0.5);                                     // cone
mesh(new THREE.IcosahedronGeometry(0.5, 1), makeComicMaterial(look, { colorNode: color('#00C2B8'), emissiveNode: color('#00C2B8').mul(2.2), dynamicId: float(2) }), 0.6, -1.6, 0.6); // beacon

const camera = new THREE.PerspectiveCamera(26, W / H, 0.5, 220);
camera.position.set(4.2, 2.3, 7.4); camera.lookAt(0.2, 0.55, 0); camera.updateMatrixWorld();
updateLookCamera(look, camera);
look.grainAmt.value = 0;
const { post } = comicPipeline(renderer, scene, camera, look, { speedLines: false });
for (let i = 0; i < 6; i++) { post.render(); await new Promise((r) => requestAnimationFrame(r)); }
window.__look = { backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (WebGPURenderer fallback backend)', view: 'minimal', on: true, W, H, tier: tierFor(H).name };
document.title = 'READY';
