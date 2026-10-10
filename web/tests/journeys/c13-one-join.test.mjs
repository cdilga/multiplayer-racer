// P1-C13 (R119): ONE join journey. Whatever joined by QR, link or code (a phone, a laptop) is also a carrier of extra players:
// a pad or key cluster pressed on it claims its own seat over the page's one connection, and the page's own touch player is
// optional. The P1-C08 hub journeys are ported here to the normal join (`B/j/<CODE>`), and `B/hub` / `?hub` are gone.
// The Gamepad API is emulated (navigator.getGamepads) and keys are real key events. Headless Chromium.
//   node --test web/tests/journeys/c13-one-join.test.mjs      (JJ_CAPTURE_DIR=<dir> saves the visual self-review captures)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const CAPTURE = process.env.JJ_CAPTURE_DIR;
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};

const BASE = '/p/c13/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', `c13${process.env.JJ_BUILD_SUFFIX ?? ''}`), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

async function openHost(mode) {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?${mode}&test=live`);
  await wait(host, () => window.__jjNet?.code() && (window.__jjTest || window.__jjRoom?.view()?.phase === 'Lobby'), undefined, 180_000);
  return { host, joinUrl: await host.evaluate(() => window.__jjNet.joinUrl()) };
}

/** Emulated gamepads: `window.__pads[i]` is what navigator.getGamepads() returns (null = unplugged). `id` is the model. */
const PADS = () => {
  window.__pads = [];
  navigator.getGamepads = () => window.__pads;
  window.__padAdd = (i, id = `Test pad ${i}`) => {
    window.__pads[i] = { index: i, id, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.dispatchEvent(new Event('gamepadconnected'));
  };
  window.__padSet = (i, axes, buttons = {}) => {
    const p = window.__pads[i];
    if (!p) return;
    p.axes = axes;
    for (const [b, v] of Object.entries(buttons)) p.buttons[b] = { pressed: v, value: v ? 1 : 0 };
  };
  window.__padUnplug = (i) => {
    window.__pads[i] = null;
  };
};

/** A laptop (or any page) at the normal join URL, with emulated pads; the touch player is left at the join card. */
async function joinPage(joinUrl, viewport = { width: 1100, height: 700 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.addInitScript(PADS);
  await page.goto(joinUrl);
  await wait(page, () => window.__jjSources && window.__jjController?.inspect().phase === 'ready-to-join');
  return page;
}
const src = (page) => page.evaluate(() => window.__jjSources.inspect());
const one = async (page, id) => (await src(page)).find((s) => s.id === id);
const seated = (page) => wait(page, () => window.__jjSources.inspect().filter((s) => s.kind !== 'touch' && s.seat !== null).length, undefined, 90_000);
const obs = (host) => host.evaluate(() => window.__jjTest.observe());
/** The seats in the room: a seat that left stays on the host as `Left` with no car, so it does not count. */
const hostSeats = async (host) => (await obs(host)).host.seats.filter((s) => s.presence !== 'Left');
const until = async (host, fn, why, ms = 20_000) => {
  for (const t0 = Date.now(); !(await fn()); await host.waitForTimeout(250)) assert.ok(Date.now() - t0 < ms, why);
};
const carOf = (o, n) => o.cars.find((c) => c.car === o.host.seats.find((s) => s.number === n)?.car);

test('a laptop joins by code with no touch player; two pads and a key cluster claim three seats one at a time over ONE connection, each driving only its own car', { timeout: 600_000 }, async () => {
  const { host, joinUrl } = await openHost('drive');
  const lap = await joinPage(joinUrl);
  // No touch player, no mode, no setting: just the join card, and the page is already a carrier.
  assert.equal((await lap.evaluate(() => window.__jjController.inspect().phase)), 'ready-to-join');
  assert.equal((await src(lap)).length, 0, 'nothing listed until something is pressed');
  await shot(lap, 'c13-laptop-carrier-empty');
  await lap.evaluate(() => {
    window.__padAdd(0, 'Pad model A');
    window.__padAdd(1, 'Pad model B');
  });
  // Plugged in but untouched: no seat.
  await lap.waitForTimeout(600);
  assert.equal((await src(lap)).length, 0, 'plugging a pad in claims nothing; a press does');
  // One at a time: pad 0, then pad 1, then the key cluster.
  await lap.evaluate(() => window.__padSet(0, [0, 0, 1, 0]));
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 1, undefined, 90_000);
  await lap.evaluate(() => window.__padSet(0, [0, 0, 0, 0]));
  await lap.waitForTimeout(150);
  await lap.evaluate(() => window.__padSet(1, [0, 0, 1, 0]));
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 2, undefined, 90_000);
  await lap.evaluate(() => window.__padSet(1, [0, 0, 0, 0]));
  await lap.keyboard.down('KeyW');
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 3, undefined, 90_000);
  await lap.keyboard.up('KeyW');
  const rows = await src(lap);
  assert.deepEqual(rows.map((s) => s.kind).sort(), ['keys', 'pad', 'pad']);
  assert.equal(new Set(rows.map((s) => s.seat)).size, 3, 'three distinct seats');
  assert.equal(new Set(rows.map((s) => s.endpoint)).size, 1, 'one endpoint');
  assert.equal(new Set(rows.map((s) => s.source)).size, 3, 'three source handles');
  assert.equal(await lap.evaluate(() => window.__jjSources.sources.connections()), 1, 'one WebRTC link');
  assert.equal(await lap.evaluate(() => window.__jjController.inspect().phase), 'ready-to-join', 'the touch player never tapped in');
  for (const t0 = Date.now(); (await hostSeats(host)).length !== 3; await host.waitForTimeout(200)) assert.ok(Date.now() - t0 < 30_000, 'the host never saw three seats');
  const eps = new Set((await hostSeats(host)).map((s) => s.endpoint));
  assert.equal(eps.size, 1, 'the host sees one endpoint');
  await wait(lap, () => [...document.querySelectorAll('[data-source] [data-path]')].every((e) => /Direct|Relay/.test(e.textContent ?? '')), undefined, 90_000);
  await shot(lap, 'c13-laptop-carrier-three-seats');

  // Each drives ONLY its own car: hold one source at a time; the host's applied throttle is on that seat's car alone.
  const byId = Object.fromEntries(rows.map((s) => [s.id, s.seat]));
  const drive = {
    pad1: (on) => lap.evaluate((d) => window.__padSet(0, [0, d, 0, 0]), on ? -1 : 0),
    pad2: (on) => lap.evaluate((d) => window.__padSet(1, [0, d, 0, 0]), on ? -1 : 0),
    keys1: (on) => (on ? lap.keyboard.down('KeyW') : lap.keyboard.up('KeyW')),
  };
  for (const id of Object.keys(drive)) {
    await drive[id](true);
    const mine = byId[id];
    for (const t0 = Date.now(); ; await host.waitForTimeout(250)) {
      const o = await obs(host);
      const thr = (n) => carOf(o, n)?.input?.throttle ?? 0;
      if (thr(mine) > 0.5) {
        for (const [other, n] of Object.entries(byId)) if (other !== id) assert.ok(thr(n) < 0.2 || carOf(o, n).autopilot != null, `${id} drives, but ${other}'s car holds throttle ${thr(n)}`);
        break;
      }
      assert.ok(Date.now() - t0 < 40_000, `${id}'s car never got its throttle`);
    }
    await drive[id](false);
    await lap.waitForTimeout(200);
  }
});

