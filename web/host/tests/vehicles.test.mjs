// P1-R02 browser tests: the instanced vehicle renderer on the real web build (web/dist) in headless Chromium.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build.
//   node --test web/host/tests/vehicles.test.mjs
// Writes its captures and numbers to docs/evidence/P1-R02/ (JJ_EVIDENCE_DIR overrides).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R02');
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

/** Opens the host; any page error or console error (a shader that failed to compile, say) fails the test. */
async function open(path, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await openHost(page, `${server.url}/host/${path}`);
  await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 20, null, { timeout: 30_000 });
  return { page, errors };
}

const inspect = (page, car) => page.evaluate((c) => window.__jjRender.vehicles(c), car);
const stats = (page) => page.evaluate(() => window.__jjRender.stats());

test('a car with loose and detached parts renders in adjacent tiles at different LOD classes from shared buffers', async () => {
  // Car index 2 of the synthetic source has its front and rear-right wheel detached and its rear-left door loose.
  const { page, errors } = await open('?synthetic=3&damage&freeze=440&tiles=2&lods=0,2&follow=2,2&orbit=250,250');
  const s = await stats(page);
  assert.deepEqual(s.lods, [0, 2], 'the two tiles draw LOD0 and LOD2');
  const v = await inspect(page, 2);
  // One buffer per part type, shared by its three LOD meshes, each mesh on its LOD class's layer.
  for (const t of v.types) {
    assert.ok(t.shared, `${t.id} LOD meshes share one buffer`);
    assert.deepEqual(t.layers, [2, 4, 8], `${t.id} LOD layers`);
  }
  assert.equal(v.drawsPerTile, 8, 'core, front, back, four doors and one wheel type');
  // Two tiles: each draws its LOD class's 8 part types, the visible interior blocks (engine and cabin, P1-V03) and the
  // ground and grid (no other LOD's meshes); the shadow map is drawn once for the frame (8 part types), not per tile.
  assert.equal(s.drawCalls, 2 * (8 + 2 + 2) + 8, `draws ${s.drawCalls}`);
  const byPart = Object.fromEntries(v.parts.map((p) => [p.part, p]));
  const paint = byPart.core.colour;
  // Detached parts keep the owner's paint and lie away from the car; intact ones sit on it.
  for (const id of ['front', 'wheel_RR']) {
    assert.equal(byPart[id].colour, paint, `${id} keeps the owner's paint`);
    const d = Math.hypot(byPart[id].position[0] - byPart.core.position[0], byPart[id].position[2] - byPart.core.position[2]);
    assert.ok(d > 2.5, `${id} is off the car (${d.toFixed(2)} m)`);
  }
  // Interior blocks (P1-V03) draw only where exposed: car 2's front, rear door and back expose engine, cabin and boot
  // for that car alone; the undamaged car 0 exposes none (car 1's loose door adds a cabin).
  assert.deepEqual(v.interiors, { engine: 1, cabin: 2, boot: 0 });
  const near = Math.hypot(byPart.wheel_FL.position[0] - byPart.core.position[0], byPart.wheel_FL.position[2] - byPart.core.position[2]);
  assert.ok(near < 2, 'an intact wheel is on the car');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(evidenceDir, 'damage-lod0-lod2.jpg'), quality: 80 });
  runs.damage = { lods: s.lods, drawCalls: s.drawCalls, parts: v.parts };
  await page.close();
});

test('instance buffers grow past their initial size without a cap, and draws stay constant in N', async () => {
  const counts = {};
  for (const n of [4, 40, 130]) {
    const { page, errors } = await open(`?synthetic=${n}&damage`);
    const v = await inspect(page);
    const s = await stats(page);
    assert.equal(v.cars, n);
    assert.ok(v.capacity >= n, `capacity ${v.capacity} holds ${n} cars`);
    for (const t of v.types) assert.equal(t.instances, n * t.slotsPerCar, `${t.id} draws every car's instances`);
    assert.deepEqual(errors, []);
    counts[n] = { capacity: v.capacity, drawCalls: s.drawCalls };
    if (n === 130) await page.screenshot({ path: join(evidenceDir, 'cars-130.jpg'), quality: 80 });
    await page.close();
  }
  assert.equal(counts[4].capacity, 16, 'starts at 16');
  assert.ok(counts[130].capacity >= 130);
  assert.equal(counts[40].drawCalls, counts[4].drawCalls, 'draws constant in N');
  assert.equal(counts[130].drawCalls, counts[4].drawCalls, 'draws constant in N');
  runs.growth = counts;
});
