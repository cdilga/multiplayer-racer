// P1-Q01 (ev:ci): the perf helper's guardrails. It refuses headless and overlapping-GPU runs, and an auto-lowered (R111)
// receipt is marked as such and never counts as native. No browser needed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { assertPerfRun, attributeHitches, markResolution, refusals, summarise } from './perf.mjs';

const stats = (o = {}) => ({ width: 3840, height: 2160, nativeWidth: 3840, nativeHeight: 2160, resolution: 'native', autoEvents: [], limitedBy: null, ...o });

test('a headless run is refused; --supplementary admits it as a labelled non-hardware run', () => {
  assert.throws(() => assertPerfRun({ headless: true, users: [] }), /headless/);
  assert.deepEqual(refusals({ headless: false, users: [] }), []);
  assert.deepEqual(refusals({ headless: true, supplementary: true, users: [] }), []);
});

test('an overlapping GPU user is refused, supplementary or not', () => {
  assert.throws(() => assertPerfRun({ headless: false, users: ['another perf run (pid 42)'] }), /overlapping GPU/);
  assert.throws(() => assertPerfRun({ headless: true, supplementary: true, users: ['GPU process 99, python'] }), /overlapping GPU/);
});

test('the CLI itself refuses --headless before launching anything', () => {
  const r = spawnSync(process.execPath, [new URL('./perf.mjs', import.meta.url).pathname, 'frame-pacing', '--headless'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refuses this run: headless/);
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
  const warm = attributeHitches(dts.map((dt, i) => ({ dt: i === 10 ? 120 : dt, heap: 5_000_000, tasks: 0 })), 120);
  assert.equal(warm.byKind['shader-compile-or-upload'], 1);
});
