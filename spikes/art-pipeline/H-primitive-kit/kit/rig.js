// rig.js — the runtime handle a game needs for a contract vehicle asset (GLB + sidecar), driven ONLY by the contract:
// node names, `jj_*` extras and semantic materials. No knowledge of how the asset was made (code, Blender, image-to-3D).
//
//   const gltf = await new GLTFLoader().loadAsync('cruze.lod1.glb');  const rig = createVehicleRig(gltf.scene, sidecar);
//   rig.setPaint('#e0392f');  rig.setSteer(0.4);  rig.setWheelSpin(angle);  rig.setLights({ head: true, brake: braking });
//   rig.openPanel('door_L', 0.6);  rig.setSuspension('wheel_FL', -0.05);  rig.dent('door_L', worldPoint, worldDir, { severity: 0.7 });
//   const debris = rig.detach('door_L');   // → { node, massKg, collider: {shape, vertices} } for the physics side
import * as THREE from 'three';
import { dentGeometry, restoreGeometry } from './damage.js';
import { ownGeometry } from './instance.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Intact fast path for a LOADED template (call once, before cloning per car): merge every non-wheel, non-suspension mesh into one mesh per
 *  material and hide the sources. ~60 draws/car → ~20. Any part motion, dent or detach calls rig.wake() to swap back to the parts. */
