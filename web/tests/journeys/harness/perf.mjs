// The harness perf helper (P1-Q01, plan §13.1, §13b.1, R111): guardrails and receipts for host frame pacing.
//
// Guardrails live in the tool (plan §13a):
//   - it REFUSES a headless run (a headless browser has no real display, vsync or GPU pacing: its numbers say nothing about a
//     host on a TV) unless `supplementary` is set, and a supplementary receipt says so and never counts as hardware evidence;
//   - it REFUSES a run whose GPU is shared with anything else (another perf run holding the lock, another browser's busy GPU
//     process, a compute job on the card), because overlap pollutes the frame times; `supplementary` does not waive this.
//     Idle GPU helpers of other apps (Electron apps sit at 0 % CPU) are listed in the receipt, not refused. A busy one can be
//     accepted by name with `--accept-busy <app>`; the receipt then records it as acknowledged contention;
//   - a receipt whose render resolution was lowered automatically (R111's measured last resort) is marked `auto-lowered` and
//     does NOT count as native, whatever the display; a host's own choice is `user-lowered`, also not native.
//
//   node web/tests/journeys/harness/perf.mjs frame-pacing [--tiles 1,4,8,12,16,24,32] [--sizes 1080p,4k] [--frames 600]
//        [--supplementary] [--accept-busy Brave] [--out docs/evidence/P1-Q01/frame-pacing-<host>.json]
//   (debris growth in the live host: perf-debris.mjs; sim timing: perf-sim.mjs)
//
// Needs `npm --prefix web run build` first. Run it HEADED on the Mac (docs/evidence/P1-Q01/mac-frame-pacing.md).
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';

const here = import.meta.dirname;
export const repo = resolve(here, '../../../..');
export const LOCK = process.env.JJ_PERF_LOCK ?? join(os.tmpdir(), 'jj-perf.lock');
export const SIZES = { '1080p': { width: 1920, height: 1080 }, '4k': { width: 3840, height: 2160 } };

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

/** CPU % above which another app's GPU process counts as using the GPU (an idle Electron helper sits at 0). */
export const BUSY_CPU = 5;

/**
 * Splits `ps -axo pid=,%cpu=,command=` output into other apps' GPU processes that are busy (refused) and idle (recorded, not
 * refused). Our own perf browsers (`jj-perf-` profile directory) are ignored.
 */
export function parseGpuProcesses(psOut, busyCpu = BUSY_CPU, ownPid = process.pid) {
  const busy = [];
  const idle = [];
  const rows = psOut.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/)).filter(Boolean);
  const parent = new Map(rows.map((r) => [r[1], r[2]]));
  // Our own browser's GPU process (a descendant of this node process) is never a neighbour.
  const ours = (pid) => {
    for (let p = pid, hops = 0; p && p !== '0' && p !== '1' && hops < 30; p = parent.get(p), hops++) if (p === String(ownPid)) return true;
    return false;
  };
  for (const [, pid, , cpu, cmd] of rows) {
    const m = [null, pid, cpu, cmd];
    if (!/--type=gpu-process/.test(m[3]) || ours(pid)) continue;
    const app = (m[3].match(/\/([^/]+)\.app\//) ?? [])[1] ?? m[3].slice(0, 40);
    (Number(m[2]) > busyCpu ? busy : idle).push(`${app} gpu-process pid ${m[1]} at ${m[2]}% CPU`);
  }
  return { busy, idle };
}

/** Who holds the GPU on this machine: `busy` refuses a run, `idle` is recorded in the receipt. */
export function gpuUsers() {
  const busy = [];
  const sh = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    } catch {
      return '';
    }
  };
  const holder = lockHolder();
  if (holder) busy.push(`another perf run (pid ${holder})`);
  if (os.platform() === 'linux') {
    for (const l of sh('nvidia-smi', ['--query-compute-apps=pid,process_name', '--format=csv,noheader']).split('\n').filter(Boolean)) busy.push(`GPU process ${l.trim()}`);
  }
  const ps = parseGpuProcesses(sh('ps', ['-axo', 'pid=,ppid=,%cpu=,command=']));
  busy.push(...ps.busy);
  return { busy, idle: ps.idle };
}

/** The pid of a live perf run holding the lock (not us), or 0. A lock whose process is gone is stale and ignored. */
export function lockHolder() {
  if (!existsSync(LOCK)) return 0;
  const pid = Number(readFileSync(LOCK, 'utf8'));
  if (!pid || pid === process.pid) return 0;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    return e.code === 'EPERM' ? pid : 0;
  }
}

