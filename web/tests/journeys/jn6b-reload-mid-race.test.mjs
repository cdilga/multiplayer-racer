import { confirmInitialVehicle } from './lib/vehicle.mjs';
// JN6b (council review round 3): a phone reloaded mid-race is back driving its own seat within a few seconds, on the real
// pages over loopback WebRTC through the real jj-server. The reloaded page keeps its endpoint identity (and so its seat)
// and negotiates a fresh peer connection while the host's old one for it still reads `connected`.
//   cd web && node --test tests/journeys/jn6b-reload-mid-race.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { until } from './lib/until.mjs';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/jn6b/';
let browser;
let dist;

before(async () => {
  dist = build('./', 'jn6b');
  browser = await chromium.launch({ args: chromiumArgs });
});
after(() => browser?.close());
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });

async function phone(url, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(page);
  if (await page.locator('[data-overlay=coach]').isVisible()) await page.getByRole('button', { name: 'Skip tutorial' }).click();
  return { ctx, page, ep: (await page.evaluate(() => window.__jjController.inspect())).link.endpointId };
}

const drive = (page, y) => page.evaluate((y) => window.__jjController.setSticks({ x: 0, y, touch: y !== 0 }, { x: 0, y: 0, touch: false }), y);

/** Fresh deliberate throttle from `ep` reaches its car (not the autopilot's). */
const drivesItself = (host, ep, ms = 20_000) =>
  until(host, async (ep) => {
    const state = await window.__jjTest.observe();
    const seat = state.host.seats.find((s) => s.endpoint === ep);
    const car = seat && state.cars.find((c) => c.car === seat.car);
    return seat?.fresh && !seat.inputDropped && !seat.menuOpen && car?.autopilot == null && car?.input.throttle > 0.3 && { car: seat.car };
  }, ep, ms);

test('JN6b: a phone reloaded mid-race is back playing its own seat within ~10 s and drives its car again', { timeout: 300_000 }, async () => {
  const server = await serve(dist, BASE, { JJ_STUN_URLS: '' });
  try {
    const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await host.goto(`${server.origin}${BASE}host?room&test=live&laps=3`);
    await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
    const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
    const a = await phone(joinUrl, 'Davo');
    const b = await phone(joinUrl, 'Shazza');
    for (const p of [a, b]) await p.page.getByRole('button', { name: /^Ready/ }).click();
    await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 60_000);
    // As JN7, this measures the resume path, not software-GL frame cost: every WebRTC step on the host (offer, answer,
    // each candidate, channel open, Hello → Welcome) waits for a main-thread task, and a SwiftShader race frame holds the
    // main thread ~1 s, so a drawing host takes ~8 frames to take a reloaded phone back. The sim keeps running while the
    // world is held. `JN6B_DRAW=1` keeps drawing to see that cost (6–8 s on a 2026 Mac).
    if (!process.env.JN6B_DRAW) await host.evaluate(() => window.__jjRender.hold());
    const seatBefore = (await a.page.evaluate(() => window.__jjController.inspect())).you;
    await drive(a.page, -1);
    const before = await drivesItself(host, a.ep, 120_000);

    // Reload phone A while the race runs (the reported case: no about:blank gap for the host to notice it leave).
    await a.page.reload();
    const t0 = Date.now();
    try {
      await until(a.page, () => window.__jjController?.inspect().phase === 'playing', undefined, 10_000);
    } catch {
      const ctl = await a.page.evaluate(() => window.__jjController?.inspect()).catch(() => null);
      const net = await host.evaluate(() => window.__jjNet.inspect()).catch(() => null);
      assert.fail(`the reloaded phone is not playing after 10 s: phase ${ctl?.phase} link ${JSON.stringify(ctl?.link)} host ${JSON.stringify(net)}`);
    }
    console.log(`# reloaded phone playing after ${Date.now() - t0} ms`);
    const after = await a.page.evaluate(() => window.__jjController.inspect());
    assert.equal(after.link.endpointId, a.ep, 'the same endpoint');
    assert.deepEqual(after.you, seatBefore, 'the same seat (seat, number, colour)');
    assert.equal(await host.evaluate(() => window.__jjRoom.view().phase), 'Running', 'the race kept running');
    assert.equal(await host.evaluate(() => window.__jjRoom.view().seats.length), 2, 'no extra seat');

    // Its input drives its own car again.
    await drive(a.page, -1);
    const back = await drivesItself(host, a.ep);
    assert.equal(back.car, before.car, 'the same car');
    // The other phone was never disturbed.
    assert.equal((await b.page.evaluate(() => window.__jjController.inspect())).phase, 'playing');
  } finally {
    await server.close();
  }
});
