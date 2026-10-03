#!/usr/bin/env node
// Writes crates/jj-contracts/tests/fixtures/vehicle/<case>/ (P1-V01): a small hand-made vehicle (GLB per LOD +
// toy.asset.json) that passes the jj.vehicle.v1 contract, and broken variants that each fail one named rule
// (EXPECT holds the rule). Plain GLB 2.0 written here: boxes and prisms, one atlas material. Deterministic.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'crates', 'jj-contracts', 'tests', 'fixtures', 'vehicle');

// ---- geometry: { pos: number[] (xyz), idx: number[] } in the node's local space
const box = (sx, sy, sz, cx = 0, cy = 0, cz = 0) => {
  const pos = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) pos.push(cx + (x * sx) / 2, cy + (y * sy) / 2, cz + (z * sz) / 2);
  const f = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  return { pos, idx: f.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]) };
};
// A prism along x (wheels, the rounded cabin proxy): `n` sides of radius r in the y-z plane, width w.
const prism = (r, w, n, cx = 0, cy = 0, cz = 0, ry = r) => {
  const pos = [];
  for (const x of [-w / 2, w / 2]) for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; pos.push(cx + x, cy + ry * Math.sin(a), cz + r * Math.cos(a)); }
  const idx = [];
  for (let k = 0; k < n; k++) { const a = k, b = (k + 1) % n; idx.push(a, b, n + b, a, n + b, n + a); }
  for (let k = 1; k < n - 1; k++) idx.push(0, k + 1, k, n, n + k, n + k + 1);
  return { pos, idx };
};
// A flat grid of quads (to bust a triangle budget).
const grid = (nq, sx, sz, cy) => {
  const pos = [], idx = [];
  for (let i = 0; i <= nq; i++) for (const z of [-sz / 2, sz / 2]) pos.push(-sx / 2 + (sx * i) / nq, cy, z);
  for (let i = 0; i < nq; i++) { const a = 2 * i; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  return { pos, idx };
};

// ---- the toy car (units m, +y up, +z forward, origin on the ground between the axles)
const PARTS = {
  core: { pivot: [0, 0.3, 0], geom: () => box(1.8, 1.1, 2.4, 0, 0.55, 0), hinge: null, mass: 0.62, collider: 'convex' },
  front: { pivot: [0, 0.55, 1.75], geom: () => box(1.8, 0.5, 0.5), hinge: { axis: [1, 0, 0], min: 0, max: 25 }, mass: 0.05, collider: 'cuboid' },
  back: { pivot: [0, 0.55, -1.75], geom: () => box(1.8, 0.5, 0.5), hinge: { axis: [1, 0, 0], min: -25, max: 0 }, mass: 0.05, collider: 'cuboid' },
  door_FL: { pivot: [-0.92, 0.85, 0.5], geom: () => box(0.04, 0.8, 0.9, 0, 0, -0.45), hinge: { axis: [0, 1, 0], min: -70, max: 0 }, mass: 0.03, collider: 'cuboid' },
  door_FR: { pivot: [0.92, 0.85, 0.5], geom: () => box(0.04, 0.8, 0.9, 0, 0, -0.45), hinge: { axis: [0, 1, 0], min: 0, max: 70 }, mass: 0.03, collider: 'cuboid' },
  door_RL: { pivot: [-0.92, 0.85, -0.45], geom: () => box(0.04, 0.8, 0.9, 0, 0, -0.45), hinge: { axis: [0, 1, 0], min: -70, max: 0 }, mass: 0.03, collider: 'cuboid' },
  door_RR: { pivot: [0.92, 0.85, -0.45], geom: () => box(0.04, 0.8, 0.9, 0, 0, -0.45), hinge: { axis: [0, 1, 0], min: 0, max: 70 }, mass: 0.03, collider: 'cuboid' },
  wheel_FL: { pivot: [-0.8, 0.35, 1.3], geom: () => prism(0.35, 0.25, 8), hinge: { axis: [0, 0, 1], min: -6, max: 6 }, mass: 0.04, collider: 'capsule' },
  wheel_FR: { pivot: [0.8, 0.35, 1.3], geom: () => prism(0.35, 0.25, 8), hinge: { axis: [0, 0, 1], min: -6, max: 6 }, mass: 0.04, collider: 'capsule' },
  wheel_RL: { pivot: [-0.8, 0.35, -1.3], geom: () => prism(0.35, 0.25, 8), hinge: { axis: [0, 0, 1], min: -6, max: 6 }, mass: 0.04, collider: 'capsule' },
  wheel_RR: { pivot: [0.8, 0.35, -1.3], geom: () => prism(0.35, 0.25, 8), hinge: { axis: [0, 0, 1], min: -6, max: 6 }, mass: 0.04, collider: 'capsule' },
};
const ANCHORS = { cam_fp: [-0.35, 1.15, 0.3], cam_tp_target: [0, 1.0, 0.5], com: [0, 0.55, 0], roof_number: [0, 1.41, -0.2], lplate_front: [0, 0.6, 2.0], lplate_rear: [0, 0.6, -2.0] };
// Collider proxies in vehicle space: a rounded (12-sided) cabin hull; boxes for panels; prisms for wheels.
const proxy = (id) => {
  const p = PARTS[id];
  if (id === 'core') return prism(1.25, 1.8, 12, 0, 0.85, 0, 0.55);
  const g = p.geom();
  return { pos: g.pos.map((v, i) => v + p.pivot[i % 3]), idx: g.idx };
};

// An interior block (P1-V03): seats inside the core, exposed by the doors; in vehicle space.
const INTERIORS = { cabin: { exposedBy: ['door_FL', 'door_FR', 'door_RL', 'door_RR'], geom: () => box(1.2, 0.5, 1.0, 0, 0.7, 0) } };

function model(mut = {}) {
  const parts = Object.fromEntries(Object.entries(PARTS).map(([id, p]) => [id, { ...p, pivot: [...p.pivot] }]));
  return { parts, interiors: INTERIORS, anchors: structuredClone(ANCHORS), lodGeom: [null, null, null], skip: [{}, {}, {}], colliders: Object.fromEntries(Object.keys(PARTS).map((id) => [id, proxy(id)])), materials: 1, ...mut };
}

// ---- GLB writer
function writeGlb(nodesSpec, materials) {
  const bin = [], bufferViews = [], accessors = [], meshes = [];
  const pushView = (bytes, target) => {
    while (bin.length % 4) bin.push(0);
    bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: bytes.length, target });
    for (const b of bytes) bin.push(b);
    return bufferViews.length - 1;
  };
  const addPrim = (g, material = 0) => {
    const pos = new Float32Array(g.pos), idx = new Uint16Array(g.idx);
    const min = [0, 1, 2].map((k) => Math.min(...g.pos.filter((_, i) => i % 3 === k)));
    const max = [0, 1, 2].map((k) => Math.max(...g.pos.filter((_, i) => i % 3 === k)));
    accessors.push({ bufferView: pushView(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    const pa = accessors.length - 1;
    accessors.push({ bufferView: pushView(new Uint8Array(idx.buffer), 34963), componentType: 5123, count: idx.length, type: 'SCALAR' });
    return { attributes: { POSITION: pa }, indices: accessors.length - 1, material };
  };
  const nodes = [{ name: 'toy', children: [] }];
  for (const n of nodesSpec) {
    const node = { name: n.name };
    if (n.translation) node.translation = n.translation;
    if (n.prims) { meshes.push({ primitives: n.prims.map(([g, m]) => addPrim(g, m)) }); node.mesh = meshes.length - 1; }
    nodes.push(node);
    nodes[0].children.push(nodes.length - 1);
  }
  while (bin.length % 4) bin.push(0);
  const json = { asset: { version: '2.0', generator: 'jj contract-fixtures' }, scene: 0, scenes: [{ nodes: [0] }], nodes, meshes, accessors, bufferViews, buffers: [{ byteLength: bin.length }], materials: Array.from({ length: materials }, (_, i) => ({ name: i ? `extra-${i}` : 'atlas' })) };
  let js = Buffer.from(JSON.stringify(json));
  if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);
  const binBuf = Buffer.from(bin);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + binBuf.length, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, js, bh, binBuf]);
}

