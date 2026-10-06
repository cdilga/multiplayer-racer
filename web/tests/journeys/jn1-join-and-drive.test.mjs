// Journey JN1 (P1-G04): free drive on the greybox. The real host page (`B/host?drive&test=live`) and real controller
// pages from one build, served by the real jj-server, over loopback WebRTC in Chromium. One phone joins by the QR the
// host shows (decoded from the screen), one by typing the code on the landing page; both claim, get a seat and a car,
// and each stick moves only its own car; a key cluster drives beside them; a phone joining mid-drive gets a car and a
// tile without disturbing the others; a reloaded phone comes back to the same car.
//   node --test web/tests/journeys/
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';

const BASE = '/p/jn1/';
let browser;
let server;

before(async () => {
  const dist = build('./', 'jn1');
  server = await serve(dist, BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = async (page, fn, arg, ms = 20_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

async function phone() {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

async function joinAndClaim(p, url, name) {
  if (url) await p.page.goto(url);
  await wait(p.page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await p.page.locator('#name').fill(name);
  await p.page.getByRole('button', { name: 'Join the race' }).click();
  await wait(p.page, () => window.__jjController.inspect().phase === 'playing');
  return p.page.evaluate(() => window.__jjController.inspect());
}

const observe = (host) => host.evaluate(() => window.__jjTest.observe());
const carOf = (state, endpoint) => {
  const seat = state.host.seats.find((s) => s.endpoint === endpoint);
  return seat && state.cars.find((c) => c.car === seat.car);
};

async function driveTicks(host, ticks) {
  const start = await observe(host);
  let now = start;
  for (const t0 = Date.now(); now.tick - start.tick < ticks; now = await observe(host)) {
    assert.ok(Date.now() - t0 < 60_000, `sim reached ${now.tick}, not ${start.tick + ticks}`);
    await host.waitForTimeout(100);
  }
  return { start, now };
}

const turn = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

test('JN1: phones join by QR and by code, claim, and each drives its own car; keys beside them; a late phone joins; reload resumes', { timeout: 300_000 }, async () => {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostCtx.newPage();
  const hostErrors = [];
  host.on('pageerror', (e) => hostErrors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?drive&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjTest, undefined, 60_000);
  const code = await host.evaluate(() => window.__jjNet.code());
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  assert.match(code, /^[A-Z2-9]{4}$/);

  // Phone A: the QR on the TV, decoded from a screenshot of it.
  await wait(host, () => document.querySelector('.jj-qr svg'), undefined, 30_000);
  const png = PNG.sync.read(await host.locator('.jj-qr svg').first().screenshot());
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded?.data, joinUrl, 'the QR carries the join URL');
  const a = await phone();
  const youA = await joinAndClaim(a, decoded.data, 'Davo');

  // Phone B: types the code on the landing page.
  const b = await phone();
  await b.page.goto(`${server.origin}${BASE}`);
  await b.page.locator('#code').pressSequentially(code.toLowerCase());
  await b.page.getByRole('button', { name: 'Join a room' }).click();
  const youB = await joinAndClaim(b, null, 'Shazza');
  assert.notEqual(youA.you.number, youB.you.number);

  // A key cluster on the host (P1-C05) drives beside them.
  await host.keyboard.down('KeyW');
  for (const t0 = Date.now(); (await observe(host)).host.seats.length < 3; await host.waitForTimeout(100)) {
    assert.ok(Date.now() - t0 < 15_000, 'the key cluster never got a seat');
  }

  // A drives straight on, B drives and steers right.
  const epA = youA.link.endpointId;
  const epB = youB.link.endpointId;
  const hold = (p, d) => p.page.evaluate((d) => window.__jjController.setSticks({ ...d, touch: true }, { x: 0, y: 0, touch: false }), d);
  await hold(a, { x: 0, y: -1 });
  await hold(b, { x: 0.9, y: -0.8 });
  const { start, now } = await driveTicks(host, 300);
  const resA = { speed: carOf(now, epA).forwardSpeed, turn: turn(carOf(now, epA).headingDeg, carOf(start, epA).headingDeg) };
  const resB = { speed: carOf(now, epB).forwardSpeed, turn: turn(carOf(now, epB).headingDeg, carOf(start, epB).headingDeg) };
  console.log(`# A ${JSON.stringify(resA)} B ${JSON.stringify(resB)}`);
  assert.ok(carOf(now, epA).car !== carOf(now, epB).car, 'two cars');
  assert.ok(resA.speed > 4 && resA.turn < 10, `A drives straight: ${JSON.stringify(resA)}`);
  assert.ok(resB.speed > 2 && resB.turn > 15, `B turns: ${JSON.stringify(resB)}`);
  const keys = carOf(now, 'local:1');
  assert.ok(keys && keys.forwardSpeed > 4, 'the key cluster drives too');

  // Each seat has its own tile.
  const tiles = await host.evaluate(() => window.__jjRender.tileRects().length);
  assert.equal(tiles, 3);

  // A fourth seat (phone C) joins mid-drive: a car and a tile, the others keep going.
  const c = await phone();
  const youC = await joinAndClaim(c, joinUrl, 'Robbo');
  const after1 = await driveTicks(host, 120);
  assert.equal(after1.now.host.seats.length, 4);
  assert.ok(carOf(after1.now, youC.link.endpointId), 'C has a car');
  assert.ok(carOf(after1.now, epA).forwardSpeed > 4, 'A undisturbed');
  await wait(host, () => window.__jjRender.tileRects().length === 4);

  // Reloading A comes back to the same seat and car.
  const carA = carOf(after1.now, epA).car;
  await a.page.reload();
  await wait(a.page, () => window.__jjController?.inspect().phase === 'playing', undefined, 30_000);
  const again = await a.page.evaluate(() => window.__jjController.inspect());
  assert.equal(again.you.number, youA.you.number, 'same number after reload');
  assert.equal(again.link.endpointId, epA, 'same endpoint');
  assert.equal(carOf(await observe(host), epA).car, carA, 'same car');

  assert.deepEqual([hostErrors, a.errors, b.errors, c.errors], [[], [], [], []]);
  for (const x of [a, b, c]) await x.ctx.close();
  await hostCtx.close();
});
