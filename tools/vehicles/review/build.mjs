#!/usr/bin/env node
// The design site's Vehicles section, generated from the roster data (R126, P1-D03b, P1-V bwju.1).
// The roster IS the directories of art/vehicles/ that carry a vehicle.json and a bake (<id>.asset.json; a car still being modelled isn't staged yet): no hard-coded list anywhere. For each one this
// reads vehicle.json, the bake (<id>.asset.json + GLBs), assets/profiles/<id>.json and the car's review.src.json, copies
// the files the page shows into art/ui/poc/vehicles/<id>/ (the deploy mirrors only art/ui/) and writes review.json beside
// them, plus roster.json for the Vehicles index. A new vehicle gets a page by being added to art/vehicles/.
//   node tools/vehicles/review/build.mjs            write
//   node tools/vehicles/review/build.mjs --check    fail if the committed outputs differ (CI; no LFS needed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const SITE = path.join(REPO, 'art/ui/poc/vehicles');
const rel = (p) => path.relative(REPO, p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const isPointer = (buf) => buf.subarray(0, 40).toString('latin1').startsWith('version https://git-lfs');

export function rosterIds() {
  const dir = path.join(REPO, 'art/vehicles');
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'vehicle.json')) && fs.existsSync(path.join(dir, d, `${d}.asset.json`))).sort();
}

// Triangles and draw calls per LOD, counted from the GLB (parts only: collider proxies and interior blocks are not drawn
// as part of the intact car). Null for an LFS pointer, so CI's checks job (no LFS) can keep the committed numbers.
export function glbStats(file) {
  const d = fs.readFileSync(file);
  if (isPointer(d)) return null;
  const n = d.readUInt32LE(12), json = JSON.parse(d.subarray(20, 20 + n).toString('utf8'));
  let tris = 0, draws = 0;
  for (const node of json.nodes) {
    if (node.mesh == null || /^(collider_|interior_)/.test(node.name)) continue;
    draws++;
    for (const prim of json.meshes[node.mesh].primitives) tris += json.accessors[prim.indices ?? prim.attributes.POSITION].count / 3;
  }
  return { tris, draws };
}

function gateResult(file) {
  const text = fs.readFileSync(file, 'utf8');
  const result = /^Vehicle Model Validation:\s*(\w+)/m.exec(text)?.[1] ?? null;
  const findings = [...text.matchAll(/^- (PASS|FAIL|WARN)\s+(.+)$/gm)].map((m) => ({ result: m[1], text: m[2] }));
  return { result, findings };
}

function handling(profileFile, src) {
  if (!fs.existsSync(profileFile)) return null;
  const { tuning: t, geometry: g } = readJson(profileFile);
  const launch = t.max_engine_force / t.mass;
  return {
    source: rel(profileFile),
    massKg: t.mass,
    drive: t.drive,
    accel: { value: +launch.toFixed(2), unit: 'm/s2', note: 'engine force over mass at launch: an upper bound, drag and traction not included' },
    topSpeed: src.topSpeedMps == null ? { value: null, note: src.topSpeedNote ?? 'not measured yet' } : { value: src.topSpeedMps, unit: 'm/s', note: src.topSpeedNote ?? '' },
    cornering: { maxSteerRad: t.max_steer_rad, steerFalloffMps: t.steer_falloff_mps, frictionSlip: t.friction_slip, driftRearGrip: t.drift_rear_grip, rollInfluence: t.roll_influence },
    braking: { maxBrakeForceN: t.max_brake_force },
    boost: { engineGain: t.boost_engine_gain, drainPerS: t.boost_drain_per_s, rechargePerS: t.boost_recharge_per_s },
    wheelRadiusM: g.wheel_radius,
  };
}

