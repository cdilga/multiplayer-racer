#!/usr/bin/env node
// host-cost.mjs (br-bwju.12): what one roster car costs the real host. The host page's synthetic mixed grid (24 cars, the
// roster's vehicles in turn), 1920x1080, at 1, 4 and 24 tiles: triangles and draw calls per frame, frame time and p95, and
// the triangles of the named car's scene groups (`__jjRender.sceneTriangles()`). Run where the GPU is (eris), on a web build:
//   JJ_CHROMIUM_GPU=1 node tools/vehicles/evidence/host-cost.mjs <vehicle id> --label <before|after> [--out <file.json>]
// (JJ_DIST picks the build, as chase.mjs.) Prints one JSON row per tile count; with --out, appends them to that file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { chromiumArgs } from '../../../web/tests/journeys/lib/chromium.mjs';
import { openHost, serve } from '../../../web/host/tests/lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const id = args[0], label = opt('--label', 'now'), out = opt('--out', null);
if (!id) { console.error('usage: host-cost.mjs <vehicle id> --label <name> [--out <file.json>]'); process.exit(2); }
const server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
const browser = await chromium.launch(process.env.JJ_CHROMIUM_GPU === '1' ? { headless: true, args: chromiumArgs } : {});
const rows = [];
try {
  for (const tiles of [1, 4, 24]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await openHost(page, `${server.url}/host/?synthetic=24&vehicles=mixed&freeze=240&tiles=${tiles}&res=1&autores=off`);
    await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) > 60, null, { timeout: 90_000 });
    await new Promise((r) => setTimeout(r, 1500));
    // 40 samples a frame apart: mean frame time, worst p95, and the per-frame counts (constant for a frozen grid)
    const samples = await page.evaluate(async () => {
      const s = [];
      for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); s.push(window.__jjRender.stats()); }
      return s;
    });
    const groups = await page.evaluate((car) => (window.__jjRender.sceneTriangles() ?? []).filter((g) => String(g.name).includes(car)), id);
    const last = samples.at(-1), mean = (k) => +(samples.reduce((t, x) => t + (x[k] ?? 0), 0) / samples.length).toFixed(2);
    rows.push({ which: label, car: id, tiles, cars: last.cars, drawCalls: last.drawCalls, triangles: last.triangles, frameMs: mean('frameMs'), p95Ms: Math.max(...samples.map((x) => x.p95Ms ?? 0)), budgetMs: last.budgetMs, backend: last.backend, carGroups: groups });
    console.log(JSON.stringify({ which: label, tiles, drawCalls: last.drawCalls, triangles: last.triangles, frameMs: mean('frameMs'), carTriangles: groups.reduce((t, g) => t + g.triangles * (g.layers ?? 1), 0) }));
    await page.close();
  }
} finally { await browser.close(); server.close(); }
if (out) writeFileSync(out, `${JSON.stringify([...(existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []), ...rows], null, 1)}\n`);
