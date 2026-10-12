import { confirmInitialVehicle } from './lib/vehicle.mjs';
// br-2mxa (R125) journey: a phone sets each learner-assist level in Settings (Off / Some / Lots); the host's room view
// carries it per seat and, once the race runs, the seat's tile shows the L-plate (and loses it when set back to Off).
//   node --test web/tests/journeys/br-2mxa-assist.test.mjs     (JJ_CAPTURE_DIR=<dir> saves the self-review captures)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const deployed = process.env.JJ_BASE_URL;
const BASE = deployed ? new URL(deployed).pathname.replace(/\/?$/, '/') : '/p/assist/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = deployed ? { origin: new URL(deployed).origin, close: async () => {} }
    : await serve(build('./', 'assist'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const resize = async (page, width, height) => {
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(300);
};
const shot = (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });

const completionFits = async (page) => {
  const fits = await page.locator('[data-act=done]').evaluate((done) => {
    const action = done.getBoundingClientRect();
    const card = done.closest('[data-overlay=coach]').getBoundingClientRect();
    const area = done.closest('.sticks').getBoundingClientRect();
    return action.top >= card.top && action.bottom <= card.bottom && card.bottom <= area.bottom
      && action.left >= card.left && action.right <= card.right;
  });
  assert.ok(fits, 'completion actions fit in the card above the device row');
};

test('R125: the phone sets Off / Some / Lots, the host carries it per seat and shows the L-plate on the tile in the race', { timeout: 240_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  await host.getByRole('button', { name: 'Host menu', exact: true }).click();
  await host.getByRole('button', { name: 'Race rules', exact: true }).click();
  await host.getByRole('button', { name: 'Off', exact: true }).click();
  await wait(host, () => window.__jjRoom.view().catchUp === false);
  await host.getByRole('button', { name: 'Light', exact: true }).click();
  await wait(host, () => window.__jjRoom.view().catchUp === true);
  await shot(host, 'lobby-catchup-light-1280x720');
  await host.keyboard.press('Escape');
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(page);
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  // R90 fixture: show the tutorial's completion state in the real joined controller.
  await page.evaluate(() => window.__jjTutorial.show(6));
  await completionFits(page);
  await shot(page, 'phone-tutorial-driving-help-844x390');
  await page.getByRole('button', { name: 'Driving help', exact: true }).click();
  await page.waitForSelector('[data-overlay=settings] [data-set=assist]');
  await page.getByRole('button', { name: 'Save and back to driving' }).click();

  const seatAssist = () => host.evaluate(() => window.__jjRoom.view().seats[0]?.assist ?? null);
  assert.equal(await seatAssist(), 0, 'a new seat has no help on');
  const set = async (v, label) => {
    await page.getByRole('button', { name: /^Settings/ }).click();
    await page.waitForSelector('[data-overlay=settings]');
    await page.locator(`[data-set=assist][data-v=${v}]`).click();
    await shot(page, `phone-settings-assist-${v}-844x390`);
    await page.getByRole('button', { name: 'Save and back to driving' }).click();
    await wait(page, (v) => window.__jjController.inspect().assist === v, v);
    await wait(host, (n) => window.__jjRoom.view().seats[0].assist === n, label);
  };
  await set('some', 1);
  await set('lots', 2);
  await set('off', 0);
  await set('some', 1);
  // Portrait settings capture, then back.
  await resize(page, 390, 844);
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.waitForSelector('[data-overlay=settings]');
  await shot(page, 'phone-settings-assist-some-390x844');
  await page.getByRole('button', { name: 'Save and back to driving' }).click();
  await resize(page, 844, 390);

  // The race: the seat's tile carries the L-plate while help is on.
  await page.locator('[data-act=ready]').click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await wait(host, () => [...document.querySelectorAll('.hud-tile [data-lplate]')].some((e) => !e.hidden), undefined, 30_000);
  await shot(host, 'tv-lplate-some-1280x720');
  await resize(host, 1920, 1080);
  await shot(host, 'tv-lplate-some-1920x1080');
  await resize(host, 1280, 720);
  const plate = await host.evaluate(() => {
    const e = [...document.querySelectorAll('.hud-tile [data-lplate]')].find((x) => !x.hidden);
    const r = e.getBoundingClientRect();
    const tile = e.closest('.hud-tile').getBoundingClientRect();
    return { w: r.width, h: r.height, inside: r.left >= tile.left && r.right <= tile.right && r.top >= tile.top && r.bottom <= tile.bottom, text: e.textContent, assist: e.dataset.assist };
  });
  assert.deepEqual([plate.text, plate.assist, plate.inside], ['L', '1', true]);
  assert.ok(plate.w >= 10 && plate.h >= 10, `the plate has a size: ${plate.w}x${plate.h}`);
  // Lots, live in the race; then Off takes the plate away.
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.waitForSelector('[data-overlay=settings]');
  await page.locator('[data-set=assist][data-v=lots]').click();
  await page.getByRole('button', { name: 'Save and back to driving' }).click();
  await wait(host, () => [...document.querySelectorAll('.hud-tile [data-lplate]')].some((e) => !e.hidden && e.dataset.assist === '2'), undefined, 15_000);
  await shot(host, 'tv-lplate-lots-1280x720');
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.waitForSelector('[data-overlay=settings]');
  await page.locator('[data-set=assist][data-v=off]').click();
  await page.getByRole('button', { name: 'Save and back to driving' }).click();
  await wait(host, () => [...document.querySelectorAll('.hud-tile [data-lplate]')].every((e) => e.hidden), undefined, 15_000);
  await shot(host, 'tv-lplate-off-1280x720');
  // The sim carries it: the seat's car has the level while it is on.
  assert.equal(await seatAssist(), 0);
});

test('WebKit: completion offers Driving help with both actions visible on short and upright phones', { timeout: 180_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const touchBrowser = await webkit.launch();
  try {
    const page = await (await touchBrowser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 667, height: 375 } })).newPage();
    await page.goto(await host.evaluate(() => window.__jjNet.joinUrl()));
    await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
    await page.getByRole('button', { name: 'Join the race' }).click();
    await confirmInitialVehicle(page);
    await wait(page, () => window.__jjTutorial?.inspect()?.open === true);
    for (const [width, height] of [[667, 375], [915, 412], [375, 667]]) {
      await resize(page, width, height);
      if (width < height) await page.getByRole('button', { name: 'Play upright anyway' }).click();
      await page.evaluate(() => window.__jjTutorial.show(6));
      await completionFits(page);
      await shot(page, `webkit-tutorial-driving-help-${width}x${height}`);
    }
    await page.getByRole('button', { name: 'Driving help', exact: true }).click();
    await page.waitForSelector('[data-overlay=settings] [data-set=assist]');
    await page.locator('[data-set=assist][data-v=lots]').click();
    assert.ok(await page.locator('[data-set=assist][data-v=lots]').evaluate((button) => {
      const r = button.getBoundingClientRect();
      return [r.top + 2, r.bottom - 2].every((y) => button.contains(document.elementFromPoint(r.left + r.width / 2, y)));
    }), 'the device tray cannot obscure the assist buttons');
    assert.ok(await page.locator('.assist-row').evaluate((row) => {
      const r = row.getBoundingClientRect();
      return row.contains(document.elementFromPoint(r.left + r.width / 2, r.bottom - 5));
    }), 'the whole assist row remains above the device tray');
    await shot(page, 'webkit-settings-assist-lots-375x667');
    await page.getByRole('button', { name: 'Save and back to driving' }).click();
    await wait(host, () => window.__jjRoom.view().seats[0].assist === 2);
  } finally {
    await touchBrowser.close();
  }
});
