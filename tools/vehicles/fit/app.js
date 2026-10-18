// app.js (br-bwju.3, Spike J's evaluator for any code-built vehicle): the fit page for art/vehicles/<car>/.
// index.html?car=<id> loads the car's model.js (build(P, lod), LODS), atlas.js (drawAtlas, DEFAULT_COLOURS) and params.json,
// and the masks tools/vehicles/fit/extract.mjs cut from its reference sheets.
// window.__fit = { setP, setLod, shaded(view, w, h, cam), evaluate(sheet, { images }), P }.
// Pixel evaluation: render the silhouette from each reference view, push it through the same fill/open/largest pipeline as
// the reference masks, scale it to the reference's height and score IoU. The bottom band is left out: the references have a
// contact shadow the segmenter can't tell from tyre rubber.
import * as THREE from 'three';
import { fillHoles, openMask, largest, bbox, cropMask, compare } from './mask.js';

const car = new URLSearchParams(location.search).get('car');
const base = `/art/vehicles/${car}/`;
const { build, LODS } = await import(`${base}model.js`);
const { drawAtlas, DEFAULT_COLOURS } = await import(`${base}atlas.js`);
const P0 = await (await fetch(`${base}params.json`, { cache: 'no-store' })).json();
const SHEETS = await (await fetch(`${base}refs/sheets.json`, { cache: 'no-store' })).json();

// The same opening radius as extract.mjs used on the reference (sheets.json `open`), so thin parts count alike.
const OPEN = SHEETS.open ?? 5, KEEP = SHEETS.keep ?? 0, GROUND_BAND = 0.125;
// The sheets are perspective renders; CAM_D is the camera distance from the car centre (Spike J calibrated 10 m).
let CAM_D = SHEETS.camD ?? 10; // sheets.json `camD`: a bike's sheet is rendered from much further away (br-bwju.11)
export const VIEWS = {
  side: { dir: [1, 0, 0], up: [0, 1, 0], weight: 0.4 }, // lengths and heights
  top: { dir: [0, 1, 0], up: [0, 0, -1], weight: 0.3 }, // widths
  front: { dir: [0, Math.sin(SHEETS.tilt?.front ?? 0.14), Math.cos(SHEETS.tilt?.front ?? 0.14)], up: [0, 1, 0], weight: 0.15 },
  rear: { dir: [0, Math.sin(SHEETS.tilt?.rear ?? 0.12), -Math.cos(SHEETS.tilt?.rear ?? 0.12)], up: [0, 1, 0], weight: 0.15 },
};
export const setTilt = (f, r) => { VIEWS.front.dir = [0, Math.sin(f), Math.cos(f)]; VIEWS.rear.dir = [0, Math.sin(r), -Math.cos(r)]; };
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#c9c9cb');
scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a90', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
scene.add(sun);
const fill = new THREE.DirectionalLight('#dfe8ff', 0.7);
fill.position.set(-6, 3, -4); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

/** The atlas as a texture: drawAtlas rows run top to bottom, the model's UVs have v up. */
function material(colours = DEFAULT_COLOURS) {
  const { width, height, base: px } = drawAtlas(colours), flipped = new Uint8Array(px.length), row = width * 4;
  for (let y = 0; y < height; y++) flipped.set(px.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  const tex = new THREE.DataTexture(flipped, width, height, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return new THREE.MeshLambertMaterial({ map: tex, flatShading: true });
}
let P = structuredClone(P0), lod = 0, model = null;
const mat = material();
function rebuild() {
  if (model) scene.remove(model.group);
  model = build(P, lod);
  model.group.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; if (o.name.startsWith('interior_')) o.visible = false; } });
  scene.add(model.group);
  return model.stats;
}

