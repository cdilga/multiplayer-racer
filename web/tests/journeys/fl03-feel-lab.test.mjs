// The Feel Lab tab of the owner tuning menu (P1-FL03, R131). Without the owner flag the host has none of it. With `?tune`, two
// controllers drive mid-race on a fixed course while the lab switches the handling preset Off -> Kart -> Rally, moves the
// Power and Grip sliders and flips A/B: every roster vehicle's tuning in the sim shows each change within a second and a half
// (a ceiling for CI; the Mac is far inside it), the cars keep moving, and an exported patch carries the lab's setup and is
// accepted by `jj vehicle tune --check`. Captures go to $JJ_CAPTURE_DIR when set.
//   node --test web/tests/journeys/fl03-feel-lab.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/fl03lab/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const JJ = process.env.JJ_BIN ?? join(repo, 'target', 'debug', 'jj');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'fl03lab'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-5;
const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
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

test('no owner flag: no Feel Lab', { timeout: 120_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const chunks = [];
  host.on('request', (r) => /\/(?:assets|test)\/(?:tuning|panel|lab|generator)[-.]/i.test(r.url()) && chunks.push(r.url()));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjRoom?.view()?.phase === 'Lobby');
  await host.waitForTimeout(1000);
  assert.equal(await host.locator('.jj-tune-toggle, .jj-tune, [data-tune-tab], [data-lab-preset]').count(), 0, 'no tuning UI, no lab tab');
  assert.equal(await host.evaluate(() => '__jjTune' in window), false);
  assert.deepEqual(chunks, [], 'no tuning or lab chunk is fetched');
});

