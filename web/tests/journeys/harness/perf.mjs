// The harness perf helper (P1-Q01, plan §13.1, §13b.1, R111): guardrails and receipts for host frame pacing.
//
// Guardrails live in the tool (plan §13a):
//   - it REFUSES a headless run (a headless browser has no real display, vsync or GPU pacing: its numbers say nothing about a
//     host on a TV) unless `supplementary` is set, and a supplementary receipt says so and never counts as hardware evidence;
//   - it REFUSES a run whose GPU is shared with anything else (another perf run, another browser's render work, a compute job
//     on the card), because overlap pollutes the frame times; `supplementary` does not waive this;
//   - a receipt whose render resolution was lowered automatically (R111's measured last resort) is marked `auto-lowered` and
//     does NOT count as native, whatever the display; a host's own choice is `user-lowered`, also not native.
//
//   node web/tests/journeys/harness/perf.mjs frame-pacing [--tiles 1,4,8,12,16,24,32] [--sizes 1080p,4k] [--frames 600]
//        [--supplementary] [--out docs/evidence/P1-Q01/frame-pacing-<host>.json]
//
// Needs `npm --prefix web run build` first. Run it HEADED on the Mac (docs/evidence/P1-Q01/mac-frame-pacing.md).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';

const here = import.meta.dirname;
const repo = resolve(here, '../../../..');
export const LOCK = join(os.tmpdir(), 'jj-perf.lock');

/** The resolution sources an overlay/stats row can carry (`WorldStats.resolution`, R111) → the receipt's label. */
export function resolutionSource(stats) {
  if (!stats) return 'unknown';
  if (stats.resolution === 'auto' || (stats.autoEvents?.length ?? 0) > 0) return 'auto-lowered';
  if (stats.resolution === 'user') return 'user-lowered';
  if (stats.resolution === 'native') return stats.limitedBy ? 'browser-limited' : 'native';
  return 'unknown';
}

/** Marks a receipt row from its stats: the actual render size, its source, and whether it counts as native (R111). */
export function markResolution(stats) {
  const source = resolutionSource(stats);
  return {
    renderPixels: stats ? [stats.width, stats.height] : null,
    nativePixels: stats ? [stats.nativeWidth, stats.nativeHeight] : null,
    resolutionSource: source,
    countsAsNative: source === 'native' && stats.width === stats.nativeWidth && stats.height === stats.nativeHeight,
    ...(source === 'auto-lowered' ? { autoLowered: stats.autoEvents ?? [] } : {}),
    ...(stats?.limitedBy ? { limitedBy: stats.limitedBy } : {}),
  };
}

/** Processes holding the GPU or rendering browsers on this machine (empty on a clear machine). Injectable for the tests. */
export function gpuUsers() {
  const users = [];
  const sh = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    } catch {
      return '';
    }
  };
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        users.push(`another perf run (pid ${pid})`);
      } catch {
        /* stale lock */
      }
    }
  }
  if (os.platform() === 'linux') {
    for (const l of sh('nvidia-smi', ['--query-compute-apps=pid,process_name', '--format=csv,noheader']).split('\n').filter(Boolean)) users.push(`GPU process ${l.trim()}`);
  }
  // Another rendering browser competes for the same GPU and compositor.
  for (const l of sh('ps', ['-axo', 'pid=,command=']).split('\n')) {
    if (/--type=gpu-process/.test(l) && !l.includes(`--user-data-dir=${join(os.tmpdir(), 'jj-perf-')}`)) users.push(`browser GPU process ${l.trim().slice(0, 80)}`);
  }
  return users;
}

/**
 * The guardrail: the reasons this run must be refused (empty: it may go ahead).
 * @param {{ headless: boolean, supplementary?: boolean, users?: string[] }} o
 */
export function refusals({ headless, supplementary = false, users = gpuUsers() }) {
  const why = [];
  if (headless && !supplementary) why.push('headless: a perf receipt needs a headed browser on a real display (pass --supplementary to record a labelled, non-hardware run)');
  if (users.length) why.push(`overlapping GPU use: ${users.join('; ')}`);
  return why;
}

/** Throws unless the run may go ahead. */
export function assertPerfRun(o) {
  const why = refusals(o);
  if (why.length) throw new Error(`perf helper refuses this run: ${why.join(' | ')}`);
}

/** The percentile summary of frame intervals (ms). Medians hide hitches (§13b.1), so p95/p99/max travel with p50. */
export function summarise(dts) {
  const s = [...dts].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { frames: s.length, p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), p99: +at(0.99).toFixed(2), max: +s.at(-1).toFixed(2) };
}

/**
 * Hitch attribution (§13b.1) from per-frame samples `{ dt, heap, tasks, warm }`. A hitch is a frame over 2× the median and over
 * 25 ms. Heuristics, labelled as such in the receipt: a drop in used JS heap across the frame is GC; a hitch in the first
 * `warmFrames` frames, or one the browser reported as a long task that the heap doesn't explain, is shader compile / upload
 * (warm shaders before a round); a long task after warm-up with growing heap is JS work (the snapshot decode / sim step on
 * main); anything else is "other (GPU or compositor)".
 */
