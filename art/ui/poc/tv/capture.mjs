#!/usr/bin/env node
// P1-U02 capture and measurement script for the TV mocks.
//   node art/ui/poc/tv/capture.mjs                 every state at 1080p and 4K, plus the grid states at 21:9 and on a
//                                                   portrait phone host; request audit (AC1), seat-order check, HUD cap
//                                                   height at the smallest tile (AC4) and a grid-player video
//   node art/ui/poc/tv/capture.mjs --perf          HUD-layer frame cost at 24 and 32 live tiles, HEADED on this
//                                                   machine's GPU (AC5; never headless or SwiftShader)
//   --only <substring>                              restrict to matching states
// Output: docs/evidence/P1-U02/ (captures/<res>/*.jpg, requests.json, cap-height.json, perf.json, grid-player.webm)
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';
import { STATES } from './states.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U02');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const PERF = args.includes('--perf');
const all = Object.values(STATES).flat().filter((s) => !only || s.includes(only));
const gridLike = (s) => /^(grid|hud)/.test(s);
const RES = [
  { id: '1080p', width: 1920, height: 1080, states: all },
  { id: '4k', width: 3840, height: 2160, states: all },
  { id: '21x9', width: 2560, height: 1080, states: all.filter(gridLike) },
  { id: 'phone-portrait', width: 430, height: 932, scale: 3, states: all.filter(gridLike) },
];
const slug = (s) => s.replace(/&/g, '_').replace(/[^a-z0-9_=,-]/gi, '');
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];

const { base, close } = await serveArtUi();
mkdirSync(out, { recursive: true });
const machine = (() => {
  try {
    const model = execFileSync('sysctl', ['-n', 'hw.model']).toString().trim();
    const cpu = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string']).toString().trim();
    const os = execFileSync('sw_vers', ['-productVersion']).toString().trim();
    return `${cpu} (${model}), macOS ${os}`;
  } catch { return 'unknown'; }
})();

async function openState(page, state) {
  await page.goto(`${base}/poc/tv/index.html#${state}`);
  await page.waitForFunction(() => window.__poc?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(250);
}

if (PERF) {
  // Headed, on this machine's GPU. Tiles are live; HUD on vs hud=0 isolates the HUD layer's cost.
  const browser = await chromium.launch({ channel: 'chromium', headless: false, args: GPU_ARGS });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const rows = [];
  for (const n of [24, 32]) {
    for (const hud of [true, false]) {
      await openState(page, `grid&n=${n}${hud ? '' : '&hud=0'}`);
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => window.__poc.perf(360));
      rows.push({ n, hud, ...r });
      console.log(`n=${n} hud=${hud} frame p50 ${r.frame_ms_p50} ms p95 ${r.frame_ms_p95} ms, hud update ${r.hud_ms_mean} ms (p95 ${r.hud_ms_p95}), render submit ${r.render_submit_ms_mean} ms, draws ${r.draws}`);
    }
  }
  const report = {
    what: 'HUD-layer frame cost over live tiles (P1-U02 AC5): the same grid with the DOM HUD on and off (hud=0)',
    machine, browser: `Chromium ${browser.version()} (Playwright, headed, channel chromium)`, backend: rows[0]?.backend,
    viewport: '1920x1080 @1x', method: '360 rAF frames after 1.5 s settle; hud_ms = JS time updating the HUD layer per frame; frame_ms = rAF interval (includes style, layout and composite)',
    note: 'Measured on the Mac that drives the TCL (honest label: Chromium headed on the M1 Pro GPU, not Safari, not the TV).',
    rows,
  };
  writeFileSync(join(out, 'perf.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  await close();
  process.exit(0);
}

const browser = await chromium.launch({ channel: 'chromium', args: GPU_ARGS });
const external = [], failed = [];
let count = 0;
for (const res of RES) {
  const ctx = await browser.newContext({ viewport: { width: res.width, height: res.height }, deviceScaleFactor: res.scale ?? 1 });
  const page = await ctx.newPage();
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => failed.push(`pageerror ${e.message}`));
  mkdirSync(join(out, 'captures', res.id), { recursive: true });
  for (const state of res.states) {
    await openState(page, state);
    await page.screenshot({ path: join(out, 'captures', res.id, `${slug(state)}.jpg`), type: 'jpeg', quality: 82 });
    count++;
  }
  console.log(`${res.id}: ${res.states.length} states`);
  await ctx.close();
}

// Seat order and the gap cases: tiles read in seat order; every gap case leaves no black (fillers or the join chip).
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const order = [];
for (const at of [5, 13, 24, 32]) {
  await openState(page, `grid-player&at=${at}`);
  const seats = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((t) => ({ seat: +t.dataset.seat, x: t.offsetLeft, y: t.offsetTop })).sort((a, b) => a.y - b.y || a.x - b.x).map((t) => t.seat));
  order.push({ at, seats, inOrder: seats.every((s, i) => i === 0 || s > seats[i - 1]) });
}
const gaps = [];
for (const n of [2, 3, 5, 7, 10, 13]) {
  await openState(page, `grid&n=${n}`);
  gaps.push(await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.tile')].map((t) => t.getBoundingClientRect());
    const fillers = [...document.querySelectorAll('.filler')].map((f) => ({ w: Math.round(f.getBoundingClientRect().width), h: Math.round(f.getBoundingClientRect().height), has: f.querySelector('.join') ? 'join QR' : f.querySelector('.standings') ? 'standings' : 'backdrop' }));
    return { n: tiles.length, tile: `${Math.round(tiles[0].width)}x${Math.round(tiles[0].height)}`, lastRowTile: `${Math.round(tiles.at(-1).width)}x${Math.round(tiles.at(-1).height)}`, fillers, joinChip: !!document.querySelector('.joinchip') };
  }));
}

