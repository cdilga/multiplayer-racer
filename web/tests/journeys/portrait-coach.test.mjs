import { confirmInitialVehicle } from './lib/vehicle.mjs';
// br-2cy4: the rotate prompt owns portrait until the player turns sideways or chooses to play upright.
// JJ_CAPTURE_DIR=<dir> saves the portrait/landscape self-review images; ordinary runs write no committed artifacts.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const deployed = process.env.JJ_BASE_URL;
const BASE = deployed ? new URL(deployed).pathname.replace(/\/?$/, '/') : '/p/portrait-coach/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let hostBrowser, server;
before(async () => {
  server = deployed ? { origin: new URL(deployed).origin, close: async () => {} }
    : await serve(build('./', 'portrait-coach'), BASE, { JJ_STUN_URLS: '' });
  hostBrowser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await hostBrowser?.close();
  await server?.close();
});

const wait = (page, fn) => page.waitForFunction(fn, undefined, { timeout: 60_000 });
const shot = (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.jpg`, quality: 85 });
const turn = async (page, size) => {
  // Join requests full screen. Desktop browser emulation must restore the window before resizing it.
  await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
  await page.setViewportSize(size);
};
const oneCard = async (page, kind) => {
  const cards = await page.locator('[data-overlay=rotate]:visible, [data-overlay=coach]:visible').evaluateAll((els) => els.map((e) => ({ kind: e.dataset.overlay, rect: e.getBoundingClientRect().toJSON() })));
  assert.deepEqual(cards.map((c) => c.kind), [kind], `one readable card: ${JSON.stringify(cards)}`);
  for (const card of cards) {
    const size = page.viewportSize();
    assert.ok(card.rect.x >= 0 && card.rect.y >= 0 && card.rect.right <= size.width && card.rect.bottom <= size.height, 'card fits on screen');
  }
};

for (const [engine, launcher] of [['Chromium', chromium], ['WebKit', webkit]]) {
  for (const portrait of [{ width: 412, height: 915 }, { width: 375, height: 667 }]) {
    test(`${engine} ${portrait.width}: rotate and tutorial cards take turns, including resize and upright consent`, { timeout: 180_000 }, async () => {
      const hostCtx = await hostBrowser.newContext({ viewport: { width: 1920, height: 1080 } });
      const browser = engine === 'Chromium' ? hostBrowser : await launcher.launch();
      const phoneCtx = await browser.newContext({ viewport: portrait, hasTouch: true, isMobile: true });
      try {
        const host = await hostCtx.newPage();
        await host.goto(`${server.origin}${BASE}host?room&test=live`);
        await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
        const phone = await phoneCtx.newPage();
        await phone.goto(await host.evaluate(() => window.__jjNet.joinUrl()));
        await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
        await phone.getByRole('button', { name: 'Join the race' }).click();
        await wait(phone, () => window.__jjController.inspect().phase === 'playing');
        await confirmInitialVehicle(phone);
        const name = `${engine.toLowerCase()}-${portrait.width}`;
        await shot(phone, `${name}-portrait-rotate`);
        await oneCard(phone, 'rotate');
        await phone.getByRole('button', { name: 'Help: the controls tutorial', exact: true }).click();
        await oneCard(phone, 'rotate');
        assert.equal(await phone.evaluate(() => window.__jjTutorial.inspect().open), false, 'deferred tutorial has not opened the controller menu');

        await turn(phone, { width: 915, height: 412 });
        await phone.locator('[data-overlay=coach]').waitFor({ state: 'visible' });
        await oneCard(phone, 'coach');
        await shot(phone, `${name}-landscape-coach`);
        await turn(phone, portrait);
        await phone.locator('[data-overlay=rotate]').waitFor({ state: 'visible' });
        await oneCard(phone, 'rotate');
        assert.equal(await phone.evaluate(() => window.__jjTutorial.inspect().open), false);
        await phone.getByRole('button', { name: 'Play upright anyway' }).click();
        await phone.locator('[data-overlay=coach]').waitFor({ state: 'visible' });
        await oneCard(phone, 'coach');
        await shot(phone, `${name}-portrait-coach`);
        await confirmInitialVehicle(phone);
        await phone.getByRole('button', { name: 'Skip tutorial' }).click();
        await turn(phone, { width: 915, height: 412 });
        await turn(phone, portrait);
        await phone.waitForTimeout(100);
        assert.equal(await phone.locator('[data-overlay=rotate]:visible, [data-overlay=coach]:visible').count(), 0, 'consent and Skip survive subsequent orientation changes');
      } finally {
        await phoneCtx.close();
        await hostCtx.close();
        if (browser !== hostBrowser) await browser.close();
      }
    });
  }
}
