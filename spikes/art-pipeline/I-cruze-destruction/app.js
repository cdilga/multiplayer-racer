// app.js — viewer + deterministic evidence API for the damage-ready Cruz Missile (window.__demo).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createStage } from '../H-primitive-kit/kit/stage.js';
import { build, LODS } from './cruze.js';
import { makeTemplate, templateStats, Vehicle } from './vehicle.js';
import { carMaterials, slotMaterials } from './kit/materials.js';
import { Sim } from './sim.js';
import { selectLod, projectedPx, QualityGovernor } from './lod.js';
import { ZONES } from './fields.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') || innerWidth), H = +(q.get('h') || innerHeight);
const stage = createStage({ canvas: document.getElementById('c'), width: W, height: H, pixelRatio: 1 });
const { scene, camera, renderer } = stage;
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 0.7, 0); controls.maxPolarAngle = Math.PI * 0.495;
stage.look([0, 0.75, 0], 32, 16, 7.6, 30); controls.update();

// ── templates: build every LOD once, share geometry across cars ───────────────────────────────────────────────────────────
const buildInfo = [];
const tpls = LODS.map((_, lod) => { const t0 = performance.now(); const d = build({ lod }); const t = makeTemplate(d); buildInfo.push({ lod, buildMs: d.buildMs, morphMs: t.ms, totalMs: +(performance.now() - t0).toFixed(1), ...templateStats(t) }); return t; });
const shared = slotMaterials();
const PALETTE = ['#e0a520', '#e0392f', '#1e88e5', '#2bb673', '#8e44ad', '#b6bac3', '#f06292', '#17b3b0', '#ff8f00', '#5d6d7e'];

let sim = await Sim.create(RAPIER, scene);
let cars = [];   // { v, car? }
let bias = +(q.get('bias') || 0), autoLod = true, governor = null;

function spawn({ paint = PALETTE[cars.length % PALETTE.length], lod = 1, position = [0, 0, 0], yaw = 0, physics = false, drive = null, linvel = null } = {}) {
  const v = new Vehicle(tpls, carMaterials(paint), { lod, name: 'car' + cars.length });
  scene.add(v.root); v.root.position.set(...position); v.root.rotation.y = yaw; v.root.updateMatrixWorld(true);
  const entry = { v }; if (physics) entry.car = sim.addCar(v, { position, yaw, drive, linvel });
  cars.push(entry); return entry;
}
async function clear() {
  for (const c of cars) scene.remove(c.v.root);
  for (const d of sim.debris) scene.remove(d.part.group);
  for (const o of [...scene.children]) if (o.userData.loose) scene.remove(o);
  cars = []; sim = await Sim.create(RAPIER, scene);
}

// ── static damage poses (no physics): channels, removed parts, open hinges ─────────────────────────────────────────────────
function pose(v, { channels = {}, remove = [], open = {}, smash = false, lamps = [] } = {}) {
  if (Object.keys(channels).length || remove.length || Object.keys(open).length || smash || lamps.length) v.wake();
  for (const [k, x] of Object.entries(channels)) v.setChannel(k, x);
  for (const id of remove) { const out = v.release(id, scene); for (const P of out ?? []) { P.group.visible = false; P.group.userData.loose = true; } }
  for (const [id, a] of Object.entries(open)) { v.parts[id].state = 'loose'; v.setOpen(id, a); }
  if (smash) v.smashGlass(shared);
  for (const id of lamps) v.breakLamp(id, shared);
}
/** a single part on its own, at the origin, at a chosen deformation, oriented for inspection */
function showPart(id, { lod = 0, deform = 1, zones = 0, rot = [0, 0, 0], lift = 0.6, paint = '#e0a520' } = {}) {
  const v = new Vehicle(tpls, carMaterials(paint), { lod });
  v.wake(); for (const z of ZONES) v.setChannel(z, zones);
  for (const k of Object.keys(v.channels)) if (k.startsWith('dent_')) v.setChannel(k, deform);
  const P = v.parts[id]; v.release(id, scene); v.setPartLod(id, lod, true);
  // centre the part's bounds on the origin, then orient
  const g = P.group; g.position.set(0, 0, 0); g.quaternion.identity(); g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group(); holder.userData.loose = true; holder.add(g); g.position.sub(c);
  holder.rotation.set(...rot); holder.position.set(0, lift, 0); scene.add(holder); holder.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(holder); holder.position.y -= b2.min.y - 0.002;   // rest it on the floor
  return { size: box.getSize(new THREE.Vector3()).toArray() };
}

