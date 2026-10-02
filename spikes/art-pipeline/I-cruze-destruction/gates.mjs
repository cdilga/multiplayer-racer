// gates.mjs — deterministic geometry/contract gates for the damage-ready Cruz Missile (node, no browser). node gates.mjs [--json]
// Each gate targets one of the failures this spike exists to remove: paper-thin parts, inverted/self-crossing shells under damage,
// black holes behind removed panels, dents pushing into cavity contents, LOD semantics drifting, LODs that don't save anything.
import * as THREE from 'three';
import fs from 'node:fs';
import { build, LODS, OUTLINE, DIM } from './cruze.js';
import { makeTemplate, templateStats } from './vehicle.js';
import { ZONES, combined } from './fields.js';
import { jacobian, det3, warpGeometry } from './kit/shell.js';
import { triCount, SLOTS } from './kit/slots.js';

const results = []; let fails = 0;
const gate = (id, ok, detail) => { results.push({ id, ok: !!ok, detail }); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };

const descs = LODS.map((_, l) => build({ lod: l }));
const tpls = descs.map((d) => makeTemplate(d));
const F = descs[0].fields;
const TARGET = [[10000, 15000], [3000, 5000], [1200, 2000], [450, 800]];

// ── 1. builds are clean ─────────────────────────────────────────────────────────────────────────────────────────────
descs.forEach((d, l) => gate(`build.probes.L${l}`, d.probeMisses === 0, `failed surface probes: ${d.probeMisses}`));

// ── 2. mesh hygiene on every shipped geometry (finite, valid indices, no zero-area triangles) ───────────────────────────
function hygiene(g) {
  const P = g.attributes.position.array, N = g.attributes.normal.array, idx = g.index?.array, n = P.length / 3; let bad = 0, zero = 0, nan = 0;
  for (const v of P) if (!Number.isFinite(v)) nan++; for (const v of N) if (!Number.isFinite(v)) nan++;
  if (idx) { const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) { if (idx[t] >= n || idx[t + 1] >= n || idx[t + 2] >= n) { bad++; continue; } a.fromArray(P, idx[t] * 3); b.fromArray(P, idx[t + 1] * 3).sub(a); c.fromArray(P, idx[t + 2] * 3).sub(a); if (b.cross(c).lengthSq() < 1e-16) zero++; } }
  for (const l of Object.values(g.morphAttributes ?? {})) for (const a of l) for (const v of a.array) if (!Number.isFinite(v)) nan++;
  return { bad, zero, nan, tris: triCount(g) };
}
tpls.forEach((t, l) => {
  const agg = { bad: 0, zero: 0, nan: 0, tris: 0 };
  for (const p of Object.values(t.parts)) for (const g of Object.values(p.slots)) { const h = hygiene(g); for (const k in agg) agg[k] += h[k]; }
  for (const g of Object.values(t.intact)) { const h = hygiene(g); for (const k in agg) agg[k] += h[k]; }
  gate(`mesh.hygiene.L${l}`, agg.bad === 0 && agg.nan === 0 && agg.zero / agg.tris < 0.002, agg);
});

// ── 3. every detachable panel/lamp is a closed shell: outer + inner + rim, declared thickness > 0 ─────────────────────────
const SHELL_KINDS = new Set(['door', 'lid', 'bumper', 'lamp']);
descs.forEach((d, l) => {
  const need = Object.values(d.parts).filter((p) => SHELL_KINDS.has(p.meta.kind)).map((p) => p.id), missing = [];
  for (const id of need) { const s = d.shells.filter((x) => x.part === id); if (!s.length || s.some((x) => !(x.thick > 0) || x.rimEdges < 3 || !triCount(x.inner) || !triCount(x.outer) || !triCount(x.rim))) missing.push(id); }
  gate(`shell.closed.L${l}`, !missing.length, missing.length ? `not closed: ${missing.join(',')}` : `${need.length} parts, ${d.shells.length} shells, thickness ${[...new Set(d.shells.map((s) => s.thick))].join('/')} m`);
});

