#!/usr/bin/env node
// br-dim.7 measurement for the merged round-complete + highlights screen (#results / #intermission), in Chromium on this
// machine's GPU. At every size and player count (1, 8, 32, 150 by default) it asserts, in the rendered page:
//   - the video replay takes 50-67 % of the screen area (round-layout.json's limits);
//   - the other region holds the placings (every player shown: no truncation, no cap), the join QR, the next-race chip and
//     the three buttons, none overlapping and none outside the screen or its region;
//   - no unused block in that region taller than one row (a button's height): the gaps between its blocks, and from the
//     first and last block to the region's edges, in each of its columns;
//   - no horizontal page overflow, the banner and the next-race chip inside the screen.
// It also reports the placings' tier (row, seat, num, tiny) and QR size: informational, the tiny tier is the honest floor.
// Run: node art/ui/poc/tv/merged-check.mjs [--out <dir>] [--sizes 412x915,915x412,820x1180,1366x768,1920x1080] [--ns 1,8,32,150]
//      [--shots] (with --shots, saves a screenshot of each case into <out>)
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const take = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv.splice(i, 2)[1]; };
const shots = argv.includes('--shots');
const out = take('--out', '/tmp/dim7-merged');
const sizes = take('--sizes', '412x915,375x667,915x412,820x1180,1366x768,1920x1080').split(',').map((v) => v.split('x').map(Number));
const ns = take('--ns', '1,8,32,150').split(',').map(Number);
const limits = JSON.parse(readFileSync(join(here, 'round-layout.json'), 'utf8')).limits;
mkdirSync(out, { recursive: true });

const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [], external = [];

const measure = () => {
  const W = innerWidth, H = innerHeight, n = +(location.hash.match(/n=(\d+)/)?.[1] ?? 8);
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const q = (s) => document.querySelector(s);
  const v = R(q('.hl-view')), region = R(q('.rd-right'));
  const res = { n, W, H, problems: [] };
  res.videoFraction = +((v.w * v.h) / (W * H)).toFixed(3);
  res.layout = q('.rd-right').classList.contains('split') ? 'split' : 'stack';
  const btn = R(q('.rd-acts .btn')), rowH = btn.h;
  res.rowH = Math.round(rowH);
  const blocks = [['list', q('.rd-list')], ['join', q('.rd-join')], ['next', q('.rd-next')], ['acts', q('.rd-acts')]].map(([name, e]) => ({ name, ...R(e) }));
  // the list's real extent: its rows and cells (the container may be taller than the last row)
  const items = [...document.querySelectorAll('.rd-row, .rd-cell')].map(R);
  const list = blocks[0];
  if (items.length) { list.y = Math.min(...items.map((i) => i.y), list.y); list.b = Math.max(...items.map((i) => i.b)); list.h = list.b - list.y; }
  res.shown = items.length; res.tier = q('.rd-rest')?.dataset.tier ?? (n <= 3 ? 'rows only' : '');
  if (items.length !== n) res.problems.push(`shows ${items.length} of ${n} players`);
  const tol = 1.5;
  for (const b of blocks) if (b.x < region.x - (b.name === 'next' ? 10 : tol) || b.r > region.r + (b.name === 'next' ? 10 : tol) || b.y < region.y - (b.name === 'next' ? 10 : tol) || b.b > region.b + (b.name === 'next' ? 10 : tol)) res.problems.push(`${b.name} outside its region (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)} in ${Math.round(region.x)},${Math.round(region.y)} ${Math.round(region.w)}x${Math.round(region.h)})`);
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], c = blocks[j];
    if (a.name === 'join' && c.name === 'next' && q('.rd-right').classList.contains('row2')) continue; // the chip sits beside the QR
    if (a.x < c.r - tol && c.x < a.r - tol && a.y < c.b - tol && c.y < a.b - tol) res.problems.push(`${a.name} overlaps ${c.name}`);
  }
  // unused vertical blocks per column: columns = blocks grouped by horizontal overlap
  const cols = [];
  for (const b of [...blocks].sort((a, c) => a.x - c.x)) { const col = cols.find((c) => b.x < c.r - tol && c.x < b.r - tol); if (col) { col.items.push(b); col.x = Math.min(col.x, b.x); col.r = Math.max(col.r, b.r); } else cols.push({ x: b.x, r: b.r, items: [b] }); }
  let maxGap = 0;
  for (const c of cols) {
    const s = c.items.sort((a, d) => a.y - d.y);
    let edge = region.y;
    for (const b of s) { maxGap = Math.max(maxGap, b.y - edge); edge = Math.max(edge, b.b); }
    maxGap = Math.max(maxGap, region.b - edge);
  }
  res.maxUnusedPx = Math.round(maxGap);
  if (maxGap > rowH + tol) res.problems.push(`unused block ${Math.round(maxGap)}px > one row (${Math.round(rowH)}px)`);
  res.qrPx = Math.round(R(q('.rd-join .qr')).w);
  const chip = R(q('.rd-next')), bn = R(q('.rd-head .bn')), sub = R(q('.round .strip'));
  for (const [name, b] of [['chip', chip], ['banner', bn], ['highlights strip', sub], ['video', v]]) if (b.x < -tol || b.r > W + tol || b.b > H + tol || b.y < -tol) res.problems.push(`${name} clipped by the screen`);
  if (document.documentElement.scrollWidth > W + 2) res.problems.push('horizontal page overflow');
  for (const e of document.querySelectorAll('.rd-acts .btn')) { const r = R(e); if (r.b > H + tol || r.r > W + tol) res.problems.push('button off screen'); if (e.scrollWidth > e.clientWidth + 2) res.problems.push('button text wider than its box'); }
  const cell = q('.rd-cell'); res.cellFontPx = cell ? Math.round(parseFloat(getComputedStyle(cell).fontSize) * 10) / 10 : null;
  return res;
};

let fail = 0;
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: w < 900 || h < 900, isMobile: Math.min(w, h) < 500 });
  page.on('pageerror', (e) => errors.push(`${w}x${h} ${e.message}`));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  for (const n of ns) {
    for (const state of n === 8 ? ['results', 'intermission'] : ['results']) {
      const hash = `#${state}&n=${n}`;
      await page.goto('about:blank'); await page.goto(`${base}/poc/tv/index.html${hash}`);
      await page.waitForFunction((x) => window.__poc?.ready === true && window.__poc.hash === x, hash, { timeout: 60000 });
      await page.waitForTimeout(300);
      const r = await page.evaluate(measure);
      if (r.videoFraction < limits.min || r.videoFraction > limits.max) r.problems.push(`video fraction ${r.videoFraction} outside ${limits.min}-${limits.max}`);
      const ok = r.problems.length === 0;
      if (!ok) fail++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}x${h} ${hash.padEnd(22)} video ${r.videoFraction} ${r.layout} tier ${r.tier} shown ${r.shown}/${r.n} qr ${r.qrPx}px maxUnused ${r.maxUnusedPx}/${r.rowH}px cell-font ${r.cellFontPx}${ok ? '' : ` :: ${r.problems.join('; ')}`}`);
      if (shots) await page.screenshot({ path: join(out, `${state}-n${n}-${w}x${h}.png`) });
    }
  }
  await page.close();
}
await browser.close();
await close();
if (errors.length) console.log('page errors', errors);
if (external.length) console.log('external requests', external);
console.log(fail || errors.length || external.length ? `FAIL (${fail} cases)` : 'PASS');
process.exit(fail || errors.length || external.length ? 1 : 0);
