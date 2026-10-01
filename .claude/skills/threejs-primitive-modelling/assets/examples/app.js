// app.js — interactive viewer + deterministic scripted mode for the primitives-only vehicles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createStage } from './kit/stage.js';
import { DamageSim } from './kit/damage.js';
import { countTris } from './kit/kit.js';
import { setInk } from './kit/ink.js';
import { bakeIntact, showIntact, wake as wakeNow } from './kit/intact.js';

const q = new URLSearchParams(location.search);
const CAPTURE = q.has('capture');
if (CAPTURE) document.getElementById('hint')?.remove();
const W = +(q.get('w') || innerWidth), H = +(q.get('h') || innerHeight);
const stage = createStage({ canvas: document.getElementById('c'), width: W, height: H, pixelRatio: CAPTURE ? 1 : Math.min(2, devicePixelRatio) });
const sim = await DamageSim.create(stage.scene, RAPIER);
let model = q.get('model') || 'cruze', car = null, mod = null, lod = +(q.get('lod') || 0);
let paint = q.get('paint') ? '#' + q.get('paint') : null, accent = q.get('accent') ? '#' + q.get('accent') : null;
const DEFAULTS = { cruze: ['#e0a520', '#d8362f'], bin: ['#2e9d57', '#d8362f'] };
const FINISH = { metalness: 0.55, roughness: 0.3 };            // metallic car paint
const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
controls.enableDamping = true; controls.target.set(0, 0.7, 0); controls.maxPolarAngle = Math.PI * 0.49;
stage.look([0, 0.75, 0], 32, 16, 7.6, 30); controls.update();
const ui = { power: 0.7 };

// scripted hit spots in CAR space: [point], [direction the impactor travels]
const SPOTS = {
  cruze: {   // kit +X is the car's LEFT
    door_L: { p: [0.95, 0.72, 0.30], d: [-1, 0, 0.1] }, door_R: { p: [-0.95, 0.72, 0.30], d: [1, 0, 0.1] },
    door_rear_L: { p: [0.95, 0.72, -0.45], d: [-1, 0, -0.1] }, door_rear_R: { p: [-0.95, 0.72, -0.45], d: [1, 0, -0.1] },
    bonnet: { p: [0.15, 1.0, 1.35], d: [0, -0.55, -0.85] }, boot: { p: [-0.1, 1.06, -1.75], d: [0, -0.5, 0.85] },
    bumper_front: { p: [0.3, 0.58, 1.86], d: [0, 0, -1] }, bumper_rear: { p: [-0.3, 0.6, -2.0], d: [0, 0, 1] },
    wheel_FL: { p: [1.0, 0.41, 1.15], d: [-1, 0, 0] }, wheel_FR: { p: [-1.0, 0.41, 1.15], d: [1, 0, 0] },
    wheel_RL: { p: [1.0, 0.41, -1.15], d: [-1, 0, 0] }, wheel_RR: { p: [-1.0, 0.41, -1.15], d: [1, 0, 0] },
    light_head_L: { p: [0.6, 0.76, 1.8], d: [0, 0, -1] }, light_head_R: { p: [-0.6, 0.76, 1.8], d: [0, 0, -1] },
    light_brake_L: { p: [0.6, 0.85, -1.95], d: [0, 0, 1] }, glass: { p: [0, 1.3, 0.5], d: [0, -0.4, -1] },
    mirror_L: { p: [1.0, 1.09, 0.6], d: [-1, 0, 0] }, spoiler: { p: [0, 1.12, -1.86], d: [0, -0.3, 1] },
    chassis: { p: [0.9, 0.62, 0.9], d: [-1, 0, 0] },
  },
  bin: {
    lid: { p: [0, 1.12, 0.12], d: [0, -1, 0.15] }, chassis: { p: [0.05, 0.62, 0.32], d: [0, 0, -1] },
    wheel_R: { p: [0.42, 0.185, -0.2], d: [-1, 0, 0] }, wheel_L: { p: [-0.42, 0.185, -0.2], d: [1, 0, 0] },
  },
};