// ── 4. warps are local bijections (det(I+∇d) > 0.2): zones alone, all zones together, every panel dent ──────────────────────
{
  const pts = []; for (let x = -1.0; x <= 1.0; x += 0.125) for (let y = 0.05; y <= 1.7; y += 0.1) for (let z = -2.1; z <= 2.0; z += 0.1) pts.push([x, y, z]);
  const minDet = (w) => { let m = 9; for (const p of pts) m = Math.min(m, det3(jacobian(w, ...p))); return m; };
  const channels = { ...Object.fromEntries(ZONES.map((z) => [z, F[z]])), ALL_ZONES: combined(F, Object.fromEntries(ZONES.map((z) => [z, 1]))) };
  for (const k of Object.keys(F)) if (k.startsWith('dent_')) channels[k] = F[k];
  const out = {}; let worst = 9; for (const [k, w] of Object.entries(channels)) { out[k] = +minDet(w).toFixed(3); worst = Math.min(worst, out[k]); }
  gate('warp.injective', worst > 0.2, { worstMinDet: worst, ...out });
}

// ── 5. shells stay closed under maximum supported damage (all zones + own dent at 1): outer stays outside inner ───────────
descs.forEach((d, l) => {
  const ds = d.lodSpec.dentScale ?? 1, report = []; let worst = 9;
  for (const s of d.shells) {
    const part = d.parts[s.part], w = {}; for (const ch of part.meta.channels) w[ch] = ch.startsWith('dent_') ? ds : 1;
    const warp = combined(d.fields, w), o = warpGeometry(s.outer, warp), i = warpGeometry(s.inner, warp);
    let minRatio = 9; for (let k = 0; k < o.pos.length / 3; k++) {
      const dx = o.pos[k * 3] - i.pos[k * 3], dy = o.pos[k * 3 + 1] - i.pos[k * 3 + 1], dz = o.pos[k * 3 + 2] - i.pos[k * 3 + 2];
      const along = dx * o.nor[k * 3] + dy * o.nor[k * 3 + 1] + dz * o.nor[k * 3 + 2];   // > 0: not inverted; |Δ|: how thick it still is
      minRatio = Math.min(minRatio, along <= 0 ? along / s.thick : Math.hypot(dx, dy, dz) / s.thick);
    }
    worst = Math.min(worst, minRatio); if (minRatio < 0.35) report.push(`${s.part}:${minRatio.toFixed(2)}`);
  }
  gate(`shell.thickness_under_damage.L${l}`, worst >= 0.35, `worst outer–inner separation (must stay on the outer side of the deformed normal) = ${worst.toFixed(2)} × declared thickness ${report.join(' ')}`);
});

// ── 6. dents never push a panel into what is behind it (cavity back / seat / engine / crash bar), fine LODs ─────────────────
for (const l of [0, 1]) {
  const d = descs[l], issues = [];
  for (const id of ['door_L', 'door_R', 'door_rear_L', 'door_rear_R']) {
    const s = d.shells.find((x) => x.part === id), w = Object.fromEntries(d.parts[id].meta.channels.map((c) => [c, 1])), i = warpGeometry(s.inner, combined(d.fields, Object.fromEntries(Object.keys(w).filter((c) => c.startsWith('dent_')).map((c) => [c, 1]))));
    const zSeat = id.includes('rear') ? -0.48 : 0.2;   // seat block: |x| ≤ far wall + 12 cm, y 0.54–1.15, z ± 0.3 around the seat
    let m = 9; for (let k = 0; k < i.pos.length / 3; k++) { const y = i.pos[k * 3 + 1], z = i.pos[k * 3 + 2]; if (y > 0.54 && y < 1.15 && Math.abs(z - zSeat) < 0.3) m = Math.min(m, Math.abs(i.pos[k * 3]) - (0.505 + 0.12)); }
    if (m < 0) issues.push(`${id} inner reaches the seat line by ${(-m * 100).toFixed(1)} cm`);
  }
  for (const [id, sz] of [['bumper_front', 1], ['bumper_rear', -1]]) {
    const s = d.shells.find((x) => x.part === id), i = warpGeometry(s.inner, d.fields['dent_' + id]); const zc = sz > 0 ? OUTLINE.bumperF : OUTLINE.bumperR, barFace = zc - sz * 0.005;   // crash bar lives in the recess behind the cut
    let m = 9; for (let k = 0; k < i.pos.length / 3; k++) { const x = i.pos[k * 3], y = i.pos[k * 3 + 1], z = i.pos[k * 3 + 2]; if (Math.abs(x) < 0.62 && y > 0.5 && y < 0.62) m = Math.min(m, sz * (z - barFace)); }
    if (m < 0.005) issues.push(`${id} inner within ${(m * 100).toFixed(1)} cm of the crash bar`);
  }
  gate(`cavity.clearance.L${l}`, !issues.length, issues.length ? issues.join('; ') : 'doors clear the seats, bumpers clear the crash bars at full dent');
}

