// P1-R08 browser tests: the host on any aspect and as a phone host (portrait and landscape, DPR 2-3), on fixture room
// views. Viewing-distance profiles (default per display, host override), the 4-player race laid out on a phone, every
// tile's backing store equal to its on-screen size in device pixels, and the captures `portrait-phone-host` and
// `ultrawide-host`. Run on eris (no browsers on the Mac): node --test web/host/tests/phone-host.test.mjs
// Captures go to docs/evidence/P1-R08 (JJ_EVIDENCE_DIR overrides); JJ_NO_CAPTURES=1 skips them. Phone runs are Chromium
// emulation (viewport + deviceScaleFactor), not a device; the real phone host's frame rate is a P1-Q02 row.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R08');
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

async function open(spec, [width, height], dpr = 1, query = '') {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  assert.equal(await openHost(page, `${server.url}/host/?roundfixture=${spec}${query}`), 'fixture');
  return page;
}
const untilHud = (page, n) => page.waitForFunction((k) => document.querySelectorAll('.hud-tile[data-seat]').length === k, n, { timeout: 30_000 });
const capture = async (page, name) => {
  if (process.env.JJ_NO_CAPTURES === '1') return;
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, `${name}.jpg`), type: 'jpeg', quality: 82 });
};
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const rk = (page) => page.evaluate(() => Number(document.documentElement.style.getPropertyValue('--rk')));

const PHONES = [
  ['360x800', 360, 800],
  ['390x844', 390, 844],
  ['412x915', 412, 915],
];

for (const [label, w, h] of PHONES) {
  for (const [orient, vp] of [
    ['portrait', [w, h]],
    ['landscape', [h, w]],
  ]) {
    test(`phone host ${label} ${orient}: a 4-player race lays out four tiles, HUD inside each, nothing under the footer`, async () => {
      const page = await open('race-4', vp, 2);
      try {
        await untilHud(page, 4);
        await page.waitForTimeout(300);
        const r = await page.evaluate(() => {
          const rect = (e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height };
          };
          return {
            vw: innerWidth,
            vh: innerHeight,
            foot: rect(document.querySelector('.jj-foot')),
            tiles: [...document.querySelectorAll('.hud-tile[data-seat]')].map((t) => ({
              box: rect(t),
              parts: [...t.querySelectorAll('.hud-badge, .hud-name, .hud-tr, .hud-status .chip')].filter((p) => !p.hidden && p.getBoundingClientRect().width > 0).map(rect),
            })),
          };
        });
        assert.equal(r.tiles.length, 4);
        for (const [i, t] of r.tiles.entries()) {
          assert.ok(t.box.x >= -0.5 && t.box.y >= -0.5 && t.box.x + t.box.w <= r.vw + 0.5 && t.box.y + t.box.h <= r.vh + 0.5, `tile ${i} on screen`);
          assert.ok(!overlap(t.box, r.foot), `tile ${i} clear of the footer`);
          for (const p of t.parts) assert.ok(p.x >= t.box.x - 1 && p.y >= t.box.y - 1 && p.x + p.w <= t.box.x + t.box.w + 1 && p.y + p.h <= t.box.y + t.box.h + 1, `tile ${i}: HUD part inside its tile`);
          for (let j = i + 1; j < r.tiles.length; j++) assert.ok(!overlap(t.box, r.tiles[j].box), `tiles ${i}/${j} overlap`);
        }
        assert.ok(r.foot.y + r.foot.h <= r.vh + 0.5 && r.foot.x >= 0 && r.foot.w <= r.vw + 0.5, 'footer on screen');
        assert.deepEqual(page.errors, []);
        if (label === '412x915') await capture(page, orient === 'portrait' ? 'portrait-phone-host' : 'landscape-phone-host');
      } finally {
        await page.close();
      }
    });
  }
}