// ── LOD / bias driver ──────────────────────────────────────────────────────────────────────────────────────────────────
const _c = new THREE.Vector3();
function updateLods(viewH = stage.height) {
  for (const { v } of cars) {
    v.root.getWorldPosition(_c); _c.y += 0.8;
    if (autoLod) v.setLod(selectLod(projectedPx(camera, _c, 2.35, viewH), bias, v.lod));
    for (const P of Object.values(v.parts)) if (P.state === 'detached' && autoLod) {
      P.group.getWorldPosition(_c); const r = P.meta.kind === 'wheel' ? 0.45 : P.meta.kind === 'lamp' ? 0.2 : 0.8;
      // a detached part is ranked by the size of the CAR it came from: same rung as a car at that distance, so it pops in step
      v.setPartLod(P.id, selectLod(projectedPx(camera, _c, 2.35, viewH), bias, P.lod));
    }
  }
}
function counts() {
  let tris = 0, draws = 0;
  scene.traverseVisible((o) => { if (!o.isMesh || o.name === 'floor') return; draws++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3; });
  return { tris: tris | 0, draws };
}

// ── scenes ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SCENES = {
  async single({ lod = 1, paint, ...p } = {}) { await clear(); const c = spawn({ lod, paint }); autoLod = false; pose(c.v, p); return c; },
  /** 24 pristine cars on a 6×4 grid (gameplay overview camera). */
  async grid24({ lod = null, spacing = 6 } = {}) {
    await clear(); autoLod = lod == null;
    for (let i = 0; i < 24; i++) spawn({ lod: lod ?? 1, position: [((i % 6) - 2.5) * spacing, 0, (Math.floor(i / 6) - 1.5) * spacing * 1.3], yaw: (i * 0.7) % 6.28 });
  },
  /**
   * Deterministic destruction field: wrecks (fully mangled husks with velocity), loose doors/bonnets/bumpers/wheels from
   * scripted collision episodes, and active cars driving laps through it. Counts are the cohort for this benchmark only.
   */
  async field({ active = 16, wrecks = 10, settle = 6 } = {}) {
    await clear(); autoLod = true;
    const script = [];
    for (let i = 0; i < wrecks; i++) {   // a ring of cars driven into the middle at 9 m/s: a real pile-up, then scripted collision episodes
      const a = (i / wrecks) * Math.PI * 2, r = 9 + 2 * (i % 2), c = spawn({ position: [Math.cos(a) * r, 0, Math.sin(a) * r], yaw: -a - Math.PI / 2 + 0.3 * Math.sin(i * 2.1), physics: true, linvel: [-Math.cos(a) * 9, 0, -Math.sin(a) * 9] });
      script.push(c);
    }
    sim.step(1.1);
    // collision episodes in car-local space (point, impactor direction, severity): front-left smash, side door hits, roof drop, rear shunt …
    const EP = [
      { point: [0.6, 0.65, 1.8], dir: [-0.3, 0, -1], severity: 1.3 }, { point: [0.95, 0.75, 0.25], dir: [-1, 0, 0], severity: 1.25 },
      { point: [-0.95, 0.75, -0.45], dir: [1, 0, 0], severity: 1.25 }, { point: [0.1, 1.05, 1.3], dir: [0, -0.6, -0.8], severity: 1.3 },
      { point: [0, 1.55, -0.3], dir: [0, -1, 0], severity: 1.0 }, { point: [-0.5, 0.65, -2.0], dir: [0.2, 0, 1], severity: 1.3 },
      { point: [1.0, 0.41, 1.15], dir: [-1, 0, 0], severity: 1.5 }, { point: [-0.6, 0.6, 1.85], dir: [0.3, 0, -1], severity: 1.3 },
      { point: [0, 1.1, -1.75], dir: [0, -0.5, 0.85], severity: 1.4 }, { point: [-1.0, 0.41, -1.15], dir: [1, 0, 0], severity: 1.6 },
    ];
    script.forEach((c, i) => { for (let k = 0; k < 9; k++) sim.hit(c.car, EP[(i * 3 + k) % EP.length], shared); for (const k of [0, 3, 6]) sim.hit(c.car, EP[(i + k) % EP.length], shared); if (!c.v.wreck) { c.v.parts.chassis.hp = 0; sim.hit(c.car, EP[i % EP.length], shared); } });
    sim.step(settle * 0.5);
    for (let i = 0; i < active; i++) {   // active cars lapping through the field on slightly different lines
      const a = (i / active) * Math.PI * 2, rr = 14 + 3 * (i % 3);
      spawn({ position: [Math.cos(a) * rr, 0, Math.sin(a) * rr], yaw: -a, physics: true, drive: (car, t) => ({ throttle: 0.5 + 0.2 * Math.sin(t * 0.7 + i), steer: 0.35 + 0.25 * Math.sin(t * 0.4 + i * 1.3) }) });
    }
    sim.step(settle * 0.5);
  },
};

