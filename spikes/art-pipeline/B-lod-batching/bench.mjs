// node spikes/art-pipeline/B-lod-batching/bench.mjs   (serves repo root separately, see run_bench.sh)
import { chromium } from 'playwright';

const PORT = process.env.BENCH_PORT || 8321;
const BASE = `http://localhost:${PORT}/spikes/art-pipeline/B-lod-batching/bench.html`;
const W = 3840, H = 2160, FRAMES = 120;

const strategies = ['separate', 'merged', 'batched'];
const ns = [4, 12, 24];

const runs = [];
for (const n of ns) for (const strategy of strategies) runs.push({ strategy, n, lod: 'auto', mode: 'grid' });
// supplemental: isolate the LOD contribution from the batching contribution at N=24 (Grid mode)
runs.push({ strategy: 'separate', n: 24, lod: 0, mode: 'grid', tag: 'lod0-forced' });
runs.push({ strategy: 'batched', n: 24, lod: 0, mode: 'grid', tag: 'lod0-forced' });
runs.push({ strategy: 'batched', n: 24, lod: 2, mode: 'grid', tag: 'lod2-forced' });
// Overview mode (plan §6.4, one shared camera): this is where BatchedMesh's flat-draw-call claim
// should actually hold, since Grid mode's N-camera-passes cost is paid regardless of strategy.
for (const n of [24, 48, 96]) for (const strategy of strategies) runs.push({ strategy, n, lod: 1, mode: 'overview' });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
for (const r of runs) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const url = `${BASE}?strategy=${r.strategy}&n=${r.n}&lod=${r.lod}&w=${W}&h=${H}&frames=${FRAMES}&mode=${r.mode || 'grid'}`;
  const t0 = Date.now();
  try {
    await page.goto(url, { timeout: 60000 });
    await page.waitForFunction(() => document.title === 'READY', null, { timeout: 120000 });
    const rep = await page.evaluate(() => window.__report);
    const wallMs = Date.now() - t0;
    results.push({ ...r, ...rep, wallMs, errors: errs });
    console.log(JSON.stringify({ ...r, ...rep, wallMs }));
    if (r.n === 24 || r.mode === 'overview') {
      await page.screenshot({ path: `spikes/art-pipeline/B-lod-batching/out/bench_${r.mode || 'grid'}_${r.strategy}_n${r.n}_${r.tag || r.lod}.png` });
    }
  } catch (e) {
    results.push({ ...r, error: String(e), errors: errs });
    console.log(JSON.stringify({ ...r, error: String(e), errors: errs }));
  }
  await page.close();
}
await browser.close();

import { writeFileSync } from 'fs';
writeFileSync('spikes/art-pipeline/B-lod-batching/out/bench_results.json', JSON.stringify(results, null, 2));
console.log('DONE, wrote out/bench_results.json');
