#!/usr/bin/env node
// validate_asset.mjs — vehicle contract + performance validator for CODE-DEFINED (procedural) vehicle assets.
// Node port of spikes/art-pipeline/G-cruze-v2/validator/validate_asset.py (same rule ids where the rule still applies) plus the
// procedural-profile rules: vertex-colour shading, runtime dent resolution, hard perf budgets, LOD consistency, hinge direction
// and recognition gates measured against the reference-derived spec (recog/spec.js).
//
//   node tools/validate_asset.mjs <dir with *.asset.json + glbs> [--budgets tools/budgets.json] [--json out.json] [--only rule,rule]
// Prints one line per rule: "PASS <id> <detail>" / "FAIL <id> <detail>" / "INFO …"; exits 1 on any FAIL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Glb, readAccessor, primTriangles, bbox, centre, apply } from './glb.mjs';
import { TOY, REAL, polyY } from '../recog/spec.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
let BUDGET = JSON.parse(fs.readFileSync(opt('--budgets', path.join(HERE, 'budgets.json')), 'utf8'));
export const setBudget = (b) => { BUDGET = b; };
export const getBudget = () => BUDGET;
const ONLY = opt('--only', '')?.split(',').filter(Boolean);

// ── contract constants (ASSET-CONTRACT.md) ───────────────────────────────────────────────────────────────────────────
const WHEELS = ['FL', 'FR', 'RL', 'RR'], DOORS = ['door_L', 'door_R', 'door_rear_L', 'door_rear_R'], BUMPERS = ['bumper_front', 'bumper_rear'], MIRRORS = ['mirror_L', 'mirror_R'];
const LIGHTS = ['light_head_L', 'light_head_R', 'light_brake_L', 'light_brake_R'], LIDS = ['bonnet', 'boot'], PANELS = [...LIDS, ...DOORS, ...BUMPERS];
const PART_NODES = [...LIDS, ...DOORS, ...BUMPERS, 'glass', ...LIGHTS, ...MIRRORS, ...WHEELS.map((w) => 'wheel_' + w), ...WHEELS.map((w) => 'susp_' + w)];
const OPTIONAL = ['spoiler'];                                           // optional archetype flair; validated when present
const TRIMS = { bumper_front_trim: 'bumper_front', boot_trim: 'boot' };
const ANCHORS = ['cam_fp', 'cam_tp_target', 'com', 'exhaust_0', 'lplate_front', 'lplate_rear', 'roof_number'];
const COLLIDERS = ['col_chassis', 'col_cabin', ...PANELS.map((p) => 'col_' + p), ...WHEELS.map((w) => 'col_wheel_' + w)];
const SEMANTICS = new Set(['paint', 'tyre', 'wheel', 'glass', 'plastic', 'metal', 'headlight', 'brakelight', 'interior', 'decal', 'underside', 'indicator', 'accent']);
const EMISSIVE = new Set(['headlight', 'brakelight', 'indicator']);
const T = { originY: 0.01, originZ: 0.05, pivot: 0.02, collFit: 0.15, mass: 1e-3, unit: 1e-3, sidecar: 0.01, anchorCentre: 0.1, anchorExtreme: 0.15, underbody: 0.14 };
const len = (v) => Math.hypot(...v), sub = (a, b) => a.map((x, i) => x - b[i]), sc = (a, s) => a.map((x) => x * s);

class Reporter {
  constructor({ only = ONLY, quiet = false } = {}) { this.pass = 0; this.fail = 0; this.lines = []; this.only = only; this.quiet = quiet; }
  report(id, ok, detail) { if (this.only?.length && !this.only.some((o) => id.startsWith(o))) return; ok ? this.pass++ : this.fail++; this.lines.push({ id, ok, detail }); if (!this.quiet) console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); }
  info(id, detail) { if (this.quiet || (this.only?.length && !this.only.some((o) => id.startsWith(o)))) return; console.log(`INFO ${id} ${detail}`); }
}

// ── LOD wrapper ──────────────────────────────────────────────────────────────────────────────────────────────────
class Lod {
  constructor(file, n, sidecar) { this.g = new Glb(file); this.n = n; this.file = path.basename(file); this.sc = sidecar; this.json = this.g.json; this.bin = this.g.bin; this.bytes = this.g.bytes; }
  has(n) { return this.g.has(n); }
  meshPrims(name) { const n = this.g.node(name); return n?.mesh != null ? this.json.meshes[n.mesh].primitives : []; }
  semanticOf(prim) { const m = this.json.materials?.[prim.material]; return m?.extras?.jj_semantic; }
  visual() { return this.g.visualNodes(); }
  /** all primitives under a part's own mesh nodes (children named part:… and part_spin/hub), NOT nested parts */
  ownMeshNodes(part) {
    const out = []; const rec = (i, top) => { const n = this.json.nodes[i]; if (n.mesh != null && !n.name.startsWith('col_')) out.push(i); for (const c of n.children ?? []) { const cn = this.json.nodes[c]; if (cn.extras?.jj_part && cn.extras.jj_part !== part) continue; if (cn.extras?.jj_part_of && cn.extras.jj_part_of !== part) continue; if (/_hub$/.test(cn.name)) continue; rec(c, false); } };
    rec(this.g.idx(part), true); return out;
  }
  points(part, space = 'world') { const pts = []; for (const i of this.ownMeshNodes(part)) { const n = this.json.nodes[i], home = this.g.idx(part), seen = new Set(); for (const p of this.json.meshes[n.mesh].primitives) { if (seen.has(p.attributes.POSITION)) continue; seen.add(p.attributes.POSITION); const a = readAccessor(this.json, this.bin, p.attributes.POSITION); const m = this.g.world[i]; for (let k = 0; k < a.length; k += 3) { const w = apply(m, [a[k], a[k + 1], a[k + 2]]); pts.push(space === 'local' ? sub(w, this.g.worldPos(part)) : w); } } } return pts; }
  allVisualPoints() { const pts = []; for (const [n, i] of this.visual()) { const seen = new Set(); for (const p of this.json.meshes[n.mesh].primitives) { if (seen.has(p.attributes.POSITION)) continue; seen.add(p.attributes.POSITION); const a = readAccessor(this.json, this.bin, p.attributes.POSITION); for (let k = 0; k < a.length; k += 3) pts.push(apply(this.g.world[i], [a[k], a[k + 1], a[k + 2]])); } } return pts; }
  tris() { return this.g.triangles(); }
  /** world-space points of the vertices ONE primitive actually references (primitives of a mesh share vertex buffers) */
  primPoints(nodeIdx, prim) { const a = readAccessor(this.json, this.bin, prim.attributes.POSITION), used = new Set(primTriangles(this.json, this.bin, prim).flat()), out = [], m = this.g.world[nodeIdx]; for (const k of used) out.push({ k, p: apply(m, [a[3 * k], a[3 * k + 1], a[3 * k + 2]]) }); return out; }
}

