// P1-R06 AC "Identify from ... the phone's menu": the Help card (the phone's menu, C06) carries an Identify button that
// sends the same Identify as the tools row; the host's event log lists it for that seat. A keyboard cluster's Identify
// key (Q for keys A) in a running race also lists an Identify event and pulses that seat's tile (`__jjRoom.identified()`).
//   node --test web/tests/journeys/c06-identify-menu.test.mjs   (WebRTC: run on eris; the race part wants JJ_CHROMIUM_GPU=1)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/c06id/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c06id'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const identifies = (host) => host.evaluate(() => window.__jjRoom.events().filter((e) => e.event?.Identify).map((e) => e.event.Identify.seat));

test("the phone's menu (Help card) has an Identify that the host receives for that seat", { timeout: 120_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const page = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })).newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(host, () => window.__jjRoom.view().seats.length === 1);
  const seat = await host.evaluate(() => window.__jjRoom.view().seats[0].seat);
  // The tutorial card opens for a newcomer; its top bar carries Identify beside Skip. Past the seat reducer's 3 s limit
  // from the join flash, so the press is its own event.
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.waitForTimeout(3300);
  const before = (await identifies(host)).length;
  await page.locator('[data-act=menu-identify]').click();
  await wait(host, (n) => window.__jjRoom.events().filter((e) => e.event?.Identify).length > n, before, 10_000);
  assert.equal((await identifies(host)).at(-1), seat, 'the menu Identify reaches the host for this seat');
  // Help re-opens the same menu after the tutorial is closed.
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await page.getByRole('button', { name: /^Help/ }).click();
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.waitForTimeout(3300);
  const again = (await identifies(host)).length;
  await page.locator('[data-act=menu-identify]').click();
  await wait(host, (n) => window.__jjRoom.events().filter((e) => e.event?.Identify).length > n, again, 10_000);
});

test("keys A's Identify key (Q) in a race sends an Identify event and pulses that seat's tile", { timeout: 180_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  await host.bringToFront();
  await host.keyboard.down('KeyW');
  await wait(host, () => window.__jjRoom.view().seats.length === 1);
  await host.keyboard.up('KeyW');
  const seat = await host.evaluate(() => window.__jjRoom.view().seats[0].seat);
  await host.keyboard.press('KeyE', { delay: 250 }); // keys are sampled per frame: hold READY
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase), undefined, 60_000);
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 60_000);
  await host.waitForTimeout(3300);
  const events = (await identifies(host)).length;
  const pulses = await host.evaluate(() => window.__jjRoom.identified().length);
  await host.keyboard.down('KeyQ');
  await host.waitForTimeout(150);
  await host.keyboard.up('KeyQ');
  await wait(host, (n) => window.__jjRoom.identified().length > n, pulses, 10_000);
  assert.equal((await identifies(host)).length, events + 1, 'one Identify event');
  assert.equal((await identifies(host)).at(-1), seat);
  assert.equal((await host.evaluate(() => window.__jjRoom.identified())).at(-1).seat, seat, 'that seat pulsed');
});
