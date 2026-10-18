// P1-FL08 / br-bbki.8 (R131, R127): the start-line scene in the real worker and renderer, driven as its committed fixture
// (scenarios/lab/start-line-launch.json) drives it natively: eight cars on the grid, held through the countdown (the
// autopiloted ones too); car 0 snaps early and forfeits its launch, car 1 snaps at GO and launches, and 1.5 s after GO
// car 1 is well clear of the grid. With JJ_CAPTURE_DIR set it captures the held grid, the launch from car 1's chase
// camera, and the straight from the overview, for the self-review.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/fl08-start-line/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-FL08');
const mapJson = readFileSync('maps/lab/start-line.json', 'utf8');
const RUN = 'start-line-launch';
const GO = 360;
let server;

before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'fl08-start-line'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close?.();
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: the grid waits for GO, the early snap forfeits, the perfect launch leads`, { timeout: 600_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [];
    const capture = process.env.JJ_CAPTURE_DIR && name === 'chromium';
    try {
      const fixture = { ...JSON.parse(readFileSync(`scenarios/lab/${RUN}.json`, 'utf8')), seats: [{ name: 'Lab driver', car: 0 }] };
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/lab-scene.json', q => q.fulfill({ contentType: 'application/json', body: mapJson }));
      await page.goto(`${server.origin}${BASE}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/lab-scene.json')}`);
      await page.waitForFunction(() => window.__jjTest && window.__jjRender, undefined, { timeout: 60_000 });
      await page.evaluate(async ({ fixture, mapJson }) => { window.__jjRender.hold(); await window.__jjTest.load(fixture, mapJson); }, { fixture, mapJson });
      await page.waitForFunction(() => { window.__jjRender.frame(); window.__jjRender.hold(); return window.__jjRender.vehicles().vehicles[0]?.loaded; }, undefined, { timeout: 60_000, polling: 250 });
      const shot = async (when, view) => {
        if (!capture) return;
        await page.evaluate(v => { window.__jjRender.setFollow(v === 'overview' ? null : [1]); window.__jjRender.frame(); window.__jjRender.hold(); }, view);
        await page.screenshot({ path: join(out, `${name}-${when}-${view}-1920x1080.jpg`), type: 'jpeg', quality: 85 });
      };
      const along = async () => (await page.evaluate(() => window.__jjTest.observe())).cars.map(c => c.progress.distanceM);
      // (Every car is the Cruz: one model to load.)
      // The countdown: settle on the grid, then nobody moves from tick 120 to GO.
      await page.evaluate(async () => { await window.__jjTest.step(120); });
      const settled = await along();
      await page.evaluate(async (n) => { await window.__jjTest.step(n); }, GO - 1 - 120);
      const held = await along();
      assert.equal(held.length, 8, 'the full grid of eight');
      held.forEach((d, i) => assert.ok(Math.abs(d - settled[i]) < 0.3, `car ${i} waits for GO (moved ${(d - settled[i]).toFixed(2)} m)`));
      await shot('grid', 'chase');
      await shot('grid', 'overview');
      await page.evaluate(async () => { await window.__jjTest.step(61); });
      await shot('launch', 'chase');
      await page.evaluate(async (n) => { await window.__jjTest.step(n); }, 540 - GO - 61);
      const after = await along();
      const gained = after.map((d, i) => d - held[i]);
      await shot('straight', 'overview');
      await shot('straight', 'chase');
      const others = gained.filter((_, i) => i !== 1);
      assert.ok(gained[1] > 2 * Math.max(...others), `the perfect launch leads: car 1 ${gained[1].toFixed(1)} m, the rest at most ${Math.max(...others).toFixed(1)} m`);
      await page.close();
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
