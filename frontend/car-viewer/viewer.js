// Debug car asset viewer — proves the spike's CC0 GLB pipeline:
//   recolor method (classify + per-mesh material clone), black wheels, emissive
//   lights + neon under-glow + bloom, and a rigging test (spin/steer/suspension).
// All deps from npm (no CDN), per project rules.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0d1429');

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
camera.position.set(4, 3, 5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

scene.add(new THREE.HemisphereLight(0xbfdcff, 0x202840, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(5, 8, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0x4cc9f0, 0.7);
rim.position.set(-6, 3, -4); scene.add(rim);

const grid = new THREE.GridHelper(20, 20, 0x4cc9f0, 0x1d2a44);
scene.add(grid);

// bloom composer
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.5, 0.85);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const loader = new GLTFLoader();
const palette = ['#00ff88','#4cc9f0','#f72585','#ffd166','#ff6b35','#a78bfa','#ef476f','#06d6a0','#ffffff','#ff9f1c','#3a86ff','#8d99ae'];

// ---- per-model state --------------------------------------------------------
let current = null, manifest = { items: [] }, idx = 0;
let groups = { body: [], wheel: [], glass: [], light: [], other: [] }; // material lists
let wheelObjs = [], frontWheels = [], bodyParts = []; // rigging
let fx = null, headlightMeshes = [], taillightMeshes = [], coneObjs = [], underglow = null, underglowDisc = null, fwdArrow = null;
let roofNumber = null, nameTag = null, idNum = 7, idName = 'P7';
let bboxHelper = null, localBox = null, fwd = -1; // fwd = model forward sign along Z (explicit, not assumed)

// canvas-texture helpers for identity (roof number + billboard nametag)
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t; }
function numberTex(n) { return canvasTex(128, 128, (x, w, h) => { x.clearRect(0, 0, w, h); x.font = 'bold 104px -apple-system,Segoe UI,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 12; x.strokeStyle = 'rgba(8,12,24,.85)'; x.strokeText(String(n), w / 2, h / 2 + 4); x.fillStyle = '#fff'; x.fillText(String(n), w / 2, h / 2 + 4); }); }
function labelTex(name, col) { return canvasTex(512, 160, (x, w, h) => { x.clearRect(0, 0, w, h); const r = h * 0.4; x.fillStyle = 'rgba(8,12,24,.82)'; roundRect(x, 8, h * 0.16, w - 16, h * 0.66, r); x.fill(); x.lineWidth = 7; x.strokeStyle = col; roundRect(x, 8, h * 0.16, w - 16, h * 0.66, r); x.stroke(); x.fillStyle = '#fff'; x.font = 'bold 60px -apple-system,Segoe UI,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name, w / 2, h / 2 + 2); }); }

function classify(o) {
  const n = (o.name + ' ' + (o.material?.name || '')).toLowerCase();
  if (/wheel|tyre|tire|rim/.test(n)) return 'wheel';
  if (/glass|window|windshield|windscreen|screen/.test(n)) return 'glass';
  if (/light|lamp|headlight|tail|emiss|glow|lens/.test(n)) return 'light';
  if (/body|paint|chassis|carpaint|hull|frame|kart|cabin|cover/.test(n)) return 'body';
  return 'other';
}

function disposeCurrent() {
  if (!current) return;
  scene.remove(current);
  current.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  current = null;
  groups = { body: [], wheel: [], glass: [], light: [], other: [] };
  wheelObjs = []; frontWheels = []; bodyParts = []; headlightMeshes = []; taillightMeshes = []; coneObjs = [];
  fx = null; underglow = null; underglowDisc = null; fwdArrow = null; roofNumber = null; nameTag = null; bboxHelper = null;
}

function computeLocalBox(root) {
  const r = root.rotation.y; root.rotation.y = 0; root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.rotation.y = r; root.updateMatrixWorld(true);
  return box;
}

function emissiveSphere(color, intensity, radius) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity }));
  return m;
}

function buildFX() {
  fx = new THREE.Group(); current.add(fx);
  headlightMeshes = []; taillightMeshes = []; coneObjs = [];
  const size = localBox.getSize(new THREE.Vector3());
  const center = localBox.getCenter(new THREE.Vector3());
  const r = Math.max(0.04, size.x * 0.06);
  const y = localBox.min.y + size.y * 0.32;
  const xo = size.x * 0.28;
  // forward is EXPLICIT (fwd), not assumed. frontZ = the end the car faces.
  const frontZ = fwd < 0 ? localBox.min.z : localBox.max.z;
  const rearZ = fwd < 0 ? localBox.max.z : localBox.min.z;

  for (const sx of [-1, 1]) {
    // dimmer headlights (were ultra-bright); white-ish front, red rear
    const hl = emissiveSphere(0xfff0c0, 0.7, r); hl.position.set(center.x + sx * xo, y, frontZ); fx.add(hl); headlightMeshes.push(hl);
    const tl = emissiveSphere(0xff2b2b, 0.6, r * 0.9); tl.position.set(center.x + sx * xo, y, rearZ); fx.add(tl); taillightMeshes.push(tl);

    // CASTED CONE: SpotLight + faint volume cone, pointing FORWARD *and DOWN at the ground*.
    // One direction vector drives both light + cone so they can't disagree with `fwd`.
    const hx = center.x + sx * xo;
    const conePos = new THREE.Vector3(hx, y, frontZ);
    const dir = new THREE.Vector3(0, -0.72, fwd).normalize(); // forward + down toward road
    const groundY = localBox.min.y;
    const tHit = Math.max(0.5, (conePos.y - groundY) / -dir.y); // where the beam meets the ground
    const coneLen = tHit;                                       // stop AT the ground — no through-floor
    const spot = new THREE.SpotLight(0xfff0c0, 9, coneLen * 1.6, 0.5, 0.6, 1.2);
    spot.position.copy(conePos);
    spot.target.position.copy(conePos.clone().addScaledVector(dir, coneLen));
    fx.add(spot); fx.add(spot.target); coneObjs.push(spot);

    const cg = new THREE.ConeGeometry(size.x * 0.42, coneLen, 22, 1, true);
    cg.translate(0, -coneLen / 2, 0); cg.rotateX(-Math.PI / 2);
    const cone = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.06, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    cone.position.copy(conePos); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    fx.add(cone); coneObjs.push(cone);

    // soft oval light POOL where the beam lands — the robust ground cue (a volume cone can't occlude)
    const landing = conePos.clone().addScaledVector(dir, tHit);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(size.x * 0.45, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.scale.set(1, 1.8, 1); // oval, elongated forward
    pool.position.set(landing.x, groundY + 0.02, landing.z);
    fx.add(pool); coneObjs.push(pool);
  }

  // explicit forward-axis arrow on the ground (so front is never silently guessed)
  fwdArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, fwd), new THREE.Vector3(center.x, localBox.min.y + 0.02, frontZ), size.z * 0.6, 0x4cc9f0, size.z * 0.2, size.z * 0.12);
  fx.add(fwdArrow);

  underglow = new THREE.PointLight(0x00ff88, 3, Math.max(3, size.x * 3)); underglow.position.set(center.x, localBox.min.y - 0.05, center.z); fx.add(underglow);
  underglowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(size.x * 0.85, 28),
    new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
  underglowDisc.rotation.x = -Math.PI / 2; underglowDisc.position.set(center.x, localBox.min.y + 0.01, center.z); fx.add(underglowDisc);

  // --- identity (tests §5.4 roof number + §5.1 constant-screen-size nametag) ---
  const col = '#' + new THREE.Color($('color').value).getHexString();
  // roof number: flat decal on the roof top, read from a high/overhead camera
  roofNumber = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.55, size.x * 0.55),
    new THREE.MeshBasicMaterial({ map: numberTex(idNum), transparent: true, depthWrite: false }));
  roofNumber.rotation.x = -Math.PI / 2;
  roofNumber.position.set(center.x, localBox.max.y + 0.03, center.z);
  fx.add(roofNumber);
  // billboard nametag: Sprite with sizeAttenuation OFF → CONSTANT screen-space size (scales with
  // viewport, i.e. bigger on a 4K TV, smaller on a phone — the §5.1 behaviour to test)
  nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(idName, col), sizeAttenuation: false, depthTest: false, transparent: true }));
  const tagFrac = 0.07; // ~7% of viewport height
  nameTag.scale.set(tagFrac * (512 / 160), tagFrac, 1);
  nameTag.position.set(center.x, localBox.max.y + size.y * 0.55, center.z);
  fx.add(nameTag);

  fx.userData.baseY = 0;
  applyFX();
}

