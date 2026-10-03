#!/usr/bin/env node
// P1-U02.2 evidence for the reworked grid, HUD and Identify, in Chromium on this machine's GPU:
//   - the rendered page for N = 1..40, 64 and 99 at 1080p: every tile element and every 3D viewport the same size, every
//     sampled point a tile, a filler or a gutter line (never black), and what each filler shows;
//   - captures of N = 5, 10, 25, 26, 27, 32 and the 32-tile HUD at 1080p, 21:9 and 5:4;
//   - the HUD pills at 32 tiles: one line high (height vs font size) and their share of the tile;
//   - the Cooee flash frame by frame (full and reduced motion) and as video;
//   - name plates: none on the per-player grid, present on the Overview.
// Run: node art/ui/poc/tv/capture-grid.mjs   Output: docs/evidence/P1-U02.2/
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U02.2');
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const { base, close } = await serveArtUi();
mkdirSync(join(out, 'captures'), { recursive: true });
mkdirSync(join(out, 'identify'), { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: GPU_ARGS });
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
};
async function open(page, state) {
  await page.goto(`${base}/poc/tv/index.html#${state}`);
  await page.waitForFunction((h) => window.__poc?.ready === true && window.__poc.hash === h, `#${state}`, { timeout: 60000 });
  await page.waitForTimeout(200);
}
const slug = (s) => s.replace(/&/g, '_').replace(/[^a-z0-9_=,-]/gi, '');

// 1. The rendered grid for every N at 1080p.
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
watch(page);
const grid = [];
for (const n of [...Array.from({ length: 40 }, (_, i) => i + 1), 64, 99]) {
  await open(page, `grid&n=${n}`);
  grid.push(await page.evaluate((n) => {
    const k = innerHeight / 1080, hg = Math.round(3 * k);
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const tiles = [...document.querySelectorAll('.tile')].map(box);
    const fillers = [...document.querySelectorAll('.filler')].map((e) => ({ ...box(e), kind: e.classList.contains('cell') ? 'cell' : 'margin', role: e.dataset.role }));
    const views = window.__poc.views();
    const area = (r) => r.w * r.h;
    const ratio = (list) => Math.max(...list.map(area)) / Math.min(...list.map(area));
    // Every sampled point is a filler, or a tile or empty cell including its own half-gutter (the ink gutter line).
    const inside = (r, x, y, e = 0) => x >= r.x - e && x < r.x + r.w + e && y >= r.y - e && y < r.y + r.h + e;
    let samples = 0, black = 0;
    for (let y = 1.5; y < innerHeight; y += 6) for (let x = 1.5; x < innerWidth; x += 6) {
      samples++;
      if (fillers.some((f) => inside(f, x, y, f.kind === 'cell' ? hg : 0)) || tiles.some((t) => inside(t, x, y, hg))) continue;
      black++;
    }
    const roles = {};
    for (const f of fillers) if (f.kind === 'cell' || f.role !== 'backdrop') roles[`${f.kind}:${f.role}`] = (roles[`${f.kind}:${f.role}`] ?? 0) + 1;
    return {
      n, tiles: tiles.length, tile: `${tiles[0].w}x${tiles[0].h}`, tileAreaRatio: ratio(tiles), viewport: `${views[0].w}x${views[0].h}`, viewportAreaRatio: ratio(views),
      emptyCells: fillers.filter((f) => f.kind === 'cell').length, cellsMatchTiles: fillers.filter((f) => f.kind === 'cell').every((c) => c.w === tiles[0].w && c.h === tiles[0].h),
      fillerRoles: roles, joinChip: !!document.querySelector('.joinchip'), samples, uncovered: black,
    };
  }, n));
}
const gridOk = grid.every((g) => g.tiles === g.n && g.tileAreaRatio === 1 && g.viewportAreaRatio === 1 && g.cellsMatchTiles && g.uncovered === 0);

// 2. Captures at 1080p, 21:9 and 5:4.
const SHOTS = ['grid&n=3', 'grid&n=5', 'grid&n=10', 'grid&n=25', 'grid&n=26', 'grid&n=27', 'grid&n=32', 'hud&n=32&base=100', 'hud&n=8'];
for (const res of [{ id: '1080p', width: 1920, height: 1080 }, { id: '21x9', width: 2560, height: 1080 }, { id: '5x4', width: 1280, height: 1024 }]) {
  const ctx = await browser.newContext({ viewport: { width: res.width, height: res.height } });
  const p = await ctx.newPage();
  watch(p);
  mkdirSync(join(out, 'captures', res.id), { recursive: true });
  for (const s of SHOTS) {
    await open(p, s);
    await p.evaluate(() => window.__poc.identifyAt(150)); // hold the HUD state's Identify mid-flash
    await p.screenshot({ path: join(out, 'captures', res.id, `${slug(s)}.jpg`), type: 'jpeg', quality: 82 });
  }
  await ctx.close();
}

