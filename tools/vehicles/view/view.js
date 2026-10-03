// view.js (P1-V02): renders a baked vehicle GLB through three.js's GLTFLoader with the paint-key material, as a contact
// sheet. Used by capture.mjs for the vehicle-model-validation evidence. Query:
//   ?asset=/art/vehicles/cruz-missile/cruz-missile.asset.json&sheet=views|paints|lods|colliders
// When drawn, document.title becomes READY and window.__sheet holds the PNG data URL.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const q = new URLSearchParams(location.search);
const assetUrl = q.get('asset') ?? '/art/vehicles/cruz-missile/cruz-missile.asset.json';
const sheet = q.get('sheet') ?? 'views';
const TILE = 360;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(TILE, TILE);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

function scene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color('#c9c9cb');
  s.add(new THREE.HemisphereLight('#ffffff', '#8a8a90', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
  s.add(sun);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.7); fill.position.set(-6, 3, -4); s.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
  return s;
}

// The paint key: pure-white atlas texels take the car colour; everything else keeps its colour (Spike J's carMaterial).
function paintKeyMaterial(src, paint) {
  const m = new THREE.MeshStandardMaterial({
    map: src.map, emissiveMap: src.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, flatShading: true, roughness: 0.55, metalness: 0.05,
  });
  const tint = new THREE.Color(paint);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.paint = { value: tint };
    sh.fragmentShader = 'uniform vec3 paint;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float paintMask = step( 0.985, min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) );
      diffuseColor.rgb *= mix( vec3( 1.0 ), paint, paintMask );`);
  };
  m.customProgramCacheKey = () => 'paint-' + paint;
  return m;
}

async function loadLod(file, paint, { colliders = false } = {}) {
  const gltf = await new GLTFLoader().loadAsync(new URL(file, new URL(assetUrl, location.href)).href);
  const root = gltf.scene.children[0];
  let mat = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.startsWith('collider_')) {
      o.visible = colliders;
      o.material = new THREE.MeshBasicMaterial({ color: '#ff2ea6', wireframe: true });
      return;
    }
    mat ??= paintKeyMaterial(o.material, paint);
    o.material = mat; o.castShadow = true;
  });
  return root;
}

function shot(s, from, target = [0, 0.7, 0], ortho = false) {
  const cam = ortho ? new THREE.OrthographicCamera(-2.6, 2.6, 2.6, -2.6, 0.1, 50) : new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  cam.position.set(...from); cam.lookAt(...target);
  renderer.render(s, cam);
  const c = document.createElement('canvas'); c.width = TILE; c.height = TILE;
  c.getContext('2d').drawImage(renderer.domElement, 0, 0);
  return c;
}

// Views in this frame: +Z is the nose, +X the car's left.
const VIEWS = {
  front: [[0, 1.0, 9], true], rear: [[0, 1.0, -9], true], left: [[9, 0.8, 0], true], right: [[-9, 0.8, 0], true],
  top: [[0, 9, 0.001], true], 'front 3/4': [[5.5, 3.2, 7], false], 'rear 3/4': [[-5.5, 3.2, -7], false],
};

async function draw() {
  const asset = await (await fetch(assetUrl)).json();
  const tiles = [];
  if (sheet === 'views') {
    const s = scene(); s.add(await loadLod(asset.lods[0].file, '#22c3e6'));
    for (const [name, [from, ortho]] of Object.entries(VIEWS)) tiles.push([`LOD0 ${name}`, shot(s, from, [0, 0.7, 0], ortho)]);
  } else if (sheet === 'paints') {
    for (const paint of ['#22c3e6', '#e5322d', '#ffd400', '#2563eb', '#15203a', '#f2f4f8']) {
      const s = scene(); s.add(await loadLod(asset.lods[0].file, paint));
      tiles.push([`paint ${paint}`, shot(s, VIEWS['front 3/4'][0])]);
    }
  } else if (sheet === 'lods') {
    for (const [i, lod] of asset.lods.entries()) {
      const s = scene(); s.add(await loadLod(lod.file, '#22c3e6'));
      tiles.push([`LOD${i} side`, shot(s, VIEWS.left[0], [0, 0.7, 0], true)]);
      tiles.push([`LOD${i} 3/4`, shot(s, VIEWS['front 3/4'][0])]);
    }
  } else if (sheet === 'colliders') {
    const s = scene(); s.add(await loadLod(asset.lods[0].file, '#22c3e6', { colliders: true }));
    for (const name of ['left', 'front', 'top', 'front 3/4']) tiles.push([`colliders ${name}`, shot(s, VIEWS[name][0], [0, 0.7, 0], VIEWS[name][1])]);
  }
  const cols = Math.min(4, tiles.length), rows = Math.ceil(tiles.length / cols), out = document.getElementById('sheet');
  out.width = cols * TILE; out.height = rows * (TILE + 20);
  const g = out.getContext('2d');
  g.fillStyle = '#c9c9cb'; g.fillRect(0, 0, out.width, out.height);
  tiles.forEach(([label, c], i) => {
    const x = (i % cols) * TILE, y = Math.floor(i / cols) * (TILE + 20);
    g.drawImage(c, x, y + 20); g.fillStyle = '#15203a'; g.font = '14px system-ui'; g.fillText(label, x + 8, y + 15);
  });
  window.__sheet = out.toDataURL('image/png');
  document.title = 'READY';
}
draw().catch((e) => { document.title = 'ERROR ' + e.message; console.error(e); });
