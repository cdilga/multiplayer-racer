// Owner playtest 1 (br-gw74.2): the phone settings sheet works at short landscape heights. On each viewport the sheet
// is opened mid-race (the state opener, no host) and every control in it must be reachable: inside the viewport or in
// a scroll container that can bring it there, and not covered by anything else on the screen (an elementFromPoint check
// at each control's centre after scrolling it into view). The "Back to full screen" prompt never shows over the sheet.
// Captures go to $JJ_CAPTURE_DIR when set.
//   node --test web/tests/journeys/pt1-settings-short.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/pt1set/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let server;
let browser;

before(async () => {
  server = await serve(build('./', 'pt1set'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** Every control in the sheet, scrolled into view one at a time: is it on screen and the topmost thing at its centre? */
const audit = (page) =>
  page.evaluate(async () => {
    const sheet = document.querySelector('[data-overlay=settings]');
    const bad = [];
    const ctrls = [...sheet.querySelectorAll('button, input, select, [role=switch]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    for (const el of ctrls) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => r()));
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const name = (el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 40);
      if (r.top < -1 || r.bottom > innerHeight + 1 || r.left < -1 || r.right > innerWidth + 1) bad.push(`${name}: off screen ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))}`);
      else {
        const top = document.elementFromPoint(cx, cy);
        if (!top || !(el === top || el.contains(top))) bad.push(`${name}: covered by ${top?.closest('[data-overlay]')?.dataset.overlay ?? top?.className ?? 'nothing'}`);
      }
    }
    return { count: ctrls.length, bad };
  });

for (const [w, h] of [[915, 412], [844, 390], [740, 360], [640, 300], [412, 915]]) {
  test(`settings at ${w}x${h}: every control reachable and uncovered`, { timeout: 60_000 }, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${server.origin}${BASE}j/ABCD#state=playing&round=racing`);
    await page.waitForFunction(() => document.documentElement.dataset.jjController === 'ready');
    await page.locator('[data-act=settings]').click();
    await page.locator('[data-overlay=settings]').waitFor();
    await page.waitForTimeout(300);
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/settings-${w}x${h}.png` });
    const fade = await page.evaluate(() => {
      const el = document.querySelector('[data-overlay=settings]');
      const scrolls = el.scrollHeight > el.clientHeight + 4;
      const before = el.hasAttribute('data-more');
      el.scrollTop = el.scrollHeight;
      return { scrolls, before };
    });
    await page.waitForTimeout(150);
    const fadeAtEnd = await page.evaluate(() => document.querySelector('[data-overlay=settings]').hasAttribute('data-more'));
    assert.equal(fade.before, fade.scrolls, 'the bottom fade shows exactly when there is more to scroll to');
    assert.equal(fadeAtEnd, false, 'and goes at the end');
    await page.evaluate(() => (document.querySelector('[data-overlay=settings]').scrollTop = 0));
    const a = await audit(page);
    assert.ok(a.count > 5, `the sheet has its controls (${a.count})`);
    assert.deepEqual(a.bad, [], `${w}x${h}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
