// P1-FL04.2 self-review captures: the arcade controller as the TV draws it. On the flat skidpad, (1) the Tradie Ute
// (rear drive) rolls at 6 m/s on full lock, then the throttle is punched: the tail swings out, then the stick is centred
// and the throttle eased so the slide is caught; (2) the Cruz Missile (front drive) at 20 m/s throws full lock: it turns
// in at once. Each still is a known tick; the observed speed, yaw rate and slide are printed beside each file.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build.
//   node web/host/tests/slide-capture.mjs --out <dir>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const repo = resolve(import.meta.dirname, '../../..');
const out = resolve(arg('--out', 'slide-capture'));
const mapPath = join(repo, 'maps/test/skidpad.json');
const runs = [
  {
    name: 'ute-punch',
    profile: 'tradie-ute',
    speed: 6,
    inputs: [
      { car: 0, fromTick: 0, toTick: 48, steer: 1.0 },
      { car: 0, fromTick: 48, toTick: 168, steer: 1.0, throttle: 1.0 },
      { car: 0, fromTick: 168, throttle: 0.3 },
    ],
    at: [48, 72, 96, 120, 168, 230],
  },
  {
    name: 'cruz-turn-in',
    profile: 'cruz-missile',
    speed: 20,
    inputs: [
      { car: 0, fromTick: 0, toTick: 60, throttle: 0.5 },
      { car: 0, fromTick: 60, throttle: 0.5, steer: 1.0 },
    ],
    at: [60, 75, 90, 120, 180],
  },
];

const dist = join(repo, 'web/dist');
await mkdir(join(dist, 'capture-maps'), { recursive: true });
await copyFile(mapPath, join(dist, 'capture-maps/skidpad.json'));
await mkdir(out, { recursive: true });
const mapJson = await readFile(mapPath, 'utf8');
const server = await serve(dist);
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist'] });
const shots = [];
try {
  for (const run of runs) {
    const profileJson = await readFile(join(repo, `assets/profiles/${run.profile}.json`), 'utf8');
    const fixture = {
      scenario: run.name,
      what: `P1-FL04.2 self-review capture: ${run.name}`,
      map: 'capture',
      seed: 1,
      ticks: 600,
      cars: [{ pose: { x: 0, y: 0.1, z: -300, headingDeg: 0 }, linvel: [0, 0, run.speed] }],
      inputs: run.inputs,
      expect: [],
    };
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openHost(page, `${server.url}/host/?test&tiles=1&mapUrl=${encodeURIComponent('/capture-maps/skidpad.json')}`);
    await page.evaluate(async ([fx, mj, pj]) => window.__jjTest.load(fx, mj, pj), [fixture, mapJson, profileJson]);
    let tick = 0;
    for (const at of run.at) {
      await page.evaluate((k) => window.__jjTest.step(k), at - tick);
      tick = at;
      await page.waitForTimeout(400); // the renderer catches up with the newest snapshot
      const s = await page.evaluate(() => window.__jjTest.observe());
      const car = s.cars[0];
      const file = `${run.name}-t${at}.jpg`;
      await page.screenshot({ path: join(out, file), quality: 80 });
      shots.push({ file, tick: s.tick, forwardSpeed: car.forwardSpeed, yawDegS: (car.angvel?.[1] ?? 0) * (180 / Math.PI), headingDeg: car.headingDeg, slide: car.action?.slide, upY: car.upY });
    }
    if (errors.length) throw new Error(`${run.name}: ${errors.join('; ')}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
const meta = { map: 'maps/test/skidpad.json', browser: 'Chromium (Playwright headless, software GL)', shots };
await writeFile(join(out, 'capture.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify(meta, null, 2));
