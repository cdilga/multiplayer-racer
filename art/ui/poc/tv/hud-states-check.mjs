#!/usr/bin/env node
// br-dim.5: in every tile, at every tile size and with every combination of the tile states, the HUD parts never overlap.
// Loads `#hud&n=N&states=matrix` (N up to 100: no player cap) (the seats cycle through status none/Autopilot/Reconnecting × Wrecked × boost empty/full,
// twelve combinations) for N players on several screens, and for every tile checks that the boost bar, the status chip,
// the position/lap pill, the number badge, the name and the Wrecked overlay don't intersect each other and stay inside the tile.
// Screenshots of a few sizes go to docs/evidence/br-dim.5/ (JJ_EVIDENCE_DIR overrides).
// Run: node art/ui/poc/tv/hud-states-check.mjs [--json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'br-dim.5');
mkdirSync(out, { recursive: true });
const SCREENS = [[1920, 1080], [2560, 1440], [1366, 768], [915, 412], [412, 915]];
const NS = [1, 2, 3, 4, 6, 8, 9, 12, 16, 20, 24, 32, 40, 64, 100];
const SHOTS = new Set(['1920x1080:12', '1920x1080:40', '1920x1080:100', '412x915:12', '412x915:40', '412x915:100', '915x412:24', '1366x768:32']);

const measure = () => {
  const box = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  };
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
  const rows = [];
  for (const t of document.querySelectorAll('.tile')) {
    const tile = box(t);
    const parts = {
      boost: box(t.querySelector('.hud-boost')),
      chip: box(t.querySelector('.hud-status .chip')),
      poslap: box(t.querySelector('.hud-tr')),
      badge: box(t.querySelector('.hud-badge')), // the visible parts, not their flex container (which can shrink)
      name: box(t.querySelector('.hud-name')),
      wreck: box(t.querySelector('.hud-centre')),
    };
    const names = Object.keys(parts).filter((k) => parts[k]);
    const overlaps = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (hit(parts[names[i]], parts[names[j]])) overlaps.push(`${names[i]}×${names[j]}`);
    const outside = names.filter((k) => parts[k].l < tile.l - 1 || parts[k].r > tile.r + 1 || parts[k].t < tile.t - 1 || parts[k].b > tile.b + 1);
    rows.push({ seat: t.dataset.seat, w: Math.round(tile.r - tile.l), h: Math.round(tile.b - tile.t), compact: t.classList.contains('compact'), states: names.join(','), overlaps, outside });
  }
  return rows;
};

const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium' });
const failures = [];
const report = [];
const combos = new Set();
for (const [w, h] of SCREENS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  for (const n of NS) {
    const hash = `#hud&n=${n}&states=matrix`;
    await page.goto('about:blank');
    await page.goto(`${base}/poc/tv/index.html${hash}`);
    await page.waitForFunction((x) => window.__poc?.ready === true && window.__poc.hash === x, hash, { timeout: 30000 });
    await page.waitForTimeout(150);
    const rows = await page.evaluate(measure);
    const sizes = rows.map((r) => `${r.w}x${r.h}`);
    for (const r of rows) {
      combos.add(r.states);
      if (r.overlaps.length) failures.push(`${w}x${h} n=${n} seat ${r.seat} (${r.w}x${r.h}${r.compact ? ', compact' : ''}): ${r.overlaps.join(' ')}`);
      if (r.outside.length) failures.push(`${w}x${h} n=${n} seat ${r.seat} (${r.w}x${r.h}): outside the tile: ${r.outside.join(' ')}`);
    }
    report.push({ screen: `${w}x${h}`, n, tile: sizes[0], compact: rows.filter((r) => r.compact).length, bad: rows.filter((r) => r.overlaps.length || r.outside.length).length });
    if (SHOTS.has(`${w}x${h}:${n}`)) await page.screenshot({ path: join(out, `hud-states-${w}x${h}-n${n}.jpg`), type: 'jpeg', quality: 70 });
  }
  await page.close();
}
await browser.close();
await close();

const summary = { runs: report.length, tiles: report.reduce((s, r) => s + r.n, 0), combinations: [...combos].sort(), failures: failures.length };
writeFileSync(join(out, 'hud-states-check.json'), `${JSON.stringify({ summary, report, failures }, null, 2)}\n`);
if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, report, failures }, null, 2));
else {
  for (const r of report) console.log(`${r.bad ? 'FAIL' : 'ok  '} ${r.screen} n=${r.n} tile ${r.tile}${r.compact ? ` (${r.compact} compact)` : ''}${r.bad ? `: ${r.bad} tile(s) overlap` : ''}`);
  console.log(`\n${summary.runs} layouts, ${summary.tiles} tiles, ${summary.combinations.length} part combinations seen; ${failures.length} failure(s)`);
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
}
process.exit(failures.length ? 1 : 0);
