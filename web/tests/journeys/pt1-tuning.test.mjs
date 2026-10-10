// The owner tuning menu, part 1 (br-2sdu.1). Without the owner flag the host has no tuning panel and never loads its
// chunk. With `?tune` (remembered in that browser) a race runs on autopilot; the panel, built from the sim's own tuning,
// sets the engine force to 0 mid-race: the sim reads the new value back within a second and the cars slow down; Reset
// puts it back; Export carries every change as a `jj.tuning-patch.v1` file for `jj vehicle tune`. Captures go to
// $JJ_CAPTURE_DIR when set.
//   node --test web/tests/journeys/pt1-tuning.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/pt1tune/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'pt1tune'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const meanSpeed = (host) => host.evaluate(async () => { const o = await window.__jjTest.observe(); return o.cars.reduce((a, c) => a + Math.abs(c.speed), 0) / Math.max(1, o.cars.length); });

async function race(host) {
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  for (let k = 1; k <= 2; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
    await frame(host, `syn${k}`, { ready: true });
  }
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
}

test('no owner flag: no panel and no tuning chunk', { timeout: 120_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const chunks = [];
  host.on('request', (r) => /tuning|panel/i.test(r.url()) && chunks.push(r.url()));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjRoom?.view()?.phase === 'Lobby');
  await host.waitForTimeout(1000);
  assert.equal(await host.locator('.jj-tune-toggle, .jj-tune').count(), 0, 'no tuning UI');
  assert.equal(await host.evaluate(() => 'jjTune' in window || '__jjTune' in window), false);
  assert.deepEqual(chunks, [], 'the tuning chunk is never fetched');
});

test('?tune: a live change mid-race reaches the sim and the cars; reset; export', { timeout: 240_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9&tune`);
  await race(host);
  await wait(host, () => !!window.__jjTune);
  await host.waitForTimeout(3000);
  const before = await meanSpeed(host);
  assert.ok(before > 3, `racing before the change (${before} m/s)`);

  await host.locator('.jj-tune-toggle').click();
  const field = host.locator('[data-field="max_engine_force"]');
  await field.waitFor();
  const original = Number(await field.inputValue());
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/tuning-open-1280x720.png` });
  const t0 = Date.now();
  await field.fill('0');
  await field.dispatchEvent('change');
  await wait(host, () => window.__jjTune.inspect().current.max_engine_force === 0, undefined, 1_000);
  const appliedMs = Date.now() - t0;
  await host.waitForTimeout(4000);
  const after = await meanSpeed(host);
  assert.ok(after < before * 0.6, `no engine: the cars slow (${before.toFixed(1)} -> ${after.toFixed(1)} m/s)`);
  const shown = await host.evaluate(() => window.__jjTune.inspect());
  assert.deepEqual(shown.patch, { contract: 'jj.tuning-patch.v1', profile: 'assets/profiles/cruz-missile.json', set: [['max_engine_force', '0']] });
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/tuning-changed-1280x720.png` });

  // A bad value is refused and shown; the sim keeps the last good one.
  const gravel = host.locator('[data-field="surfaces.gravel"]');
  if (await gravel.count()) {
    await gravel.fill('0.5');
    await gravel.dispatchEvent('change');
    await wait(host, () => window.__jjTune.inspect().current['surfaces.gravel'] === 0.5, undefined, 1_000);
  }

  // Reset puts the engine back and it drops out of the export.
  await host.locator('[data-reset="max_engine_force"]').click();
  await wait(host, (v) => window.__jjTune.inspect().current.max_engine_force === v, original, 1_000);
  const patch = (await host.evaluate(() => window.__jjTune.inspect())).patch;
  assert.ok(!patch.set.some(([f]) => f === 'max_engine_force'), `reset leaves it out of the export: ${JSON.stringify(patch)}`);

  // Export downloads the patch file.
  const [download] = await Promise.all([host.waitForEvent('download'), host.locator('[data-tune-export]').click()]);
  assert.match(download.suggestedFilename(), /^tuning-.*\.json$/);
  console.log(`# applied in ${appliedMs} ms; mean speed ${before.toFixed(1)} -> ${after.toFixed(1)} m/s`);
  assert.deepEqual(errors, []);
});