export function buildVehicle(id, copies) {
  const car = path.join(REPO, 'art/vehicles', id), out = path.join(SITE, id);
  const vehicle = readJson(path.join(car, 'vehicle.json'));
  const srcFile = path.join(car, 'review.src.json');
  if (!fs.existsSync(srcFile)) return { id, name: id, missing: ['review.src.json'] };
  const src = readJson(srcFile);
  const asset = readJson(path.join(car, `${id}.asset.json`));
  const prevFile = path.join(out, 'review.json');
  const prev = fs.existsSync(prevFile) ? readJson(prevFile) : null;
  const media = (repoPath, section) => {
    const from = path.join(REPO, repoPath), to = path.join('media', section, path.basename(repoPath));
    copies.push([from, path.join(out, to)]);
    return to;
  };
  const r = {
    id, name: src.name, status: src.status, date: src.date, beads: src.beads, summary: src.summary, feedback: src.feedback,
    specTwin: src.specTwin ?? null,
  };
  r.reference = { sheet: media(src.reference.sheet, 'reference'), note: src.reference.note, compare: [] };
  for (const c of src.reference.compare) {
    const score = readJson(path.join(REPO, c.dir, 'score.json'));
    r.reference.compare.push({
      lod: c.lod, label: c.label, sheet: media(`${c.dir}/sheet.png`, `reference-lod${c.lod}`),
      iou: Object.fromEntries(Object.entries(score.views).map(([k, v]) => [k, v.iou])), weightedIou: score.score,
    });
  }
  r.turntable = {
    assetJson: media(rel(path.join(car, `${id}.asset.json`)), 'model'), atlas: media(rel(path.join(car, `${id}.atlas.png`)), 'model'),
    emissive: media(rel(path.join(car, `${id}.emissive.png`)), 'model'), sheet: media(src.turntable.sheet, 'turntable'), lods: [],
  };
  for (const [i, lod] of asset.lods.entries()) {
    const glb = path.join(car, lod.file), s = glbStats(glb) ?? prev?.turntable?.lods?.[i] ?? { tris: null, draws: null };
    r.turntable.lods.push({ lod: i, glb: media(rel(glb), 'model'), tris: s.tris, draws: s.draws, maxTris: lod.maxTris, withinBudget: s.tris != null && s.tris <= lod.maxTris });
  }
  r.damage = {
    strip: media(src.damage.strip, 'damage'), overview: media(src.damage.overview, 'damage'), note: src.damage.note,
    parts: Object.entries(asset.parts).map(([name, p]) => ({ name, hinge: p.hinge, pivot: p.pivot })),
    interiors: Object.fromEntries(Object.entries(vehicle.interiors ?? {}).map(([k, v]) => [k, v.exposedBy])),
  };
  const tokens = readJson(path.join(REPO, src.paints.identity));
  r.paints = { sheet: media(src.paints.sheet, 'paints'), colours: tokens.identity.colors.map((c) => ({ name: c.name, hex: c.hex })), pattern: src.paints.pattern };
  r.inWorld = src.inWorld.map((w) => ({ label: w.label, size: w.size, image: media(w.path, 'in-world') }));
  r.gate = { ...gateResult(path.join(REPO, src.gate.report)), report: media(src.gate.report, 'gate') };
  r.handling = handling(path.join(REPO, src.profile), src.handling ?? {});
  return r;
}

export function buildAll(write) {
  const copies = [], texts = new Map(), problems = [];
  const reviews = rosterIds().map((id) => buildVehicle(id, copies));
  for (const r of reviews) if (!r.missing) texts.set(path.join(SITE, r.id, 'review.json'), JSON.stringify(r, null, 2) + '\n');
  const roster = {
    what: 'Generated by tools/vehicles/review/build.mjs from art/vehicles/*/vehicle.json: every roster vehicle, no hard-coded list.',
    vehicles: reviews.map((r) => (r.missing ? { id: r.id, name: r.name, status: 'no-review-data', missing: r.missing }
      : { id: r.id, name: r.name, status: r.status, date: r.date, beads: r.beads, summary: r.summary, lods: r.turntable.lods.length, parts: r.damage.parts.length, specTwin: r.specTwin })),
  };
  roster.vehicles.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));
  texts.set(path.join(SITE, 'roster.json'), JSON.stringify(roster, null, 2) + '\n');
  if (write) {
    for (const [file, body] of texts) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); }
    for (const [from, to] of copies) {
      const buf = fs.readFileSync(from);
      if (isPointer(buf) && fs.existsSync(to) && !isPointer(fs.readFileSync(to))) continue; // keep real bytes over a pointer
      if (fs.existsSync(to) && Buffer.compare(fs.readFileSync(to), buf) === 0) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, buf);
    }
  } else {
    for (const [file, body] of texts) if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) problems.push(`${rel(file)} is stale: run node tools/vehicles/review/build.mjs`);
    for (const [from, to] of copies) {
      if (!fs.existsSync(to)) { problems.push(`${rel(to)} is missing: run node tools/vehicles/review/build.mjs`); continue; }
      const a = fs.readFileSync(from), b = fs.readFileSync(to);
      if (!isPointer(a) && !isPointer(b) && Buffer.compare(a, b) !== 0) problems.push(`${rel(to)} differs from ${rel(from)}: run node tools/vehicles/review/build.mjs`);
    }
  }
  return { reviews, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { reviews, problems } = buildAll(!check);
  if (problems.length) { for (const p of problems) console.error(p); process.exit(1); }
  console.log(`${check ? 'checked' : 'wrote'} ${reviews.length} vehicle review page(s): ${reviews.map((r) => r.id).join(', ')}`);
}