const persp = new THREE.PerspectiveCamera(24, 1, 0.1, 100), ortho = new THREE.OrthographicCamera();
// projected extent of the visible meshes in the camera aimed along a view
function extent(cam, view) {
  const V = VIEWS[view], dir = new THREE.Vector3(...V.dir).normalize();
  const box = new THREE.Box3().setFromObject(model.group), ctr = box.getCenter(new THREE.Vector3());
  cam.up.set(...V.up); cam.position.copy(ctr).addScaledVector(dir, 20); cam.lookAt(ctr); cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse, v = new THREE.Vector3();
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  model.group.updateMatrixWorld(true);
  model.group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
  });
  return { x0, x1, y0, y1 };
}
function renderSilhouette(view, pxPerM) {
  const V = VIEWS[view], dir = new THREE.Vector3(...V.dir).normalize(), box = new THREE.Box3().setFromObject(model.group);
  const ctr = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = persp;
  cam.up.set(...V.up); cam.position.copy(ctr).addScaledVector(dir, CAM_D); cam.lookAt(ctr);
  cam.aspect = 1; cam.fov = (2 * Math.atan((R * 1.15) / (CAM_D - R)) * 180) / Math.PI; cam.near = 0.05; cam.far = CAM_D + 2 * R;
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  let y0 = 1, y1 = -1; const v = new THREE.Vector3();
  model.group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(cam); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
  });
  const e = extent(ortho, view), w = Math.ceil((pxPerM * (e.y1 - e.y0) * 2) / (y1 - y0)), h = w;
  renderer.setSize(w, h, false);
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const bg = scene.background; scene.background = new THREE.Color(0); ground.visible = false;
  renderer.render(scene, cam);
  scene.overrideMaterial = null; scene.background = bg; ground.visible = true;
  return { w, h };
}
function readMask(w, h) {
  const gl = renderer.getContext(), px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[(h - 1 - y) * w + x] = px[(y * w + x) * 4] > 127 ? 1 : 0;
  return m;
}

const refCache = {};
async function refMask(key) {
  if (refCache[key]) return refCache[key];
  const img = new Image(); img.src = `${base}refs/masks/${key}.mask.png`; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height).data, m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
  return (refCache[key] = { m, w: img.width, h: img.height });
}
function diffImage(r) {
  const c = document.createElement('canvas'); c.width = r.W; c.height = r.H;
  const x = c.getContext('2d'), im = x.createImageData(r.W, r.H);
  for (let i = 0; i < r.W * r.H; i++) {
    const d = r.diff[i], col = d > 0 ? [40, 200, 70] : d < 0 ? [230, 50, 50] : r.both[i] ? [235, 235, 235] : [30, 30, 34];
    im.data.set([...col, 255], i * 4);
  }
  x.putImageData(im, 0, 0);
  return c.toDataURL();
}

/** Scores the current model against one sheet: per-view IoU (green = ours only, red = reference only) and the weighted sum. */
async function evaluate(sheet = 'lod1', { images = false } = {}) {
  const out = { sheet, views: {}, score: 0 };
  for (const [view, V] of Object.entries(VIEWS)) {
    const ref = await refMask(`${sheet}_${view}`);
    const e = extent(ortho, view), ppm = ref.h / (e.y1 - e.y0);
    const { w, h } = renderSilhouette(view, ppm);
    const m = largest(openMask(fillHoles(readMask(w, h), w, h), w, h, OPEN), w, h, KEEP), b = bbox(m, w, h), ours = cropMask(m, w, b);
    const r = compare(ref.m, ref.w, ref.h, ours, b.w, b.h, { ignoreBottom: view === 'top' ? 0 : GROUND_BAND });
    out.views[view] = { iou: +r.iou.toFixed(4), aspect: +r.aspect.toFixed(3), miss: +r.miss.toFixed(4), extra: +r.extra.toFixed(4) };
    if (images) out.views[view].diff = diffImage(r);
    out.score += V.weight * r.iou;
  }
  out.score = +out.score.toFixed(4);
  return out;
}

/** A shaded render: a named view (orthographic, fitted) or a free perspective camera { az, elev, dist, fov }. */
function shaded(view, w, h, { fov = 22, elev = 12, az = 40, dist = 11 } = {}) {
  renderer.setSize(w, h, false);
  if (VIEWS[view]) {
    const e = extent(ortho, view), ppm = Math.min((w - 20) / (e.x1 - e.x0), (h - 20) / (e.y1 - e.y0));
    const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2;
    Object.assign(ortho, { left: cx - w / 2 / ppm, right: cx + w / 2 / ppm, top: cy + h / 2 / ppm, bottom: cy - h / 2 / ppm, near: 0.1, far: 60 });
    ortho.updateProjectionMatrix(); renderer.render(scene, ortho);
  } else {
    const a = (az * Math.PI) / 180, el = (elev * Math.PI) / 180;
    persp.fov = fov; persp.aspect = w / h;
    persp.position.set(Math.sin(a) * Math.cos(el) * dist, 0.7 + Math.sin(el) * dist, Math.cos(a) * Math.cos(el) * dist);
    persp.up.set(0, 1, 0); persp.lookAt(0, 0.62, 0); persp.updateProjectionMatrix(); renderer.render(scene, persp);
  }
  return canvas.toDataURL('image/png');
}

rebuild();
window.__fit = {
  get P() { return P; }, LODS,
  setP(p) { P = structuredClone(p); return rebuild(); },
  setLod(l) { lod = l; return rebuild(); },
  setCamD(d) { CAM_D = d; },
  setTilt,
  evaluate, shaded,
};
document.title = 'READY';
