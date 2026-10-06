#!/usr/bin/env node
// P1-U05 (br-dim.12): the look settings panel must never cover the view. Playwright rect check at phone portrait, phone landscape
// and TV sizes: the collapsed panel (a corner button) and the open panel (docked right in landscape, bottom in portrait) as a
// fraction of the viewport, that it opens and dismisses (button, Close, Escape), and that its content isn't clipped sideways.
//   node art/ui/poc/world/panel-check.mjs [--out docs/evidence/br-dim.12]
// Limits: closed <= 3% of the view at every size; open <= 3% of the view (the world re-lays out beside / above the docked panel, so
// every tile must lie fully inside the visible view and none under the panel). Exit 1 on any failure. Writes panel-check.json and
// panel-<size>-<closed|open>.jpg for the self-review.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(here, '..', '..', '..', '..', 'docs', 'evidence', 'br-dim.12');
mkdirSync(out, { recursive: true });
const SIZES = [['phone-portrait', 412, 915, 0, 2.6], ['phone-landscape', 915, 412, 0, 2.6], ['tv', 1920, 1080, 0, 1]];
const OPEN_MAX = 0.03;
const CLOSED_MAX = 0.03;
const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = [];
let failed = false;
for (const [name, w, h, openMax, dpr] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: w < 1000, isMobile: w < 1000 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${base}/poc/world/index.html#grid&n=24`);
  await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 120000 });
  const rect = (sel) => page.evaluate((s) => {
    const e = document.querySelector(s); if (!e) return null;
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return { shown: false };
    const r = e.getBoundingClientRect();
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom);
    return { shown: true, x: r.left, y: r.top, w: r.width, h: r.height, overlap: Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (innerWidth * innerHeight), clippedX: e.scrollWidth > e.clientWidth + 1, scrolls: e.scrollHeight > e.clientHeight + 1 };
  }, sel);
  const row = { size: name, viewport: `${w}x${h}`, openMax: OPEN_MAX, closedMax: CLOSED_MAX, problems: [] };
  row.closed = { toggle: await rect('.look-toggle'), panel: await rect('.look-bar') };
  await page.screenshot({ path: join(out, `panel-${name}-closed.jpg`), type: 'jpeg', quality: 86 });
  if (!row.closed.toggle?.shown) row.problems.push('no toggle button');
  else if (row.closed.toggle.overlap > CLOSED_MAX) row.problems.push(`closed button covers ${(row.closed.toggle.overlap * 100).toFixed(1)}%`);
  if (row.closed.panel?.shown) row.problems.push('panel visible while collapsed');
  // open: the world re-lays out beside / above the panel (a reload with &panel=1), so the panel must not cover the view
  const ready = () => page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 120000 });
  await page.click('.look-toggle'); await page.waitForURL(/panel=1/); await ready();
  const view = await page.evaluate(() => {
    const c = document.getElementById('world').getBoundingClientRect(), p = document.querySelector('.look-bar').getBoundingClientRect();
    const ix = Math.max(0, Math.min(c.right, p.right) - Math.max(c.left, p.left)), iy = Math.max(0, Math.min(c.bottom, p.bottom) - Math.max(c.top, p.top));
    const tiles = [...document.querySelectorAll('.tile')].map((t) => t.getBoundingClientRect());
    const out = tiles.filter((r) => r.left < c.left - 1 || r.top < c.top - 1 || r.right > c.right + 1 || r.bottom > c.bottom + 1);
    const pr = [p.left, p.top, p.right, p.bottom];
    const hit = tiles.filter((r) => r.left < p.right - 1 && r.right > p.left + 1 && r.top < p.bottom - 1 && r.bottom > p.top + 1);
    return { canvas: [c.left, c.top, c.width, c.height], panel: pr, overlapOfView: ix * iy / (c.width * c.height), tiles: tiles.length, tilesOutsideView: out.length, tilesUnderPanel: hit.length, canvasPx: [document.getElementById('world').width, document.getElementById('world').height] };
  });
  row.open = { toggle: await rect('.look-toggle'), panel: await rect('.look-bar'), view };
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `panel-${name}-open.jpg`), type: 'jpeg', quality: 86 });
  row.openOverlap = +view.overlapOfView.toFixed(4);
  if (!row.open.panel?.shown) row.problems.push('panel did not open');
  if (view.overlapOfView > OPEN_MAX) row.problems.push(`open panel covers ${(view.overlapOfView * 100).toFixed(1)}% of the view (limit ${OPEN_MAX * 100}%)`);
  if (view.tiles < 24) row.problems.push(`only ${view.tiles} tiles in the DOM`);
  if (view.tilesOutsideView || view.tilesUnderPanel) row.problems.push(`${view.tilesOutsideView} tiles outside the view, ${view.tilesUnderPanel} under the panel`);
  if (row.open.toggle?.shown) row.problems.push('the Look button is still shown over the open panel');
  if (row.open.panel?.clippedX) row.problems.push('open panel content clipped sideways');
  // The docked world must be exactly the world at the smaller size with no panel: the same frozen frame (?freeze=60, grain and shimmer
  // off) of a docked page and of an undocked page whose viewport is the docked view's size must be pixel-identical. This catches a
  // pass or tile rect still sized to the pre-dock canvas (a stale scissor, sky or post target) at every size.
  const frozen = async (vp, q, hash) => {
    const c2 = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, hasTouch: w < 1000, isMobile: w < 1000 });
    const p2 = await c2.newPage();
    await p2.goto(`${base}/poc/world/index.html?${q}&freeze=60&grain=0&shimmer=0${hash}`);
    await p2.waitForFunction(() => window.__world?.ready === true, null, { timeout: 120000 });
    const png = await p2.evaluate(() => window.__world.snapshot().toDataURL('image/png'));
    await c2.close();
    return png;
  };
  const vw = Math.round(view.canvas[2]), vh = Math.round(view.canvas[3]);
  const docked = await frozen({ width: w, height: h }, 'panel=1', '#grid&n=24');
  const plain = await frozen({ width: vw, height: vh }, 'bar=0', '#grid&n=24');
  row.dockedEqualsUndocked = docked === plain;
  row.undockedViewport = `${vw}x${vh}`;
  if (!row.dockedEqualsUndocked) row.problems.push(`the docked frame differs from the undocked ${vw}x${vh} frame (a pass or tile sized to the old canvas)`);
  // dismiss: Close, then reopen and Escape; each returns to the full-size view
  for (const how of ['close', 'escape']) {
    if (how === 'escape') { await page.click('.look-toggle'); await page.waitForURL(/panel=1/); await ready(); }
    if (how === 'close') await page.click('.look-head button'); else await page.keyboard.press('Escape');
    await page.waitForFunction(() => !location.search.includes('panel=1'), null, { timeout: 30000 }); await ready();
    const back = await page.evaluate(() => { const c = document.getElementById('world').getBoundingClientRect(); return { w: c.width, h: c.height, panelShown: getComputedStyle(document.querySelector('.look-bar')).display !== 'none', fullSize: Math.abs(c.width - innerWidth) < 1 && Math.abs(c.height - innerHeight) < 1 }; });
    row[`dismissBy_${how}`] = !back.panelShown && back.fullSize;
    if (back.panelShown || !back.fullSize) row.problems.push(`not dismissed by ${how} (${JSON.stringify(back)})`);
  }
  row.pageErrors = errs;
  if (errs.length) row.problems.push(`page errors: ${errs[0]}`);
  row.pass = row.problems.length === 0;
  failed ||= !row.pass;
  results.push(row);
  console.log(name, row.pass ? 'PASS' : `FAIL ${row.problems.join('; ')}`, `closed ${(row.closed.toggle?.overlap * 100).toFixed(2)}% open ${(row.openOverlap * 100).toFixed(1)}%`);
  await ctx.close();
}
writeFileSync(join(out, 'panel-check.json'), `${JSON.stringify({ when: new Date().toISOString(), what: 'look panel overlap with the view (fractions of the viewport), #grid&n=24', results }, null, 2)}\n`);
await browser.close(); await close();
process.exit(failed ? 1 : 0);
