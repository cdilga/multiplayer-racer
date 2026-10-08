// P1-C05.2: steering wheels with pedals as host players, on the real web build in headless Chromium with an emulated
// Gamepad API (a simulated device, not a real wheel). The host runs live (`?test=live`), so the join path, the worker's
// clock and input ages are real.
// - An unknown wheel (non-standard mapping, pedals resting at +1) claims nothing and waits for mapping; the drawer's
//   "Map as a wheel" walks the calibration prompts, the profile is saved for that device, the wheel joins on its first
//   press and drives its car (steer, accelerator, brake), and after a reload it's recognised at once.
// - A wheel matching a shipped profile (Logitech G29 ids) maps at once, marked unconfirmed until "Looks right".
// - The receipt row per wheel: host-applied input age and the encoded bytes per sample. The live run's wheel trace is
//   recorded and written as a scenario fixture (R90): `jj sim` replays it through jj-input and the sim.
// Writes docs/evidence/P1-C05.2/ (JJ_EVIDENCE_DIR overrides): receipt.json, wheel-trace.json, wheel-trace.fixture.json.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-C05.2');
let browser;
let server;
const receipt = [];

/** A fake Gamepad API with wheel-shaped devices (non-standard mapping, any number of axes). */
const fakeWheels = () => {
  const pads = [null, null, null, null];
  Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true });
  const fire = (type, pad) => {
    const e = new Event(type);
    Object.defineProperty(e, 'gamepad', { value: pad });
    window.dispatchEvent(e);
  };
  window.__wheels = {
    connect(i, id, axes) {
      const pad = { index: i, id, connected: true, mapping: '', timestamp: 0, axes: [...axes],
        buttons: Array.from({ length: 24 }, () => ({ pressed: false, touched: false, value: 0 })) };
      pads[i] = pad;
      fire('gamepadconnected', pad);
    },
    axis(i, n, v) {
      pads[i].axes[n] = v;
    },
    press(i, down) {
      pads[i].buttons.forEach((b, n) => Object.assign(b, { pressed: down.includes(n), value: down.includes(n) ? 1 : 0 }));
    },
  };
};

before(async () => {
  browser = await chromium.launch();
  server = await serve(join(repo, 'web/dist'), 'preview');
});

after(async () => {
  await browser?.close();
  server?.close();
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    join(evidenceDir, 'receipt.json'),
    `${JSON.stringify({ format: 'jj.input-receipt.v1', what: 'Host wheels (P1-C05.2): emulated Gamepad API devices on the real join path; ages are main thread to tick boundary, bytes are the encoded LocalSource message per sample', browser: `Chromium ${browser?.version?.() ?? ''} (Playwright headless)`, rows: receipt }, null, 2)}\n`,
  );
});

const view = (page, source) => page.evaluate((s) => window.__jjTest.localSources().find((x) => x.source === s), source);
const carOf = (state, endpoint) => {
  const seat = state.host.seats.find((s) => s.endpoint === endpoint);
  return seat && state.cars.find((c) => c.car === seat.car);
};
const turnDeg = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
async function row(page, source) {
  const stats = await page.evaluate(() => window.__jjTest.inputStats());
  const st = stats.find((x) => x.source === source);
  const v = await view(page, source);
  return {
    path: 'host-local',
    source,
    kind: v.kind,
    label: v.label,
    profile: v.wheel?.profile,
    profileVerified: v.wheel?.verified,
    samples: st.samples,
    hostAppliedInputAgeMs: { p50: +st.p50.toFixed(2), p95: +st.p95.toFixed(2), p99: +st.p99.toFixed(2) },
    bytesPerSample: +st.bytesPerSample.toFixed(2),
    device: 'emulated Gamepad API (no hardware)',
  };
}

