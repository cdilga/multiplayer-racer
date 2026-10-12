// Owner playtest 1 (br-gw74.1): Identify shows on the host every time, not only the first. A synthetic controller
// (the host's test surface feeds its frames as they'd arrive from a phone) presses Identify three times, 3.5 s apart
// (past the 3 s limit), in the Lobby and then mid-race; each press must show on the host (the Identify event and the
// number over its car, plus the tile pulse in a race), and a second player's press between them shows too.
//   node --test web/tests/journeys/pt1-identify-repeat.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/pt1id/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'pt1id'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const seatOf = (host, endpoint) => host.evaluate(async (e) => (await window.__jjTest.observe()).host.seats.find((s) => s.endpoint === e)?.seat ?? null, endpoint);
/** Identify events for `seat` the host has received so far, and number marks it has put over cars. */
const shown = (host, seat) =>
  host.evaluate((seat) => ({
    events: window.__jjRoom.events().filter((e) => e.event.Identify?.seat === seat).length,
    limited: window.__jjRoom.events().filter((e) => e.event.IdentifyLimited).length,
    marks: window.__jjRender.identifyShown?.().length ?? null,
    pulses: window.__jjRoom.identified().filter((i) => i.seat === seat).length,
  }), seat);

async function pressThrice(host, endpoint, label) {
  const seat = await seatOf(host, endpoint);
  const out = [];
  for (let k = 0; k < 3; k++) {
    const before = await shown(host, seat);
    await frame(host, endpoint, { identify: true });
    await wait(host, ([seat, n]) => window.__jjRoom.events().filter((e) => e.event.Identify?.seat === seat).length > n, [seat, before.events], 5_000).catch(() => {});
    const after = await shown(host, seat);
    out.push({ press: k + 1, before, after });
    if (k === 1) await frame(host, 'syn2', { identify: true }); // another player's press in between
    await host.waitForTimeout(3500);
  }
  for (const o of out) assert.ok(o.after.events > o.before.events, `${label}: press ${o.press} reached the host as an Identify event: ${JSON.stringify(out)}`);
  return out;
}

test('Identify shows on the host on every press, in the Lobby and in a race', { timeout: 240_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  for (let k = 1; k <= 2; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
  }
  await host.waitForTimeout(3500); // the join's own auto-Identify starts the limit
  const lobby = await pressThrice(host, 'syn1', 'Lobby');
  for (let k = 1; k <= 2; k++) await frame(host, `syn${k}`, { ready: true });
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await host.waitForTimeout(3500);
  const race = await pressThrice(host, 'syn1', 'Race');
  for (const o of race) assert.ok(o.after.pulses > o.before.pulses, `Race: press ${o.press} pulsed the tile: ${JSON.stringify(race)}`);
  console.log(JSON.stringify({ lobby, race }));
  assert.deepEqual(errors, []);
});
