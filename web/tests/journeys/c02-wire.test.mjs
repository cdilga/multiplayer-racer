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

test('the sticks arrive as DRIVE and ACTION: throttle, brake, steer, boost and drift, each independent of the other stick', { timeout: 240_000 }, async () => {
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

  // Which sign the sim gives a push to the right.
  await set({ x: 1, y: 0 }, still);
  const right = Math.sign((await until('steer right', (s) => Math.abs(s.steer) > 0.8)).steer);
  await set({ x: -1, y: 0 }, still);
  await until('steer left', (s) => Math.sign(s.steer) === -right && Math.abs(s.steer) > 0.8);
  // DRIVE up: throttle, nothing else.
  await set({ x: 0, y: -1 }, still);
  const up = await until('throttle', (s) => s.throttle > 0.8);
  assert.ok(Math.abs(up.steer) < 0.1 && up.brake < 0.1, `up is throttle only: ${JSON.stringify(up)}`);
  // DRIVE down: brake or reverse, no throttle.
  await set({ x: 0, y: 1 }, still);
  const down = await until('brake', (s) => s.brake > 0.5 || s.throttle < -0.5);
  assert.ok(!(down.throttle > 0.1), `down is not throttle: ${JSON.stringify(down)}`);
  // ACTION right: boost asked for, and it leaves DRIVE alone (steer stays 0, throttle stays what DRIVE says).
  const meter0 = (await seen()).action.boost;
  await set({ x: 0, y: -1 }, { x: 1, y: 0 });
  const boost = await until('boost', (s) => s.throttle > 0.8 && (s.action.boosting === true || s.action.boost < meter0 - 0.02), 30_000);
  assert.ok(Math.abs(boost.steer) < 0.1 && boost.throttle > 0.8, `the action stick does not steer or lift the throttle: ${JSON.stringify(boost)}`);
  // ACTION left: drift (when the car is moving fast enough to), and again no leak into steer.
  await set({ x: 0, y: -1 }, { x: -1, y: 0 });
  const drift = await until('drift', (s) => s.throttle > 0.8 && (s.action.drift > 0 || s.action.drifting === true), 20_000).catch(() => null);
  const steady = await until('drive holds', (s) => s.throttle > 0.8);
  assert.ok(Math.abs(steady.steer) < 0.1, `the action stick's drift side does not steer: ${JSON.stringify(steady)}`);
  if (drift) console.log('# drift seen at the host');
  await set(still, still);
  await until('neutral', (s) => Math.abs(s.steer) < 0.05 && s.throttle < 0.05 && s.brake < 0.05);
});
