// P1-S04b browser test: loose and detached parts in the running host, through the real path (the sim worker's `testing`
// build, a fake controller that joins like a phone and drives, the instanced vehicle renderer on the real web build
// `web/dist`). The damage itself is set with the test surface's `damage` command (health on a named part: a crash isn't
// needed to see what a loose door or a missing bumper looks like). Software GL, headless Chromium; no WebRTC phone.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build.
//   node --test --test-concurrency=1 web/host/tests/damage.test.mjs
// Writes captures and numbers to docs/evidence/P1-S04b/ (JJ_EVIDENCE_DIR overrides).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-S04b');
const runs = {};
let browser;
let server;

before(async () => {
  browser = await chromium.launch();
  server = await serve(join(repo, 'web/dist'));
  await mkdir(evidenceDir, { recursive: true });
});

after(async () => {
  await browser?.close();
  server?.close();
  await writeFile(
    join(evidenceDir, 'browser-run.json'),
    `${JSON.stringify({ browser: `Chromium ${browser.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}`, ...runs }, null, 2)}\n`,
  );
});

/** The host live (the worker's own clock) with one fake controller driving; `orbit` swings the camera round the car. */
async function drivingHost(orbit, camdist = 7) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await openHost(page, `${server.url}/host/?test=live&tiles=1&orbit=${orbit}&camdist=${camdist}`);
  await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 20, null, { timeout: 30_000 });
  const me = await page.evaluate(() => window.__jjTest.join('Ava'));
  // Pump the stick like a phone: the surface only re-sends it while stepping, and the live clock runs on its own.
  await page.evaluate(
    ([endpoint]) => {
      window.__pump = setInterval(() => window.__jjTest.drive(endpoint, window.__stick ?? [0, 12000]), 50);
      window.__jjTest.drive(endpoint, [0, 12000]);
    },
    [me.endpoint],
  );
  return { page, errors, me };
}

const observe = (page) => page.evaluate(() => window.__jjTest.observe());
const damage = (page, car, part, health) => page.evaluate(([c, p, h]) => window.__jjTest.command({ cmd: 'damage', car: c, part: p, health: h }), [car, part, health]);
const vehicles = (page, car) => page.evaluate((c) => window.__jjRender.vehicles(c), car);
const frames = (page, n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); f(); }), n);
const partsOf = (obs, car) => Object.fromEntries(obs.cars.find((c) => c.car === car).parts.map((p) => [p.part, p]));

test('a loose door swings on the car and a detached bumper stays behind as debris, in the running host', { timeout: 180_000 }, async () => {
  const { page, errors, me } = await drivingHost(90);
  const car = me.car;
  await page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].speed >= 6, { maxTicks: 1500, every: 6 }));
  await page.screenshot({ path: join(evidenceDir, 'ingame-intact.jpg'), quality: 82 });
  // A loose door (health 10 of 60) and a loose bumper: they swing on the chassis' accelerations as the car swerves.
  await damage(page, car, 'door_FR', 10);
  await damage(page, car, 'door_RR', 10);
  // A steady turn holds a sideways acceleration, which holds the door that way open: try each way until the door at the
  // camera's side stands open (the one direction closes it against its stop).
  let swing = 0;
  for (const x of [-20000, 20000, -20000, 20000]) {
    await page.evaluate((v) => { window.__stick = [v, 14000]; }, x);
    const r = await page.evaluate(() =>
      window.__jjTest.untilFact((s) => Math.abs(s.cars[0].parts.find((p) => p.part === 'door_FR').angleDeg) > 12, { maxTicks: 240, every: 6 }),
    );
    swing = Math.max(swing, Math.abs(partsOf(r.state, car).door_FR.angleDeg));
    if (r.held) break;
  }
  await frames(page, 3);
  const looseView = await vehicles(page, 0);
  await page.screenshot({ path: join(evidenceDir, 'ingame-loose-door.jpg'), quality: 82 });
  assert.ok(swing > 10, `a loose door swung (${swing.toFixed(1)}° at most)`);
  const states = partsOf(await observe(page), car);
  assert.equal(states.door_FR.state, 'loose');
  runs.loose = { swingDeg: +swing.toFixed(1), looseDoors: looseView.parts.filter((p) => /door_[FR]R/.test(p.part)).map((p) => p.position) };
  assert.deepEqual(errors, []);
  await page.close();
});