test('unplug = that seat autopilots, held, never expires; re-plug of the same model + press resumes the same seat and car; a different model is a new seat; Remove and Leave take only that seat and car', { timeout: 900_000 }, async () => {
  const { host, joinUrl } = await openHost('drive');
  const lap = await joinPage(joinUrl);
  await lap.evaluate(() => {
    window.__padAdd(0, 'Pad model A');
    window.__padAdd(1, 'Pad model B');
    window.__padSet(0, [0, 0, 1, 0]);
    window.__padSet(1, [0, 0, 1, 0]);
  });
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 2, undefined, 90_000);
  await lap.evaluate(() => {
    window.__padSet(0, [0, 0, 0, 0]);
    window.__padSet(1, [0, 0, 0, 0]);
  });
  const [a, b] = ['pad1', 'pad2'];
  const seatA = (await one(lap, a)).seat;
  const seatB = (await one(lap, b)).seat;
  const carA = (await hostSeats(host)).find((s) => s.number === seatA).car;
  // Pad B keeps driving the whole time (deliberate input), so it is never handed to the autopilot.
  await lap.evaluate(() => window.__padSet(1, [0, -1, 0, 0]));
  // Unplug A: only A's row and car change.
  await lap.evaluate(() => window.__padUnplug(0));
  await wait(lap, () => window.__jjSources.inspect().find((s) => s.id === 'pad1').state === 'unplugged');
  for (const s of await src(lap)) assert.equal(s.state === 'unplugged', s.id === a, `${s.id} is ${s.state}`);
  await lap.locator('[data-source=pad1]', { hasText: /Unplugged for \d+s/ }).waitFor({ timeout: 5000 });
  await shot(lap, 'c13-laptop-unplugged-row');
  for (const t0 = Date.now(); ; await host.waitForTimeout(300)) {
    const o = await obs(host);
    if (carOf(o, seatA)?.autopilot != null) {
      assert.equal(carOf(o, seatB)?.autopilot ?? null, null, "pad B's car stays under its player");
      break;
    }
    assert.ok(Date.now() - t0 < 30_000, "the unplugged pad's car never went to the autopilot");
  }
  // Held, not paused, not expired: the seat is still there and the duration keeps growing.
  await host.waitForTimeout(4000);
  assert.equal((await hostSeats(host)).length, 2, 'the seat is held');
  assert.ok((await one(lap, a)).unpluggedMs >= 4000, 'the page counts how long it has been unplugged');
  // Re-plug the SAME model (it lands on another index) + press: the same seat, the same car.
  await lap.evaluate(() => window.__padAdd(3, 'Pad model A'));
  await lap.waitForTimeout(300);
  assert.equal((await one(lap, a)).state, 'unplugged', 're-plugging alone resumes nothing; a press does');
  await lap.evaluate(() => window.__padSet(3, [0, -1, 0, 0]));
  await wait(lap, () => window.__jjSources.inspect().find((s) => s.id === 'pad1').state === 'connected');
  const back = await one(lap, a);
  assert.equal(back.seat, seatA, 'the same seat');
  assert.equal((await hostSeats(host)).length, 2, 'no second seat');
  assert.equal((await hostSeats(host)).find((s) => s.number === seatA).car, carA, 'the same car');
  for (const t0 = Date.now(); (carOf(await obs(host), seatA)?.autopilot ?? null) !== null; await host.waitForTimeout(300)) assert.ok(Date.now() - t0 < 30_000, 'the player takes the car back');
  // A DIFFERENT model on that index is a new player; the held seat stays held.
  await lap.evaluate(() => {
    window.__padSet(3, [0, 0, 0, 0]);
    window.__padUnplug(3);
  });
  await wait(lap, () => window.__jjSources.inspect().find((s) => s.id === 'pad1').state === 'unplugged');
  await lap.evaluate(() => {
    window.__padAdd(3, 'Some other pad');
    window.__padSet(3, [0, 0, 1, 0]);
  });
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 3, undefined, 90_000);
  await lap.evaluate(() => window.__padSet(3, [0, 0, 0, 0]));
  const ids = (await src(lap)).map((s) => s.id).sort();
  assert.deepEqual(ids, ['pad1', 'pad2', 'pad3']);
  assert.equal((await one(lap, 'pad1')).state, 'unplugged', 'the old seat is still held');
  assert.notEqual((await one(lap, 'pad3')).seat, seatA);
  assert.equal((await hostSeats(host)).length, 3);

  // Remove on the unplugged row: only that seat and car go.
  await lap.locator('[data-source=pad1] [data-act=remove]').click();
  await until(host, async () => (await hostSeats(host)).length === 2, 'the removed seat goes at the next tick boundary');
  // Its car stops being driven at once (no input, no autopilot); the body stays as scenery (S04c's rules). B's car is untouched.
  const gone = (await obs(host)).cars.find((c) => c.car === carA);
  assert.ok(gone && (gone.autopilot ?? null) === null && Math.abs(gone.input.throttle) < 0.01, `A's car is stopped: ${JSON.stringify(gone?.input)}`);
  assert.deepEqual((await src(lap)).map((s) => s.id).sort(), ['pad2', 'pad3']);
  assert.equal((await hostSeats(host)).some((s) => s.number === seatA), false);
  assert.equal((await hostSeats(host)).some((s) => s.number === seatB), true, "B's seat stays");
  // Leave on a plugged row: that seat alone goes.
  await lap.locator('[data-source=pad3] [data-act=leave]').click();
  await until(host, async () => (await hostSeats(host)).length === 1, 'the left seat goes');
  assert.equal((await one(lap, 'pad2')).state, 'connected');
});