test('an unknown wheel waits for mapping, is calibrated in the drawer, joins on its first press, drives, and is remembered', { timeout: 150_000 }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(fakeWheels);
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  assert.equal(await openHost(page, `${server.url}/host/?test=live`), 'test');
  const observe = () => page.evaluate(() => window.__jjTest.observe());
  // Steering on axis 0; brake on 1, accelerator on 2, clutch on 3, all resting at +1 (released).
  const ID = 'Fancy Wheel Pro (Vendor: 1234 Product: abcd)';
  await page.evaluate((id) => window.__wheels.connect(0, id, [0, 1, 1, 1, 0]), ID);
  await page.waitForTimeout(500);
  let v = await view(page, 100);
  assert.equal(v.needsMapping, true, 'an unmapped wheel waits');
  assert.equal((await observe()).host.seats.length, 0, 'its resting pedals claim no seat');

  // The drawer's "Map as a wheel", then each prompt in turn.
  await page.click('[data-jj-input-drawer] button[data-act="calibrate"][data-source="100"]');
  const until = async (step) => {
    for (let i = 0; i < 40; i++) {
      v = await view(page, 100);
      if ((v.calibrating?.step ?? 'done') === step) return;
      await page.waitForTimeout(50);
    }
    assert.fail(`calibration reached ${step}: at ${v.calibrating?.step}`);
  };
  const wheel = (n, val) => page.evaluate(([n, val]) => window.__wheels.axis(0, n, val), [n, val]);
  const press = (down) => page.evaluate((d) => window.__wheels.press(0, d), down);
  await until('left');
  await wheel(0, -1);
  await until('right');
  await wheel(0, 0);
  await page.waitForTimeout(100);
  await wheel(0, 1);
  await until('throttle');
  await wheel(0, 0);
  await wheel(2, -1);
  await until('brake');
  await wheel(2, 1);
  await wheel(1, -1);
  await until('boost');
  await wheel(1, 1);
  await press([5]);
  await until('drift');
  await press([]);
  await page.waitForTimeout(60);
  await press([4]);
  await until('oi');
  await press([]);
  await page.click('[data-jj-input-drawer] button[data-act="skip"][data-source="100"]').catch(() => {});
  await until('cone');
  await page.click('[data-jj-input-drawer] button[data-act="skip"][data-source="100"]').catch(() => {});
  await until('identify');
  await press([8]);
  await until('ready');
  await press([]);
  await page.waitForTimeout(60);
  await press([9]);
  await until('done');
  await press([]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jj.wheelProfiles.v1') ?? '{}'));
  const p = saved[ID];
  assert.ok(p, 'the profile is saved for this device');
  assert.deepEqual([p.steer.axis, p.throttle.axis, p.brake.axis], [0, 2, 1]);
  assert.deepEqual([p.throttle.rest, p.throttle.full, p.brake.rest, p.brake.full], [1, -1, 1, -1]);
  assert.deepEqual(p.buttons, { boost: 5, drift: 4, identify: 8, ready: 9 });
  await page.waitForTimeout(300);
  v = await view(page, 100);
  assert.equal(v.kind, 'wheel');
  assert.equal((await observe()).host.seats.length, 0, 'mapped, still no seat until pressed');

  // First press: the accelerator 80% and steering a third right. Record the wheel as the host maps it.
  const trace = [];
  const t0 = Date.now();
  const sampleTrace = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const w = (await view(page, 100)).wheel;
      trace.push({ ms: Date.now() - t0, steer: +w.steer.toFixed(4), throttle: +w.throttle.toFixed(4), brake: +w.brake.toFixed(4) });
      await page.waitForTimeout(50);
    }
  };
  await wheel(2, -0.6);
  await wheel(0, 0.33);
  await page.waitForTimeout(150);
  const start = await observe();
  const h0 = carOf(start, 'local:100')?.headingDeg;
  await sampleTrace(2500);
  const driven = await observe();
  const car = carOf(driven, 'local:100');
  console.log(JSON.stringify({ forwardSpeed: car.forwardSpeed, turnDeg: turnDeg(car.headingDeg, h0) }));
  assert.ok(car.forwardSpeed > 4, `the accelerator drives: ${car.forwardSpeed.toFixed(1)} m/s`);
  assert.ok(turnDeg(car.headingDeg, h0) > 10, `the wheel steers: ${turnDeg(car.headingDeg, h0).toFixed(1)}°`);
  // Off the accelerator, on the brake: it slows.
  await wheel(2, 1);
  await wheel(0, 0);
  await wheel(1, -1);
  await sampleTrace(1200);
  const braked = carOf(await observe(), 'local:100');
  assert.ok(braked.forwardSpeed < car.forwardSpeed - 3, `the brake slows it: ${braked.forwardSpeed.toFixed(1)} m/s`);
  await wheel(1, 1);
  receipt.push({ ...(await row(page, 100)), case: 'calibrated wheel' });

  // Reload: the saved profile maps it at once.
  const page2 = await ctx.newPage();
  await page2.addInitScript(fakeWheels);
  assert.equal(await openHost(page2, `${server.url}/host/?test=live`), 'test');
  await page2.evaluate((id) => window.__wheels.connect(0, id, [0, 1, 1, 1, 0]), ID);
  await page2.waitForTimeout(400);
  const again = await view(page2, 100);
  assert.equal(again.kind, 'wheel', 'recognised after a reload');
  assert.equal(again.wheel.verified, true);
  await ctx.close();

  // The recorded trace as a scenario fixture (R90): the same sticks through jj-input and the sim.
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, 'wheel-trace.json'), `${JSON.stringify({ format: 'jj.wheel-trace.v1', what: 'The calibrated wheel as the host mapped it, sampled every 50 ms from its first press: steering −1..1, accelerator and brake 0..1', samples: trace }, null, 2)}\n`);
  const fx = traceFixture(trace);
  const fxPath = join(evidenceDir, 'wheel-trace.fixture.json');
  await writeFile(fxPath, `${JSON.stringify(fx, null, 1)}\n`);
  if (process.env.JJ_BIN) {
    const out = JSON.parse(execFileSync(process.env.JJ_BIN, ['sim', '--json', fxPath], { cwd: repo }).toString());
    assert.equal(out[0].ok, true, `the recorded trace replays in the sim: ${JSON.stringify(out[0].checks)}`);
  }
});

