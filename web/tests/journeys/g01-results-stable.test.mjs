// P1-G01: the results screen's buttons survive the roster churning under them. The deploy smoke's click on "Start next round
// now" timed out on a slow preview: the screen was keyed on the seats' Ready and presence, so every flap rebuilt its
// innerHTML and replaced the button a click was waiting to find still. A round finishes (the test surface's `finishRace`),
// the results show, a synthetic controller toggles Ready and presses Identify over and over, and the same Start and Return
// buttons stay in the page the whole time; then a click on Start next round now starts round 2.
//   node --test web/tests/journeys/g01-results-stable.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/g01rs/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'g01rs'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 90_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);

test('results screen: Ready and presence churn leaves the same buttons in the page, and a click on Start next round now works', { timeout: 420_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=99`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);
  for (const k of [1, 2]) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
  }
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  for (const k of [1, 2]) await frame(host, `syn${k}`, { ready: true });
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 180_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await host.waitForTimeout(1500);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'finishRace' }));
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 180_000);
  await wait(host, () => document.querySelector('[data-screen=results] [data-act=start]'));
  await host.evaluate(() => {
    window.__start = document.querySelector('[data-act=start]');
    window.__lobby = document.querySelector('[data-act=lobby]');
    window.__list = document.querySelector('[data-results]');
  });

  // The roster churns: Ready on and off, Identify, a hello again (a heartbeat flap).
  for (let k = 0; k < 6; k++) {
    await frame(host, 'syn1', { ready: k % 2 === 0 });
    await frame(host, 'syn2', { ready: k % 2 === 1 });
    await frame(host, 'syn1', { identify: true });
    await host.waitForTimeout(400);
  }
  const same = await host.evaluate(() => ({
    start: window.__start.isConnected && window.__start === document.querySelector('[data-act=start]'),
    lobby: window.__lobby.isConnected && window.__lobby === document.querySelector('[data-act=lobby]'),
    list: window.__list.isConnected && window.__list === document.querySelector('[data-results]'),
    phase: window.__jjRoom.view().phase,
  }));
  assert.deepEqual(same, { start: true, lobby: true, list: true, phase: 'Intermission' }, 'the results screen was not rebuilt by the roster churning');

  await host.getByRole('button', { name: 'Start next round now' }).click({ timeout: 30_000 });
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase) && window.__jjRoom.view().round === 2, undefined, 120_000);
  assert.deepEqual(errors, []);
});