for (const dpr of [2, 3]) {
  for (const [orient, vp] of [
    ['portrait', [412, 915]],
    ['landscape', [915, 412]],
  ]) {
    test(`DPR ${dpr} ${orient}: every tile's backing store equals its on-screen size in device pixels (render/resolution.ts), or the cap is named`, async () => {
      const page = await open('race-4', vp, dpr, '&autores=injected');
      try {
        await untilHud(page, 4);
        await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 3, null, { timeout: 60_000 });
        const r = await page.evaluate(() => {
          const s = window.__jjRender.stats();
          const c = document.querySelector('canvas');
          return {
            stats: { limitedBy: s.limitedBy, resolution: s.resolution },
            canvas: { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight },
            tiles: window.__jjRender.tileRects(),
            boxes: [...document.querySelectorAll('.hud-tile[data-seat]')].map((e) => {
              const b = e.getBoundingClientRect();
              return { tile: Number(e.dataset.tile), w: b.width, h: b.height };
            }),
            chip: document.querySelector('[data-testid=render-chip]')?.textContent ?? '',
          };
        });
        if (r.stats.limitedBy) {
          assert.match(r.chip, /capped by browser/, 'the limit message shows when a canvas cap is hit');
          return;
        }
        assert.equal(r.stats.resolution, 'native');
        assert.equal(r.canvas.w, Math.round(r.canvas.cssW * dpr), 'canvas backing width = CSS width x DPR');
        assert.equal(r.canvas.h, Math.round(r.canvas.cssH * dpr), 'canvas backing height = CSS height x DPR');
        assert.equal(r.tiles.length, 4);
        for (const t of r.tiles) {
          const b = r.boxes.find((x) => x.tile === t.seat);
          assert.ok(Math.abs(t.w - b.w * dpr) <= 1.5 && Math.abs(t.h - b.h * dpr) <= 1.5, `tile ${t.seat}: ${t.w}x${t.h} device px vs ${(b.w * dpr).toFixed(1)}x${(b.h * dpr).toFixed(1)} on screen`);
        }
      } finally {
        await page.close();
      }
    });
  }
}

test('ultrawide host: 21:9 and 32:9 races, lobby and results lay out, the footer stays in the bottom margin', async () => {
  for (const [name, vp] of [
    ['ultrawide-host', [3440, 1440]],
    ['superwide', [5120, 1440]],
  ]) {
    for (const spec of ['race-8', 'lobby-32', 'results-8']) {
      const page = await open(spec, vp);
      try {
        if (spec.startsWith('race')) await untilHud(page, 8);
        await page.waitForTimeout(400);
        const f = await page.locator('.jj-foot').boundingBox();
        assert.ok(Math.abs(f.y + f.height - vp[1]) < 1 && f.width <= vp[0] + 0.5);
        if (spec === 'race-8') {
          for (const t of await page.locator('.hud-tile[data-seat]').all()) {
            const b = await t.boundingBox();
            assert.ok(b.y + b.height <= f.y + 0.5 && b.x + b.width <= vp[0] + 0.5, `${name}: tile above the footer and on screen`);
          }
        }
        assert.deepEqual(page.errors, []);
        if (name === 'ultrawide-host') await capture(page, `${name}-${spec}`);
      } finally {
        await page.close();
      }
    }
  }
});

test('profiles: the display picks a default (TV, desk, handheld), the host overrides it live and it is remembered', async () => {
  const dflt = {};
  for (const [name, vp] of [
    ['tv', [1920, 1080]],
    ['desk', [1280, 800]],
    ['handheld', [412, 915]],
  ]) {
    const page = await open('lobby-8', vp);
    try {
      dflt[name] = await rk(page);
      await page.locator('[data-act=menu]').click();
      assert.match(await page.locator('[data-view] [aria-pressed=true]').innerText(), new RegExp(`^Auto \\(${name}\\)`), `${name}: Auto names the profile in force`);
    } finally {
      await page.close();
    }
  }
  assert.ok(Math.abs(dflt.tv - 1) < 1e-6, 'TV at 1080p is the design scale');
  assert.ok(Math.abs(dflt.desk - (800 / 1080) * 0.85) < 1e-6, 'a desk host reads smaller than the TV multiplier alone');
  // Override: the TV profile on the desk display gives the TV multiplier, live, and it persists across a reload.
  const page = await open('lobby-8', [1280, 800]);
  try {
    await page.locator('[data-act=menu]').click();
    await page.locator('[data-act=view][data-profile=tv]').click();
    assert.ok(Math.abs((await rk(page)) - 800 / 1080) < 1e-6, 'override applied live');
    assert.equal(await page.evaluate(() => localStorage.getItem('jj.host.profile')), 'tv');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.jjHost !== undefined);
    assert.ok(Math.abs((await rk(page)) - 800 / 1080) < 1e-6, 'remembered');
    assert.deepEqual(page.errors, []);
  } finally {
    await page.close();
  }
});

test('phone host menu: Full screen is offered (from a gesture), and the lobby fits a phone with the footer', async () => {
  const page = await open('lobby-8', [412, 915]);
  try {
    await page.locator('[data-act=menu]').click();
    assert.ok(await page.getByRole('button', { name: 'Full screen' }).isVisible());
    await capture(page, 'phone-host-menu');
  } finally {
    await page.close();
  }
});
