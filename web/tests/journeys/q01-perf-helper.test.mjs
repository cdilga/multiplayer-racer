// P1-Q01 (ev:ci): the perf helper's guardrails (web/tests/journeys/harness/perf.mjs). It refuses headless and overlapping-GPU
// runs, and an auto-lowered (R111) receipt is marked as such and never counts as native. Node only: no browser, no GPU.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPerfRun, attributeHitches, markResolution, parseGpuProcesses, refusals, summarise } from './harness/perf.mjs';

const perf = new URL('./harness/perf.mjs', import.meta.url).pathname;
const stats = (o = {}) => ({ width: 3840, height: 2160, nativeWidth: 3840, nativeHeight: 2160, resolution: 'native', autoEvents: [], limitedBy: null, ...o });

test('a headless run is refused; --supplementary admits it as a labelled non-hardware run', () => {
  assert.throws(() => assertPerfRun({ headless: true, users: [] }), /headless/);
  assert.deepEqual(refusals({ headless: false, users: [] }), []);
  assert.deepEqual(refusals({ headless: true, supplementary: true, users: [] }), []);
});

test('an overlapping GPU user is refused, supplementary or not, unless the operator accepts it by name', () => {
  assert.throws(() => assertPerfRun({ headless: false, users: ['another perf run (pid 42)'] }), /overlapping GPU/);
  assert.throws(() => assertPerfRun({ headless: true, supplementary: true, users: ['GPU process 99, python'] }), /overlapping GPU/);
  assert.deepEqual(refusals({ headless: false, users: ['Brave Browser Helper gpu-process pid 6 at 36% CPU'], accept: ['Brave'] }), []);
  assert.equal(refusals({ headless: false, users: ['Brave gpu-process', 'Chrome gpu-process'], accept: ['Brave'] }).length, 1);
});

test('only busy GPU processes of other apps count as overlap; idle helpers are recorded', () => {
  const ps = [
    '6687 1 36.1 /Applications/Brave Browser.app/Contents/Frameworks/Helper --type=gpu-process --x',
    '7098 1 0.0 /Applications/Logi Tune.app/Contents/Frameworks/Helper --type=gpu-process --x',
    '8000 1 90.0 /Applications/Foo.app/Contents/MacOS/Foo --type=renderer',
    '500 1 0.0 node perf.mjs',
    '501 500 1.0 playwright driver',
    '502 501 1.0 /x/chrome',
    '503 502 80.0 /x/chrome --type=gpu-process', // our own browser's GPU process: never a neighbour
  ].join('\n');
  const { busy, idle } = parseGpuProcesses(ps, 5, 500);
  assert.equal(busy.length, 1);
  assert.match(busy[0], /Brave Browser/);
  assert.equal(idle.length, 1);
  assert.match(idle[0], /Logi Tune/);
});

test('the CLI refuses --headless before launching anything', () => {
  const r = spawnSync(process.execPath, [perf, 'frame-pacing', '--headless'], { encoding: 'utf8', env: { ...process.env, JJ_PERF_LOCK: join(os.tmpdir(), `jj-perf-test-${process.pid}.lock`) } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refuses this run: headless/);
});

test('the CLI refuses to start while another perf run holds the GPU lock', async () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'jj-perf-lock-'));
  const lock = join(dir, 'perf.lock');
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    writeFileSync(lock, String(holder.pid));
    // --supplementary so only the overlap can be the reason.
    const r = spawnSync(process.execPath, [perf, 'frame-pacing', '--supplementary', '--headless'], { encoding: 'utf8', env: { ...process.env, JJ_PERF_LOCK: lock } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /overlapping GPU use: another perf run \(pid \d+\)/);
    assert.ok(existsSync(lock), 'the refused run leaves the holder lock alone');
  } finally {
    holder.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a native receipt counts as native; auto-lowered, user-lowered and browser-limited ones do not', () => {
  assert.equal(markResolution(stats()).countsAsNative, true);
  assert.equal(markResolution(stats()).resolutionSource, 'native');
  const auto = markResolution(stats({ width: 2880, height: 1620, resolution: 'auto', autoEvents: [{ tick: 900, from: 1, to: 0.75 }] }));
  assert.equal(auto.resolutionSource, 'auto-lowered');
  assert.equal(auto.countsAsNative, false);
  assert.equal(auto.autoLowered.length, 1);
  // An auto lowering that later returned to full size still leaves the receipt marked: the run was not all native.
  assert.equal(markResolution(stats({ autoEvents: [{ tick: 900 }] })).countsAsNative, false);
  const user = markResolution(stats({ width: 1920, height: 1080, resolution: 'user' }));
  assert.equal(user.resolutionSource, 'user-lowered');
  assert.equal(user.countsAsNative, false);
  assert.equal(markResolution(stats({ limitedBy: 'max texture size' })).countsAsNative, false);
  assert.equal(markResolution(undefined).countsAsNative, false);
});

test('percentiles keep the hitch the median hides, and hitches are attributed', () => {
  const dts = Array.from({ length: 200 }, (_, i) => (i === 150 ? 90 : 8.3));
  const s = summarise(dts);
  assert.equal(s.p50, 8.3);
  assert.equal(s.max, 90);
  const samples = dts.map((dt, i) => ({ dt, heap: i >= 150 ? 1_000_000 : 5_000_000, tasks: 0 }));
  const h = attributeHitches(samples, 120);
  assert.equal(h.hitches, 1);
  assert.equal(h.byKind.gc, 1);
  const flat = (f) => dts.map((dt, i) => ({ dt: i === 150 ? 90 : dt, heap: 5_000_000, tasks: 0, ...f(i) }));
  assert.equal(attributeHitches(flat((i) => ({ programs: i >= 150 ? 12 : 11 })), 120).byKind['shader-compile'], 1);
  assert.equal(attributeHitches(flat((i) => (i === 150 ? { scriptMs: 70 } : {})), 120).byKind['main-thread-js'], 1);
  assert.equal(attributeHitches(flat((i) => (i === 150 ? { renderMs: 60 } : {})), 120).byKind['render-submit-or-upload'], 1);
  assert.equal(attributeHitches(flat(() => ({})), 120).byKind['other-gpu-or-compositor'], 1);
  const warm = attributeHitches(dts.map((dt, i) => ({ dt: i === 10 ? 120 : dt, heap: 5_000_000, tasks: 0 })), 120);
  assert.equal(warm.byKind['first-use-upload'], 1);
});
