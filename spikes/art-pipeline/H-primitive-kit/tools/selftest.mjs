#!/usr/bin/env node
// selftest.mjs — prove the gates catch what they claim to. Starts from the good baked asset, applies one deliberate defect at a time
// (in a temp copy) and asserts the INTENDED rule fails, then runs the untouched asset as the control (must pass everything).
//   node tools/selftest.mjs [assetDir=asset/cruze]      exit 1 if any defect slips through or the control fails
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGlb, writeGlb, readAccessor } from './glb.mjs';
import { validateDir, Reporter, getBudget, setBudget } from './validate_asset.mjs';

const SRC = path.resolve(process.argv[2] ?? 'asset/cruze'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jj-selftest-'));
const nodeIdx = (json, name) => json.nodes.findIndex((n) => n.name === name);
const nodesWithPrefix = (json, prefixes) => json.nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh != null && prefixes.some((p) => n.name === p || n.name.startsWith(p + ':')));
function editPositions(json, bin, prefixes, fn) {          // rewrite POSITION floats in the binary chunk + fix accessor min/max
  const done = new Set();
  for (const [n] of nodesWithPrefix(json, prefixes)) for (const p of json.meshes[n.mesh].primitives) {
    if (done.has(p.attributes.POSITION)) continue; done.add(p.attributes.POSITION);      // primitives of one mesh share a vertex buffer: edit each accessor once
    const a = json.accessors[p.attributes.POSITION], bv = json.bufferViews[a.bufferView], base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = bv.byteStride || 12, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    for (let i = 0; i < a.count; i++) { const o = base + i * stride, q = fn([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]); for (let k = 0; k < 3; k++) { dv.setFloat32(o + 4 * k, q[k], true); mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); } }
    a.min = mn; a.max = mx;
  }
}
const bboxOf = (json, bin, prefixes) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const [n] of nodesWithPrefix(json, prefixes)) for (const p of json.meshes[n.mesh].primitives) { const a = readAccessor(json, bin, p.attributes.POSITION); for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[i + k]); mx[k] = Math.max(mx[k], a[i + k]); } } return [mn, mx]; };
const setNodeY = (json, name, dy) => { const n = json.nodes[nodeIdx(json, name)]; if (n.matrix) n.matrix[13] += dy; else n.translation = [n.translation?.[0] ?? 0, (n.translation?.[1] ?? 0) + dy, n.translation?.[2] ?? 0]; };

// each defect: [id, rule expected to FAIL, description, mutate({json, bin, sidecar, lod}) (runs on every LOD unless `lods`), options]
const D = [
  ['wheel_pivot_off', 'pivots.wheels', 'wheel mesh shifted 0.4 m off its hub pivot', ({ json, bin }) => editPositions(json, bin, ['wheel_FL'], (p) => [p[0] + 0.4, p[1], p[2]])],
  ['hinge_centred', 'pivots.hinges', 'door mesh re-centred on its origin (cannot hinge)', ({ json, bin }) => { const [mn, mx] = bboxOf(json, bin, ['door_L']); const c = mn.map((m, k) => (m + mx[k]) / 2); editPositions(json, bin, ['door_L'], (p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]); }],
  ['collider_missing', 'nodes.required', 'col_bonnet removed', ({ json }) => { json.nodes[nodeIdx(json, 'col_bonnet')].name = 'x_bonnet'; }],
  ['mass_sum', 'mass.sum', 'door mass fraction +5%', ({ json }) => { json.nodes[nodeIdx(json, 'door_L')].extras.jj_mass_fraction += 0.05; }],
  ['forward_flipped', 'space.forward', 'head/brake lamp nodes swapped (forward is +Z)', ({ json }) => { for (const s of ['L', 'R']) { const a = json.nodes[nodeIdx(json, 'light_head_' + s)], b = json.nodes[nodeIdx(json, 'light_brake_' + s)]; [a.name, b.name] = [b.name, a.name]; [a.extras.jj_part, b.extras.jj_part] = [a.name, b.name]; } }],
  ['no_vertex_colours', 'vertex_colours', 'COLOR_0 stripped from every primitive', ({ json }) => { json.meshes.forEach((m) => m.primitives.forEach((p) => delete p.attributes.COLOR_0)); }],
  ['collider_has_material', 'colliders.no_material', 'collider given a material', ({ json }) => { json.meshes[json.nodes[nodeIdx(json, 'col_door_L')].mesh].primitives[0].material = 0; }],
  ['coarse_body_as_lod1', 'dent.resolution', 'the distant LOD3 mesh shipped as the baseline LOD1', null, { swapLod1With: 3 }],
  ['hinge_axis_flipped', 'rig.hinge_direction', 'door jj_axis sign flipped', ({ json }) => { const x = json.nodes[nodeIdx(json, 'door_L')].extras; x.jj_axis = x.jj_axis.map((v) => -v); }],
  ['sidecar_drift', 'sidecar.agreement', 'sidecar CoM moved 0.3 m from the GLB', ({ sidecar }) => { sidecar.anchors.com[1] += 0.3; }],
  ['material_not_semantic', 'materials.semantic', 'jj_paint renamed', ({ json }) => { json.materials.find((m) => m.name === 'jj_paint').name = 'body_paint'; }],
  ['lamps_not_emissive', 'materials.emissive', 'headlight emissive zeroed', ({ json }) => { json.materials.find((m) => m.extras?.jj_semantic === 'headlight').emissiveFactor = [0, 0, 0]; }],
  ['extras_missing_joint', 'extras.parts', 'door_R lost jj_joint', ({ json }) => { delete json.nodes[nodeIdx(json, 'door_R')].extras.jj_joint; }],
  ['roof_anchor_low', 'anchors', 'roof_number below the roof', ({ json }) => { const n = json.nodes[nodeIdx(json, 'roof_number')]; if (n.matrix) n.matrix[13] = 1.0; else n.translation[1] = 1.0; }],
  ['wheels_lifted', 'space.origin', 'all wheels 5 cm above the ground plane', ({ json }) => { for (const w of ['FL', 'FR', 'RL', 'RR']) setNodeY(json, 'wheel_' + w, 0.05); }],
  ['cabin_is_box', 'colliders.shape', 'col_cabin replaced by 8 box corners', ({ json, bin }) => { let i = 0; const C = [[-0.6, 1.0, -1], [0.6, 1.0, -1], [0.6, 1.5, -1], [-0.6, 1.5, -1], [-0.6, 1.0, 0.8], [0.6, 1.0, 0.8], [0.6, 1.5, 0.8], [-0.6, 1.5, 0.8]]; editPositions(json, bin, ['col_cabin'], () => C[i++ % 8]); }],
  ['over_budget', 'budget.triangles', 'triangle budget halved (an over-heavy asset)', null, { budgetScale: 0.5 }],
  ['lamp_misplaced', 'recog.lamps', 'headlamp moved 0.3 m up the bonnet', ({ json }) => { setNodeY(json, 'light_head_L', 0.3); }],
  ['roofline_lowered', 'recog.roofline', 'roof chopped 0.15 m (a coupe, not a Cruze)', ({ json, bin }) => editPositions(json, bin, ['chassis'], (p) => [p[0], p[1] > 1.2 ? p[1] - 0.15 : p[1], p[2]])],
  ['wheel_radius_lie', 'sidecar.agreement', 'sidecar wheel radius 0.5 vs mesh 0.41', ({ sidecar }) => { sidecar.wheels.wheel_FL.radius = 0.5; }],
  ['door_not_detachable', 'rig.detach', 'door marked non-detachable', ({ json }) => { json.nodes[nodeIdx(json, 'door_L')].extras.jj_detachable = false; }],
  ['chassis_hull_high', 'colliders.underbody', 'col_chassis floating 0.4 m above the underbody', ({ json, bin }) => editPositions(json, bin, ['col_chassis'], (p) => [p[0], p[1] + 0.4, p[2]])],
  ['extra_texture_count', 'budget.textures', 'a second image added', ({ json }) => { json.images = [...(json.images ?? []), { ...(json.images?.[0] ?? { bufferView: 0, mimeType: 'image/png' }) }]; }],
  ['wheel_steer_missing', 'rig.wheels', 'front wheel lost its steer node reference', ({ json }) => { delete json.nodes[nodeIdx(json, 'wheel_FL')].extras.jj_steer_node; }],
  ['trim_missing', 'nodes.required', 'bumper_front_trim decoration node removed', ({ json }) => { json.nodes[nodeIdx(json, 'bumper_front_trim')].name = 'x_trim'; }],
];