// ── rules ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const RULES = [];
const rule = (id, fn, scope = 'lod') => RULES.push({ id, fn, scope });

rule('nodes.required', (L, R) => {
  const miss = ['chassis', ...PART_NODES, ...Object.keys(TRIMS), ...ANCHORS, ...COLLIDERS].filter((n) => !L.has(n));
  R.report('nodes.required', !miss.length, miss.length ? `${L.file}: missing ${miss.join(', ')}` : `${L.file}: chassis + ${PART_NODES.length} parts + ${Object.keys(TRIMS).length} trims + ${ANCHORS.length} anchors + ${COLLIDERS.length} colliders present`);
});
rule('nodes.hierarchy', (L, R) => {
  const bad = [], isUnder = (child, anc) => { let i = L.g.idx(child); const a = L.g.idx(anc); while (i >= 0) { if (i === a) return true; i = L.g.parent[i]; } return false; };
  for (const p of PART_NODES) if (L.has(p) && !isUnder(p, 'chassis')) bad.push(`${p} not under chassis`);
  for (const m of MIRRORS) if (L.has(m) && !isUnder(m, m === 'mirror_L' ? 'door_L' : 'door_R')) bad.push(`${m} not under its front door`);
  for (const [t, p] of Object.entries(TRIMS)) if (L.has(t) && !isUnder(t, p)) bad.push(`${t} not under ${p}`);
  for (const c of COLLIDERS) if (L.has(c)) { const part = L.g.extras(c).jj_collider?.part; if (!part || !isUnder(c, part)) bad.push(`${c} not under ${part}`); }
  R.report('nodes.hierarchy', !bad.length, bad.length ? `${L.file}: ${bad.join('; ')}` : `${L.file}: parts under chassis, mirrors under doors, colliders under their part`);
});
rule('space.origin', (L, R) => {
  const issues = []; const low = [];
  for (const w of WHEELS) { const pts = L.points('wheel_' + w); if (!pts.length) { issues.push(`wheel_${w}: no mesh`); continue; } const y = Math.min(...pts.map((p) => p[1])); low.push(+y.toFixed(4)); if (Math.abs(y) > T.originY) issues.push(`wheel_${w} lowest y=${y.toFixed(4)} (want 0±${T.originY})`); }
  const zs = WHEELS.map((w) => L.g.worldPos('wheel_' + w)?.[2]).filter((z) => z != null), mz = zs.reduce((a, b) => a + b, 0) / zs.length;
  if (Math.abs(mz) > T.originZ) issues.push(`mean wheel hub z=${mz.toFixed(3)} (want 0±${T.originZ})`);
  R.report('space.origin', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : `lowest wheel y=${low}, mean hub z=${mz.toFixed(3)}`}`);
});
rule('space.forward', (L, R) => {
  const cz = (n) => centre(bbox(L.points(n)))[2], issues = [];
  const mh = (cz('light_head_L') + cz('light_head_R')) / 2, mb = (cz('light_brake_L') + cz('light_brake_R')) / 2;
  if (!(mh < mb)) issues.push(`headlights z=${mh.toFixed(2)} not more negative than brakelights z=${mb.toFixed(2)}`);
  for (const w of ['wheel_FL', 'wheel_FR']) if (!(L.g.worldPos(w)[2] < 0)) issues.push(`${w} not at negative z`);
  R.report('space.forward', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : 'forward = −Z holds'}`);
});
rule('pivots.wheels', (L, R) => {
  const issues = [];
  for (const w of WHEELS) { const n = 'wheel_' + w, pts = L.points(n), c = centre(bbox(pts)), d = len(sub(c, L.g.worldPos(n))); if (d > T.pivot) issues.push(`${n}: pivot-to-bbox-centre ${d.toFixed(3)}`); }
  R.report('pivots.wheels', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : `4 wheel pivots within ${T.pivot} m of mesh centre`}`);
});
rule('pivots.hinges', (L, R) => {
  const issues = [];
  for (const p of [...LIDS, ...DOORS]) { const pts = L.points(p, 'local'), [mn, mx] = bbox(pts), d = Math.min(...[0, 1, 2].map((k) => Math.min(Math.abs(mn[k]), Math.abs(mx[k])))); if (d > T.pivot) issues.push(`${p}: origin ${d.toFixed(3)} m from nearest bbox face — pivot looks centred, not hinged`); }
  R.report('pivots.hinges', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : '6 hinge pivots sit on a mesh bbox face'}`);
});
rule('pivots.suspension', (L, R) => {
  const issues = [];
  for (const w of WHEELS) { const s = L.g.worldPos('susp_' + w), h = L.g.worldPos('wheel_' + w); if (!s || !h) { issues.push(`susp_${w}: missing`); continue; } if (!(s[1] > h[1] + 0.2)) issues.push(`susp_${w}: top mount not above the hub`); if (Math.hypot(s[0] - h[0], s[2] - h[2]) > 0.15) issues.push(`susp_${w}: not over its wheel`); }
  R.report('pivots.suspension', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : 'suspension top mounts sit above their hubs'}`);
});
rule('extras.parts', (L, R) => {
  const issues = [], parts = ['chassis', ...PART_NODES, ...OPTIONAL].filter((p) => L.has(p));
  for (const p of parts) { const x = L.g.extras(p); for (const k of ['jj_part', 'jj_joint', 'jj_mass_fraction']) if (x[k] === undefined) issues.push(`${p}: missing ${k}`); if (x.jj_part && x.jj_part !== p) issues.push(`${p}: jj_part=${x.jj_part}`); for (const ak of ['jj_axis', 'jj_axis_steer', 'jj_axis_spin']) if (x[ak] && Math.abs(len(x[ak]) - 1) > T.unit) issues.push(`${p}: ${ak} not unit`); }
  R.report('extras.parts', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : `${parts.length} parts carry jj_part/jj_joint/jj_mass_fraction, axes unit length`}`);
});
rule('extras.trims', (L, R) => {
  const bad = []; for (const [t, p] of Object.entries(TRIMS)) { if (!L.has(t)) continue; const x = L.g.extras(t); if (x.jj_part_of !== p) bad.push(`${t}: jj_part_of=${x.jj_part_of}`); if (x.jj_mass_fraction) bad.push(`${t}: trims carry no mass of their own`); }
  R.report('extras.trims', !bad.length, `${L.file}: ${bad.length ? bad.join('; ') : 'decoration trims belong to their part, no mass of their own'}`);
});
rule('mass.sum', (L, R) => {
  let sum = 0; const issues = [];
  for (const p of ['chassis', ...PART_NODES, ...OPTIONAL.filter((o) => L.has(o))]) { const mf = L.g.extras(p).jj_mass_fraction; if (mf != null) { sum += mf; const s = L.sc.parts?.[p]?.mass_fraction; if (s != null && Math.abs(s - mf) > T.mass) issues.push(`${p}: sidecar ${s} != node ${mf}`); } }
  if (Math.abs(sum - 1) > T.mass) issues.push(`sum=${sum.toFixed(5)} expected 1`);
  R.report('mass.sum', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : `mass fractions sum to ${sum.toFixed(5)}, match sidecar`}`);
});
rule('colliders.no_material', (L, R) => {
  const bad = COLLIDERS.filter((c) => L.has(c) && L.meshPrims(c).some((p) => p.material != null));
  R.report('colliders.no_material', !bad.length, `${L.file}: ${bad.length ? bad.join(', ') + ' have materials' : 'no collider primitive has a material'}`);
});
function isConvex(pos, tris, tol = 1e-4) {
  for (const [a, b, c] of tris) { const A = pos[a], B = pos[b], C = pos[c], u = sub(B, A), v = sub(C, A), n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], nl = len(n); if (nl < 1e-12) continue; const d = (n[0] * A[0] + n[1] * A[1] + n[2] * A[2]) / nl; for (const P of pos) if ((n[0] * P[0] + n[1] * P[1] + n[2] * P[2]) / nl - d > tol) return false; }
  return true;
}
const uniq = (pts) => new Set(pts.map((p) => p.map((c) => Math.round(c / 1e-5)).join(','))).size;
function colliderGeom(L, name) { const prim = L.meshPrims(name)[0], a = readAccessor(L.json, L.bin, prim.attributes.POSITION), pos = []; for (let i = 0; i < a.length; i += 3) pos.push([a[i], a[i + 1], a[i + 2]]); return { pos, tris: primTriangles(L.json, L.bin, prim) }; }
rule('colliders.shape', (L, R) => {
  const issues = [];
  for (const c of ['col_chassis', 'col_cabin']) { if (!L.has(c)) continue; const { pos, tris } = colliderGeom(L, c); if (!isConvex(pos, tris)) issues.push(`${c}: not convex`); if (c === 'col_cabin' && [8, 12].includes(uniq(pos))) issues.push('col_cabin is a plain box, contract requires a cabin-shaped hull'); }
  for (const p of PANELS) { const c = 'col_' + p; if (!L.has(c)) continue; const shape = L.g.extras(c).jj_collider?.shape ?? 'box', { pos, tris } = colliderGeom(L, c); if (shape === 'convex') { if (!isConvex(pos, tris)) issues.push(`${c}: declared convex but is not`); } else if (uniq(pos) > 8) issues.push(`${c}: ${uniq(pos)} unique verts, expected a box`); }
  for (const w of WHEELS) { const c = 'col_wheel_' + w; if (!L.has(c)) continue; const { pos } = colliderGeom(L, c), cy = pos.reduce((s, p) => s + p[1], 0) / pos.length, cz = pos.reduce((s, p) => s + p[2], 0) / pos.length, r = pos.map((p) => Math.hypot(p[1] - cy, p[2] - cz)).filter((x) => x > 0.25 * Math.max(...pos.map((q) => Math.hypot(q[1] - cy, q[2] - cz)))), m = r.reduce((a, b) => a + b, 0) / r.length; if (Math.max(...r.map((x) => Math.abs(x - m))) / m > 0.25) issues.push(`${c}: not cylindrical`); }
  R.report('colliders.shape', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : 'chassis/cabin hulls convex, cabin not a box, panels boxy, wheels cylindrical'}`);
});
rule('colliders.fit', (L, R) => {
  const issues = []; let n = 0;
  const pairs = [['col_chassis', 'chassis'], ['col_cabin', 'chassis'], ...PANELS.map((p) => ['col_' + p, p]), ...WHEELS.map((w) => ['col_wheel_' + w, 'wheel_' + w])];
  for (const [c, part] of pairs) { if (!L.has(c)) continue; const cb = bbox(L.g.points(c, { skipColliders: false })), pb = bbox(L.points(part)); n++; for (let k = 0; k < 3; k++) { const o = Math.max(pb[0][k] - cb[0][k], cb[1][k] - pb[1][k]); if (o > T.collFit) issues.push(`${c} overshoots ${part} axis ${k} by ${o.toFixed(3)}`); } }
  R.report('colliders.fit', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : `${n} colliders stay within ${T.collFit} m of their part`}`);
});
rule('colliders.underbody', (L, R) => {
  // the finding that bit the Blender asset: chassis proxy far above the visible underbody lets curbs/low hits pass through
  const cb = bbox(L.g.points('col_chassis', { skipColliders: false })), vis = bbox(L.points('chassis')), gap = cb[0][1] - vis[0][1];
  R.report('colliders.underbody', gap <= T.underbody, `${L.file}: col_chassis bottom is ${gap.toFixed(3)} m above the visual underbody (max ${T.underbody})`);
});
rule('materials.semantic', (L, R) => {
  const issues = [];
  for (const [n, i] of L.visual()) for (const p of L.json.meshes[n.mesh].primitives) { const m = L.json.materials?.[p.material]; if (!m) { issues.push(`${n.name}: no material`); continue; } const s = m.extras?.jj_semantic; if (!SEMANTICS.has(s)) issues.push(`${n.name}: material ${m.name} semantic ${s}`); else if (!(m.name === 'jj_' + s || m.name.startsWith('jj_' + s + '_'))) issues.push(`${n.name}: material name ${m.name} !~ jj_${s}[_variant]`); }
  R.report('materials.semantic', !issues.length, `${L.file}: ${issues.length ? [...new Set(issues)].slice(0, 6).join('; ') : 'every visual primitive has a jj_<semantic> material'}`);
});
rule('materials.emissive', (L, R) => {
  const issues = []; let found = 0;
  for (const m of L.json.materials ?? []) { const s = m.extras?.jj_semantic; if (!EMISSIVE.has(s)) continue; found++; const e = m.emissiveFactor ?? [0, 0, 0]; if (e[0] + e[1] + e[2] <= 0) issues.push(`${m.name}: emissiveFactor ${e}`); }
  R.report('materials.emissive', found > 0 && !issues.length, `${L.file}: ${found ? (issues.join('; ') || `${found} lamp materials emissive`) : 'no headlight/brakelight/indicator material'}`);
});
rule('anchors', (L, R) => {
  const issues = [], roof = L.g.worldPos('roof_number'), cabinY = Math.max(...[...DOORS, 'glass'].flatMap((p) => L.points(p).map((q) => q[1])));
  if (roof[1] < cabinY) issues.push(`roof_number y=${roof[1].toFixed(3)} below cabin roof ${cabinY.toFixed(3)}`);
  if (Math.abs(roof[0]) > T.anchorCentre) issues.push('roof_number off centreline');
  const vis = L.allVisualPoints(), zmin = Math.min(...vis.map((p) => p[2])), zmax = Math.max(...vis.map((p) => p[2]));
  if (Math.abs(L.g.worldPos('lplate_front')[2] - zmin) > T.anchorExtreme) issues.push('lplate_front not at the front extreme');
  if (Math.abs(L.g.worldPos('lplate_rear')[2] - zmax) > T.anchorExtreme) issues.push('lplate_rear not at the rear extreme');
  R.report('anchors', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : 'roof_number above roof; plates at the extremes'}`);
});
rule('sidecar.agreement', (L, R) => {
  const issues = []; let n = 0;
  for (const [k, p] of Object.entries(L.sc.anchors ?? {})) { if (!L.has(k)) continue; n++; const d = len(sub(L.g.worldPos(k), p)); if (d > T.sidecar) issues.push(`anchor ${k} off by ${d.toFixed(3)}`); }
  for (const [k, w] of Object.entries(L.sc.wheels ?? {})) { const nm = w.hub_node ?? 'wheel_' + k; n++; const d = len(sub(L.g.worldPos(nm), w.hub)); if (d > T.sidecar) issues.push(`wheel ${k} hub off by ${d.toFixed(3)}`); const pts = L.points(nm), r = (Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))) / 2; if (Math.abs(r - w.radius) > 0.03) issues.push(`wheel ${k} radius ${r.toFixed(3)} vs sidecar ${w.radius}`); }
  for (const [k, s] of Object.entries(L.sc.suspension ?? {})) { n++; const d = len(sub(L.g.worldPos('susp_' + k.slice(6)), s.top_mount)); if (d > T.sidecar) issues.push(`susp ${k} top mount off by ${d.toFixed(3)}`); }
  R.report('sidecar.agreement', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : `${n} sidecar positions agree with the GLB`}`);
});
rule('budget.triangles', (L, R) => {
  const t = L.tris(), e = L.sc.lods?.find((x) => x.lod === L.n), b = BUDGET.triangles[L.n];
  const issues = []; if (!e) issues.push('no sidecar lods[] entry'); else if (e.triangles !== t) issues.push(`sidecar claims ${e.triangles}`); if (t > b) issues.push(`over budget ${b}`);
  R.report('budget.triangles', !issues.length, `${L.file}: counted ${t} from accessors, budget ${b}${issues.length ? ' — ' + issues.join('; ') : ''}`);
});
rule('budget.draws', (L, R) => {
  let prims = 0, mats = new Set(); for (const [n] of L.visual()) for (const p of L.json.meshes[n.mesh].primitives) { prims++; mats.add(p.material); }
  const b = BUDGET.primitives[L.n], bm = BUDGET.materials[L.n], issues = []; if (prims > b) issues.push(`${prims} primitives > ${b}`); if (mats.size > bm) issues.push(`${mats.size} materials > ${bm}`);
  R.report('budget.draws', !issues.length, `${L.file}: ${prims} primitives (budget ${b}), ${mats.size} materials (budget ${bm})${issues.length ? ' — ' + issues.join('; ') : ''}`);
});
rule('budget.bytes', (L, R) => { const b = BUDGET.bytes[L.n]; R.report('budget.bytes', L.bytes <= b, `${L.file}: ${(L.bytes / 1024).toFixed(0)} KB (budget ${(b / 1024).toFixed(0)} KB)`); });
rule('budget.textures', (L, R) => {
  const imgs = L.json.images ?? [], issues = []; if (imgs.length > BUDGET.textures.count) issues.push(`${imgs.length} images > ${BUDGET.textures.count}`);
  for (const im of imgs) { const bv = L.json.bufferViews[im.bufferView], d = L.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength); if (d.readUInt32BE(12) !== 0x49484452) continue; const w = d.readUInt32BE(16), h = d.readUInt32BE(20); if (w > BUDGET.textures.max_px[0] || h > BUDGET.textures.max_px[1]) issues.push(`texture ${w}×${h} > ${BUDGET.textures.max_px}`); }
  R.report('budget.textures', !issues.length, `${L.file}: ${imgs.length} embedded texture(s)${issues.length ? ' — ' + issues.join('; ') : ' within the trim-atlas budget'}`);
});
rule('budget.parts', (L, R) => {
  const total = L.tris(), shares = {}, issues = [];
  for (const p of ['chassis', ...PART_NODES]) { if (!L.has(p)) continue; let t = 0; for (const i of L.ownMeshNodes(p)) for (const pr of L.json.meshes[L.json.nodes[i].mesh].primitives) t += (pr.indices != null ? L.json.accessors[pr.indices].count : L.json.accessors[pr.attributes.POSITION].count) / 3; shares[p] = t; const cap = BUDGET.per_part_max_share[p] ?? BUDGET.per_part_max_share.default; if (t / total > cap) issues.push(`${p} is ${(100 * t / total).toFixed(0)}% of tris (max ${(100 * cap).toFixed(0)}%)`); if (p.startsWith('wheel_') && t > BUDGET.wheel_tris_max[L.n]) issues.push(`${p} ${t} tris > ${BUDGET.wheel_tris_max[L.n]}`); }
  R.report('budget.parts', !issues.length, `${L.file}: heaviest ${Object.entries(shares).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(', ')}${issues.length ? ' — ' + issues.join('; ') : ''}`);
});
// ── procedural-profile rules ─────────────────────────────────────────────────────────────────────────────────────
rule('vertex_colours', (L, R) => {
  const issues = []; let n = 0, paintVar = 0;
  for (const [nd] of L.visual()) for (const p of L.json.meshes[nd.mesh].primitives) { n++; if (p.attributes.COLOR_0 == null) issues.push(`${nd.name}: no COLOR_0`); else if (L.semanticOf(p) === 'paint') { const c = readAccessor(L.json, L.bin, p.attributes.COLOR_0), k = L.json.accessors[p.attributes.COLOR_0].type === 'VEC4' ? 4 : 3; let mn = 9, mx = 0; for (const t of new Set(primTriangles(L.json, L.bin, p).flat())) { mn = Math.min(mn, c[t * k]); mx = Math.max(mx, c[t * k]); } paintVar = Math.max(paintVar, mx - mn); } }
  if (paintVar < 0.1) issues.push(`paint shading range ${paintVar.toFixed(2)} < 0.1 (baked AO/dirt missing?)`);
  R.report('vertex_colours', !issues.length, `${L.file}: COLOR_0 on ${n} primitives, paint shading range ${paintVar.toFixed(2)}${issues.length ? ' — ' + issues.slice(0, 4).join('; ') : ''}`);
});
rule('uv.policy', (L, R) => {
  const bad = []; let textured = 0;
  for (const [nd] of L.visual()) for (const p of L.json.meshes[nd.mesh].primitives) { const has = p.attributes.TEXCOORD_0 != null, isTrim = L.json.materials[p.material]?.name === 'jj_plastic_trim'; if (isTrim) textured++; if (isTrim && !nd.name.endsWith('_trim')) bad.push(`${nd.name}: textured geometry must live in a <part>_trim node`); if (has !== isTrim) bad.push(`${nd.name}: ${has ? 'has UVs but no texture' : 'trim material without UVs'}`); }
  R.report('uv.policy', !bad.length, `${L.file}: UVs only on trim-atlas primitives (${textured})${bad.length ? ' — ' + bad.slice(0, 4).join('; ') : ''}`);
});
function edgeStats(L, part) { // mean/max edge length of dentable paint triangles (world)
  let sum = 0, cnt = 0, mx = 0;
  for (const i of L.ownMeshNodes(part)) { const nd = L.json.nodes[i]; for (const p of L.json.meshes[nd.mesh].primitives) { if (L.semanticOf(p) !== 'paint') continue; const a = readAccessor(L.json, L.bin, p.attributes.POSITION), t = primTriangles(L.json, L.bin, p), P = (k) => [a[3 * k], a[3 * k + 1], a[3 * k + 2]]; for (const [x, y, z] of t) for (const [u, v] of [[x, y], [y, z], [z, x]]) { const e = len(sub(P(u), P(v))); sum += e; cnt++; mx = Math.max(mx, e); } } }
  return cnt ? { mean: sum / cnt, max: mx, cnt } : null;
}
rule('dent.resolution', (L, R) => {
  const b = BUDGET.dent_spacing_m[L.n], issues = [], out = [];
  for (const p of ['chassis', ...DOORS, ...LIDS, ...BUMPERS]) { const s = edgeStats(L, p); if (!s) { issues.push(`${p}: no paint triangles to dent`); continue; } out.push(`${p}=${s.mean.toFixed(2)}`); if (s.mean > b) issues.push(`${p}: mean edge ${s.mean.toFixed(3)} m > ${b} (a ${BUDGET.dent_min_radius_m} m dent would not read)`); }
  R.report('dent.resolution', !issues.length, `${L.file}: mean paint edge ≤ ${b} m for dentable parts (${out.join(' ')})${issues.length ? ' — ' + issues.join('; ') : ''}`);
});
function rot(axis, deg, p) { const t = deg * Math.PI / 180, [x, y, z] = axis, c = Math.cos(t), s = Math.sin(t), d = x * p[0] + y * p[1] + z * p[2], cr = [y * p[2] - z * p[1], z * p[0] - x * p[2], x * p[1] - y * p[0]]; return p.map((v, i) => v * c + cr[i] * s + [x, y, z][i] * d * (1 - c)); }
rule('rig.hinge_direction', (L, R) => {
  const issues = [];
  for (const p of [...DOORS, ...LIDS]) {
    const x = L.g.extras(p), pts = L.points(p, 'local'); if (!x.jj_axis || !x.jj_range_deg) { issues.push(`${p}: no jj_axis/jj_range_deg`); continue; }
    const ax = x.jj_axis, perp = (q) => len(sub(q, sc(ax, q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]))), far = pts.reduce((a, b) => (perp(b) > perp(a) ? b : a)), moved = rot(x.jj_axis, Math.min(30, x.jj_range_deg[1]), far), o = L.g.worldPos(p), w0 = [o[0] + far[0], o[1] + far[1], o[2] + far[2]], w1 = [o[0] + moved[0], o[1] + moved[1], o[2] + moved[2]];
    const ok = DOORS.includes(p) ? Math.abs(w1[0]) > Math.abs(w0[0]) + 0.05 : w1[1] > w0[1] + 0.05;
    if (!ok) issues.push(`${p}: a positive rotation about jj_axis moves the free edge ${DOORS.includes(p) ? 'inward' : 'downward'}`);
  }
  for (const w of WHEELS) { const x = L.g.extras('wheel_' + w), top = [0, 0.4, 0], m = rot(x.jj_axis_spin ?? [1, 0, 0], 20, top); if (!(m[2] < top[2] - 0.05)) issues.push(`wheel_${w}: positive spin does not roll the top forward (−Z)`); }
  R.report('rig.hinge_direction', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : 'doors open outward, lids lift, wheels spin forward for positive angles'}`);
});
rule('rig.wheels', (L, R) => {
  const issues = [];
  for (const w of WHEELS) {
    const n = 'wheel_' + w, x = L.g.extras(n), front = w[0] === 'F';
    if (!x.jj_axis_spin) issues.push(`${n}: no jj_axis_spin`); if (L.meshPrims(n).length === 0) issues.push(`${n}: the spinning mesh must be on the wheel node`);
    if (front) { const st = x.jj_steer_node; if (!st || !L.has(st)) issues.push(`${n}: jj_steer_node missing`); else if (L.g.parent[L.g.idx(n)] !== L.g.idx(st)) issues.push(`${n}: not a child of its steer node`); else if (len(sub(L.g.worldPos(st), L.g.worldPos(n))) > 1e-3) issues.push(`${n}: steer node not at the hub`); if (!x.jj_axis_steer) issues.push(`${n}: front wheel without steer axis`); }
    else if (x.jj_axis_steer || x.jj_steer_node) issues.push(`${n}: rear wheel steers`);
  }
  R.report('rig.wheels', !issues.length, `${L.file}: ${issues.length ? issues.join('; ') : '4 wheels: front = steer node → spinning wheel mesh; rear = spinning wheel mesh; brake hardware is a non-spinning sibling'}`);
});
rule('rig.detach', (L, R) => { // every detachable part is a self-contained node with a collider and mass
  const bad = []; for (const p of [...PANELS, ...WHEELS.map((w) => 'wheel_' + w), ...LIGHTS, ...MIRRORS, 'glass']) { const x = L.g.extras(p); if (!x.jj_detachable) bad.push(`${p} not marked jj_detachable`); if (!(x.jj_mass_fraction > 0)) bad.push(`${p} has no mass`); if (PANELS.includes(p) || p.startsWith('wheel_')) if (!x.jj_collider) bad.push(`${p} has no collider ref`); }
  if (L.g.extras('chassis').jj_detachable) bad.push('chassis must never detach');
  R.report('rig.detach', !bad.length, `${L.file}: ${bad.length ? bad.join('; ') : 'detachable parts carry mass + collider; chassis is fixed'}`);
});
// ── recognition gates (spec measured from the reference; see recog/spec.js) ─────────────────────────────────────────
function topY(L, part, x, zk) {          // highest surface point of `part`'s paint triangles above (x, z): a vertical ray, not vertex sampling (coarse LODs have no centreline vertices)
  let best = -1e9;
  for (const i of L.ownMeshNodes(part)) { const nd = L.json.nodes[i]; for (const p of L.json.meshes[nd.mesh].primitives) { if (L.semanticOf(p) !== 'paint') continue; const a = readAccessor(L.json, L.bin, p.attributes.POSITION), t = primTriangles(L.json, L.bin, p), m = L.g.world[i], P = (k) => apply(m, [a[3 * k], a[3 * k + 1], a[3 * k + 2]]); for (const [i0, i1, i2] of t) { const A = P(i0), B = P(i1), C = P(i2), z = -zk, d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]); if (Math.abs(d) < 1e-9) continue; const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / d, l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / d, l3 = 1 - l1 - l2; if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) best = Math.max(best, l1 * A[1] + l2 * B[1] + l3 * C[1]); } } }
  return best;
}
const ROOF_TOL = [0.06, 0.075, 0.1, 0.15], GLASS_TOL = [0.1, 0.1, 0.13, 0.17];
rule('recog.roofline', (L, R) => {
  const issues = []; let worst = 0, n = 0;
  for (let zk = -1.4; zk <= 0.85; zk += 0.15) { const y = topY(L, 'chassis', 0, zk), want = polyY(TOY.roof, zk); if (y < 0) continue; n++; worst = Math.max(worst, Math.abs(y - want)); if (Math.abs(y - want) > ROOF_TOL[L.n]) issues.push(`z=${zk.toFixed(2)}: roof ${y.toFixed(3)} vs ${want.toFixed(3)}`); }
  R.report('recog.roofline', !issues.length && n >= 12, `${L.file}: centreline roof within ${ROOF_TOL[L.n]} m of the reference profile at ${n} stations (worst ${worst.toFixed(3)})${issues.length ? ' — ' + issues.slice(0, 3).join('; ') : ''}`);
});
function glassBoxes(L) {
  const out = { front: null, rear: null, quarter: null }, side = (p) => p[0] < -0.5;             // glTF left = −X
  const grab = (nodeName, pred) => { const pts = []; for (const i of L.ownMeshNodes(nodeName)) { const nd = L.json.nodes[i]; for (const p of L.json.meshes[nd.mesh].primitives) if (L.semanticOf(p) === 'glass') for (const { p: w } of L.primPoints(i, p)) if (side(w) && pred(w)) pts.push([-w[2], w[1]]); } return pts; };
  const bx = (pts) => pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] : null;
  out.front = bx(grab('door_L', () => true)); out.rear = bx(grab('door_rear_L', () => true)); out.quarter = bx(grab('glass', (w) => -w[2] < -0.95));
  return out;
}
const polyBox = (poly) => [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))];
rule('recog.glass', (L, R) => {
  const got = glassBoxes(L), issues = [], tol = GLASS_TOL[L.n];
  for (const k of ['front', 'rear', 'quarter']) { const want = polyBox(TOY.glass[k]); if (!got[k]) { issues.push(`${k} side window missing`); continue; } const d = Math.max(...got[k].map((v, i) => Math.abs(v - want[i]))); if (d > tol) issues.push(`${k} window box off by ${d.toFixed(3)} m`); }
  R.report('recog.glass', !issues.length, `${L.file}: six-light greenhouse present per side (front door / rear door / quarter) within ${tol} m of the reference daylight openings${issues.length ? ' — ' + issues.join('; ') : ''}`);
});
rule('recog.lamps', (L, R) => {
  const issues = [], c = (n) => centre(bbox(L.points(n)));
  const hl = c('light_head_L'), hx = TOY.front.lamp.reduce((s, p) => s + p[0], 0) / 4, hy = TOY.front.lamp.reduce((s, p) => s + p[1], 0) / 4;
  if (Math.hypot(Math.abs(hl[0]) - hx, hl[1] - hy) > 0.09) issues.push(`headlamp centre (${Math.abs(hl[0]).toFixed(2)},${hl[1].toFixed(2)}) vs (${hx.toFixed(2)},${hy.toFixed(2)})`);
  const bl = c('light_brake_L'), o = TOY.rear.lampOuter, i2 = TOY.rear.lampInner, bx = (o.x0 + i2.x1) / 2 + 0.05, by = (o.y0 + o.y1) / 2;
  if (Math.hypot(Math.abs(bl[0]) - bx, bl[1] - by) > 0.14) issues.push(`tail lamp centre (${Math.abs(bl[0]).toFixed(2)},${bl[1].toFixed(2)}) vs (${bx.toFixed(2)},${by.toFixed(2)})`);
  const hb = bbox(L.points('light_head_L')), tb = bbox(L.points('light_brake_L'));
  if (hb[1][0] - hb[0][0] < 0.3) issues.push('headlamp narrower than 0.3 m — the swept lamp is a key cue');
  if (tb[1][0] - tb[0][0] < 0.25) issues.push('tail lamp too narrow (wrap-around cue lost)');
  R.report('recog.lamps', !issues.length, `${L.file}: swept headlamps and wrap tail lamps at reference positions${issues.length ? ' — ' + issues.join('; ') : ''}`);
});
rule('recog.grille', (L, R) => {
  const pts = [], G = TOY.front.grille, I = TOY.front.intake, B = TOY.front.bar, issues = [];
  for (const i of L.ownMeshNodes('bumper_front')) { const nd = L.json.nodes[i]; for (const p of L.json.meshes[nd.mesh].primitives) if (L.json.materials[p.material]?.name === 'jj_plastic_trim') { const uv = readAccessor(L.json, L.bin, p.attributes.TEXCOORD_0); for (const { k, p: w } of L.primPoints(i, p)) pts.push({ x: w[0], y: w[1], v: uv[2 * k + 1] }); } }
  const hex = pts.filter((p) => p.v >= 0.5), slat = pts.filter((p) => p.v < 0.5);
  const cl = (arr, lo, hi) => arr.filter((p) => p.y >= lo && p.y <= hi);
  const g = cl(hex, G.yBot - 0.03, G.yTop + 0.03), it = cl(hex, I.yBot - 0.03, I.yTop + 0.03), br = cl(slat, B.y0 - 0.03, B.y1 + 0.03);
  const width = (a) => (a.length ? Math.max(...a.map((p) => p.x)) - Math.min(...a.map((p) => p.x)) : 0);
  if (width(g) < 1.6 * G.hwTop * 0.9) issues.push(`grille width ${width(g).toFixed(2)} < ${(1.6 * G.hwTop * 0.9).toFixed(2)}`);
  if (width(it) < 1.6 * I.hwTop * 0.85) issues.push(`lower intake width ${width(it).toFixed(2)}`);
  if (width(br) < 1.6 * B.hw * 0.9) issues.push(`slatted bar width ${width(br).toFixed(2)}`);
  R.report('recog.grille', !issues.length, `${L.file}: slatted bar + honeycomb grille + lower intake at reference heights${issues.length ? ' — ' + issues.join('; ') : ''}`);
});
rule('recog.proportions', (L, R) => {
  const vis = L.points('chassis'), [mn, mx] = bbox(L.allVisualPoints()), length = mx[2] - mn[2], width = mx[0] - mn[0], height = mx[1] - mn[1];
  const wb = Math.abs(L.g.worldPos('wheel_FL')[2] - L.g.worldPos('wheel_RL')[2]), wr = L.sc.wheels?.FL?.radius ?? 0.4, issues = [];
  const rel = (v, real, lo, hi, what) => { const r = v / real; if (r < lo || r > hi) issues.push(`${what} ${v.toFixed(2)} (${r.toFixed(2)}× real)`); };
  rel(length, REAL.length, 0.75, 0.95, 'length'); rel(height, REAL.height, 0.95, 1.1, 'height'); rel(wb / length, REAL.wheelbase / REAL.length, 0.9, 1.15, 'wheelbase/length'); rel(wr, 0.33, 1.05, 1.5, 'wheel radius (chunky, not silly)');
  rel(width / length, 1.79 / REAL.length, 0.95, 1.4, 'width/length');
  R.report('recog.proportions', !issues.length, `${L.file}: cute-but-Cruze proportions — L ${length.toFixed(2)} W ${width.toFixed(2)} H ${height.toFixed(2)} wheelbase ${wb.toFixed(2)} wheel r ${wr}${issues.length ? ' — ' + issues.join('; ') : ''}`);
});
// ── cross-LOD rules ───────────────────────────────────────────────────────────────────────────────────────────────
rule('lod.nodes_same', (Ls, R) => {
  const names = (L) => new Set(L.json.nodes.map((n) => n.name).filter((n) => n && !n.includes(':')));
  const base = names(Ls[0]), issues = [];
  for (const L of Ls.slice(1)) { const s = names(L); const miss = [...base].filter((n) => !s.has(n)), extra = [...s].filter((n) => !base.has(n)); if (miss.length || extra.length) issues.push(`${L.file}: missing ${miss.join(',')} extra ${extra.join(',')}`); }
  R.report('lod.nodes_same', !issues.length, issues.length ? issues.join('; ') : `every node name is identical across ${Ls.length} LODs (empty groups stand in for dropped detail)`);
}, 'all');
rule('lod.pivots_same', (Ls, R) => {
  const issues = [], base = Ls[0];
  for (const L of Ls.slice(1)) for (const p of [...PART_NODES, ...ANCHORS]) { if (!L.has(p) || !base.has(p)) continue; const d = len(sub(L.g.worldPos(p), base.g.worldPos(p))); if (d > 0.002) issues.push(`LOD${L.n} ${p} moved ${d.toFixed(3)} m`); }
  R.report('lod.pivots_same', !issues.length, issues.length ? issues.slice(0, 5).join('; ') : 'hinges, hubs and anchors identical across LODs');
}, 'all');
rule('lod.silhouette', (Ls, R) => {
  const bb = Ls.map((L) => bbox(L.allVisualPoints())), issues = [];
  for (let i = 1; i < Ls.length; i++) for (let k = 0; k < 3; k++) for (let e = 0; e < 2; e++) if (Math.abs(bb[i][e][k] - bb[0][e][k]) > BUDGET.bounds_tolerance_m) issues.push(`LOD${i} bounds axis ${k} differs by ${Math.abs(bb[i][e][k] - bb[0][e][k]).toFixed(3)}`);
  R.report('lod.silhouette', !issues.length, issues.length ? [...new Set(issues)].slice(0, 4).join('; ') : `overall bounds within ${BUDGET.bounds_tolerance_m} m across LODs`);
}, 'all');
rule('lod.reduction', (Ls, R) => {
  const t = Ls.map((L) => L.tris()), issues = []; for (let i = 1; i < t.length; i++) if (t[i - 1] / t[i] < BUDGET.lod_min_reduction) issues.push(`LOD${i - 1}→${i}: ${t[i - 1]}→${t[i]} (${(t[i - 1] / t[i]).toFixed(2)}× < ${BUDGET.lod_min_reduction}×)`);
  R.report('lod.reduction', !issues.length, issues.length ? issues.join('; ') : `each LOD ≥ ${BUDGET.lod_min_reduction}× cheaper: ${t.join(' → ')}`);
}, 'all');

