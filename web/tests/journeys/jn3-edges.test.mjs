// P1-G01 edge variants of the round loop, through the real host page (`B/host?room&test=live&laps=1`):
//  - force-start: Start race with one player not ready warns, counts down, and races both (synthetic controllers: the
//    test surface feeds their hello, claim and ready frames as a phone's would arrive, no WebRTC);
//  - End mid-round: the round is voided (no results), the Lobby has no cars and nobody is ready, and the room goes on
//    to race a fresh round;
//  - host page reload (real phones over WebRTC, run on eris or any host with loopback WebRTC): the phones of the old
//    room show "That room has ended" when the page's best-effort `end` goes through, and "The host seems to have gone"
//    once the controller's liveness timer passes (120 s) when it is blocked.
// `JJ_CAPTURE_DIR=<dir>` saves the visual self-review captures.
//   node --test web/tests/journeys/jn3-edges.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/jn3e/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'jn3e'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

// A slow (software-rendered, shared) CI runner takes far longer than eris to open a room, join phones and start a round, so
// the defaults are generous and a timeout names the step that was waiting.
let step = '';
const at = (name) => {
  step = name;
};
const wait = async (page, fn, arg, ms = 90_000) => {
  try {
    return await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
  } catch (e) {
    throw new Error(`${step}: ${e.message.split('\n')[0]}`);
  }
};
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png`, timeout: 120_000 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const view = (host) => host.evaluate(() => window.__jjRoom.view());
const cars = (host) => host.evaluate(async () => (await window.__jjTest.observe()).cars.length);

async function openHost() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await ctx.newPage();
  host.errors = [];
  host.on('pageerror', (e) => host.errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 180_000);
  return host;
}

async function synthetic(host, names) {
  for (const [k, name] of names.entries()) {
    await frame(host, `syn${k + 1}`, { hello: true });
    await frame(host, `syn${k + 1}`, { claim: name });
  }
  await wait(host, (n) => window.__jjRoom.view().seats.length === n, names.length);
}

test('force-start: Start race with one player not ready warns, counts down and races both', { timeout: 300_000 }, async () => {
  const host = await openHost();
  await synthetic(host, ['Davo', 'Shazza']);
  await frame(host, 'syn1', { ready: true });
  await wait(host, () => window.__jjRoom.view().seats.filter((s) => s.ready).length === 1);
  await host.waitForTimeout(1500);
  assert.equal((await view(host)).phase, 'Lobby', 'one of two ready does not start the race on its own');
  await shot(host, 'tv-force-lobby-one-ready');

  await host.locator('[data-act=start]').click();
  await wait(host, () => ['Preparing', 'Countdown'].includes(window.__jjRoom.view().phase));
  await wait(host, () => window.__jjRoom.view().phase === 'Countdown');
  await wait(host, () => Number(document.querySelector('[data-screen=countdown]')?.dataset.count) > 0);
  const shown = Number(await host.evaluate(() => document.querySelector('[data-screen=countdown]')?.dataset.count));
  await shot(host, 'tv-force-countdown');
  const v = await view(host);
  assert.deepEqual(v.seats.map((s) => s.car !== null), [true, true], 'both seats, ready or not, are on the grid');
  assert.equal(await cars(host), 2, 'the not-ready player races too');
  // The not-ready player gets a longer warning than a normal 3-2-1.
  assert.ok(shown > 3, `the force-start warning lengthens the countdown (${shown} on the TV as it began)`);

  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 280_000);
  const results = (await view(host)).results;
  assert.equal(results.length, 2, `both finish: ${JSON.stringify(results)}`);
  await shot(host, 'tv-force-results');
  assert.deepEqual(host.errors, []);
});

test('End mid-round voids the round, the Lobby has no cars and nobody ready, and a fresh round races', { timeout: 420_000 }, async () => {
  const host = await openHost();
  await synthetic(host, ['Davo', 'Shazza']);
  await frame(host, 'syn1', { ready: true });
  await frame(host, 'syn2', { ready: true });
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 180_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await host.waitForTimeout(3000);
  assert.equal(await cars(host), 2);
  await shot(host, 'tv-end-racing');

  await host.evaluate(() => window.__jjRoom.end());
  await wait(host, () => window.__jjRoom.view().phase === 'Lobby');
  const lobby = await view(host);
  assert.equal(lobby.results, null, 'a voided round has no results');
  assert.deepEqual(lobby.seats.map((s) => s.ready), [false, false], 'nobody is ready after End');
  assert.equal(lobby.seats.length, 2, 'both players are still in the room');
  assert.equal(await cars(host), 0, 'the Lobby has no cars');
  await wait(host, () => document.querySelector('[data-act=start]') !== null);
  await shot(host, 'tv-end-lobby');

  // The room goes on. End disarms the all-ready auto-start (the director's `end` sets armed = false), so the host
  // starts the next round with Start race, after both ready up again.
  await frame(host, 'syn1', { ready: true });
  await frame(host, 'syn2', { ready: true });
  await wait(host, () => window.__jjRoom.view().seats.every((s) => s.ready));
  await host.locator('[data-act=start]').click();
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase), undefined, 180_000);
  assert.equal(await cars(host), 2, 'the next round puts both on the grid');
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 280_000);
  assert.equal((await view(host)).results.length, 2, 'the fresh round finishes with results');
  assert.deepEqual(host.errors, []);
});

async function phone(url, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  return { ctx, page };
}

const phase = (p) => p.evaluate(() => window.__jjController.inspect().phase);

/** Two phones in a running round, then the host page reloads (with `end` blocked or not). */
async function reloadScenario({ blockEnd }) {
  at('reload: opening the host');
  const host = await openHost();
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  at('reload: phones joining');
  const a = await phone(joinUrl, 'Davo');
  const b = await phone(joinUrl, 'Shazza');
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  at('reload: both ready, round starting');
  await a.page.getByRole('button', { name: /^Ready/ }).click();
  await b.page.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 180_000);
  if (blockEnd) {
    // Playwright routes don't see the unload's keepalive request, so the page's own fetch refuses every `end` (this page
    // and the one it reloads into: init scripts run in both).
    const refuse = () => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => (/\/rooms\/[^/]+\/end$/.test(String(input?.url ?? input)) ? Promise.reject(new TypeError('end blocked by the test')) : real(input, init));
    };
    await host.context().addInitScript(refuse);
    await host.evaluate(refuse);
  }
  const oldCode = await host.evaluate(() => window.__jjNet.code());
  host.on('dialog', (d) => d.accept()); // the page may ask before unload
  at('reload: the reloaded page opening a new room');
  await host.reload();
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 180_000);
  const newCode = await host.evaluate(() => window.__jjNet.code());
  assert.notEqual(newCode, oldCode, 'the reloaded page opens a new room');
  return { host, a, b };
}

test('host page reload: the old room\'s phones show "That room has ended"', { timeout: 600_000 }, async () => {
  const { host, a, b } = await reloadScenario({ blockEnd: false });
  for (const p of [a, b]) {
    await wait(p.page, () => window.__jjController.inspect().phase === 'room-ended', undefined, 90_000).catch(async (e) => {
      throw new Error(`the phone is in ${await phase(p.page)} (the page's best-effort end of the room it remembered never reached the server): ${e.message}`);
    });
  }
  await shot(a.page, 'phone-reload-room-ended');
  assert.match(await a.page.evaluate(() => document.body.innerText), /That room has ended/i);
  await shot(host, 'tv-reload-new-room');
  await a.ctx.close();
  await b.ctx.close();
});