// HUD cap height at the smallest tile: 32 tiles at 1080p (AC4).
await openState(page, 'hud&n=32&base=100');
const cap = await page.evaluate(() => {
  const t = window.__poc.tokens, ratio = t.type.capHeightRatio, k = window.innerHeight / 1080, min = t.type.profiles.tv.minCapHeightPx * k;
  const cv = document.createElement('canvas').getContext('2d');
  const items = [];
  for (const sel of ['.hud-badge', '.hud-name', '.hud-pos', '.hud-lap', '.chip', '.wreck-back', '.burst']) {
    for (const e of document.querySelectorAll(`.tile ${sel}`)) {
      const cs = getComputedStyle(e), size = parseFloat(cs.fontSize);
      cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const glyph = cv.measureText('H').actualBoundingBoxAscent;
      items.push({ sel, fontPx: +size.toFixed(2), capPx: +(size * ratio).toFixed(2), glyphCapPx: +glyph.toFixed(2) });
    }
  }
  const smallest = items.reduce((a, b) => (b.capPx < a.capPx ? b : a));
  const tile = [...document.querySelectorAll('.tile')].map((e) => e.getBoundingClientRect()).reduce((a, b) => (b.width * b.height < a.width * a.height ? b : a));
  return { viewport: `${innerWidth}x${innerHeight}`, tiles: document.querySelectorAll('.tile').length, smallestTile: `${Math.round(tile.width)}x${Math.round(tile.height)}`, minCapHeightPx: min, smallest, pass: smallest.capPx >= min - 1e-6 && smallest.glyphCapPx >= min - 0.5, elements: items.length };
});
await page.close();

// The grid player as a video: 1 → 32 → 1 with the reflow (seat order kept).
const vctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: join(out, 'video-tmp'), size: { width: 1280, height: 720 } } });
const vpage = await vctx.newPage();
await vpage.goto(`${base}/poc/tv/index.html#grid-player`);
await vpage.waitForFunction(() => window.__poc?.ready === true, null, { timeout: 30000 });
await vpage.waitForTimeout(46000);
const vpath = await vpage.video().path();
await vctx.close();
renameSync(vpath, join(out, 'grid-player.webm'));

await browser.close();
await close();
const report = { base, machine, captures: count, external, failed, seatOrder: order, gapCases: gaps, capHeight: cap };
writeFileSync(join(out, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
const ok = external.length === 0 && failed.length === 0 && order.every((o) => o.inOrder) && cap.pass;
console.log(`captures: ${count}; external requests: ${external.length}; failed: ${failed.length}; seat order: ${order.map((o) => `${o.at}:${o.inOrder ? 'ok' : 'BAD'}`).join(' ')}; cap height at 32 tiles: smallest ${cap.smallest.capPx}px (${cap.smallest.sel}) vs min ${cap.minCapHeightPx}px → ${cap.pass ? 'ok' : 'FAIL'}`);
for (const g of gaps) console.log(`gap n=${g.n}: tiles ${g.tile} (last row ${g.lastRowTile}); fillers ${g.fillers.map((f) => `${f.w}x${f.h} ${f.has}`).join(', ') || 'none'}${g.joinChip ? '; join chip' : ''}`);
process.exit(ok ? 0 : 1);
