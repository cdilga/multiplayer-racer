// br-gw74.13.1 (P1-S-fun.1) self-review captures: a Cruz takes a generated map's biggest road-wide jump at speed, drawn by
// the chase camera (one tile) and the overview. The host loads the map (`?mapUrl=`), the test surface places the car
// 10 m before the ramp at `--speed` m/s with full throttle, and the sim is stepped so each still is a known moment of
// the flight (the observed height above the road and whether all four wheels are off are printed beside each file).
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build, and a generated map (`jj procgen --seed N --out d`).
//   node web/host/tests/jump-capture.mjs --map <map.json> --out <dir> [--speed 35]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const repo = resolve(import.meta.dirname, '../../..');
const out = resolve(arg('--out', 'jump-capture'));
const speed = Number(arg('--speed', 35));
const mapPath = resolve(arg('--map'));
const map = JSON.parse(await readFile(mapPath, 'utf8'));

// The biggest road-wide jump (highest lip, then longest table).
const jumps = map.features
  .map((f, i) => ({ f, i }))
  .filter(({ f }) => f.kind === 'jump' && f.params.roadWide === 1)
  .sort((a, b) => b.f.params.lipHeightCm - a.f.params.lipHeightCm || b.f.params.tableLengthMm - a.f.params.tableLengthMm);
if (!jumps.length) throw new Error(`${mapPath} has no road-wide jump`);
const { f: jump, i: feature } = jumps[0];
const pts = map.route.points;
const n = pts.length;
const base = pts.reduce((best, p, i) => (Math.hypot(p.x - jump.pose.x, p.z - jump.pose.z) < Math.hypot(pts[best].x - jump.pose.x, pts[best].z - jump.pose.z) ? i : best), 0);
const start = (base + n - 4) % n;
const [a, b] = [pts[start], pts[(start + 1) % n]];
const len = Math.hypot(b.x - a.x, b.z - a.z);
const linvel = [(speed * (b.x - a.x)) / len, 0, (speed * (b.z - a.z)) / len];
const fixture = {
  scenario: 'jump-capture',
  what: 'self-review capture: a Cruz takes the biggest road-wide jump at speed',
  map: 'capture',
  seed: 1,
  ticks: 600,
  cars: [{ routePoint: start, lateral: 0, linvel }],
  inputs: [{ car: 0, fromTick: 0, throttle: 1.0 }],
  expect: [],
};

const dist = join(repo, 'web/dist');
await mkdir(join(dist, 'capture-maps'), { recursive: true });
await copyFile(mapPath, join(dist, 'capture-maps/jump.json'));
await mkdir(out, { recursive: true });
const server = await serve(dist);
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist'] });
const shots = [];
try {
  for (const [view, query] of [['chase', '&tiles=1'], ['overview', '']]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openHost(page, `${server.url}/host/?test${query}&mapUrl=${encodeURIComponent('/capture-maps/jump.json')}`);
    const mapJson = JSON.stringify(map);
    await page.evaluate(async ([fx, mj]) => window.__jjTest.load(fx, mj), [fixture, mapJson]);
    let tick = 0;
    for (const at of [45, 90, 135, 180, 240]) {
      await page.evaluate((k) => window.__jjTest.step(k), at - tick);
      tick = at;
      await page.waitForTimeout(400); // the renderer catches up with the newest snapshot
      const s = await page.evaluate(() => window.__jjTest.observe());
      const car = s.cars[0];
      const file = `${view}-t${at}.jpg`;
      await page.screenshot({ path: join(out, file), quality: 80 });
      shots.push({ file, tick: s.tick, position: car.position, speed: car.speed ?? car.forwardSpeed, wheels: car.wheelsInContact ?? car.wheels, upY: car.upY });
    }
    if (errors.length) throw new Error(`${view}: ${errors.join('; ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
const meta = { map: mapPath, feature, params: jump.params, speed, startRoutePoint: start, browser: 'Chromium (Playwright headless)', shots };
await writeFile(join(out, 'capture.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta, null, 2));
