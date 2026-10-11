// P1-PT-rooftop: authored kicker → real WASM → visible house landing, native replay and draw-buffer parity.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const preview = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = preview ? preview.pathname.replace(/\/?$/, '/') : '/p/roof/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-PT-rooftop');
const fixture = JSON.parse(readFileSync('scenarios/roofs/kicker.json', 'utf8'));
const mapJson = readFileSync('scenarios/roofs/kicker-map.json', 'utf8');
let server, native, shapes;
before(async () => {
  mkdirSync(out, { recursive: true });
  const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  [native] = JSON.parse(execFileSync(bin, [...args, 'sim', '--json', '--out', join(out, 'native'), 'scenarios/roofs/kicker.json'], { encoding: 'utf8' }));
  const [validation] = JSON.parse(execFileSync(bin, [...args, 'validate', '--json', 'scenarios/roofs/kicker-map.json'], { encoding: 'utf8' }));
  assert.equal(native.ok, true);
  assert.equal(native.replayMatches, true);
  shapes = validation.jumpShapes;
  assert.equal(shapes.length, 1);
  server = preview ? { origin: preview.origin } : await serve(build('./', 'roof'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => { await server?.close?.(); });

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: a design-speed jump lands/stops on the visible roof with native/WASM parity`, { timeout: 180_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [], rows = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/roof-fixture.json', r => r.fulfill({ contentType: 'application/json', body: mapJson }));
      await page.goto(`${server.origin}${BASE}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/roof-fixture.json')}`);
      await page.waitForFunction(() => window.__jjTest && window.__jjRender);
      await page.evaluate(async ({ fixture, mapJson }) => { await window.__jjTest.load(fixture, mapJson); await window.__jjTest.step(360); }, { fixture, mapJson });
      const air = await page.evaluate(() => window.__jjTest.observe());
      assert.equal(air.cars[0].wheelsInContact, 0);
      assert.ok(air.cars[0].position[1] > 2.8);
      assert.deepEqual(await page.evaluate(() => window.__jjRender.jumpShapes()), shapes, 'uploaded kicker triangles equal native collision geometry');
      await page.evaluate(() => window.__jjTest.step(600));
      const final = await page.evaluate(async () => ({ hash: await window.__jjTest.hash(), state: await window.__jjTest.observe() }));
      assert.equal(final.hash.stateHash, native.stateHash);
      assert.equal(final.state.cars[0].wheelsInContact, 4);
      assert.ok(final.state.cars[0].upY > .95);
      assert.ok(final.state.cars[0].position[1] > 2);
      const paint = async () => {
        await page.waitForFunction(() => { window.__jjRender.frame(); return window.__jjRender.stats().tick >= 960; });
        await page.evaluate(async () => {
          for (let i = 0; i < 30; i++) { window.__jjRender.frame(); await new Promise(r => setTimeout(r, 16)); }
          window.__jjRender.hold();
        });
      };
      if (process.env.JJ_CAPTURE_DIR) {
        await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
        for (const [width, height] of [[412,915], [915,412], [375,667], [1366,768], [1920,1080]]) {
          await page.setViewportSize({ width, height });
          await paint();
          const file = `${name}-roof-${width}x${height}.jpg`;
          await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 90 });
          rows.push({ file, width, height, state: 'roof', tick: 960 });
        }
        const fullscreen = await page.evaluate(async () => { try { await document.documentElement.requestFullscreen(); return !!document.fullscreenElement; } catch { return false; } });
        await paint();
        const file = `${name}-${fullscreen ? 'fullscreen' : 'fullscreen-unavailable'}-roof-1920x1080.jpg`;
        await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 90 });
        rows.push({ file, width: 1920, height: 1080, state: 'fullscreen-attempt', fullscreen });
      }
      assert.deepEqual(errors, []);
      writeFileSync(join(out, `${name}-receipt.json`), JSON.stringify({ browser: name, build: preview?.href ?? 'local real jj-server', method: 'frame-stepped real WASM fixture; host phone viewports, no connected controller/device claim', native: native.stateHash, air, final, shapes, rows, errors }, null, 2) + '\n');
    } finally { await browser.close(); }
  });
}
