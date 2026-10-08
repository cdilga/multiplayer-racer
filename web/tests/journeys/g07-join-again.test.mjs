// P1-G07, the controller's side: a connected phone is removed by the host mid-race and shows "The host removed you" with
// Join again; Join again is a fresh claim (a new number, never the old one), and the removed seat's tile is gone from the TV.
//   node --test web/tests/journeys/g07-join-again.test.mjs   (WebRTC: run on eris; JJ_CAPTURE_DIR saves the screens)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/g07j/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'g07j'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });

async function phone(joinUrl, size) {
  const page = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: size })).newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  return page;
}

test('G07: a connected player removed mid-race sees "The host removed you" and Join again is a fresh claim', { timeout: 240_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const a = await phone(joinUrl, { width: 844, height: 390 });
  const b = await phone(joinUrl, { width: 844, height: 390 });
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  await a.getByRole('button', { name: 'Skip tutorial' }).click();
  await b.getByRole('button', { name: 'Skip tutorial' }).click();
  await a.locator('[data-act=ready]').click();
  await b.locator('[data-act=ready]').click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  const before = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => s.number));
  const numberB = await b.evaluate(() => window.__jjController.inspect().you.number);
  const seatB = await host.evaluate((n) => window.__jjRoom.view().seats.find((s) => s.number === n).seat, numberB);
  await host.evaluate((seat) => window.__jjTest.input({ type: 'ui', ui: `remove-seat:${seat}` }), seatB);
  // The host's room loses the seat at a tick boundary; the others race on.
  await wait(host, (n) => !window.__jjRoom.view().seats.some((s) => s.number === n), numberB, 15_000);
  assert.equal(await host.evaluate(() => window.__jjRoom.view().phase), 'Running');
  assert.equal(await host.evaluate(() => window.__jjRoom.view().seats.length), before.length - 1);
  // The phone says so, with Join again.
  await b.locator('[data-note=removed]').waitFor({ timeout: 15_000 });
  assert.match(await b.locator('[data-note=removed]').innerText(), /The host removed you/);
  await shot(b, 'phone-removed-landscape-844x390');
  await b.setViewportSize({ width: 390, height: 844 });
  await shot(b, 'phone-removed-portrait-390x844');
  await b.setViewportSize({ width: 640, height: 300 });
  await shot(b, 'phone-removed-short-640x300');
  await b.setViewportSize({ width: 844, height: 390 });
  const join = b.getByRole('button', { name: 'Join again' });
  assert.equal(await join.count(), 1);
  // Join again is a fresh claim: a new seat and number, never the old one.
  await join.click();
  await wait(b, () => window.__jjController.inspect().phase === 'playing');
  const numberB2 = await b.evaluate(() => window.__jjController.inspect().you.number);
  assert.notEqual(numberB2, numberB, 'a new number');
  await wait(host, (n) => window.__jjRoom.view().seats.some((s) => s.number === n), numberB2, 15_000);
  await shot(host, 'tv-after-join-again-1280x720');
});