// ── frame loop + timing ─────────────────────────────────────────────────────────────────────────────────────────────────
let running = !q.has('capture'), last = performance.now(), simOn = true;
const gl = renderer.getContext(), timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
function frame() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (simOn) { sim.step(dt); for (const { v } of cars) v.step(dt, sim.time); }
  updateLods(); controls.update(); stage.render();
  if (running) requestAnimationFrame(frame);
}
if (running) requestAnimationFrame(frame);

/** measure n frames: CPU ms for sim, LOD selection, render submission; GPU ms via timer query when available; rAF pacing */
async function bench({ frames = 240, simulate = true, warm = 30 } = {}) {
  const out = { sim: [], lod: [], render: [], gpu: [], interval: [] };
  let prev = null;
  for (let i = 0; i < frames + warm; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const t0 = performance.now(); if (prev != null && i >= warm) out.interval.push(t0 - prev); prev = t0;
    if (simulate) { sim.step(1 / 60); for (const { v } of cars) v.step(1 / 60, sim.time); }
    const t1 = performance.now(); updateLods(); const t2 = performance.now();
    let qy = null; if (timer && i >= warm && i % 4 === 0) { qy = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, qy); }
    stage.render(); if (qy) gl.endQuery(timer.TIME_ELAPSED_EXT);
    gl.finish?.(); const t3 = performance.now();
    if (i >= warm) { out.sim.push(t1 - t0); out.lod.push(t2 - t1); out.render.push(t3 - t2); }
    if (qy) out._q = [...(out._q ?? []), qy];
  }
  for (const qy of out._q ?? []) { for (let k = 0; k < 50 && !gl.getQueryParameter(qy, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((r) => setTimeout(r, 5)); if (gl.getQueryParameter(qy, gl.QUERY_RESULT_AVAILABLE)) out.gpu.push(gl.getQueryParameter(qy, gl.QUERY_RESULT) / 1e6); }
  delete out._q;
  const st = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return { mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
  renderer.info.reset(); renderer.info.autoReset = false; stage.render(); const info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; renderer.info.autoReset = true;
  const lodHist = [0, 0, 0, 0]; for (const { v } of cars) lodHist[v.lod]++;
  return { frames, gpuTimer: !!timer, sim: st(out.sim), lod: st(out.lod), render: st(out.render), gpu: st(out.gpu), interval: st(out.interval), info, scene: counts(), physics: sim.stats(), lodHist, bias };
}

window.__demo = {
  THREE, stage, scene, camera, renderer, tpls, buildInfo, get cars() { return cars; }, get sim() { return sim; }, shared, LODS,
  look: (t, az, el, d, fov) => stage.look(t, az, el, d, fov), render: () => stage.render(), setSize: (w, h) => stage.setSize(w, h),
  scene: (name, opts) => SCENES[name](opts), spawn, clear, pose, showPart, counts, bench, updateLods,
  setBias: (b) => { bias = b; }, setAutoLod: (b) => { autoLod = b; }, setSim: (b) => { simOn = b; },
  step: (s) => { sim.step(s); for (const { v } of cars) v.step(s, sim.time); },
  hit: (i, ep) => sim.hit(cars[i].car, ep, shared),
  governor: (o) => (governor = new QualityGovernor(o)),
  wire: (on) => scene.traverse((o) => { if (o.isMesh && o.name !== 'floor') for (const m of [o.material].flat()) m.wireframe = on; }),
};
document.title = 'READY';