const slide = (host, id, log2) => host.locator(`[data-lab-slider="${id}"]`).evaluate((el, v) => {
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, log2);

for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  test(`?tune ${w}x${h}: presets, sliders and A/B switch live mid-race for every vehicle; the patch validates`, { timeout: 300_000 }, async () => {
    const host = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    const errors = [];
    host.on('pageerror', (e) => errors.push(e.message));
    await host.addInitScript(() => { try { localStorage.removeItem('jj.feellab.slots.v1'); } catch { /* none */ } });
    await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9&tune&map=greybox-loop`);
    await race(host);
    await wait(host, () => !!window.__jjTune);
    await host.locator('.jj-tune-toggle').click();
    await host.locator('[data-tune-tab="lab"]').click();
    await host.locator('[data-lab-preset="kart"]').waitFor();
    const lab = () => host.evaluate(() => window.__jjTune.lab.inspect());
    await wait(host, () => Object.keys(window.__jjTune.lab.inspect().bases).length > 0, undefined, 10_000);
    const ids = (await lab()).vehicles;
    assert.ok(ids.length >= 2, `the roster has several vehicles (${ids})`);
    const home = await host.evaluate(() => document.querySelector('[data-tune-vehicle]').value);
    const idle = (host_) => wait(host_, () => !/Applying/.test(window.__jjTune.lab.inspect().status), undefined, 5000);

    /** The sim's value for a vehicle: the panel reads it back from the worker once that vehicle is selected. */
    const simValue = async (vehicle, path) => {
      await host.selectOption('[data-tune-vehicle]', vehicle);
      await wait(host, (v) => document.querySelector('[data-tune-vehicle]').value === v, vehicle, 5000);
      await host.waitForTimeout(300); // the panel's own read-back after a selection
      return host.evaluate((p) => window.__jjTune.inspect().current[p], path);
    };
    const everyVehicle = async (path) => {
      const out = {};
      for (const id of ids) out[id] = await simValue(id, path);
      await host.selectOption('[data-tune-vehicle]', home);
      return out;
    };
    const moving = async (what) => {
      await host.waitForTimeout(1200);
      const v = await meanSpeed(host);
      assert.ok(v > 2, `the cars keep moving ${what} (${v.toFixed(1)} m/s)`);
    };

    const base = await everyVehicle('max_engine_force');
    assert.ok(Object.values(await everyVehicle('handling.front_grip')).every((v) => v === undefined), 'Off: no handling section on any vehicle');
    await moving('before the lab changes anything');

    const presets = JSON.parse(readFileSync(join(repo, 'assets/profiles/handling-presets.json'), 'utf8')).presets;
    const front = (id) => presets.find((p) => p.id === id).handling.front_grip;
    const flip = async (button, want) => {
      const t0 = Date.now();
      await host.locator(button).click();
      await wait(host, (w) => { const i = window.__jjTune.lab.inspect(); return i.applied && i.applied.preset === w && !/Applying/.test(i.status); }, want, 5000);
      return Date.now() - t0;
    };

    // Off -> Kart -> Rally: every vehicle gets the preset, within the ceiling.
    let ms = await flip('[data-lab-preset="kart"]', 'kart');
    assert.ok(ms < 1500, `Kart reached every vehicle in ${ms} ms`);
    for (const [id, v] of Object.entries(await everyVehicle('handling.front_grip'))) assert.ok(near(v, front('kart')), `${id}: Kart front grip`);
    await moving('on Kart');
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/lab-kart-${w}x${h}.png` });
    ms = await flip('[data-lab-preset="rally"]', 'rally');
    assert.ok(ms < 1500, `Rally reached every vehicle in ${ms} ms`);
    for (const [id, v] of Object.entries(await everyVehicle('handling.front_grip'))) assert.ok(near(v, front('rally')), `${id}: Rally front grip`);
    await moving('on Rally');

    // Power ~1.5x (log2 0.6, a step of the slider): engine force on every vehicle.
    await slide(host, 'power', 0.6);
    await idle(host);
    const m = (await lab()).applied.m.power;
    assert.ok(Math.abs(m - 2 ** 0.6) < 0.001);
    for (const [id, v] of Object.entries(await everyVehicle('max_engine_force'))) assert.ok(Math.abs(v / base[id] - m) < 0.001, `${id}: engine force ${base[id]} -> ${v} (${m}x)`);
    await moving('with 1.5x power');
    // Grip slider (slidier): live on a preset.
    assert.equal(await host.locator('[data-lab-slider="grip"]').isDisabled(), false);
    await slide(host, 'grip', -0.5);
    await idle(host);
    for (const [id, v] of Object.entries(await everyVehicle('handling.front_grip'))) assert.ok(Math.abs(v / front('rally') - 2 ** -0.5) < 0.001, `${id}: grip slider ${v}`);
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/lab-sliders-${w}x${h}.png` });

    // A = Rally, slidier, 1.5x power; B = Off at 1x. Flip live.
    await host.locator('[data-lab-save="A"]').click();
    await host.locator('[data-lab-preset="off"]').click();
    await slide(host, 'power', 0);
    await wait(host, () => { const i = window.__jjTune.lab.inspect(); return i.applied.preset === 'off' && i.applied.m.power === 1 && !/Applying/.test(i.status); }, undefined, 5000);
    assert.equal(await host.locator('[data-lab-slider="grip"]').isDisabled(), true, 'Off: the grip slider is disabled');
    await host.locator('[data-lab-save="B"]').click();
    assert.ok(Object.values(await everyVehicle('handling.front_grip')).every((v) => v === undefined), 'Off again: no handling on any vehicle');
    for (const [id, v] of Object.entries(await everyVehicle('max_engine_force'))) assert.ok(near(v, base[id]), `${id}: engine force back to the shipped value`);
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/lab-ab-${w}x${h}.png` });
    const flips = [];
    for (const k of ['A', 'B', 'A']) {
      flips.push(await flip(`[data-lab-flip="${k}"]`, k === 'A' ? 'rally' : 'off'));
      await moving(`after flipping to ${k}`);
    }
    assert.ok(Math.max(...flips) < 1500, `A/B flips applied in ${flips} ms`);
    for (const [id, v] of Object.entries(await everyVehicle('handling.front_grip'))) assert.ok(Math.abs(v / front('rally') - 2 ** -0.5) < 0.001, `${id}: slot A is live`);
    for (const [id, v] of Object.entries(await everyVehicle('max_engine_force'))) assert.ok(Math.abs(v / base[id] - 2 ** 0.6) < 0.001, `${id}: slot A power`);
    assert.equal(await host.evaluate(() => JSON.parse(localStorage.getItem('jj.feellab.slots.v1')).A.preset), 'rally', 'the slots persist in this browser');
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/lab-flipped-${w}x${h}.png` });

    // Export: the lab's setup is in the patch (selected vehicle and the others), and `jj vehicle tune --check` accepts it.
    const patch = (await host.evaluate(() => window.__jjTune.inspect())).patch;
    assert.ok(patch.set.some(([f]) => f === 'handling'), `the handling section is in the patch: ${JSON.stringify(patch.set.map(([f]) => f))}`);
    assert.ok(patch.set.some(([f]) => f === 'max_engine_force'));
    assert.ok(patch.otherVehicles?.length === ids.length - 1 && patch.otherVehicles.every((o) => o.set.some(([f]) => f === 'handling')), 'the other vehicles ride along');
    const dir = mkdtempSync(join(tmpdir(), 'fl03-'));
    let n = 0;
    for (const [profile, set] of [[patch.profile, patch.set], ...patch.otherVehicles.map((o) => [o.profile, o.set])]) {
      const file = join(dir, `patch-${n++}.json`);
      writeFileSync(file, JSON.stringify({ contract: 'jj.tuning-patch.v1', profile, set }));
      const out = execFileSync(JJ, ['vehicle', 'tune', file, '--check'], { cwd: repo, encoding: 'utf8' });
      assert.match(out, /handling/, `the check names the handling change for ${profile}: ${out}`);
    }
    const [download] = await Promise.all([host.waitForEvent('download'), host.locator('[data-tune-export]').click()]);
    assert.match(download.suggestedFilename(), /^tuning-.*\.json$/);

    // Back to Off with every slider at 1x leaves nothing of the lab in the patch.
    await host.locator('[data-lab-preset="rally"]').click(); // the grip slider only moves on a preset
    for (const id of ['grip', 'power', 'air', 'launch', 'boost']) await slide(host, id, 0);
    await host.locator('[data-lab-preset="off"]').click();
    await wait(host, () => { const i = window.__jjTune.lab.inspect(); return i.applied.preset === 'off' && Object.values(i.applied.m).every((v) => v === 1) && !/Applying/.test(i.status); }, undefined, 8000);
    await host.waitForTimeout(400);
    const clean = (await host.evaluate(() => window.__jjTune.inspect())).patch;
    assert.deepEqual(clean.set, [], `everything back to the shipped car: ${JSON.stringify(clean.set)}`);
    assert.equal(clean.otherVehicles, undefined);
    assert.deepEqual(errors, []);
  });
}
