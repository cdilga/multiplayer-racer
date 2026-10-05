#!/usr/bin/env node
// br-u02-qr-list-space-jdc: the host grid's join QR and player list take the least space they need and the QR is as big as
// the free space allows (host-layout.js, rules in qr-space.json). For TV 1920x1080 and 1366x768, phone 390x844 and 844x390,
// with QR only, list only, both and neither (&qr=0 / &list=0), for 1, 8, 24 and 60 players, in the real page:
//   - game area: the tiles' area is within the tolerance of a brute-force oracle (every strip side and size at 1 px, the
//     same feasibility rules, written here independently of the solver's sweep), so the chrome takes no more than it needs;
//   - the QR is at least the minimum scannable size, and is present whenever ANY free region (or reserved strip) fits it
//     (the oracle says whether one exists); the list has a row for every player, clipped by nothing;
//   - nothing overlaps (tiles, QR, list, footer) and everything is on screen;
//   - the QR decodes: the captured screenshot is run through jsQR (web/node_modules) and must read the room URL.
// Also: the decoder floor (the smallest px per module jsQR reads from a clean render) that the minimum module sizes are set from.
// Screenshots (JPG), qr-space-check.json: docs/evidence/br-u02-qr-list-space-jdc/ (JJ_EVIDENCE_DIR overrides).
// Run: node art/ui/poc/tv/qr-space-check.mjs [--webkit] [--quick]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';
import { layoutGrid } from './grid.js';
import { ctxOf, place, qrMin, regionsOf } from './host-layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const out = process.env.JJ_EVIDENCE_DIR ?? join(root, 'docs', 'evidence', 'br-u02-qr-list-space-jdc');
mkdirSync(join(out, 'shots'), { recursive: true });
const rules = JSON.parse(readFileSync(join(here, 'qr-space.json'), 'utf8'));
const jsqr = readFileSync(join(root, 'web', 'node_modules', 'jsqr', 'dist', 'jsQR.js'), 'utf8');
const URL_WANT = 'https://jammers.dilger.dev/j/ROO7';
const useWebkit = process.argv.includes('--webkit');
const quick = process.argv.includes('--quick');

const SCREENS = [
  { id: 'tv-1920x1080', w: 1920, h: 1080, dpr: 1, phone: false },
  { id: 'tv-1366x768', w: 1366, h: 768, dpr: 1, phone: false },
  { id: 'phone-390x844', w: 390, h: 844, dpr: 2, phone: true },
  { id: 'phone-844x390', w: 844, h: 390, dpr: 2, phone: true },
];
const NS = quick ? [8, 60] : [1, 8, 24, 60];
const MODES = [['qr', 1, 0], ['list', 0, 1], ['both', 1, 1], ['neither', 0, 0]];
const TOL = rules.areaTolerance;
const failures = [];
const report = { rules, decoderFloor: null, cases: [] };

// The brute-force oracle: every strip side at every pixel size, the same feasibility rules (host-layout.js place), the grid
// from grid.js. Returns the best tile area, and whether any option at all holds the QR at the minimum size.
function oracle(n, rect, { k, dpr, gutter, qr, list }) {
  const c = ctxOf(rules, k, dpr), want = { qr, list: list && n > 0 };
  const area = (g) => (g?.cell ? n * g.cell.w * g.cell.h : 0);
  const opts = [];
  const add = (grid, side, s) => { const r = regionsOf(grid, rect, side, s); const p = place(r.regions, n, want, c); if (p) opts.push({ area: area(grid), qr: !!p.qr, q: p.qr?.q ?? 0, side, s }); };
  if (!want.qr && !want.list) return { area: area(layoutGrid(n, rect, { gutter })), qrFeasible: false };
  add(layoutGrid(n, rect, { gutter }), null, 0);
  for (const side of ['right', 'left', 'bottom', 'top']) {
    const dim = side === 'right' || side === 'left' ? rect.w : rect.h;
    for (let s = 1; s <= dim * rules.stripMaxShare; s++) {
      const r2 = side === 'right' ? { ...rect, w: rect.w - s } : side === 'left' ? { ...rect, x: rect.x + s, w: rect.w - s } : side === 'bottom' ? { ...rect, h: rect.h - s } : { ...rect, y: rect.y + s, h: rect.h - s };
      const g = layoutGrid(n, r2, { gutter });
      if (g) add(g, side, s);
    }
  }
  const qrFeasible = want.qr && opts.some((o) => o.qr);
  const pool = opts.filter((o) => !qrFeasible || o.qr);
  return { area: Math.max(0, ...pool.map((o) => o.area)), qrFeasible };
}

