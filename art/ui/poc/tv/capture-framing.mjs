#!/usr/bin/env node
// P1-U05.2 evidence for the race-tile framing (R98) and the full-screen countdown (R99), in Chromium on this Mac's GPU:
//   - before (the round-0 rig, &cam=round0) and after (framing.json's default) at 1, 8, 24 and 32 tiles, with how much of
//     each tile the player's own car fills and where the horizon sits;
//   - the distance setting at near and far for 8 and 32 tiles, and per-player overrides on one grid;
//   - segmented first person (a mirror in the sky band);
//   - the countdown, frame by frame, full and reduced motion;
//   - frame cost, headed on the GPU, for the round-0 rig and the new framing at 24 and 32 tiles (with three first-person
//     tiles, so their mirrors count).
// Run: node art/ui/poc/tv/capture-framing.mjs [--no-perf]   Output: docs/evidence/P1-U05.2/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U05.2');
const FRAMING = JSON.parse(readFileSync(join(here, '..', 'shared', 'framing.json'), 'utf8'));
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const slug = (s) => s.replace(/&/g, '_').replace(/[^a-z0-9_=,:-]/gi, '').replace(/:/g, '-');
const { base, close } = await serveArtUi();
mkdirSync(join(out, 'captures'), { recursive: true });
mkdirSync(join(out, 'countdown'), { recursive: true });
const errors = [];
async function open(page, state) {
  await page.goto(`${base}/poc/tv/index.html#${state}`);
  await page.waitForFunction((h) => window.__poc?.ready === true && window.__poc.hash === h, `#${state}`, { timeout: 60000 });
  await page.waitForTimeout(600); // the chase cameras settle on their rig
}
const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);

const browser = await chromium.launch({ channel: 'chromium', args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const framing = [];
const STATES = [
  ...[1, 8, 24, 32].flatMap((n) => [`grid&n=${n}&cam=round0`, `grid&n=${n}`]),
  ...[8, 32].flatMap((n) => [`grid&n=${n}&dist=near`, `grid&n=${n}&dist=far`]),
  'grid&n=8&pdist=2:near,5:far,7:far',
  'grid&n=4&fp=2', 'grid&n=8&fp=2,5',
];
for (const state of STATES) {
  await open(page, state);
  const tiles = await page.evaluate(() => window.__poc.framing());
  await page.screenshot({ path: join(out, 'captures', `${slug(state)}.jpg`), type: 'jpeg', quality: 82 });
  const tp = tiles.filter((t) => t.kind === 'tp'), fp = tiles.filter((t) => t.kind === 'fp');
  // The car's screen box as a share of the tile's area: from a higher camera more of the roof shows, so height alone barely
  // moves while the width drops; the area is what reads as "smaller".
  framing.push({ state, tiles: tiles.length, tileHeightPx: tiles[0]?.h, carAreaOfTile: mean(tp.map((t) => t.carHeight * t.carWidth)), carHeightOfTile: mean(tp.map((t) => t.carHeight)), carWidthOfTile: mean(tp.map((t) => t.carWidth)), horizonFromTop: mean(tp.map((t) => t.horizonFromTop)), perTile: state.includes('pdist') || fp.length ? tiles : undefined });
}

// The countdown frame by frame: beat i held at ms, full and reduced motion.
const countdown = {};
for (const motion of ['no-preference', 'reduce']) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: motion });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  await p.goto(`${base}/poc/tv/index.html#countdown&n=8`);
  await p.waitForFunction(() => window.__poc?.ready === true, null, { timeout: 60000 });
  countdown[motion] = [];
  for (const [beat, ms] of [[0, 0], [0, 40], [0, 120], [0, 500], [0, 950], [2, 120], [3, 120], [3, 700]]) {
    await p.evaluate(([b, m]) => window.__poc.beatAt(b, m), [beat, ms]);
    const o = await p.evaluate(() => {
      const e = document.querySelector('.cd-flash');
      const f = getComputedStyle(e.querySelector('.flash')), n = getComputedStyle(e.querySelector('b'));
      return { overlays: document.querySelectorAll('.cd-flash').length, perTile: document.querySelectorAll('.tile .tile-count').length, flash: +(+f.opacity).toFixed(3), num: e.querySelector('b').textContent, numOpacity: +(+n.opacity).toFixed(3), transform: n.transform, paused: window.__poc.paused() };
    });
    const file = `countdown/${motion === 'reduce' ? 'reduced' : 'full'}-beat${beat}-${String(ms).padStart(4, '0')}ms.jpg`;
    await p.screenshot({ path: join(out, file), type: 'jpeg', quality: 80 });
    countdown[motion].push({ beat, ms, ...o, file });
  }
  await ctx.close();
}
await browser.close();