async function load(name) {
  if (car) { stage.scene.remove(car); sim.cars.length = 0; for (const d of sim.debris) stage.scene.remove(d.part); sim.debris.length = 0; }
  mod = await import(`./${name}.js`);
  const t0 = performance.now();
  car = await mod.build({ lod, paint: paint ?? DEFAULTS[name][0], accent: accent ?? DEFAULTS[name][1], ...(name === 'cruze' ? { finish: FINISH, flair: q.has('stripes') ? { stripes: true, roundel: true } : {} } : {}) });
  const buildMs = performance.now() - t0;
  stage.scene.add(car); sim.addCar(car);
  car.userData.intactInfo = q.has('nointact') || q.has('capture-parts') ? null : bakeIntact(car, { keepSeparate: (p) => p.userData.jj?.kind === 'wheel' || p.userData.jj?.kind === 'junk' });
  model = name; car.userData.buildMs = buildMs; refreshStats();
  controls.target.set(0, name === 'bin' ? 0.55 : 0.75, 0);
  if (name === 'bin') stage.look([0, 0.55, 0], 35, 15, 4.4, 30); else stage.look([0, 0.75, 0.2], 32, 16, 7.6, 30);
}
function refreshStats() {
  const s = countTris(car), el = document.getElementById('stats'); if (!el) return;
  el.textContent = `${s.tris.toLocaleString()} tris · ${s.draws} draws · build ${car.userData.buildMs.toFixed(0)} ms · LOD${lod}`;
}
function worldOf(partId) { const s = SPOTS[model][partId]; const p = new THREE.Vector3(...s.p), d = new THREE.Vector3(...s.d); car.updateMatrixWorld(true); return { point: car.localToWorld(p), dir: d.transformDirection(car.matrixWorld) }; }
function hitPart(partId, severity = ui.power) { const { point, dir } = worldOf(partId); return sim.hit(car, { partId, point, dir, severity }); }

// ── pointer: click = hit whatever is under the cursor ─────────────────────────────────────────────────
const ray = new THREE.Raycaster(); let down = null;
stage.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
stage.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; down = null;
  const r = stage.renderer.domElement.getBoundingClientRect();
  ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, stage.camera);
  const p = sim.pick(car, ray); if (!p) return;
  const dir = ray.ray.direction.clone(); sim.hit(car, { partId: p.partId, point: p.point, dir, severity: ui.power }); flash(`${p.partId}: ${car.userData.dmg.parts[p.partId].state}`);
});
function flash(t) { const el = document.getElementById('toast'); if (!el) return; el.textContent = t; el.style.opacity = 1; clearTimeout(flash.t); flash.t = setTimeout(() => (el.style.opacity = 0), 1400); }

// ── scripted sequence (used by the capture script and the "Smash sequence" button) ─────────────────────
const BIN_SEQUENCE = [[0.0, 'chassis', 0.45], [0.5, 'lid', 0.55], [1.0, 'chassis', 0.45], [1.5, 'lid', 0.95], [2.4, 'wheel_R', 1.1], [3.0, 'wheel_R', 1.1]];
const SEQUENCE = [
  [0.0, 'bumper_front', 0.55], [0.4, 'bonnet', 0.6], [0.8, 'door_L', 0.5], [1.2, 'door_L', 0.75], [1.7, 'light_head_L', 1.0], [2.1, 'bonnet', 0.6],
  [2.6, 'door_L', 0.8], [3.2, 'wheel_FL', 0.9], [3.6, 'wheel_FL', 1.0], [4.0, 'wheel_FL', 1.0], [4.6, 'door_rear_L', 0.8], [4.9, 'door_rear_L', 0.9],
  [5.4, 'boot', 0.8], [5.7, 'boot', 0.8], [6.1, 'bonnet', 1.0], [6.5, 'glass', 1.0], [6.9, 'bumper_rear', 1.0],
];
let seqT = -1; const seqDone = new Set();
function startSequence() { reset(); seqT = 0; seqDone.clear(); }
function reset() { sim.reset(car); showIntact(car); seqT = -1; squishTarget = 0; squishK = 0; squishV = 0; if (model === 'bin') import('./bin.js').then((m) => m.crushBody(car, 0)); }

