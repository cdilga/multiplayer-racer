// P1-M08a visual self-review captures: the real host page (test build, `?test=live&room`) races a generated four-biome
// track prepared by the procgen worker. Fake controllers join through the real controller path. Writes JPGs and
// capture.json (seeds, plans, preparation readout, errors) to docs/evidence/P1-M08a/.
//   npm --prefix web run build && node web/host/tests/prepare-capture.mjs      (JJ_HEADLESS=1 forces headless Chromium)
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const out = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-M08a');
await mkdir(out, { recursive: true });
const server = await serve(join(repo, 'web/dist'));
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
const report = { mode, platform: `${platform()}/${arch()}`, runs: [] };

async function run(name, players, viewport, query = '') {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await openHost(page, `${server.url}/host/?test=live&room&laps=1${query}`);
  await page.waitForFunction(() => window.__jjPrepare !== undefined, null, { timeout: 60_000 });
  const crew = [];
  for (let k = 0; k < players; k++) crew.push(await page.evaluate((n) => window.__jjTest.join(n, { lobby: true }), `Driver ${k + 1}`));
  await page.evaluate(() => window.__jjRoom.start());
  await page.waitForFunction(() => window.__jjPrepare.stats().committed === 1, null, { timeout: 60_000 });
  // The grid is held through the countdown; then everyone drives forward, steering a little differently.
  await page.waitForFunction(() => window.__jjRoom.view()?.phase === 'Running', null, { timeout: 60_000 });
  for (const [k, c] of crew.entries()) await page.evaluate(([e, s]) => window.__jjTest.drive(e, [0, 28_000], [s, 0]), [c.endpoint, (k - 1.5) * 1_200]);
  // Sticks are re-sent as a phone would, a few ticks at a time, until the cars are well into the lap.
  await page.evaluate(() => window.__jjTest.untilFact((st) => st.cars.some((c) => c.speed > 14), { maxTicks: 2400, every: 6 }));
  await page.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 1500, every: 6 }));
  await sleep(1_500); // let the grid overlay settle after the last layout
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 82 });
  const info = await page.evaluate(() => ({ seeds: window.__jjPrepare.seeds(), stats: window.__jjPrepare.stats(), room: window.__jjRoom.view()?.preparation, phase: window.__jjRoom.view()?.phase, map: window.__jjRender.map() }));
  report.runs.push({ name, players, viewport, errors, ...info });
  console.log(name, JSON.stringify(info.seeds), info.phase, info.map && info.map.kit);
  await page.close();
}

await run('tv-1080p-1-player', 1, { width: 1920, height: 1080 });
await run('tv-1080p-4-tiles', 4, { width: 1920, height: 1080 });
await run('laptop-1366-4-tiles', 4, { width: 1366, height: 768 });
await writeFile(join(out, 'capture.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
server.close();
