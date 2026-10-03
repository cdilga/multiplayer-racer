#!/usr/bin/env node
// P1-U05 in-world look: captures and the frame-cost table.
//   node art/ui/poc/world/capture.mjs          every look state at 1080p and 4K (WebGPU), the cheaper tiers at 1080p
//   node art/ui/poc/world/capture.mjs --perf   24 live tiles, HEADED on this Mac's GPU, at 1080p and 4K, for the full look,
//                                               outlines on objects only ('ids') and no post ('plain'): frame cost table
// Output: docs/evidence/P1-U05/world/ (captures/*.jpg, capture-report.json, perf.json)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U05', 'world');
mkdirSync(join(out, 'captures'), { recursive: true });
const PERF = process.argv.includes('--perf');
const ARGS = ['--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const machine = (() => {
  try { return `${execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string']).toString().trim()} (${execFileSync('sysctl', ['-n', 'hw.model']).toString().trim()}), macOS ${execFileSync('sw_vers', ['-productVersion']).toString().trim()}`; } catch { return 'unknown'; }
})();
const { base, close } = await serveArtUi();
const open = async (page, state, mode, ts = false) => {
  await page.goto('about:blank');
  const params = mode === 'full+bloom+fxaa' ? { bloom: '1', fxaa: '1' } : mode ? { mode } : {};
  await page.goto(`${base}/poc/world/index.html?${new URLSearchParams({ ...params, ...(ts ? { ts: '1' } : {}) })}#${state}`);
  await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 90000 });
  await page.waitForTimeout(400);
};

if (PERF) {
  const browser = await chromium.launch({ channel: 'chromium', headless: false, args: ARGS });
  const rows = [];
  for (const [res, w, h] of [['1080p', 1920, 1080], ['4k', 3840, 2160]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    for (const mode of ['full', 'full+bloom+fxaa', 'ids', 'plain']) {
      await open(page, 'grid&n=24', mode, true);
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => window.__world.perf(240, 120));
      rows.push({ res, variant: mode, ...r });
      console.log(`${res} ${mode}: rAF p50 ${r.frame_ms_p50} p95 ${r.frame_ms_p95} ms; GPU p50 ${r.gpu_ms_p50} p95 ${r.gpu_ms_p95} ms (${r.gpu_samples} samples); CPU submit ${r.cpu_submit_ms_mean} ms; tiles ${r.tiles} (min ${r.minTileH} px)`);
    }
    await page.close();
  }
  const adapter = await (async () => { const p = await browser.newPage(); await p.goto(`${base}/poc/world/index.html#tv`); const a = await p.evaluate(async () => { const ad = await navigator.gpu?.requestAdapter(); return ad ? `${ad.info?.vendor ?? ''} ${ad.info?.architecture ?? ''} ${ad.info?.description ?? ''}`.trim() : 'no WebGPU'; }); await p.close(); return a; })();
  writeFileSync(join(out, 'perf.json'), `${JSON.stringify({
    what: 'In-world comic look frame cost at 24 live tiles (P1-U05 AC1): one ArrayCamera scene pass into the MRT targets, the comic post chain once over the screen',
    machine, browser: `Chromium ${browser.version()} (Playwright 1.62.1, headed, channel chromium)`, backend: `WebGPU (${adapter})`,
    method: 'rAF interval over 240 frames (vsync-bound, 120 Hz display) and GPU execution per frame from WebGPU timestamp queries (renderer trackTimestamp + resolveTimestampsAsync: every render pass of the frame, i.e. the 24-tile scene pass and the post chain), 120 frames',
    modes: { full: 'the presented grid look: toon + ink outlines (depth, normal, id) + halftone (tier M+) + grade; no bloom and no FXAA at 24 tiles', 'full+bloom+fxaa': 'the skill default for big tiles: as full plus selective bloom and FXAA at every resolution', ids: 'outlines on objects only (no depth/normal taps), the GUIDE fallback tier', plain: 'comic materials, no post' },
    rows,
  }, null, 2)}\n`);
  await browser.close();
  await close();
  process.exit(0);
}

const browser = await chromium.launch({ channel: 'chromium', args: ARGS });
const states = process.env.JJ_STATES?.split(',') ?? ['grid&n=24', 'tv', 'graphics', 'paint', 'overview&n=16'];
const report = { base, machine, captures: [], errors: [], external: [] };
for (const [res, w, h] of [['1080p', 1920, 1080], ['4k', 3840, 2160]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => report.errors.push(`${res} ${e.message}`));
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && r.url() !== 'about:blank') report.external.push(r.url()); });
  const jobs = states.map((s) => [s, null]).concat(res === '1080p' && !process.env.JJ_STATES ? [['grid&n=24', 'ids'], ['grid&n=24', 'plain'], ['tv', 'plain']] : []);
  for (const [s, mode] of jobs) {
    await open(page, s, mode);
    const file = `${res}-${s.replace(/&/g, '_')}${mode ? `-${mode}` : ''}.jpg`;
    await page.screenshot({ path: join(out, 'captures', file), type: 'jpeg', quality: 86 });
    report.captures.push({ file, backend: await page.evaluate(() => window.__world.backend) });
  }
  await page.close();
}
await browser.close();
await close();
writeFileSync(join(out, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`captures ${report.captures.length} (${[...new Set(report.captures.map((c) => c.backend))].join(', ')}); errors ${report.errors.length}; external requests ${report.external.length}`);
process.exit(report.errors.length || report.external.length ? 1 : 0);
