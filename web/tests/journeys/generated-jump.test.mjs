// P1-PT-launch / br-gw74.10: generated geometry → real worker → drawn mid-air car, with native replay parity.
// The native bank covers every jump on ten seeds in every placing biome; this catches a stale WASM/renderer mesh.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const deployed = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = deployed ? deployed.pathname.replace(/\/?$/, '/') : '/p/jump/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-PT-launch');
const sizes = [[412,915], [915,412], [375,667], [1920,1080], [1366,768]];
let server, mapJson, fixture, native, jumpShapes, scratch;
before(async () => {
  mkdirSync(out, { recursive: true });
  const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  scratch = mkdtempSync(join(tmpdir(), 'jj-generated-jump-'));
  // jj sim locates the real kit above the generated map; scratch holds outputs, never a second code checkout.
  symlinkSync(resolve('assets'), join(scratch, 'assets'), 'dir');
  const mapDir = join(scratch, 'generated-rocks-7');
  execFileSync(bin, [...args, 'procgen', '--seed', '7', '--recipe', 'rocks', '--out', mapDir, '--json']);
  jumpShapes = JSON.parse(readFileSync(join(mapDir, 'report.json'), 'utf8')).jumpShapes;
  const mapPath = join(mapDir, 'map.json');
  mapJson = readFileSync(mapPath, 'utf8');
  const map = JSON.parse(mapJson);
  const jump = map.features.filter(f => f.kind === 'jump')[4];
  assert.ok(jump, 'the recorded seed-7 regression jump exists');
  const pts = map.route.points;
  const base = pts.reduce((best, p, i) => (p.x-jump.pose.x)**2 + (p.z-jump.pose.z)**2 < (pts[best].x-jump.pose.x)**2 + (pts[best].z-jump.pose.z)**2 ? i : best, 0);
  const start = (base + pts.length - 4) % pts.length;
  const a = pts[start], b = pts[(start+1) % pts.length];
  const heading = Math.atan2(b.x-a.x, b.z-a.z);
  fixture = {
    scenario: 'generated-rocks-boost-jump', what: 'A boosted Cruz leaves a generated lip and lands upright; native/WASM full state matches.',
    map: mapPath, seed: 7, ticks: 420,
    cars: [{ routePoint: start, lift: .5, linvel: [26*Math.sin(heading), 0, 26*Math.cos(heading)] }],
    seats: [{ name: 'Jump driver', car: 0 }],
    autopilot: [{ tick: 0, car: 0, on: true }],
    inputs: [{ car: 0, fromTick: 0, toTick: 420, boost: true }],
    observe: [180, 420],
    expect: [
      { car: 0, atTick: 180, metric: 'wheelsInContact', min: 0, max: 0 },
      { car: 0, atTick: 180, metric: 'upY', min: .8, max: 1.01 },
      { car: 0, metric: 'upY', min: .9, max: 1.01 },
      { car: 0, metric: 'airtimeS', min: .5, max: 4 },
    ],
  };
  const fixturePath = join(scratch, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n');
  [native] = JSON.parse(execFileSync(bin, [...args, 'sim', '--json', '--out', join(scratch, 'native'), fixturePath], { encoding: 'utf8' }));
  assert.equal(native.ok, true, JSON.stringify(native));
  assert.equal(native.replayMatches, true);
  server = deployed ? { origin: deployed.origin } : await serve(build('./', 'generated-jump'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close?.();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: a generated boosted jump is visibly airborne, lands upright and matches native replay`, { timeout: 180_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [], rows = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/generated-jump.json', r => r.fulfill({ contentType: 'application/json', body: mapJson }));
      await page.goto(`${server.origin}${BASE}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/generated-jump.json')}`);
      await page.waitForFunction(() => window.__jjTest && window.__jjRender);
      await page.evaluate(async ({ fixture, mapJson }) => {
        await window.__jjTest.load(fixture, mapJson);
        await window.__jjTest.step(180);
      }, { fixture, mapJson });
      const air = await page.evaluate(() => window.__jjTest.observe());
      assert.equal(air.cars[0].wheelsInContact, 0, 'all tyres clear the generated receiving surface');
      assert.ok(air.cars[0].upY > .8);
      const drawnShapes = await page.evaluate(() => window.__jjRender.jumpShapes());
      assert.deepEqual(drawnShapes, jumpShapes, 'every actually uploaded jump triangle matches the native collision mesh');
      const paint = async (frames = 2) => {
        const tick = await page.evaluate(async () => (await window.__jjTest.observe()).tick);
        await page.waitForFunction(t => { window.__jjRender.frame(); return window.__jjRender.stats().tick >= t; }, tick);
        await page.evaluate(async frames => {
          for (let i=0; i<frames; i++) {
            window.__jjRender.frame();
            await new Promise(resolve => setTimeout(resolve, 16));
          }
          window.__jjRender.hold();
        }, frames);
      };
      if (process.env.JJ_CAPTURE_DIR) {
        // Let the real welcome caption finish naturally, so the tyres/air gap remain reviewable.
        await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
        await paint(20);
        for (const [width,height] of sizes) {
          await page.setViewportSize({ width,height });
          await paint();
          const shot = async state => {
            const file = `${name}-${state}-${width}x${height}.jpg`;
            await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
            rows.push({ file, state, width, height, tick: air.tick });
          };
          await shot('air');
          const fullscreen = await page.evaluate(async () => {
            try { await document.documentElement.requestFullscreen(); return !!document.fullscreenElement; } catch { return false; }
          });
          await paint();
          await shot(fullscreen ? 'fullscreen-air' : 'fullscreen-unavailable-air');
          await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
          await page.setViewportSize({ width: height, height: width });
          await paint();
          await shot('resized-air');
          await page.setViewportSize({ width,height });
        }
      }
      await page.evaluate(() => window.__jjTest.step(240));
      const final = await page.evaluate(async () => ({ hash: await window.__jjTest.hash(), state: await window.__jjTest.observe() }));
      assert.equal(final.hash.tick, fixture.ticks);
      assert.equal(final.hash.stateHash, native.stateHash, 'generated collider geometry, boost, car and journal match native');
      assert.ok(final.state.cars[0].upY > .9, 'the generated landing returns the car upright');
      if (process.env.JJ_CAPTURE_DIR) {
        // The existing debug orbit gives the visual reviewer a clear side angle of the tyre/surface gap.
        const side = new URL(page.url());
        side.searchParams.set('orbit', '75');
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto(side.href);
        await page.waitForFunction(() => window.__jjTest && window.__jjRender);
        await page.evaluate(async ({ fixture, mapJson }) => {
          await window.__jjTest.load(fixture, mapJson);
          await window.__jjTest.step(180);
        }, { fixture, mapJson });
        assert.equal((await page.evaluate(() => window.__jjTest.observe())).cars[0].wheelsInContact, 0);
        await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
        await paint(20);
        const file = `${name}-side-air-1366x768.jpg`;
        await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
        rows.push({ file, state: 'side-air', width: 1366, height: 768, tick: air.tick });
      }
      assert.deepEqual(errors, []);
      writeFileSync(join(out, `${name}-jump.json`), JSON.stringify({ browser: name, source: `${deployed ? deployed.href : 'local real jj-server'}, generated seed 7 Rocks, frame-stepped WASM fixture; no connected phone`, rows, native: native.stateHash, air, final, errors }, null, 2) + '\n');
    } finally { await browser.close(); }
  });
}
