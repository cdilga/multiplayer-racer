// bake.mjs — build the code-defined Cruze at every LOD, convert to the contract scene, export GLBs and write the sidecar.
//   node tools/bake.mjs [outDir=asset/cruze]      (needs the repo static server on :8123 — see SKILL.md — and system Chrome)
// Output:  cruze.lod{0..3}.glb  cruze.asset.json  bake-report.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { Glb, readGlb, writeGlb } from './glb.mjs';

const OUT = path.resolve(process.argv[2] ?? 'asset/cruze'); fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? 'http://localhost:8123/spikes/art-pipeline/H-primitive-kit';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(`${BASE}/index.html?capture=1&w=400&h=300&nointact=1`);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });

const ROLES = ['hero / close-up (optional richer variant)', 'baseline close gameplay mesh (always loaded)', 'medium', 'distant / small'];
const lods = [];
let meta0 = null;
for (const lod of [0, 1, 2, 3]) {
  const r = await page.evaluate(async (lod) => {
    const { build, GOLD, MASS_KG } = await import('/spikes/art-pipeline/H-primitive-kit/cruze.js');
    const { toContractScene } = await import('/spikes/art-pipeline/H-primitive-kit/kit/contract.js');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const t0 = performance.now(); const car = await build({ lod, paint: GOLD.paint, finish: GOLD.finish }); const buildMs = performance.now() - t0;
    const { scene, meta } = toContractScene(car, { lod, massKg: MASS_KG });
    const buf = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, includeCustomExtensions: false });
    let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return { b64: btoa(s), meta, buildMs };
  }, lod);
  const file = path.join(OUT, `cruze.lod${lod}.glb`), { json, bin } = { ...readGlb_b64(r.b64) };
  // colliders carry NO material (contract): drop material refs from col_* meshes
  json.nodes.forEach((n) => { if (n.name?.startsWith('col_') && n.mesh != null) json.meshes[n.mesh].primitives.forEach((p) => delete p.material); });
  writeGlb(file, json, bin);
  const g = new Glb(file), tris = g.triangles(), draws = g.visualNodes().reduce((s, [n]) => s + json.meshes[n.mesh].primitives.length, 0);
  const mats = new Set(); json.meshes.forEach((m) => m.primitives.forEach((p) => p.material != null && mats.add(p.material)));
  lods.push({ lod, file: path.basename(file), role: ROLES[lod], triangles: tris, draw_calls: draws, materials: mats.size, bytes: fs.statSync(file).size, build_ms: Math.round(r.buildMs), triangle_hypothesis: [null, [1000, 3000], [500, 1000], [150, 400]][lod] });
  if (lod === 1) meta0 = r.meta;
  console.log(`LOD${lod} ${tris} tris  ${draws} prims  ${mats.size} mats  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  build ${Math.round(r.buildMs)} ms`);
}
await browser.close();

function readGlb_b64(b64) { const tmp = path.join(OUT, '.tmp.glb'); fs.writeFileSync(tmp, Buffer.from(b64, 'base64')); const g = readGlb(tmp); fs.unlinkSync(tmp); return g; }

const m = meta0, parts = {};
for (const [id, p] of Object.entries(m.parts)) parts[id] = { node: p.node, mass_fraction: p.mass_fraction, joint: p.joint, attach: p.attach, detachable: p.detachable, dents: p.dents, collider: m.colliders['col_' + id] ? 'col_' + id : undefined };
const sidecar = {
  contract: 'jj-vehicle/0.1-draft+procedural', asset_id: 'cruze-primitive', archetype: 'small_sedan', display_name: 'Cruze (primitives)',
  inspired_by: 'early-2010s Australian small sedan (generic roundel badge; no real marque, no lettering)',
  space: { up: '+Y', forward: '-Z', right: '+X', handedness: 'right' }, units: 'm', origin: 'ground plane, midway between the axles, on the centreline',
  bounds: m.bounds, lods, baseline_lod: 1, parts, trims: {}, wheels: m.wheels, drive: m.drive, suspension: m.suspension,
  physics: { mass_kg: m.mass_kg, com: m.com, profile: 'profiles/vehicles/cruze-primitive.json (pending jj-sim)', colliders: Object.fromEntries(Object.entries(m.colliders).map(([k, v]) => [k, { shape: v.shape, part: v.part, verts: v.verts }])) },
  anchors: m.anchors, materials: m.materials,
  textures: { mode: 'vertex-colour', note: 'paint = tint × COLOR_0 (baked dirt/AO). No paint mask.', trim: { file: 'embedded in jj_plastic_trim', px: [256, 128], use: 'grille honeycomb (top half) + slats (bottom half) via UV sub-rects' } },
  deformation: { mode: 'runtime-vertex', dentable: Object.entries(parts).filter(([, p]) => p.dents?.length).map(([k]) => k), note: 'Dents are applied to the LOD mesh vertices from hit records {part,pos,dir,radius,depth,severity}; no authored morph targets. Replay is bit-identical.', min_vertex_spacing_m: { 0: 0.11, 1: 0.2, 2: 0.32, 3: 0.55 } },
  identity: { roof_number_anchor: 'roof_number', roof_number_size_m: 0.9, paint_semantic: 'paint', tint: 'multiply jj_paint baseColor by identity colour; COLOR_0 keeps the baked shading', plates: ['lplate_front', 'lplate_rear'] },
  procedural: { module: 'cruze.js', kit: 'kit/*.js', deterministic: true, note: 'GLBs are a bake of the code; regenerate with tools/bake.mjs. The code is the source of truth.' },
  contract_profile_differences: ['no morph targets (runtime vertex dents)', 'no paint mask texture (vertex colours + tint)', 'wheel_XX has child wheel_XX_spin (spin) under the steer node', 'extra parts spoiler and glass split (windscreen/rear/quarters in `glass`, door glass in doors)'],
};
fs.writeFileSync(path.join(OUT, 'cruze.asset.json'), JSON.stringify(sidecar, null, 1));
fs.writeFileSync(path.join(OUT, 'bake-report.json'), JSON.stringify({ lods, when: new Date().toISOString() }, null, 1));
console.log('sidecar written', path.join(OUT, 'cruze.asset.json'));