// 3. HUD pills at 32 tiles, 1080p: one line high, and their share of the tile.
await open(page, 'hud&n=32&base=100');
const hud = await page.evaluate(() => {
  const k = innerHeight / 1080;
  const tile = document.querySelector('.tile').getBoundingClientRect();
  const pills = [];
  for (const sel of ['.hud-badge', '.hud-name', '.hud-tr', '.tile .chip', '.wreck-back']) {
    for (const e of document.querySelectorAll(sel)) {
      if (!e.offsetParent) continue;
      const fs = parseFloat(getComputedStyle(e).fontSize), h = e.getBoundingClientRect().height;
      pills.push({ sel, fontPx: +fs.toFixed(2), heightPx: +h.toFixed(2), lines: h <= fs * 1.6 + 6 * k + 1 ? 1 : 2 });
    }
  }
  const tallest = pills.reduce((a, b) => (b.heightPx > a.heightPx ? b : a));
  return { viewport: `${innerWidth}x${innerHeight}`, tile: `${Math.round(tile.width)}x${Math.round(tile.height)}`, hudTextPx: pills.find((p) => p.sel === '.hud-tr').fontPx, pillHeightPx: tallest.heightPx, pillShareOfTile: +(tallest.heightPx / tile.height).toFixed(3), allOneLine: pills.every((p) => p.lines === 1), pills: pills.length, twoLine: pills.filter((p) => p.lines > 1) };
});
// The same HUD at 8 tiles (scales up with the tile) for comparison.
await open(page, 'hud&n=8');
const hud8 = await page.evaluate(() => ({ tile: `${Math.round(document.querySelector('.tile').getBoundingClientRect().width)}x${Math.round(document.querySelector('.tile').getBoundingClientRect().height)}`, hudTextPx: parseFloat(getComputedStyle(document.querySelector('.hud-tr')).fontSize) }));

// 4. Name plates: none on the per-player grid (R100), still on the Overview.
await open(page, 'overlays&n=8');
await page.waitForTimeout(500);
const platesGrid = await page.evaluate(() => [...document.querySelectorAll('.plate')].filter((e) => e.style.display !== 'none').length);
await open(page, 'overview&n=8');
await page.waitForTimeout(500);
const platesOverview = await page.evaluate(() => document.querySelectorAll('.plate').length);
await page.close();

// 5. The Cooee flash, frame by frame on the identified tile, full and reduced motion; then a video.
const frames = {};
for (const motion of ['no-preference', 'reduce']) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: motion });
  const p = await ctx.newPage();
  watch(p);
  await open(p, 'identify&n=8&seat=3');
  const clip = await p.evaluate(() => { const r = document.querySelector('.tile[data-seat="3"]').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  frames[motion] = [];
  for (const ms of [0, 60, 120, 250, 500, 900, 1300, 1500]) {
    await p.evaluate((ms) => window.__poc.identifyAt(ms), ms);
    const o = await p.evaluate(() => ({ flash: +getComputedStyle(document.querySelector('.cooee .flash')).opacity, label: +getComputedStyle(document.querySelector('.cooee b')).opacity, text: document.querySelector('.cooee b').textContent, transform: getComputedStyle(document.querySelector('.cooee b')).transform }));
    const file = `identify/${motion === 'reduce' ? 'reduced' : 'full'}-${String(ms).padStart(4, '0')}ms.jpg`;
    await p.screenshot({ path: join(out, file), clip, type: 'jpeg', quality: 82 });
    frames[motion].push({ ms, ...o, flash: +o.flash.toFixed(3), label: +o.label.toFixed(3), file });
  }
  await ctx.close();
}
rmSync(join(out, 'video-tmp'), { recursive: true, force: true });
const vctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: join(out, 'video-tmp'), size: { width: 1280, height: 720 } } });
const vpage = await vctx.newPage();
await open(vpage, 'identify&n=4&seat=2');
await vpage.waitForTimeout(6500);
const vpath = await vpage.video().path();
await vctx.close();
renameSync(vpath, join(out, 'identify-flash.webm'));
rmSync(join(out, 'video-tmp'), { recursive: true, force: true });
const version = browser.version();
await browser.close();
await close();

const full = frames['no-preference'], reduced = frames.reduce;
const flashOk = full.every((f) => f.text.startsWith('Cooee #3')) && full.find((f) => f.ms === 120).flash > 0.8 && full.at(-1).flash === 0
  && new Set(full.map((f) => f.flash)).size > 4 // tweened: many intermediate values
  && reduced.filter((f) => f.ms < 1500).every((f) => f.flash === reduced[0].flash && f.transform === reduced[0].transform) && reduced.at(-1).flash === 0; // held, no scale
const report = {
  format: 'jj.u022-report.v1',
  browser: `Chromium ${version} (Playwright, channel chromium, GPU args), ${process.platform}/${process.arch}`,
  grid: { pass: gridOk, layouts: grid },
  hud: { pass: hud.allOneLine, at32: hud, at8: hud8 },
  namePlates: { pass: platesGrid === 0 && platesOverview > 0, onGrid: platesGrid, onOverview: platesOverview },
  identify: { pass: flashOk, full, reduced, video: 'identify-flash.webm' },
  errors,
};
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`grid: ${gridOk ? 'ok' : 'FAIL'} (${grid.length} N at 1080p); HUD at 32: ${hud.hudTextPx}px text, pill ${hud.pillHeightPx}px = ${(hud.pillShareOfTile * 100).toFixed(1)}% of a ${hud.tile} tile, one line: ${hud.allOneLine}; plates grid ${platesGrid} / overview ${platesOverview}; flash: ${flashOk ? 'ok' : 'FAIL'}; errors: ${errors.length}`);
process.exit(gridOk && hud.allOneLine && report.namePlates.pass && flashOk && errors.length === 0 ? 0 : 1);
