#!/usr/bin/env node
// opt.mjs (br-bwju.3, Spike J's optimiser for any car on the Cruz's lofted-body parameters): pixel-driven tuning. Coordinate
// descent on the model's numeric parameters, maximising the weighted silhouette IoU against a reference sheet, with a small
// pull back to the hand-measured start (so the optimiser can't wander into odd shapes) and a smoothness penalty.
//   node tools/vehicles/fit/opt.mjs <car> [sheet=lod1] [passes=4]  → rewrites art/vehicles/<car>/params.json and prints the log.
// Structure changes stay manual; this only tunes numbers.
import fs from 'node:fs'; import path from 'node:path'; import { open, close, REPO } from './lib.mjs';
const car = process.argv[2], sheet = process.argv[3] || 'lod1', passes = +(process.argv[4] || 4);
if (!car) { console.error('usage: opt.mjs <car> [sheet] [passes]'); process.exit(2); }
const page = await open(car); const pf = path.join(REPO, 'art/vehicles', car, 'params.json');
const P0 = JSON.parse(fs.readFileSync(pf, 'utf8'));
const START = JSON.parse(JSON.stringify(P0));
// tunable leaves: [path, step, maxDeviation]
const spec = [];
const add = (path, step, dev) => spec.push({ path, step, dev });
// A bike (br-bwju.5) has no lofted body: every numeric leaf of params.json is tunable, 2 cm steps, within 15 cm (radii and
// thicknesses within 4 cm) of the hand-measured start. The car spec below needs the lofted curves.
const BIKE = !P0.ySh;
if (BIKE) (function leaves(o, path) {
  for (const [k, v] of Object.entries(o)) {
    if (k === 'what') continue;
    if (typeof v === 'number' && v === 0) continue; // centreline values (the rider's spine, the hubs' x) stay put
    if (typeof v === 'number') add([...path, k], 0.02, /^(r|rF|rR|headR|w|t|h|tyreW)$/.test(k) ? 0.04 : 0.15);
    else if (v && typeof v === 'object') leaves(v, [...path, k]);
  }
})(P0, []);
if (!BIKE) for (const k of ['ySh', 'yCr', 'hw', 'yBot']) P0[k].forEach((_, i) => add([k, i, 1], 0.02, k === 'yBot' ? 0.08 : 0.15));
if (!BIKE) P0.cabin.forEach((c, i) => { add(['cabin', i, 'wb'], 0.02, 0.12); add(['cabin', i, 'wt'], 0.02, 0.15); if (c.yr != null) add(['cabin', i, 'yr'], 0.02, 0.12); if (i > 0 && i < P0.cabin.length - 1) add(['cabin', i, 'z'], 0.04, 0.3); });
if (!BIKE) for (const k of ['wheelR', 'archTop', 'archR', 'track']) add([k], 0.01, 0.08);
if (!BIKE) for (const k of ['y', 'z', 'plateH', 'span']) if (P0.spoiler?.[k] != null) add(['spoiler', k], 0.02, 0.15);
if (!BIKE) for (const k of ['out', 'y', 'z']) add(['mirror', k], 0.02, 0.1);
if (!BIKE) { add(['roofCh'], 0.01, 0.05); add(['shoulderIn'], 0.01, 0.06); add(['sideDrop'], 0.01, 0.06); }
const get = (o, p) => p.reduce((a, k) => a[k], o), set = (o, p, v) => { const t = p.slice(0, -1).reduce((a, k) => a[k], o); t[p.at(-1)] = +v.toFixed(4); };
const LAMBDA = 0.004, SMOOTH = +(process.env.SMOOTH ?? 0.004);
function roughness(P) { let r = 0; for (const k of ['ySh', 'yCr', 'hw', 'yBot']) { const c = P[k]; for (let i = 1; i < c.length - 1; i++) { const a = (c[i][1] - c[i - 1][1]) / (c[i - 1][0] - c[i][0]), b = (c[i + 1][1] - c[i][1]) / (c[i][0] - c[i + 1][0]); r += (b - a) ** 2; } } return r; }
const ROUGH0 = BIKE ? 0 : roughness(START);
// Shapes the IoU would buy that a car can't have (Lion President's fit, br-bwju.3): a glass top wider than its base (an
// overhanging greenhouse) and a bonnet or boot crown below its shoulder (a sunken centre). A steep penalty per centimetre.
function shape(P) {
  let bad = 0;
  for (const c of P.cabin) bad += Math.max(0, c.wt - c.wb);
  for (const [z, ycr] of P.yCr) { const sh = P.ySh.find(([zz]) => zz === z); if (sh) bad += Math.max(0, sh[1] - ycr); }
  return bad * 0.5;
}
async function score(P) {
  const r = await page.evaluate(async ([P, s]) => { window.__fit.setP(P); return window.__fit.evaluate(s); }, [P, sheet]);
  let pen = 0; for (const s of spec) pen += ((get(P, s.path) - get(START, s.path)) / s.dev) ** 2;
  // smoothness: second differences of every profile curve (stops zig-zag widths that only serve one view's perspective)
  // (only roughness added beyond the measured start is penalised: the nose slope is a deliberate sharp change)
  return { obj: r.score - LAMBDA * pen / spec.length * 10 - (BIKE ? 0 : SMOOTH * Math.max(0, roughness(P) - ROUGH0) + shape(P)), r };
}
let P = JSON.parse(JSON.stringify(P0)), best = await score(P); const log = [{ pass: 0, score: best.r.score, obj: best.obj }];
console.log('start', best.r.score, Object.entries(best.r.views).map(([k, v]) => `${k} ${v.iou}`).join(' '));
const t0 = Date.now();
for (let pass = 1; pass <= passes; pass++) {
  let improved = 0;
  for (const s of spec) {
    const x = get(P, s.path), x0 = get(START, s.path);
    for (const dir of [1, -1]) {
      const v = x + dir * s.step; if (Math.abs(v - x0) > s.dev) continue;
      const Q = JSON.parse(JSON.stringify(P)); set(Q, s.path, v);
      const c = await score(Q);
      if (c.obj > best.obj + 1e-5) { P = Q; best = c; improved++; break; }
    }
  }
  console.log(`pass ${pass}: ${improved} moves, score ${best.r.score}`, Object.entries(best.r.views).map(([k, v]) => `${k} ${v.iou}`).join(' '), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  log.push({ pass, score: best.r.score, obj: best.obj, moves: improved });
  if (!improved) for (const s of spec) s.step /= 2;
}
fs.writeFileSync(pf, `${JSON.stringify(P, null, 1)}\n`);
console.log(JSON.stringify({ sheet, final: best.r.score, moved: spec.map((s) => ({ p: s.path.join('.'), from: get(START, s.path), to: get(P, s.path) })).filter((m) => m.from !== m.to) }));
await close();