function write(name, expect, m, sidecarMut = (s) => s) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (let lod = 0; lod < 3; lod++) {
    const spec = [];
    for (const [id, p] of Object.entries(m.parts)) {
      if (m.skip[lod][id]) continue;
      const pivot = (m.lodPivot && m.lodPivot[lod] && m.lodPivot[lod][id]) || p.pivot;
      const g = (m.lodGeom[lod] && m.lodGeom[lod][id]) || p.geom();
      const prims = m.extraPrim && id === 'core' ? [[g, 0], [box(0.1, 0.1, 0.1, 0, 1.2, 0), 0]] : [[g, m.materials > 1 && id === 'back' ? 1 : 0]];
      spec.push({ name: id, translation: pivot, prims });
    }
    for (const [id, b] of Object.entries(m.interiors)) if (!(lod === 1 && m.dropInterior === id)) spec.push({ name: `interior_${id}`, prims: [[b.geom(), 0]] });
    for (const [a, t] of Object.entries(m.anchors)) if (!(lod === 0 && m.dropAnchor === a)) spec.push({ name: a, translation: t });
    if (lod === 0) for (const [id, g] of Object.entries(m.colliders)) if (g) spec.push({ name: `collider_${id}`, prims: [[g, 0]] });
    writeFileSync(join(dir, `toy.lod${lod}.glb`), writeGlb(spec, m.materials));
  }
  const sidecar = sidecarMut({
    contract: 'jj.vehicle.v1', id: 'toy', units: 'm', forward: '+z', up: '+y',
    lods: [{ file: 'toy.lod0.glb', maxTris: 1300 }, { file: 'toy.lod1.glb', maxTris: 900 }, { file: 'toy.lod2.glb', maxTris: 600 }],
    parts: Object.fromEntries(Object.entries(PARTS).map(([id, p]) => [id, { pivot: (m.sidecarPivot && m.sidecarPivot[id]) || m.parts[id].pivot, hinge: p.hinge, massFraction: p.mass, collider: { type: p.collider } }])),
    interiors: Object.fromEntries(Object.entries(m.interiors).map(([id, b]) => [id, { exposedBy: b.exposedBy }])),
    anchors: m.anchors,
    material: { count: 1, atlas: 'toy.atlas.png' },
  });
  writeFileSync(join(dir, 'toy.asset.json'), `${JSON.stringify(sidecar, null, 1)}\n`);
  writeFileSync(join(dir, 'EXPECT'), `${expect}\n`);
}

