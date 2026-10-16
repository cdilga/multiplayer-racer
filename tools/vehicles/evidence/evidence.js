// The vehicle review evidence page (br-bwju.3, from br-bwju.2's Ute page), headless Chromium, software GL: a baked car's
// damage strip, top-down damage overview, paint strip and grid tiles at three sizes, as the review page's items 3-5 show them.
// ?car=<vehicle id>&mode=damage|overview|paints|world-large|world-medium|world-small. Sets document.title READY and
// window.__out (PNG data URL). Serve the repo root; run.mjs drives it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const q = new URLSearchParams(location.search), mode = q.get('mode') ?? 'damage', car = q.get('car');
const base = `/art/vehicles/${car}/`;
const ASSET = `${base}${car}.asset.json`;

function paintKeyMaterial(src, paint) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, emissiveMap: src.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, flatShading: true, roughness: 0.55, metalness: 0.05 });
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
async function loadCar(lod, paint, { interiors = false } = {}) {
  const gltf = await new GLTFLoader().loadAsync(`${base}${car}.lod${lod}.glb`);
  const root = gltf.scene; const kill = [];
  root.traverse((o) => { if (o.name.startsWith('collider_')) kill.push(o); });
  kill.forEach((o) => o.parent.remove(o));
  root.traverse((o) => {
    if (o.isMesh) { o.material = paintKeyMaterial(o.material, paint); o.castShadow = true; }
    if (o.name.startsWith('interior_')) o.visible = false;
  });
  return root;
}
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
function stage(bg = '#c9c9cb') {
  const s = new THREE.Scene(); s.background = new THREE.Color(bg);
  s.add(new THREE.HemisphereLight('#ffffff', '#8a8a90', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(6, 12, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 60 }); s.add(sun);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.7); fill.position.set(-6, 3, -4); s.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#7d7f84', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; s.add(ground);
  return s;
}
const out = document.getElementById('out');
function finish(canvas) { out.width = canvas.width; out.height = canvas.height; out.getContext('2d').drawImage(canvas, 0, 0); window.__out = out.toDataURL('image/png'); document.title = 'READY'; }

// ───────── damage strip: ten cars, one state each (the P1-V03 layout) ─────────
async function runDamage(overview) {
  const asset = await (await fetch(ASSET)).json();
  const states = [
    ['intact', {}], ['door_FL 60, door_RL 45 loose', { door_FL: [60], door_RL: [45] }], ['front + back loose 25', { front: [25], back: [25] }],
    ['wheel_FL cambered 6', { wheel_FL: [6] }], ['front detached', { front: 'x' }], ['door_FL detached', { door_FL: 'x' }], ['back detached', { back: 'x' }],
    ['wheel_FL detached', { wheel_FL: 'x' }], ['both front doors + back detached', { door_FL: 'x', door_FR: 'x', back: 'x' }],
    ['stripped shell', { front: 'x', back: 'x', door_FL: 'x', door_FR: 'x', door_RL: 'x', door_RR: 'x', wheel_FL: 'x', wheel_FR: 'x' }],
  ];
  const scene = stage(); const GAP = 8.6, n = states.length;
  for (const [i, [label, st]] of states.entries()) {
    const car = await loadCar(0, '#ff3d7f'); const holder = new THREE.Group(); holder.rotation.y = Math.PI / 2; holder.position.set((i - (n - 1) / 2) * GAP, 0, 0); holder.add(car); scene.add(holder);
    const exposed = new Set();
    for (const [part, v] of Object.entries(st)) {
      const node = car.getObjectByName(part), spec = asset.parts[part];
      if (v === 'x') {
        // detached: lying on the ground beside the car, a dynamic body at rest
        const lateral = part.includes('FL') || part.includes('RL') ? 1 : -1;
        node.position.set(node.position.x + lateral * 1.7 + (part === 'front' ? 1.2 : part === 'back' ? -1.2 : 0), part.startsWith('wheel') ? 0.17 : 0.25, node.position.z + (part === 'front' ? 0.9 : part === 'back' ? -0.9 : 0.3));
        node.rotation.set(part.startsWith('wheel') ? 0 : Math.PI, 0, part.startsWith('wheel') ? Math.PI / 2 : 0.2);
      } else {
        const axis = new THREE.Vector3(...spec.hinge.axis), sign = part.startsWith('door') ? (part.endsWith('L') ? -1 : 1) : part === 'back' ? -1 : 1;
        node.quaternion.setFromAxisAngle(axis, THREE.MathUtils.degToRad(v[0]) * sign);
      }
      for (const [b, spec2] of Object.entries(asset.interiors ?? {})) if (spec2.exposedBy.includes(part)) exposed.add(b);
    }
    car.traverse((o) => { if (o.name.startsWith('interior_') && exposed.has(o.name.slice(9))) o.visible = true; });
    // label
    const c = document.createElement('canvas'); c.width = 512; c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#111'; g.font = '30px system-ui'; g.textAlign = 'center'; g.fillText(label, 256, 40);
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    sp.rotation.x = -Math.PI / 2; sp.position.set(holder.position.x, 0.02, 4.4); scene.add(sp);
  }
  const W = 2000, H = overview ? 900 : 520; renderer.setSize(W, H);
  const span = n * GAP;
  const cam = overview ? new THREE.OrthographicCamera(-span / 2 * 1.02, span / 2 * 1.02, span / 2 * 1.02 * H / W, -span / 2 * 1.02 * H / W, 1, 200) : new THREE.OrthographicCamera(-span / 2 * 1.02, span / 2 * 1.02, span / 2 * 1.02 * H / W, -span / 2 * 1.02 * H / W, 1, 200);
  if (overview) { cam.position.set(0, 60, 0.001); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); }
  else { cam.position.set(0, 18, 60); cam.lookAt(0, 0.9, 0); cam.top = 6; cam.bottom = -3; cam.updateProjectionMatrix(); cam.position.set(0, 4, 60); cam.lookAt(0, 1.0, 0); cam.top = span / 2 * 1.02 * H / W; cam.bottom = -cam.top; cam.updateProjectionMatrix(); }
  if (!overview) { cam.position.set(0, 14, 50); cam.lookAt(0, 0.6, 0); }
  renderer.render(scene, cam); finish(renderer.domElement);
}

