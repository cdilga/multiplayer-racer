// P1-M08a: the Retry / Lobby screen on the REAL host page. A recipe the generator can't make (`recipe=nosuch`) fails the
// preparation and the conservative retry too; the host shows "No track this time" over the Lobby with Retry and Lobby, the
// players' seats are kept, Retry prepares again, Lobby closes the screen. `JJ_CAPTURE_DIR=<dir>` saves the captures for the
// visual self-review (docs/evidence/P1-M08a/).
//   node --test web/tests/journeys/m08a-retry-lobby.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/m08a/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'm08a'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 90_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });

for (const [name, viewport] of [
  ['tv', { width: 1920, height: 1080 }],
  ['phone-host', { width: 412, height: 915 }],
]) {
  test(`a failed preparation shows Retry / Lobby over the room (${name})`, { timeout: 300_000 }, async () => {
    const host = await (await browser.newContext({ viewport })).newPage();
    const errors = [];
    host.on('pageerror', (e) => errors.push(e.message));
    await host.goto(`${server.origin}${BASE}host?room&test=live&recipe=nosuch`);
    await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
    for (const k of [1, 2]) {
      await frame(host, `syn${k}`, { hello: true });
      await frame(host, `syn${k}`, { claim: `Racer ${k}` });
    }
    await wait(host, () => window.__jjRoom.view().seats.length === 2);
    for (const k of [1, 2]) await frame(host, `syn${k}`, { ready: true });
    await wait(host, () => document.querySelector('[data-screen=prepare-failed]'));
    const seen = await host.evaluate(() => ({
      acts: [...document.querySelectorAll('.pf [data-act]')].map((b) => b.textContent),
      seats: window.__jjRoom.view().seats.length,
      phase: window.__jjRoom.view().phase,
    }));
    assert.deepEqual(seen.acts, ['Retry', 'Lobby']);
    assert.equal(seen.seats, 2, 'the room and its players are kept');
    assert.equal(seen.phase, 'Lobby');
    await shot(host, `${name}-retry-lobby`);
    const n = await host.evaluate(() => window.__jjPrepare.stats().requested);
    await host.click('[data-act=retry]');
    await wait(host, (n) => window.__jjPrepare.stats().requested > n, n);
    await wait(host, () => document.querySelector('[data-screen=prepare-failed]'));
    await host.click('[data-act=lobby]');
    await wait(host, () => !document.querySelector('[data-screen=prepare-failed]'));
    assert.equal(await host.evaluate(() => window.__jjRoom.view().seats.length), 2);
    await shot(host, `${name}-lobby-after`);
    assert.deepEqual(errors, []);
  });
}