// ---- material pipeline ------------------------------------------------------
function applyMaterials() {
  const bodyColor = new THREE.Color($('color').value);
  const smart = $('classify').checked;
  const blackWheels = $('blackwheels').checked;
  const tint = (m, c) => { if (m.color) m.color.copy(c); m.needsUpdate = true; };
  const orig = (m) => m.userData.orig || new THREE.Color(0xffffff);
  if (!smart) {
    // naive: tint EVERY material (the "literally single coloured" result)
    Object.values(groups).flat().forEach((m) => tint(m, bodyColor));
    return;
  }
  groups.body.forEach((m) => tint(m, bodyColor));
  groups.wheel.forEach((m) => tint(m, blackWheels ? new THREE.Color(0x111417) : orig(m)));
  [...groups.glass, ...groups.light, ...groups.other].forEach((m) => tint(m, orig(m))); // neutral
}

function applyFX() {
  if (!fx) return;
  const lights = $('headlights').checked;
  [...headlightMeshes, ...taillightMeshes].forEach((h) => (h.visible = lights));
  const coneOn = $('cone').checked;
  coneObjs.forEach((o) => (o.visible = coneOn));
  const ug = $('underglow').checked;
  const c = new THREE.Color($('color').value);
  if (underglow) { underglow.visible = ug; underglow.color.copy(c); }
  if (underglowDisc) { underglowDisc.visible = ug; underglowDisc.material.color.copy(c); }
  if (roofNumber) roofNumber.visible = $('roofnum').checked;
  if (nameTag) { nameTag.visible = $('nametag').checked; nameTag.material.map = labelTex(idName, '#' + c.getHexString()); nameTag.material.needsUpdate = true; }
}