test('the unplugged seat shows "unplugged for Ns" on the page and the TV, and nothing expires it; the leave chord leaves only that seat', { timeout: 600_000 }, async () => {
  const { host, joinUrl } = await openHost('room');
  const lap = await joinPage(joinUrl);
  await lap.evaluate(() => {
    window.__padAdd(0, 'Pad model A');
    window.__padSet(0, [0, 0, 1, 0]);
  });
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 1, undefined, 90_000);
  await lap.evaluate(() => window.__padSet(0, [0, 0, 0, 0]));
  await lap.keyboard.down('KeyW');
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 2, undefined, 90_000);
  await lap.keyboard.up('KeyW');
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  await lap.evaluate(() => window.__padUnplug(0));
  await lap.locator('[data-source=pad1]', { hasText: /Unplugged for/ }).waitFor({ timeout: 10_000 });
  // The TV: the lobby card for that seat says so, with how long.
  await host.locator('.lcard[data-state=away]', { hasText: /Unplugged \d+s/ }).waitFor({ timeout: 15_000 });
  await host.waitForTimeout(1500);
  await shot(host, 'c13-tv-lobby-unplugged');
  await shot(lap, 'c13-laptop-unplugged-state');
  const t0 = await host.evaluate(() => window.__jjRoom.view().seats.find((s) => s.unpluggedMs != null)?.unpluggedMs);
  await host.waitForTimeout(6000);
  const seatsNow = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ n: s.number, u: s.unpluggedMs ?? null })));
  assert.equal(seatsNow.length, 2, 'nothing expired the held seat');
  const held = seatsNow.find((s) => s.u !== null);
  assert.ok(held.u >= (t0 ?? 0) + 5000, `the TV's duration keeps growing: ${t0} -> ${held.u}`);
  assert.ok((await one(lap, 'pad1')).unpluggedMs >= 6000, 'and so does the page');
  // The chord leaves only the cluster's seat (hold Identify + READY of Keys A).
  await lap.keyboard.down('KeyQ');
  await lap.keyboard.down('KeyE');
  await wait(lap, () => window.__jjSources.inspect().find((s) => s.id === 'keys1').state === 'left', undefined, 8000);
  await lap.keyboard.up('KeyQ');
  await lap.keyboard.up('KeyE');
  await wait(host, () => window.__jjRoom.view().seats.length === 1, undefined, 20_000);
  assert.equal((await one(lap, 'pad1')).state, 'unplugged', 'the unplugged seat is still held');
});

