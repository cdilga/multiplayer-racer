// Owner playtest 1 (br-gw74.8): the host's diagnostics panel shows real numbers and closes cleanly on a screen change.
// A real phone joins a real room over loopback WebRTC (a direct path); the panel lists its path as Direct with a
// measured RTT, and the host's own frame time; then the room moves from the Lobby to the race with the panel open and
// it closes, leaving nothing over the next screen. Relay labels come from the same `pathLabel` on the selected pair's
// candidate type; a forced-TURN controller needs the live TURN broker, which test servers don't have, so it is the
// couch test's row, not this journey's.
//   node --test web/tests/journeys/pt1-diagnostics.test.mjs   (WebRTC: run on eris)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/pt1diag/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'pt1diag'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const panel = (host) =>
  host.evaluate(() => {
    const el = document.querySelector('.jj-diag');
    return {
      hidden: !el || el.hidden || el.getBoundingClientRect().width === 0,
      paths: [...(el?.querySelectorAll('[data-path]') ?? [])].map((e) => e.textContent),
      rtts: [...(el?.querySelectorAll('[data-rtt]') ?? [])].map((e) => e.textContent),
      host: el?.querySelector('[data-diag-host]')?.textContent ?? null,
    };
  });

test('diagnostics: a direct phone with a measured RTT and the host frame time; closes when the screen changes', { timeout: 240_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const phone = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })).newPage();
  await phone.goto(joinUrl);
  await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  await wait(phone, () => window.__jjController.inspect().phase === 'playing');
  await wait(host, () => window.__jjRoom.view().seats.length === 1);

  await host.locator('[data-act=diagnostics]').click();
  await wait(host, () => /Direct/.test(document.querySelector('.jj-diag [data-path]')?.textContent ?? ''), undefined, 20_000);
  await wait(host, () => /\d+ ms/.test(document.querySelector('.jj-diag [data-rtt]')?.textContent ?? ''), undefined, 20_000);
  await wait(host, () => !!document.querySelector('.jj-diag [data-diag-host]'), undefined, 10_000);
  const p = await panel(host);
  assert.equal(p.hidden, false);
  assert.equal(p.paths.length, 1, `one row: the phone's seat, not an unclaimed viewer too: ${JSON.stringify(p)}`);
  assert.match(p.paths[0], /^Direct/, `the phone's path: ${JSON.stringify(p)}`);
  assert.match(p.rtts[0], /^\d+ ms$/, 'a measured RTT');
  assert.match(p.host, /Host frame [\d.]+ ms/, 'the host frame time');
  assert.doesNotMatch(p.host, /Host frame 0(\.0)? ms/, 'a real frame time, not zero');
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/diagnostics-lobby-1280x720.png` });

  // The phone readies; the room leaves the Lobby with the panel open, and it closes.
  await phone.locator('.tools [data-act=ready]').click();
  await wait(host, () => window.__jjRoom.view().phase !== 'Lobby', undefined, 60_000);
  await wait(host, () => document.querySelector('.jj-diag')?.hidden === true, undefined, 5_000);
  assert.equal(await host.locator('[data-act=diagnostics]').getAttribute('aria-pressed'), 'false');
  await host.waitForTimeout(500);
  assert.equal((await panel(host)).hidden, true, 'nothing left over the next screen');
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/diagnostics-closed-on-countdown-1280x720.png` });

  // Opened again in the race, it fills in again.
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 60_000);
  await host.locator('[data-act=diagnostics]').click();
  await wait(host, () => /\d+ ms/.test(document.querySelector('.jj-diag [data-rtt]')?.textContent ?? ''), undefined, 20_000);
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/diagnostics-race-1280x720.png` });
  assert.deepEqual(errors, []);
});
