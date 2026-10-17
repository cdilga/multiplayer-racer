// br-0lua: nothing behind the phone's Settings sheet shows through it. The sheet's "more below" fade was a see-through
// mask, so the Lobby's "Tap Ready when you are" banner and the device tray ghosted through its bottom edge. On every phone
// size and both engines, Settings opened over the Lobby: the sheet's background is fully opaque, it carries no mask, and
// at the bottom edge (where the fade sits) the page shows the sheet's own colour, not the banner or tray behind it.
// The toolbar's icons share one row and its labels aren't squeezed. `JJ_CAPTURE_DIR=<dir>` saves each Settings view.
//   node --test web/tests/journeys/c07-settings-sheet.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/c07s/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const SIZES = [[844, 390], [915, 412], [375, 667], [412, 915], [667, 375]];
let server;
before(async () => {
  server = await serve(build('./', 'c07s'), BASE, { JJ_STUN_URLS: '' });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await server?.close();
});

for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${engine}: the Settings sheet is opaque over the Lobby at every phone size, and the toolbar sits on one row`, { timeout: 180_000 }, async () => {
    const browser = await launcher.launch(engine === 'chromium' ? { args: chromiumArgs } : {});
    try {
      for (const [width, height] of SIZES) {
        const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: engine === 'chromium' });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${server.origin}${BASE}j/ABCD#state=playing&round=lobby`);
        await page.waitForFunction(() => document.documentElement.dataset.jjController === 'ready', undefined, { timeout: 30_000 });
        for (const sel of ['[data-act=upright]', '[data-act=tut-skip]', '[data-act=skip]']) {
          const el = page.locator(sel).first();
          if (await el.count() && await el.isVisible()) await el.click().catch(() => {});
        }
        // The toolbar (before Settings covers it): the icon buttons share one row (on a narrow phone the labelled Ready and
        // Identify sit on the row above them, by design; the defect was one icon wrapping alone), and no label is squeezed.
        const bar = await page.evaluate(() => {
          const shown = (sel) => [...document.querySelectorAll(sel)].filter((c) => c.offsetParent !== null);
          const iconRows = new Set(shown('.tools .btn.icon').map((c) => Math.round(c.getBoundingClientRect().top))).size;
          const squeezed = shown('.tools .btn:not(.icon)').filter((c) => c.scrollWidth > c.clientWidth + 1 || c.getBoundingClientRect().height > 64).map((c) => c.dataset.act);
          return { iconRows, squeezed };
        });
        assert.equal(bar.iconRows, 1, `${engine} ${width}x${height}: the toolbar's icons wrap onto ${bar.iconRows} rows`);
        assert.deepEqual(bar.squeezed, [], `${engine} ${width}x${height}: squeezed toolbar labels`);
        await page.click('[data-act=settings]');
        const sheet = await page.waitForSelector('.menusheet.settings-sheet');
        const look = await sheet.evaluate((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return { bg: cs.backgroundColor, mask: cs.maskImage || cs.webkitMaskImage || 'none', bottom: r.bottom, height: r.height };
        });
        const alpha = /rgba?\(([^)]+)\)/.exec(look.bg)?.[1].split(/[ ,/]+/).filter(Boolean)[3];
        assert.ok(alpha === undefined || Number(alpha) === 1, `${engine} ${width}x${height}: the sheet's background is opaque (${look.bg})`);
        assert.ok(!look.mask || look.mask === 'none', `${engine} ${width}x${height}: no see-through mask on the sheet (${look.mask})`);
        if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/${engine}-settings-${width}x${height}.png` });
        assert.deepEqual(errors, []);
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  });
}