test('Add a player on a joined page waits for the next pad or key press (a second touch player is not allowed), and Cancel puts it back', { timeout: 300_000 }, async () => {
  const { host, joinUrl } = await openHost('room');
  const lap = await joinPage(joinUrl);
  await lap.getByRole('button', { name: 'Add a player' }).click();
  await lap.locator('[data-adding]').waitFor();
  await shot(lap, 'c13-laptop-add-a-player');
  assert.equal((await src(lap)).length, 0, 'tapping Add claims nothing by itself: one player per touchscreen');
  await lap.getByRole('button', { name: 'Cancel' }).click();
  await lap.getByRole('button', { name: 'Add a player' }).click();
  await lap.evaluate(() => {
    window.__padAdd(0);
    window.__padSet(0, [0, 0, 1, 0]);
  });
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 1, undefined, 90_000);
  await lap.locator('[data-add]').waitFor(); // the prompt clears once the press has claimed its seat
  assert.equal(await lap.locator('[data-adding]').count(), 0);
  await wait(host, () => window.__jjRoom.view().seats.length === 1);
});

test('in a race the TV tile of an unplugged seat shows the "Unplugged Ns" chip', { timeout: 400_000 }, async () => {
  const { host, joinUrl } = await openHost('room');
  const lap = await joinPage(joinUrl);
  await lap.evaluate(() => {
    window.__padAdd(0, 'Pad model A');
    window.__padSet(0, [0, 0, 1, 0]);
  });
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 1, undefined, 90_000);
  await lap.evaluate(() => window.__padSet(0, [0, 0, 0, 0]));
  await lap.keyboard.down('KeyW');
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 2, undefined, 90_000);
  await lap.keyboard.up('KeyW');
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  await host.locator('[data-act=start]').click();
  await wait(host, () => ['Running', 'Countdown'].includes(window.__jjRoom.view().phase), undefined, 60_000);
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await lap.evaluate(() => window.__padUnplug(0));
  await host.locator('.hud-status [data-unplugged]').first().waitFor({ timeout: 30_000 });
  await host.waitForTimeout(2500);
  await shot(host, 'c13-tv-race-unplugged-chip');
  assert.match(await host.locator('.hud-status [data-unplugged]').first().innerText(), /Unplugged \d+s/);
});

