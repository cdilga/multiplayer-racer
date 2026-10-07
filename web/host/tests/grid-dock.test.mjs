// P1-R04.3 browser test: the race grid fills the display above the footer, and with no spare cell the join QR and the
// positions dock in the footer instead of taking a strip from the tiles (owner POC round 5). Fixture rooms
// (`host/?roundfixture=race-N`), real host build, Chromium.
// Run on eris (no browsers on the Mac): needs the web build (npx vite build; JJ_DIST overrides web/dist).
//   node --test web/host/tests/grid-dock.test.mjs
// Captures go to docs/evidence/P1-R04.3 (JJ_EVIDENCE_DIR overrides); JJ_NO_CAPTURES=1 skips them.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R04.3');
let browser;
let server;
before(async () => {
  browser = await chromium.launch();
  server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(spec, [width, height]) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  assert.equal(await openHost(page, `${server.url}/host/?roundfixture=${spec}`), 'fixture');
  return page;
}
const box = async (loc) => {
  const b = await loc.boundingBox();
  return b && { x: b.x, y: b.y, w: b.width, h: b.height };
};
const capture = async (page, name) => {
  if (process.env.JJ_NO_CAPTURES === '1') return;
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, `${name}.jpg`), type: 'jpeg', quality: 80 });
};
/** The tiles' and spare cells' rects once the HUD follows the grid. */
async function grid(page, n) {
  await page.waitForFunction((k) => document.querySelectorAll('.hud-tile[data-seat]').length === k, n, { timeout: 30_000 });
  await page.waitForTimeout(400); // past the 300 ms reflow
  // The kernel's own rects (device px; these tests run at DPR 1, so CSS px), not the HUD boxes laid over them.
  const tiles = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const k = c.width / Math.max(1, c.clientWidth); // backing-store px per CSS px (a downscaled render is still the same grid)
    return window.__jjRoundFixture.tileRects().map(({ x, y, w, h }) => ({ x: x / k, y: y / k, w: w / k, h: h / k }));
  });
  assert.equal(tiles.length, n);
  const cells = [];
  for (const c of await page.locator('.jj-filler:not([data-kind=margin])').all()) cells.push(await box(c));
  return { tiles, cells, foot: await box(page.locator('.jj-foot')) };
}

// [fixture N, viewport, spare cells expected]: 1080p 4 = 2x2 and 9 = 3x3 (none spare), phone landscape, 4K; 8 = 3x3 (one).
const CASES = [
  [4, [1920, 1080], 0],
  [9, [3840, 2160], 0],
  [2, [915, 412], 0],
  [8, [1920, 1080], 1],
  [7, [1366, 768], 2],
  [3, [412, 915], 0],
];

