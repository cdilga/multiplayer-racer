// contract.js — turn a kit-built vehicle into a CONTRACT scene that satisfies the same node/extras/material/collider/anchor rules
// as the Blender track (spikes/art-pipeline/G-cruze-v2/ASSET-CONTRACT.md):
//   * glTF space: +Y up, FORWARD = −Z, right = +X, metres, origin on the ground midway between the axles.
//     (kit space is +Z forward, so every position/vertex is rotated half a turn about Y: (x,y,z) → (−x,y,−z).)
//   * a `chassis` root node; parts are its descendants (mirrors are children of the front doors); anchors are empties
//   * hinged parts have their origin on the hinge line, wheels at the hub, suspension at the top mount
//   * collider proxies `col_<part>`: box (panels), convex hull (bumpers, chassis, cabin), cylinder (wheels); no material
//   * `jj_*` node extras and semantic materials `jj_<semantic>[_variant]` with extras.jj_semantic; emissive lamps
//   * vertex colours (COLOR_0) carry the baked shading: dirt, AO. The runtime paint shader tints `jj_paint` by identity colour.
//     PROCEDURAL PROFILE DIFFERENCES vs the Blender profile (validated by tools/validate_asset.mjs, documented in the sidecar):
//       - dents are runtime vertex edits, not authored morph targets  (sidecar.deformation.mode = 'runtime-vertex')
//       - paint mask texture is replaced by vertex colours + tint      (sidecar.textures.mode = 'vertex-colour')
//       - the only texture is one 256×128 trim atlas (grille/slats)   (sidecar.textures.trim)
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROT = new THREE.Matrix4().makeRotationY(Math.PI);
const mirror = (p) => [-p[0], p[1], -p[2]];
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r3 = (a) => a.map(r4);

// kit material kind → [contract semantic, material name, PBR overrides]
const SEM = {
  paint: ['paint', 'jj_paint'], accent: ['accent', 'jj_accent'], rubber: ['tyre', 'jj_tyre'], alloy: ['wheel', 'jj_wheel'],
  metal: ['metal', 'jj_metal'], chrome: ['metal', 'jj_metal_chrome'], glass: ['glass', 'jj_glass'],
  gloss: ['plastic', 'jj_plastic_gloss'], satin: ['plastic', 'jj_plastic'], matte: ['underside', 'jj_underside'], trim: ['plastic', 'jj_plastic_trim'],
  headlight: ['headlight', 'jj_headlight', '#fff3d0'], brakelight: ['brakelight', 'jj_brakelight', '#ff4a3c'], indicator: ['indicator', 'jj_indicator', '#ffb020'],
  emit: ['headlight', 'jj_headlight_fog', '#e8e2c8'],
};

function exportMaterial(kind, src, cache) {
  const [semantic, name, emissive] = SEM[kind] ?? (() => { throw new Error('no semantic for kit material kind ' + kind); })();
  if (cache.has(name)) return cache.get(name);
  const m = new THREE.MeshStandardMaterial({ name, vertexColors: true, color: src.color ? src.color.clone() : new THREE.Color('#fff'), roughness: src.roughness ?? 0.6, metalness: src.metalness ?? 0 });
  if (src.map) m.map = src.map;
  if (kind === 'glass') { m.transparent = true; m.opacity = 0.82; }
  if (emissive) { m.color.set('#000000'); m.vertexColors = true; m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 1; }
  m.userData = { jj_semantic: semantic, jj_kit_kind: kind };
  cache.set(name, m); return m;
}

function bakeMesh(src, parentMatrix, name, matCache) {
  const g = src.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
  const textured = !!src.material.map;
  if (!textured) g.deleteAttribute('uv');
  g.applyMatrix4(parentMatrix);                                      // rotation only: positions AND normals stay correct
  if (!g.index) { const n = g.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
  const m = new THREE.Mesh(g, exportMaterial(src.userData.kind, src.material, matCache));
  m.name = name; return m;
}

/** several baked meshes → ONE mesh with one primitive per material (the contract wants the mesh on the part node itself) */
function combine(name, meshes) {
  if (!meshes.length) return null;
  if (meshes.length === 1) { meshes[0].name = name; return meshes[0]; }
  const sorted = [...meshes].sort((a, b) => (a.material.name < b.material.name ? -1 : a.material.name > b.material.name ? 1 : 0));
  const m = new THREE.Mesh(mergeGeometries(sorted.map((s) => s.geometry), true), sorted.map((s) => s.material)); m.name = name; return m;
}
const boxOf = (meshes) => { const b = new THREE.Box3(); for (const m of meshes) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox); } return b; };

