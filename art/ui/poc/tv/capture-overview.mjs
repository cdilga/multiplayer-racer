#!/usr/bin/env node
// P1-U05.4 evidence for the Derby Overview camera (R107) and the arena designed for it, in Chromium on this Mac's GPU:
//   - the camera path's acceleration and jerk, round 0's per-frame refit against the new rig, on the SAME recorded derby
//     at 8 and 24 cars, and the predictive test (cars' actual positions 1.5 s later already inside the frame);
//   - side-by-side videos of the two rigs (TV mock, 24 cars) and the in-world mock's Overview with the new rig;
//   - captures, and the dressing zones for P1-M10 (art/ui/poc/world/overview-zones.json).
// Run: node art/ui/poc/tv/capture-overview.mjs   Output: docs/evidence/P1-U05.4/
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U05.4');
const zonesFile = join(here, '..', 'world', 'overview-zones.json');
const ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
mkdirSync(join(out, 'captures'), { recursive: true });
const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium', args: ARGS });
const errors = [];
const watch = (p) => p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));

// 1. Traces and captures, TV mock.
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
watch(page);
const traces = {};
for (const n of [8, 24]) {
  for (const cam of ['round0', 'framing']) {
    const state = `overview&n=${n}${cam === 'round0' ? '&cam=round0' : ''}`;
    await page.goto(`${base}/poc/tv/index.html#${state}`);
    await page.waitForFunction((h) => window.__poc?.ready === true && window.__poc.hash === h, `#${state}`, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, 'captures', `tv-${state.replace(/&/g, '_')}.jpg`), type: 'jpeg', quality: 80 });
  }
  await page.goto(`${base}/poc/tv/index.html#overview&n=${n}`);
  await page.waitForFunction((h) => window.__poc?.ready === true && window.__poc.hash === h, `#overview&n=${n}`, { timeout: 60000 });
  traces[n] = await page.evaluate(() => window.__poc.overviewTrace({ seconds: 30 }));
}
await page.close();

// 2. Videos: round 0 and the new rig on the TV mock at 24 cars, then the in-world mock.
async function record(url, file, ms, wait) {
  rmSync(join(out, 'video-tmp'), { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: join(out, 'video-tmp'), size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  watch(p);
  await p.goto(url);
  await p.waitForFunction(wait, null, { timeout: 60000 });
  await p.waitForTimeout(ms);
  const path = await p.video().path();
  await ctx.close();
  renameSync(path, join(out, file));
}
await record(`${base}/poc/tv/index.html#overview&n=24&cam=round0`, 'tv-overview-24-round0.webm', 12000, () => window.__poc?.ready === true);
await record(`${base}/poc/tv/index.html#overview&n=24`, 'tv-overview-24-new.webm', 12000, () => window.__poc?.ready === true);
await record(`${base}/poc/world/index.html#overview&n=16`, 'world-overview-16-new.webm', 12000, () => window.__world?.ready === true);
rmSync(join(out, 'video-tmp'), { recursive: true, force: true });

// 3. The in-world mock: captures and the dressing zones.
const wp = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
watch(wp);
let zones = null;
for (const [n, cam] of [[8, ''], [24, ''], [24, '&cam=round0']]) {
  await wp.goto(`${base}/poc/world/index.html#overview&n=${n}${cam}`);
  await wp.waitForFunction(() => window.__world?.ready === true, null, { timeout: 60000 });
  await wp.waitForTimeout(2000);
  await wp.screenshot({ path: join(out, 'captures', `world-overview_n=${n}${cam.replace(/&/g, '_')}.jpg`), type: 'jpeg', quality: 80 });
  zones ??= await wp.evaluate(() => window.__world.overviewZones());
}
await wp.close();
await browser.close();
await close();
writeFileSync(zonesFile, `${JSON.stringify(zones, null, 2)}\n`);

const fails = [];
for (const n of [8, 24]) {
  const a = traces[n].round0, b = traces[n].framing;
  if (!(b.jerk.rms < a.jerk.rms / 20 && b.accel.rms < a.accel.rms / 5)) fails.push(`${n} cars: not smoother (jerk ${a.jerk.rms} → ${b.jerk.rms}, accel ${a.accel.rms} → ${b.accel.rms})`);
  if (!(b.futureInsideShare >= a.futureInsideShare && b.outsideFrame === 0)) fails.push(`${n} cars: not predictive (future inside ${a.futureInsideShare} → ${b.futureInsideShare}, outside ${b.outsideFrame})`);
}
const always = zones.dressing.filter((d) => d.zone === 'always').map((d) => d.kind);
if (!always.some((k) => k.startsWith('olgas')) || !always.some((k) => k.startsWith('quarry'))) fails.push('the Olgas domes and quarry faces are not always in view');
if (errors.length) fails.push(...errors);
const report = { format: 'jj.u054-report.v1', framing: 'art/ui/poc/shared/framing.json (overview)', traces, zones: 'art/ui/poc/world/overview-zones.json', dressing: zones.dressing, pass: fails.length === 0, fails };
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const n of [8, 24]) for (const k of ['round0', 'framing']) { const t = traces[n][k]; console.log(`${n} cars ${k}: accel rms ${t.accel.rms} p95 ${t.accel.p95} max ${t.accel.max}; jerk rms ${t.jerk.rms} p95 ${t.jerk.p95} max ${t.jerk.max}; future inside ${t.futureInsideShare}; outside ${t.outsideFrame}; near edge ${t.nearEdge}`); }
console.log(`dressing always in view: ${always.join(', ')}`);
console.log(fails.length ? `FAILED:\n  ${fails.join('\n  ')}` : 'all checks pass');
process.exit(fails.length ? 1 : 0);
