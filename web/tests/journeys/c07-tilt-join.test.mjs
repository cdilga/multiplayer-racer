// P1-C07.2 tilt steering through the real join path (real host in free drive, real phone page, WebRTC: run on eris).
//   node --test web/tests/journeys/c07-tilt-join.test.mjs
// Off by default; turned on in Settings; Set neutral; a turn of the phone steers THE HOST'S car for that seat through the
// normal compact input path (read back from the sim's applied input), measured input age; nothing boosts (R60); it persists
// across a reload; turning it off stops it. Sensor readings are dispatched `devicemotion` events (no real accelerometer).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/c07tilt/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c07tilt'), BASE, { JJ_STUN_URLS: '' });
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

/** Dispatches a devicemotion reading for a clockwise turn of `deg` degrees, in this page's screen orientation (Android sign). */
const tilt = (page, deg) =>
  page.evaluate((deg) => {
    const r = (deg * Math.PI) / 180;
    const [sx, sy] = [-Math.sin(r) * 9.8, Math.cos(r) * 9.8];
    const a = (((screen.orientation?.angle ?? 0) % 360) + 360) % 360;
    const [x, y] = { 0: [sx, sy], 90: [sy, -sx], 180: [-sx, -sy], 270: [-sy, sx] }[a];
    window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x, y, z: 0 } }));
  }, deg);

async function seated() {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?drive&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjTest, undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const page = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })).newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  const endpoint = (await page.evaluate(() => window.__jjController.inspect())).link.endpointId;
  /** The host's applied input and boost for this seat's car, and the seat's input age. */
  const seen = () =>
    host.evaluate(async (ep) => {
      const o = await window.__jjTest.observe();
      const seat = o.host.seats.find((s) => s.endpoint === ep);
      const car = o.cars.find((c) => c.car === seat?.car);
      return { steer: car?.input.steer, throttle: car?.input.throttle, boosting: car?.action.boosting, age: seat?.inputAgeMs };
    }, endpoint);
  return { host, page, joinUrl, seen };
}

const openSettings = async (page) => {
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.waitForSelector('[data-overlay=settings]');
};
const prefs = (page) => page.evaluate(() => window.__jjSettings.inspect().prefs);