// Frame cost, headed on this Mac's GPU (never headless or SwiftShader for perf).
let perf = null;
if (!process.argv.includes('--no-perf')) {
  const hb = await chromium.launch({ channel: 'chromium', headless: false, args: GPU_ARGS });
  const pp = await hb.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  perf = [];
  for (const state of ['grid&n=24&cam=round0', 'grid&n=24', 'grid&n=24&fp=2,9,16', 'grid&n=32&cam=round0', 'grid&n=32', 'grid&n=32&fp=2,9,16']) {
    await open(pp, state);
    await pp.waitForTimeout(1500);
    const r = await pp.evaluate(() => window.__poc.perf(360));
    perf.push({ state, ...r });
    console.log(`${state}: frame p50 ${r.frame_ms_p50} ms, p95 ${r.frame_ms_p95} ms, render submit ${r.render_submit_ms_mean} ms, draws ${r.draws}`);
  }
  perf = { browser: `Chromium ${hb.version()} (Playwright, headed, channel chromium)`, viewport: '1920x1080 @1x', rows: perf };
  await hb.close();
}
await close();

const by = (s) => framing.find((f) => f.state === s);
const fails = [];
const need = (ok, what) => { if (!ok) fails.push(what); };
for (const n of [1, 8, 24, 32]) {
  const a = by(`grid&n=${n}&cam=round0`), b = by(`grid&n=${n}`);
  need(b.carAreaOfTile < a.carAreaOfTile * 0.65, `N=${n}: the car is not visibly smaller (${a.carAreaOfTile} → ${b.carAreaOfTile} of the tile's area)`);
  need(b.horizonFromTop < a.horizonFromTop, `N=${n}: the camera doesn't show more track (horizon ${a.horizonFromTop} → ${b.horizonFromTop})`);
}
for (const n of [8, 32]) need(by(`grid&n=${n}&dist=near`).carAreaOfTile > 1.5 * by(`grid&n=${n}&dist=far`).carAreaOfTile, `N=${n}: near and far frame the same`);
const full = countdown['no-preference'], red = countdown.reduce;
need(full.every((f) => f.overlays === 1 && f.perTile === 0), 'the countdown is one overlay, not per tile');
need(full.find((f) => f.beat === 0 && f.ms === 40).flash > 0.5 && full.find((f) => f.beat === 0 && f.ms === 950).flash < 0.1, 'the full countdown flash attacks and decays');
need(red.filter((f) => f.ms < 950).every((f) => f.flash === red[0].flash) && new Set(red.map((f) => f.transform)).size === 1, 'reduced: the wash holds and nothing scales');
need(full.find((f) => f.beat === 0).paused && !full.find((f) => f.beat === 3).paused, 'cars hold until GO');
need(errors.length === 0, `page errors: ${errors.join('; ')}`);
const report = { format: 'jj.u052-report.v1', framingData: 'art/ui/poc/shared/framing.json', framing, distances: FRAMING.chase, round0: FRAMING.round0, firstPerson: FRAMING.firstPerson, countdown, perf, pass: fails.length === 0, fails, errors };
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const f of framing.filter((x) => !x.perTile)) console.log(`${f.state}: car box ${(f.carAreaOfTile * 100).toFixed(1)}% of the tile, horizon at ${f.horizonFromTop}`);
console.log(fails.length ? `FAILED:\n  ${fails.join('\n  ')}` : 'all checks pass');
process.exit(fails.length ? 1 : 0);