for (const [n, vp, spare] of CASES) {
  test(`race-${n} at ${vp.join('x')}: tiles fill the area above the footer; ${spare ? 'the QR has its cell, the positions dock' : 'QR and positions dock in the footer'}`, async () => {
    const page = await open(`race-${n}`, vp);
    try {
      const { tiles, cells, foot } = await grid(page, n);
      // Fills: the tiles and spare cells reach the left, right and top edges and the footer's top (no margin bands;
      // rounding only, under a CSS pixel per column or row).
      const all = [...tiles, ...cells];
      const [l, r, t, b] = [Math.min(...all.map((x) => x.x)), Math.max(...all.map((x) => x.x + x.w)), Math.min(...all.map((x) => x.y)), Math.max(...all.map((x) => x.y + x.h))];
      // The gutter's half-inset (world.ts gutterOf: 0.4 % of the short side) plus whole-pixel rounding, nothing more.
      const slack = Math.round(Math.max(2, Math.round(Math.min(...vp) * 0.004)) / 2) + 3;
      assert.ok(l <= slack && r >= vp[0] - slack && t <= slack && b >= foot.y - slack, `grid spans ${l},${t} to ${r},${b} above a footer at ${foot.y}`);
      assert.equal(cells.length, spare, 'spare cells');
      for (const x of tiles) assert.ok(Math.abs(x.w - tiles[0].w) < 1 && Math.abs(x.h - tiles[0].h) < 1, 'every tile the same size');
      const dock = await page.evaluate(() => document.documentElement.dataset.gridDock);
      const qr = page.locator('.jj-foot .foot-qr');
      const pos = page.locator('.jj-foot [data-foot-pos]');
      if (spare >= 2) {
        assert.equal(dock, '');
        assert.equal(await qr.isVisible(), false, 'the QR is in its cell');
        assert.equal(await page.locator('.jj-filler[data-kind=standings] .jj-players li').count(), Number(await pos.getAttribute('data-count')), 'the Players cell lists every racer');
        for (const x of tiles) assert.ok(x.y + x.h <= foot.y + 0.5, 'a tile ends above the footer');
        assert.deepEqual(page.errors, []);
        await capture(page, `race-${n}-${vp.join('x')}`);
        return;
      }
      if (spare === 0) {
        assert.equal(dock, 'qr positions');
        assert.ok(await qr.isVisible(), 'the docked QR shows in the footer');
        const q = await box(qr);
        assert.ok(q.y >= foot.y - 0.5 && q.y + q.h <= foot.y + foot.h + 0.5, 'the QR sits inside the footer');
      } else {
        assert.equal(dock, 'positions');
        assert.equal(await qr.isVisible(), false, 'the QR is in its cell, not the footer');
      }
      // Every racer still in the race appears in the docked positions, in order (all of them: a ticker, never a cut).
      await page.waitForFunction(() => Number(document.querySelector('[data-foot-pos]')?.dataset.count) > 0, null, { timeout: 10_000 });
      assert.ok(await pos.isVisible(), 'the positions show in the footer');
      const places = await page.locator('.jj-foot [data-foot-pos] .fp-run').first().locator('.fp-item b').allInnerTexts();
      assert.ok(places.length >= 1);
      assert.deepEqual(places.map(Number), [...places.map(Number)].sort((a, c) => a - c), 'positions in race order');
      const p = await box(pos);
      assert.ok(p.y >= foot.y - 0.5 && p.y + p.h <= foot.y + foot.h + 0.5, 'positions inside the footer');
      // Docking takes nothing from the tiles: they stay above the footer.
      for (const x of tiles) assert.ok(x.y + x.h <= foot.y + 0.5, 'a tile ends above the footer');
      assert.deepEqual(page.errors, []);
      await capture(page, `race-${n}-${vp.join('x')}`);
    } finally {
      await page.close();
    }
  });
}

test('a resize re-fills: race-8 from 1920x1080 to 1366x768 and back keeps every tile equal and the grid edge to edge', async () => {
  const page = await open('race-8', [1920, 1080]);
  try {
    for (const vp of [[1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width: vp[0], height: vp[1] });
      await page.waitForTimeout(600);
      const { tiles, cells, foot } = await grid(page, 8);
      const all = [...tiles, ...cells];
      const slack = Math.round(Math.max(2, Math.round(Math.min(...vp) * 0.004)) / 2) + 3;
      assert.ok(Math.max(...all.map((x) => x.x + x.w)) >= vp[0] - slack && Math.max(...all.map((x) => x.y + x.h)) >= foot.y - slack, `${vp}: edge to edge after the resize`);
      for (const x of tiles) assert.ok(Math.abs(x.w - tiles[0].w) < 1 && Math.abs(x.h - tiles[0].h) < 1, `${vp}: tiles equal`);
      await capture(page, `race-8-resized-${vp.join('x')}`);
    }
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test('the docked QR opens the menu, which pauses the race', async () => {
  const page = await open('race-4', [1920, 1080]);
  try {
    await grid(page, 4);
    await page.locator('.jj-foot .foot-qr').click();
    await page.waitForFunction(() => window.__jjRoundFixture.inputs().some((i) => i.type === 'ui' && /pause/i.test(String(i.ui))), null, { timeout: 5_000 });
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test('many racers: every position is in the footer (a ticker when they do not fit), none cut', async () => {
  const page = await open('race-25', [1920, 1080]);
  try {
    // 25 at 1080p: 5x5, no spare cell.
    await grid(page, 25);
    const seats = await page.evaluate(() => document.querySelector('[data-foot-pos]').dataset.count);
    const run = page.locator('.jj-foot [data-foot-pos] .fp-run').first();
    assert.equal(await run.locator('.fp-item').count(), Number(seats), 'every racer has an item');
    assert.ok(Number(seats) >= 20, `${seats} racers docked`);
    const ticking = await page.locator('.jj-foot .foot-pos-track.tick').count();
    const fits = await page.evaluate(() => { const p = document.querySelector('[data-foot-pos]'); return p.firstElementChild.firstElementChild.scrollWidth <= p.clientWidth + 0.5; });
    assert.ok(ticking === 1 || fits, 'either they all fit or the row scrolls as a ticker');
    await capture(page, 'race-25-1920x1080');
  } finally {
    await page.close();
  }
});