test('tilt steering: off by default, opt-in, steers the host car through the normal path, persists, stops when off; no boost', { timeout: 240_000 }, async () => {
  const { page, joinUrl, seen } = await seated();
  assert.equal((await prefs(page)).tilt, false, 'off by default');
  // Readings before opting in do nothing.
  await tilt(page, 40);
  await page.waitForTimeout(500);
  assert.ok(Math.abs((await seen()).steer ?? 0) < 0.05, 'a phone that is turned but not opted in does not steer');

  await openSettings(page);
  await shot(page, 'c07-tilt-settings-off-844x390');
  await page.locator('[data-toggle=tilt]').scrollIntoViewIfNeeded();
  await page.locator('[data-toggle=tilt]').click();
  await tilt(page, 0);
  await page.locator('[data-act=tilt-neutral]').waitFor();
  await page.locator('[data-act=tilt-neutral]').scrollIntoViewIfNeeded();
  await page.locator('[data-act=tilt-neutral]').click();
  await page.locator('[data-note=tilt]').getByText('Straight ahead set').waitFor();
  assert.equal((await prefs(page)).tilt, true);
  await shot(page, 'c07-tilt-settings-on-844x390');
  // Settings open: the sheet holds the car neutral even while the phone is turned.
  await tilt(page, 40);
  await page.waitForTimeout(400);
  assert.ok(Math.abs((await seen()).steer ?? 0) < 0.05, 'neutral while Settings is open');
  await page.getByRole('button', { name: 'Save and back to driving' }).click();

  // Which sign the host gives a stick pushed right: a clockwise turn of the phone must match it.
  await page.evaluate(() => window.__jjController.setSticks({ x: 1, y: 0, touch: true }, { x: 0, y: 0, touch: false }));
  let rightSign = 0;
  for (const t0 = Date.now(); Math.abs((await seen()).steer ?? 0) < 0.8; await page.waitForTimeout(150)) assert.ok(Date.now() - t0 < 15_000, 'the host never saw the stick');
  rightSign = Math.sign((await seen()).steer);
  await page.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
  for (const t0 = Date.now(); Math.abs((await seen()).steer ?? 0) > 0.1; await page.waitForTimeout(150)) assert.ok(Date.now() - t0 < 15_000, 'the stick never let go');

  // Driving: turn right, left and back; the host's applied steer follows, with its input age.
  const before = await page.evaluate(() => window.__jjController.inspect().stats.actions);
  const ages = [];
  for (const [deg, turn] of [[40, rightSign], [-40, -rightSign], [0, 0]]) {
    const sign = turn;
    await tilt(page, deg);
    let s;
    for (const t0 = Date.now(); ; ) {
      await page.waitForTimeout(150);
      await tilt(page, deg); // sensors repeat
      s = await seen();
      if (sign === 0 ? Math.abs(s.steer) < 0.1 : Math.sign(s.steer) === Math.sign(sign) && Math.abs(s.steer) > 0.8) break;
      assert.ok(Date.now() - t0 < 20_000, `the host never applied steer ${sign} (saw ${JSON.stringify(s)})`);
    }
    if (sign !== 0) ages.push(s.age);
    assert.equal(s.boosting, false, 'no boost from tilt');
  }
  // Input age while tilting, sampled.
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await tilt(page, 30);
    await page.waitForTimeout(60);
    samples.push((await seen()).age);
  }
  const sorted = samples.filter((a) => typeof a === 'number').sort((a, b) => a - b);
  console.log(`# tilt input age at the host (ms): p50 ${sorted[Math.floor(sorted.length / 2)]} p95 ${sorted[Math.floor(sorted.length * 0.95)]} max ${sorted.at(-1)} (n=${sorted.length}; sampling adds up to its own interval)`);
  assert.ok(sorted.length > 0 && sorted[Math.floor(sorted.length / 2)] < 400, 'the input is fresh at the host');
  assert.equal((await page.evaluate(() => window.__jjController.inspect().stats.actions)) - before, 0, 'tilt fired no action (no boost, flick or wheelie)');

  // Reload: the setting and its neutral persist, and the sensor comes back on without a tap (Android-style).
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'playing');
  const p = await prefs(page);
  assert.deepEqual([p.tilt, p.tiltSensitivity, p.tiltDeadzone], [true, 'normal', 'medium']);
  await tilt(page, 40);
  for (const t0 = Date.now(); Math.abs((await seen()).steer ?? 0) < 0.8; await tilt(page, 40)) {
    assert.ok(Date.now() - t0 < 20_000, 'tilt steers again after a reload');
    await page.waitForTimeout(150);
  }

  // Off again: the readings stop steering.
  await openSettings(page);
  await page.locator('[data-toggle=tilt]').scrollIntoViewIfNeeded();
  await page.locator('[data-toggle=tilt]').click();
  await wait(page, () => window.__jjSettings.inspect().prefs.tilt === false);
  await page.getByRole('button', { name: 'Save and back to driving' }).click();
  await tilt(page, -40);
  await page.waitForTimeout(600);
  assert.ok(Math.abs((await seen()).steer ?? 0) < 0.1, 'off stops it');
});

test('a device with no motion sensor says so and stays off', { timeout: 120_000 }, async () => {
  const { page } = await seated();
  await openSettings(page);
  await page.locator('[data-toggle=tilt]').scrollIntoViewIfNeeded();
  await page.locator('[data-toggle=tilt]').click(); // no devicemotion event is ever sent
  await page.locator('[data-note=tilt]').getByText(/no motion sensor/).waitFor({ timeout: 10_000 });
  assert.equal((await prefs(page)).tilt, false);
  await shot(page, 'c07-tilt-no-sensor-844x390');
  if (CAPTURE) {
    await page.locator('[data-note=tilt]').scrollIntoViewIfNeeded();
    for (const [w, h] of [[390, 844], [1920, 1080]]) {
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      await shot(page, `c07-tilt-no-sensor-${w}x${h}`);
    }
  }
});