const lift = (dy) => { const m = model(); for (const p of Object.values(m.parts)) p.pivot[1] += dy; for (const a of Object.values(m.anchors)) a[1] += dy; m.colliders = Object.fromEntries(Object.keys(PARTS).map((id) => [id, id === 'core' ? prism(1.25, 1.8, 12, 0, 0.85 + dy, 0, 0.55) : { pos: PARTS[id].geom().pos.map((v, i) => v + m.parts[id].pivot[i % 3]), idx: PARTS[id].geom().idx }])); return m; };
const shiftAxles = () => { const m = model(); for (const id of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) m.parts[id].pivot[2] += 0.3; m.colliders = Object.fromEntries(Object.keys(PARTS).map((id) => [id, id === 'core' ? proxy('core') : { pos: PARTS[id].geom().pos.map((v, i) => v + m.parts[id].pivot[i % 3]), idx: PARTS[id].geom().idx }])); return m; };

write('valid', 'ok', model());
write('mass-sum', 'mass-sum', model(), (s) => { s.parts.core.massFraction = 0.54; return s; });
write('origin-ground', 'origin-ground', lift(0.1));
write('cabin-proxy-cuboid', 'cabin-proxy-cuboid', model({ colliders: { ...model().colliders, core: box(1.8, 1.1, 2.4, 0, 0.85, 0) } }));
write('part-missing-at-lod', 'part-missing-at-lod', model({ skip: [{}, { door_RL: true }, {}] }));
write('anchor-missing', 'anchor-missing', model({ dropAnchor: 'roof_number' }));
write('tri-budget', 'tri-budget', model({ lodGeom: [null, null, { core: grid(350, 1.8, 2.4, 1.1) }] }));
write('pivot', 'pivot', model({ sidecarPivot: { door_FL: [-0.92, 0.85, 0.55] } }));
write('pivot-across-lods', 'pivot', model({ lodPivot: [null, null, { door_FR: [0.92, 0.85, 0.6] }] }));
write('materials', 'materials', model({ materials: 2 }));
write('hinge', 'hinge', model(), (s) => { s.parts.door_FR.hinge.axis = [0, 0, 0]; return s; });
write('origin-axles', 'origin-axles', shiftAxles());
write('part-unknown', 'part-unknown', model(), (s) => { s.parts.spoiler = { pivot: [0, 1.4, -1.6], hinge: { axis: [1, 0, 0], min: 0, max: 30 }, massFraction: 0.0001, collider: { type: 'cuboid' } }; return s; });
write('schema', 'schema', model(), (s) => { s.paintKey = '#ffffff'; return s; });
write('collider-missing', 'collider-missing', model({ colliders: { ...model().colliders, wheel_RR: null } }));
write('draws', 'draws', model({ extraPrim: true }));
write('cabin-declared-cuboid', 'cabin-proxy-cuboid', model(), (s) => { s.parts.core.collider.type = 'cuboid'; return s; });
write('interior-missing-at-lod', 'interior', model({ dropInterior: 'cabin' }));
write('interior-exposed-by', 'interior', model(), (s) => { s.interiors.cabin.exposedBy = ['core']; return s; });
console.log(`vehicle fixtures in ${root}`);