function applyWire() {
  const on = $('wire').checked;
  current?.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.wireframe = on)); });
}

// ---- bounding box / collider proxy (rotates with model) ---------------------
function addBBox() {
  if (!current) return;
  const grp = new THREE.Group();
  const size = localBox.getSize(new THREE.Vector3());
  const center = localBox.getCenter(new THREE.Vector3());
  const tight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color: 0xf72585 }));
  tight.position.copy(center); grp.add(tight);
  const s = 4 / Math.max(size.x, size.z);
  const cw = 2.0 / s, ch = 1.0 / s, cl = 4.0 / s;
  const proxy = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(cw, ch, cl)), new THREE.LineBasicMaterial({ color: 0x4cc9f0 }));
  proxy.position.set(center.x, localBox.min.y + ch / 2, center.z); grp.add(proxy);
  current.add(grp); bboxHelper = grp;
}

function frameObject(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const dist = Math.max(size.x, size.y, size.z) * 2.4;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(dist * 0.7, dist * 0.55, dist * 0.8));
  controls.update();
  return size;
}

// ---- load -------------------------------------------------------------------
function loadModel(file, name) {
  $('stats').innerHTML = 'loading <b>' + name + '</b>…';
  loader.load(file, (gltf) => {
    disposeCurrent();
    current = gltf.scene; scene.add(current);

    const uniqueOrig = new Set();
    let tris = 0, meshCount = 0;
    current.traverse((o) => {
      if (!o.isMesh) return;
      meshCount++;
      const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => uniqueOrig.add(m));
    });
    // clone materials per-mesh so groups can be tinted independently (key recolor step)
    current.traverse((o) => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
      else o.material = o.material.clone();
      const grp = classify(o); o.userData.group = grp;
      const tri = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        m.userData.orig = m.color ? m.color.clone() : new THREE.Color(0xffffff);
        m.userData.tris = tri;
        groups[grp].push(m);
      });
      if (grp === 'wheel') wheelObjs.push(o);
      else bodyParts.push({ mesh: o, baseY: o.position.y });
    });
    // Fallback: name-heuristics miss many packs (Quaternius doesn't name mats "body",
    // Kenney shares one). If no body found, promote the largest non-wheel/glass/light
    // material to 'paint'. Per-mesh cloning means this tints only the dominant shell.
    let fellBack = false;
    if (groups.body.length === 0 && groups.other.length) {
      let top = groups.other[0];
      for (const m of groups.other) if ((m.userData.tris || 0) > (top.userData.tris || 0)) top = m;
      groups.body.push(top);
      groups.other = groups.other.filter((m) => m !== top);
      fellBack = true;
    }
    // Re-pivot wheels so they SPIN ABOUT THEIR HUB, not orbit the model origin.
    // glTF often shares one wheel geometry across all 4 → clone per wheel first,
    // else recentering one corrupts all. (This is the per-model rigging-pivot fix.)
    wheelObjs.forEach((w) => {
      w.geometry = w.geometry.clone();
      w.geometry.computeBoundingBox();
      const c = w.geometry.boundingBox.getCenter(new THREE.Vector3());
      w.geometry.translate(-c.x, -c.y, -c.z);
      w.position.add(c.clone().multiply(w.scale).applyQuaternion(w.quaternion)); // keep in place
    });
    // front wheels = the axle furthest toward forward
    wheelObjs.sort((a, b) => a.position.z - b.position.z);
    frontWheels = wheelObjs.slice(0, Math.min(2, wheelObjs.length));

    localBox = computeLocalBox(current);
    buildFX();
    applyMaterials(); applyWire();
    const size = frameObject(current);

    const sharedWarn = (uniqueOrig.size === 1 && meshCount > 1);
    const g = (k) => groups[k].length;
    $('stats').innerHTML =
      `<b>${name}</b><br>` +
      `tris: <b>${Math.round(tris).toLocaleString()}</b> · meshes: <b>${meshCount}</b> · orig mats: <b>${uniqueOrig.size}</b><br>` +
      `size (m): ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}<br>` +
      `classify → body:<b>${g('body')}</b> wheel:<b>${g('wheel')}</b> glass:<b>${g('glass')}</b> light:<b>${g('light')}</b> other:<b>${g('other')}</b><br>` +
      `recolor: ${g('body') ? (fellBack ? '<span class="ok">✓ body (dominant-mat fallback)</span>' : '<span class="ok">✓ body (named)</span>') : '<span class="warn">✗ none</span>'}` +
      (sharedWarn ? ' · <span class="warn">⚠ 1 shared mat → normalization pass ideal</span>' : '') + '<br>' +
      `rigging: wheels <b>${wheelObjs.length}</b> ${wheelObjs.length >= 4 ? '<span class="ok">✓ separable</span>' : '<span class="warn">✗</span>'}` +
      ` · front axle: ${frontWheels.length === 2 ? '<span class="ok">✓</span>' : '<span class="warn">?</span>'} · ` +
      `light meshes: ${g('light') ? '<span class="ok">' + g('light') + '</span>' : '<span class="warn">0 (faked)</span>'}`;

    if (bboxHelper) { bboxHelper = null; }
    if ($('bbox').checked) addBBox();
  }, undefined, (err) => { $('stats').innerHTML = '<span class="warn">failed: ' + name + '</span><br>' + err; });
}

