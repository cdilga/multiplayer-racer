/**
 * Visual smoke for viewport tiling (woq.8). Screenshots the REAL ViewportTiling
 * module output (rendered to a canvas by tiling-preview.html) at 1080p and 4K for
 * all-cars, cluster director, and Wife's Grid at 8/16/32 players. Proves the
 * tiling geometry + HUD-safe name/own-car markers stay inside viewport boundaries
 * WITHOUT touching the contested RenderSystem/GameHost.
 *
 * Run from the repo root:
 *   python3 -m http.server 8012 &      # serves repo root so ESM imports resolve
 *   node artifacts/br-captain-call-architecture-hardening-woq.8/capture-tiling.mjs
 *   # then stop the server
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.BASE_URL || 'http://localhost:8012';
const previewPath = 'artifacts/br-captain-call-architecture-hardening-woq.8/tiling-preview.html';

const RES = [
  { tag: '1080p', w: 1920, h: 1080 },
  { tag: '4k', w: 3840, h: 2160 },
];
const SCENARIOS = [
  { mode: 'allcars', players: 1, name: 'all-cars' },
  { mode: 'cluster', players: 6, name: 'cluster-director' },
  { mode: 'grid', players: 8, name: 'wifes-grid-8' },
  { mode: 'grid', players: 16, name: 'wifes-grid-16' },
  { mode: 'grid', players: 32, name: 'wifes-grid-32' },
];

const results = [];
const browser = await chromium.launch();

for (const res of RES) {
  for (const sc of SCENARIOS) {
    const ctx = await browser.newContext({
      viewport: { width: Math.min(res.w, 1920), height: Math.min(res.h, 1080) },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const url = `${base}/${previewPath}?w=${res.w}&h=${res.h}&mode=${sc.mode}&players=${sc.players}`;
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__tilingReady === true, { timeout: 15000 });
      const info = await page.evaluate(() => window.__tilingInfo);
      const name = `${sc.name}-${res.tag}.png`;
      // Screenshot the canvas element at its true pixel size (1080p / 4K).
      await page.locator('#stage').screenshot({ path: resolve(here, name) });
      results.push({ file: name, ...info, pageErrors: errors.slice() });
    } catch (e) {
      results.push({ file: `${sc.name}-${res.tag}.png`, ok: false, error: String(e), pageErrors: errors.slice() });
    }
    await ctx.close();
  }
}

await browser.close();

console.log('\n=== tiling visual capture ===');
for (const r of results) {
  const f = resolve(here, r.file);
  const bytes = existsSync(f) ? statSync(f).size : 0;
  console.log(JSON.stringify({ ...r, bytes }));
}
const allOk = results.every((r) => r.error === undefined && existsSync(resolve(here, r.file)) && statSync(resolve(here, r.file)).size > 0);
console.log('ALL_OK', allOk);
process.exit(allOk ? 0 : 1);