function makeCase(id, mutate, opts = {}) {
  const dir = path.join(TMP, id); fs.mkdirSync(dir, { recursive: true });
  const sidecar = JSON.parse(fs.readFileSync(path.join(SRC, 'cruze.asset.json'), 'utf8'));
  for (const e of sidecar.lods) {
    const srcFile = path.join(SRC, opts.swapLod1With != null && e.lod === 1 ? `cruze.lod${opts.swapLod1With}.glb` : e.file), { json, bin } = readGlb(srcFile);
    if (mutate) mutate({ json, bin, sidecar, lod: e.lod });
    writeGlb(path.join(dir, e.file), json, bin);
  }
  fs.writeFileSync(path.join(dir, 'cruze.asset.json'), JSON.stringify(sidecar));
  return dir;
}

const base = structuredClone(getBudget());
let slipped = 0; const rows = [];
// control
{ const rep = new Reporter({ only: [], quiet: true }); validateDir(SRC, rep); const ok = rep.fail === 0; rows.push(['(control: untouched asset)', '—', ok ? 'PASS' : 'FAIL', `${rep.pass} pass / ${rep.fail} fail`]); if (!ok) { slipped++; rep.lines.filter((l) => !l.ok).slice(0, 5).forEach((l) => console.log('  control failure:', l.id, l.detail)); } }
for (const [id, expect, desc, mutate, opts] of D) {
  const dir = makeCase(id, mutate, opts ?? {});
  if (opts?.budgetScale) { const b = structuredClone(base); for (const k of ['triangles', 'primitives', 'bytes']) for (const l of Object.keys(b[k])) b[k][l] = Math.round(b[k][l] * opts.budgetScale); setBudget(b); }
  const rep = new Reporter({ only: [], quiet: true }); validateDir(dir, rep); setBudget(base);
  const hit = rep.lines.some((l) => !l.ok && l.id === expect), others = [...new Set(rep.lines.filter((l) => !l.ok && l.id !== expect).map((l) => l.id))];
  if (!hit) slipped++;
  rows.push([id, expect, hit ? 'CAUGHT' : 'MISSED', desc + (others.length ? `  (also: ${others.slice(0, 3).join(', ')})` : '')]);
}
const w = [Math.max(...rows.map((r) => r[0].length)), Math.max(...rows.map((r) => r[1].length))];
console.log(`${'DEFECT'.padEnd(w[0])}  ${'EXPECTED RULE'.padEnd(w[1])}  RESULT  DETAIL`);
for (const r of rows) console.log(`${r[0].padEnd(w[0])}  ${r[1].padEnd(w[1])}  ${r[2].padEnd(6)}  ${r[3]}`);
console.log(`--- selftest: ${rows.length - slipped}/${rows.length} as expected ---`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(slipped ? 1 : 0);
