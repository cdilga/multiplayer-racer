// Owner playtest 1 (br-gw74.3): a paused host is paused. A race runs with autopilot; the host menu pauses it; over 5 s
// paused the world draws (almost) nothing and the sim's tick stands still; after the menu closes the race moves again
// and frames flow at their usual rate. Receipt numbers go to $JJ_CAPTURE_DIR (default docs/evidence/br-gw74.3).
//   node --test web/tests/journeys/pt1-pause-idle.test.mjs   (WebRTC: run on eris)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/pt1pause/';
const CAPTURE = process.env.JJ_CAPTURE_DIR ?? resolve(import.meta.dirname, '../../../docs/evidence/br-gw74.3');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'pt1pause'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const sample = (host) => host.evaluate(() => ({ frames: window.__jjRender.stats().frames, tick: window.__jjRender.stats().tick, ...window.__jjRender.idle() }));

test('paused host: no drawing and no ticks while paused; racing resumes after', { timeout: 240_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  for (let k = 1; k <= 2; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
    await frame(host, `syn${k}`, { ready: true });
  }
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await host.waitForTimeout(2000);

  const r0 = await sample(host);
  await host.waitForTimeout(2000);
  const r1 = await sample(host);
  const racingFps = (r1.frames - r0.frames) / 2;
  assert.ok(r1.tick > r0.tick, 'the race is moving before the pause');

  await host.evaluate(() => window.__jjChrome.openMenu());
  await wait(host, () => window.__jjTest.pauseReasons().length > 0, undefined, 10_000);
  await host.waitForTimeout(1000); // the 600 ms settle after the change
  const p0 = await sample(host);
  await host.waitForTimeout(5000);
  const p1 = await sample(host);
  const pausedFps = (p1.frames - p0.frames) / 5;
  assert.ok(p1.held, 'the world is held while paused');
  assert.equal(p1.tick, p0.tick, 'the sim does not tick while paused');
  assert.ok(pausedFps <= 1, `paused drawing is near zero (${pausedFps} fps vs ${racingFps} racing)`);
  assert.ok(p1.skips > p0.skips, 'the frame loop is skipping draws');

  await host.evaluate(() => window.__jjChrome.closeMenu());
  await wait(host, () => window.__jjTest.pauseReasons().length === 0, undefined, 15_000);
  await host.waitForTimeout(1500);
  const q0 = await sample(host);
  await host.waitForTimeout(2000);
  const q1 = await sample(host);
  assert.ok(!q1.held, 'the world is released after resume');
  assert.ok(q1.tick > q0.tick, 'the race moves again after resume');
  const resumedFps = (q1.frames - q0.frames) / 2;
  assert.ok(resumedFps >= racingFps * 0.6, `frames flow again (${resumedFps} fps vs ${racingFps})`);
  assert.deepEqual(errors, []);
  writeFileSync(`${CAPTURE}/pause-idle.json`, JSON.stringify({ browser: `Playwright Chromium ${browser.version()}`, viewport: '1280x720', racingFps, pausedFps, resumedFps, pausedTicks: p1.tick - p0.tick, skipsWhilePaused: p1.skips - p0.skips }, null, 2));
});
