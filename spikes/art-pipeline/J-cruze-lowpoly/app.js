// app.js — dev/eval page. window.__j = { setP, setLod, shaded(view,w,h), evaluate(sheet), P, stats }.
// Pixel evaluation: render the model's silhouette from each reference view (orthographic), push it through the same
// fill/open/largest pipeline as the reference masks, scale to the reference height and score IoU (ground band excluded:
// the reference has a contact shadow the segmenter can't tell from tyre rubber).
import * as THREE from 'three';
import { build, DEFAULT_P, LODS } from './model.js';
import { carMaterial } from './atlas.js';
import { setState } from './damage.js';
import { fillHoles, openMask, largest, bbox, cropMask, compare } from './mask.js';

const OPEN = 5, GROUND_BAND = 0.125;
let CAM_D = 10; // 0 = orthographic; otherwise a perspective camera this far from the car centre (calibrated once against the sheet)
export const VIEWS = {
  side: { dir: [1, 0, 0], up: [0, 1, 0], weight: 0.4 },  // most reliable view: lengths and heights
  top: { dir: [0, 1, 0], up: [0, 0, -1], weight: 0.3 },   // widths
  front: { dir: [0, Math.sin(0.14), Math.cos(0.14)], up: [0, 1, 0], weight: 0.15 },
  rear: { dir: [0, Math.sin(0.12), -Math.cos(0.12)], up: [0, 1, 0], weight: 0.15 },
};
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#c9c9cb');
scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a90', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 }); scene.add(sun);
const fill = new THREE.DirectionalLight('#dfe8ff', 0.7); fill.position.set(-6, 3, -4); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

let P = structuredClone(DEFAULT_P), lod = 0, car = null, material = carMaterial();
function rebuild() {
  if (car) { scene.remove(car.group); for (const o of scene.children.filter((o) => o.userData.rest)) scene.remove(o); }
  car = build(P, lod); car.group.traverse((o) => { if (o.isMesh) o.material = material; }); scene.add(car.group);
  return car.stats;
}

// shaded render with a named camera; returns a data URL
const persp = new THREE.PerspectiveCamera(24, 1, 0.1, 100), ortho = new THREE.OrthographicCamera();
function frame(cam, view, w, h, pad = 1.06) {
  const V = VIEWS[view] ?? view, dir = new THREE.Vector3(...V.dir).normalize();
  const box = new THREE.Box3().setFromObject(car.group), ctr = box.getCenter(new THREE.Vector3());
  cam.up.set(...V.up); cam.position.copy(ctr).addScaledVector(dir, 20); cam.lookAt(ctr); cam.updateMatrixWorld();
  // projected extent of the box corners in camera space
  const inv = cam.matrixWorldInverse; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  car.group.updateMatrixWorld(true);
  car.group.traverse((o) => { if (!o.isMesh || !o.visible) return; const pos = o.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } });
  return { x0, x1, y0, y1 };
}
function renderOrtho(view, pxPerM, { silhouette = false } = {}) {
  let w, h, cam = ortho;
  if (CAM_D > 0) {
    // perspective: aim at the bbox centre from CAM_D, square frustum that holds the whole car, then size the target so the
    // car's projected height is pxPerM·(height in m) — i.e. the same pixel height as the orthographic case
    const V = VIEWS[view], dir = new THREE.Vector3(...V.dir).normalize(), box = new THREE.Box3().setFromObject(car.group), ctr = box.getCenter(new THREE.Vector3());
    const R = box.getSize(new THREE.Vector3()).length() / 2;
    cam = persp; cam.up.set(...V.up); cam.position.copy(ctr).addScaledVector(dir, CAM_D); cam.lookAt(ctr); cam.aspect = 1; cam.fov = 2 * Math.atan((R * 1.15) / (CAM_D - R)) * 180 / Math.PI; cam.near = 0.05; cam.far = CAM_D + 2 * R; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    let y0 = 1, y1 = -1; const v = new THREE.Vector3();
    car.group.traverse((o) => { if (!o.isMesh || !o.visible) return; const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i += 3) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(cam); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } });
    const e = frame(ortho, view); w = h = Math.ceil(pxPerM * (e.y1 - e.y0) * 2 / (y1 - y0));
  } else {
    const e = frame(ortho, view), m = 8 / pxPerM; // 8 px margin
    w = Math.ceil((e.x1 - e.x0) * pxPerM) + 16; h = Math.ceil((e.y1 - e.y0) * pxPerM) + 16;
    Object.assign(ortho, { left: e.x0 - m, right: e.x0 - m + w / pxPerM, top: e.y1 + m, bottom: e.y1 + m - h / pxPerM, near: 0.1, far: 60 }); ortho.updateProjectionMatrix();
  }
  renderer.setSize(w, h, false);
  if (silhouette) { scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }); const bg = scene.background; scene.background = new THREE.Color(0); ground.visible = false;
    renderer.render(scene, cam); scene.overrideMaterial = null; scene.background = bg; ground.visible = true; }
  else renderer.render(scene, cam);
  return { w, h };
}
function readMask(w, h) {
  const gl = renderer.getContext(), px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[(h - 1 - y) * w + x] = px[(y * w + x) * 4] > 127 ? 1 : 0; return m;
}

