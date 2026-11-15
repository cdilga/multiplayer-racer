// Artifacts default to OS scratch; set JJ_EVIDENCE_DIR / JJ_EVIDENCE / JJ_CAPTURE_DIR explicitly to recapture a committed receipt.
import { evidencePath } from '../../tests/lib/evidence.mjs';
// P1-C05: host pads and key clusters, on the real web build in headless Chromium with an emulated Gamepad API and real
// key events. The host runs live (`?test=live`) so the worker's clock, the dropout rule and input ages are real.
// Explicit evidence can go to docs/evidence/P1-C05/receipt.json and seats.json (set JJ_EVIDENCE_DIR explicitly; default OS scratch).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { slotArgs } from '../../tests/journeys/lib/chromium.mjs';
import { openHost, serve, serveReal } from './lib/surface.mjs';
import clusterData from '../src/input/clusters.json' with { type: 'json' };

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = evidencePath('P1-C05');
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
  browser = await chromium.launch({ args: slotArgs });
  server = await serve(join(repo, 'web/dist'), 'preview');
});

after(async () => {
  await browser?.close();
  server?.close();
});

// Council review 2026-11-15: "press any button to join" (A did nothing; only the sticks, View and Start claimed), and
// typing a track code into the host's own field claimed, confirmed and readied phantom key-cluster seats.
test('any pad button claims a seat; typing in a host text field claims nothing', { timeout: 120_000 }, async () => {
  const page = await browser.newPage();
  await page.addInitScript(fakePads);
  assert.equal(await openHost(page, `${server.url}/host/?test=live`), 'test');
  const seats = async () => (await page.evaluate(() => window.__jjTest.observe())).host.seats.length;
  // A text field focused and typed into: cluster letters (W, E, T…) are typing, not players.
  await page.evaluate(() => {
    const f = document.createElement('input');
    f.id = 'typing-probe';
    document.body.append(f);
    f.focus();
  });
  await page.keyboard.type('WEST', { delay: 30 });
  await page.waitForTimeout(400);
  assert.equal(await seats(), 0, 'typing claims no seat');
  assert.equal(await page.inputValue('#typing-probe'), 'WEST', 'and the letters reach the field');
  await page.evaluate(() => document.getElementById('typing-probe').remove());
  // A pad plugged in and untouched claims nothing; its A button (0) claims a seat.
  await page.evaluate(() => window.__pads.connect(0));
  await page.waitForTimeout(400);
  assert.equal(await seats(), 0, 'plugged in alone: no seat');
  await page.evaluate(() => window.__pads.buttons(0, [0]));
  for (const t0 = Date.now(); (await seats()) < 1; await page.waitForTimeout(50)) {
    assert.ok(Date.now() - t0 < 10_000, 'A never claimed a seat');
  }
  await page.evaluate(() => window.__pads.buttons(0, []));
  // The Controllers row says who that pad is in the room: its seat's badge leads the row.
  const seat = (await page.evaluate(() => window.__jjTest.observe())).host.seats.find((x) => x.endpoint?.startsWith('local:'));
  for (const t0 = Date.now(); ; await page.waitForTimeout(100)) {
    const badge = await page.evaluate(() => document.querySelector('[data-jj-input-drawer] li[data-kind=pad] .dr-seat')?.textContent ?? null);
    if (badge !== null) {
      assert.equal(badge, `#${seat?.seat ?? 1}`.replace(/#undefined/, '#1'), 'the pad row leads with its seat');
      break;
    }
    assert.ok(Date.now() - t0 < 5_000, 'the pad row never showed its seat');
  }
  await page.close();
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

  // Pad 1 straight on (left stick up), pad 2 throttle (left stick) and right (right stick steers, R116), keys A throttle (W), keys B brake/reverse and left (K, J).
  // One source at a time, each waiting for its seat, so the grid order (and so who drives next to whom) doesn't depend
  // on whether the host sampled them in one frame or several (it does under load).
  const seated = async (n) => {
    for (const t0 = Date.now(); (await observe()).host.seats.length < n; await page.waitForTimeout(50)) {
      assert.ok(Date.now() - t0 < 10_000, `seat ${n} never claimed`);
    }
  };
  await page.evaluate(() => window.__pads.axes(0, [0, -1, 0, 0]));
  await seated(1);
  await page.evaluate(() => window.__pads.axes(0, [0, 0, 0, 0]));
  await page.evaluate(() => window.__pads.axes(1, [0, -0.7, 0.8, 0]));
  await seated(2);
  await page.evaluate(() => window.__pads.axes(1, [0, 0, 0, 0]));
  await page.keyboard.down('KeyW');
  await seated(3);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyK');
  await page.keyboard.down('KeyJ');
  await seated(4);
  await page.keyboard.up('KeyK');
  await page.keyboard.up('KeyJ');
  // The grid puts a turning pad beside Keys A: their bodies can collide during this input-routing probe.
  // Stage them on separate stretches of the actual straight, with reverse pointed away from the others. The turning pad
  // goes at the back: its circle (about 20 m across at fun-pass speed) can't reach a car that's driving away from it.
  const claimed = await observe();
  // The straight ends in a corner near x = 185: the two that drive straight on start side by side at x = 40, far enough
  // back that a busy CI machine's longer window (the sim can run well past 300 ticks before the next poll) still ends
  // before the corner at fun-pass speed.
  for (const [endpoint, x, z] of [['local:100', 40, -3], ['local:101', -40, 0], ['local:1', 40, 3], ['local:2', 0, 0]]) {
    const car = claimed.host.seats.find((s) => s.endpoint === endpoint).car;
    await page.evaluate(({ car, x, z }) => window.__jjTest.command({ cmd: 'place', car, pose: { x, y: 0.0073, z, headingDeg: 90 } }), { car, x, z });
  }
  // An exact window: hold the sim, read the start, press, then step 300 ticks (2.5 s) in small steps with frames between
  // them so the pads and keys are sampled as they are live. Polling a live sim overshot by a second or more on a busy
  // CI machine, and fun-pass cars then reached the corner at the end of this straight.
  await page.evaluate(() => window.__jjTest.hold(true));
  const start = await observe();
  await page.evaluate(() => {
    window.__pads.axes(0, [0, -1, 0, 0]);
    window.__pads.axes(1, [0, -0.7, 0.8, 0]);
  });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyK');
  await page.keyboard.down('KeyJ');
  const carOf = (state, endpoint) => {
    const seat = state.host.seats.find((s) => s.endpoint === endpoint);
    return seat && state.cars.find((c) => c.car === seat.car);
  };
  const heading0 = Object.fromEntries(['local:100', 'local:101', 'local:1', 'local:2'].map((e) => [e, carOf(start, e)?.headingDeg]));
  await page.waitForTimeout(200);
  let stepped = null;
  for (let i = 0; i < 30; i++) {
    stepped = await page.evaluate(() => window.__jjTest.step(10));
    await page.waitForTimeout(16);
  }
  const driven = await observe();
  assert.equal(driven.tick, stepped.tick, 'observed where the steps ended');
  await page.evaluate(() => window.__jjTest.hold(false));
  assert.equal(driven.host.seats.length, 4, `four seats: ${driven.host.seats.map((s) => s.endpoint)}`);
  const turn = (e) => {
    const d = Math.abs(carOf(driven, e).headingDeg - heading0[e]) % 360;
    return Math.min(d, 360 - d);
  };
  const result = Object.fromEntries(
    ['local:100', 'local:101', 'local:1', 'local:2'].map((e) => [e, { forwardSpeed: carOf(driven, e).forwardSpeed, turnDeg: turn(e) }]),
  );
  console.log(JSON.stringify(result));
  if (process.env.JJ_C05_DIAGNOSTICS) console.log('C05 physical trace:', JSON.stringify({ start: start.cars, driven: driven.cars, events: await page.evaluate(() => window.__jjTest.lines()) }));
  assert.ok(result['local:100'].forwardSpeed > 4 && result['local:100'].turnDeg < 10, 'pad 1 drives straight on');
  assert.ok(result['local:101'].forwardSpeed > 2 && result['local:101'].turnDeg > 15, 'pad 2 turns');
  assert.ok(result['local:1'].forwardSpeed > 4 && result['local:1'].turnDeg < 10, 'keys A drive straight on');
  assert.ok(result['local:2'].forwardSpeed < -0.5, 'keys B reverse');
  const drawer = await page.evaluate(() => [...document.querySelectorAll('[data-jj-input-drawer] li[data-source]')].map((li) => `${li.dataset.source}:${li.dataset.state}`));
  assert.deepEqual(drawer.sort(), [...clusterData.clusters.map((c) => `${c.id}:${[1, 2].includes(c.id) ? 'playing' : 'press to join'}`), '100:playing', '101:playing'].sort());

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
  // 100 ms p99 holds for a host drawing on a GPU; on a loaded software-WebGL runner the main thread's frames delay the
  // hand-off and one source's tail reached 162 ms (CI run 5544), so there the bound is loose (as R06's identify bound).
  const p99Limit = ['1', 'native'].includes(process.env.JJ_CHROMIUM_GPU ?? '') ? 100 : 400;
  for (const r of rows) assert.ok(r.samples > 50 && r.hostAppliedInputAgeMs.p99 < p99Limit, `${JSON.stringify(r)} (p99 < ${p99Limit} ms)`);
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

  // The drawer's legend is each cluster's controls card (P1-C14): every key of the cluster, Identify and READY included.
  const cardKeys = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-jj-input-drawer] [data-card^="keys-"]')].map((c) => [c.dataset.card, [...c.querySelectorAll('kbd')].map((k) => k.dataset.code)])));
  for (const [n, codes] of [['keys-1', ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyT', 'KeyG', 'KeyQ', 'KeyE']], ['keys-2', ['KeyI', 'KeyJ', 'KeyK', 'KeyL', 'ArrowUp', 'ArrowDown', 'KeyU', 'KeyO']]])
    for (const code of codes) assert.ok(cardKeys[n]?.includes(code), `${n} card has ${code}: ${JSON.stringify(cardKeys)}`);

  // Joining flashes each seat once; past the seat reducer's 3 s limit, Identify flashes that seat only.
  await page.waitForTimeout(3300);
  const before = await identified();
  assert.deepEqual([...before].sort(), Object.values(id).sort(), 'one join flash per seat');
  // Keys and pads are sampled once per host frame, and a software-rendered CI host takes up to ~1 s a frame: a 150 ms
  // tap can fall between two samples and never be seen. Hold each across several frames (Identify fires on the press).
  await page.keyboard.down('KeyQ');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyQ');
  await page.evaluate(() => window.__pads.buttons(1, [8]));
  await page.waitForTimeout(1800);
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
  await page.waitForFunction(() => window.__jjTest.localSources().find((s) => s.source === 101)?.identifyHeld === false, undefined, { timeout: 5000 });
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

// Council review 2026-11-15: a join while the host typed a track code rebuilt the Host menu, which emptied the field and put
// focus on Back, where the next letters (W, E…) made a phantom Keys A player.
test('a pad joining while the host types a track code keeps the field, its focus, and makes no key player', { timeout: 240_000 }, async (t) => {
  // The Host menu is the room's: a real room on the real game server.
  const game = await serveReal(join(repo, 'web/dist'));
  t.after(() => game.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.addInitScript(fakePads);
  await page.goto(`${game.url}/host?room&test=live`);
  await page.waitForFunction(() => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, { timeout: 180_000 });
  const seats = async () => (await page.evaluate(() => window.__jjRoom.view().seats.length));
  await page.locator('[data-act=menu]').click();
  await page.locator('[data-act=tracks]').click();
  const field = page.locator('[data-tracks] input[name=code]');
  await field.click();
  await page.keyboard.type('T29-08', { delay: 30 });
  // A pad joins: the room changes, so the menu repaints.
  await page.evaluate(() => {
    window.__pads.connect(0);
    window.__pads.buttons(0, [0]);
  });
  for (const t0 = Date.now(); (await seats()) < 1; await page.waitForTimeout(50)) assert.ok(Date.now() - t0 < 10_000, 'the pad never joined');
  await page.evaluate(() => window.__pads.buttons(0, []));
  await page.waitForTimeout(400);
  assert.equal(await field.inputValue(), 'T29-08', 'the typed code survives the repaint');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'code', 'and keeps the focus');
  await page.keyboard.type('-WE', { delay: 30 });
  await page.waitForTimeout(400);
  assert.equal(await field.inputValue(), 'T29-08-WE', 'the next letters land in the field');
  assert.equal(await seats(), 1, 'and make no key-cluster player');
});

// Council review 2026-11-15: a host pad chose its car once, in the first Lobby: a confirmed pick could not be reopened, and a
// pad that joined mid-race raced with no car of its own.
test('a host pad reopens its car pick with a flick; one that joins mid-race brings its remembered car', { timeout: 180_000 }, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(fakePads);
  assert.equal(await openHost(page, `${server.url}/host/?test=live`), 'test');
  const cars = (await import('../../shared/src/roster.json', { with: { type: 'json' } })).default.cars.map((c) => c.id);
  const seatOf = (source) => page.evaluate((src) => window.__jjRoom.view()?.seats.find((s) => s.localSource === src) ?? null, source);
  const until = async (what, ok, ms = 10_000) => {
    for (const t0 = Date.now(); ; await page.waitForTimeout(50)) {
      const v = await ok();
      if (v) return v;
      assert.ok(Date.now() - t0 < ms, what);
    }
  };
  // Hold each press across a few host frames (a software-rendered host samples slowly).
  const press = async (i, buttons, axes = [0, 0, 0, 0]) => {
    await page.evaluate(([i, b, a]) => {
      window.__pads.buttons(i, b);
      window.__pads.axes(i, a);
    }, [i, buttons, axes]);
    await page.waitForTimeout(400);
    await page.evaluate((i) => {
      window.__pads.buttons(i, []);
      window.__pads.axes(i, [0, 0, 0, 0]);
    }, i);
    await page.waitForTimeout(400);
  };
  await page.evaluate(() => window.__pads.connect(0));
  await press(0, [0]);
  await until('pad 1 picks its car', async () => (await seatOf(100))?.choosing === true);
  const first = (await seatOf(100)).vehicle;
  await press(0, [9]);
  await until('Start chooses it', async () => (await seatOf(100))?.choosing === false);
  // The pick was confirmed: a flick opens it again on the next car, and Start chooses that.
  await press(0, [], [0, 0, 1, 0]);
  const next = cars[(cars.indexOf(first) + 1) % cars.length];
  await until('a flick reopens the pick on the next car', async () => {
    const s = await seatOf(100);
    return s?.choosing === true && s.vehicle === next;
  });
  await press(0, [9]);
  await until('Start chooses the new car', async () => (await seatOf(100))?.choosing === false);
  assert.equal((await seatOf(100)).ready, false, 'choosing is not Ready');
  // A round starts; pad 2 joins mid-round with its remembered car (none yet: the roster's first), and no open picker.
  await page.evaluate(() => window.__jjRoom.start());
  await until('the round starts', async () => (await page.evaluate(() => window.__jjRoom.view()?.phase)) === 'Running', 60_000);
  await page.evaluate(() => window.__pads.connect(1));
  await press(1, [0]);
  const late = await until('pad 2 joins mid-race with a car', async () => {
    const s = await seatOf(101);
    return s?.vehicle ? s : null;
  });
  assert.equal(late.vehicle, cars[0]);
  assert.equal(late.choosing, false, 'no picker over a race');
  await ctx.close();
});