export function attributeHitches(samples, warmFrames) {
  const dts = samples.map((s) => s.dt);
  const median = [...dts].sort((a, b) => a - b)[dts.length >> 1];
  const counts = { gc: 0, 'shader-compile-or-upload': 0, 'main-thread-js': 0, 'other-gpu-or-compositor': 0 };
  const worst = [];
  samples.forEach((s, i) => {
    if (!(s.dt > 2 * median && s.dt > 25)) return;
    const prev = samples[i - 1]?.heap ?? s.heap;
    let kind;
    if (s.heap < prev - 256 * 1024) kind = 'gc';
    else if (i < warmFrames) kind = 'shader-compile-or-upload';
    else if (s.tasks > 0) kind = 'main-thread-js';
    else kind = 'other-gpu-or-compositor';
    counts[kind]++;
    worst.push({ frame: i, ms: +s.dt.toFixed(1), kind });
  });
  worst.sort((a, b) => b.ms - a.ms);
  return { hitches: Object.values(counts).reduce((a, b) => a + b, 0), byKind: counts, worst: worst.slice(0, 5), method: 'heuristic: heap drop = GC; first warm-up frames = shader compile/upload; long task = main-thread JS; rest = GPU/compositor' };
}

const SIZES = { '1080p': { width: 1920, height: 1080 }, '4k': { width: 3840, height: 2160 } };

/** rAF intervals + heap + long-task counts over `frames` frames, in the page. */
const sampleFrames = (page, frames) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        const out = [];
        let tasks = 0;
        try {
          new PerformanceObserver((l) => {
            tasks += l.getEntries().length;
          }).observe({ entryTypes: ['longtask'] });
        } catch {
          /* longtask unsupported */
        }
        let last = performance.now();
        const step = (t) => {
          out.push({ dt: t - last, heap: performance.memory?.usedJSHeapSize ?? 0, tasks });
          tasks = 0;
          last = t;
          if (out.length < n + 1) requestAnimationFrame(step);
          else done(out.slice(1));
        };
        requestAnimationFrame(step);
      }),
    frames,
  );

async function framePacing(argv) {
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const supplementary = argv.includes('--supplementary');
  const headless = argv.includes('--headless');
  const tiles = arg('--tiles', '1,4,8,12,16,24,32').split(',').map(Number);
  const sizes = arg('--sizes', '1080p,4k').split(',');
  const frames = Number(arg('--frames', 600));
  const channel = arg('--channel', 'chrome');
  assertPerfRun({ headless, supplementary });
  writeFileSync(LOCK, String(process.pid));
  const cleanup = () => existsSync(LOCK) && unlinkSync(LOCK);
  process.on('exit', cleanup);
  const { chromium } = await import('playwright');
  const { serve, openHost } = await import(join(repo, 'web/host/tests/lib/surface.mjs'));
  const server = await serve(join(repo, 'web/dist'));
  let browser;
  let mode;
  try {
    browser = await chromium.launch({ headless, channel: headless ? undefined : channel === 'chromium' ? undefined : channel, args: ['--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
    mode = headless ? 'headless Chromium (supplementary)' : channel === 'chromium' ? 'headed Chromium' : `headed Google ${channel}`;
  } catch (e) {
    throw new Error(`could not launch ${channel} headed (${e.message.split('\n')[0]}): no receipt without a headed browser`);
  }
  const rows = [];
  for (const name of sizes) {
    for (const n of tiles) {
      const page = await browser.newPage({ viewport: SIZES[name], deviceScaleFactor: 1 });
      await openHost(page, `${server.url}/host/?synthetic=32&freeze=300&map&tiles=${n}`);
      await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 4, null, { timeout: 180_000 });
      const warm = 120; // frames after open that count as warm-up (shader compile and upload happen here)
      const samples = await sampleFrames(page, warm + frames);
      const stats = await page.evaluate(() => window.__jjRender.stats());
      const steady = samples.slice(warm);
      rows.push({
        size: name,
        tiles: n,
        ...markResolution(stats),
        steady: summarise(steady.map((s) => s.dt)),
        warmup: summarise(samples.slice(0, warm).map((s) => s.dt)),
        hitches: attributeHitches(samples, warm),
        draws: stats.drawCalls,
        triangles: stats.triangles,
        backend: stats.backend,
      });
      console.log(JSON.stringify(rows.at(-1)));
      await page.close();
    }
  }
  const gpu = os.platform() === 'darwin' ? execFileSync('system_profiler', ['SPDisplaysDataType'], { encoding: 'utf8' }).split('\n').find((l) => /Chipset Model/.test(l))?.split(':')[1]?.trim() : undefined;
  const receipt = {
    label: 'P1-Q01 host frame pacing',
    evidenceKind: supplementary ? 'supplementary (not hardware evidence)' : 'ev:hardware',
    machine: { host: os.hostname(), cpu: os.cpus()[0]?.model, platform: `${os.platform()}/${os.arch()}`, gpu },
    browser: `${mode}, Chromium ${browser.version()} (Playwright)`,
    build: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    cohort: 'synthetic 32-car snapshot (frozen tick 300) on the greybox map; one host tab; no controllers',
    takenAt: new Date().toISOString(),
    rows,
    nativeRowsOnly: rows.every((r) => r.countsAsNative),
    note: 'rows with countsAsNative=false (auto- or user-lowered, or browser-limited) do not count as native-resolution evidence (R111)',
  };
  const out = resolve(repo, arg('--out', `docs/evidence/P1-Q01/frame-pacing-${os.hostname().replace(/\..*/, '')}${supplementary ? '-supplementary' : ''}.json`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  await browser.close();
  server.close();
  cleanup();
  console.log(`wrote ${out}; all rows native: ${receipt.nativeRowsOnly}`);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'frame-pacing') {
    framePacing(rest).catch((e) => {
      console.error(e.message);
      process.exit(2);
    });
  } else {
    console.error('usage: perf.mjs frame-pacing [--tiles 1,4,8] [--sizes 1080p,4k] [--frames 600] [--supplementary] [--out file]');
    process.exit(2);
  }
}
