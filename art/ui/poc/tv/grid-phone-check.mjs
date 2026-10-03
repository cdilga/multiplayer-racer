#!/usr/bin/env node
// br-u02-grid-visual-phone: the TV grid on phone-sized hosts (and a TV), in Chromium and WebKit with mobile emulation.
// For 360x800, 390x844 and 412x915 in portrait and landscape, and 1920x1080, with 1, 4, 12, 24 and 40 players
// (`#grid&n=N`): no two tiles intersect, every HUD box is inside its tile, every tile and empty cell is inside the grid
// area, the grid (tiles and empty cells) covers at least 90% of the usable viewport (the viewport above the footer), and
// the footer's host controls are wholly on screen.
// A screenshot of every case goes to docs/evidence/br-u02-grid-visual-phone-d4g/cases/ (JJ_EVIDENCE_DIR overrides).
// Run: node art/ui/poc/tv/grid-phone-check.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'br-u02-grid-visual-phone-d4g');
mkdirSync(out, { recursive: true });
// Every case is captured (CSS pixels); contact-sheets.mjs puts each screen's ten (two engines × five counts) on one sheet.
const shots = join(out, 'cases');
mkdirSync(shots, { recursive: true });
const PHONES = [[360, 800], [390, 844], [412, 915]];
const SCREENS = [...PHONES.flatMap(([w, h]) => [[w, h, 'portrait'], [h, w, 'landscape']]), [1920, 1080, 'tv']];
const NS = [1, 4, 12, 24, 40];

const measure = () => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
  const inside = (a, b) => a.l >= b.l - 1 && a.r <= b.r + 1 && a.t >= b.t - 1 && a.b <= b.b + 1;
  const tiles = [...document.querySelectorAll('.tile')].map((t) => ({ seat: t.dataset.seat, el: t, b: box(t) }));
  const cells = [...document.querySelectorAll('.filler, [data-role]')].filter((e) => !e.closest('.tile')).map(box);
  const foot = document.querySelector('footer.foot');
  const usable = { l: 0, t: 0, r: innerWidth, b: foot ? foot.getBoundingClientRect().top : innerHeight };
  const problems = [];
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) if (hit(tiles[i].b, tiles[j].b)) problems.push(`tiles ${tiles[i].seat} and ${tiles[j].seat} overlap`);
  for (const t of tiles) {
    if (!inside(t.b, usable)) problems.push(`tile ${t.seat} leaves the grid area`);
    for (const part of t.el.querySelectorAll('.hud-top, .hud-bottom, .hud-badge, .hud-name, .hud-tr, .hud-boost, .hud-status .chip, .hud-centre, .mirror')) {
      const b = box(part);
      if (b.r - b.l < 0.5 || b.b - b.t < 0.5) continue; // hidden
      if (!inside(b, t.b)) problems.push(`tile ${t.seat}: ${part.className} spills out of the tile`);
    }
  }
  for (const c of cells) if (!inside(c, usable)) problems.push('an empty cell leaves the grid area');
  // The host's controls (pause, full screen, menu) must be wholly on screen: the page hides overflow, so nothing else
  // would notice a button pushed off the edge.
  const screen = { l: 0, t: 0, r: innerWidth, b: innerHeight };
  for (const b of document.querySelectorAll('footer.foot .fbtn')) {
    const r = box(b);
    if (r.r - r.l > 0.5 && !inside(r, screen)) problems.push(`footer control "${b.getAttribute('aria-label') || b.textContent.trim()}" is cut off by the screen edge`);
  }
  // Coverage: tiles and empty cells (each grid cell once) over the usable viewport.
  const area = (b) => Math.max(0, b.r - b.l) * Math.max(0, b.b - b.t);
  const covered = tiles.reduce((s, t) => s + area(t.b), 0) + cells.reduce((s, c) => s + area(c), 0);
  const ratio = covered / area(usable);
  if (ratio < 0.9) problems.push(`the grid covers ${(ratio * 100).toFixed(1)}% of the usable viewport (< 90%)`);
  return { tiles: tiles.length, tile: tiles[0] ? `${Math.round(tiles[0].b.r - tiles[0].b.l)}x${Math.round(tiles[0].b.b - tiles[0].b.t)}` : '', coverage: +(ratio * 100).toFixed(1), problems };
};

const { base, close } = await serveArtUi();
const failures = [];
const report = [];
for (const [engineName, engine, launch] of [['chromium', chromium, { channel: 'chromium' }], ['webkit', webkit, {}]]) {
  const browser = await engine.launch(launch);
  for (const [w, h, kind] of SCREENS) {
    const phone = kind !== 'tv';
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2.625 : 1 });
    const page = await ctx.newPage();
    for (const n of NS) {
      const hash = `#grid&n=${n}`;
      await page.goto('about:blank');
      await page.goto(`${base}/poc/tv/index.html${hash}`);
      await page.waitForFunction((x) => window.__poc?.ready === true && window.__poc.hash === x, hash, { timeout: 30000 });
      await page.waitForTimeout(250);
      const r = await page.evaluate(measure);
      report.push({ engine: engineName, screen: `${w}x${h} ${kind}`, n, ...r });
      for (const p of r.problems) failures.push(`${engineName} ${w}x${h} ${kind} n=${n}: ${p}`);
      await page.screenshot({ path: join(shots, `${engineName}-${w}x${h}-n${n}.jpg`), type: 'jpeg', quality: 60, scale: 'css' });
    }
    await ctx.close();
  }
  await browser.close();
}
await close();
writeFileSync(join(out, 'grid-phone-check.json'), `${JSON.stringify({ failures, report }, null, 2)}\n`);
for (const r of report) console.log(`${r.problems.length ? 'FAIL' : 'ok  '} ${r.engine} ${r.screen} n=${r.n}: tile ${r.tile}, grid ${r.coverage}% of the usable viewport${r.problems.length ? ` (${r.problems.length} problem(s))` : ''}`);
console.log(failures.length ? `\n${failures.length} failure(s)\n  ${[...new Set(failures)].slice(0, 15).join('\n  ')}` : '\ngrid phone check: ok');
process.exit(failures.length ? 1 : 0);
