#!/usr/bin/env node
// capture.mjs (br-bwju.3, from Spike J): scores one car against one reference sheet and writes the review images.
//   node tools/vehicles/fit/capture.mjs <car> --out <dir> [--lod 0] [--sheet lod1]
//   → <dir>/{score.json, diff_<view>.png, shade_<view>.png, hero.png, hero_rear.png, sheet.png}
// sheet.png (compose.py) is the reference crop | our shaded view | silhouette diff per view, plus the heroes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { open, close, saveDataURL, REPO } from './lib.mjs';

const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const car = args[0], lod = +opt('--lod', 0), sheet = opt('--sheet', 'lod1'), dir = path.resolve(opt('--out', ''));
if (!car || !opt('--out')) { console.error('usage: capture.mjs <car> --out <dir> [--lod 0] [--sheet lod1]'); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });
const page = await open(car);
try {
  const stats = await page.evaluate((l) => window.__fit.setLod(l), lod);
  const ev = await page.evaluate((s) => window.__fit.evaluate(s, { images: true }), sheet);
  for (const [v, r] of Object.entries(ev.views)) { saveDataURL(path.join(dir, `diff_${v}.png`), r.diff); delete r.diff; }
  for (const v of ['side', 'front', 'rear', 'top']) saveDataURL(path.join(dir, `shade_${v}.png`), await page.evaluate((v) => window.__fit.shaded(v, 900, v === 'top' ? 1100 : 420), v));
  saveDataURL(path.join(dir, 'hero.png'), await page.evaluate(() => window.__fit.shaded('hero', 1200, 560, { az: 52, elev: 10, dist: 11, fov: 26 })));
  saveDataURL(path.join(dir, 'hero_rear.png'), await page.evaluate(() => window.__fit.shaded('hero', 1200, 560, { az: 140, elev: 14, dist: 11, fov: 26 })));
  fs.writeFileSync(path.join(dir, 'score.json'), `${JSON.stringify({ car, lod, sheet, stats, ...ev }, null, 1)}\n`);
  console.log(JSON.stringify({ tris: stats.tris, score: ev.score, views: Object.fromEntries(Object.entries(ev.views).map(([k, v]) => [k, v.iou])) }));
} finally {
  await close();
}
execFileSync('python3', [path.join(REPO, 'tools/vehicles/fit/compose.py'), dir, path.join(REPO, 'art/vehicles', car, 'refs/masks'), sheet], { stdio: 'inherit' });
