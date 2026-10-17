// P1-FL07 / br-bbki.7 (R129): the same canyon leap flown three ways in the real worker and renderer, as the committed
// fixtures (scenarios/lab/air-pitch-*.json) fly it natively: a brake tap noses it down and lands clean, a throttle tap
// raises the nose and lands hard, the throttle floored in the air (or pinned from the start) over-rotates it (br-bbki.24:
// air pitch follows the wheels). The sim's judgement reaches the TV as a callout over the car ("CLEAN LANDING! BOOST",
// "HARD LANDING!", "STACKED IT!"); a neutral, OK landing says nothing. With JJ_CAPTURE_DIR set it captures each landing
// from the chase camera and a side angle for the visual self-review.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/fl07-landing/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-FL07');
const mapJson = readFileSync('maps/lab/canyon-leap.json', 'utf8');
// Each run: its fixture, the tiers the sim may judge (LandingTier as observe reports it) and the callout the TV shows.
const RUNS = [
  { run: 'air-pitch-neutral', tiers: ['Ok'], callout: null },
  { run: 'air-pitch-down', tiers: ['Clean'], callout: 'Clean' },
  { run: 'air-pitch-up', tiers: ['Bad'], callout: 'Bad' },
  { run: 'air-pitch-crash', tiers: ['Bad', 'Crash'], callout: ['Bad', 'Crash'] },
  { run: 'air-pitch-pinned', tiers: ['Bad', 'Crash'], callout: ['Bad', 'Crash'] },
];
let server;

before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'fl07-landing'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close?.();
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: brake noses down and lands clean, throttle noses up and lands hard, a pinned throttle over-rotates, and the TV calls each one out`, { timeout: 900_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [];
    try {
      for (const r of RUNS) {
        const fixture = { ...JSON.parse(readFileSync(`scenarios/lab/${r.run}.json`, 'utf8')), seats: [{ name: 'Lab driver', car: 0 }] };
        for (const view of process.env.JJ_CAPTURE_DIR ? ['chase', 'side'] : ['chase']) {
          const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
          page.on('pageerror', e => errors.push(`${r.run}: ${e.message}`));
          await page.route('**/lab-scene.json', q => q.fulfill({ contentType: 'application/json', body: mapJson }));
          await page.goto(`${server.origin}${BASE}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off${view === 'side' ? '&orbit=75' : ''}&mapUrl=${encodeURIComponent(server.origin + '/lab-scene.json')}`);
          await page.waitForFunction(() => window.__jjTest && window.__jjRender, undefined, { timeout: 60_000 });
          await page.evaluate(async ({ fixture, mapJson }) => { window.__jjRender.hold(); await window.__jjTest.load(fixture, mapJson); }, { fixture, mapJson });
          // Step until the sim has judged the first landing, then a few ticks more for the event to reach the TV.
          let landing = null;
          for (let t = 0; t < fixture.ticks && !landing; t += 3) {
            const s = await page.evaluate(async () => { await window.__jjTest.step(3); return window.__jjTest.observe(); });
            landing = s.cars[0].air.last;
            // Mid-air, just after the run's input in the air has had its effect (br-bbki.24: nose up under throttle,
            // nose down under brake), one still from the side.
            if (process.env.JJ_CAPTURE_DIR && view === 'side' && t === 120) {
              await page.evaluate(() => { window.__jjRender.frame(); window.__jjRender.hold(); });
              await page.screenshot({ path: join(out, `${name}-${r.run}-midair-side-1920x1080.jpg`), type: 'jpeg', quality: 85 });
            }
          }
          assert.ok(landing, `${r.run}: the car landed`);
          assert.ok(r.tiers.includes(landing.tier), `${r.run}: ${JSON.stringify(landing)}`);
          // One frame at once: the callout lasts LANDING_SHOWN_MS of wall time, and a 1080p frame on software GL takes a
          // good part of that.
          await page.evaluate(() => { window.__jjRender.frame(); window.__jjRender.hold(); });
          if (process.env.JJ_CAPTURE_DIR) await page.screenshot({ path: join(out, `${name}-${r.run}-${view}-1920x1080.jpg`), type: 'jpeg', quality: 85 });
          const shown = await page.evaluate(() => window.__jjRender.launchCalloutsShown());
          if (r.callout === null) assert.deepEqual(shown, [], `${r.run}: an OK landing says nothing`);
          else {
            const want = [].concat(r.callout);
            assert.ok(shown.some(s => s.car === 0 && want.includes(s.outcome)), `${r.run}: the TV calls it out: ${JSON.stringify(shown)}`);
            assert.ok((await page.evaluate(() => window.__jjRender.launchCallouts())).includes(0), `${r.run}: the callout is up over the car`);
          }
          await page.close();
        }
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