test('typing a name does not press a key cluster', { timeout: 300_000 }, async () => {
  const { joinUrl } = await openHost('room');
  const lap = await joinPage(joinUrl);
  await lap.locator('#name').fill('');
  await lap.locator('#name').press('KeyW');
  await lap.locator('#name').press('KeyI');
  await lap.waitForTimeout(500);
  assert.equal((await src(lap)).length, 0, 'keys typed into the name field claim nothing');
});

test('a phone taps in as a touch player, then a plugged-in pad is a second seat, both listed on the phone', { timeout: 480_000 }, async () => {
  const { host, joinUrl } = await openHost('room');
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.addInitScript(PADS);
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(page, () => /Direct|Relay/.test(document.querySelector('[data-hud=conn]')?.textContent ?? ''), undefined, 90_000);
  await page.evaluate(() => {
    window.__padAdd(0);
    window.__padSet(0, [0, 0, 1, 0]);
  });
  await wait(page, () => window.__jjSources.inspect().find((s) => s.kind === 'pad')?.seat != null, undefined, 90_000);
  await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0]));
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  const rows = await src(page);
  assert.deepEqual(rows.map((s) => s.kind).sort(), ['pad', 'touch']);
  assert.notEqual(rows[0].seat, rows[1].seat);
  await wait(page, () => document.querySelectorAll('[data-source]').length === 2, undefined, 10_000); // both are listed on the phone
  await page.waitForTimeout(600);
  await shot(page, 'c13-phone-with-pad-landscape');
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await shot(page, 'c13-phone-with-pad-portrait');
  // The pad unplugged on the phone: the touch player drives on; the tray says so.
  await page.evaluate(() => window.__padUnplug(0));
  await page.locator('[data-source=pad1]', { hasText: /Unplugged for/ }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await shot(page, 'c13-phone-pad-unplugged-portrait');
  assert.equal(await page.evaluate(() => window.__jjController.inspect().phase), 'playing');
});