const refCache = {};
async function refMask(key) {
  if (refCache[key]) return refCache[key];
  const img = new Image(); img.src = `./refs/masks/${key}.mask.png`; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height).data, m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
  return (refCache[key] = { m, w: img.width, h: img.height });
}

function diffImage(r) {
  const c = document.createElement('canvas'); c.width = r.W; c.height = r.H; const x = c.getContext('2d'), im = x.createImageData(r.W, r.H);
  for (let i = 0; i < r.W * r.H; i++) { const d = r.diff[i], both = r.both[i]; const col = d > 0 ? [40, 200, 70] : d < 0 ? [230, 50, 50] : both ? [235, 235, 235] : [30, 30, 34]; im.data.set([...col, 255], i * 4); }
  x.putImageData(im, 0, 0); return c.toDataURL();
}

// evaluate the current model against one sheet; returns per-view IoU and the weighted score
async function evaluate(sheet = 'lod1', { images = false } = {}) {
  const out = { sheet, views: {}, score: 0 };
  for (const [view, V] of Object.entries(VIEWS)) {
    const ref = await refMask(`${sheet}_${view}`);
    // first pass at a nominal scale to get our height, then render at the reference's pixel scale
    const e = frame(ortho, view), ppm = ref.h / (e.y1 - e.y0);
    const { w, h } = renderOrtho(view, ppm, { silhouette: true });
    let m = largest(openMask(fillHoles(readMask(w, h), w, h), w, h, OPEN), w, h);
    const b = bbox(m, w, h), ours = cropMask(m, w, b);
    const cut = view === 'top' ? 0 : GROUND_BAND;
    const r = compare(ref.m, ref.w, ref.h, ours, b.w, b.h, { ignoreBottom: cut });
    out.views[view] = { iou: +r.iou.toFixed(4), aspect: +r.aspect.toFixed(3), miss: +r.miss.toFixed(4), extra: +r.extra.toFixed(4) };
    if (images) out.views[view].diff = diffImage(r);
    out.score += V.weight * r.iou;
  }
  out.score = +out.score.toFixed(4);
  return out;
}

function shaded(view, w, h, { fov = 22, elev = 12, az = 40, dist = 11 } = {}) {
  renderer.setSize(w, h, false);
  if (VIEWS[view]) { const pp = 220 / 1; const e = frame(ortho, view); const ppm = Math.min((w - 20) / (e.x1 - e.x0), (h - 20) / (e.y1 - e.y0));
    const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2; Object.assign(ortho, { left: cx - w / 2 / ppm, right: cx + w / 2 / ppm, top: cy + h / 2 / ppm, bottom: cy - h / 2 / ppm, near: 0.1, far: 60 }); ortho.updateProjectionMatrix(); renderer.render(scene, ortho); }
  else { const a = (az * Math.PI) / 180, el = (elev * Math.PI) / 180; persp.fov = fov; persp.aspect = w / h; persp.position.set(Math.sin(a) * Math.cos(el) * dist, 0.7 + Math.sin(el) * dist, Math.cos(a) * Math.cos(el) * dist); persp.lookAt(0, 0.62, 0); persp.updateProjectionMatrix(); renderer.render(scene, persp); }
  return canvas.toDataURL('image/png');
}

rebuild();
window.__j = {
  THREE, scene, renderer, get car() { return car; }, get P() { return P; }, LODS,
  setP(p) { P = structuredClone(p); return rebuild(); }, setLod(l) { lod = l; return rebuild(); },
  repaint(c) { material = carMaterial(c); return rebuild(); },
  // damage({ front: 'dented', door_FL: 'detached', … }) on a fresh build; detached parts rest beside the car
  damage(states) {
    rebuild(); const H = Math.PI / 2;
    const POSE = { door_FL: { p: [-2.0, 0.07, 0.7], r: [0, 0.35, -H] }, door_RL: { p: [-2.1, 0.07, -0.9], r: [0, -0.2, -H] }, door_FR: { p: [2.0, 0.07, 0.6], r: [0, -0.3, H] }, door_RR: { p: [2.1, 0.07, -0.9], r: [0, 0.25, H] },
      front: { p: [0.5, 0.55, 3.5], r: [-0.35, 0.5, 0.15] }, back: { p: [-0.4, 0.62, -3.6], r: [0.3, -0.45, -0.1] },
      wheel_FL: { p: [-1.9, 0.15, 2.3], r: [0, 0, H] }, wheel_FR: { p: [1.9, 0.15, 2.2], r: [0, 0, H] }, wheel_RL: { p: [-1.9, 0.15, -2.4], r: [0, 0, H] }, wheel_RR: { p: [2.0, 0.15, -2.3], r: [0, 0, H] } };
    for (const [id, st] of Object.entries(states)) setState(car, scene, id, st, POSE[id]);
  },
  evaluate, shaded, wire(on) { material.wireframe = on; }, setCamD(d) { CAM_D = d; },
};
document.title = 'READY';
