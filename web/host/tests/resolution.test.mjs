// P1-R (br-dim.3) browser tests: the host's Render resolution setting (R111) on the real web build in headless Chromium.
// Needs: npm --prefix web run build.   node --test web/host/tests/resolution.test.mjs
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
let browser;
let server;

before(async () => {
  browser = await chromium.launch();
  server = await serve(join(repo, 'web/dist'));
});
after(async () => {
  await browser?.close();
  server?.close();
});

/** Opens the setting the way a host does: from the status chip. */
const openSetting = async (page) => {
  if (!(await page.getByTestId('render-resolution-select').isVisible())) await page.getByTestId('render-chip').click();
};
const stats = (page) => page.evaluate(() => window.__jjRender.stats());
const BASE = '?synthetic=8&map&tiles=4&autores=injected';

async function open(query, { viewport = { width: 1280, height: 720 }, deviceScaleFactor = 1, page } = {}) {
  page ??= await browser.newPage({ viewport, deviceScaleFactor });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openHost(page, `${server.url}/host/${query}`);
  await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 3, null, { timeout: 20_000 });
  return { page, errors };
}
/** Frames the page has drawn since `n`, after a live change. */
const frames = (page, n) => page.waitForFunction((k) => window.__jjRender.stats().frames >= k, n, { timeout: 20_000 });

test('Native is the default, and the setting switches live (no reload), persists per host, and names its source', async () => {
  const { page, errors } = await open(BASE, { deviceScaleFactor: 2 });
  await page.evaluate(() => (window.__marker = 'same document'));
  let s = await stats(page);
  assert.equal(s.resolution, 'native');
  assert.equal([s.width, s.height].join('x'), '2560x1440');
  assert.match(await page.getByTestId('render-chip').innerText(), /2560×1440 native/);
  assert.equal(await page.getByTestId('render-resolution-select').inputValue(), '1');

  await openSetting(page);
  await page.getByTestId('render-resolution-select').selectOption('0.75');
  await frames(page, s.frames + 2);
  s = await stats(page);
  assert.equal(s.resolution, 'user');
  assert.equal([s.width, s.height].join('x'), '1920x1080');
  assert.match(await page.getByTestId('render-chip').innerText(), /1920×1080 user-lowered \(75 %\)/);
  assert.equal(await page.evaluate(() => window.__marker), 'same document', 'applied live, no reload');
  // The canvas element itself is the one resized (the backing store changed, the page did not).
  assert.equal(await page.evaluate(() => document.querySelector('canvas').width), 1920);

  await openSetting(page);
  await page.getByTestId('render-resolution-select').selectOption('0.5');
  await frames(page, s.frames + 2);
  assert.equal((await stats(page)).width, 1280);

  // Persisted per host: a fresh load of the same origin comes up at 50 %, and the select shows it.
  await open(BASE, { page, deviceScaleFactor: 2 });
  s = await stats(page);
  assert.equal(s.resolution, 'user');
  assert.equal(s.userScale, 0.5);
  assert.equal(await page.getByTestId('render-resolution-select').inputValue(), '0.5');

  // `?res=` is an override for tests: it wins over the saved choice (and is not saved).
  await open(`${BASE}&res=0.75`, { page, deviceScaleFactor: 2 });
  assert.equal((await stats(page)).scale, 0.75);
  await open(BASE, { page, deviceScaleFactor: 2 });
  assert.equal((await stats(page)).scale, 0.5, 'the override did not overwrite the saved choice');

  // Back to Native.
  await openSetting(page);
  await page.getByTestId('render-resolution-select').selectOption('1');
  await frames(page, (await stats(page)).frames + 2);
  assert.equal((await stats(page)).resolution, 'native');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the setting works without localStorage (blocked storage): no throw, default Native, live switch still applies', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const { errors } = await open(BASE, { page });
  assert.equal((await stats(page)).resolution, 'native');
  await openSetting(page);
  await page.getByTestId('render-resolution-select').selectOption('0.75');
  await frames(page, (await stats(page)).frames + 2);
  assert.equal((await stats(page)).resolution, 'user');
  assert.deepEqual(errors, []);
  await page.close();
});

const inject = (page, ms, seconds) => page.evaluate(([m, sec]) => window.__jjRender.injectFrameTimes(m, sec), [ms, seconds]);