// ───────── paints: default + five player colours; tyres stay dark ─────────
async function runPaints() {
  const paints = ['#ffffff', '#ff3d7f', '#35c7ff', '#ffd23d', '#7bff5a', '#b06bff'], scene = stage(); const GAP = 6.2;
  for (const [i, p] of paints.entries()) { const car = await loadCar(0, p); car.position.set((i - 2.5) * GAP, 0, 0); car.rotation.y = 0.0; scene.add(car); }
  const W = 2000, H = 520; renderer.setSize(W, H);
  const cam = new THREE.PerspectiveCamera(22, W / H, 1, 300); cam.position.set(0, 14, 70); cam.lookAt(0, 0.8, 0);
  const span = paints.length * GAP; const ortho = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2 * H / W, -span / 2 * H / W, 1, 200); ortho.position.set(0, 14, 50); ortho.lookAt(0, 0.6, 0);
  renderer.render(scene, ortho); finish(renderer.domElement);
}

// ───────── world: the car in tiles, small (24 tiles), large (1 tile) ─────────
async function runWorld(kind) {
  const scene = stage('#8fb4d8'); const paints = ['#ff3d7f', '#35c7ff', '#ffd23d', '#7bff5a', '#b06bff', '#ff7a1a'];
  const W = kind === 'large' ? 1920 : kind === 'medium' ? 1920 : 1920, H = 1080; renderer.setSize(W, H);
  const cols = kind === 'small' ? 6 : kind === 'medium' ? 2 : 1, rows = kind === 'small' ? 4 : kind === 'medium' ? 2 : 1;
  renderer.setScissorTest(true);
  const tw = W / cols, th = H / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, s = stage('#8fb4d8'); const car = await loadCar(i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2, paints[i % paints.length]);
    car.rotation.y = -0.6 + 0.05 * i; s.add(car);
    const cam = new THREE.PerspectiveCamera(kind === 'large' ? 34 : 38, tw / th, 0.5, 200);
    cam.position.set(-6.4, 3.8, -6.8); cam.lookAt(0, 0.9, 0); if (kind !== 'large') { cam.position.set(-7.4, 4.6, -7.8); cam.lookAt(0, 0.9, 0); }
    renderer.setViewport(c * tw, (rows - 1 - r) * th, tw, th); renderer.setScissor(c * tw, (rows - 1 - r) * th, tw, th);
    renderer.render(s, cam);
  }
  finish(renderer.domElement);
}
try {
  if (mode === 'damage') await runDamage(false);
  else if (mode === 'overview') await runDamage(true);
  else if (mode === 'paints') await runPaints();
  else await runWorld(mode.replace('world-', ''));
} catch (e) { console.error(e); document.title = 'ERROR ' + e.message; }
