// The vehicle viewer (br-bwju.1, P1-D03b): one WebGL canvas that loads a roster vehicle's baked GLBs (the same files the
// game loads) and shows them at any LOD, in any damage state, in any seat paint. Self-hosted three (R70); no vehicle names
// live here: everything comes from the car's review.json (generated from the roster data by tools/vehicles/review/build.mjs).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// The paint key: pure-white atlas texels take the car colour, everything else keeps its colour (tools/vehicles/view/view.js).
function paintKeyMaterial(src) {
  const paint = { value: new THREE.Color('#22c3e6') };
  const m = new THREE.MeshStandardMaterial({ map: src.map, emissiveMap: src.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.2, flatShading: true, roughness: 0.55, metalness: 0.05 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.paint = paint;
    sh.fragmentShader = 'uniform vec3 paint;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float paintMask = step( 0.985, min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) );
      diffuseColor.rgb *= mix( vec3( 1.0 ), paint, paintMask );`);
  };
  m.customProgramCacheKey = () => 'jj-paint-key';
  return { material: m, paint };
}

const DEG = Math.PI / 180;
// Part groups, derived from the roster's part names (front/back/door_*/wheel_*): no vehicle-specific list.
export function groupOf(name) {
  if (name.startsWith('door_')) return 'doors';
  if (name.startsWith('wheel_')) return 'wheels';
  if (name === 'front' || name === 'back') return name;
  return null;
}

export class VehicleViewer {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#d9dbe0');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a8a90', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.7); fill.position.set(-6, 3, -4); this.scene.add(fill);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.28 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.camera.position.set(4.9, 2.4, 5.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.7, 0); this.controls.enableDamping = true; this.controls.autoRotate = true; this.controls.autoRotateSpeed = 1.6;
    this.controls.minDistance = 4; this.controls.maxDistance = 16; this.controls.maxPolarAngle = Math.PI * 0.49;
    this.state = { lod: 0, damage: {}, paint: null };
    this.cache = new Map();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // review: the car's review.json; base: the folder URL it was fetched from.
  async load(review, base) {
    this.review = review; this.base = base; this.current?.root.removeFromParent(); this.current = null; this.cache.clear();
    this.hinges = Object.fromEntries(review.damage.parts.map((p) => [p.name, p]));
    this.state = { lod: 0, damage: {}, paint: null };
    await this.setLod(0);
  }

  async setLod(i) {
    this.state.lod = i;
    const key = `${this.review.id}:${i}`;
    if (!this.cache.has(key)) {
      const gltf = await new GLTFLoader().loadAsync(new URL(this.review.turntable.lods[i].glb, this.base).href);
      const root = gltf.scene.children[0];
      let pk = null; const parts = {};
      root.traverse((o) => {
        if (o.name) parts[o.name] = o;
        if (!o.isMesh) return;
        if (o.name.startsWith('collider_')) { o.visible = false; return; }
        pk ??= paintKeyMaterial(o.material);
        o.material = pk.material; o.castShadow = true;
      });
      for (const n of Object.keys(parts)) if (n.startsWith('interior_')) parts[n].visible = false;
      const rest = Object.fromEntries(Object.entries(parts).map(([n, o]) => [n, { p: o.position.clone(), q: o.quaternion.clone() }]));
      this.cache.set(key, { root, parts, rest, paint: pk.paint });
    }
    this.current?.root.removeFromParent();
    this.current = this.cache.get(key); this.scene.add(this.current.root);
    this.apply();
  }

  setDamage(group, mode) { this.state.damage[group] = mode; this.apply(); }
  setAllDamage(mode, groups) { for (const g of groups) this.state.damage[g] = mode; this.apply(); }
  setPaint(hex) { this.state.paint = hex; this.apply(); }

  // intact -> loose (swung about the part's hinge, to near its limit) -> detached (lying beside the car).
  apply() {
    const c = this.current; if (!c) return;
    const exposed = new Set();
    for (const [name, p] of Object.entries(this.hinges)) {
      const node = c.parts[name], r = c.rest[name]; if (!node) continue;
      node.position.copy(r.p); node.quaternion.copy(r.q);
      const mode = this.state.damage[groupOf(name)] ?? 'intact';
      if (mode === 'intact' || !groupOf(name)) continue;
      exposed.add(name);
      const side = Math.sign(r.p.x) || 1, g = groupOf(name);
      if (mode === 'loose' && p.hinge) {
        const { axis, min, max } = p.hinge;
        const ang = (Math.abs(min) > Math.abs(max) ? min : max) * (g === 'wheels' ? 1 : 0.85);
        node.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), ang * DEG));
      } else if (mode === 'detached') {
        if (g === 'doors') { node.position.set(r.p.x + side * 1.5, 0.05, r.p.z); node.rotation.set(0, 0, side * Math.PI / 2 * -1); }
        else if (g === 'wheels') { node.position.set(r.p.x + side * 1.4, r.p.y, r.p.z + (r.p.z > 0 ? 0.9 : -0.9)); }
        else if (g === 'front') { node.position.set(0, 0.35, r.p.z + 2.6); node.rotation.set(Math.PI * 0.62, 0, 0); }
        else if (g === 'back') { node.position.set(0, 0.35, r.p.z - 2.6); node.rotation.set(-Math.PI * 0.62, 0, 0); }
      }
    }
    // Interior blocks show wherever a part that exposes them is not intact (the roster's own exposedBy rules).
    for (const [block, by] of Object.entries(this.review.damage.interiors)) {
      const node = c.parts[`interior_${block}`]; if (node) node.visible = by.some((n) => exposed.has(n));
    }
    c.paint.value.set(this.state.paint ?? '#22c3e6');
  }

  dispose() { this.ro.disconnect(); this.renderer.setAnimationLoop(null); this.renderer.dispose(); this.renderer.domElement.remove(); }
}

// Builds the toggle bar for a viewer: LOD, damage per part group (and presets) and seat paints. Returns the element.
export function viewerControls(viewer, review) {
  const el = document.createElement('div'); el.className = 'vcontrols';
  const row = (label) => { const r = document.createElement('div'); r.className = 'vrow'; r.innerHTML = `<span class="vlabel">${label}</span>`; el.append(r); return r; };
  const btn = (parent, text, on, { pressed = false, swatch } = {}) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = swatch ? '' : text; b.setAttribute('aria-pressed', String(pressed)); b.title = text;
    if (swatch) { b.className = 'swatch'; b.style.background = swatch; b.setAttribute('aria-label', text); }
    b.addEventListener('click', () => { for (const s of parent.querySelectorAll('button')) s.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); on(); });
    parent.append(b); return b;
  };
  const lodRow = row('LOD'); const lodBox = document.createElement('div'); lodBox.className = 'vbtns'; lodRow.append(lodBox);
  const stats = document.createElement('span'); stats.className = 'vstats'; lodRow.append(stats);
  const showStats = (i) => { const l = review.turntable.lods[i]; stats.textContent = `${l.tris} tris of ${l.maxTris}, ${l.draws} draws`; stats.dataset.ok = String(l.withinBudget); };
  review.turntable.lods.forEach((l, i) => btn(lodBox, `LOD${i}`, async () => { await viewer.setLod(i); showStats(i); }, { pressed: i === 0 }));
  showStats(0);

  const groups = [...new Set(review.damage.parts.map((p) => groupOf(p.name)).filter(Boolean))];
  const dmgRow = row('Damage'); const presets = document.createElement('div'); presets.className = 'vbtns'; dmgRow.append(presets);
  const selects = {};
  const sync = () => { for (const g of groups) selects[g].value = viewer.state.damage[g] ?? 'intact'; };
  for (const [mode, text] of [['intact', 'Intact'], ['loose', 'All loose'], ['detached', 'All detached']]) btn(presets, text, () => { viewer.setAllDamage(mode, groups); sync(); }, { pressed: mode === 'intact' });
  const partRow = row('Parts'); const partBox = document.createElement('div'); partBox.className = 'vselects'; partRow.append(partBox);
  for (const g of groups) {
    const lab = document.createElement('label'); lab.textContent = g;
    const sel = document.createElement('select');
    for (const m of ['intact', 'loose', 'detached']) sel.add(new Option(m, m));
    sel.addEventListener('change', () => { viewer.setDamage(g, sel.value); for (const s of presets.querySelectorAll('button')) s.setAttribute('aria-pressed', 'false'); });
    selects[g] = sel; lab.append(sel); partBox.append(lab);
  }
  const paintRow = row('Paint'); const paintBox = document.createElement('div'); paintBox.className = 'vbtns swatches'; paintRow.append(paintBox);
  btn(paintBox, 'Default paint', () => viewer.setPaint(null), { pressed: true, swatch: '#22c3e6' });
  review.paints.colours.forEach((c, i) => btn(paintBox, `Seat ${i + 1}, ${c.name}`, () => viewer.setPaint(c.hex), { swatch: c.hex }));
  const spin = row('View'); const sb = document.createElement('button'); sb.type = 'button'; sb.textContent = 'Spin'; sb.setAttribute('aria-pressed', 'true');
  sb.addEventListener('click', () => { viewer.controls.autoRotate = !viewer.controls.autoRotate; sb.setAttribute('aria-pressed', String(viewer.controls.autoRotate)); });
  const hint = document.createElement('span'); hint.className = 'vstats'; hint.textContent = 'Drag to turn, scroll or pinch to zoom';
  spin.append(sb, hint);
  return el;
}
