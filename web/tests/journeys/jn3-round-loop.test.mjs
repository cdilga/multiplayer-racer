// Journey JN3 (P1-G01): the party loop through the real host page (`B/host?room&test=live&laps=1`) and real phones over
// WebRTC. Two players join; the Lobby has no driving cars (R110); both tap Ready; the countdown puts them on the grid;
// the autopilot races a 1-lap round (test surface `autopilot`); Round complete shows both results on the TV and each
// phone its place; the next round starts. `JJ_CAPTURE_DIR=<dir>` saves the visual self-review matrix.
//   node --test web/tests/journeys/jn3-round-loop.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';

const BASE = '/p/jn3/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'jn3'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });
const phase = (host) => host.evaluate(() => window.__jjRoom.view()?.phase);

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

test('JN3: two players race a 1-lap round, see results, and the next round starts', { timeout: 420_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  await shot(host, 'tv-lobby-empty');

  const a = await phone(joinUrl, 'Davo');
  const b = await phone(joinUrl, 'Shazza');
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  assert.equal((await host.evaluate(() => window.__jjTest.observe())).cars.length, 0, 'the Lobby has no driving cars (R110)');
  await shot(host, 'tv-lobby-two-players');
  await shot(a.page, 'phone-lobby-not-ready');

  // Both tap Ready: the round starts on its own.
  await a.page.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => window.__jjRoom.view().seats.filter((s) => s.ready).length === 1);
  await shot(host, 'tv-lobby-one-ready');
  await b.page.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase));
  await shot(host, 'tv-countdown');
  await shot(a.page, 'phone-countdown');
  assert.equal((await host.evaluate(() => window.__jjTest.observe())).cars.length, 2, 'the countdown puts both on the grid');

  await wait(host, () => window.__jjRoom.view().phase === 'Running');
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await host.waitForTimeout(3000);
  await shot(host, 'tv-racing');
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 300_000);
  const results = await host.evaluate(() => window.__jjRoom.view().results);
  assert.equal(results.length, 2, JSON.stringify(results));
  assert.deepEqual(results.map((r) => r.place).sort(), [1, 2]);
  await wait(host, () => document.querySelectorAll('[data-results] tbody tr').length === 2);
  await shot(host, 'tv-round-complete');
  await wait(a.page, () => /You came/.test(document.querySelector('[data-round-banner]')?.textContent ?? ''));
  await shot(a.page, 'phone-results');

  // The next round.
  await host.getByRole('button', { name: 'Start next round now' }).click();
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase) && window.__jjRoom.view().round === 2);
  assert.deepEqual(errors, []);
  await a.ctx.close();
  await b.ctx.close();
});