let squishTarget = 0, squishK = 0, squishV = 0;
function squish(k = 1) { squishTarget = k; }
function stepSquish(dt) {
  if (model !== 'bin') return;
  if (squishK === squishTarget && !squishV) return;
  squishV += (60 * (squishTarget - squishK) - 9 * squishV) * dt; squishK += squishV * dt; squishK = Math.max(0, squishK);
  if (Math.abs(squishTarget - squishK) < 0.002 && Math.abs(squishV) < 0.01) { squishK = squishTarget; squishV = 0; }
  import('./bin.js').then((m) => m.crushBody(car, squishK));
  const lid = car.userData.dmg.parts.lid; if (squishK > 0.45 && lid.state !== 'detached') sim.detach(car, 'lid', { dir: new THREE.Vector3(0.2, 1.4, 0.5), severity: 0.5 });
}
const clock = new THREE.Clock();
function frame(dt) {
  if (seqT >= 0) { seqT += dt; (model === 'bin' ? BIN_SEQUENCE : SEQUENCE).forEach((s, i) => { if (!seqDone.has(i) && seqT >= s[0]) { seqDone.add(i); hitPart(s[1], s[2]); } }); }
  stepSquish(dt);
  sim.step(dt);
  // lazy spin on attached wheels
  for (const [id, P] of Object.entries(car.userData.dmg.parts)) if (P.jj.kind === 'wheel' && P.state !== 'detached' && P.part.userData.spin) P.part.userData.spin.rotation.x += 0;
}
let statT = 0;
async function loop() {
  if ((statT += 1) % 20 === 0) refreshStats();
  const dt = Math.min(0.05, clock.getDelta()); frame(dt); controls.update(); stage.render(); requestAnimationFrame(loop);
}

await load(model);
const api = {
  stage, sim, get car() { return car; }, SPOTS, hitPart, reset, startSequence, load, controls, frame, refreshStats,
  step(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) frame(1 / 60); },
  render() { controls.update(); stage.render(); },
  look(t, az, el, d, fov) { stage.look(t, az, el, d, fov); controls.target.set(...t); controls.update(); },
  wake() { wakeNow(car); }, squish, setInk(on, o) { setInk(car, on, o); for (const d of sim.debris) setInk(d.part, on, o); },
  explode(t) {
    wakeNow(car); const C = new THREE.Vector3(0, 0.8, 0);
    for (const [id, P] of Object.entries(car.userData.dmg.parts)) {
      if (id === 'chassis' || P.state === 'detached') continue; const home = new THREE.Vector3(...P.part.userData.home);
      const dir = home.clone().sub(C); dir.y *= 0.4; if (P.jj.kind === 'lid') dir.set(0, 1.2, 0); if (P.jj.kind === 'glass') dir.set(0, 1, dir.z * 0.2);
      if (P.jj.kind === 'lamp' || P.jj.kind === 'bumper') dir.z *= 1.4; dir.normalize();
      const k = { wheel: 1.0, door: 1.15, lid: 1.0, bumper: 0.9, lamp: 0.75, accessory: 0.8, glass: 1.0, junk: 0.5 }[P.jj.kind] ?? 0.7;
      P.part.position.copy(home).addScaledVector(dir, k * t);
    }
  },
  setPower(p) { ui.power = p; }, setPaint(p, a) { paint = p; accent = a ?? accent; },
  async setLod(l) { lod = l; await load(model); },
  state() { return Object.fromEntries(Object.entries(car.userData.dmg.parts).map(([id, P]) => [id, { hp: Math.round(P.hp), state: P.state, dents: P.dents.length }])); },
};
window.__demo = api;
if (!CAPTURE) {
  document.getElementById('ui')?.classList.remove('hide');
  window.__ui = { api, ui, flash, startSequence, reset, load, refreshStats, SPOTS, hitPart, getModel: () => model, setPaint: async (p, a) => { if (model === 'cruze') { paint = p; accent = a; } await load(model); }, setLod: async (l) => { lod = l; await load(model); } };
  window.dispatchEvent(new Event('demo-ready')); loop();
  addEventListener('resize', () => stage.setSize(innerWidth, innerHeight));
}
document.title = 'READY';
