#!/usr/bin/env node
// render_gates.mjs — the gates that need a GPU/browser and consume the BAKED GLBs through three's GLTFLoader:
//   silhouette.lod_stable   each LOD's orthographic silhouette (side/top/front) vs LOD0: IoU thresholds (no visible "pop" when LODs swap)
//   silhouette.reference    side/top/front shape vs the real-Cruze orthographic references (normalised, so deliberate cute proportions
//                           are allowed but a wrong roofline/greenhouse/wheel layout is not). Thresholds = measured baseline − margin.
//   rig.smoke               steer, spin, doors/bonnet/boot open, suspension, lights, paint tint, dent+reset, detach package (kit/rig.js)
//   perf.grid               24 cars at 3840×2160 from the GLBs: draw calls, triangles, frame ms (relative numbers — this Mac's GPU)
//   node tools/render_gates.mjs [assetDir=asset/cruze] [--out out/gates]        (needs the static server on :8123 + system Chrome)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) ?? 'asset/cruze'), OUT = path.resolve(opt('--out', 'out/gates')); fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? 'http://localhost:8123', ROOT = '/spikes/art-pipeline/H-primitive-kit', REL = path.relative(path.resolve('.'), DIR);
const sidecar = JSON.parse(fs.readFileSync(path.join(DIR, 'cruze.asset.json'), 'utf8'));
const T = { lodIou: { 1: { side: 0.96, top: 0.95, front: 0.95 }, 2: { side: 0.93, top: 0.92, front: 0.92 }, 3: { side: 0.9, top: 0.88, front: 0.88 } }, refIou: { side: 0.66, top: 0.6, front: 0.66 } };
let fail = 0; const results = [];
const gate = (id, ok, detail) => { results.push({ id, ok, detail }); if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(`${BASE}${ROOT}/index.html?capture=1&w=400&h=300&nointact=1`);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
const url = (lod) => `${ROOT}/${REL}/cruze.lod${lod}.glb`;
const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

// ── silhouettes ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const sil = await page.evaluate(async ([urls, refs]) => {
  const G = await import('/spikes/art-pipeline/H-primitive-kit/tools/render_gates_page.js'), res = { lod: {}, ref: {}, png: {} };
  const scenes = []; for (const u of urls) scenes.push(await G.loadGlb(u));
  const dims = { side: [256, 128], top: [256, 128], front: [128, 128] };
  const masks = scenes.map(() => ({}));
  for (const view of ['side', 'top', 'front']) { const fr = G.frameFor(scenes[0], view); scenes.forEach((s, i) => (masks[i][view] = G.silhouette(s, view, fr))); }
  for (let i = 1; i < scenes.length; i++) { res.lod[i] = {}; for (const view of ['side', 'top', 'front']) res.lod[i][view] = G.iou(masks[0][view], masks[i][view]); }
  for (const view of ['side', 'top', 'front']) {
    const r = await G.refMask(refs[view]), [gw, gh] = dims[view], refN = G.normalise(r.m, r.w, r.h, gw, gh), ours = G.normalise(masks[1][view], 256, 256, gw, gh);
    res.ref[view] = G.iou(refN, ours); res.png[view] = G.overlayPng(refN, ours, gw, gh);
  }
  return res;
}, [[0, 1, 2, 3].map(url), { side: `${ROOT}/../refs/side.png`, top: `${ROOT}/../refs/top.png`, front: `${ROOT}/../refs/front.png` }]);
for (const lod of [1, 2, 3]) { const bad = Object.entries(T.lodIou[lod]).filter(([v, min]) => sil.lod[lod][v] < min); gate(`silhouette.lod_stable.LOD${lod}`, !bad.length, `IoU vs LOD0: side ${sil.lod[lod].side.toFixed(3)} top ${sil.lod[lod].top.toFixed(3)} front ${sil.lod[lod].front.toFixed(3)}${bad.length ? ' — below ' + bad.map(([v, m]) => `${v}≥${m}`).join(', ') : ''}`); }
{ const bad = Object.entries(T.refIou).filter(([v, min]) => sil.ref[v] < min); gate('silhouette.reference', !bad.length, `shape IoU vs the real-Cruze orthographic refs (LOD1, normalised): side ${sil.ref.side.toFixed(3)} top ${sil.ref.top.toFixed(3)} front ${sil.ref.front.toFixed(3)} (min ${JSON.stringify(T.refIou)})`); }
for (const v of Object.keys(sil.png)) save(`silhouette_ref_${v}.png`, sil.png[v]);

// ── rig smoke ────────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const lod of [1, 2]) {
  const s = await page.evaluate(async ([u, sc]) => (await import('/spikes/art-pipeline/H-primitive-kit/tools/render_gates_page.js')).smoke(u, sc), [url(lod), sidecar]);
  for (const r of s) gate(`rig.smoke.${r.id}.LOD${lod}`, r.ok, r.detail);
}
// ── grid perf ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const perf = {};
for (const lod of [1, 2, 3]) {
  const g = await page.evaluate(async ([u, sc]) => (await import('/spikes/art-pipeline/H-primitive-kit/tools/render_gates_page.js')).grid(u, sc, 24, true), [url(lod), sidecar]);
  const gp = await page.evaluate(async ([u, sc]) => (await import('/spikes/art-pipeline/H-primitive-kit/tools/render_gates_page.js')).grid(u, sc, 24, false), [url(lod), sidecar]);
  save(`grid24_glb_lod${lod}.jpg`, g.png); delete g.png; delete gp.png; perf[`LOD${lod}`] = { intact: g, parts: gp };
  gate(`perf.grid24.LOD${lod}`, g.frameMs < 33 && g.calls < 1000, `24 cars × LOD${lod} at 3840×2160 from the GLB, intact fast path: ${g.calls} draw calls (${gp.calls} with parts), ${g.tris.toLocaleString()} tris, ${g.frameMs} ms/frame (gate < 33 ms, < 1000 calls)`);
}
fs.writeFileSync(path.join(OUT, 'render_gates.json'), JSON.stringify({ silhouette: { lod: sil.lod, ref: sil.ref }, perf, results }, null, 1));
await browser.close();
console.log(`--- render gates: ${results.length - fail} PASS, ${fail} FAIL ---`);
process.exit(fail ? 1 : 0);
