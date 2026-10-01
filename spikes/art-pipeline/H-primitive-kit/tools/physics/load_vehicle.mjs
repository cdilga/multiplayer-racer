// load_vehicle.mjs — turns a baked contract asset (GLB + sidecar) into physics-ready data, same output shape as the Blender
// track's load_vehicle_v2.mjs (so physics_common.mjs runs unchanged), built on tools/glb.mjs so it reads GLTFExporter's
// `matrix` nodes and walks the full parent chain (hinged parts have non-zero origins).
import { readFileSync } from 'node:fs';
import { Glb, readAccessor, apply } from '../glb.mjs';

const sub = (a, b) => a.map((x, i) => x - b[i]);
export function loadVehicle(glbPath, sidecarPath) {
  const g = new Glb(glbPath), sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  if (!g.has('chassis')) throw new Error("no 'chassis' node");
  const chassisWorld = g.worldPos('chassis'), rel = (p) => sub(p, chassisWorld), totalMassKg = sidecar.physics?.mass_kg;
  if (!totalMassKg) throw new Error('sidecar.physics.mass_kg missing');
  const parts = {}; let massFractionSum = 0;
  g.json.nodes.forEach((n, i) => { const x = n.extras; if (!x || x.jj_part === undefined) return; massFractionSum += x.jj_mass_fraction ?? 0; parts[x.jj_part] = { node: n.name, massFraction: x.jj_mass_fraction ?? 0, massKg: (x.jj_mass_fraction ?? 0) * totalMassKg, joint: x.jj_joint, attach: x.jj_attach ?? null, detachable: !!x.jj_detachable, collider: x.jj_collider ?? null, dents: x.jj_dent ?? [], axis: x.jj_axis ?? null, rangeDeg: x.jj_range_deg ?? null, worldPos: g.worldPos(n.name), relPos: rel(g.worldPos(n.name)) }; });
  const colliders = {};
  g.json.nodes.forEach((n, i) => {
    const cx = n.extras?.jj_collider; if (!cx || typeof cx !== 'object' || Array.isArray(cx) || !cx.shape || n.mesh == null) return;
    const verts = [], seen = new Set();
    for (const p of g.json.meshes[n.mesh].primitives) { const a = readAccessor(g.json, g.bin, p.attributes.POSITION); for (let k = 0; k < a.length; k += 3) { const key = `${Math.round(a[k] * 1e5)},${Math.round(a[k + 1] * 1e5)},${Math.round(a[k + 2] * 1e5)}`; if (seen.has(key)) continue; seen.add(key); verts.push(...rel(apply(g.world[i], [a[k], a[k + 1], a[k + 2]]))); } }
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let k = 0; k < verts.length; k += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], verts[k + a]); mx[a] = Math.max(mx[a], verts[k + a]); }
    colliders[n.name] = { shape: cx.shape, part: cx.part, vertCount: verts.length / 3, halfExtents: mn.map((m, a) => (mx[a] - m) / 2), centerRel: mn.map((m, a) => (mx[a] + m) / 2), chassisRelVerts: new Float32Array(verts) };
  });
  const wheels = {}; for (const [name, w] of Object.entries(sidecar.wheels ?? {})) wheels[name] = { hubRel: w.hub, radius: w.radius, width: w.width, steer: !!w.steer, driven: !!w.driven, isFront: name.includes('F') };
  if (Object.keys(wheels).length !== 4) throw new Error('expected 4 wheels in the sidecar');
  const suspension = {}; for (const [name, s] of Object.entries(sidecar.suspension ?? {})) suspension[name] = { topMount: s.top_mount, hub: s.hub, restLength: s.rest_length, travel: s.travel };
  const anchors = {}, anchorMismatches = [];
  for (const [name, p] of Object.entries(sidecar.anchors ?? {})) { if (!g.has(name)) { anchorMismatches.push({ name, reason: 'node not found' }); continue; } const q = rel(g.worldPos(name)); anchors[name] = q; const d = Math.hypot(...sub(q, p)); if (d > 1e-3) anchorMismatches.push({ name, deltaM: d }); }
  if (!anchors.com) throw new Error("no 'com' anchor");
  return { glb: g, sidecar, chassisWorld, groundOffsetY: chassisWorld[1], totalMassKg, massFractionSum, parts, colliders, wheels, suspension, anchors, anchorMismatches };
}