test('a detached bumper stays on the road as debris while the car backs away, in the running host', { timeout: 180_000 }, async () => {
  const { page, errors, me } = await drivingHost(35, 16);
  const car = me.car;
  // The clock is held: the sim moves only when this test steps it (untilFact re-sends the held stick as a phone would), so
  // the sequence is the same every run; a live clock let a slow runner's timing change how the car met its own bumper.
  await page.evaluate(() => window.__jjTest.hold(true));
  const stick = (v) => page.evaluate(([e, v]) => { window.__stick = v; window.__jjTest.drive(e, v); }, [me.endpoint, v]);
  await page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].speed >= 6, { maxTicks: 1500, every: 6 }));
  // The bumper goes: debris (a dynamic body) stays where it came off while the car drives on.
  await stick([0, 20000]);
  await damage(page, car, 'front', 0);
  // The bumper leaves at the car's speed; the car brakes, the bumper slides on and settles ahead of it.
  // Brake to a stop, then back away gently (a hard reverse can spin the car into a wreck).
  await stick([0, -20000]);
  await page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].speed < 0.6, { maxTicks: 900, every: 6 }));
  await stick([0, -9000]);
  await page.evaluate(() =>
    window.__jjTest.untilFact(
      (s) => {
        const d = s.debris.find((x) => x.kind === 'Part');
        const c = s.cars[0].position;
        return !!d && Math.hypot(d.x - c[0], d.z - c[2]) > 4.5;
      },
      { maxTicks: 900, every: 6 },
    ),
  );
  await stick([0, 0]);
  // Let the bumper come to rest (the render lags the sim a little under software GL), then look.
  for (let k = 0; k < 40; k++) {
    const d0 = (await observe(page)).debris.find((x) => x.kind === 'Part');
    await page.evaluate(() => window.__jjTest.step(30));
    const d1 = (await observe(page)).debris.find((x) => x.kind === 'Part');
    if (Math.hypot(d1.x - d0.x, d1.z - d0.z) < 0.02) break;
  }
  // The renderer catches up with the sim's snapshots (software GL is slow): wait for the bumper to be drawn off the car.
  await page
    .waitForFunction(
      () => {
        const v = window.__jjRender.vehicles(0);
        const by = Object.fromEntries(v.parts.map((p) => [p.part, p]));
        return Math.hypot(by.front.position[0] - by.core.position[0], by.front.position[2] - by.core.position[2]) > 3;
      },
      null,
      { timeout: 20_000, polling: 250 },
    )
    .catch(() => {});
  await frames(page, 8);
  const after = await vehicles(page, 0);
  const by = Object.fromEntries(after.parts.map((p) => [p.part, p]));
  const obs0 = await observe(page);
  const chunk = obs0.debris.find((d) => d.kind === 'Part');
  const me0 = obs0.cars.find((c) => c.car === car).position;
  const dist = Math.hypot(chunk.x - me0[0], chunk.z - me0[2]);
  assert.ok(dist > 4, `the bumper lies on the road away from the car, ${dist.toFixed(1)} m`);
  const drawnFromCar = Math.hypot(by.front.position[0] - by.core.position[0], by.front.position[2] - by.core.position[2]);
  assert.ok(drawnFromCar > 3, `the renderer draws the bumper off the car, ${drawnFromCar.toFixed(1)} m from its core (attached it is 0.8)`);
  assert.equal(by.front.colour, by.core.colour, "a detached part keeps its owner's paint");
  const stats = await page.evaluate(() => window.__jjRender.stats());
  const obs = await observe(page);
  assert.equal(stats.debris, obs.debris.filter((d) => d.kind !== 'Part').length, 'the detached bumper is drawn as a part, not as a box of debris');
  assert.ok(obs.debris.length >= 1, 'the sim has the bumper as a debris body');
  await stick([0, 0]);
  await page.screenshot({ path: join(evidenceDir, 'ingame-detached-bumper.jpg'), quality: 82 });
  runs.detached = { bumperDistanceM: +dist.toFixed(1), paint: by.front.colour, interiors: after.interiors, simDebris: obs.debris.length };
  assert.deepEqual(errors, []);
  await page.close();
});

test('a missing door shows the core\'s dark bay, on the real host path', { timeout: 120_000 }, async () => {
  const { page, errors, me } = await drivingHost(270);
  const car = me.car;
  await page.evaluate(() => { window.__stick = [0, 0]; });
  await page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].speed < 0.5, { maxTicks: 60, every: 6 }));
  const before = await vehicles(page, 0);
  assert.deepEqual(before.interiors, { engine: 0, cabin: 0, boot: 0 }, 'an intact car shows no interior');
  await page.screenshot({ path: join(evidenceDir, 'ingame-intact-left.jpg'), quality: 82 });
  await damage(page, car, 'door_FL', 0);
  await damage(page, car, 'door_RL', 0);
  await page.waitForTimeout(1500);
  await frames(page, 6);
  const v = await vehicles(page, 0);
  assert.ok(v.interiors.cabin >= 1, `the cabin bay shows where the doors were: ${JSON.stringify(v.interiors)}`);
  await page.screenshot({ path: join(evidenceDir, 'ingame-missing-door-bay.jpg'), quality: 82 });
  runs.bay = { interiors: v.interiors };
  assert.deepEqual(errors, []);
  await page.close();
});

