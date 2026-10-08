// P1-C02, the wire half: what the sticks put on the wire arrives at the host as DRIVE/ACTION semantics (jj-input), read
// from the sim's applied input for that seat's car. Real host in free drive, real phone page, WebRTC: run on eris.
//   node --test web/tests/journeys/c02-wire.test.mjs
// DRIVE: up = throttle, down = brake/reverse, left/right = steer (the sim turns a push to the right into negative steer).
// ACTION: right = boost, left = drift; the two sticks never leak into each other. Identify goes out from the tools row.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/c02wire/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c02wire'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

test('R116: the left stick drives, drifts and launches, the right stick steers: each independent of the other', { timeout: 240_000 }, async () => {
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
  const seen = () =>
    host.evaluate(async (ep) => {
      const o = await window.__jjTest.observe();
      const seat = o.host.seats.find((s) => s.endpoint === ep);
      const car = o.cars.find((c) => c.car === seat?.car);
      return { ...car?.input, action: car?.action, autopilot: car?.autopilot != null };
    }, endpoint);
  const set = (drive, action) => page.evaluate(([d, a]) => window.__jjController.setSticks({ ...d, touch: d.x !== 0 || d.y !== 0 }, { ...a, touch: a.x !== 0 || a.y !== 0 }), [drive, action]);
  const until = async (what, ok, ms = 25_000) => {
    let s;
    for (const t0 = Date.now(); ; await host.waitForTimeout(150)) {
      s = await seen();
      if (!s.autopilot && ok(s)) return s;
      assert.ok(Date.now() - t0 < ms, `${what}: the host saw ${JSON.stringify(s)}`);
    }
  };
  const still = { x: 0, y: 0 };

  // Which sign the sim gives a push to the right: the RIGHT stick steers (R116).
  await set(still, { x: 1, y: 0 });
  const right = Math.sign((await until('steer right', (s) => Math.abs(s.steer) > 0.8)).steer);
  await set(still, { x: -1, y: 0 });
  await until('steer left', (s) => Math.sign(s.steer) === -right && Math.abs(s.steer) > 0.8);
  // The left stick's x is not steering.
  await set({ x: 0.4, y: -0.9 }, still);
  const lean = await until('throttle', (s) => s.throttle > 0.7);
  assert.ok(Math.abs(lean.steer) < 0.1, `a thumb lean on the left stick does not steer: ${JSON.stringify(lean)}`);
  // LEFT up: throttle, nothing else (no boost at the rim: the boost is the launch).
  await set({ x: 0, y: -1 }, still);
  const up = await until('throttle', (s) => s.throttle > 0.8);
  assert.ok(Math.abs(up.steer) < 0.1 && up.brake < 0.1 && !up.action.boosting, `up is throttle only: ${JSON.stringify(up)}`);
  // LEFT down: brake or reverse, no throttle.
  await set({ x: 0, y: 1 }, still);
  const down = await until('brake', (s) => s.brake > 0.5 || s.throttle < -0.5);
  assert.ok(!(down.throttle > 0.1), `down is not throttle: ${JSON.stringify(down)}`);
  // A fresh, timed pull: held 500 ms (past the 350 ms the lift wants, well short of the 900 ms after which it reads as reverse, which the
  // checks above could not promise on a slow runner), then the snap.
  await set(still, still);
  await set({ x: 0, y: 1 }, still);
  await host.waitForTimeout(500);
  // The launch is the boost (R116): the brake held a moment, then the stick snapped to full forward: the front lifts (a wheelie).
  // Full throttle and full lock together come with it, on different sticks.
  await set({ x: 0, y: -1 }, { x: 1, y: 0 });
  await until('the launch', (s) => s.action.wheelie === true, 15_000);
  const both = await until('throttle and lock', (s) => s.throttle > 0.8 && Math.abs(s.steer) > 0.8);
  assert.ok(!both.action.boosting && !both.action.drift, `full throttle with full lock is neither drift nor boost: ${JSON.stringify(both)}`);
  // LEFT sideways: the drift, at the stick's magnitude of throttle, and the right stick still steers on its own.
  await set({ x: 1, y: -0.3 }, still);
  const drift = await until('drift', (s) => s.action.drift > 0.5 || s.action.drifting === true, 30_000);
  assert.ok(drift.throttle > 0.9, `a drift at the rim keeps full throttle: ${JSON.stringify(drift)}`);
  assert.ok(Math.abs(drift.steer) < 0.1, `the left stick's drift side does not steer: ${JSON.stringify(drift)}`);
  await set(still, still);
  await until('neutral', (s) => Math.abs(s.steer) < 0.05 && s.throttle < 0.05 && s.brake < 0.05);
});
