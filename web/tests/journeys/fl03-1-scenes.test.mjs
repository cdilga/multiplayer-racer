// P1-FL03.1 / br-bbki.19 (R131): the Feel Lab scene picker. In a real room with the owner tuning panel open, each lab
// scene (maps/lab/*.json, `jj lab`) is picked in the panel and loaded: the next round runs on that scene's committed map
// (the preparer's plan says `lab:<scene>` and the shown route is the scene's), a seated controller drives on it, and the
// map reached the sim through MapReady, so the journal carries it (R90). The Feel Lab's A/B mid-run is FL03's journey.
// `JJ_CAPTURE_DIR=<dir>` saves the panel and each loaded scene at 1920x1080.
//   node --test web/tests/journeys/fl03-1-scenes.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/fl031/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const LAB = resolve(import.meta.dirname, '../../../maps/lab');
const SCENES = readdirSync(LAB).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'fl031'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 90_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);

for (const scene of SCENES) {
  test(`scene picker: ${scene} loads as the next round's track and a seat drives on it`, { timeout: 300_000 }, async () => {
    const want = JSON.parse(readFileSync(join(LAB, `${scene}.json`), 'utf8')).route.points.length;
    const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    const errors = [];
    host.on('pageerror', (e) => errors.push(e.message));
    await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9&tune`);
    await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby' && !!window.__jjTune && !!window.__jjPrepare);
    await host.locator('.jj-tune-toggle').click();
    // Picked and loaded in the panel, as the owner would.
    await host.locator('[data-tune-scene]').selectOption(scene);
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/panel-${scene}.png` });
    await host.locator('[data-tune-scene-go]').click();
    await wait(host, (s) => window.__jjPrepare.scene() === s, scene, 10_000);
    // A seat, then the round.
    await frame(host, 'syn1', { hello: true });
    await frame(host, 'syn1', { claim: 'Lab driver' });
    await frame(host, 'syn1', { ready: true });
    await wait(host, () => window.__jjRoom.view().phase === 'Running');
    const plan = await host.evaluate(() => window.__jjPrepare.seeds().at(-1));
    assert.equal(plan.plan, `lab:${scene}`, `the round's track is the scene: ${JSON.stringify(plan)}`);
    const route = await host.evaluate(() => window.__jjPrepare.mapInfo()?.route.length);
    assert.equal(route, want, 'the shown map is the scene\'s committed map');
    // The seat drives on it: full throttle for a moment moves the car.
    const before = await host.evaluate(async () => (await window.__jjTest.observe()).cars[0].position);
    const seat = await host.evaluate(async () => (await window.__jjTest.observe()).host.seats[0]);
    for (let k = 0; k < 20; k++) {
      await host.evaluate((seat) => window.__jjTest.input({ type: 'controller', endpoint: seat.endpoint, frame: { state: { source: seat.source, seq: Date.now() & 0xffff, drive: [0, 32767], action: [0, 0] } } }), seat);
      await host.waitForTimeout(100);
    }
    const after = await host.evaluate(async () => (await window.__jjTest.observe()).cars[0].position);
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
    assert.ok(moved > 2, `the seat drove on ${scene}: moved ${moved.toFixed(1)} m`);
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/scene-${scene}.png` });
    assert.deepEqual(errors, []);
  });
}
