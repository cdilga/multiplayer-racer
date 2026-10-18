// P1-M10: the derby bowl in the real host, from a fixed harness camera over the whole bowl (`?overview=arena`; the game's
// Overview frames the cars, P1-R11), at 8 and 32 cars on the generated arenas (maps/derby-bowl-<n>.json). Every car is placed on the floor and stays in
// the bowl; the rocks dressing (domes, quarry faces) stands in frame outside the bowl and never over its floor (R107); the
// field's jumps are painted in their own frame over every bare rock sample (br-qb0l).
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
        // The field's island (P1-M-arena-features) stands on the floor by design: squat rocks wholly inside it.
        const island = toward + r < floorM && h <= 2.5;
        return { kit: d.kitPiece, island, distM: toward - r, centre: P(x, h / 2, z), top: P(x + ux * r, h, z + uz * r) };
      });
      return {
        cars: s.cars.map((c) => ({ car: c.car, distM: Math.hypot(c.position[0] - cx, c.position[2] - cz), y: c.position[1], upY: c.upY, onScreen: onScreen(P(...c.position)) })),
        rocksInFrame: rocks.filter((r) => onScreen(r.centre)).length,
        island: rocks.filter((r) => r.island).length,
        rocksInsideBowl: rocks.filter((r) => !r.island && r.distM < outerM).map((r) => r.kit),
        rocksOverFloor: rocks.filter((r) => !r.island && inside(r.top)).map((r) => r.kit),
      };
    })(), { dressing: map.dressing, cx, cz, outerM, floorM });
    assert.equal(seen.cars.length, cars, `${cars} cars placed`);
    const strays = seen.cars.filter((c) => c.distM > outerM || c.upY < 0.9);
    assert.deepEqual(strays, [], `every car upright in the bowl (outer radius ${outerM} m)`);
    assert.ok(seen.cars.every((c) => c.onScreen), 'the overview frames every car');
    assert.ok(seen.rocksInFrame > 0, `the rocks dressing is in frame: ${JSON.stringify(seen)}`);
    assert.ok(seen.island >= 1, `the field's island stands on the floor: ${seen.island}`);
    assert.deepEqual(seen.rocksInsideBowl, [], 'no rock inside the bowl but the island');
    assert.deepEqual(seen.rocksOverFloor, [], 'no rock stands over the floor on screen');
    // br-qb0l: the field's jumps as the terrain paints them (render/map/relief.ts), recovered from the heights: one per bare
    // rock patch on the floor, covering every one of its samples, with the field's slopes (ramps 0.15-0.23, sides about
    // 0.45), a 0.1 m snapped height, and foot < lip <= lip < foot along and across.
    const relief = await page.evaluate(() => window.__jjRender.map().relief);
    const t = map.terrain;
    const floorRock = [];
    for (let i = 0; i < t.rows; i++) for (let j = 0; j < t.cols; j++) {
      const [x, z] = [(t.originX + j * t.spacing) / 1000, (t.originZ + i * t.spacing) / 1000];
      if (t.surfaces[i * t.cols + j] === 'rock' && Math.hypot(x - cx, z - cz) < floorM) floorRock.push([x, z]);
    }
    const local = (J, [x, z]) => [(x - J.c[0]) * J.dir[0] + (z - J.c[1]) * J.dir[1], -(x - J.c[0]) * J.dir[1] + (z - J.c[1]) * J.dir[0]];
    const uncovered = floorRock.filter((s) => !relief.some((J) => {
      const [u, v] = local(J, s);
      return u >= J.foot[0] - 1e-6 && u <= J.foot[1] + 1e-6 && v >= J.side[0] - 1e-6 && v <= J.side[1] + 1e-6;
    }));
    assert.ok(relief.length >= 2, `the field's jumps are painted: ${relief.length}`);
    assert.deepEqual(uncovered, [], 'every bare rock sample on the floor is inside a painted jump');
    for (const J of relief) {
      const r = (v) => Math.round(v * 100) / 100;
      const what = JSON.stringify({ c: J.c, foot: J.foot.map(r), lip: J.lip.map(r), side: J.side.map(r), top: J.top.map(r), slope: J.slope.map(r), height: J.height });
      assert.ok(J.slope.slice(0, 2).every((s) => s > 0.12 && s < 0.27) && J.slope.slice(2).every((s) => s > 0.33 && s < 0.55), `field slopes: ${what}`);
      assert.ok(Math.abs(J.height * 10 - Math.round(J.height * 10)) < 1e-6 && J.height >= 0.5 && J.height <= 1.4, `height: ${what}`);
      assert.ok(J.foot[0] < J.lip[0] && J.lip[0] <= J.lip[1] && J.lip[1] < J.foot[1] && J.side[0] < J.top[0] && J.top[0] <= J.top[1] && J.top[1] < J.side[1], `ordered: ${what}`);
    }
    const file = `overview-${cars}-cars-1920x1080.jpg`;
    await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
    writeFileSync(join(out, `overview-${cars}-cars.json`), JSON.stringify({ browser: 'chromium', cars, outerM, floorM, rocksInFrame: seen.rocksInFrame, farthestCarM: Math.max(...seen.cars.map((c) => c.distM)) }, null, 2) + '\n');
    assert.deepEqual(errors, []);
    await page.close();
  });
}
