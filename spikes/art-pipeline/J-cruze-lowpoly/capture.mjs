// capture.mjs — evidence for one iteration: scores + diff overlays + shaded views vs the reference crops.
// node capture.mjs [tag] [lod] [sheet]   → out/<tag>/{score.json, diff_<view>.png, shade_<view>.png, hero.png}
import fs from 'node:fs';
import { open, close, OUT, saveDataURL } from './lib.mjs';
const tag = process.argv[2] || 'iter', lod = +(process.argv[3] ?? 0), sheet = process.argv[4] || 'lod1';
const dir = `${OUT}${tag}/`; fs.mkdirSync(dir, { recursive: true });
const page = await open();
const pfile = new URL('./params.json', import.meta.url);
const P = fs.existsSync(pfile) ? JSON.parse(fs.readFileSync(pfile)) : null;
const stats = await page.evaluate(([P, lod]) => { if (P) window.__j.setP(P); return window.__j.setLod(lod); }, [P, lod]);
const ev = await page.evaluate((s) => window.__j.evaluate(s, { images: true }), sheet);
for (const [v, r] of Object.entries(ev.views)) { saveDataURL(`${dir}diff_${v}.png`, r.diff); delete r.diff; }
for (const v of ['side', 'front', 'rear', 'top']) saveDataURL(`${dir}shade_${v}.png`, await page.evaluate((v) => window.__j.shaded(v, 900, v === 'top' ? 1100 : 420), v));
saveDataURL(`${dir}hero.png`, await page.evaluate(() => window.__j.shaded('hero', 1200, 560, { az: 52, elev: 10, dist: 11, fov: 26 })));
saveDataURL(`${dir}hero_rear.png`, await page.evaluate(() => window.__j.shaded('hero', 1200, 560, { az: 140, elev: 14, dist: 11, fov: 26 })));
fs.writeFileSync(`${dir}score.json`, JSON.stringify({ lod, sheet, stats, ...ev }, null, 1));
console.log(JSON.stringify({ tris: stats.tris, breakdown: stats.breakdown, score: ev.score, views: ev.views }));
await close();