// ── 6b. no panel is buried in chassis geometry at full dent (+ the zones it shares): from every inner-skin vertex, a ray into the
//        car must first meet a FRONT face (a back face first means the vertex is inside a solid: seat, engine, crash bar, jamb…)
for (const l of [0, 1]) {
  const d = descs[l], t = tpls[l], ch = t.parts.chassis, issues = {};
  const meshes = Object.values(ch.slots).map((g) => { const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(); return m; });
  const rc = new THREE.Raycaster(); let tested = 0;
  for (const s of d.shells) {
    const part = d.parts[s.part]; if (!['door', 'lid', 'bumper'].includes(part.meta.kind)) continue;
    const dents = Object.fromEntries(part.meta.channels.filter((c) => c.startsWith('dent_')).map((c) => [c, 1])), i = warpGeometry(s.inner, combined(d.fields, dents));
    for (let k = 0; k < i.pos.length / 3; k++) {
      const o = new THREE.Vector3(i.pos[k * 3], i.pos[k * 3 + 1], i.pos[k * 3 + 2]), dir = new THREE.Vector3(i.nor[k * 3], i.nor[k * 3 + 1], i.nor[k * 3 + 2]).normalize();   // inner normals point into the car
      // the body is a hollow shell, so a back face hit after crossing open interior means nothing; a vertex is buried only if BOTH
      // directions first meet back faces of the same chassis mesh within 25 cm (it sits inside a closed solid: seat, block, bar)
      const back = (dd) => { rc.set(o.clone().addScaledVector(dd, -1e-4), dd); rc.far = 0.25; const h = rc.intersectObjects(meshes)[0]; return h && h.face.normal.clone().dot(dd) > 0.05 ? h.object : null; };
      const a1 = back(dir), a2 = back(dir.clone().negate()); tested++;
      if (a1 && a1 === a2) { issues[s.part] = (issues[s.part] ?? 0) + 1; if (process.env.DBG) { const hs = [dir, dir.clone().negate()].map((dd) => { rc.set(o.clone().addScaledVector(dd, -1e-4), dd); const h = rc.intersectObjects(meshes)[0]; return h ? `${h.point.toArray().map((v) => v.toFixed(3))} n=${h.face.normal.toArray().map((v) => v.toFixed(2))} d=${h.distance.toFixed(3)}` : "none"; }); console.log("BURIED", l, s.part, o.toArray().map((v) => v.toFixed(3)).join(","), "dir", dir.toArray().map((v) => v.toFixed(2)).join(","), "|", hs.join(" | ")); } }
    }
  }
  gate(`panels.not_buried.L${l}`, !Object.keys(issues).length, Object.keys(issues).length ? `inner-skin vertices inside chassis solids: ${JSON.stringify(issues)} of ${tested}` : `${tested} inner-skin vertices at full dent, none inside chassis geometry`);
}

