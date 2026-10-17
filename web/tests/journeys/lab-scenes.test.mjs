// P1-FL09 / br-bbki.9 (R131): every Feel Lab scene's runs (assets/lab/scenes.json → scenarios/lab/<run>.json on
// maps/lab/<scene>.json) through the real worker and renderer. Each run's WASM full state matches native `jj sim`; a run
// that leaves the ground does so in the browser too. With JJ_CAPTURE_DIR set it captures the TV views the self-review
// looks at: the approach (the leap seen from the far straight), the car mid-air from the chase camera and a side angle,
// and the whole scene from the overview.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, after, test } from 'node:test';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const deployed = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = deployed ? deployed.pathname.replace(/\/?$/, '/') : '/p/lab-scenes/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-FL09');
const TICK_HZ = 120;
const runs = [];
let server, scratch;

before(async () => {
  mkdirSync(out, { recursive: true });
  const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  scratch = mkdtempSync(join(tmpdir(), 'jj-lab-scenes-'));
  const scenes = JSON.parse(readFileSync('assets/lab/scenes.json', 'utf8')).scenes;
  for (const [scene, s] of Object.entries(scenes)) {
    const mapJson = readFileSync(`maps/lab/${scene}.json`, 'utf8');
    for (const r of s.runs) {
      // The committed fixture, with a seat so the chase camera follows the car.
      const fixture = { ...JSON.parse(readFileSync(`scenarios/lab/${r.run}.json`, 'utf8')), seats: [{ name: 'Lab driver', car: 0 }] };
      const path = join(scratch, `${r.run}.json`);
      writeFileSync(path, JSON.stringify({ ...fixture, map: resolve(`maps/lab/${scene}.json`) }, null, 2) + '\n');
      const [native] = JSON.parse(execFileSync(bin, [...args, 'sim', '--json', '--out', join(scratch, `native-${r.run}`), path], { encoding: 'utf8' }));
      assert.equal(native.ok, true, `${r.run}: ${JSON.stringify(native)}`);
      assert.equal(native.replayMatches, true);
      runs.push({ scene, run: r.run, fixture, mapJson, native });
    }
  }
  server = deployed ? { origin: deployed.origin } : await serve(build('./', 'lab-scenes'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close?.();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: every lab scene's runs match native in the real worker and renderer`, { timeout: 1_800_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const errors = [], rows = [];
    try {
      for (const c of runs) {
        const open = async (extra = '') => {
          const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
          page.on('pageerror', e => errors.push(`${c.run}: ${e.message}`));
          await page.route('**/lab-scene.json', r => r.fulfill({ contentType: 'application/json', body: c.mapJson }));
          await page.goto(`${server.origin}${BASE}host?test&tiles=1&look=on&camdist=mid&res=1&autores=off${extra}&mapUrl=${encodeURIComponent(server.origin + '/lab-scene.json')}`);
          await page.waitForFunction(() => window.__jjTest && window.__jjRender, undefined, { timeout: 60_000 });
          return page;
        };
        const load = (page, fixture, ticks, overview = false) => page.evaluate(async ({ fixture, mapJson, ticks, overview }) => {
          if (overview) window.__jjRender.setFollow(null);
          window.__jjRender.hold();
          await window.__jjTest.load(fixture, mapJson);
          await window.__jjTest.step(ticks);
        }, { fixture, mapJson: c.mapJson, ticks, overview });
        const shot = async (page, state) => {
          if (!process.env.JJ_CAPTURE_DIR) return;
          await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 60_000 });
          await page.evaluate(async () => {
            for (let i = 0; i < 20; i++) { window.__jjRender.frame(); await new Promise(r => setTimeout(r, 16)); }
            window.__jjRender.hold();
          });
          const file = `${name}-${c.run}-${state}-1920x1080.jpg`;
          await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 85 });
          rows.push({ file, scene: c.scene, run: c.run, state });
        };
        // The run as native ran it (a fixture with `until` stopped early: the same number of ticks), and its first
        // half second off the ground, if it has one.
        const ticks = c.native.ticks ?? c.fixture.ticks;
        const page = await open();
        // In one page call with the renderer held (br-51rx): a run that never leaves the ground (the climb and hairpin
        // laps, ~6000 ticks) took a round trip and a software-GL frame per 6 ticks and outlived the CI timeout.
        const takeoff = await page.evaluate(async ({ fixture, mapJson, ticks, hz }) => {
          window.__jjRender.hold();
          await window.__jjTest.load(fixture, mapJson);
          let takeoff = null, t = 0;
          // Never past the native run's ticks (a lap that never leaves the ground ends on a tick that 6 needn't divide).
          for (let n = 6; t < ticks && takeoff === null; t += n) {
            n = Math.min(6, ticks - t);
            await window.__jjTest.step(n);
            const s = await window.__jjTest.observe();
            if (s.cars[0].wheelsInContact === 0 && s.tick > hz / 2) takeoff = s.tick;
          }
          await window.__jjTest.step(ticks - Math.min(t, ticks));
          return takeoff;
        }, { fixture: c.fixture, mapJson: c.mapJson, ticks, hz: TICK_HZ });
        const final = await page.evaluate(async () => ({ hash: await window.__jjTest.hash(), state: await window.__jjTest.observe() }));
        assert.equal(final.hash.stateHash, c.native.stateHash, `${c.run}: WASM matches native`);
        await page.close();
        if (process.env.JJ_CAPTURE_DIR) {
          const approach = await open();
          await load(approach, c.fixture, TICK_HZ);
          await shot(approach, 'approach');
          await approach.close();
          if (takeoff !== null) {
            const chase = await open();
            await load(chase, c.fixture, takeoff + 18);
            await shot(chase, 'air');
            await chase.close();
            const side = await open('&orbit=75');
            await load(side, c.fixture, takeoff + 30);
            await shot(side, 'side-air');
            await side.close();
          }
          const overview = await open();
          await load(overview, { ...c.fixture, cars: [], seats: [], autopilot: [], inputs: [], ticks: 1 }, 1, true);
          await shot(overview, 'overview');
          await overview.close();
        }
      }
      assert.deepEqual(errors, []);
      if (process.env.JJ_CAPTURE_DIR) writeFileSync(join(out, `${name}-lab-scenes.json`), JSON.stringify({ browser: name, source: `${deployed ? deployed.href : 'local real jj-server'}, committed lab scenes, frame-stepped WASM fixtures; no connected phone`, runs: runs.map(c => ({ scene: c.scene, run: c.run, native: c.native.stateHash })), rows, errors }, null, 2) + '\n');
    } finally { await browser.close(); }
  });
}