test('carrier drop: a phone (touch + pad) and a laptop (key cluster) lose their connection mid-race; every seat they carry autopilots, then resumes in its own car with no re-press', { timeout: 900_000 }, async () => {
  const { host, joinUrl } = await openHost('drive');
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const phone = await ctx.newPage();
  await phone.addInitScript(PADS);
  await phone.goto(joinUrl);
  await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  await wait(phone, () => window.__jjController.inspect().phase === 'playing');
  await phone.evaluate(() => {
    window.__padAdd(0);
    window.__padSet(0, [0, 0, 1, 0]);
  });
  await wait(phone, () => window.__jjSources.inspect().find((s) => s.kind === 'pad')?.seat != null, undefined, 90_000);
  await phone.evaluate(() => window.__padSet(0, [0, 0, 0, 0]));
  const lap = await joinPage(joinUrl);
  await lap.keyboard.down('KeyW');
  await wait(lap, () => window.__jjSources.inspect().find((s) => s.kind === 'keys')?.seat != null, undefined, 90_000);
  await lap.keyboard.up('KeyW');
  for (const t0 = Date.now(); (await hostSeats(host)).length !== 3; await host.waitForTimeout(200)) assert.ok(Date.now() - t0 < 30_000, 'three seats');
  const before = (await hostSeats(host)).map((s) => ({ n: s.number, car: s.car })).sort((x, y) => x.n - y.n);
  const phoneEp = await phone.evaluate(() => window.__jjController.inspect().link.endpointId);
  const lapEp = await lap.evaluate(() => window.__jjSources.inspect()[0].endpoint);
  // The network goes (signalling cut, so the link cannot come straight back) and the host's side of each connection is dropped.
  await ctx.setOffline(true);
  await lap.context().setOffline(true);
  await host.evaluate(([a, b]) => {
    window.__jjNet.dropPeer(a);
    window.__jjNet.dropPeer(b);
  }, [phoneEp, lapEp]);
  // Every carried seat goes to the autopilot (never paused); the seats stay.
  for (const t0 = Date.now(); ; await host.waitForTimeout(400)) {
    const o = await obs(host);
    if (before.every((b) => carOf(o, b.n)?.autopilot != null)) break;
    assert.ok(Date.now() - t0 < 40_000, 'every carried seat goes on autopilot');
  }
  assert.equal((await hostSeats(host)).length, 3, 'no seat was lost');
  await shot(phone, 'c13-phone-carrier-dropped');
  // The network returns. Reconnect on its own: every seat is back in its own car, nobody pressed anything.
  await ctx.setOffline(false);
  await lap.context().setOffline(false);
  // A phone coming back to the foreground retries at once (as C03's resume journey does).
  for (const p of [phone, lap]) {
    await p.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  await phone.waitForTimeout(5000);
  console.log('# phone', JSON.stringify(await phone.evaluate(() => window.__jjSources.inspect().map((s) => [s.id, s.phase, s.state, s.seat]))), await phone.evaluate(() => window.__jjController.inspect().link?.state));
  console.log('# lap', JSON.stringify(await lap.evaluate(() => window.__jjSources.inspect().map((s) => [s.id, s.phase, s.state, s.seat]))), await lap.evaluate(() => window.__jjController.inspect().phase));
  await wait(phone, () => window.__jjSources.inspect().every((s) => s.phase === 'playing'), undefined, 60_000);
  await wait(lap, () => window.__jjSources.inspect().every((s) => s.phase === 'playing'), undefined, 120_000);
  const after = (await hostSeats(host)).map((s) => ({ n: s.number, car: s.car })).sort((x, y) => x.n - y.n);
  assert.deepEqual(after, before, 'the same seats in the same cars');
});

test('B/hub and ?hub are gone: one join journey remains', { timeout: 240_000 }, async () => {
  const { joinUrl } = await openHost('room');
  const origin = new URL(joinUrl).origin;
  assert.equal((await fetch(`${origin}${BASE}hub`)).status, 404);
  assert.equal((await fetch(`${origin}${BASE}hub/`)).status, 404);
  // `?hub` is just an unknown query: the page is the normal join page.
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  await page.goto(`${joinUrl}?hub`);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  assert.equal(await page.locator('[data-hub-entry], [data-hub]').count(), 0);
  assert.equal(await page.evaluate(() => typeof window.__jjHub), 'undefined');
});

test('six sources on one page (four pads, two clusters) hold six seats over ONE connection; Identify flashes only that row (ported from C08)', { timeout: 600_000 }, async () => {
  const { host, joinUrl } = await openHost('room');
  const lap = await joinPage(joinUrl);
  await lap.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      window.__padAdd(i);
      window.__padSet(i, [0, 0, 1, 0]);
    }
  });
  await lap.keyboard.down('KeyW');
  await lap.keyboard.down('KeyI');
  await wait(lap, () => window.__jjSources.inspect().filter((s) => s.seat !== null).length === 6, undefined, 90_000);
  await lap.evaluate(() => {
    for (let i = 0; i < 4; i++) window.__padSet(i, [0, 0, 0, 0]);
  });
  await lap.keyboard.up('KeyW');
  await lap.keyboard.up('KeyI');
  const rows = await src(lap);
  assert.equal(new Set(rows.map((s) => s.seat)).size, 6);
  assert.equal(new Set(rows.map((s) => s.endpoint)).size, 1);
  assert.equal(await lap.evaluate(() => window.__jjSources.sources.connections()), 1);
  await wait(host, () => window.__jjRoom.view().seats.length === 6);
  for (const s of await src(lap)) assert.ok(s.stats.records > 0 || s.stats.cmds > 0, `${s.id} reports wire counters`);
  // Identify (View/Select = button 8) flashes pad 1's row in its colour, and only that row.
  await lap.waitForTimeout(3300);
  const seat1 = (await one(lap, 'pad1')).seat;
  await lap.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: true }));
  await lap.locator('[data-source=pad1].hub-flash').waitFor({ timeout: 5000 });
  assert.equal(await lap.locator('[data-source=pad2].hub-flash').count(), 0, 'only that row flashes');
  await wait(host, (n) => window.__jjRoom.events().some((e) => e.event?.Identify), seat1, 10_000);
  await lap.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: false }));
  // Leave (hold View/Select + Start) on pad 2; it rejoins on its own with a press.
  await lap.evaluate(() => window.__padSet(1, [0, 0, 0, 0], { 8: true, 9: true }));
  await wait(lap, () => window.__jjSources.inspect().find((s) => s.id === 'pad2').state === 'left', undefined, 8000);
  await lap.evaluate(() => window.__padSet(1, [0, 0, 0, 0], { 8: false, 9: false }));
  await lap.waitForTimeout(150);
  assert.equal((await one(lap, 'pad1')).state, 'connected');
  await lap.evaluate(() => window.__padSet(1, [0, 0, 1, 0]));
  await wait(lap, () => window.__jjSources.inspect().find((s) => s.id === 'pad2').state === 'connected', undefined, 60_000);
  await shot(lap, 'c13-laptop-six-sources');
});
