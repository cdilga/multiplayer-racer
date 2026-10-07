// P1-M04..M08b visual self-review captures: the real host page (test build, `?test=live&room&recipe=...`) races each
// biome's generated track as the procgen worker prepares it; fake controllers join through the real controller path, the
// cars run on the test surface's autopilot, and the sim is stepped until the lead car is at the named place on the named
// biome's stretch, so every capture shows what it says (never a car that left the road). Writes JPGs and capture.json
// (seeds, plans, where each shot was taken) into each bead's evidence directory.
//   npm --prefix web run build && node web/host/tests/biome-capture.mjs [town rocks dirt bitumen playtest]
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const only = process.argv.slice(2);
// [name, players, width, height, biome segment, fraction along it]
const jobs = [
  { id: 'town', dir: 'P1-M04', recipe: 'town', shots: [['street-tv-1080p', 1, 1920, 1080, 'town', 0.12], ['street-tiles-1080p', 4, 1920, 1080, 'town', 0.12], ['street-laptop-1366', 4, 1366, 768, 'town', 0.12]] },
  { id: 'rocks', dir: 'P1-M05', recipe: 'rocks', shots: [['domes-tv-1080p', 1, 1920, 1080, 'rocks', 0.5], ['domes-tiles-1080p', 4, 1920, 1080, 'rocks', 0.5], ['domes-laptop-1366', 4, 1366, 768, 'rocks', 0.5]] },
  { id: 'dirt', dir: 'P1-M06', recipe: 'outback-dirt', shots: [['track-tv-1080p', 1, 1920, 1080, 'outback-dirt', 0.5], ['track-tiles-1080p', 4, 1920, 1080, 'outback-dirt', 0.5], ['track-laptop-1366', 4, 1366, 768, 'outback-dirt', 0.5]] },
  { id: 'bitumen', dir: 'P1-M07', recipe: 'outback-bitumen', shots: [['highway-tv-1080p', 1, 1920, 1080, 'outback-bitumen', 0.5], ['highway-tiles-1080p', 4, 1920, 1080, 'outback-bitumen', 0.5], ['highway-laptop-1366', 4, 1366, 768, 'outback-bitumen', 0.5]] },
  {
    id: 'playtest',
    dir: 'P1-M08b',
    recipe: '',
    shots: [
      ['lap-1-town-tv-1080p', 1, 1920, 1080, 'town', 0.4],
      ['lap-2-rocks-tv-1080p', 1, 1920, 1080, 'rocks', 0.5],
      ['lap-3-dirt-tv-1080p', 1, 1920, 1080, 'outback-dirt', 0.5],
      ['lap-4-bitumen-tv-1080p', 1, 1920, 1080, 'outback-bitumen', 0.5],
      ['lap-dirt-to-bitumen-tiles-1080p', 4, 1920, 1080, 'outback-bitumen', 0.08],
      ['lap-dirt-tiles-laptop-1366', 4, 1366, 768, 'outback-dirt', 0.5],
    ],
  },
];
const server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
let browser;
let mode = 'headless Chromium (SwiftShader/software GL)';
if (!process.env.JJ_HEADLESS) {
  try {
    browser = await chromium.launch({ headless: false, channel: 'chrome' });
    mode = 'headed Google Chrome (system GPU)';
  } catch (e) {
    console.error('headed Chrome unavailable, falling back to headless:', e.message.split('\n')[0]);
  }
}
browser ??= await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(job, [name, players, w, h, segment, fraction], out, report) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  const missing = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() === 404 && missing.push(new URL(r.url()).pathname));
  const q = `?test=live&room&laps=1${job.recipe ? `&recipe=${job.recipe}` : ''}`;
  await openHost(page, `${server.url}/host/${q}`);
  await page.waitForFunction(() => window.__jjPrepare !== undefined, null, { timeout: 60_000 });
  for (let k = 0; k < players; k++) await page.evaluate((n) => window.__jjTest.join(n, { lobby: true }), `Driver ${k + 1}`);
  await page.evaluate(() => window.__jjRoom.start());
  await page.waitForFunction(() => window.__jjPrepare.stats().committed === 1, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__jjRoom.view()?.phase === 'Running', null, { timeout: 60_000 });
  // The cars race hands-off on the autopilot; step the sim until the lead car is at the named place.
  await page.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  const where = await page.evaluate(
    async ([segmentName, f]) => {
      const info = window.__jjPrepare.mapInfo();
      if (!info) throw new Error('no committed map');
      const seg = info.segments.filter((s) => s.name === segmentName)[0];
      if (!seg) throw new Error(`no ${segmentName} segment in ${JSON.stringify(info.segments)}`);
      const target = Math.round(seg.from + (seg.to - seg.from) * f);
      const nearest = (p) => {
        let best = 0;
        let d = Infinity;
        info.route.forEach(([x, z], i) => {
          const dd = (x - p[0]) ** 2 + (z - p[2]) ** 2;
          if (dd < d) [d, best] = [dd, i];
        });
        return best;
      };
      const r = await window.__jjTest.untilFact((s) => Math.abs(nearest(s.cars[0].position) - target) <= 2, { maxTicks: 40_000, every: 20 });
      return { segment: segmentName, targetPoint: target, reached: r.held, tick: r.tick, car0Point: nearest(r.state.cars[0].position), segments: info.segments };
    },
    [segment, fraction],
  );
  if (!where.reached) throw new Error(`${name}: the lead car never reached ${segment} at ${fraction}: ${JSON.stringify(where)}`);
  await sleep(1_500);
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 84 });
  const info = await page.evaluate(() => ({ seeds: window.__jjPrepare.seeds(), stats: window.__jjPrepare.stats(), phase: window.__jjRoom.view()?.phase, kit: window.__jjRender.map()?.kit }));
  report.shots.push({ name, players, viewport: [w, h], where, errors, missing404: [...new Set(missing)], ...info });
  console.log(job.id, name, JSON.stringify(info.seeds[0]), `lead car at point ${where.car0Point} of ${segment}`);
  await page.close();
}

for (const job of jobs.filter((j) => !only.length || only.includes(j.id))) {
  const out = join(repo, 'docs/evidence', job.dir);
  await mkdir(out, { recursive: true });
  const report = { mode, recipe: job.recipe || 'town,rocks,outback-dirt,outback-bitumen', shots: [] };
  for (const s of job.shots) await shot(job, s, out, report);
  await writeFile(join(out, 'capture.json'), `${JSON.stringify(report, null, 2)}\n`);
}
await browser.close();
server.close();
