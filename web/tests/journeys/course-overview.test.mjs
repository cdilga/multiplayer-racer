// br-a92v: the long-course empty-field camera must show the road, and must not change chase haze.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const deployed = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = deployed ? deployed.pathname.replace(/\/?$/, '/') : '/p/course-overview/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-R10-overview');
const sizes = [[412,915], [915,412], [375,667], [1366,768], [1920,1080]];
let server, scratch;
const maps = {};
before(async () => {
  mkdirSync(out, { recursive: true });
  scratch = mkdtempSync(join(tmpdir(), 'jj-course-overview-'));
  const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  for (const preset of ['twisty', 'flowing', 'speedway']) {
    const dir = join(scratch, preset);
    execFileSync(bin, [...args, 'procgen', '--seed', '0', '--recipe', 'town', '--preset', preset, '--out', dir, '--json']);
    maps[preset] = readFileSync(join(dir, 'map.json'), 'utf8');
  }
  server = deployed ? { origin: deployed.origin } : await serve(build('./', 'course-overview'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close?.();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});
const fixture = {
  scenario: 'empty-course-overview', what: 'The actual whole-course camera frames a generated long map.',
  map: 'generated.json', seed: 0, ticks: 1, cars: [], seats: [], inputs: [],
};

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${name}: all course families remain visible and chase haze restores`, { timeout: 300_000 }, async () => {
    const browser = await engine.launch(name === 'chromium' ? { args: chromiumArgs } : {});
    const rows = [], errors = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      page.on('pageerror', e => errors.push(e.message));
      let mapJson;
      await page.route('**/course-overview.json', r => r.fulfill({ contentType: 'application/json', body: mapJson }));
      const paint = async () => {
        await page.waitForFunction(() => { window.__jjRender.frame(); return window.__jjRender.stats().tick >= 1; });
        await page.evaluate(async () => {
          for (let i=0; i<3; i++) {
            window.__jjRender.frame();
            await new Promise(r => setTimeout(r,16));
          }
          window.__jjRender.hold();
        });
      };
      for (const preset of Object.keys(maps)) {
        mapJson = maps[preset];
        await page.goto(`${server.origin}${BASE}host?test&look=on&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/course-overview.json')}`);
        await page.waitForFunction(() => window.__jjTest && window.__jjRender);
        await page.evaluate(async ({fixture,mapJson}) => {
          await window.__jjTest.load(fixture,mapJson);
          await window.__jjTest.step(1);
        }, {fixture,mapJson});
        await page.waitForFunction(() => !document.querySelector('#jj-caption')?.textContent, undefined, { timeout: 20_000 });
        for (const [width,height] of preset === 'twisty' ? sizes : [[1920,1080]]) {
          await page.setViewportSize({width,height});
          await paint();
          const record = async state => {
            const haze = await page.evaluate(() => window.__jjRender.haze());
            assert.ok(haze.near > 620, 'the former fixed far plane hid this long course');
            // Independent actual-pixel inspection below complements this camera-state regression.
            const file = `${name}-${preset}-${state}-${width}x${height}.jpg`;
            if (process.env.JJ_CAPTURE_DIR) await page.screenshot({path:join(out,file),type:'jpeg',quality:85});
            rows.push({file,width,height,state,preset,haze});
          };
          await record('overview');
          if (process.env.JJ_CAPTURE_DIR) {
            const fullscreen = await page.evaluate(async () => {
              try { await document.documentElement.requestFullscreen(); return !!document.fullscreenElement; } catch { return false; }
            });
            await paint();
            await record(fullscreen ? 'fullscreen' : 'fullscreen-unavailable');
            await page.evaluate(async () => { if(document.fullscreenElement) await document.exitFullscreen(); });
          }
          await page.setViewportSize({width:height,height:width});
          await paint();
          await record('resized');
        }
      }
      // The same scene switches from an overview to one actual fixture seat/car.
      // This must restore the road-level haze rather than retaining the last overview override.
      await page.evaluate(async ({fixture,mapJson}) => {
        window.__jjRender.setFollow([0]);
        await window.__jjTest.load({...fixture,cars:[{routePoint:0}],seats:[{name:'Chase driver',car:0}]},mapJson);
        await window.__jjTest.step(1);
      }, {fixture,mapJson});
      await paint();
      const chase = await page.evaluate(() => window.__jjRender.haze());
      assert.deepEqual(chase,{near:160,far:620},'accepted chase haze remains unchanged');
      await page.evaluate(async ({fixture,mapJson}) => {
        window.__jjRender.setFollow(null);
        await window.__jjTest.load(fixture,mapJson);
        await window.__jjTest.step(1);
      }, {fixture,mapJson});
      await paint();
      const restoredOverview = await page.evaluate(() => window.__jjRender.haze());
      assert.ok(restoredOverview.near > 620,'switching back restores the overview depth');
      assert.deepEqual(errors,[]);
      writeFileSync(join(out,`${name}-overview.json`),JSON.stringify({browser:name,source:deployed?.href ?? 'local real jj-server',seed:0,recipe:'town',fixture,rows,chase,restoredOverview,errors},null,2)+'\n');
    } finally { await browser.close(); }
  });
}
