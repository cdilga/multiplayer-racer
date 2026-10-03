// P1-C05: host pads and key clusters, on the real web build in headless Chromium with an emulated Gamepad API and real
// key events. The host runs live (`?test=live`) so the worker's clock, the dropout rule and input ages are real.
// Writes docs/evidence/P1-C05/receipt.json and seats.json (JJ_EVIDENCE_DIR overrides the folder).
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
    buttons(i, down) {
      pads[i].buttons.forEach((b, n) => Object.assign(b, { pressed: down.includes(n), value: down.includes(n) ? 1 : 0 }));
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
  // One source at a time, each waiting for its seat, so the grid order (and so who drives next to whom) doesn't depend
  // on whether the host sampled them in one frame or several (it does under load).
  const seated = async (n) => {
    for (const t0 = Date.now(); (await observe()).host.seats.length < n; await page.waitForTimeout(50)) {
      assert.ok(Date.now() - t0 < 10_000, `seat ${n} never claimed`);
    }
  };
  await page.evaluate(() => window.__pads.axes(0, [0, -1, 0, 0]));
  await seated(1);
  await page.evaluate(() => window.__pads.axes(1, [0.8, -0.7, 0, 0]));
  await seated(2);
  await page.keyboard.down('KeyW');
  await seated(3);
  await page.keyboard.down('KeyK');
  await page.keyboard.down('KeyJ');
  await seated(4);
  const start = await observe();
  const carOf = (state, endpoint) => {
    const seat = state.host.seats.find((s) => s.endpoint === endpoint);
    return seat && state.cars.find((c) => c.car === seat.car);
  };
  const heading0 = Object.fromEntries(['local:100', 'local:101', 'local:1', 'local:2'].map((e) => [e, carOf(start, e)?.headingDeg]));
  // 2.5 s of driving in sim time (300 ticks at 120 Hz): the live sim's wall clock slows when the machine is busy (the
  // host page renders too, and CI runs the browser tests in parallel), so wall time isn't the measure.
  let driven = await observe();
  for (const t0 = Date.now(); driven.tick - start.tick < 300; driven = await observe()) {
    assert.ok(Date.now() - t0 < 30_000, `the sim reached tick ${driven.tick}, not ${start.tick + 300}`);
    await page.waitForTimeout(100);
  }
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

  // Enough samples per source to measure input age before pad 1 is unplugged: the host samples on main-thread timers,
  // which run slower while the page renders on a software rasteriser (headless CI), so hold until there are.
  for (const t0 = Date.now(); ; await page.waitForTimeout(250)) {
    const counts = await page.evaluate(() => window.__jjTest.inputStats());
    if (counts.length === 4 && counts.every((s) => s.samples > 50)) break;
    assert.ok(Date.now() - t0 < 20_000, `samples: ${counts.map((s) => `${s.source}:${s.samples}`)}`);
  }

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

test('Identify flashes that seat only; a pad leaves with the hold chord and joins again as a new seat; keys sit out from the drawer', { timeout: 120_000 }, async () => {
  const page = await browser.newPage();
  await page.addInitScript(fakePads);
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  assert.equal(await openHost(page, `${server.url}/host/?test=live`), 'test');
  const observe = () => page.evaluate(() => window.__jjTest.observe());
  const identified = async () =>
    (await page.evaluate(() => window.__jjTest.lines()))
      .map((l) => /^event Identify \{ seat: SeatId\((\d+)\) \}$/.exec(l)?.[1])
      .filter(Boolean)
      .map(Number);
  const seat = (state, endpoint) => state.host.seats.find((s) => s.endpoint === endpoint);
  const until = async (what, ok, ms = 5000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await observe();
      if (ok(s)) return s;
      assert.ok(Date.now() - t0 < ms, what);
      await page.waitForTimeout(50);
    }
  };

  // Two pads and both key clusters join, then let go.
  await page.evaluate(() => {
    window.__pads.connect(0);
    window.__pads.connect(1);
    window.__pads.axes(0, [0, -1, 0, 0]);
    window.__pads.axes(1, [0, -1, 0, 0]);
  });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyI');
  const joined = await until('four seats', (s) => s.host.seats.length === 4);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyI');
  await page.evaluate(() => [0, 1].forEach((i) => window.__pads.axes(i, [0, 0, 0, 0])));
  const id = Object.fromEntries(['local:100', 'local:101', 'local:1', 'local:2'].map((e) => [e, seat(joined, e).seat]));

  // The drawer's legend shows each cluster's keys, Identify and READY included.
  const legend = await page.evaluate(() => document.querySelector('[data-jj-input-drawer]').textContent);
  for (const part of ['Keys A: drive WASD, action TFGH, Identify Q, READY E', 'Keys B: drive IJKL, action UpLeftDownRight, Identify U, READY O'])
    assert.ok(legend.includes(part), `legend has "${part}": ${legend}`);

  // Joining flashes each seat once; past the seat reducer's 3 s limit, Identify flashes that seat only.
  await page.waitForTimeout(3300);
  const before = await identified();
  assert.deepEqual([...before].sort(), Object.values(id).sort(), 'one join flash per seat');
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(150);
  await page.keyboard.up('KeyQ');
  await page.evaluate(() => window.__pads.buttons(1, [8]));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__pads.buttons(1, []));
  await page.waitForTimeout(300);
  const flashes = (await identified()).slice(before.length);
  assert.deepEqual(flashes, [id['local:1'], id['local:101']], 'keys A\'s Identify key, then pad 2\'s View');

  // Pad 2 holds View + Start for 2 s: its seat leaves, still listed with its number.
  const numberOf = (s, e) => seat(s, e).number;
  const n101 = numberOf(joined, 'local:101');
  const heldAt = Date.now();
  await page.evaluate(() => window.__pads.buttons(1, [8, 9]));
  const left = await until('pad 2 left', (s) => seat(s, 'local:101').presence === 'Left');
  const leftAfterMs = Date.now() - heldAt;
  assert.ok(leftAfterMs >= 1900, `the hold chord takes 2 s: ${leftAfterMs} ms`);
  assert.equal(left.host.seats.length, 4, 'the seat stays');
  assert.equal(numberOf(left, 'local:101'), n101, 'with its number');
  for (const e of ['local:100', 'local:1', 'local:2']) assert.equal(seat(left, e).presence, 'Active', `${e} unaffected`);
  // Still holding: nothing joins. Let go, then press: the same pad is a new player.
  await page.waitForTimeout(300);
  assert.equal((await observe()).host.seats.length, 4, 'no seat while still holding');
  await page.evaluate(() => window.__pads.buttons(1, []));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__pads.axes(1, [0, -1, 0, 0]));
  const rejoined = await until('a new seat for pad 2', (s) => seat(s, 'local:101#2')?.presence === 'Active');
  assert.equal(rejoined.host.seats.length, 5);
  assert.notEqual(seat(rejoined, 'local:101#2').seat, id['local:101'], 'a new seat');
  assert.equal(seat(rejoined, 'local:101').presence, 'Left', 'the old seat keeps its place');
  await page.evaluate(() => window.__pads.axes(1, [0, 0, 0, 0]));

  // Keys B sits out from the input drawer, then returns.
  const button = (act) => page.locator(`[data-jj-input-drawer] li[data-source="2"] button[data-act="${act}"]`);
  await button('sit-out').click();
  const sat = await until('keys B sitting out', (s) => seat(s, 'local:2').presence === 'SittingOut');
  for (const e of ['local:100', 'local:1', 'local:101#2']) assert.equal(seat(sat, e).presence, 'Active', `${e} unaffected`);
  assert.equal(await button('sit-out').textContent(), 'Return');
  await button('sit-out').click();
  await until('keys B back', (s) => seat(s, 'local:2').presence === 'Active');
  const final = await observe();
  await page.close();

  await mkdir(evidenceDir, { recursive: true });
  const record = {
    format: 'jj.local-seats.v1',
    what: 'P1-C05: Identify per seat (event seat ids), pad 2 leaving with the View+Start hold and joining again, keys B sitting out from the input drawer',
    browser: `Chromium ${browser.version()} (Playwright headless), ${process.platform}/${process.arch}`,
    joinFlashes: before,
    identifyFlashes: flashes,
    leftAfterMs,
    seats: final.host.seats.map(({ seat, number, endpoint, presence }) => ({ seat, number, endpoint, presence })),
  };
  await writeFile(join(evidenceDir, 'seats.json'), `${JSON.stringify(record, null, 2)}\n`);
});
