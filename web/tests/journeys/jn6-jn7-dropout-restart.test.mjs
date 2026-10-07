// Journeys JN6 and JN7 (P1-G03) on the real pages over loopback WebRTC through the real jj-server.
// JN6: mid-race, a phone loses its network: its car goes to the autopilot within ~2 s and the room never pauses; when
// the network comes back the player's first deliberate input takes the same car back.
// JN7: jj-server restarts mid-race: play carries on peer to peer, the host re-registers its code, and a new phone can
// still join.
//   node --test web/tests/journeys/jn6-jn7-dropout-restart.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/jn6/';
let browser;
let dist;

before(async () => {
  dist = build('./', 'jn6');
  browser = await chromium.launch({ args: chromiumArgs });
});
after(() => browser?.close());

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

async function phone(url, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  return { ctx, page, ep: (await page.evaluate(() => window.__jjController.inspect())).link.endpointId };
}

async function raceWith(origin, names) {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${origin}${BASE}host?room&test=live&laps=3`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const phones = [];
  for (const n of names) phones.push(await phone(joinUrl, n));
  for (const p of phones) await p.page.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 60_000);
  return { host, phones, joinUrl };
}

const carOf = (state, ep) => {
  const seat = state.host.seats.find((s) => s.endpoint === ep);
  return seat && state.cars.find((c) => c.car === seat.car);
};
const observe = (host) => host.evaluate(() => window.__jjTest.observe());
const drive = (p, y) => p.page.evaluate((y) => window.__jjController.setSticks({ x: 0, y, touch: y !== 0 }, { x: 0, y: 0, touch: false }), y);

test('JN6: a phone that loses its network goes to the autopilot within ~2 s, the room never pauses, and it takes the car back', { timeout: 300_000 }, async () => {
  const server = await serve(dist, BASE, { JJ_STUN_URLS: '' });
  try {
    const { host, phones } = await raceWith(server.origin, ['Davo', 'Shazza']);
    const [a] = phones;
    await drive(a, -1);
    await host.waitForTimeout(1500);
    const before = carOf(await observe(host), a.ep);
    assert.ok(before && !before.autopilot, 'A drives itself');
    // The phone drops off (its page and connection gone: a dead network, a locked phone, a crashed tab). Playwright's
    // offline mode doesn't stop WebRTC data channels, so the page itself goes.
    const url = a.page.url();
    await a.page.goto('about:blank');
    const t0 = Date.now();
    for (;;) {
      const st = await observe(host);
      if (carOf(st, a.ep)?.autopilot) break;
      assert.ok(Date.now() - t0 < 6_000, 'the autopilot took over within a few seconds');
      await host.waitForTimeout(200);
    }
    const tookMs = Date.now() - t0;
    console.log(`# autopilot after ${tookMs} ms without the phone`);
    assert.equal(await host.evaluate(() => window.__jjRoom.view().phase), 'Running', 'the room never pauses');
    // Back again (a reload of the join link): the same seat, and the first deliberate input takes the car back.
    await a.page.goto(url);
    await wait(a.page, () => window.__jjController?.inspect().phase === 'playing', undefined, 60_000);
    await drive(a, -1);
    for (const t1 = Date.now(); carOf(await observe(host), a.ep)?.autopilot; await host.waitForTimeout(200)) {
      assert.ok(Date.now() - t1 < 15_000, 'a deliberate input took the car back');
    }
    assert.equal(carOf(await observe(host), a.ep).car, before.car, 'the same car');
  } finally {
    await server.close();
  }
});

test('JN7: jj-server restarts mid-race, play continues, the host keeps its code and a new phone still joins', { timeout: 300_000 }, async () => {
  const port = await freePort();
  let server = await serve(dist, BASE, { JJ_BIND: `127.0.0.1:${port}`, JJ_STUN_URLS: '' });
  try {
    const { host, phones } = await raceWith(server.origin, ['Robbo']);
    const [a] = phones;
    const code = await host.evaluate(() => window.__jjNet.code());
    await drive(a, -1);
    await server.close();
    const during = await observe(host);
    await host.waitForTimeout(3000);
    const later = await observe(host);
    assert.ok(later.tick > during.tick + 120, 'the race keeps running while the server is down');
    assert.ok(!carOf(later, a.ep).autopilot, 'the phone still drives over WebRTC');
    server = await serve(dist, BASE, { JJ_BIND: `127.0.0.1:${port}`, JJ_STUN_URLS: '' });
    await wait(host, () => window.__jjNet.inspect().reRegistrations >= 1, undefined, 60_000);
    assert.equal(await host.evaluate(() => window.__jjNet.code()), code, 'the host keeps its code');
    const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
    const b = await phone(joinUrl, 'Gazza');
    await wait(host, (ep) => window.__jjRoom.view().seats.length === 2, b.ep);
  } finally {
    await server.close();
  }
});
