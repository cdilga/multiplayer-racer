#!/usr/bin/env node
// P1-U05 (br-dim.12) A/B evidence: for GTAO, SMAA and shadows (and the control), render the compare page at the sizes players see
// and save the A and B frames, the heatmap, the 4x crops and the metrics.
//   node art/ui/poc/world/capture-compare.mjs [--out docs/evidence/br-dim.12] [--only gtao,smaa] [--cases big,small,grid] [--extra "look=scavenged"]
// Cases: big = one tile at 1920x1080 (a big tile); small = one tile at 384x216 (the size of a tile in a 24-tile grid at 1080p);
//        grid = the real 24-tile grid at 1920x1080 (GTAO is not available there: the page leaves it out).
// Output per case: <setting>-<case>-ab.jpg (the compare page itself), -a.jpg, -b.jpg, -heat.jpg, -crops.jpg, and compare-metrics.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const take = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };
const out = take('--out', join(here, '..', '..', '..', '..', 'docs', 'evidence', 'br-dim.12'));
const only = take('--only', 'control,gtao,smaa,shadows').split(',');
const cases = take('--cases', 'big,small,grid').split(',');
const extra = take('--extra', '');
const CASES = { big: 'view=tv&size=1920x1080', small: 'view=tv&size=384x216', grid: 'view=grid&n=24&size=1920x1080', grid64: 'view=grid&n=64&size=1920x1080', phone64: 'view=grid&n=64&size=412x915', phone24: 'view=grid&n=24&size=412x915' }; // grid64, phone24/64: br-dim.11
const dpr = +take('--dpr', '1'); // Playwright deviceScaleFactor (emulated); the frames render at native pixels (R111)
const prefix = take('--prefix', ''); // file name prefix, to keep variants apart
mkdirSync(out, { recursive: true });
const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const all = [];
for (const setting of only) for (const c of cases) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${base}/poc/world/index.html${extra ? `?${extra}` : ''}#compare=${setting}&${CASES[c]}`);
  await page.waitForFunction(() => window.__compare?.ready || window.__compare?.error, null, { timeout: 240000 });
  if (errs.length || await page.evaluate(() => window.__compare.error)) { console.log(setting, c, 'FAILED', errs); await page.close(); continue; }
  const ex = await page.evaluate(() => window.__compare.export('image/jpeg', 0.93));
  const name = `${prefix}${setting}-${c}`;
  const save = (key, file) => writeFileSync(join(out, file), Buffer.from(ex[key].split(',')[1], 'base64'));
  save('a', `${name}-a.jpg`); save('b', `${name}-b.jpg`); save('heat', `${name}-heat.jpg`);
  const strip = await page.evaluate(async (e) => { // the three 4x crops side by side in one strip
    const imgs = await Promise.all([e.cropA, e.cropB, e.cropDiff].map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; })));
    const w = imgs.reduce((a, i) => a + i.width + 8, 0), h = Math.max(...imgs.map((i) => i.height));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = '#15203A'; g.fillRect(0, 0, w, h);
    let x = 0; for (const i of imgs) { g.drawImage(i, x, 0); x += i.width + 8; }
    return cv.toDataURL('image/jpeg', 0.93);
  }, ex);
  writeFileSync(join(out, `${name}-crops.jpg`), Buffer.from(strip.split(',')[1], 'base64'));
  await page.screenshot({ path: join(out, `${name}-ab.jpg`), type: 'jpeg', quality: 88, fullPage: true });
  all.push({ setting, case: c, dpr, ...ex.metrics });
  console.log(setting, c, `mean ${ex.metrics.meanAbsDiff} changed>${ex.metrics.thr} ${ex.metrics.pctChangedOverThr}% >32 ${ex.metrics.pctChangedOver32}% max ${ex.metrics.maxDiff} crop ${JSON.stringify(ex.metrics.crop)}`);
  await page.close();
}
writeFileSync(join(out, `${prefix}compare-metrics.json`), `${JSON.stringify({ when: new Date().toISOString(), note: 'meanAbsDiff is over scene pixels (tile interiors), mean of the three channel differences, 0-255; pctChanged* counts pixels whose largest channel differs by more than thr (or 32)', results: all }, null, 2)}\n`);
await browser.close(); await close();
