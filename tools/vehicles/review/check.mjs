#!/usr/bin/env node
// Fails if any roster vehicle's design-site review page lacks any of the seven Vehicles-contract items (R126, P1-D03b):
//   1 reference sheets beside the model, with silhouette IoU per view   2 LOD turntable data against the budgets
//   3 damage states   4 paint identities   5 in-world captures (small, large, overview)   6 validation gate result and
//   handling summary   7 for R123's spec twins, both cars with the shared spec.
// Also fails when a generated page or file is missing or roster.json isn't the art/vehicles roster (staleness is
// `build.mjs --check`'s job locally; the POC deploy rebuilds before it publishes).
//   node tools/vehicles/review/check.mjs      (CI: scripts/ci/checks.sh; needs no LFS objects)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, buildAll, rosterIds } from './build.mjs';

const STATUSES = ['awaiting-review', 'accepted', 'changes-asked'];
const VIEWS = ['side', 'top', 'front', 'rear'];
const SIZES = ['small', 'large', 'overview'];

// review: a review.json object; has(file): does the media file exist for this vehicle. Returns the missing items.
export function checkReview(r, has, byId = {}) {
  const bad = [];
  const need = (item, ok, what) => { if (!ok) bad.push(`item ${item}: ${what}`); };
  need(0, !!r.id && !!r.name && STATUSES.includes(r.status) && !!r.date && r.beads?.length > 0 && !!r.feedback, `id, name, status (${STATUSES.join('/')}), date, beads and how feedback comes back`);
  const cmp = r.reference?.compare ?? [];
  const lods = r.turntable?.lods ?? [];
  const measured = r.reference?.measured;
  const measuredValid = measured?.kind === 'owner-measured' && measured.pass === true && has(measured.oracle) && has(measured.report)
    && measured.rows?.length > 0 && measured.rows.every(row => Number.isFinite(row.target) && row.actual?.length === lods.length && row.actual.every(a => Number.isFinite(a.value)) && lods.every(l => row.actual.some(a => a.lod === l.lod)))
    && measured.lods?.length === lods.length && lods.length > 0 && new Set(measured.lods.map(l => l.lod)).size === lods.length
    && lods.every(l => measured.lods.some(m => m.lod === l.lod && m.pass === true && m.checks?.length > 0 && m.checks.every(c => c.pass === true) && Array.isArray(m.injections) && m.injections.every(i => i.detected === true)));
  const sheetValid = cmp.length > 0 && cmp.every(c => has(c.sheet) && VIEWS.every(v => typeof c.iou?.[v] === 'number') && typeof c.weightedIou === 'number');
  need(1, has(r.reference?.sheet) && (measured ? measuredValid : sheetValid),
    'reference sheet with per-view IoU, or explicit owner photo with existing measured oracle/report, finite target/current rows and passing checks at every model LOD');
  need(2, lods.length > 0 && has(r.turntable?.assetJson) && has(r.turntable?.atlas) && lods.every((l) => has(l.glb) && Number.isInteger(l.tris) && Number.isInteger(l.draws) && l.maxTris > 0 && l.withinBudget),
    'every LOD with its GLB, triangles and draw calls within maxTris');
  const parts = (r.damage?.parts ?? []).map((p) => p.name);
  // A car's damage groups, or a bike's (br-bwju.5, the bike part set: the rider comes off instead of doors).
  const bike = parts.includes('wheel_F'), groups = bike ? ['front', 'back', 'rider', 'wheel_'] : ['front', 'back', 'door_', 'wheel_'];
  need(3, has(r.damage?.strip) && has(r.damage?.overview) && groups.every((g) => parts.some((p) => p === g || p.startsWith(g))) && (r.damage?.parts ?? []).some((p) => p.hinge),
    `damage strip and overview images, and the ${bike ? 'rider' : 'door'}/wheel/front/back parts with their hinges`);
  need(4, has(r.paints?.sheet) && (r.paints?.colours?.length ?? 0) > 0 && !!r.paints?.pattern, 'paints sheet, the seat colours and the identity pattern');
  const sizes = (r.inWorld ?? []).filter((w) => has(w.image)).map((w) => w.size);
  need(5, SIZES.every((s) => sizes.includes(s)), `in-world captures at ${SIZES.join(', ')} (existing images)`);
  need(6, ['PASS', 'FAIL'].includes(r.gate?.result) && (r.gate?.findings?.length ?? 0) > 0 && has(r.gate?.report), 'the validation gate result, its findings and the report');
  const h = r.handling;
  need(6, !!h && h.massKg > 0 && typeof h.accel?.value === 'number' && !!h.topSpeed && (h.topSpeed.value != null || !!h.topSpeed.note) && !!h.cornering?.maxSteerRad, 'handling summary: mass, acceleration, top speed (value or an honest note) and cornering');
  if (r.specTwin) {
    const t = byId[r.specTwin.id];
    const same = (k) => JSON.stringify(t?.handling?.[k]) === JSON.stringify(h?.[k]);
    need(7, !!t && t.specTwin?.id === r.id && ['massKg', 'accel', 'cornering', 'braking'].every(same) && !!r.specTwin.sharedSpec,
      `spec twin ${r.specTwin.id}: both cars listed, pointing at each other, with identical handling and the shared spec text`);
  }
  return bad;
}

export function checkAll() {
  const failures = [];
  const { reviews, problems } = buildAll(false);
  // Stale copies don't fail: the POC deploy regenerates the pages before publishing, so a profile tweak never reds CI.
  // A missing page or file still fails (a new vehicle needs `node tools/vehicles/review/build.mjs` once).
  failures.push(...problems.filter((p) => !p.includes(' is stale: ') && !p.includes(' differs from ')));
  const ids = rosterIds();
  let roster = null;
  try { roster = JSON.parse(fs.readFileSync(path.join(SITE, 'roster.json'), 'utf8')); } catch { failures.push('roster.json is missing or unreadable'); }
  if (roster && JSON.stringify(roster.vehicles.map((v) => v.id).sort()) !== JSON.stringify(ids)) failures.push(`roster.json lists ${roster.vehicles.map((v) => v.id).join(', ')} but art/vehicles has ${ids.join(', ')}`);
  const byId = Object.fromEntries(reviews.filter((r) => !r.missing).map((r) => [r.id, r]));
  for (const r of reviews) {
    if (r.missing) { failures.push(`${r.id}: no review data (${r.missing.join(', ')}): every roster vehicle needs a review page`); continue; }
    const has = (f) => !!f && fs.existsSync(path.join(SITE, r.id, f));
    for (const b of checkReview(r, has, byId)) failures.push(`${r.id}: ${b}`);
  }
  return { ids, failures };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ids, failures } = checkAll();
  if (failures.length) { for (const f of failures) console.error(`FAIL ${f}`); process.exit(1); }
  console.log(`vehicle review pages: ${ids.length} roster vehicle(s) (${ids.join(', ')}), all Vehicles-contract items present`);
}
