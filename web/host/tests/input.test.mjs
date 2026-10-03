// P1-C05: host pads and key clusters, on the real web build in headless Chromium with an emulated Gamepad API and real
// key events. The host runs live (`?test=live`) so the worker's clock, the dropout rule and input ages are real.
// Writes docs/evidence/P1-C05/receipt.json (JJ_EVIDENCE_DIR overrides the folder).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-C05');
let browser;
let server;

/** A fake standard-mapping Gamepad API the page's `navigator.getGamepads()` reads. */
const fakePads = () => {
  const pads = [null, null, null, null];
  Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true });
  const fire = (type, pad) => {
    const e = new Event(type);
    Object.defineProperty(e, 'gamepad', { value: pad });
    window.dispatchEvent(e);
  };
  window.__pads = {
    connect(i) {
      const pad = { index: i, id: `Fake pad ${i}`, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      pads[i] = pad;
      fire('gamepadconnected', pad);
    },
    axes(i, axes) {
      pads[i].axes = axes;
    },
    unplug(i) {
      const pad = pads[i];
      pads[i] = null;
      pad.connected = false;
      fire('gamepaddisconnected', pad);
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
});

test('two pads and two key clusters claim four seats, each drives its own car; an unplugged pad goes to the autopilot', { timeout: 120_000 }, async () => {
  const page = await browser.newPage();
  await page.addInitScript(fakePads);
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  assert.equal(await openHost(page, `${server.url}/host/?test=live`), 'test');
  const observe = () => page.evaluate(() => window.__jjTest.observe());

  // Plugged in and untouched: nothing claims a seat.
  await page.evaluate(() => {
    window.__pads.connect(0);
    window.__pads.connect(1);
  });
  await page.waitForTimeout(500);
  assert.equal((await observe()).host.seats.length, 0, 'no phantom seats');

  // Pad 1 straight on, pad 2 throttle and right, keys A throttle (W), keys B brake/reverse and left (K, J).
  await page.evaluate(() => {
    window.__pads.axes(0, [0, -1, 0, 0]);
    window.__pads.axes(1, [0.8, -0.7, 0, 0]);
  });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyK');
  await page.keyboard.down('KeyJ');
  await page.waitForTimeout(300);
  const start = await observe();
  const carOf = (state, endpoint) => {
    const seat = state.host.seats.find((s) => s.endpoint === endpoint);
    return seat && state.cars.find((c) => c.car === seat.car);
  };
  const heading0 = Object.fromEntries(['local:100', 'local:101', 'local:1', 'local:2'].map((e) => [e, carOf(start, e)?.headingDeg]));
  await page.waitForTimeout(2500);
  const driven = await observe();
  assert.equal(driven.host.seats.length, 4, `four seats: ${driven.host.seats.map((s) => s.endpoint)}`);
  const turn = (e) => {
    const d = Math.abs(carOf(driven, e).headingDeg - heading0[e]) % 360;
    return Math.min(d, 360 - d);
  };
  const result = Object.fromEntries(
    ['local:100', 'local:101', 'local:1', 'local:2'].map((e) => [e, { forwardSpeed: carOf(driven, e).forwardSpeed, turnDeg: turn(e) }]),
  );
  console.log(JSON.stringify(result));
  assert.ok(result['local:100'].forwardSpeed > 4 && result['local:100'].turnDeg < 10, 'pad 1 drives straight on');
  assert.ok(result['local:101'].forwardSpeed > 2 && result['local:101'].turnDeg > 15, 'pad 2 turns');
  assert.ok(result['local:1'].forwardSpeed > 4 && result['local:1'].turnDeg < 10, 'keys A drive straight on');
  assert.ok(result['local:2'].forwardSpeed < -0.5, 'keys B reverse');
  const drawer = await page.evaluate(() => [...document.querySelectorAll('[data-jj-input-drawer] li[data-source]')].map((li) => `${li.dataset.source}:${li.dataset.state}`));
  assert.deepEqual(drawer.sort(), ['1:playing', '2:playing', '100:playing', '101:playing'].sort());

  // Unplug pad 1: neutral at once, its car (and only its car) to the autopilot within the dropout time.
  const unpluggedAt = Date.now();
  await page.evaluate(() => window.__pads.unplug(0));
  let autopilotMs = null;
  for (;;) {
    const s = await observe();
    if (carOf(s, 'local:100').autopilot) {
      autopilotMs = Date.now() - unpluggedAt;
      const others = ['local:101', 'local:1', 'local:2'].map((e) => carOf(s, e).autopilot);
      assert.deepEqual(others, [null, null, null], 'only its seat');
      break;
    }
    assert.ok(Date.now() - unpluggedAt < 5000, 'the unplugged pad went to the autopilot');
    await page.waitForTimeout(100);
  }
  assert.ok(autopilotMs >= 1800 && autopilotMs < 3500, `after the 2 s dropout: ${autopilotMs} ms`);

  // The receipt (N08's row for local sources): host-applied input age per source.
  const stats = await page.evaluate(() => window.__jjTest.inputStats());
  const sources = await page.evaluate(() => window.__jjTest.localSources());
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyK');
  await page.keyboard.up('KeyJ');
  await page.close();
  const rows = sources
    .filter((s) => s.claimed)
    .map((s) => {
      const st = stats.find((x) => x.source === s.source);
      return {
        path: 'host-local',
        source: s.source,
        kind: s.kind,
        label: s.label,
        samples: st?.samples ?? 0,
        hostAppliedInputAgeMs: st && { p50: +st.p50.toFixed(2), p95: +st.p95.toFixed(2), p99: +st.p99.toFixed(2) },
        unplugged: !s.connected,
        autopilotAfterMs: s.source === 100 ? autopilotMs : null,
      };
    });
  assert.equal(rows.length, 4);
  for (const r of rows) assert.ok(r.samples > 50 && r.hostAppliedInputAgeMs.p99 < 100, JSON.stringify(r));
  await mkdir(evidenceDir, { recursive: true });
  const receipt = {
    format: 'jj.input-receipt.v1',
    what: 'P1-C05: host pads and key clusters, host-applied input age (sampled on the main thread to applied at a sim tick boundary in the worker, ms, on performance.timeOrigin-based clocks), and the unplugged pad\'s dropout to autopilot',
    browser: `Chromium ${browser.version()} (Playwright headless), ${process.platform}/${process.arch}`,
    drive: result,
    rows,
  };
  await writeFile(join(evidenceDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
});
