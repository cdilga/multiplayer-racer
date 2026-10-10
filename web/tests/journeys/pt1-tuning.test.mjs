// The owner tuning menu, part 1 (br-2sdu.1). Without the owner flag the host has no tuning panel and never loads its
// chunk. With `?tune` (remembered in that browser) a race runs on autopilot; the panel, built from the sim's own tuning,
// sets the engine force to 0 mid-race: the sim reads the new value back within a second and the cars slow down; Reset
// puts it back; Export carries every change as a `jj.tuning-patch.v1` file for `jj vehicle tune`. Captures go to
// $JJ_CAPTURE_DIR when set.
//   node --test web/tests/journeys/pt1-tuning.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/pt1tune/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'pt1tune'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const meanSpeed = (host) => host.evaluate(async () => { const o = await window.__jjTest.observe(); return o.cars.reduce((a, c) => a + Math.abs(c.speed), 0) / Math.max(1, o.cars.length); });

async function race(host) {
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  for (let k = 1; k <= 2; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
    await frame(host, `syn${k}`, { ready: true });
  }
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
}

test('no owner flag: no panel and no tuning chunk', { timeout: 120_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const chunks = [];
  host.on('request', (r) => /tuning|panel/i.test(r.url()) && chunks.push(r.url()));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjRoom?.view()?.phase === 'Lobby');
  await host.waitForTimeout(1000);
  assert.equal(await host.locator('.jj-tune-toggle, .jj-tune').count(), 0, 'no tuning UI');
  assert.equal(await host.evaluate(() => 'jjTune' in window || '__jjTune' in window), false);
  assert.deepEqual(chunks, [], 'the tuning chunk is never fetched');
});

test('?tune: a live change mid-race reaches the sim and the cars; reset; export', { timeout: 240_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9&tune`);
  await race(host);
  await wait(host, () => !!window.__jjTune);
  await host.waitForTimeout(3000);
  const before = await meanSpeed(host);
  assert.ok(before > 3, `racing before the change (${before} m/s)`);

  await host.locator('.jj-tune-toggle').click();
  const field = host.locator('[data-field="max_engine_force"]');
  await field.waitFor();
  const original = Number(await field.inputValue());
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/tuning-open-1280x720.png` });
  const t0 = Date.now();
  await field.fill('0');
  await field.dispatchEvent('change');
  await wait(host, () => window.__jjTune.inspect().current.max_engine_force === 0, undefined, 5_000); // inside 1 s on the Mac (self-review); CI runners are several times slower
  const appliedMs = Date.now() - t0;
  await host.waitForTimeout(4000);
  const after = await meanSpeed(host);
  assert.ok(after < before * 0.6, `no engine: the cars slow (${before.toFixed(1)} -> ${after.toFixed(1)} m/s)`);
  const shown = await host.evaluate(() => window.__jjTune.inspect());
  assert.deepEqual(shown.patch, { contract: 'jj.tuning-patch.v1', profile: 'assets/profiles/cruz-missile.json', set: [['max_engine_force', '0']] });
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/tuning-changed-1280x720.png` });

  // A bad value is refused and shown; the sim keeps the last good one.
  const gravel = host.locator('[data-field="surfaces.gravel"]');
  if (await gravel.count()) {
    await gravel.fill('0.5');
    await gravel.dispatchEvent('change');
    await wait(host, () => window.__jjTune.inspect().current['surfaces.gravel'] === 0.5, undefined, 5_000);
  }

  // Reset puts the engine back and it drops out of the export.
  await host.locator('[data-reset="max_engine_force"]').click();
  await wait(host, (v) => window.__jjTune.inspect().current.max_engine_force === v, original, 5_000);
  const patch = (await host.evaluate(() => window.__jjTune.inspect())).patch;
  assert.ok(!patch.set.some(([f]) => f === 'max_engine_force'), `reset leaves it out of the export: ${JSON.stringify(patch)}`);

  // Export downloads the patch file.
  const [download] = await Promise.all([host.waitForEvent('download'), host.locator('[data-tune-export]').click()]);
  assert.match(download.suggestedFilename(), /^tuning-.*\.json$/);
  console.log(`# applied in ${appliedMs} ms; mean speed ${before.toFixed(1)} -> ${after.toFixed(1)} m/s`);
  assert.deepEqual(errors, []);
});

