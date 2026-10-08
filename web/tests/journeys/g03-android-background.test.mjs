// P1-G03 JN6 "also a backgrounded emulator phone": a real Android Chrome (the emulator on eris, KVM) joins a race as a
// player, drives, and is backgrounded with adb (Home). Its page stops sending drive state, so within a few seconds its car
// goes to the autopilot and the room never pauses; brought back to the front, the player's first deliberate input takes the
// same car back. Skips where the lane isn't available (reported by the preflight, never claimed).
//   node --test web/tests/journeys/g03-android-background.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { androidController } from './harness/emulators.mjs';
import { preflight } from './harness/lanes.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/g03bg/';
const lane = (await preflight()).lanes.find((l) => l.id === 'android-emulator');
let browser;
let server;
let phone;

before(async () => {
  if (!lane.available) return;
  server = await serve(build('./', 'g03bg'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await phone?.close();
  await browser?.close();
  await server?.close();
});

const observe = (host) => host.evaluate(() => window.__jjTest.observe());
const carOf = (state, ep) => {
  const seat = state.host.seats.find((s) => s.endpoint === ep);
  return seat && state.cars.find((c) => c.car === seat.car);
};

test('JN6 emulator: a backgrounded Android phone goes to the autopilot, the room never pauses, and it takes the car back', { skip: lane.available ? false : lane.reason, timeout: 600_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=3`);
  await host.waitForFunction(() => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, { timeout: 90_000 });
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  phone = await androidController({ port: Number(new URL(server.origin).port) });
  const ep = await phone.joinRace(joinUrl, 'Droid');
  await phone.page.getByRole('button', { name: /^Ready/ }).click();
  await host.waitForFunction(() => window.__jjRoom.view().phase === 'Running', undefined, { timeout: 120_000, polling: 100 });
  const drive = (y) => phone.page.evaluate((y) => window.__jjController.setSticks({ x: 0, y, touch: y !== 0 }, { x: 0, y: 0, touch: false }), y);
  await drive(-1);
  await host.waitForTimeout(2000);
  const before = carOf(await observe(host), ep);
  assert.ok(before && !before.autopilot, 'the phone drives its own car');

  phone.background();
  const t0 = Date.now();
  for (;;) {
    if (carOf(await observe(host), ep)?.autopilot) break;
    assert.ok(Date.now() - t0 < 15_000, 'the autopilot took over a backgrounded phone');
    await host.waitForTimeout(200);
  }
  console.log(`# backgrounded emulator phone: autopilot after ${Date.now() - t0} ms`);
  assert.equal(await host.evaluate(() => window.__jjRoom.view().phase), 'Running', 'the room never pauses');

  phone.foreground();
  await phone.page.waitForFunction(() => document.visibilityState === 'visible', undefined, { timeout: 30_000 });
  await drive(-1);
  for (const t1 = Date.now(); carOf(await observe(host), ep)?.autopilot; await host.waitForTimeout(200)) {
    assert.ok(Date.now() - t1 < 20_000, 'a deliberate input took the car back');
  }
  assert.equal(carOf(await observe(host), ep).car, before.car, 'the same car');
});
