// br-bwju.2 evidence page (headless Chromium, software GL). ?mode=compare|damage|world|paints. Sets document.title READY and
// window.__out (PNG data URL) and window.__score (compare). Serve the repo root; the owner's Triton GLB comes from /__triton.glb.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { compare, bbox, cropMask } from '/spikes/art-pipeline/J-cruze-lowpoly/mask.js';

const q = new URLSearchParams(location.search), mode = q.get('mode') ?? 'compare';
const ASSET = '/art/vehicles/tradie-ute/tradie-ute.asset.json';
const base = '/art/vehicles/tradie-ute/';
const side = (n) => new THREE.Vector3(...n);

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
async function loadUte(lod, paint, { interiors = false } = {}) {
  const gltf = await new GLTFLoader().loadAsync(`${base}tradie-ute.lod${lod}.glb`);
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

// ───────── compare: silhouettes of the owner's Triton mesh vs the ute LOD0, bounding-box normalised ─────────
async function silhouette(obj, view) {
  const W = 1200, H = 700; renderer.setSize(W, H);
  const s = new THREE.Scene(); s.background = new THREE.Color('#000'); s.add(obj);
  const white = new THREE.MeshBasicMaterial({ color: '#fff' });
  const saved = []; obj.traverse((o) => { if (o.isMesh) { saved.push([o, o.material]); o.material = white; } });
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const dirs = { side: [1, 0, 0, sz.z, sz.y], top: [0, 1, 0, sz.x, sz.z], front: [0, 0, 1, sz.x, sz.y], rear: [0, 0, -1, sz.x, sz.y] };
  const [dx, dy, dz, w, h] = dirs[view];
  const sc = Math.max(w / W, h / H) * 1.15, hw = W * sc / 2, hh = H * sc / 2;
  const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 100);
  cam.position.copy(c).add(new THREE.Vector3(dx, dy, dz).multiplyScalar(30));
  cam.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0); cam.lookAt(c);
  if (view === 'top') cam.up.set(0, 0, -1), cam.lookAt(c);
  renderer.render(s, cam);
  const gl = renderer.getContext(), px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = px[((H - 1 - y) * W + x) * 4] > 127 ? 1 : 0;
  saved.forEach(([o, mat]) => { o.material = mat; }); s.remove(obj);
  return { m, W, H };
}
async function runCompare() {
  const tri = (await new GLTFLoader().loadAsync('/__triton.glb')).scene;
  tri.traverse((o) => { if (o.name.startsWith('marker.') || o.name.startsWith('body.interior')) o.visible = o.name === 'body.exterior'; });
  const pivot = new THREE.Group(); pivot.add(tri); pivot.rotation.y = -Math.PI / 2; // Triton +X forward -> +Z forward
  pivot.updateMatrixWorld(true);
  const ute = await loadUte(0, '#ffffff'); ute.updateMatrixWorld(true);
  const WEIGHTS = { side: 0.4, top: 0.3, front: 0.15, rear: 0.15 };
  const score = { lod: 0, reference: "the owner's Triton mesh (home-digital-twin triton.glb), bounding-box normalised silhouettes", views: {}, score: 0 };
  const panels = [];
  for (const v of ['side', 'top', 'front', 'rear']) {
    const A = await silhouette(pivot, v), B = await silhouette(ute, v);
    const ba = bbox(A.m, A.W, A.H), bb = bbox(B.m, B.W, B.H);
    const ra = cropMask(A.m, A.W, ba), ob = cropMask(B.m, B.W, bb);
    const r = compare(ra, ba.w, ba.h, ob, bb.w, bb.h);
    score.views[v] = { iou: +r.iou.toFixed(4), aspect: +r.aspect.toFixed(3), miss: +r.miss.toFixed(4), extra: +r.extra.toFixed(4) };
    score.score += WEIGHTS[v] * r.iou;
    panels.push({ v, ra, ba, ob, bb, r });
    scene_cleanup: ;
    pivot.parent = null;
  }
  score.score = +score.score.toFixed(4); score.weights = WEIGHTS;
  // sheet: per view a row of [reference | model | diff], each panel 400 wide
  const PW = 400, rows = panels.length, PH = 260, sheet = document.createElement('canvas'); sheet.width = PW * 3 + 40; sheet.height = (PH + 28) * rows;
  const g = sheet.getContext('2d'); g.fillStyle = '#c9c9cb'; g.fillRect(0, 0, sheet.width, sheet.height); g.font = '14px system-ui'; g.fillStyle = '#111';
  panels.forEach((p, i) => {
    const y0 = i * (PH + 28) + 22; g.fillStyle = '#111';
    g.fillText(`${p.v}: IoU ${p.r.iou.toFixed(3)}   [reference (Triton)  |  model LOD0  |  diff: green = model outside, red = reference missed]`, 8, y0 - 6);
    const { W, H } = p.r, s = Math.min(PW / W, PH / H);
    const draw = (px, fn) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const cg = c.getContext('2d'), im = cg.createImageData(W, H);
      for (let k = 0; k < W * H; k++) { const [r, gg, b] = fn(k); im.data.set([r, gg, b, 255], k * 4); } cg.putImageData(im, 0, 0); g.drawImage(c, 10 + px * (PW + 10), y0, W * s, H * s); };
    const offR = (W - p.ba.w) >> 1, sc = p.ba.h / p.bb.h, sw = Math.round(p.bb.w * sc), offO = (W - sw) >> 1;
    draw(0, (k) => { const x = k % W, y = (k / W) | 0, rx = x - offR; return rx >= 0 && rx < p.ba.w && y < p.ba.h && p.ra[y * p.ba.w + rx] ? [40, 40, 44] : [225, 225, 228]; });
    draw(1, (k) => { const x = k % W, y = (k / W) | 0, ox = Math.floor((x - offO) / sc), oy = Math.floor(y / sc); return x - offO >= 0 && ox < p.bb.w && oy < p.bb.h && p.ob[oy * p.bb.w + ox] ? [40, 40, 44] : [225, 225, 228]; });
    draw(2, (k) => (p.r.diff[k] > 0 ? [60, 190, 90] : p.r.diff[k] < 0 ? [220, 60, 50] : p.r.both[k] ? [90, 90, 96] : [225, 225, 228]));
  });
  window.__score = score; finish(sheet);
}