const measure = () => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
  const foot = document.querySelector('footer.foot');
  const usable = { l: 0, t: 0, r: innerWidth, b: foot.getBoundingClientRect().top };
  const inside = (a, b = usable) => a.l >= b.l - 1 && a.r <= b.r + 1 && a.t >= b.t - 1 && a.b <= b.b + 1;
  const tiles = [...document.querySelectorAll('.tile')].map((t) => ({ name: `tile ${t.dataset.seat}`, b: box(t) }));
  const qrEl = document.querySelector('.qrcard'), listEl = document.querySelector('.plist');
  const items = [...tiles];
  const problems = [];
  const res = { tiles: tiles.length, tile: tiles[0] ? [Math.round(tiles[0].b.w), Math.round(tiles[0].b.h)] : null, qr: null, list: null, chrome: window.__poc.chrome };
  if (qrEl) { const img = qrEl.querySelector('img'); const b = box(qrEl); items.push({ name: 'qr card', b }); res.qr = { card: [b.w, b.h], px: img.getBoundingClientRect().width, at: [b.l, b.t], label: !!qrEl.querySelector('.code') }; if (!inside(b)) problems.push('QR card leaves the grid area'); }
  if (listEl) {
    const b = box(listEl); items.push({ name: 'player list', b });
    const rows = [...listEl.querySelectorAll('.srow')];
    const bad = rows.filter((r) => { const rb = box(r); return !inside(rb, { l: b.l, t: b.t, r: b.r, b: b.b }) || r.scrollWidth > r.clientWidth + 1; });
    res.list = { card: [b.w, b.h], rows: rows.length, cols: +listEl.dataset.cols, tier: [...listEl.classList].find((c) => c.startsWith('t-')), rowPx: +getComputedStyle(listEl).getPropertyValue('--rh').replace('px', ''), clipped: bad.length };
    if (!inside(b)) problems.push('player list leaves the grid area');
    if (bad.length) problems.push(`${bad.length} list row(s) are clipped`);
  }
  items.push({ name: 'footer', b: box(foot) });
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (hit(items[i].b, items[j].b)) problems.push(`${items[i].name} overlaps ${items[j].name}`);
  for (const t of tiles) if (!inside(t.b)) problems.push(`${t.name} leaves the grid area`);
  return { ...res, problems: [...new Set(problems)] };
};

async function decode(dec, png) {
  return dec.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    const r = window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
    return r ? r.data : null;
  }, png.toString('base64'));
}