/** Takes the GPU lock atomically (O_EXCL), clearing a stale one; throws when a live run holds it. Returns the release function. */
export function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(LOCK, 'wx'));
      writeFileSync(LOCK, String(process.pid));
      const release = () => existsSync(LOCK) && readFileSync(LOCK, 'utf8') === String(process.pid) && unlinkSync(LOCK);
      process.on('exit', release);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = lockHolder();
      if (holder) throw new Error(`perf helper refuses this run: overlapping GPU use: another perf run (pid ${holder})`);
      try {
        unlinkSync(LOCK); // stale
      } catch {
        /* raced */
      }
    }
  }
  throw new Error('perf helper refuses this run: could not take the GPU lock');
}

/**
 * The guardrail: the reasons this run must be refused (empty: it may go ahead).
 * `accept` names busy GPU users the operator has looked at and accepts (substring match; the receipt records them).
 * @param {{ headless: boolean, supplementary?: boolean, users?: string[], accept?: string[] }} o
 */
export function refusals({ headless, supplementary = false, users = gpuUsers().busy, accept = [] }) {
  const left = users.filter((u) => !accept.some((a) => a && u.includes(a)));
  const why = [];
  if (headless && !supplementary) why.push('headless: a perf receipt needs a headed browser on a real display (pass --supplementary to record a labelled, non-hardware run)');
  if (left.length) why.push(`overlapping GPU use: ${left.join('; ')}`);
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
 * Hitch attribution (§13b.1) from per-frame samples `{ dt, heap, tasks, programs?, scriptMs?, renderMs? }`. A hitch is a frame
 * over 2× the median and over 25 ms. Evidence, in order: the host's compiled-shader-program count rose in the frame (shader
 * compile); used JS heap dropped across the frame (GC); a Long Animation Frame entry shows script time over half the frame (JS
 * on main: snapshot decode, UI) or a render phase over half of it (CPU-side draw submission, upload); a hitch in the first
 * `warmFrames` frames with none of those is first-use upload; the rest is "other (GPU or compositor)". These are heuristics
 * from what the browser exposes, labelled as such in the receipt; the worker's sim step is off the main thread and is reported
 * separately (tick rate, skipped snapshots).
 */
export function attributeHitches(samples, warmFrames) {
  const dts = samples.map((s) => s.dt);
  const median = [...dts].sort((a, b) => a - b)[dts.length >> 1];
  const counts = { 'shader-compile': 0, gc: 0, 'main-thread-js': 0, 'render-submit-or-upload': 0, 'first-use-upload': 0, 'other-gpu-or-compositor': 0 };
  const worst = [];
  samples.forEach((s, i) => {
    if (!(s.dt > 2 * median && s.dt > 25)) return;
    const prev = samples[i - 1];
    let kind;
    if (s.programs != null && prev?.programs != null && s.programs > prev.programs) kind = 'shader-compile';
    else if (s.heap < (prev?.heap ?? s.heap) - 256 * 1024) kind = 'gc';
    else if ((s.scriptMs ?? 0) > s.dt / 2 || (s.scriptMs == null && s.tasks > 0 && i >= warmFrames)) kind = 'main-thread-js';
    else if ((s.renderMs ?? 0) > s.dt / 2) kind = 'render-submit-or-upload';
    else if (i < warmFrames) kind = 'first-use-upload';
    else kind = 'other-gpu-or-compositor';
    counts[kind]++;
    worst.push({ frame: i, ms: +s.dt.toFixed(1), kind });
  });
  worst.sort((a, b) => b.ms - a.ms);
  return {
    hitches: Object.values(counts).reduce((a, b) => a + b, 0),
    byKind: counts,
    worst: worst.slice(0, 5),
    method: 'heuristic: program-count rise = shader compile; heap drop = GC; Long Animation Frame script/render share = main-thread JS / render submit; first warm-up frames = first-use upload; rest = GPU/compositor',
  };
}

