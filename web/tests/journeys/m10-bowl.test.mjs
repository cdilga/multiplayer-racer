// P1-M10: the derby bowl in the real host, from a fixed harness camera over the whole bowl (`?overview=arena`; the game's
// Overview frames the cars, P1-R11), at 8 and 32 cars on the generated arenas (maps/derby-bowl-<n>.json). Every car is placed on the floor and stays in
// the bowl; the rocks dressing (domes, quarry faces) stands in frame outside the bowl and never over its floor (R107).
// JJ_CAPTURE_DIR=<dir> keeps the stills for the self-review (docs/evidence/P1-M10/).
//   node --test web/tests/journeys/m10-bowl.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/m10/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-M10');
let server, browser;
before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'm10'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

for (const cars of [8, 32]) {
  test(`the ${cars}-car bowl from the overview: every car on the floor and in the bowl, rocks outside it and never over the floor`, { timeout: 300_000 }, async () => {
    const mapJson = readFileSync(`maps/derby-bowl-${cars}.json`, 'utf8');
    const map = JSON.parse(mapJson);
    const bowl = map.features.find((f) => f.kind === 'bowl');
    const p = bowl.params;
    const outerM = (p.floorRadiusMm + p.bankRadiusMm + p.lipWidthMm) / 1000;
    const floorM = p.floorRadiusMm / 1000;
    const [cx, cz] = [(bowl.pose?.x ?? 0) / 1000, (bowl.pose?.z ?? 0) / 1000];
    const fixture = { scenario: `m10-bowl-${cars}`, what: `P1-M10: ${cars} cars placed in the bowl`, map: `maps/derby-bowl-${cars}.json`, seed: 11, ticks: 240, grid: cars };
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/bowl.json', (r) => r.fulfill({ contentType: 'application/json', body: mapJson }));
    await page.goto(`${server.origin}${BASE}host?test&look=on&res=1&autores=off&overview=arena&mapUrl=${encodeURIComponent(`${server.origin}/bowl.json`)}`);
    await page.waitForFunction(() => window.__jjTest && window.__jjRender);
    await page.evaluate(async ({ fixture, mapJson }) => {
      window.__jjRender.hold();
      await window.__jjTest.load(fixture, mapJson);
      await window.__jjTest.step(240);
    }, { fixture, mapJson });
    await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
    await page.evaluate(async () => {
      for (let i = 0; i < 20; i++) { window.__jjRender.frame(); await new Promise((r) => setTimeout(r, 16)); }
      window.__jjRender.hold();
    });
    const seen = await page.evaluate(({ dressing, cx, cz, outerM, floorM }) => (async () => {
      const s = await window.__jjTest.observe();
      const P = (x, y, z) => window.__jjRender.project(x, y, z);
      const onScreen = ([x, y]) => x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
      // The floor's screen footprint: its rim projected every 10 degrees (a convex polygon).
      const rim = Array.from({ length: 36 }, (_, k) => P(cx + floorM * Math.sin(k * Math.PI / 18), 0, cz + floorM * Math.cos(k * Math.PI / 18)));
      const inside = ([x, y]) => {
        let c = false;
        for (let i = 0, j = rim.length - 1; i < rim.length; j = i++) {
          const [xi, yi] = rim[i], [xj, yj] = rim[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
        }
        return c;
      };
      const rocks = dressing.filter((d) => d.kitPiece.startsWith('rocks/')).map((d) => {
        const [x, z] = [d.pose.x / 1000, d.pose.z / 1000];
        const r = (d.params?.radiusMm ?? 0) / 1000, h = (d.params?.heightCm ?? 0) / 100;
        // A rock's nearest edge to the bowl and its top (where it could stand over the floor on screen).
        const toward = Math.hypot(x - cx, z - cz), ux = (cx - x) / (toward || 1), uz = (cz - z) / (toward || 1);
        return { kit: d.kitPiece, distM: toward - r, centre: P(x, h / 2, z), top: P(x + ux * r, h, z + uz * r) };
      });
      return {
        cars: s.cars.map((c) => ({ car: c.car, distM: Math.hypot(c.position[0] - cx, c.position[2] - cz), y: c.position[1], upY: c.upY, onScreen: onScreen(P(...c.position)) })),
        rocksInFrame: rocks.filter((r) => onScreen(r.centre)).length,
        rocksInsideBowl: rocks.filter((r) => r.distM < outerM).map((r) => r.kit),
        rocksOverFloor: rocks.filter((r) => inside(r.top)).map((r) => r.kit),
      };
    })(), { dressing: map.dressing, cx, cz, outerM, floorM });
    assert.equal(seen.cars.length, cars, `${cars} cars placed`);
    const strays = seen.cars.filter((c) => c.distM > outerM || c.upY < 0.9);
    assert.deepEqual(strays, [], `every car upright in the bowl (outer radius ${outerM} m)`);
    assert.ok(seen.cars.every((c) => c.onScreen), 'the overview frames every car');
    assert.ok(seen.rocksInFrame > 0, `the rocks dressing is in frame: ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.rocksInsideBowl, [], 'no rock inside the bowl');
    assert.deepEqual(seen.rocksOverFloor, [], 'no rock stands over the floor on screen');
    const file = `overview-${cars}-cars-1920x1080.jpg`;
    await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
    writeFileSync(join(out, `overview-${cars}-cars.json`), JSON.stringify({ browser: 'chromium', cars, outerM, floorM, rocksInFrame: seen.rocksInFrame, farthestCarM: Math.max(...seen.cars.map((c) => c.distM)) }, null, 2) + '\n');
    assert.deepEqual(errors, []);
    await page.close();
  });
}