// ── 7. no black holes: rays that pass THROUGH a bare opening (panel removed) must hit chassis geometry behind it ───────────
// Targets are points on the original body surface inside each opening (bumper targets sit off the symmetry plane: rays exactly
// along a triangle-fan edge are raycaster noise, not holes); 9 directions per target, all entering through it.
{
  const { makeTub, makeCabin } = await import('./cruze.js'); const { LoftUnion } = await import('../H-primitive-kit/kit/loft.js');
  const tub = makeTub(), body = new LoftUnion(tub, makeCabin(), 0.7), targets = [];
  const inside = (poly, a, b, m) => polyToHP(poly).every(([ax, ay, c]) => ax * a + ay * b >= c + m);
  const polyToHP = (poly) => { let ar = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; ar += p[0] * q[1] - q[0] * p[1]; } const sg = ar > 0 ? 1 : -1; return poly.map((p, i) => { const q = poly[(i + 1) % poly.length], ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey) || 1, ax = (-ey / L) * sg, ay = (ex / L) * sg; return [ax, ay, ax * p[0] + ay * p[1]]; }); };
  for (const which of ['front', 'rear']) for (const sgn of [1, -1]) for (let z = -1; z <= 1; z += 0.06) for (let y = 0.4; y <= 1.5; y += 0.06) if (inside(OUTLINE[which].poly, z, y, 0.03)) { const h = body.side(z, y, sgn); if (h) targets.push({ p: h.p, n: h.n, key: which + sgn }); }
  for (const which of ['bonnet', 'boot']) for (let x = -0.7; x <= 0.7; x += 0.08) for (let z = -2; z <= 1.6; z += 0.06) if (inside(OUTLINE[which].poly, x, z, 0.03)) { const h = body.top(x, z); if (h) targets.push({ p: h.p, n: h.n, key: which }); }
  for (const [zc, sz] of [[OUTLINE.bumperF, 1], [OUTLINE.bumperR, -1]]) for (let x = -0.687; x <= 0.7; x += 0.1) for (let y = 0.35; y <= 0.9; y += 0.08) { const h = sz > 0 ? tub.front(x, y) : tub.rear(x, y); if (h && sz * h.p.z > sz * zc + 0.03) targets.push({ p: h.p, n: h.n, key: 'bumper' + sz, cut: zc, sz }); }
  for (const l of [0, 1, 2, 3]) {
    const ch = tpls[l].parts.chassis, meshes = Object.values(ch.slots).map((g) => { const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(); return m; });
    const rc = new THREE.Raycaster(); let escaped = 0, total = 0; const byKey = {};
    for (const t of targets) {
      const n = t.n.clone().normalize(), up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), a = new THREE.Vector3().crossVectors(n, up).normalize(), b = new THREE.Vector3().crossVectors(n, a);
      for (const s1 of [-0.6, 0, 0.6]) for (const s2 of [-0.6, 0, 0.6]) {
        const d = n.clone().negate().addScaledVector(a, s1).addScaledVector(b, s2).normalize(), o = t.p.clone().addScaledVector(d, -1.2);
        if (t.cut != null) {   // bumper: the nose is open air once the bumper is gone; only rays crossing the cut plane INSIDE the body section count
          const k = (t.cut - o.z) / d.z, x = o.x + d.x * k, y = o.y + d.y * k; if (!(k > 0) || tub.F(x, y, t.cut - t.sz * 0.03) > -0.3) continue;   // margin keeps clear of the chord sag of a coarse ring
        }
        rc.set(o, d); rc.far = 8; total++;
        if (!rc.intersectObjects(meshes).length) { escaped++; byKey[t.key] = (byKey[t.key] ?? 0) + 1; if (process.env.DBG && l === 1) { const k = (t.cut - o.z) / d.z; console.log("ESC", t.key, "target", t.p.toArray().map((v) => v.toFixed(3)).join(","), "at cut", (o.x + d.x * k).toFixed(3), (o.y + d.y * k).toFixed(3), "dir", d.toArray().map((v) => v.toFixed(2)).join(",")); } }
      }
    }
    gate(`openings.no_see_through.L${l}`, escaped === 0, `${total - escaped}/${total} rays entering the bare openings hit chassis geometry${escaped ? ' ' + JSON.stringify(byKey) : ''}`);
  }
}

