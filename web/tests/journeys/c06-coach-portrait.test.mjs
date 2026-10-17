// br-lks5: on a portrait phone the tutorial's card leaves the controls it teaches in sight. With the tutorial open
// (Help), at 375x667 and 412x915, Chromium and WebKit, on the two-stick and the Buttons layouts: the card overlaps no
// stick's home (its base) and no Buttons-pad button, and its Controls / Identify / Skip buttons share one row.
// `JJ_CAPTURE_DIR=<dir>` saves each view.
//   node --test web/tests/journeys/c06-coach-portrait.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/c06p/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let server;
before(async () => {
  server = await serve(build('./', 'c06p'), BASE, { JJ_STUN_URLS: '' });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await server?.close();
});

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${engine}: the tutorial card leaves the sticks' homes and the pad in sight on a portrait phone`, { timeout: 180_000 }, async () => {
    const browser = await launcher.launch(engine === 'chromium' ? { args: chromiumArgs } : {});
    try {
      for (const [width, height] of [[375, 667], [412, 915]]) {
        for (const controls of ['dual', 'buttons']) {
          const tag = `${engine} ${width}x${height} ${controls}`;
          const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: engine === 'chromium' });
          const page = await ctx.newPage();
          const errors = [];
          page.on('pageerror', (e) => errors.push(e.message));
          await page.goto(`${server.origin}${BASE}j/ABCD#state=playing&round=lobby`);
          await wait(page, () => document.documentElement.dataset.jjController === 'ready');
          for (const sel of ['[data-act=upright]', '[data-act=tut-skip]', '[data-act=skip]']) {
            const el = page.locator(sel).first();
            if (await el.count() && await el.isVisible()) await el.click().catch(() => {});
          }
          if (controls === 'buttons') {
            await page.click('[data-act=settings]');
            await page.click('[data-set=controls][data-v=buttons]');
            await page.click('[data-act=save]');
            await wait(page, () => document.querySelector('.sticks.buttons .padbtn'));
          }
          await page.click('[data-act=help]');
          await wait(page, () => window.__jjTutorial.inspect()?.open === true && document.querySelector('.coach'));
          const look = await page.evaluate(() => {
            const box = (e) => e.getBoundingClientRect();
            const card = box(document.querySelector('.coach'));
            const hit = (r) => r.width > 0 && r.left < card.right && r.right > card.left && r.top < card.bottom && r.bottom > card.top;
            const covered = [...document.querySelectorAll('.zone .base, .padbtn')]
              .filter((e) => e.offsetParent !== null && hit(box(e)))
              .map((e) => e.dataset.input ?? e.closest('[data-box]')?.dataset.box ?? 'base');
            const tops = [...document.querySelectorAll('.coach-top .btn')].filter((e) => e.offsetParent !== null)
              .map((e) => Math.round(box(e).top));
            return { covered, buttonRows: new Set(tops).size, card: { top: Math.round(card.top), bottom: Math.round(card.bottom) } };
          });
          if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/${engine}-coach-${controls}-${width}x${height}.png` });
          assert.deepEqual(look.covered, [], `${tag}: the card covers ${JSON.stringify(look)}`);
          assert.equal(look.buttonRows, 1, `${tag}: the card's buttons wrap onto ${look.buttonRows} rows`);
          assert.deepEqual(errors, []);
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
}