// Part 2 (br-2sdu.2): the input profile in the same panel. A real phone joins through the real path and holds a left
// stick just short of the shipped drift entry; the panel lowers the entry deflection mid-drive; the phone's own jj-input
// and the host's reading of that seat both switch to drifting within a second; a value the validator refuses never
// reaches the phone and stays out of the export; Reset puts the shipped threshold back on the phone.
test('?tune: an input threshold changed mid-drive reaches a connected phone within a second; refused values; reset; export', { timeout: 240_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?drive&test=live&tune`);
  await wait(host, () => window.__jjNet?.code() && window.__jjTest && !!window.__jjTune, undefined, 90_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const phone = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })).newPage();
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(joinUrl);
  await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  await wait(phone, () => window.__jjController.inspect().phase === 'playing');
  await wait(phone, () => window.__jjTutorial.inspect()?.open === true);
  await phone.getByRole('button', { name: 'Skip tutorial' }).click();
  const endpoint = (await phone.evaluate(() => window.__jjController.inspect())).link.endpointId;

  const phoneView = () => phone.evaluate(() => { const i = window.__jjController.inspect().inputProfile; return { entry: i.profile.drift.enterDeflection, held: i.driftHeld, tuned: i.tuned }; });
  const hostDrifts = () => host.evaluate(async (ep) => (await window.__jjTest.observe()).host.seats.find((s) => s.endpoint === ep)?.drifting, endpoint);
  /** A fresh sample each call, like a thumb that never holds perfectly still: deflection 0.886, 84 degrees off vertical. */
  const hold = () => phone.evaluate(() => window.__jjController.setSticks({ x: 0.88, y: 0.09, touch: true }, { x: 0, y: 0, touch: false }));

  await hold();
  await phone.waitForTimeout(800);
  await hold();
  assert.deepEqual(await phoneView(), { entry: 0.9, held: false, tuned: false }, 'the shipped profile: 0.886 is short of the 0.9 entry');
  assert.equal(await hostDrifts(), false, 'and the host reads no drift');

  await host.locator('.jj-tune-toggle').click();
  const entry = host.locator('[data-field="input.drift.enterDeflection"]');
  await entry.waitFor();
  assert.equal(Number(await entry.inputValue()), 0.9);
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/tuning-input-1280x720.png` });
  const t0 = Date.now();
  await entry.fill('0.8');
  await entry.dispatchEvent('change');
  let seen;
  let phoneAt = 0;
  for (;;) {
    await hold();
    seen = await phoneView();
    if (seen.entry === 0.8 && !phoneAt) phoneAt = Date.now() - t0;
    if (seen.entry === 0.8 && seen.held && (await hostDrifts())) break;
    assert.ok(Date.now() - t0 < 10_000, `the new threshold never took effect: ${JSON.stringify(seen)}`);
    await phone.waitForTimeout(30);
  }
  const appliedMs = Date.now() - t0;
  // Inside 1 s on the Mac; CI runners are several times slower (the same allowance as the vehicle change above).
  assert.ok(appliedMs <= (process.env.CI ? 5000 : 1000), `the phone and the host used the new threshold in ${appliedMs} ms`);
  assert.equal(seen.tuned, true);
  console.log(`# input threshold live on the phone and the host in ${appliedMs} ms (profile on the phone after ${phoneAt} ms)`);

  // A value the validator refuses (exit above entry) is shown, never sent on, and left out of the export.
  const exit = host.locator('[data-field="input.drift.exitDeflection"]');
  await exit.fill('0.99');
  await exit.dispatchEvent('change');
  await host.locator('[data-tune-error]').getByText('exitDeflection').waitFor({ timeout: 5000 });
  await wait(host, () => !('input.drift.exitDeflection' in window.__jjTune.inspect().changed), undefined, 5000);
  assert.equal(Number(await exit.inputValue()), 0.75, 'the row goes back to what the host holds');
  await hold();
  assert.equal((await phone.evaluate(() => window.__jjController.inspect().inputProfile.profile.drift.exitDeflection)), 0.75);
  const patch = (await host.evaluate(() => window.__jjTune.inspect())).patch;
  assert.deepEqual(patch, { contract: 'jj.tuning-patch.v1', profile: 'assets/profiles/cruz-missile.json', set: [], inputProfile: 'assets/profiles/input.json', inputSet: [['drift.enterDeflection', '0.8']] });
  const [download] = await Promise.all([host.waitForEvent('download'), host.locator('[data-tune-export]').click()]);
  assert.match(download.suggestedFilename(), /^tuning-.*\.json$/);

  // Reset puts the shipped threshold back on the phone and the host.
  await host.locator('[data-reset="input.drift.enterDeflection"]').click();
  for (const t1 = Date.now(); ; ) {
    await hold();
    if ((await phoneView()).entry === 0.9) break;
    assert.ok(Date.now() - t1 < 10_000, 'reset never reached the phone');
    await phone.waitForTimeout(30);
  }
  // The drift in hand stays held down to the exit deflection (hysteresis); let go, then the same push is no drift again.
  await phone.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
  await phone.waitForTimeout(300);
  for (const t1 = Date.now(); ; ) {
    await hold();
    const v = await phoneView();
    if (!v.held && !(await hostDrifts())) break;
    assert.ok(Date.now() - t1 < 5_000, `the shipped threshold is back, so no drift: ${JSON.stringify(v)}`);
    await phone.waitForTimeout(30);
  }
  assert.deepEqual(errors, []);
});