// ── 8. LOD budgets: intact triangles in band, ≥2× cheaper per rung, intact draws ≤ 8 ──────────────────────────────────────
const stats = tpls.map((t) => templateStats(t));
stats.forEach((s, l) => gate(`lod.budget.L${l}`, s.intactTris >= TARGET[l][0] * 0.9 && s.intactTris <= TARGET[l][1], `intact ${s.intactTris} tris (target ${TARGET[l].join('–')}), assembly ${s.assemblyTris}, intact draws ${s.intactDraws}, assembly meshes ${s.assemblyDraws}, ${(s.bytes / 1024).toFixed(0)} KB`));
for (let l = 1; l < 4; l++) gate(`lod.ratio.L${l - 1}/L${l}`, stats[l - 1].intactTris / stats[l].intactTris >= 2, `${(stats[l - 1].intactTris / stats[l].intactTris).toFixed(2)}× intact, ${(stats[l - 1].assemblyTris / stats[l].assemblyTris).toFixed(2)}× assembly`);
gate('draws.intact', stats.every((s) => s.intactDraws <= 8), stats.map((s) => s.intactDraws).join('/'));

// ── 9. semantics identical across LODs: part ids, pivots, attachment, channels, colliders, masses, anchors ─────────────────
{
  const sig = (d) => JSON.stringify({ parts: Object.fromEntries(Object.entries(d.parts).map(([id, p]) => [id, { pivot: p.pivot.map((v) => +v.toFixed(5)), attach: p.meta.attach, kind: p.meta.kind, channels: p.meta.channels, collider: p.meta.collider, mass: p.meta.massKg, hinge: p.meta.hinge }])), anchors: d.anchors, chassis: d.chassisColliders, fields: Object.keys(d.fields) });
  const s0 = sig(descs[0]), diff = descs.map((d, l) => (sig(d) === s0 ? null : `L${l}`)).filter(Boolean);
  gate('lod.semantics_identical', !diff.length, diff.length ? `differs: ${diff.join(',')}` : `${Object.keys(descs[0].parts).length} parts, ${Object.keys(descs[0].fields).length} channels, ${descs[0].chassisColliders.length} chassis proxies identical on every LOD`);
  const hingeOk = Object.values(descs[0].parts).filter((p) => p.meta.hinge).every((p) => p.meta.hinge.point.every((v, i) => Math.abs(v - p.pivot[i]) < 1e-9));
  gate('rig.pivots_on_hinges', hingeOk, 'every hinged part has its origin on its hinge point');
  const massSum = Object.values(descs[0].parts).reduce((a, p) => a + p.meta.massKg, 0);
  gate('mass.accounting', Math.abs(massSum - descs[0].massKg) < 0.1, `parts sum to ${massSum.toFixed(2)} kg of ${descs[0].massKg}`);
  const noRenderColliders = Object.values(descs[0].parts).every((p) => p.meta.collider === null || p.meta.collider === undefined || ['cuboid', 'cylinder'].includes(p.meta.collider.shape));
  gate('physics.authored_proxies', noRenderColliders && descs[0].chassisColliders.every((c) => c.shape === 'cuboid'), 'all colliders are authored cuboids/cylinders; none is hulled from render vertices');
}

// ── 10. nothing goes through the ground at full zone damage ───────────────────────────────────────────────────────────
{
  const w = combined(F, Object.fromEntries(ZONES.map((z) => [z, 1]))), g = descs[1].parts.chassis.layers.panel.paint, { pos } = warpGeometry(g, w);
  let m = 9; for (let i = 1; i < pos.length; i += 3) m = Math.min(m, pos[i]);
  gate('warp.above_ground', m > 0.05, `lowest chassis vertex at full damage y = ${m.toFixed(3)} m`);
}

const summary = { pass: results.length - fails, fail: fails, stats, build: descs.map((d, l) => ({ lod: l, buildMs: d.buildMs, morphMs: tpls[l].ms })) };
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/gates.json', import.meta.url), JSON.stringify({ summary, results }, null, 1));
console.log(`\n${summary.pass}/${results.length} gates pass`);
process.exitCode = fails ? 1 : 0;