// ───────── damage strip: ten cars, one state each (the P1-V03 layout) ─────────
async function runDamage(overview) {
  const asset = await (await fetch(ASSET)).json();
  const states = [
    ['intact', {}], ['door_FL 60, door_RL 45 loose', { door_FL: [60], door_RL: [45] }], ['front + back loose 25', { front: [25], back: [25] }],
    ['wheel_FL cambered 6', { wheel_FL: [6] }], ['front detached', { front: 'x' }], ['door_FL detached', { door_FL: 'x' }], ['back (tray) detached', { back: 'x' }],
    ['wheel_FL detached', { wheel_FL: 'x' }], ['both front doors + back detached', { door_FL: 'x', door_FR: 'x', back: 'x' }],
    ['stripped shell', { front: 'x', back: 'x', door_FL: 'x', door_FR: 'x', door_RL: 'x', door_RR: 'x', wheel_FL: 'x', wheel_FR: 'x' }],
  ];
  const scene = stage(); const GAP = 8.6, n = states.length;
  for (const [i, [label, st]] of states.entries()) {
    const car = await loadUte(0, '#ff3d7f'); const holder = new THREE.Group(); holder.rotation.y = Math.PI / 2; holder.position.set((i - (n - 1) / 2) * GAP, 0, 0); holder.add(car); scene.add(holder);
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
  for (const [i, p] of paints.entries()) { const car = await loadUte(0, p); car.position.set((i - 2.5) * GAP, 0, 0); car.rotation.y = 0.0; scene.add(car); }
  const W = 2000, H = 520; renderer.setSize(W, H);
  const cam = new THREE.PerspectiveCamera(22, W / H, 1, 300); cam.position.set(0, 14, 70); cam.lookAt(0, 0.8, 0);
  const span = paints.length * GAP; const ortho = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2 * H / W, -span / 2 * H / W, 1, 200); ortho.position.set(0, 14, 50); ortho.lookAt(0, 0.6, 0);
  renderer.render(scene, ortho); finish(renderer.domElement);
}

// ───────── world: the ute in tiles, small (24 tiles), large (1 tile) ─────────
async function runWorld(kind) {
  const scene = stage('#8fb4d8'); const paints = ['#ff3d7f', '#35c7ff', '#ffd23d', '#7bff5a', '#b06bff', '#ff7a1a'];
  const W = kind === 'large' ? 1920 : kind === 'medium' ? 1920 : 1920, H = 1080; renderer.setSize(W, H);
  const cols = kind === 'small' ? 6 : kind === 'medium' ? 2 : 1, rows = kind === 'small' ? 4 : kind === 'medium' ? 2 : 1;
  renderer.setScissorTest(true);
  const tw = W / cols, th = H / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, s = stage('#8fb4d8'); const car = await loadUte(i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2, paints[i % paints.length]);
    car.rotation.y = -0.6 + 0.05 * i; s.add(car);
    const cam = new THREE.PerspectiveCamera(kind === 'large' ? 34 : 38, tw / th, 0.5, 200);
    cam.position.set(-6.4, 3.8, -6.8); cam.lookAt(0, 0.9, 0); if (kind !== 'large') { cam.position.set(-7.4, 4.6, -7.8); cam.lookAt(0, 0.9, 0); }
    renderer.setViewport(c * tw, (rows - 1 - r) * th, tw, th); renderer.setScissor(c * tw, (rows - 1 - r) * th, tw, th);
    renderer.render(s, cam);
  }
  finish(renderer.domElement);
}
try {
  if (mode === 'compare') await runCompare();
  else if (mode === 'damage') await runDamage(false);
  else if (mode === 'overview') await runDamage(true);
  else if (mode === 'paints') await runPaints();
  else await runWorld(mode.replace('world-', ''));
} catch (e) { console.error(e); document.title = 'ERROR ' + e.message; }