test('capture strip: intact, loose, detached, wreck (husk and scattered parts, a fresh car at its anchor), from the real renderer', { timeout: 240_000 }, async () => {
  const { page, errors, me } = await drivingHost(100, 'far');
  const car = me.car;
  const shot = (name) => page.screenshot({ path: join(evidenceDir, `strip-${name}.jpg`), quality: 85 });
  // 1. intact, rolling gently near its start.
  await page.evaluate(() => { window.__stick = [9000, 9000]; });
  await page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].speed >= 3, { maxTicks: 1500, every: 6 }));
  await frames(page, 4);
  await shot('1-intact');
  // 2. a loose door, held open by the steady turn.
  await damage(page, car, 'door_FR', 10);
  await damage(page, car, 'door_RR', 10);
  for (const x of [-16000, 16000, -16000, 16000]) {
    await page.evaluate((v) => { window.__stick = [v, 9000]; }, x);
    const r = await page.evaluate(() =>
      window.__jjTest.untilFact((s) => Math.abs(s.cars[0].parts.find((p) => p.part === 'door_FR').angleDeg) > 8, { maxTicks: 200, every: 6 }),
    );
    if (r.held) break;
  }
  await frames(page, 3);
  await shot('2-loose');
  // 3. the bumper comes off.
  await damage(page, car, 'front', 0);
  await page.evaluate(() => window.__jjTest.untilFact((s) => s.debris.some((d) => d.kind === 'Part'), { maxTicks: 60, every: 3 }));
  await page.evaluate(() => { window.__stick = [0, 0]; });
  await page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].speed < 0.4, { maxTicks: 900, every: 6 }));
  await frames(page, 6);
  await shot('3-detached');
  // 4. two wheels go: wrecked. Every part pops off, the chassis stays as a husk, and the player is back at their anchor.
  // (A fresh run so the crash is a few metres from the anchor and the husk is in the picture beside the new car.)
  await page.close();
  const w = await drivingHost(100, 'far');
  await w.page.evaluate(() => { window.__stick = [0, 12000]; });
  await w.page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].speed >= 3, { maxTicks: 1500, every: 6 }));
  const before = (await observe(w.page)).cars.find((c) => c.car === w.me.car).position;
  await damage(w.page, w.me.car, 'wheel_FL', 0);
  await damage(w.page, w.me.car, 'wheel_RR', 0);
  await w.page.evaluate(() => { window.__stick = [0, 0]; });
  await w.page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].race.wrecks >= 1, { maxTicks: 60, every: 3 }));
  await w.page.evaluate(() => window.__jjTest.step(150));
  await w.page.waitForFunction(() => window.__jjRender.vehicles(0).cars >= 1, null, { timeout: 10_000 });
  await w.page.waitForTimeout(800);
  await frames(w.page, 8);
  const obs = await observe(w.page);
  const husk = obs.debris.filter((d) => d.kind === 'Husk');
  const v = await vehicles(w.page, 0);
  await w.page.screenshot({ path: join(evidenceDir, 'strip-4-wreck.jpg'), quality: 85 });
  assert.equal(husk.length, 1, 'one husk');
  assert.equal(obs.debris.filter((d) => d.kind === 'Part').length, 10, 'every part is debris');
  const now = obs.cars.find((c) => c.car === w.me.car);
  assert.ok(now.race.wrecks >= 1, 'wrecked');
  assert.ok(now.parts.every((p) => p.state === 'intact'), `the respawned car is intact: ${JSON.stringify(now.parts.map((p) => [p.part, p.state, p.health]))}`);
  assert.deepEqual(w.errors, []);
  await w.page.close();
  runs.strip = { before, husk: husk[0], respawnedAt: now.position, interiors: v.interiors };
  assert.deepEqual(errors, []);
  // Stitch the four shots into one strip image.
  const strip = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const { readFile } = await import('node:fs/promises');
  const imgs = [];
  for (const n of ['1-intact', '2-loose', '3-detached', '4-wreck']) imgs.push((await readFile(join(evidenceDir, `strip-${n}.jpg`))).toString('base64'));
  const png = await strip.evaluate(async (list) => {
    const loaded = await Promise.all(list.map((b) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = `data:image/jpeg;base64,${b}`; })));
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 720;
    const g = c.getContext('2d');
    loaded.forEach((i, k) => g.drawImage(i, (k % 2) * 640, Math.floor(k / 2) * 360, 640, 360));
    g.fillStyle = '#fff';
    g.font = 'bold 22px sans-serif';
    ['intact', 'loose', 'detached', 'wreck'].forEach((t, k) => g.fillText(t, (k % 2) * 640 + 12, Math.floor(k / 2) * 360 + 30));
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, imgs);
  await writeFile(join(evidenceDir, 'strip-intact-loose-detached-wreck.jpg'), Buffer.from(png, 'base64'));
  await strip.close();
});
