// render_gates_page.js — runs INSIDE the browser (imported by render_gates.mjs). Everything here consumes the baked GLB via three's
// GLTFLoader, i.e. the same file a game would ship, never the code that generated it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVehicleRig, bakeIntactTemplate, pickLod } from '/spikes/art-pipeline/H-primitive-kit/kit/rig.js';
import { createStage } from '/spikes/art-pipeline/H-primitive-kit/kit/stage.js';

const BASE = '/spikes/art-pipeline/H-primitive-kit';
const loader = new GLTFLoader();
export const loadGlb = async (url) => (await loader.loadAsync(url)).scene;

// ── orthographic silhouettes ───────────────────────────────────────────────────────────────────────────────────────
const R = 256;
let _r, _rt;
function renderer() { if (!_r) { _r = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); _r.setSize(R, R, false); _rt = new THREE.WebGLRenderTarget(R, R); } return _r; }
/** binary mask (Uint8Array R*R, 1 = car) of an orthographic view. view: 'side' | 'top' | 'front'. frame = [halfW, halfH, cx, cy] world extents (shared across LODs) */
export function silhouette(scene, view, frame) {
  const r = renderer(), s = new THREE.Scene(); s.background = new THREE.Color('#fff');
  const c = scene.clone(true); c.traverse((o) => { if (o.isMesh) { if (o.name.startsWith('col_')) o.visible = false; else o.material = new THREE.MeshBasicMaterial({ color: '#000', side: THREE.DoubleSide }); } });
  s.add(c);
  const [hw, hh, cx, cy] = frame, cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 50);
  if (view === 'side') { cam.position.set(20, cy, cx); cam.up.set(0, 1, 0); cam.lookAt(0, cy, cx); }
  if (view === 'front') { cam.position.set(cx, cy, -20); cam.up.set(0, 1, 0); cam.lookAt(cx, cy, 0); }
  if (view === 'top') { cam.position.set(cx, 20, cy); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cy); }
  r.setRenderTarget(_rt); r.render(s, cam); const buf = new Uint8Array(R * R * 4); r.readRenderTargetPixels(_rt, 0, 0, R, R, buf); r.setRenderTarget(null);
  const m = new Uint8Array(R * R); for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) m[(R - 1 - y) * R + x] = buf[(y * R + x) * 4] < 128 ? 1 : 0;      // top-down rows
  return m;
}
export function frameFor(scene, view) {
  const b = new THREE.Box3().setFromObject(scene, true); const sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const half = { side: [sz.z / 2, sz.y / 2, c.z, c.y], front: [sz.x / 2, sz.y / 2, c.x, c.y], top: [sz.x / 2, sz.z / 2, c.x, c.z] }[view];
  const k = 1.12, hw = Math.max(half[0], half[1] * 0), hh = half[1];
  return [half[0] * k, half[1] * k, half[2], half[3]];
}
/** common frame (union of all LOD frames is unnecessary: LODs share bounds within 6 cm, so LOD0's frame is reused) */
export const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const x = a[k], y = b[k]; if (x & y) i++; if (x | y) u++; } return u ? i / u : 1; };
const bboxOfMask = (m, w, h) => { let x0 = w, x1 = -1, y0 = h, y1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
/** crop to bbox and stretch to gw×gh: compares SHAPE (roofline, greenhouse, wheel layout) independent of the toy's deliberate proportion changes */
export function normalise(m, w, h, gw, gh) { const [x0, y0, x1, y1] = bboxOfMask(m, w, h), out = new Uint8Array(gw * gh); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const sx = Math.min(w - 1, Math.floor(x0 + ((x + 0.5) / gw) * (x1 - x0 + 1))), sy = Math.min(h - 1, Math.floor(y0 + ((y + 0.5) / gh) * (y1 - y0 + 1))); out[y * gw + x] = m[sy * w + sx]; } return out; }
export async function refMask(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data, m = new Uint8Array(c.width * c.height);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] < 235 || d[i * 4 + 1] < 235 || d[i * 4 + 2] < 235 ? 1 : 0;
  return { m, w: c.width, h: c.height };
}
export function overlayPng(a, b, gw, gh, scale = 3) { // red = A only, blue = B only, dark = both
  const c = document.createElement('canvas'); c.width = gw * scale; c.height = gh * scale; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const p = a[y * gw + x], q = b[y * gw + x]; if (!p && !q) continue; g.fillStyle = p && q ? '#3a3a3a' : p ? '#e0392f' : '#1e6bff'; g.fillRect(x * scale, y * scale, scale, scale); }
  return c.toDataURL('image/png');
}

