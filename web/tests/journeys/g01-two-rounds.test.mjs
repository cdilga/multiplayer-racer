// P1-G01 AC "four controllers play two consecutive rounds hands-off": four controllers (synthetic, through the host's test
// surface `input`, the same frames a phone sends) join, tap Ready, and the autopilot races two REAL 1-lap rounds back to back.
// Nobody clicks the host page: the second round starts because every seat is Ready again on the results screen. No
// `finishRace`: each round ends by its cars crossing the line.
//   node --test web/tests/journeys/g01-two-rounds.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/g01tr/';
const N = 4;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'g01tr'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 300_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const view = (host) => host.evaluate(() => window.__jjRoom.view());

test('four controllers play two consecutive 1-lap rounds hands-off', { timeout: 1_200_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  let clicks = 0;
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);
  await host.evaluate(() => addEventListener('click', () => (window.__clicks = (window.__clicks ?? 0) + 1), true));
  for (let k = 1; k <= N; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
  }
  await wait(host, (n) => window.__jjRoom.view().seats.length === n, N);
  assert.equal((await host.evaluate(() => window.__jjTest.observe())).cars.length, 0, 'the Lobby has no driving cars');

  const rounds = [];
  for (let round = 1; round <= 2; round++) {
    for (let k = 1; k <= N; k++) await frame(host, `syn${k}`, { ready: true });
    await wait(host, (r) => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase) && window.__jjRoom.view().round === r, round, 120_000);
    assert.equal((await host.evaluate(() => window.__jjTest.observe())).cars.length, N, `round ${round}: all ${N} on the grid`);
    await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);
    await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
    await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 600_000);
    const v = await view(host);
    assert.equal(v.results.length, N, `round ${round}: ${N} results ${JSON.stringify(v.results)}`);
    assert.deepEqual(v.results.map((r) => r.place).sort(), [1, 2, 3, 4]);
    assert.equal(v.seats.length, N, 'no phantom seats');
    rounds.push({ round, places: v.results.map((r) => r.place) });
    // Everyone un-readies on the results screen (a fresh round needs a fresh Ready), then readies again in the loop.
    for (let k = 1; k <= N; k++) await frame(host, `syn${k}`, { ready: false });
  }
  clicks = await host.evaluate(() => window.__clicks ?? 0);
  assert.equal(clicks, 0, 'nobody clicked the host page');
  assert.equal(rounds.length, 2);
  assert.deepEqual(errors, []);
});
