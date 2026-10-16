// P1-FL12 / br-bbki.12 (R133): the off-road climb scene in the real worker and renderer, driven as its committed
// fixtures (scenarios/lab/off-road-*.json) drive it natively. From rest on the road the Tradie Ute turns off it and climbs
// a 40-50 degree bank; the Cruz stalls near the same bank's foot; the Ute can't drive up a rock wall. Each run ends inside
// its fixture's height envelope. With JJ_CAPTURE_DIR set it captures each run mid-way and at the end from the chase
// camera, and at the end from the overview, for the visual self-review.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/fl12-climb/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-FL12');
const mapJson = readFileSync('maps/lab/off-road-climb.json', 'utf8');
const RUNS = ['off-road-climb', 'off-road-climb-cruz', 'off-road-wall'];
let server;

before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'fl12-climb'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close?.();
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: the Ute climbs the bank off the road, the Cruz stalls at its foot, and a rock face stays a wall`, { timeout: 900_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [];
    const capture = process.env.JJ_CAPTURE_DIR && name === 'chromium';
    try {
      for (const run of RUNS) {
        const fixture = { ...JSON.parse(readFileSync(`scenarios/lab/${run}.json`, 'utf8')), seats: [{ name: 'Lab driver', car: 0 }] };
        const height = fixture.expect.find(e => e.metric === 'height');
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        page.on('pageerror', e => errors.push(`${run}: ${e.message}`));
        await page.route('**/lab-scene.json', q => q.fulfill({ contentType: 'application/json', body: mapJson }));
        await page.goto(`${server.origin}${BASE}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/lab-scene.json')}`);
        await page.waitForFunction(() => window.__jjTest && window.__jjRender, undefined, { timeout: 60_000 });
        await page.evaluate(async ({ fixture, mapJson }) => { window.__jjRender.hold(); await window.__jjTest.load(fixture, mapJson); }, { fixture, mapJson });
        // The run's vehicle is drawn as itself: wait out its model's load before driving.
        await page.waitForFunction(id => { window.__jjRender.frame(); window.__jjRender.hold(); return window.__jjRender.vehicles().vehicles.find(v => v.id === id)?.loaded; }, fixture.vehicle, { timeout: 60_000, polling: 250 });
        const shot = async (when, view) => {
          if (!capture) return;
          await page.evaluate(v => { window.__jjRender.setFollow(v === 'overview' ? null : [0]); window.__jjRender.frame(); window.__jjRender.hold(); }, view);
          await page.screenshot({ path: join(out, `${name}-${run}-${when}-${view}-1920x1080.jpg`), type: 'jpeg', quality: 85 });
        };
        let s = null;
        for (let t = 0; t < fixture.ticks; t += 30) {
          s = await page.evaluate(async () => { await window.__jjTest.step(30); return window.__jjTest.observe(); });
          if (t === 180) await shot('mid', 'chase');
        }
        await shot('end', 'chase');
        await shot('end', 'overview');
        await page.evaluate(() => { window.__jjRender.setFollow([0]); window.__jjRender.frame(); window.__jjRender.hold(); });
        const drawn = await page.evaluate(id => window.__jjRender.vehicles().vehicles.find(v => v.id === id), fixture.vehicle);
        assert.ok(drawn?.cars > 0, `${run}: the TV draws the ${fixture.vehicle}: ${JSON.stringify(drawn)}`);
        const car = s.cars[0];
        const y = car.position[1];
        assert.ok(y >= height.min && y <= height.max, `${run}: ends ${y.toFixed(2)} m up, envelope [${height.min}, ${height.max}]`);
        assert.ok(car.upY > 0.5, `${run}: on its wheels (upY ${car.upY})`);
        await page.close();
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
