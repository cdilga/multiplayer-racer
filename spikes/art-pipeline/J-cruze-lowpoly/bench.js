// bench.js — N cars × N chase-camera tiles on one canvas (the Dynamic Grid worst case: every tile sees the whole pack).
// window.__bench.run({ n, lod, mode: 'naive'|'instanced', shadows: 'off'|'per-tile'|'once', w, h, frames }) → numbers.
//   naive     : every car is its own set of part meshes (what a straightforward scene graph does)
//   instanced : one InstancedMesh per part type shared by all cars (draws per tile are constant in N); detaching a part only
//               changes that instance's matrix, so debris stays dynamic without adding draws.
import * as THREE from 'three';
import { build, DEFAULT_P } from './model.js';
import { carMaterial } from './atlas.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.autoClear = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const gl = renderer.getContext();
let P = DEFAULT_P;
try { P = await (await fetch('./params.json', { cache: 'no-store' })).json(); } catch { /* defaults */ }

function makeScene() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d9c7a5');
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a7a60', 1.5));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2); sun.position.set(30, 60, 20); sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 }); scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: '#c96f3b' })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  return { scene, sun };
}

const PALETTE = ['#22c3e6', '#ff4fa3', '#ffd23f', '#7bd389', '#ff7a2e', '#9b7bff', '#ff3b3b', '#3bd6c6'];
// starting-grid pack: rows of 4, 3 m apart sideways, 6 m apart lengthways — every chase camera sees most of the field
function pack(n) { return Array.from({ length: n }, (_, i) => ({ x: ((i % 4) - 1.5) * 3.2, z: -Math.floor(i / 4) * 6.5, yaw: 0 })); }

function naive(scene, template, n, poses, shadows) {
  const mats = PALETTE.map((c) => carMaterial({ paint: c }));
  for (let i = 0; i < n; i++) {
    const g = template.group.clone(); g.traverse((o) => { if (o.isMesh) { o.material = mats[i % mats.length]; o.castShadow = shadows; } });
    g.position.set(poses[i].x, 0, poses[i].z); g.rotation.y = poses[i].yaw; scene.add(g);
  }
}
function instanced(scene, template, n, poses, shadows) {
  // one material for all; per-car paint comes from instanceColor (the bench uses a white-paint atlas so the tint shows)
  const mat = carMaterial({}, { paintKey: true }); const m = new THREE.Matrix4(), car = new THREE.Matrix4(), off = new THREE.Matrix4(), col = new THREE.Color();
  const groups = {};
  for (const [id, mesh] of Object.entries(template.parts)) { const key = id.startsWith('wheel') ? 'wheel' : id; (groups[key] ??= []).push(mesh); }
  for (const [key, meshes] of Object.entries(groups)) {
    const im = new THREE.InstancedMesh(meshes[0].geometry, mat, n * meshes.length); im.castShadow = shadows; im.frustumCulled = false;
    let k = 0;
    for (let i = 0; i < n; i++) {
      car.makeRotationY(poses[i].yaw).setPosition(poses[i].x, 0, poses[i].z);
      for (const pm of meshes) {
        off.makeTranslation(...pm.userData.rest);
        if (key === 'wheel' && pm.name.endsWith('L')) off.multiply(new THREE.Matrix4().makeRotationY(Math.PI)); // mirror the hub side by rotation, not scale
        m.multiplyMatrices(car, off); im.setMatrixAt(k, m); im.setColorAt(k, col.set(PALETTE[i % PALETTE.length])); k++;
      }
    }
    scene.add(im);
  }
}

function layout(n, w, h) { // rows × cols minimising unused area with tile aspect near 16:9
  let best = null;
  for (let cols = 1; cols <= n; cols++) { const rows = Math.ceil(n / cols), tw = w / cols, th = h / rows, a = tw / th, cost = Math.abs(Math.log(a / (16 / 9))) + (rows * cols - n) * 0.05; if (!best || cost < best.cost) best = { cols, rows, tw, th, cost }; }
  return best;
}

async function run({ n = 24, lod = 1, mode = 'instanced', shadows = 'once', w = 1920, h = 1080, frames = 90 } = {}) {
  renderer.setSize(w, h, false); renderer.shadowMap.enabled = shadows !== 'off'; renderer.shadowMap.autoUpdate = shadows === 'per-tile';
  const { scene, sun } = makeScene(); const template = build(P, lod); const poses = pack(n);
  (mode === 'naive' ? naive : instanced)(scene, template, n, poses, shadows !== 'off');
  const L = layout(n, w, h), cams = poses.map(() => new THREE.PerspectiveCamera(60, L.tw / L.th, 0.3, 400));
  const frame = () => {
    if (shadows === 'once') renderer.shadowMap.needsUpdate = true;
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    let draws = 0, tris = 0;
    for (let i = 0; i < n; i++) {
      const c = cams[i], p = poses[i]; c.position.set(p.x, 2.4, p.z - 6.2); c.lookAt(p.x, 1.0, p.z + 4);
      const col = i % L.cols, row = Math.floor(i / L.cols), x = col * L.tw, y = h - (row + 1) * L.th;
      renderer.setViewport(x, y, L.tw, L.th); renderer.setScissor(x, y, L.tw, L.th);
      renderer.render(scene, c); draws += renderer.info.render.calls; tris += renderer.info.render.triangles;
    }
    return { draws, tris };
  };
  renderer.info.autoReset = true;
  for (let i = 0; i < 10; i++) frame(); // warm-up (shader compile, uploads)
  const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const times = []; let last;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now(); last = frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const res = { n, lod, mode, shadows, w, h, tiles: `${L.cols}x${L.rows}`, tile_px: `${Math.round(L.tw)}x${Math.round(L.th)}`, car_tris: template.stats.tris, draws_per_frame: last.draws, tris_per_frame: last.tris, ms_median: +times[frames >> 1].toFixed(2), ms_p90: +times[Math.floor(frames * 0.9)].toFixed(2) };
  lastFrame = frame;
  return res;
}
let lastFrame = null;
window.__bench = { run, shot: () => { lastFrame?.(); return canvas.toDataURL('image/png'); } };
document.title = 'READY';