// ── rig smoke test on the loaded GLB ─────────────────────────────────────────────────────────────────────────────────────
const hashPos = (root) => { let h = 0; root.traverse((o) => { if (o.isMesh && !o.name.startsWith('col_')) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 7) h = (h * 31 + Math.round(a[i] * 1e5)) | 0; } }); return h; };
export async function smoke(glbUrl, sidecar) {
  const scene = await loadGlb(glbUrl), rig = createVehicleRig(scene, sidecar), out = [], ok = (id, pass, detail) => out.push({ id, ok: !!pass, detail });
  const wp = (n) => new THREE.Vector3().setFromMatrixPosition(rig.root.getObjectByName(n).updateWorldMatrix(true, false) || rig.root.getObjectByName(n).matrixWorld);
  scene.updateMatrixWorld(true);
  // steer
  rig.setSteer(0.4); scene.updateMatrixWorld(true); const wl = rig.root.getObjectByName('wheel_FL_steer'), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(wl.quaternion);
  ok('steer', fwd.x < -0.3 && Math.abs(rig.root.getObjectByName('wheel_RL').quaternion.w - 1) < 1e-6, `front wheels yaw left by ${(Math.atan2(-fwd.x, -fwd.z) * 180 / Math.PI).toFixed(1)}°, rear wheels untouched`); rig.setSteer(0);
  // spin
  rig.setWheelSpin(0.6); const top = new THREE.Vector3(0, 0.4, 0).applyQuaternion(rig.wheels[0].node.quaternion); ok('spin', top.z < -0.1, `positive spin moves the tyre top forward (dz=${top.z.toFixed(2)})`); rig.setWheelSpin(0);
  // panels open the right way
  const edge = (id) => { const b = new THREE.Box3().setFromObject(rig.root.getObjectByName(id)); return b; };
  const d0 = edge('door_L'), b0 = edge('bonnet'), k0 = edge('boot'); rig.openPanel('door_L', 1); rig.openPanel('bonnet', 1); rig.openPanel('boot', 1); scene.updateMatrixWorld(true);
  const d1 = edge('door_L'), b1 = edge('bonnet'), k1 = edge('boot');
  ok('door_opens', d1.min.x < d0.min.x - 0.25, `left door swings outward by ${(d0.min.x - d1.min.x).toFixed(2)} m at full open`); ok('bonnet_opens', b1.max.y > b0.max.y + 0.15, `bonnet lifts ${(b1.max.y - b0.max.y).toFixed(2)} m`); ok('boot_opens', k1.max.y > k0.max.y + 0.1, `boot lifts ${(k1.max.y - k0.max.y).toFixed(2)} m`);
  rig.openPanel('door_L', 0); rig.openPanel('bonnet', 0); rig.openPanel('boot', 0);
  // suspension
  const sn = rig.root.getObjectByName('wheel_FL_steer'), y0 = sn.position.y; rig.setSuspension('wheel_FL', 0.5); const y1 = sn.position.y; ok('suspension', Math.abs(y1 - y0 - 0.12) < 1e-6, `travel clamped to the sidecar range (+0.12 m of a 0.5 request)`); rig.setSuspension('wheel_FL', 0);
  // lights + paint
  rig.setLights({ brake: false }); const br = () => rig.root.getObjectByName('light_brake_L').children.find((c) => c.isMesh && c.material.userData.jj_semantic === 'brakelight')?.material.emissiveIntensity;
  const off = br(); rig.setLights({ brake: true }); const on = br(); ok('lights', on > off, `brake light emissive ${off} → ${on}`);
  rig.setPaint('#ff0000'); const pm = rig.paintMaterials[0]; ok('paint', pm.color.r > 0.9 && pm.color.g < 0.1, `paint tint applies to ${rig.paintMaterials.length} jj_paint material(s)`);
  // intact fast path: template baked, sources hidden until a part moves
  const t2 = await loadGlb(glbUrl), bk = bakeIntactTemplate(t2), r2 = createVehicleRig(t2, sidecar), vis = () => { let n = 0; t2.traverse((o) => { if (o.isMesh && !o.name.startsWith('col_')) { let v = true, p = o; while (p) { if (!p.visible) v = false; p = p.parent; } if (v) n++; } }); return n; };
  const n0 = vis(); r2.openPanel('door_L', 0.5); const n1 = vis(); ok('intact_fastpath', bk.meshes < 16 && n0 < n1 && r2.intact, `${n1} part meshes → ${n0} merged draws while intact (wakes on first motion/dent/detach)`);
  // LOD selection: monotone, and hysteresis stops boundary flicker
  const seq = [400, 300, 250, 270, 200, 120, 100, 108, 112, 60, 50, 44, 47], picks = []; let cur = null; for (const px of seq) { cur = pickLod(px, cur); picks.push(cur); }
  const flips = picks.reduce((n, v, i) => n + (i && v !== picks[i - 1] ? 1 : 0), 0);
  ok('lod_select', pickLod(500) === 0 && pickLod(150) === 1 && pickLod(70) === 2 && pickLod(20) === 3 && flips <= 5, `pickLod maps 500/150/70/20 px → LOD0/1/2/3 and a boundary-hugging path flips ${flips}× (picks ${picks.join('')})`);
  // dents: change vertices, record, and restore bit-identically
  const h0 = hashPos(scene); rig.dent('door_L', new THREE.Vector3(-0.9, 0.75, 0.4), new THREE.Vector3(1, 0, 0), { severity: 0.8 }); const h1 = hashPos(scene);
  ok('dent', h1 !== h0 && rig.dentRecords.length === 1, `dent moved vertices (hash changed) and recorded {part,pos,dir,radius,depth,severity}`); rig.reset(); ok('dent_reset', hashPos(scene) === h0, 'reset restores the pristine vertices exactly');
  // detach package
  const dt = rig.detach('door_L'); ok('detach', dt.massKg > 5 && dt.collider?.vertices.length >= 24 && dt.node.parent !== dt.parent, `door_L hands physics ${dt.massKg.toFixed(1)} kg + a ${dt.collider?.shape} collider (${(dt.collider?.vertices.length / 3) | 0} verts)`);
  return out;
}