test('a wheel with a shipped profile maps at once, unconfirmed until "Looks right"', { timeout: 90_000 }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(fakeWheels);
  assert.equal(await openHost(page, `${server.url}/host/?test=live`), 'test');
  const ID = 'Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)';
  // The profile's layout: steering X (0), accelerator Y (1), brake Rz (5), clutch Z (2); pedals rest at +1.
  await page.evaluate((id) => window.__wheels.connect(1, id, [0, 1, 1, 0, 0, 1]), ID);
  await page.waitForTimeout(400);
  let v = await view(page, 101);
  assert.equal(v.kind, 'wheel');
  assert.equal(v.wheel.profile, 'Logitech G29 / G920');
  assert.equal(v.wheel.verified, false, 'a shipped guess until confirmed');
  await page.evaluate(() => window.__wheels.axis(1, 1, -1));
  await page.waitForTimeout(2000);
  const car = carOf(await page.evaluate(() => window.__jjTest.observe()), 'local:101');
  assert.ok(car && car.forwardSpeed > 4, `its accelerator drives: ${car?.forwardSpeed}`);
  await page.click('[data-jj-input-drawer] button[data-act="confirm"][data-source="101"]');
  await page.waitForTimeout(200);
  v = await view(page, 101);
  assert.equal(v.wheel.verified, true, 'confirmed and saved for this device');
  receipt.push({ ...(await row(page, 101)), case: 'shipped profile' });
  await ctx.close();
});

/** The recorded wheel (50 ms samples) as fixture stick spans (R116): the right stick's x = steering, the left stick's y = accelerator − brake. */
function traceFixture(trace) {
  const tick = (ms) => Math.round((ms * 120) / 1000);
  const t0 = trace[0].ms;
  const inputs = trace.map((s, i) => {
    const from = tick(s.ms - t0);
    const next = trace[i + 1];
    return { car: 0, fromTick: from, ...(next ? { toTick: tick(next.ms - t0) } : {}), stick: [0, +(s.throttle - s.brake).toFixed(4)], action: [s.steer, 0] };
  }).filter((s) => s.toTick === undefined || s.toTick > s.fromTick);
  const ticks = tick(trace.at(-1).ms - t0) + 1;
  const peak = trace.reduce((m, s, i) => (s.brake > 0.5 && m < 0 ? i : m), -1);
  return {
    scenario: 'wheel-trace',
    what: 'P1-C05.2 (R90): a wheel run recorded live in the host (an emulated wheel calibrated in the drawer) and replayed as fixture sticks through jj-input and the sim (R116: the wheel steers on the right stick's x, the pedals are the left stick's y): the car accelerates, turns with the wheel, then slows on the brake.',
    map: 'maps/greybox-loop.json',
    seed: 83,
    ticks,
    cars: [{ routePoint: 88, lateral: 0 }],
    inputs,
    expect: [
      { car: 0, atTick: tick(trace[Math.max(0, peak - 1)].ms - t0), metric: 'headingChangeDeg', min: 10, max: 180 },
      { car: 0, metric: 'maxSpeed', min: 4, max: 40 },
      { car: 0, metric: 'wrecks', min: 0, max: 0 },
    ],
  };
}