export function bakeIntactTemplate(scene) {
  scene.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert(), buckets = new Map(), sources = [];
  scene.traverse((o) => {
    if (!o.isMesh || o.name.startsWith('col_') || o.userData.jjIntactSource) return;
    for (let p = o; p; p = p.parent) if (/^(wheel_|susp_)/.test(p.name)) return;
    const g = o.geometry.clone(), m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
    if (g.attributes.color) { const c = g.attributes.color, a = new Float32Array(c.count * 3); for (let i = 0; i < c.count; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
    g.applyMatrix4(m); const key = o.material.uuid; if (!buckets.has(key)) buckets.set(key, { mat: o.material, list: [] }); buckets.get(key).list.push(g); sources.push(o);
  });
  const proxy = new THREE.Group(); proxy.name = 'intact_proxy'; proxy.userData.jjIntactProxy = true;
  for (const b of buckets.values()) { const mesh = new THREE.Mesh(mergeGeometries(b.list, false), b.mat); mesh.castShadow = mesh.receiveShadow = true; proxy.add(mesh); }
  scene.add(proxy); sources.forEach((o) => { o.userData.jjIntactSource = true; o.visible = false; });
  return { meshes: proxy.children.length, sources: sources.length };
}

const WHEELS = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
const V = (a) => new THREE.Vector3(...a);

export function createVehicleRig(root, sidecar) {
  const byName = (n) => root.getObjectByName(n), extras = (o) => o?.userData ?? {};
  const rig = { root, sidecar, home: new Map(), detached: new Map() };
  root.traverse((o) => { if (o.name) rig.home.set(o.name, { pos: o.position.clone(), quat: o.quaternion.clone(), parent: o.parent }); });

  // materials: clone the shared ones once so two cars from one loaded scene can carry different paint / lights
  const mats = { paint: [], headlight: [], brakelight: [], indicator: [] };
  const cloned = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.name.startsWith('col_')) return;
    const m = o.material, sem = m.userData?.jj_semantic; if (!m) return;
    if (!cloned.has(m)) { const c = m.clone(); c.userData = { ...m.userData }; cloned.set(m, c); if (mats[sem]) mats[sem].push(c); }
    o.material = cloned.get(m);
  });
  root.traverse((o) => { if (o.name.startsWith('col_')) o.visible = false; });          // colliders never render

  // ── paint / identity ────────────────────────────────────────────────────────────────────────────────
  rig.setPaint = (hex) => mats.paint.forEach((m) => m.color.set(hex));                   // tint × baked COLOR_0 shading
  // ── lights ─────────────────────────────────────────────────────────────────────────────────────────
  rig.setLights = ({ head, brake, indicator } = {}) => {
    const set = (list, on, lo = 0, hi = 1) => list.forEach((m) => { m.emissiveIntensity = on ? hi : lo; m.color.setScalar(on ? 1 : 0.12); });
    if (head !== undefined) set(mats.headlight, head, 0.15, 1); if (brake !== undefined) set(mats.brakelight, brake, 0.2, 1.6); if (indicator !== undefined) set(mats.indicator, indicator, 0.2, 1.4);
  };
  // ── wheels ─────────────────────────────────────────────────────────────────────────────────────────
  rig.wheels = WHEELS.map((id) => { const n = byName(id), x = extras(n), steer = x.jj_steer_node ? byName(x.jj_steer_node) : null, box = steer ?? n; return { id, node: n, steerNode: steer, box, steerAxis: x.jj_axis_steer ? V(x.jj_axis_steer) : null, spinAxis: V(x.jj_axis_spin ?? [-1, 0, 0]), rangeSteer: x.jj_range_steer_deg ?? [0, 0], hubY: box.position.y }; });
  rig.setSteer = (rad) => rig.wheels.forEach((w) => { if (w.steerAxis && w.steerNode) { const lim = (w.rangeSteer[1] * Math.PI) / 180; w.steerNode.quaternion.copy(rig.home.get(w.steerNode.name).quat).multiply(new THREE.Quaternion().setFromAxisAngle(w.steerAxis, THREE.MathUtils.clamp(rad, -lim, lim))); } });
  rig.setWheelSpin = (rad, id) => rig.wheels.forEach((w) => { if (!id || id === w.id) w.node.quaternion.setFromAxisAngle(w.spinAxis, rad); });
  rig.setSuspension = (id, dy) => { const w = rig.wheels.find((q) => q.id === id), t = sidecar.suspension?.[id]?.travel ?? [-0.1, 0.12]; if (w) w.box.position.y = w.hubY + THREE.MathUtils.clamp(dy, t[0], t[1]); };
  // ── hinged panels ──────────────────────────────────────────────────────────────────────────────────
  rig.openPanel = (id, t01) => { const n = byName(id), x = extras(n); if (!x.jj_axis) return; if (t01 > 0) rig.wake(); const max = ((x.jj_range_deg?.[1] ?? 60) * Math.PI) / 180; n.quaternion.copy(rig.home.get(id).quat).multiply(new THREE.Quaternion().setFromAxisAngle(V(x.jj_axis), max * THREE.MathUtils.clamp(t01, 0, 1))); };
  // ── damage ─────────────────────────────────────────────────────────────────────────────────────────
  rig.meshesOf = (id) => { const out = [], n = byName(id); const rec = (o) => { if (o.isMesh && !o.name.startsWith('col_')) out.push(o); for (const c of o.children) { if (c.userData?.jj_part && c.userData.jj_part !== id) continue; rec(c); } }; rec(n); return out; };
  rig.dentRecords = [];
  rig.dent = (id, worldPoint, worldDir, { severity = 0.7 } = {}) => {
    rig.wake();
    const radius = 0.16 + 0.14 * severity, depth = 0.028 + 0.075 * severity;
    const apply = (partId, r, d, scuff) => rig.meshesOf(partId).forEach((m) => { if (!['paint', 'underside'].includes(m.material.userData?.jj_semantic)) return; ownGeometry(m); m.updateWorldMatrix(true, false); const inv = new THREE.Matrix4().copy(m.matrixWorld).invert(); dentGeometry(m.geometry, worldPoint.clone().applyMatrix4(inv), worldDir.clone().transformDirection(inv), { radius: r, depth: d, scuff, seed: rig.dentRecords.length + 1 }); });
    apply(id, radius, depth, 0.45); if (id !== 'chassis') apply('chassis', radius * 1.3, depth * 1.4, 0);        // the shell behind a panel takes it too
    rig.dentRecords.push({ part: id, pos: worldPoint.toArray(), dir: worldDir.toArray(), radius, depth, severity });
  };
  rig.reset = () => { rig.dentRecords.length = 0; rig.wake(); root.traverse((o) => { if (o.isMesh) restoreGeometry(o.geometry); }); for (const d of rig.detached.values()) d.parent.add(d.node); rig.detached.clear(); rig.home.forEach((h, n) => { const o = byName(n); if (o) { o.position.copy(h.pos); o.quaternion.copy(h.quat); } }); rig.rest(); };
  // ── detach: hand the physics side everything it needs, contract-only ──────────────────────────────────────
  rig.detach = (id) => {
    rig.wake();
    const n = byName(id), x = extras(n), col = byName('col_' + id); n.updateWorldMatrix(true, false);
    const world = n.matrixWorld.clone(), parent = n.parent; root.parent ? root.parent.attach(n) : n.removeFromParent();
    let collider = null; if (col?.isMesh) { const p = col.geometry.attributes.position, v = new Float32Array(p.array); collider = { shape: extras(col).jj_collider?.shape, vertices: v, node: col.name }; }
    const rec = { node: n, massKg: (x.jj_mass_fraction ?? 0) * (sidecar.physics?.mass_kg ?? 1000), collider, world, parent }; rig.detached.set(id, rec); return rec;
  };
  // ── intact fast path (present when the template was prepared with bakeIntactTemplate) ─────────────────────────────
  const proxy = root.getObjectByName('intact_proxy'), sources = [];
  root.traverse((o) => { if (o.userData?.jjIntactSource) sources.push(o); });
  rig.intact = !!proxy;
  rig.wake = () => { if (proxy && proxy.visible) { proxy.visible = false; sources.forEach((o) => (o.visible = true)); } };
  rig.rest = () => { if (proxy) { proxy.visible = true; sources.forEach((o) => (o.visible = false)); } };
  if (proxy) rig.rest();
  rig.paintMaterials = mats.paint;
  return rig;
}

/** LOD selection by projected car height in pixels, with hysteresis so cars at a boundary don't flicker between meshes.
 *  Thresholds come from the captures: the car is still readable at ~46 px (LOD3), gameplay detail matters from ~110 px (LOD1), hero above ~260 px.
 *  Pass the previous LOD as `current`; returns the new LOD index. Never a player cap: this only chooses mesh detail. */
export const LOD_PX = [260, 110, 46];                           // min projected height for LOD0, LOD1, LOD2 (else LOD3)
export function pickLod(projectedPx, current = null, hysteresis = 0.12, thresholds = LOD_PX) {
  const pure = thresholds.findIndex((t) => projectedPx >= t); const want = pure < 0 ? thresholds.length : pure;
  if (current == null || want === current) return want;
  if (want < current) return projectedPx >= thresholds[want] * (1 + hysteresis) ? want : current;        // gaining detail needs a margin
  return projectedPx < thresholds[current] * (1 - hysteresis) ? want : current;                          // losing detail needs a margin
}
export function projectedHeightPx(camera, worldPos, heightM, viewportH) {
  const d = camera.position.distanceTo(worldPos); return (heightM / (2 * d * Math.tan((camera.fov * Math.PI) / 360))) * viewportH;
}
