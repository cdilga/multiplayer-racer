// br-gw74.9: real WASM worker → snapshot → instanced beam movement, collision and passive return.
// Native bank proves the speed/angle/corner envelopes; this catches a renderer which still draws rigid rails.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/rails/';
const mapJson = readFileSync('scenarios/rails/yard.json', 'utf8');
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-PT-barriers');
const sizes = [[412,915],[915,412],[375,667],[1920,1080],[1366,768]];
let server;
before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'rails'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => { await server?.close(); });

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: the rail corner fixture has native/WASM full-state parity`, { timeout: 180_000 }, async () => {
    const fixturePath = 'scenarios/rails/steering-help.json';
    const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
    const [native] = JSON.parse(execFileSync(bin, [...args, 'sim', '--json', '--out', join(out, `${name}-native-corner`), fixturePath], { encoding: 'utf8' }));
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const map = readFileSync('scenarios/rails/corner-map.json', 'utf8');
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    try {
      const page = await browser.newPage();
      await page.goto(`${server.origin}${BASE}host?test&tiles=1`);
      await page.waitForFunction(() => window.__jjTest);
      const result = await page.evaluate(async ({ fixture, map }) => {
        await window.__jjTest.load(fixture, map);
        await window.__jjTest.step(fixture.ticks);
        return { hash: await window.__jjTest.hash(), state: await window.__jjTest.observe() };
      }, { fixture, map });
      assert.equal(native.ok, true);
      assert.equal(native.replayMatches, true);
      assert.equal(result.hash.tick, fixture.ticks);
      assert.equal(result.hash.stateHash, native.stateHash, 'rail springs, car and journal state match across architectures');
      assert.deepEqual(result.state.rails, native.observations.at(-1).rails);
      writeFileSync(join(out, `${name}-corner-parity.json`), JSON.stringify({ browser: name, fixture: fixturePath, native: native.stateHash, wasm: result.hash, rails: result.state.rails }, null, 2) + '\n');
    } finally { await browser.close(); }
  });

  test(`${name}: a collision moves the actual drawn rail, then the spring returns; phone/TV/fullscreen/resize`, { timeout: 180_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [];
    const rows = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/rail-yard.json', r => r.fulfill({ contentType: 'application/json', body: mapJson }));
      await page.goto(`${server.origin}${BASE}host?test&tiles=1&follow=0&camdist=near&mapUrl=${encodeURIComponent(server.origin + '/rail-yard.json')}&autores=off`);
      await page.waitForFunction(() => window.__jjTest && window.__jjRender?.rails().length).catch(async e => { throw new Error(e.message + JSON.stringify(await page.evaluate(() => ({ text: document.body.textContent, host: document.documentElement.dataset.jjHost, render: window.__jjRender?.stats(), rails: window.__jjRender?.rails(), map: window.__jjRender?.map() }))) + JSON.stringify(errors)); });
      await page.evaluate(async map => {
        await window.__jjTest.load({ scenario: 'rail-render-contact', what: 'WASM/render collision and return', map: 'scenarios/rails/yard.json', seed: 101, ticks: 1200,
          cars: [{ pose: { x: -60, y: .1, z: -20 } }], seats: [{ name: 'Rail test', car: 0 }] }, map);
        await window.__jjTest.step(240);
      }, mapJson);
      const paint = async () => {
        const tick = await page.evaluate(async () => (await window.__jjTest.observe()).tick);
        await page.waitForFunction(t => { window.__jjRender.frame(); return window.__jjRender.stats().tick >= t; }, tick);
        await page.evaluate(() => { for (let i = 0; i < 80; i++) window.__jjRender.frame(); window.__jjRender.hold(); });
        return page.evaluate(() => window.__jjRender.rails());
      };
      const rest = await paint();
      const health = await page.evaluate(async () => (await window.__jjTest.observe()).cars[0].parts);
      await page.evaluate(() => window.__jjTest.command({ cmd: 'place', car: 0, pose: { x: -40, y: .05, z: -22.2, headingDeg: 45 }, linvel: [28.28, 0, 28.28] }));
      let observed;
      for (let i = 0; i < 120; i++) {
        await page.evaluate(() => window.__jjTest.step(1));
        observed = await page.evaluate(() => window.__jjTest.observe());
        assert.deepEqual(observed.cars[0].parts, health, 'the rail alone takes no health or part');
        if (Math.abs(observed.rails[0].displacementM) > .15) break;
      }
      assert.ok(Math.abs(observed.rails[0].displacementM) > .15, 'visible mid-hit deflection from an actual collision');
      const hit = await paint();
      assert.equal(hit.length, rest.length, 'same instances, no extra rail draw');
      for (let i = 0; i < hit.length; i++) {
        assert.ok(Math.abs(hit[i].position[2] - rest[i].position[2] - observed.rails[0].displacementM) < .003, 'snapshot moves every beam/post instance by the measured normal displacement');
      }
      for (const [width,height] of sizes) {
        await page.setViewportSize({ width,height });
        await paint();
        const shot = async state => {
          const file = `${name}-${state}-${width}x${height}.jpg`;
          await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
          rows.push({ file, state, width, height, tick: observed.tick, rails: observed.rails });
        };
        await shot('hit');
        // Real Fullscreen API on engines which implement it; WebKit fallback is recorded explicitly.
        const fullscreen = await page.evaluate(async () => {
          try { await document.documentElement.requestFullscreen(); return !!document.fullscreenElement; } catch { return false; }
        });
        await paint();
        await shot(fullscreen ? 'fullscreen-hit' : 'fullscreen-unavailable-hit');
        await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
        await page.setViewportSize({ width: height, height: width });
        await paint();
        await shot('resized-hit');
        await page.setViewportSize({ width,height });
      }
      // Remove the car's sustained contact before asking the unloaded spring to return.
      await page.evaluate(async () => {
        await window.__jjTest.command({ cmd: 'place', car: 0, pose: { x: -60, y: .05, z: -20 }, linvel: [0,0,0] });
        await window.__jjTest.step(600);
      });
      const returned = await paint();
      const final = await page.evaluate(() => window.__jjTest.observe());
      assert.ok(Math.abs(final.rails[0].displacementM) < .002, 'unloaded spring returns to rest');
      for (let i = 0; i < returned.length; i++) assert.ok(Math.abs(returned[i].position[2] - rest[i].position[2]) < .003);
      assert.deepEqual(final.cars[0].parts, health);
      await page.evaluate(() => window.__jjTest.rail(0, .4));
      assert.ok(Math.abs((await page.evaluate(() => window.__jjTest.observe())).rails[0].displacementM - .4) < .0001, 'R90 setter is exact at its setup tick');
      await page.evaluate(() => window.__jjTest.step(1));
      const setState = await page.evaluate(() => window.__jjTest.observe());
      await paint();
      const set = await page.evaluate(() => window.__jjRender.rails());
      assert.ok(Math.abs(set[0].position[2] - rest[0].position[2] - setState.rails[0].displacementM) < .003, 'R90 setter reaches drawn geometry on the next stepped snapshot');
      await assert.rejects(page.evaluate(() => window.__jjTest.rail(999, .4)), /unknown rail/);
      assert.deepEqual(errors, []);
      writeFileSync(join(out, `${name}-render-contact.json`), JSON.stringify({ browser: name, transport: 'real jj-server, frame-stepped WASM fixture; no controller connection', rows, rest, hit, returned, final, errors }, null, 2) + '\n');
    } finally { await browser.close(); }
  });
}
