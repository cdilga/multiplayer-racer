// P1-Q01: draws / triangles / frame time / sim tick rate in the LIVE host as debris grows (plan §13b.1; debris is never capped).
// The real host page with the sim worker running on its own clock (the `testing` build of jj-wasm-host, `?test=live`), loaded
// with the same fixture perf-sim.mjs uses: N cars on the greybox grid, every part stripped at tick 30, so each car leaves ten
// dynamic debris bodies. Per window it samples rAF frame pacing and reads the host's own stats (debris, draws, triangles, tick)
// and the worker's counters, so the receipt shows what the sim, the worker snapshot path and the renderer do together:
//   - simHz: ticks the worker really advanced per wall second (the budget is 120; below it the sim is over its tick budget);
//   - skipped: snapshots the worker could not publish because no pool buffer was free (the snapshot path falling behind).
// Headed, guarded and locked like perf.mjs (it refuses headless and overlapping-GPU runs).
//
//   node web/tests/journeys/harness/perf-debris.mjs [--cars 1,4,8,16,24,32,48,96] [--sizes 1080p,4k] [--windows 4] [--accept-busy app] [--out file]
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { attributeHitches, markResolution, repo, sampleFrames, SIZES, summarise, withPerfBrowser, writeReceipt } from './perf.mjs';

const PARTS = ['front', 'back', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
const fixture = (n) => ({
  scenario: `perf-debris-${n}`,
  what: `P1-Q01 live perf scene: ${n} cars on the greybox grid, every part stripped at tick 30 (debris grows, uncapped).`,
  map: 'maps/greybox-loop.json',
  seed: 7,
  ticks: 100000,
  grid: n,
  damage: Array.from({ length: n }, (_, car) => PARTS.map((part) => ({ tick: 30, car, part, health: 0 }))).flat(),
});

async function main(argv) {
  await withPerfBrowser(argv, async (browser, ctx) => {
    const { arg } = ctx;
    const cars = arg('--cars', '1,4,8,16,24,32,48,96').split(',').map(Number);
    const sizes = arg('--sizes', '1080p,4k').split(',');
    const windows = Number(arg('--windows', 4));
    const FRAMES = 240; // frames per window, about 4 s at 60 Hz
    const mapJson = readFileSync(join(repo, 'maps/greybox-loop.json'), 'utf8');
    const { openHost } = await import(join(repo, 'web/host/tests/lib/surface.mjs'));
    const rows = [];
    for (const size of sizes) {
      for (const n of cars) {
        const { result: row, attempts, contention } = await ctx.clean(async () => {
        const page = await browser.newPage({ viewport: SIZES[size], deviceScaleFactor: 1 });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const tiles = Math.min(n, 24);
        await openHost(page, `${ctx.server.url}/host/?test=live&tiles=${tiles}`);
        await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 20, null, { timeout: 180_000 });
        await page.evaluate(([fx, map]) => window.__jjTest.load(fx, map), [fixture(n), mapJson]);
        await page.evaluate(() => window.__jjTest.hold(false));
        const out = [];
        for (let w = 0; w < windows; w++) {
          const before = await page.evaluate(() => ({ tick: window.__jjRender.stats().tick, at: performance.now() }));
          const samples = await sampleFrames(page, FRAMES, 10);
          const med = (key) => {
            const v = samples.map((x) => x[key]).filter((x) => x != null).sort((a, b) => a - b);
            return { median: v[v.length >> 1], max: v.at(-1) };
          };
          const st = await page.evaluate(async () => ({ simDebris: (await window.__jjTest.observe()).debris.length, stats: window.__jjRender.stats(), status: await window.__jjTest.status(), at: performance.now() }));
          out.push({
            window: w + 1,
            frame: summarise(samples.map((s) => s.dt)),
            hitches: attributeHitches(samples, w === 0 ? 60 : 0),
            simDebrisBodies: st.simDebris,
            debrisDrawnAsDebris: st.stats.debris,
            cars: st.stats.cars,
            draws: med('draws'),
            triangles: med('triangles'),
            tick: st.stats.tick,
            simHz: +(((st.stats.tick - before.tick) / (st.at - before.at)) * 1000).toFixed(1),
            workerPublished: st.status.published,
            workerSkipped: st.status.skipped,
            ...markResolution(st.stats),
          });
        }
        await page.close();
        return { size, cars: n, tiles, debrisBodies: out.at(-1).simDebrisBodies, windows: out, errors };
        });
        const last = row.windows.at(-1);
        rows.push({ ...row, attempts, neighbourOnGpu: contention, clean: contention.length === 0 });
        console.log(JSON.stringify({ size, cars: n, tiles: row.tiles, debris: last.simDebrisBodies, draws: last.draws.median, tris: last.triangles.median, p50: last.frame.p50, p99: last.frame.p99, max: last.frame.max, simHz: last.simHz, skipped: last.workerSkipped, source: last.resolutionSource, clean: contention.length === 0 }));
      }
    }
    const receipt = {
      label: 'P1-Q01 draws/tris/frame time/sim rate as debris grows (live host)',
      ...ctx.header(),
      cohort: 'perf-debris-N fixture (N cars on the greybox grid, all ten parts stripped per car at tick 30; nothing capped), live sim worker (wasm testing build), min(N,24) tiles, one host tab, no controllers',
      budgets: { frameMs60: 16.7, simTickMs: 1000 / 120, simHz: 120 },
      rows,
      nativeRowsOnly: rows.every((r) => r.windows.every((w) => w.countsAsNative)),
      note: 'rows whose windows are not countsAsNative (auto/user-lowered, browser-limited) are not native-resolution evidence (R111). simHz below 120 means the worker sim could not hold its tick budget at that car/debris count.',
    };
    const out = resolve(repo, arg('--out', `docs/evidence/P1-Q01/debris-growth-${os.hostname().replace(/\..*/, '')}${ctx.supplementary ? '-supplementary' : ''}.json`));
    writeReceipt(out, receipt);
    console.log(`wrote ${out}`);
  });
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e.message);
  process.exit(2);
});
