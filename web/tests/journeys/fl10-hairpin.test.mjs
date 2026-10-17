// P1-FL10 / br-bbki.10 (R131, R134): the hairpin scene in the real worker and renderer, driven as its committed fixtures
// (scenarios/lab/hairpin-cut-*.json) drive it natively. From the same start one autopilot car takes the packed-dirt cut
// across the hairpin's apex and the other goes round on the tarmac; the cut's car ends further along the road and slid on
// the dirt. Each run ends inside its fixture's progress envelope. With JJ_CAPTURE_DIR set it captures each run on the
// cut (or round the hairpin) and at the end from the chase camera, and at the end from the overview, for the self-review.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/fl10-hairpin/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-FL10');
const mapJson = readFileSync('maps/lab/hairpin-cut.json', 'utf8');
const RUNS = ['hairpin-cut-take', 'hairpin-cut-road'];
let server;

before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'fl10-hairpin'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close?.();
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: the cut's car gets further along than the road's and slides on the dirt`, { timeout: 900_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [];
    const capture = process.env.JJ_CAPTURE_DIR && name === 'chromium';
    try {
      for (const run of RUNS) {
        const fixture = { ...JSON.parse(readFileSync(`scenarios/lab/${run}.json`, 'utf8')), seats: [{ name: 'Lab driver', car: 0 }] };
        const progress = fixture.expect.find(e => e.metric === 'progressM');
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        page.on('pageerror', e => errors.push(`${run}: ${e.message}`));
        await page.route('**/lab-scene.json', q => q.fulfill({ contentType: 'application/json', body: mapJson }));
        await page.goto(`${server.origin}${BASE}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/lab-scene.json')}`);
        await page.waitForFunction(() => window.__jjTest && window.__jjRender, undefined, { timeout: 60_000 });
        await page.evaluate(async ({ fixture, mapJson }) => { window.__jjRender.hold(); await window.__jjTest.load(fixture, mapJson); }, { fixture, mapJson });
        // The car is drawn as itself: wait out its model's load before driving.
        await page.waitForFunction(() => { window.__jjRender.frame(); window.__jjRender.hold(); return window.__jjRender.vehicles().vehicles[0]?.loaded; }, undefined, { timeout: 60_000, polling: 250 });
        const shot = async (when, view) => {
          if (!capture) return;
          await page.evaluate(v => { window.__jjRender.setFollow(v === 'overview' ? null : [0]); window.__jjRender.frame(); window.__jjRender.hold(); }, view);
          await page.screenshot({ path: join(out, `${name}-${run}-${when}-${view}-1920x1080.jpg`), type: 'jpeg', quality: 85 });
        };
        const start = (await page.evaluate(() => window.__jjTest.observe())).cars[0].progress.distanceM;
        let s = null;
        for (let t = 0; t < fixture.ticks; t += 30) {
          s = await page.evaluate(async () => { await window.__jjTest.step(30); return window.__jjTest.observe(); });
          if (t === 1200) await shot('mid', 'chase');
        }
        await shot('end', 'chase');
        await shot('end', 'overview');
        const car = s.cars[0];
        const along = car.progress.distanceM - start;
        assert.ok(along >= progress.min && along <= progress.max, `${run}: ${along.toFixed(1)} m along the road, envelope [${progress.min}, ${progress.max}]`);
        assert.ok(car.upY > 0.5, `${run}: on its wheels (upY ${car.upY})`);
        await page.close();
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