const { base, close } = await serveArtUi();
for (const [engineName, engine, launch] of useWebkit ? [['webkit', webkit, {}]] : [['chromium', chromium, { channel: 'chromium' }]]) {
  const browser = await engine.launch(launch);
  const dctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const dec = await dctx.newPage();
  await dec.goto(`${base}/poc/tv/index.html`).catch(() => {});
  await dec.addScriptTag({ content: jsqr });
  // The decoder floor: the room QR (37 modules, quiet zone included) drawn crisp at d device px per module.
  const svg = readFileSync(join(here, '..', 'shared', 'qr-roo7.svg'), 'utf8');
  const floor = await dec.evaluate(async ({ svg, want }) => {
    const im = new Image(); await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = `data:image/svg+xml;base64,${btoa(svg)}`; });
    const out = {};
    for (const d of [1, 2, 3, 4, 5, 6, 8]) {
      const c = document.createElement('canvas'); c.width = c.height = 37 * d; const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0, 37 * d, 37 * d);
      const r = window.jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      out[d] = r?.data === want;
    }
    return out;
  }, { svg, want: URL_WANT });
  report.decoderFloor = { engine: engineName, decodesAtDevicePxPerModule: floor, smallest: Number(Object.keys(floor).find((d) => floor[d])) };
  for (const s of SCREENS) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: s.phone, hasTouch: s.phone, deviceScaleFactor: s.dpr });
    const page = await ctx.newPage();
    await page.goto(`${base}/poc/tv/index.html#grid&n=8`);
    await page.waitForFunction(() => window.__poc?.ready === true, null, { timeout: 30000 });
    for (const n of NS) for (const [mode, qr, list] of MODES) {
      const hash = `#grid&n=${n}&qr=${qr}&list=${list}`;
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.waitForFunction((h) => window.__poc?.hash === h && window.__poc.ready === true, hash, { timeout: 30000 });
      await page.waitForTimeout(150);
      const r = await page.evaluate(measure);
      const where = `${engineName} ${s.id} n=${n} ${mode}`;
      const problems = [...r.problems];
      const ch = r.chrome;
      const k = ch.k, rect = ch.rect;
      const o = oracle(n, rect, { k, dpr: s.dpr, gutter: 6 * k, qr: !!qr, list: !!list });
      if (ch.area < o.area * (1 - TOL)) problems.push(`game area ${ch.area} is below the maximum ${o.area}`);
      const domArea = r.tiles * (r.tile[0] + 2 * Math.round(3 * k)) * (r.tile[1] + 2 * Math.round(3 * k));
      if (Math.abs(domArea - ch.area) > ch.area * 0.01) problems.push(`rendered tile area ${domArea} differs from the solved ${ch.area}`);
      const min = qrMin(rules, k, s.dpr);
      if (qr && !r.qr && o.qrFeasible) problems.push('the QR is hidden although a free region (or a strip) fits it');
      if (qr && r.qr && r.qr.px < min.q - 0.5) problems.push(`QR ${r.qr.px}px is below the minimum ${min.q}px`);
      if (!qr && r.qr) problems.push('a QR is shown with &qr=0');
      if (list && n > 0 && (!r.list || r.list.rows !== n)) problems.push(`the list shows ${r.list?.rows ?? 0} of ${n} players`);
      if (!list && r.list) problems.push('a list is shown with &list=0');
      let decoded = null, decodedOk = null;
      if (r.qr) {
        const [x, y] = r.qr.at, pad = 6;
        const png = await page.screenshot({ type: 'png', scale: 'device', clip: { x: Math.max(0, x - pad), y: Math.max(0, y - pad), width: Math.min(s.w - Math.max(0, x - pad), r.qr.card[0] + 2 * pad), height: Math.min(s.h - Math.max(0, y - pad), r.qr.card[1] + 2 * pad) } });
        decoded = await decode(dec, png);
        decodedOk = decoded === URL_WANT;
        if (!decodedOk) problems.push(`the QR does not decode to the room URL (got ${decoded})`);
      }
      const shot = `${s.id}-n${n}-${mode}.jpg`;
      if (!useWebkit && (mode === 'both' || n === 60)) await page.screenshot({ path: join(out, 'shots', shot), type: 'jpeg', quality: 62, scale: 'css' });
      for (const p of problems) failures.push(`${where}: ${p}`);
      report.cases.push({ engine: engineName, screen: s.id, n, mode, tile: r.tile, tilesArea: ch.area, maxArea: o.area, side: ch.side, strip: Math.round(ch.strip), qrPx: r.qr ? +r.qr.px.toFixed(1) : null, qrMinPx: +min.q.toFixed(1), qrFeasible: o.qrFeasible, qrLabel: r.qr?.label ?? null, decoded: decodedOk, list: r.list, problems });
    }
    // Resizing (a rotation, full screen, browser bars) re-solves in place: one QR card and one list, never a second, and the
    // result is the one a fresh load at that size gives.
    for (const n of [24, 60]) {
      await page.evaluate((h) => { location.hash = h; }, `#grid&n=${n}`);
      await page.waitForFunction((h) => window.__poc?.hash === h && window.__poc.ready === true, `#grid&n=${n}`, { timeout: 30000 });
      for (const [w2, h2] of [[s.w - 60, s.h - 40], [s.w, s.h], [s.h, s.w], [s.w, s.h]]) {
        await page.setViewportSize({ width: w2, height: h2 });
        await page.waitForTimeout(500);
        const r = await page.evaluate(() => ({ qr: document.querySelectorAll('.qrcard').length, list: document.querySelectorAll('.plist').length, rows: document.querySelectorAll('.plist .srow').length, area: window.__poc.chrome.area, rect: window.__poc.chrome.rect, k: window.__poc.chrome.k, hit: (() => { const a = document.querySelector('.qrcard')?.getBoundingClientRect(), b = document.querySelector('.plist')?.getBoundingClientRect(); return !!(a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5); })() }));
        const o = oracle(n, r.rect, { k: r.k, dpr: s.dpr, gutter: 6 * r.k, qr: true, list: true });
        const where = `${engineName} ${s.id} n=${n} resize ${w2}x${h2}`;
        const bad = [];
        if (r.qr !== 1 || r.list !== 1) bad.push(`${r.qr} QR card(s) and ${r.list} list(s) after a resize`);
        if (r.rows !== n) bad.push(`the list shows ${r.rows} of ${n}`);
        if (r.hit) bad.push('the QR card and the list overlap');
        if (r.area < o.area * (1 - TOL)) bad.push(`game area ${r.area} is below the maximum ${o.area}`);
        for (const p of bad) failures.push(`${where}: ${p}`);
        report.cases.push({ engine: engineName, screen: s.id, n, mode: `resize ${w2}x${h2}`, tilesArea: r.area, maxArea: o.area, qrCards: r.qr, lists: r.list, problems: bad });
      }
    }
    await ctx.close();
  }
  await dctx.close();
  await browser.close();
}
await close();
writeFileSync(join(out, `qr-space-check${useWebkit ? '-webkit' : ''}.json`), `${JSON.stringify({ failures, ...report }, null, 2)}\n`);
console.log(`decoder floor (${report.decoderFloor.engine}): ${JSON.stringify(report.decoderFloor.decodesAtDevicePxPerModule)}`);
for (const c of report.cases) console.log(c.mode.startsWith('resize') ? `${c.problems.length ? 'FAIL' : 'ok  '} ${c.screen} n=${c.n} ${c.mode}: ${c.qrCards} QR card, ${c.lists} list, area ${(100 * c.tilesArea / c.maxArea).toFixed(1)}% of max${c.problems.length ? ` :: ${c.problems.join('; ')}` : ''}` : `${c.problems.length ? 'FAIL' : 'ok  '} ${c.screen} n=${String(c.n).padStart(2)} ${c.mode.padEnd(7)} tile ${c.tile?.join('x')} area ${(100 * c.tilesArea / c.maxArea).toFixed(1)}% of max, QR ${c.qrPx ?? '-'}px (min ${c.qrMinPx}) ${c.decoded === null ? '' : c.decoded ? 'decoded' : 'NOT decoded'}, list ${c.list ? `${c.list.rows} rows ${c.list.tier} ${c.list.cols} col` : '-'}${c.problems.length ? ` :: ${c.problems.join('; ')}` : ''}`);
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nqr space check: ok');
process.exit(failures.length ? 1 : 0);