/** deterministic sparse point set for a convex hull: keep the outermost point per (angle, z) bin around the given axis */
function hullPoints(positions, { angBins = 14, zBins = 8, axisY }) {
  const zs = positions.map((p) => p.z), z0 = Math.min(...zs), z1 = Math.max(...zs), best = new Map();
  for (const p of positions) {
    const a = Math.atan2(p.x, p.y - axisY), ai = Math.floor(((a + Math.PI) / (2 * Math.PI)) * angBins) % angBins, zi = Math.min(zBins - 1, Math.floor(((p.z - z0) / (z1 - z0 + 1e-9)) * zBins));
    const r = Math.hypot(p.x, p.y - axisY), key = ai * 100 + zi, cur = best.get(key);
    if (!cur || r > cur.r) best.set(key, { p, r });
  }
  return [...best.values()].map((v) => v.p);
}
const uniqueVerts = (g) => { const s = new Set(); const p = g.attributes.position; for (let i = 0; i < p.count; i++) s.add(`${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`); return s.size; };

export const HINGE_OPEN = { door: 70, lid: 60 };

/** @returns {{scene: THREE.Group, meta: object}} */
export function toContractScene(car, { lod = 1, massKg = 1200, drive = 'FWD' } = {}) {
  car.updateMatrixWorld(true);
  const parts = car.userData.parts, matCache = new Map(), nodes = {}, meta = { parts: {}, wheels: {}, suspension: {}, anchors: {}, colliders: {}, materials: {}, notes: [] };
  
  // ── chassis: root node carries its own multi-primitive mesh ────────────────────────────────────────────
  const chassisMeshes = [];
  parts.chassis.children.forEach((m) => { if (m.isMesh) chassisMeshes.push(bakeMesh(m, ROT, `chassis:${m.userData.kind}`, matCache)); });
  const root = combine('chassis', chassisMeshes); root.name = 'chassis'; nodes.chassis = root; root.userData._world = [0, 0, 0];
  const chassisPaintGeom = chassisMeshes.filter((m) => m.name.endsWith(':paint')).map((m) => m.geometry);

  // ── generic parts: the part node IS a mesh (one primitive per material); textured decoration goes to a `<part>_trim` child ──
  const order = Object.keys(parts).filter((k) => parts[k].userData.jj && k !== 'chassis');
  order.sort((a, b) => (parts[a].userData.jj.attach?.startsWith?.('door') ? 1 : 0) - (parts[b].userData.jj.attach?.startsWith?.('door') ? 1 : 0));   // parents first (mirrors hang off doors)
  const trimNodes = {};
  for (const id of order) {
    const P = parts[id], jj = P.userData.jj, wp = mirror(P.getWorldPosition(new THREE.Vector3()).toArray());
    const own = [], trim = [], hub = [];
    if (jj.kind === 'wheel') {
      const orient = P.getObjectByName('orient'); orient.updateMatrix();
      const full = new THREE.Matrix4().multiplyMatrices(ROT, new THREE.Matrix4().makeRotationY(orient.rotation.y));
      orient.getObjectByName('spin').children.forEach((m) => { if (m.isMesh) own.push(bakeMesh(m, full, `${id}:${m.userData.kind}`, matCache)); });
      orient.getObjectByName('hub')?.children.forEach((m) => { if (m.isMesh) hub.push(bakeMesh(m, full, `${id}_hub:${m.userData.kind}`, matCache)); });
    } else {
      P.children.forEach((m) => { if (!m.isMesh) return; const b = bakeMesh(m, ROT, `${id}:${m.userData.kind}`, matCache); (b.material.map ? trim : own).push(b); });
    }
    const node = combine(id, own) ?? new THREE.Group(); node.name = id; nodes[id] = node; node.userData._world = wp; node.userData._meshes = [...own, ...trim];
    const parent = jj.attach && nodes[jj.attach] ? nodes[jj.attach] : root;
    if (jj.kind === 'wheel') {
      // front wheels: wheel_XX_steer (steer, at the hub) → wheel_XX (spin, mesh) [+ wheel_XX_hub sibling: brake disc/caliper, does not spin]; rear: wheel_XX directly
      let holder = root, local = wp;
      if (jj.steer) { const st = new THREE.Group(); st.name = id + '_steer'; st.position.set(...wp); root.add(st); nodes[id + '_steer'] = st; holder = st; local = [0, 0, 0]; }
      node.position.set(...local); holder.add(node);
      const hubNode = combine(id + '_hub', hub) ?? new THREE.Group();
      hubNode.name = id + '_hub'; hubNode.position.set(...local);
      hubNode.userData = { jj_part_of: id, jj_trim: false, jj_note: 'non-spinning brake hardware (empty at lower LODs so node names match across LODs)' };
      holder.add(hubNode);
    } else {
      const pw = parent === root ? [0, 0, 0] : parent.userData._world;
      node.position.set(wp[0] - pw[0], wp[1] - pw[1], wp[2] - pw[2]); parent.add(node);
    }
    if (trim.length) { const tn = combine(id + '_trim', trim); tn.userData = { jj_part_of: id, jj_trim: true }; node.add(tn); trimNodes[id + '_trim'] = id; }
  }
  // the contract's decoration nodes: give every asset the same two trim slots (boot trim = plate recess on the boot lid)
  if (!nodes.boot.getObjectByName('boot_trim') && parts.boot) {
    const tb = new THREE.Group(); tb.name = 'boot_trim'; tb.userData = { jj_part_of: 'boot', jj_trim: true, jj_note: 'decoration slot (no geometry at this detail level)' }; nodes.boot.add(tb); trimNodes.boot_trim = 'boot';
  }

  // ── joints / extras ──────────────────────────────────────────────────────────────────────────
  const setX = (id, x) => { Object.assign(nodes[id].userData, x); };
  const massSum = Object.values(parts).reduce((s, p) => s + (p.userData.jj?.massFraction ?? 0), 0);
  root.userData = { jj_part: 'chassis', jj_mass_fraction: parts.chassis.userData.jj.massFraction, jj_joint: 'fixed', jj_detachable: false, jj_dent: [] };
  for (const id of order) {
    const jj = parts[id].userData.jj, sgn = jj.side ?? 0;
    const x = { jj_part: id, jj_mass_fraction: jj.massFraction, jj_joint: jj.joint, jj_attach: jj.attach ?? 'chassis', jj_detachable: !!jj.detachable, jj_hp: jj.hp, jj_kind: jj.kind };
    if (jj.kind === 'door') { x.jj_axis = [0, jj.side > 0 ? -1 : 1, 0]; x.jj_range_deg = [0, HINGE_OPEN.door]; x.jj_open_sign = 'positive rotation about jj_axis swings the free edge outward'; }
    if (jj.kind === 'lid') { x.jj_axis = id === 'bonnet' ? [1, 0, 0] : [-1, 0, 0]; x.jj_range_deg = [0, HINGE_OPEN.lid]; x.jj_open_sign = 'positive rotation about jj_axis lifts the free edge'; }
    if (jj.kind === 'wheel') { x.jj_axis_spin = [-1, 0, 0]; if (jj.steer) { x.jj_axis_steer = [0, 1, 0]; x.jj_range_steer_deg = [-35, 35]; x.jj_steer_node = id + '_steer'; } x.jj_driven = !!jj.driven; }
    if (jj.kind === 'suspension') { x.jj_axis = [0, 1, 0]; x.jj_range_deg = DIM_SUSP_TRAVEL; x.jj_range_unit = 'm'; }
    x.jj_dent = ['door', 'lid', 'bumper'].includes(jj.kind) ? [`${id}_dent`] : [];
    x.jj_dent_mode = x.jj_dent.length ? 'runtime-vertex' : undefined;
    setX(id, x);
    meta.parts[id] = { node: id, mass_fraction: jj.massFraction, joint: jj.joint, attach: x.jj_attach, detachable: x.jj_detachable, dents: x.jj_dent, kind: jj.kind, hp: jj.hp };
  }
  meta.parts.chassis = { node: 'chassis', mass_fraction: root.userData.jj_mass_fraction, joint: 'fixed', attach: null, detachable: false, dents: ['chassis_dent'], kind: 'core' };
  root.userData.jj_dent = ['chassis_dent']; root.userData.jj_dent_mode = 'runtime-vertex';

  // ── anchors ───────────────────────────────────────────────────────────────────────────────────
  for (const k of ['lplate_front', 'lplate_rear', 'cam_fp', 'cam_tp_target', 'com', 'exhaust_0', 'roof_number']) {
    const o = new THREE.Object3D(); o.name = k; o.position.set(...mirror(parts[k].position.toArray())); o.userData = { jj_anchor: k };
    if (k === 'roof_number') o.userData.jj_note = 'local +Y is the roof normal; the game overlays the race-number roundel here';
    root.add(o); meta.anchors[k] = r3(o.position.toArray());
  }

  // ── wheels / suspension metadata (glTF space) ─────────────────────────────────────────────────
  for (const id of order.filter((i) => parts[i].userData.jj.kind === 'wheel')) {
    const jj = parts[id].userData.jj, n = id, pos = nodes[id].userData._world;
    meta.wheels[n] = { hub: r3(pos), radius: jj.radius, width: jj.width, steer: !!jj.steer, driven: !!jj.driven, hub_node: id, steer_node: jj.steer ? id + '_steer' : null };
  }
  for (const id of order.filter((i) => parts[i].userData.jj.kind === 'suspension')) {
    const jj = parts[id].userData.jj, n = 'wheel_' + id.slice(5), w = meta.wheels[n], top = nodes[id].userData._world;
    meta.suspension[n] = { top_mount: r3(top), hub: w.hub, rest_length: r4(top[1] - w.hub[1]), travel: DIM_SUSP_TRAVEL };
  }

  // ── colliders (no material; children of their part; local space) ──────────────────────────────
  const addCollider = (partId, shape, geom) => {
    const cn = 'col_' + partId; const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial()); m.name = cn; m.userData = { jj_collider: { shape, part: partId } };
    nodes[partId].add(m); nodes[partId].userData.jj_collider = cn;
    const verts = uniqueVerts(geom); meta.colliders[cn] = { shape, part: partId, verts }; return m;
  };
  for (const id of order) {
    const jj = parts[id].userData.jj, meshes = nodes[id].userData._meshes;
    if (!meshes.length) continue;
    if (jj.kind === 'door' || jj.kind === 'lid') { const b = boxOf(meshes), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()); addCollider(id, 'box', new THREE.BoxGeometry(s.x, s.y, s.z).translate(c.x, c.y, c.z)); }
    else if (jj.kind === 'bumper') {
      const pts = []; meshes.forEach((m) => { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 220))) pts.push(new THREE.Vector3().fromBufferAttribute(p, i)); });
      const hp = hullPoints(pts, { angBins: 10, zBins: 3, axisY: pts.reduce((s, p) => s + p.y, 0) / pts.length });
      addCollider(id, 'convex', new ConvexGeometry(hp));
    } else if (jj.kind === 'wheel') {
      addCollider(id, 'cylinder', new THREE.CylinderGeometry(jj.radius, jj.radius, jj.width, 16).rotateZ(Math.PI / 2));
    }
  }
  // chassis: lower-body hull + cabin hull
  const cp = []; chassisPaintGeom.forEach((g) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) cp.push(new THREE.Vector3().fromBufferAttribute(p, i)); });
  const lower = cp.filter((p) => p.y < 0.98), upper = cp.filter((p) => p.y > 0.93);
  const colC = addCollider('chassis', 'convex', new ConvexGeometry(hullPoints(lower, { angBins: 16, zBins: 9, axisY: 0.65 }))); colC.name = 'col_chassis';
  const colB = new THREE.Mesh(new ConvexGeometry(hullPoints(upper, { angBins: 12, zBins: 6, axisY: 1.15 })), new THREE.MeshBasicMaterial()); colB.name = 'col_cabin'; colB.userData = { jj_collider: { shape: 'convex', part: 'chassis' } };
  root.add(colB); meta.colliders.col_cabin = { shape: 'convex', part: 'chassis', verts: uniqueVerts(colB.geometry) };
  root.userData.jj_collider = ['col_chassis', 'col_cabin']; meta.colliders.col_chassis = meta.colliders.col_chassis;

  // ── bounds (visual only) ──────────────────────────────────────────────────────────────────────
  const bb = new THREE.Box3(); const tmpBox = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isMesh && !o.name.startsWith('col_')) { o.geometry.computeBoundingBox(); tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); bb.union(tmpBox); } });
  meta.bounds = { min: r3(bb.min.toArray()), max: r3(bb.max.toArray()) };
  meta.mass_kg = massKg; meta.mass_fraction_sum = r4(massSum); meta.drive = drive;
  meta.com = meta.anchors.com;
  root.traverse((o) => { if (o.userData) { delete o.userData._meshes; delete o.userData._world; } });
  // material map for the sidecar
  matCache.forEach((m, name) => { meta.materials[name] = m.userData.jj_semantic; });
  const scene = new THREE.Scene(); scene.name = 'cruze'; scene.add(root);
  scene.userData = { jj_contract: 'jj-vehicle/0.1-draft+procedural', jj_lod: lod };
  return { scene, meta };
}
const DIM_SUSP_TRAVEL = [-0.1, 0.12];