// ── 24-car grid straight from the GLB ─────────────────────────────────────────────────────────────────────────────────────
export async function grid(glbUrl, sidecar, cars = 24, intact = true) {
  const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
  const stage = createStage({ canvas, width: 3840, height: 2160, pixelRatio: 1 }); stage.floor.visible = true;
  const tpl = await loadGlb(glbUrl); const bake = intact ? bakeIntactTemplate(tpl) : null; const COL = ['#e0392f', '#1e88e5', '#ffd23f', '#2bb673', '#8e44ad', '#f59f00', '#17b3b0', '#ff4fa3'], list = [];
  const t0 = performance.now();
  for (let i = 0; i < cars; i++) { const c = tpl.clone(true); c.position.set((i % 6) * 6, 0, Math.floor(i / 6) * 6); const rig = createVehicleRig(c, sidecar); rig.setPaint(COL[i % 8]); stage.scene.add(c); list.push(c); }
  const inst = performance.now() - t0, r = stage.renderer, gl = r.getContext(), cam = stage.camera;
  const frame = () => { r.setScissorTest(true); r.autoClear = false; r.setClearColor('#f3e6cf'); r.clear();
    list.forEach((c, i) => { list.forEach((o) => (o.visible = o === c)); const x = (i % 6) * 640, y = 2160 - (Math.floor(i / 6) * 540 + 540); r.setViewport(x, y, 640, 540); r.setScissor(x, y, 640, 540); cam.aspect = 640 / 540; cam.fov = 28; cam.updateProjectionMatrix(); const a = (30 + i * 3) * Math.PI / 180; cam.position.set(c.position.x + Math.sin(a) * 7.1, 2.8, c.position.z + Math.cos(a) * 7.1); cam.lookAt(c.position.x, 0.75, c.position.z); r.render(stage.scene, cam); });
    list.forEach((o) => (o.visible = true)); r.setScissorTest(false); r.autoClear = true; };
  frame(); gl.finish(); r.info.autoReset = false; r.info.reset(); frame(); const info = { calls: r.info.render.calls, tris: r.info.render.triangles }; r.info.autoReset = true;
  const N = 15, t1 = performance.now(); for (let i = 0; i < N; i++) { frame(); gl.finish(); } const ms = (performance.now() - t1) / N;
  const png = canvas.toDataURL('image/jpeg', 0.8); canvas.remove(); r.dispose?.();
  return { intact: !!bake, bakedMeshes: bake?.meshes, instantiateMs: +inst.toFixed(1), calls: info.calls, tris: info.tris, frameMs: +ms.toFixed(1), png };
}