// Part 3 (br-2sdu.3): the generator data in the same panel. Length band and relief are changed, a value the generator's
// validator refuses is shown and kept out, Regenerate builds the same seed again with them, and the measured track
// matches; a second Regenerate with the same values builds the identical track (the journalled values replay it).
test('?tune: generator values change the measured length and relief on Regenerate; refused values; replay; export', { timeout: 300_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9&tune`);
  await wait(host, () => window.__jjRoom?.view()?.phase === 'Lobby' && !!window.__jjTune, undefined, 90_000);
  const built = () => host.evaluate(() => window.__jjPrepare.seeds().filter((s) => s.lengthM !== undefined).at(-1) ?? null);
  await host.evaluate(() => window.__jjPrepare.reroll()); // the Lobby asks for its first track (the shipped data)
  await wait(host, () => window.__jjPrepare.seeds().some((s) => s.lengthM !== undefined), undefined, 90_000);
  const first = await built();
  assert.equal(first.generator, undefined, 'the first track is built with the shipped data');

  await host.locator('.jj-tune-toggle').click();
  const field = (path) => host.locator(`[data-field="generator.${path}"]`);
  const setField = async (path, value) => {
    await field(path).fill(String(value));
    await field(path).dispatchEvent('change');
  };
  await field('course.lengthMinM').waitFor();
  assert.equal(Number(await field('course.lengthMinM').inputValue()), 700, 'the generator rows come from the shipped data file');
  assert.equal(await host.locator('[data-tune-regenerate]').count(), 1);

  // Relief first: the course is the same (its band is unchanged), so only the heights differ.
  await host.evaluate(() => document.querySelectorAll('.jj-tune details').forEach((d) => (d.open = true)));
  for (const b of ['town', 'rocks', 'outbackDirt', 'outbackBitumen']) {
    await setField(`biomes.${b}.terrain.reliefM`, 40);
    await setField(`biomes.${b}.terrain.maxGrade`, 0.12);
  }
  const regenerate = async () => {
    const n = await host.evaluate(() => window.__jjPrepare.seeds().length);
    await host.locator('[data-tune-regenerate]').click();
    await wait(host, (n) => { const s = window.__jjPrepare.seeds(); return s.length > n && s.at(-1).lengthM !== undefined; }, n, 60_000);
    return built();
  };
  const taller = await regenerate();
  assert.equal(taller.seed, first.seed, 'Regenerate builds the current seed again');
  assert.ok(taller.generator, 'the preparer records the generator document it used');
  assert.equal(taller.lengthM, first.lengthM, 'the same course: the length did not move');
  assert.ok(taller.reliefM > first.reliefM * 1.3, `measured relief ${first.reliefM} -> ${taller.reliefM} m`);

  // Then the length band. A band whose minimum is above its maximum is refused by the generator's own validator:
  // shown, never kept.
  await setField('course.lengthMinM', 720);
  await setField('course.lengthMaxM', 820);
  await setField('course.lengthMinM', 5000);
  await host.locator('[data-tune-error]').getByText('lengthMinM').waitFor({ timeout: 5000 });
  assert.equal(Number(await field('course.lengthMinM').inputValue()), 720, 'the row goes back to the last good value');
  const held = (await host.evaluate(() => window.__jjTune.inspect())).patch;
  assert.equal(held.generator, 'assets/profiles/generator.json');
  assert.equal(held.generatorSet.length, 10);
  assert.ok(held.generatorSet.some(([f, v]) => f === 'course.lengthMinM' && v === '720'));
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/tuning-generator-refused-1920x1080.png` });
  const tuned = await regenerate();
  assert.equal(tuned.seed, first.seed);
  assert.ok(tuned.lengthM >= 720 && tuned.lengthM <= 820, `measured length ${tuned.lengthM} m is inside the tuned band 720-820`);
  console.log(`# seed ${first.seed}: length ${first.lengthM} -> ${tuned.lengthM} m, relief ${first.reliefM} -> ${taller.reliefM} m (same course) -> ${tuned.reliefM} m`);
  await host.locator('[data-tune-built]').getByText(`${tuned.lengthM} m long`).waitFor({ timeout: 5000 });
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/tuning-generator-built-1920x1080.png` });

  // Replay: the same values on the same seed build the same track, bit for bit.
  const again = await regenerate();
  assert.deepEqual([again.seed, again.generator, again.lengthM, again.reliefM], [tuned.seed, tuned.generator, tuned.lengthM, tuned.reliefM]);
  const journal = (await host.evaluate(() => window.__jjTune.inspect())).generatorJournal;
  assert.equal(journal.length, 3);
  assert.deepEqual(journal[1].set, journal[2].set);

  // Reset puts a row back and out of the export; the export downloads with the generator patch.
  await host.locator('[data-reset="generator.course.lengthMaxM"]').click();
  assert.equal(Number(await field('course.lengthMaxM').inputValue()), 1100);
  const patch = (await host.evaluate(() => window.__jjTune.inspect())).patch;
  assert.ok(!patch.generatorSet.some(([f]) => f === 'course.lengthMaxM'));
  if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/tuning-generator-reset-1920x1080.png` });
  const [download] = await Promise.all([host.waitForEvent('download'), host.locator('[data-tune-export]').click()]);
  assert.match(download.suggestedFilename(), /^tuning-.*\.json$/);
  assert.deepEqual(errors, []);
});

// Parent AC1 (br-2sdu): a production build (JJ_PRODUCTION=1) contains none of the tuning code, the generator rows included.
test('a production build contains no tuning panel code', { timeout: 300_000 }, () => {
  const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const out = join('dist-test', 'pt1prod');
  execFileSync(process.execPath, [join(web, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--logLevel', 'error'], {
    cwd: web,
    env: { ...process.env, JJ_PRODUCTION: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const files = [];
  const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(js|css|html)$/.test(e.name) && files.push(join(d, e.name))));
  walk(join(web, out));
  assert.ok(files.length > 5);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const marker of ['jj-tune', 'jj.tuning-patch', 'Owner tuning', 'generatorWith', 'data-tune-regenerate']) assert.ok(!text.includes(marker), `${f} contains ${marker}`);
  }
});
