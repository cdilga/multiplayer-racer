// The Feel Lab tab of the owner tuning menu (P1-FL03, R131; P1-FL04.2 removed the handling presets). Without the owner flag the
// host has none of it. With `?tune`, two controllers drive mid-race on a fixed course while the lab moves the Turn-in, Grip and
// Power sliders over the shipped arcade car controller and flips A/B: every roster vehicle's tuning in the sim shows each change
// within a second and a half (a ceiling for CI; the Mac is far inside it), the cars keep moving, and an exported patch carries
// the lab's setup and is accepted by `jj vehicle tune --check`. Captures go to $JJ_CAPTURE_DIR when set.
//   node --test web/tests/journeys/fl03-feel-lab.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
  test(`?tune ${w}x${h}: sliders and A/B switch live mid-race for every vehicle; the patch validates`, { timeout: 300_000 }, async () => {
    const host = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    const errors = [];
    host.on('pageerror', (e) => errors.push(e.message));
    await host.addInitScript(() => { try { localStorage.removeItem('jj.feellab.slots.v1'); } catch { /* none */ } });
    await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9&tune&map=greybox-loop`);
    await race(host);
    await wait(host, () => !!window.__jjTune);
    await host.locator('.jj-tune-toggle').click();
    await host.locator('[data-tune-tab="lab"]').click();
    await host.locator('[data-lab-slider="turn"]').waitFor();
    assert.equal(await host.locator('[data-lab-preset]').count(), 0, 'no preset UI: the arcade controller is the only one');
    const lab = () => host.evaluate(() => window.__jjTune.lab.inspect());
    // Opening the tab captures every vehicle's shipped base (switching the sim vehicle by vehicle): wait for all of them
    // before this journey switches vehicles itself.
    await wait(host, () => { const i = window.__jjTune.lab.inspect(); return i.vehicles.length > 0 && Object.keys(i.bases).length === Math.max(1, i.vehicles.length); }, undefined, 20_000);
    const ids = (await lab()).vehicles;
    assert.ok(ids.length >= 2, `the roster has several vehicles (${ids})`);
    const home = await host.evaluate(() => document.querySelector('[data-tune-vehicle]').value);
    const idle = (host_) => wait(host_, () => !/Applying/.test(window.__jjTune.lab.inspect().status), undefined, 5000);

    /** The sim's value for a vehicle: the panel reads it back from the worker once that vehicle is selected. */
    const simValue = async (vehicle, path) => {
      await host.selectOption('[data-tune-vehicle]', vehicle);
      // The panel's rows are that vehicle's once the host has confirmed the switch (a tick boundary; slow on a loaded host).
      await wait(host, (v) => window.__jjTune.inspect().vehicle === v, vehicle, 10_000);
      return host.evaluate((p) => window.__jjTune.inspect().current[p], path);
    };
    const everyVehicle = async (path) => {
      const out = {};
      for (const id of ids) out[id] = await simValue(id, path);
      await host.selectOption('[data-tune-vehicle]', home);
      await wait(host, (v) => window.__jjTune.inspect().vehicle === v, home, 10_000);
      return out;
    };
    const moving = async (what) => {
      await host.waitForTimeout(1200);
      const v = await meanSpeed(host);
      assert.ok(v > 2, `the cars keep moving ${what} (${v.toFixed(1)} m/s)`);
    };
    /** Every vehicle's value is its shipped base times `factor` (a base of 0 stays 0). */
    const scaled = async (path, bases, factor, what) => {
      for (const [id, v] of Object.entries(await everyVehicle(path))) {
        assert.equal(typeof v, 'number', `${id}: ${path} is a number`);
        if (bases[id] === 0) assert.equal(v, 0, `${id}: ${what} (${path} stays 0)`);
        else assert.ok(Math.abs(v / bases[id] - factor) < 0.001, `${id}: ${what}: ${path} ${bases[id]} -> ${v} (${factor}x)`);
      }
    };
    /** Moves a slider and waits until the lab has applied it to every vehicle; returns how long that took. */
    const move = async (id, log2) => {
      const t0 = Date.now();
      await slide(host, id, log2);
      await wait(host, ([sid, want]) => { const i = window.__jjTune.lab.inspect(); return i.applied && Math.abs(i.applied.m[sid] - 2 ** want) < 1e-6 && !/Applying/.test(i.status); }, [id, log2], 5000);
      return Date.now() - t0;
    };
    const flip = async (button, turn) => {
      const t0 = Date.now();
      await host.locator(button).click();
      await wait(host, (w) => { const i = window.__jjTune.lab.inspect(); return i.applied && Math.abs(i.applied.m.turn - w) < 1e-6 && !/Applying/.test(i.status); }, turn, 5000);
      return Date.now() - t0;
    };

    const base = await everyVehicle('max_engine_force');
    const turnBase = await everyVehicle('arcade.turn_g');
    const yawBase = await everyVehicle('arcade.yaw_max_deg_s');
    const turnInBase = await everyVehicle('arcade.turn_in_s');
    const gripBase = await everyVehicle('arcade.grip_g');
    const slideGripBase = await everyVehicle('arcade.slide_grip');
    for (const [id, v] of Object.entries(turnBase)) assert.ok(typeof v === 'number' && v > 0, `${id} ships the arcade controller (turn_g ${v})`);
    for (const [id, v] of Object.entries(gripBase)) assert.ok(typeof v === 'number' && v > 0, `${id} ships the arcade controller (grip_g ${v})`);
    await moving('before the lab changes anything');

    // Turn-in ~1.5x (log2 0.6): turn_g and yaw_max_deg_s up, turn_in_s down, on every vehicle, live, within the per-vehicle
    // ceiling. The lab applies vehicle by vehicle (a TuneVehicle + SetTuning per car, each at a tick boundary), so a loaded
    // CI runner takes ~2 s; 4 s still reads live.
    const tm = 2 ** 0.6;
    let ms = await move('turn', 0.6);
    assert.ok(ms < 4000, `Turn-in reached every vehicle in ${ms} ms`);
    await scaled('arcade.turn_g', turnBase, tm, 'Turn-in slider');
    await scaled('arcade.yaw_max_deg_s', yawBase, tm, 'Turn-in slider');
    await scaled('arcade.turn_in_s', turnInBase, 1 / tm, 'Turn-in slider');
    await moving('with 1.5x turn-in');
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/lab-turn-${w}x${h}.png` });

    // Grip slidier (log2 -0.5): grip_g and the grip a slide keeps, on every vehicle.
    const gm = 2 ** -0.5;
    ms = await move('grip', -0.5);
    assert.ok(ms < 4000, `Grip reached every vehicle in ${ms} ms`);
    await scaled('arcade.grip_g', gripBase, gm, 'Grip slider');
    await scaled('arcade.slide_grip', slideGripBase, gm, 'Grip slider');
    await scaled('arcade.turn_g', turnBase, tm, 'Turn-in is untouched by the grip slider');
    await moving('with slidier grip');

    // Power ~1.5x (log2 0.6, a step of the slider): engine force on every vehicle.
    await slide(host, 'power', 0.6);
    await idle(host);
    const m = (await lab()).applied.m.power;
    assert.ok(Math.abs(m - 2 ** 0.6) < 0.001);
    await scaled('max_engine_force', base, m, 'Power slider');
    await moving('with 1.5x power');
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/lab-sliders-${w}x${h}.png` });

    // A = turn 1.5x, slidier grip, 1.5x power; B = every slider at 1x. Flip live.
    await host.locator('[data-lab-save="A"]').click();
    for (const id of ['turn', 'grip', 'power']) await slide(host, id, 0);
    await wait(host, () => { const i = window.__jjTune.lab.inspect(); return Object.values(i.applied.m).every((v) => v === 1) && !/Applying/.test(i.status); }, undefined, 5000);
    await host.locator('[data-lab-save="B"]').click();
    await scaled('arcade.turn_g', turnBase, 1, 'back to 1x');
    await scaled('arcade.grip_g', gripBase, 1, 'back to 1x');
    await scaled('max_engine_force', base, 1, 'back to 1x');
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/lab-ab-${w}x${h}.png` });
    const flips = [];
    for (const k of ['A', 'B', 'A']) {
      flips.push(await flip(`[data-lab-flip="${k}"]`, k === 'A' ? tm : 1));
      await moving(`after flipping to ${k}`);
    }
    assert.ok(Math.max(...flips) < 4000, `A/B flips applied in ${flips} ms`); // same per-vehicle ceiling as the sliders above
    await scaled('arcade.turn_g', turnBase, tm, 'slot A is live');
    await scaled('arcade.grip_g', gripBase, gm, 'slot A is live');
    await scaled('max_engine_force', base, tm, 'slot A power');
    const saved = await host.evaluate(() => JSON.parse(localStorage.getItem('jj.feellab.slots.v1')));
    assert.ok(Math.abs(saved.A.m.turn - tm) < 1e-6 && saved.B.m.turn === 1, 'the slots persist in this browser');
    if (CAPTURE) await host.screenshot({ path: `${CAPTURE}/lab-flipped-${w}x${h}.png` });

    // Export: the lab's setup is in the patch (selected vehicle and the others), and `jj vehicle tune --check` accepts it.
    const patch = (await host.evaluate(() => window.__jjTune.inspect())).patch;
    const has = (set, field) => set.some(([f]) => f === field);
    for (const field of ['arcade.turn_g', 'arcade.grip_g', 'max_engine_force']) assert.ok(has(patch.set, field), `${field} is in the patch: ${JSON.stringify(patch.set.map(([f]) => f))}`);
    assert.ok(patch.otherVehicles?.length === ids.length - 1 && patch.otherVehicles.every((o) => has(o.set, 'arcade.turn_g') && has(o.set, 'arcade.grip_g')), 'the other vehicles ride along');
    const dir = mkdtempSync(join(tmpdir(), 'fl03-'));
    let n = 0;
    for (const [profile, set] of [[patch.profile, patch.set], ...patch.otherVehicles.map((o) => [o.profile, o.set])]) {
      const file = join(dir, `patch-${n++}.json`);
      writeFileSync(file, JSON.stringify({ contract: 'jj.tuning-patch.v1', profile, set }));
      const out = execFileSync(JJ, ['vehicle', 'tune', file, '--check'], { cwd: repo, encoding: 'utf8' });
      assert.match(out, /arcade\.turn_g/, `the check names the turn-in change for ${profile}: ${out}`);
    }
    const [download] = await Promise.all([host.waitForEvent('download'), host.locator('[data-tune-export]').click()]);
    assert.match(download.suggestedFilename(), /^tuning-.*\.json$/);

    // Back to 1x on every slider leaves nothing of the lab in the patch.
    for (const id of ['turn', 'grip', 'power', 'air', 'launch', 'boost']) await slide(host, id, 0);
    await wait(host, () => { const i = window.__jjTune.lab.inspect(); return Object.values(i.applied.m).every((v) => v === 1) && !/Applying/.test(i.status); }, undefined, 8000);
    await host.waitForTimeout(400);
    const clean = (await host.evaluate(() => window.__jjTune.inspect())).patch;
    assert.deepEqual(clean.set, [], `everything back to the shipped car: ${JSON.stringify(clean.set)}`);
    assert.equal(clean.otherVehicles, undefined);
    assert.deepEqual(errors, []);
  });
}