/** rAF intervals + heap + shader-program count + long-animation-frame script/render time per frame, measured in the page. */
export const sampleFrames = (page, frames, statsEvery = 0) =>
  page.evaluate(
    ([n, every]) =>
      new Promise((done) => {
        const out = [];
        const loaf = [];
        let tasks = 0;
        const observe = (type, fn) => {
          try {
            new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: false });
          } catch {
            /* unsupported */
          }
        };
        observe('longtask', () => tasks++);
        observe('long-animation-frame', (e) => loaf.push(e));
        const programs = () => window.__jjRender?.programs?.() ?? null;
        let last = performance.now();
        const step = (t) => {
          const row = { dt: t - last, t, heap: performance.memory?.usedJSHeapSize ?? 0, tasks, programs: programs() };
          if (every && out.length % every === 0) {
            const st = window.__jjRender.stats(); // the host's own per-frame draw stats, read every `every` frames
            row.draws = st.drawCalls;
            row.triangles = st.triangles;
            row.debrisDrawn = st.debris;
          }
          out.push(row);
          tasks = 0;
          last = t;
          if (out.length < n + 1) requestAnimationFrame(step);
          else
            setTimeout(() => {
              // Attach each frame's Long Animation Frame (if any) to the rAF that ended it.
              for (const s of out) {
                const e = loaf.find((x) => x.startTime <= s.t && s.t <= x.startTime + x.duration + 1);
                if (!e) continue;
                s.scriptMs = e.scripts.reduce((a, c) => a + c.duration, 0);
                s.renderMs = e.styleAndLayoutStart ? e.startTime + e.duration - e.renderStart : 0;
              }
              done(out.slice(1));
            }, 50);
        };
        requestAnimationFrame(step);
      }),
    [frames, statsEvery],
  );

/** The machine, for a receipt. */
export function machine() {
  const sp = (type) => {
    try {
      return execFileSync('system_profiler', [type], { encoding: 'utf8' });
    } catch {
      return '';
    }
  };
  const hw = os.platform() === 'darwin' ? sp('SPHardwareDataType') : '';
  const gfx = os.platform() === 'darwin' ? sp('SPDisplaysDataType') : '';
  const line = (txt, re) => txt.split('\n').find((l) => re.test(l))?.split(':').slice(1).join(':').trim();
  return {
    host: os.hostname(),
    model: line(hw, /Model Name/),
    cpu: os.cpus()[0]?.model,
    memory: line(hw, /Memory:/),
    platform: `${os.platform()}/${os.arch()}`,
    gpu: line(gfx, /Chipset Model/),
    display: line(gfx, /Resolution:/),
  };
}

export const gitHead = () => execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

/**
 * Runs `body(browser, ctx)` inside the guardrails: refuses headless/overlapping runs, holds the GPU lock, launches the browser
 * HEADED (Google Chrome unless `--channel chromium`), and always releases the lock. `ctx` carries what the receipt must name.
 */