test('auto-lowering happens only after a measured frame-budget miss, one step at a time, named, and is never raised again', async () => {
  const { page, errors } = await open(BASE);
  let s = await stats(page);
  assert.equal(s.resolution, 'native');
  // Many good seconds: nothing happens (tile/player count never lowers anything).
  await inject(page, 20, 30);
  s = await stats(page);
  assert.equal(s.resolution, 'native');
  assert.equal(s.autoEvents.length, 0);
  // Four slow seconds are not a sustained miss (budget: 5 in a row)...
  await inject(page, 100, 4);
  assert.equal((await stats(page)).resolution, 'native');
  // ...a good second resets the run...
  await inject(page, 20, 2);
  await inject(page, 100, 4);
  assert.equal((await stats(page)).resolution, 'native');
  // ...and five in a row lowers exactly one step, and says so.
  await inject(page, 100, 2);
  s = await stats(page);
  assert.equal(s.resolution, 'auto');
  assert.equal(s.scale, 0.75);
  assert.equal(s.userScale, 1, 'the host’s choice is still Native');
  assert.equal(s.autoEvents.length, 1);
  assert.equal(s.autoEvents[0].from, 1);
  assert.equal(s.autoEvents[0].to, 0.75);
  assert.ok(s.autoEvents[0].p95Ms >= 100);
  assert.equal(s.width, Math.round(1280 * 0.75));
  const chip = await page.getByTestId('render-chip').innerText();
  assert.match(chip, /auto-lowered to 75 %/);
  assert.match(chip, /frame budget missed/);
  // Fast frames afterwards never raise it back.
  await inject(page, 10, 60);
  assert.equal((await stats(page)).scale, 0.75);
  // A second sustained miss goes one more step, then stops at the lowest step.
  await inject(page, 100, 6);
  assert.equal((await stats(page)).scale, 0.5);
  await inject(page, 100, 30);
  s = await stats(page);
  assert.equal(s.scale, 0.5);
  assert.equal(s.autoEvents.length, 2);
  // Choosing a setting is the host's call and resets the automatic step.
  await page.evaluate(() => window.__jjRender.setResolution(1));
  s = await stats(page);
  assert.equal(s.resolution, 'native');
  assert.equal(s.autoEvents.length, 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a user-chosen lower setting is honoured: never raised by good frames, and an auto step goes below it, never above', async () => {
  const { page } = await open(`${BASE}`);
  await page.evaluate(() => window.__jjRender.setResolution(0.75));
  await inject(page, 5, 120);
  let s = await stats(page);
  assert.equal(s.scale, 0.75);
  assert.equal(s.resolution, 'user');
  await inject(page, 100, 5);
  s = await stats(page);
  assert.equal(s.resolution, 'auto');
  assert.equal(s.scale, 0.5);
  assert.equal(s.userScale, 0.75);
  assert.ok(s.scale < s.userScale);
  // At the user's 50 % there is nowhere lower to go: slow frames change nothing.
  await page.evaluate(() => window.__jjRender.setResolution(0.5));
  await inject(page, 125, 40);
  s = await stats(page);
  assert.equal(s.scale, 0.5);
  assert.equal(s.resolution, 'user');
  assert.equal(s.autoEvents.length, 0);
  await page.close();
});

test('`?res=` and `?autores=off` switch automatic lowering off (tests and receipts stay at what they asked for)', async () => {
  for (const q of [`${BASE}&res=1`, '?synthetic=8&map&tiles=4&autores=off']) {
    const { page } = await open(q);
    await page.evaluate(() => window.__jjRender.injectFrameTimes(200, 30));
    assert.equal((await stats(page)).autoEvents.length, 0, q);
    await page.close();
  }
});

test('a browser limit that stops native is surfaced: the chip says capped and states what was used', async () => {
  const { page, errors } = await open(`${BASE}&maxcanvas=1000`, { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  const s = await stats(page);
  assert.equal(s.nativeWidth, 2560);
  assert.equal(s.nativeHeight, 1440);
  assert.equal(s.width, 1000);
  assert.equal(s.height, 562);
  assert.match(s.limitedBy, /browser max size 1000px/);
  const chip = await page.getByTestId('render-chip').innerText();
  assert.match(chip, /1000×562 capped by browser/);
  assert.match(chip, /native would be 2560×1440/);
  assert.equal(await page.getByTestId('render-chip').getAttribute('data-source'), 'capped');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the setting opens from the status chip, is keyboard reachable, and with it closed no control covers a tile', async () => {
  const { page } = await open(BASE);
  const select = page.getByTestId('render-resolution-select');
  assert.equal(await select.isVisible(), false, 'closed by default');
  assert.equal(await page.getByTestId('render-resolution').isVisible(), false);
  // Closed: the popover has no box at all, so it cannot overlap any tile rect.
  assert.equal(await page.getByTestId('render-resolution').boundingBox(), null);
  // Keyboard: Tab reaches the chip, Enter opens and focuses the select, Escape closes and returns to the chip.
  await page.getByTestId('render-chip').focus();
  await page.keyboard.press('Enter');
  assert.equal(await select.isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'render-resolution-select');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await select.isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), 'render-chip');
  // Click-away closes.
  await page.getByTestId('render-chip').click();
  assert.equal(await select.isVisible(), true);
  await page.mouse.click(300, 300);
  assert.equal(await select.isVisible(), false);
  // Open, it is placed above the chip; the closed state leaves only the chip, which is the pre-existing status line.
  await page.getByTestId('render-chip').click();
  const box = await page.getByTestId('render-resolution').boundingBox();
  const chipBox = await page.getByTestId('render-chip').boundingBox();
  assert.ok(box.y + box.height <= chipBox.y + 1, 'popover sits above the chip');
  await page.close();
});