// ---- UI ---------------------------------------------------------------------
function select(i) { idx = i; $('model').value = i; const it = manifest.items[i]; loadModel(it.file, it.name); }
function buildUI() {
  const sel = $('model'); let last = '';
  manifest.items.forEach((it, i) => {
    if (it.group !== last) { const og = document.createElement('optgroup'); og.label = it.group; sel.appendChild(og); last = it.group; }
    const opt = document.createElement('option'); opt.value = i; opt.textContent = it.name; sel.lastChild.appendChild(opt);
  });
  $('count').textContent = manifest.items.length;
  sel.onchange = () => select(+sel.value);
  $('prev').onclick = () => select((idx - 1 + manifest.items.length) % manifest.items.length);
  $('next').onclick = () => select((idx + 1) % manifest.items.length);
  $('color').oninput = () => { applyMaterials(); applyFX(); };
  $('classify').onchange = applyMaterials;
  $('blackwheels').onchange = applyMaterials;
  $('headlights').onchange = applyFX;
  $('cone').onchange = applyFX;
  $('underglow').onchange = applyFX;
  $('roofnum').onchange = applyFX;
  $('nametag').onchange = applyFX;
  $('flipfwd').onclick = () => { // forward is explicit + adjustable, not silently assumed
    fwd = -fwd;
    if (fx) { current.remove(fx); fx.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    buildFX();
  };
  $('wire').onchange = applyWire;
  $('grid').onchange = () => (grid.visible = $('grid').checked);
  $('bbox').onchange = () => { if (bboxHelper) { bboxHelper.parent?.remove(bboxHelper); bboxHelper = null; } if ($('bbox').checked) addBBox(); };
  $('rig').onchange = () => { if (!$('rig').checked) resetRig(); };
  const sw = $('swatches');
  palette.forEach((c) => { const d = document.createElement('div'); d.className = 'sw'; d.style.background = c; d.onclick = () => { $('color').value = c; applyMaterials(); applyFX(); }; sw.appendChild(d); });
  window.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') $('prev').click(); if (e.key === 'ArrowRight') $('next').click(); });
}

function resetRig() { bodyParts.forEach((b) => (b.mesh.position.y = b.baseY)); frontWheels.forEach((w) => (w.rotation.y = 0)); if (fx) fx.position.y = 0; }

// ---- boot -------------------------------------------------------------------
fetch('/debug-cars/manifest.json').then((r) => r.json()).then((m) => {
  manifest = m; buildUI();
  const start = manifest.items.findIndex((it) => it.name === (m.starter?.[0] || 'hatchback-sports'));
  select(start >= 0 ? start : 0);
});

function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); composer.setSize(w, h); bloomPass.resolution.set(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

window.__v = { THREE, camera, controls, scene, get current() { return current; } }; // debug/screenshot hook
const clock = new THREE.Clock(); let t = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta(); t += dt;
  if (current && $('rotate').checked) current.rotation.y += dt * 0.6;
  if (current && $('rig').checked) {
    wheelObjs.forEach((w) => (w.rotation.x += dt * 7));        // wheel spin (roll)
    const steer = Math.sin(t * 1.4) * 0.5;
    frontWheels.forEach((w) => (w.rotation.y = steer));         // steering
    const bob = Math.sin(t * 3.2) * (localBox ? localBox.getSize(new THREE.Vector3()).y * 0.05 : 0.05);
    bodyParts.forEach((b) => (b.mesh.position.y = b.baseY + bob)); // suspension travel
    if (fx) fx.position.y = bob; // lights/cone ride the body (fix: were decoupled from suspension)
  }
  controls.update();
  if ($('bloom').checked) composer.render(); else renderer.render(scene, camera);
});