test('host page reload with the best-effort end blocked: the phones show "Host gone" once the liveness timer passes', { timeout: 900_000 }, async () => {
  const { a, b } = await reloadScenario({ blockEnd: true });
  const started = Date.now();
  await wait(a.page, () => ['reconnecting', 'host-gone'].includes(window.__jjController.inspect().phase), undefined, 180_000).catch(async (e) => {
    throw new Error(`the phone is in ${await phase(a.page)}, link ${JSON.stringify(await a.page.evaluate(() => window.__jjController.inspect().link))}: ${e.message}`);
  });
  await shot(a.page, 'phone-reload-reconnecting');
  assert.notEqual(await phase(a.page), 'room-ended', 'with end blocked the room is not ended: the phone keeps reconnecting');
  for (const p of [a, b]) {
    await wait(p.page, () => window.__jjController.inspect().phase === 'host-gone', undefined, 200_000).catch(async (e) => {
      throw new Error(`the phone is in ${await phase(p.page)} after ${Math.round((Date.now() - started) / 1000)} s: ${e.message}`);
    });
  }
  console.log(`# host gone after ${Math.round((Date.now() - started) / 1000)} s`);
  await shot(a.page, 'phone-reload-host-gone');
  assert.match(await a.page.evaluate(() => document.body.innerText), /host seems to have gone/i);
  await a.ctx.close();
  await b.ctx.close();
});
