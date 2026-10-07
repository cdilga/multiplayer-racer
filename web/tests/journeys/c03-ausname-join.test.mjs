// P1-C03 later: the Australian name button on the real join path (real host, real phone page, WebRTC: run on eris).
//   node --test web/tests/journeys/c03-ausname-join.test.mjs
// Both paths: the on-device model stubbed AVAILABLE (its reply is used) and UNAVAILABLE (the known-names sheet answers).
// The name is never changed without a tap, Undo puts the typed name back, the converted name is what the host seats, and
// the page makes no off-origin request. `JJ_CAPTURE_DIR` saves the visual self-review matrix.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/c03aus/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c03aus'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};

/** A host and a phone at the join card. `model` stubs `LanguageModel`: 'available' (replies "Davvo"), 'unavailable' or none. */
async function joinCard(model, size = { width: 390, height: 844 }) {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const page = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: size })).newPage();
  const outside = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(server.origin) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
  });
  if (model) {
    await page.addInitScript((m) => {
      window.__modelCalls = 0;
      window.LanguageModel = {
        availability: async () => m,
        create: async () => ({
          prompt: async () => {
            window.__modelCalls += 1;
            return 'Davvo';
          },
          destroy() {},
        }),
      };
    }, model);
  }
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  return { host, page, outside };
}

test('model unavailable: the known-names sheet answers; a tap is needed; Undo restores; the host seats the converted name', { timeout: 120_000 }, async () => {
  const { host, page, outside } = await joinCard('unavailable');
  await page.locator('#name').fill('David');
  await page.waitForTimeout(600);
  assert.equal(await page.inputValue('#name'), 'David', 'never changed without a tap');
  await shot(page, 'c03-aussie-join-card-390x844');
  await page.getByRole('button', { name: 'Make my name Australian' }).click();
  await page.locator('[data-note=aussie]').getByText('Davo').waitFor();
  assert.equal(await page.inputValue('#name'), 'Davo');
  assert.match(await page.locator('[data-note=aussie]').innerText(), /Davo instead of David/);
  await shot(page, 'c03-aussie-converted-390x844');
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.inputValue('#name'), 'David', 'one tap puts back what was typed');
  assert.equal(await page.locator('[data-note=aussie]').isHidden(), true);
  await page.getByRole('button', { name: 'Make my name Australian' }).click();
  await page.locator('[data-note=aussie]').getByText('Davo').waitFor();
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(host, () => window.__jjRoom.view().seats.some((s) => s.name === 'Davo'));
  assert.deepEqual(outside, [], 'no request beyond the page origin');
});

test('model available: its reply is used on-device, same validator, no network', { timeout: 120_000 }, async () => {
  const { page, outside } = await joinCard('available', { width: 844, height: 390 });
  await page.locator('#name').fill('David');
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__modelCalls), 0, 'the model is not asked until the tap');
  assert.equal(await page.inputValue('#name'), 'David');
  await page.getByRole('button', { name: 'Make my name Australian' }).click();
  await page.locator('[data-note=aussie]').getByText('Davvo').waitFor();
  assert.equal(await page.inputValue('#name'), 'Davvo');
  assert.equal(await page.evaluate(() => window.__modelCalls), 1);
  await shot(page, 'c03-aussie-converted-model-844x390');
  assert.deepEqual(outside, []);
});

test('a name with no Australian version is left alone and says so; the field stays editable', { timeout: 120_000 }, async () => {
  const { page } = await joinCard(undefined);
  await page.locator('#name').fill('Zoë');
  await page.getByRole('button', { name: 'Make my name Australian' }).click();
  await page.locator('[data-note=aussie]').getByText(/left as typed/).waitFor();
  assert.equal(await page.inputValue('#name'), 'Zoë');
  await shot(page, 'c03-aussie-nothing-to-change-390x844');
  await page.locator('#name').fill('Marlene');
  assert.equal(await page.inputValue('#name'), 'Marlene');
  if (CAPTURE) {
    for (const [w, h] of [[844, 390], [1920, 1080], [412, 915], [375, 667]]) {
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      await shot(page, `c03-aussie-join-card-${w}x${h}`);
    }
  }
});
