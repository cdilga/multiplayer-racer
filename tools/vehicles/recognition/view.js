// view.js (br-bwju.12): one baked LOD of a roster car, one camera angle, on a plain backdrop, with the game's paint-key
// material. render.mjs asks for each (lod, view) in turn through window.__render(lod, view) → PNG data URL.
// Views: front, front-left, front-right, side, rear-left, rear, top (+X is the car's left, +Z the nose).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintKeyGlsl } from '/web/shared/render/paint-key.js';

const q = new URLSearchParams(location.search);
const assetUrl = q.get('asset'), paint = q.get('paint') ?? '#f06a1a', SIZE = +(q.get('size') ?? 640), ZOOM = +(q.get('zoom') ?? 1);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(SIZE, SIZE); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#c9c9cb');
scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a90', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 }); scene.add(sun);
const fill = new THREE.DirectionalLight('#dfe8ff', 0.7); fill.position.set(-6, 3, -4); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

function paintKeyMaterial(src) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, emissiveMap: src.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, flatShading: true, roughness: 0.55, metalness: 0.05 });
  const tint = new THREE.Color(paint);
  m.onBeforeCompile = (sh) => { sh.uniforms.paint = { value: tint }; sh.fragmentShader = 'uniform vec3 paint;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${paintKeyGlsl('paint')}`); };
  m.customProgramCacheKey = () => 'paint-' + paint;
  return m;
}
const asset = await (await fetch(assetUrl)).json();
const cars = [];
for (const lod of asset.lods) {
  const gltf = await new GLTFLoader().loadAsync(new URL(lod.file, new URL(assetUrl, location.href)).href);
  const root = gltf.scene.children[0]; let mat = null;
  root.traverse((o) => { if (!o.isMesh) return; if (o.name.startsWith('collider_') || o.name.startsWith('interior_')) { o.visible = false; return; } mat ??= paintKeyMaterial(o.material); o.material = mat; o.castShadow = true; });
  root.visible = false; scene.add(root); cars.push(root);
}
// camera directions from the car's centre (the y is the elevation)
const FILL = 0.92;
const DIRS = { front: [0, 0.22, 1], 'front-left': [0.75, 0.38, 0.75], 'front-right': [-0.75, 0.38, 0.75], side: [1, 0.12, 0], 'rear-left': [0.75, 0.38, -0.75], rear: [0, 0.22, -1], top: [0, 1, 0.0001] };
window.__render = (lod, view) => {
  cars.forEach((c, i) => { c.visible = i === lod; });
  const car = cars[lod], box = new THREE.Box3().setFromObject(car), mid = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 100), d = new THREE.Vector3(...DIRS[view]).normalize();
  if (view === 'top') cam.up.set(0, 0, -1);
  // fit: the car's bounding box fills FILL of the frame from every view, so a longer car isn't cropped and a shorter one isn't
  // small (round 2 of br-bwju.12: the fixed 8.4 / 9.2 m distances cut the 5 m AU's nose off); --zoom scales the result
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  let dist = 8.4;
  for (let k = 0; k < 6; k++) {
    cam.position.copy(mid).addScaledVector(d, dist); cam.lookAt(mid); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const m = Math.max(...corners.map((c) => { const p = c.clone().project(cam); return Math.max(Math.abs(p.x), Math.abs(p.y)); }));
    dist *= m / FILL;
  }
  cam.position.copy(mid).addScaledVector(d, dist * ZOOM);
  cam.lookAt(mid);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
};
document.title = 'READY';
