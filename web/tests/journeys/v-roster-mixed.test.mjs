// br-bwju.7 (R123): every car picks its own vehicle. Two phones pick the Cruz Missile and the Tradie Ute in the lobby picker,
// both drive, the sim's introspection shows each car's own mass and engine force, and the TV draws each car's own model (the
// renderer loaded both bakes). A second page shows a mixed grid from the synthetic source. Real host page and phones over
// loopback WebRTC, headless Chromium (software GL):
//   node --test web/tests/journeys/v-roster-mixed.test.mjs
// `JJ_CAPTURE_DIR=<dir>` saves the visual self-review images (docs/evidence/br-bwju.7/).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/vroster/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'vroster'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};
const observe = (host) => host.evaluate(() => window.__jjTest.observe());

async function phone(joinUrl, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  return page;
}

/** Opens the car picker, looks at the car called `car`, and presses Done. */
async function pick(page, car) {
  await page.getByRole('button', { name: /^Car/ }).click();
  await page.locator('[data-overlay=cars]').waitFor();
  await page.locator(`.thumb[aria-label="${car}"]`).dispatchEvent('click');
  return page;
}

test('two phones pick a Cruz Missile and a Tradie Ute; each car has its own profile and its own model on the TV', { timeout: 300_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?drive&test=live&tune`);
  await wait(host, () => window.__jjNet?.code() && window.__jjTest && window.__jjTune, undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const a = await phone(joinUrl, 'Davo');
  const b = await phone(joinUrl, 'Shazza');
  await wait(host, () => window.__jjRoom.view().seats.length === 2);

  // The picker offers every roster vehicle, from the roster data.
  await pick(a, 'Cruz Missile');
  assert.deepEqual(await a.locator('.thumb').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Cruz Missile', 'Tradie Ute']);
  await shot(a, 'phone-picker-cruz-844x390');
  await a.getByRole('button', { name: 'Done' }).click();
  await pick(b, 'Tradie Ute');
  await shot(b, 'phone-picker-ute-844x390');
  await b.getByRole('button', { name: 'Done' }).click();
  await wait(host, () => {
    const s = window.__jjRoom.view().seats;
    return s.find((x) => x.name === 'Davo')?.vehicle === 'cruz-missile' && s.find((x) => x.name === 'Shazza')?.vehicle === 'tradie-ute';
  });

  // Both drive: left stick forward.
  const go = (p) => p.evaluate(() => window.__jjController.setSticks({ x: 0, y: -1, touch: true }, { x: 0, y: 0, touch: false }));
  await go(a);
  await go(b);
  let seen;
  for (const t0 = Date.now(); ; await host.waitForTimeout(150)) {
    seen = await observe(host);
    const cars = seen.cars.filter((c) => c.forwardSpeed > 3);
    if (cars.length === 2) break;
    assert.ok(Date.now() - t0 < 60_000, `both cars never drove: ${JSON.stringify(seen.cars.map((c) => [c.car, c.forwardSpeed]))}`);
  }
  // jj probe: each car's own profile (vehicle index, mass, engine force).
  const byVehicle = Object.fromEntries(seen.cars.map((c) => [c.vehicle, c]));
  assert.deepEqual(Object.keys(byVehicle).sort(), ['0', '1'], 'one car of each vehicle');
  console.log(`# probe: ${JSON.stringify(seen.cars.map((c) => ({ car: c.car, vehicle: c.vehicle, massKg: c.massKg, maxEngineForce: c.maxEngineForce })))}`);
  assert.ok(byVehicle[1].massKg > byVehicle[0].massKg * 1.3, 'the ute is the heavier car');
  assert.notEqual(byVehicle[1].maxEngineForce, byVehicle[0].maxEngineForce);

  // The TV draws each car's own model: both bakes are loaded and each has its car.
  await wait(host, () => window.__jjRender.vehicles()?.vehicles.every((v) => v.loaded && v.cars === 1), undefined, 30_000);
  const drawn = await host.evaluate(() => window.__jjRender.vehicles());
  console.log(`# renderer: ${JSON.stringify(drawn.vehicles)} draws/tile ${drawn.drawsPerTile}`);
  assert.deepEqual(drawn.vehicles.map((v) => v.id), ['cruz-missile', 'tradie-ute']);
  await host.waitForTimeout(800);
  await shot(host, 'tv-mixed-two-cars-1280x720');

  // Each car's engine sound is its own vehicle's profile (the audio surface lists them even with the context locked).
  await wait(host, () => window.__jjAudio?.engines().length === 2);
  const engines = await host.evaluate(() => window.__jjAudio.engines().map((e) => [e.car, e.profile]));
  assert.deepEqual(
    engines.sort((x, y) => x[0] - y[0]),
    [
      [byVehicle[0].car, 'cruz-missile'],
      [byVehicle[1].car, 'tradie-ute'],
    ],
  );

  // The tuning menu follows the selected vehicle: tuning a ute row changes only utes.
  await host.locator('.jj-tune-toggle').click();
  await host.locator('[data-tune-vehicle]').selectOption('tradie-ute');
  const field = host.locator('[data-field="max_engine_force"]');
  await wait(host, (v) => window.__jjTune.inspect().current.max_engine_force === v, byVehicle[1].maxEngineForce, 10_000);
  assert.equal(Number(await field.inputValue()), byVehicle[1].maxEngineForce, "the rows show the ute's tuning");
  await shot(host, 'tv-tuning-ute-1280x720');
  await field.fill('20000');
  await field.dispatchEvent('change');
  await wait(host, () => window.__jjTune.inspect().current.max_engine_force === 20000, undefined, 5_000);
  const tuned = await observe(host);
  assert.equal(tuned.cars.find((c) => c.vehicle === 1).maxEngineForce, 20000, 'the ute car takes it');
  assert.equal(tuned.cars.find((c) => c.vehicle === 0).maxEngineForce, byVehicle[0].maxEngineForce, 'the Cruz car does not');
  const patch = (await host.evaluate(() => window.__jjTune.inspect())).patch;
  assert.deepEqual(patch.set, [['max_engine_force', '20000']]);
  assert.equal(patch.profile, 'assets/profiles/tradie-ute.json');
  assert.deepEqual(errors, []);
});

test('a mixed grid: every roster vehicle drawn from its own bake (synthetic source)', { timeout: 120_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?synthetic=12&vehicles=mixed&freeze=240`);
  await wait(host, () => window.__jjRender?.vehicles()?.vehicles.every((v) => v.loaded && v.cars > 0), undefined, 60_000);
  const v = await host.evaluate(() => window.__jjRender.vehicles());
  assert.deepEqual(v.vehicles.map((x) => x.cars), [6, 6], 'twelve cars alternate the two vehicles');
  await host.waitForTimeout(1000);
  await shot(host, 'tv-mixed-grid-12-1920x1080');
  assert.deepEqual(errors, []);
});
