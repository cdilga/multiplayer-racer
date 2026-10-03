// P1-R05 browser tests: the per-seat race cameras on the real web build (web/dist) in headless Chromium.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build.
//   node --test web/host/tests/camera.test.mjs
// Writes its captures and numbers to docs/evidence/P1-R05/ (JJ_EVIDENCE_DIR overrides).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R05');
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

async function open(path, viewport = { width: 1920, height: 1080 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  const mode = await openHost(page, `${server.url}/host/${path}`);
  return { page, errors, mode };
}

const frames = (page, n) => page.waitForFunction((k) => (window.__jjRender?.stats().frames ?? 0) >= k, n, { timeout: 30_000 });

test('captures first-person-4 and mixed-fp-tp-12', async () => {
  const shots = {
    'first-person-4': '?synthetic=8&map&tiles=4&cams=fp,fp,fp,fp',
    'mixed-fp-tp-12': '?synthetic=24&map&tiles=12&cams=fp,tp,tp,fp,tp,fp,tp,tp,fp,tp,fp,tp',
  };
  for (const [name, path] of Object.entries(shots)) {
    const { page, errors } = await open(path);
    await frames(page, 30);
    const cams = await page.evaluate(() => window.__jjRender.cameras());
    const fp = Object.values(cams).filter((c) => c.mode === 'fp').length;
    assert.equal(fp, name === 'first-person-4' ? 4 : 5, `${name}: first-person seats`);
    await page.screenshot({ path: join(evidenceDir, `${name}.jpg`), quality: 82 });
    assert.deepEqual(errors, []);
    runs[name] = cams;
    await page.close();
  }
});

test('a respawn cuts the camera (no swoop frames)', async () => {
  // Seat 2 chases synthetic car index 1, which respawns at tick 203 (and every 10 s after), jumping back to its grid
  // slot. The camera must jump with it in one frame (a cut), never glide across.
  const { page, errors } = await open('?synthetic=8&map&tiles=2', { width: 1280, height: 720 });
  await page.waitForFunction(() => (window.__jjRender?.stats().tick ?? 0) > 260, null, { timeout: 60_000 });
  const cams = await page.evaluate(() => window.__jjRender.cameras());
  assert.ok(cams[2].cuts >= 1, `seat 2 cut on the respawn (cuts ${cams[2].cuts})`);
  // The chase holds its preset's offset from the car every frame (the farthest preset: 11.5 m back, 6.2 m up), so a
  // camera gliding across the map after the jump would be far from its car.
  const farthest = Math.hypot(11.5, 6.2);
  for (const seat of [1, 2]) assert.ok(cams[seat].maxGapM <= farthest + 0.05, `seat ${seat}'s camera stayed by its car (max ${cams[seat].maxGapM} m)`);
  assert.deepEqual(errors, []);
  runs.respawn = cams;
  await page.close();
});

test('toggling the camera keeps the meaning of held steering', async () => {
  // A real seat on the sim: Keys A holds throttle and right (W + D). The steer the sim applies, and the way the car
  // turns, are the same in third person, after a toggle to first person, and back.
  const { page, errors, mode } = await open('?test=live&tiles=1', { width: 1280, height: 720 });
  assert.equal(mode, 'test');
  const observe = () => page.evaluate(() => window.__jjTest.observe());
  await page.keyboard.down('KeyW');
  for (const t0 = Date.now(); (await observe()).host.seats.length < 1; await page.waitForTimeout(50)) {
    assert.ok(Date.now() - t0 < 10_000, 'Keys A claimed a seat');
  }
  await page.keyboard.down('KeyD');
  const car = async () => {
    const s = await observe();
    const c = s.cars.find((x) => x.car === s.host.seats[0].car);
    return { tick: s.tick, heading: c.headingDeg, steer: c.input.steer };
  };
  /** Over 60 ticks (0.5 s): the applied steer at the end and the heading change. */
  const measure = async () => {
    const a = await car();
    let b = a;
    for (const t0 = Date.now(); b.tick - a.tick < 60; b = await car()) {
      assert.ok(Date.now() - t0 < 30_000, 'the sim advanced');
      await page.waitForTimeout(40);
    }
    let d = (b.heading - a.heading) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return { steer: b.steer, turn: d };
  };
  for (const t0 = Date.now(); Math.abs((await car()).steer) < 0.5; await page.waitForTimeout(40)) {
    assert.ok(Date.now() - t0 < 10_000, 'the held steer is applied');
  }
  const tp = await measure();
  await page.evaluate(() => window.__jjRender.setCamera(1, 'fp'));
  const fp = await measure();
  await page.evaluate(() => window.__jjRender.setCamera(1, 'tp'));
  const tp2 = await measure();
  const cams = await page.evaluate(() => window.__jjRender.cameras());
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  assert.equal(fp.steer, tp.steer, 'the same applied steer in first person');
  assert.equal(tp2.steer, tp.steer, 'and back in third person');
  assert.ok(Math.abs(tp.turn) > 1, `the car turns (${tp.turn.toFixed(1)}° in 0.5 s)`);
  assert.equal(Math.sign(fp.turn), Math.sign(tp.turn), 'the same way in first person');
  assert.equal(cams[1].mode, 'tp');
  assert.deepEqual(errors, []);
  runs.toggle = { tp, fp, tpAgain: tp2 };
  await page.close();
});