export async function withPerfBrowser(argv, body) {
  const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const supplementary = argv.includes('--supplementary');
  const headless = argv.includes('--headless');
  const channel = arg('--channel', 'chrome');
  const accept = argv.flatMap((a, i) => (a === '--accept-busy' ? [argv[i + 1]] : []));
  // A neighbour's GPU work is waited out (up to --wait-quiet seconds, default 600) before the run is refused over it.
  const waitUntil = Date.now() + Number(arg('--wait-quiet', 600)) * 1000;
  let users = gpuUsers();
  const left = (u) => u.busy.filter((b) => !accept.some((a) => a && b.includes(a)) && !/another perf run/.test(b));
  while (!headless && left(users).length && Date.now() < waitUntil) {
    await new Promise((r) => setTimeout(r, 3000));
    users = gpuUsers();
  }
  assertPerfRun({ headless, supplementary, users: users.busy, accept });
  const release = acquireLock();
  try {
    const { chromium } = await import('playwright');
    const { serve } = await import(join(repo, 'web/host/tests/lib/surface.mjs'));
    const server = await serve(join(repo, 'web/dist'));
    let browser;
    let mode;
    try {
      browser = await chromium.launch({ headless, channel: headless ? undefined : channel === 'chromium' ? undefined : channel, args: ['--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
      mode = headless ? 'headless Chromium (supplementary)' : channel === 'chromium' ? 'headed Chromium' : `headed Google ${channel}`;
    } catch (e) {
      server.close();
      throw new Error(`could not launch ${channel} headed (${e.message.split('\n')[0]}): no receipt without a headed browser`);
    }
    try {
      /** Runs one measurement and keeps it only if no OTHER app's GPU process was busy before or after it (the guard at start
       *  can't see a neighbour who begins mid-run). Retried up to 3 times; a row that never ran clean says so. */
      const clean = async (measure) => {
        let seen = [];
        const neighbours = () => gpuUsers().busy.filter((u) => !accept.some((a) => a && u.includes(a)) && !/another perf run/.test(u));
        for (let attempt = 1; attempt <= 3; attempt++) {
          // Wait (up to --wait-quiet seconds, default 600) for the neighbours' GPU work to go quiet before measuring.
          const deadline = Date.now() + Number(arg('--wait-quiet', 600)) * 1000;
          while (neighbours().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 3000));
          const before = neighbours();
          const result = await measure();
          const after = neighbours();
          seen = [...new Set([...before, ...after])];
          if (!seen.length) return { result, attempts: attempt, contention: [] };
          console.error(`neighbour on the GPU during the run (attempt ${attempt}): ${seen.join('; ')}`);
          await new Promise((r) => setTimeout(r, 5000));
          if (attempt === 3) return { result, attempts: attempt, contention: seen };
        }
      };
      const ctx = {
        arg,
        clean,
        server,
        supplementary,
        header: () => ({
          evidenceKind: supplementary ? 'supplementary (not hardware evidence)' : 'ev:hardware',
          machine: machine(),
          browser: `${mode}, Chromium ${browser.version()} (Playwright)`,
          build: gitHead(),
          takenAt: new Date().toISOString(),
          gpuContention: { idleOtherGpuProcesses: users.idle, acknowledgedBusy: users.busy.filter((u) => accept.some((a) => a && u.includes(a))) },
        }),
      };
      return await body(browser, ctx);
    } finally {
      await browser.close();
      server.close();
    }
  } finally {
    release();
  }
}

export function writeReceipt(path, receipt) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function framePacing(argv) {
  await withPerfBrowser(argv, async (browser, ctx) => {
    const { arg } = ctx;
    const tiles = arg('--tiles', '1,4,8,12,16,24,32').split(',').map(Number);
    const sizes = arg('--sizes', '1080p,4k').split(',');
    const frames = Number(arg('--frames', 600));
    const { openHost } = await import(join(repo, 'web/host/tests/lib/surface.mjs'));
    const rows = [];
    for (const name of sizes) {
      for (const n of tiles) {
        const { result: row, attempts, contention } = await ctx.clean(async () => {
          const page = await browser.newPage({ viewport: SIZES[name], deviceScaleFactor: 1 });
          await openHost(page, `${ctx.server.url}/host/?synthetic=32&freeze=300&map&tiles=${n}`);
          await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 4, null, { timeout: 180_000 });
          const warm = 120; // frames after open that count as warm-up (shader compile and upload happen here)
          const samples = await sampleFrames(page, warm + frames);
          const stats = await page.evaluate(() => window.__jjRender.stats());
          await page.close();
          const steady = samples.slice(warm);
          return {
            size: name,
            tiles: n,
            ...markResolution(stats),
            steady: summarise(steady.map((s) => s.dt)),
            warmup: summarise(samples.slice(0, warm).map((s) => s.dt)),
            hitches: attributeHitches(samples, warm),
            draws: stats.drawCalls,
            triangles: stats.triangles,
            backend: stats.backend,
          };
        });
        rows.push({ ...row, attempts, neighbourOnGpu: contention, clean: contention.length === 0 });
        console.log(JSON.stringify(rows.at(-1)));
      }
    }
    const receipt = {
      label: 'P1-Q01 host frame pacing',
      ...ctx.header(),
      cohort: 'synthetic 32-car snapshot (frozen tick 300) on the greybox map; one host tab; no controllers',
      viewportNote: 'the render size is the Playwright viewport at DPR 1 (the window is resized to it); renderPixels is what the host drew into',
      rows,
      nativeRowsOnly: rows.every((r) => r.countsAsNative),
      note: 'rows with countsAsNative=false (auto- or user-lowered, or browser-limited) do not count as native-resolution evidence (R111)',
    };
    const out = resolve(repo, arg('--out', `docs/evidence/P1-Q01/frame-pacing-${os.hostname().replace(/\..*/, '')}${ctx.supplementary ? '-supplementary' : ''}.json`));
    writeReceipt(out, receipt);
    console.log(`wrote ${out}; all rows native: ${receipt.nativeRowsOnly}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'frame-pacing') {
    framePacing(rest).catch((e) => {
      console.error(e.message);
      process.exit(2);
    });
  } else {
    console.error('usage: perf.mjs frame-pacing [--tiles 1,4,8] [--sizes 1080p,4k] [--frames 600] [--supplementary] [--accept-busy app] [--out file]');
    process.exit(2);
  }
}
