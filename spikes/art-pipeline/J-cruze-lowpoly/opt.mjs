// opt.mjs — pixel-driven tuning: coordinate descent on the model's numeric parameters, maximising the weighted silhouette IoU
// against a reference sheet, with a small pull back to the measured start (so the optimiser can't wander into odd shapes).
// node opt.mjs [sheet=lod1] [passes=4]  → params.json (+ out/opt_log.json). Structure changes stay manual; this only tunes numbers.
import fs from 'node:fs'; import { open, close, OUT } from './lib.mjs';
const sheet = process.argv[2] || 'lod1', passes = +(process.argv[3] || 4);
const page = await open(); const pf = new URL('./params.json', import.meta.url);
const P0 = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf)) : await page.evaluate(() => window.__j.P);
const START = JSON.parse(JSON.stringify(P0));
// tunable leaves: [path, step, maxDeviation]
const spec = [];
const add = (path, step, dev) => spec.push({ path, step, dev });
for (const k of ['ySh', 'yCr', 'hw', 'yBot']) P0[k].forEach((_, i) => add([k, i, 1], 0.02, k === 'yBot' ? 0.08 : 0.15));
P0.cabin.forEach((c, i) => { add(['cabin', i, 'wb'], 0.02, 0.12); add(['cabin', i, 'wt'], 0.02, 0.15); if (c.yr != null) add(['cabin', i, 'yr'], 0.02, 0.12); if (i > 0 && i < P0.cabin.length - 1) add(['cabin', i, 'z'], 0.04, 0.3); });
for (const k of ['wheelR', 'archTop', 'archR', 'track']) add([k], 0.01, 0.08);
for (const k of ['y', 'z', 'plateH', 'span']) add(['spoiler', k], 0.02, 0.15);
for (const k of ['out', 'y', 'z']) add(['mirror', k], 0.02, 0.1);
add(['roofCh'], 0.01, 0.05); add(['shoulderIn'], 0.01, 0.06); add(['sideDrop'], 0.01, 0.06);
const get = (o, p) => p.reduce((a, k) => a[k], o), set = (o, p, v) => { const t = p.slice(0, -1).reduce((a, k) => a[k], o); t[p.at(-1)] = +v.toFixed(4); };
const LAMBDA = 0.004, SMOOTH = +(process.env.SMOOTH ?? 0.004);
function roughness(P) { let r = 0; for (const k of ['ySh', 'yCr', 'hw', 'yBot']) { const c = P[k]; for (let i = 1; i < c.length - 1; i++) { const a = (c[i][1] - c[i - 1][1]) / (c[i - 1][0] - c[i][0]), b = (c[i + 1][1] - c[i][1]) / (c[i][0] - c[i + 1][0]); r += (b - a) ** 2; } } return r; }
const ROUGH0 = roughness(START);
async function score(P) {
  const r = await page.evaluate(async ([P, s]) => { window.__j.setP(P); return window.__j.evaluate(s); }, [P, sheet]);
  let pen = 0; for (const s of spec) pen += ((get(P, s.path) - get(START, s.path)) / s.dev) ** 2;
  // smoothness: second differences of every profile curve (stops zig-zag widths that only serve one view's perspective)
  // (only roughness added beyond the measured start is penalised: the nose slope is a deliberate sharp change)
  return { obj: r.score - LAMBDA * pen / spec.length * 10 - SMOOTH * Math.max(0, roughness(P) - ROUGH0), r };
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
fs.writeFileSync(pf, JSON.stringify(P, null, 1));
fs.writeFileSync(OUT + 'opt_log.json', JSON.stringify({ sheet, log, final: best.r, moved: spec.map((s) => ({ p: s.path.join('.'), from: get(START, s.path), to: get(P, s.path) })).filter((m) => m.from !== m.to) }, null, 1));
await close();