// ── run ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function validateDir(dir, reporter = new Reporter()) {
  const sidecarPath = fs.readdirSync(dir).find((f) => f.endsWith('.asset.json'));
  if (!sidecarPath) { reporter.report('discovery', false, `no *.asset.json in ${dir}`); return reporter; }
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, sidecarPath), 'utf8')), Ls = [];
  for (const e of sidecar.lods) { try { Ls.push(new Lod(path.join(dir, e.file), e.lod, sidecar)); reporter.report('glb.parse', true, `${e.file} parses (${(fs.statSync(path.join(dir, e.file)).size / 1024).toFixed(0)} KB)`); } catch (err) { reporter.report('glb.parse', false, `${e.file}: ${err.message}`); } }
  for (const r of RULES) { if (r.scope === 'all') r.fn(Ls, reporter); else for (const L of Ls) { try { r.fn(L, reporter); } catch (err) { reporter.report(r.id, false, `${L.file}: rule threw ${err.message}`); } } }
  return reporter;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!DIR) { console.error('usage: validate_asset.mjs <dir>'); process.exit(2); }
  const rep = validateDir(path.resolve(DIR));
  console.log(`--- ${rep.pass} PASS, ${rep.fail} FAIL ---`);
  const out = opt('--json'); if (out) fs.writeFileSync(out, JSON.stringify({ pass: rep.pass, fail: rep.fail, rules: rep.lines }, null, 1));
  process.exit(rep.fail ? 1 : 0);
}
export { RULES, Reporter, Lod };
