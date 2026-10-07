// P1-C08 hub: a second laptop (`B/j/<CODE>?hub`) with emulated pads and key clusters, and a phone with a paired pad, each
// source joining and leaving on its own. The Gamepad API is emulated (navigator.getGamepads) and keys are real key events.
// WebRTC: run on eris.   node --test web/tests/journeys/c08-hub.test.mjs   (JJ_CHROMIUM_GPU=1)
// NOTE: today each source is its own endpoint (the protocol seats one endpoint with one seat), so "one connection" and the
// N08 per-endpoint receipt are not asserted; per-source bytes are logged ('# bytes ...').
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';


// `JJ_CAPTURE_DIR=<dir>`: save the visual self-review matrix there (eris.sh points it into the run dir).
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};
const SIZES = { 'phone-portrait-390x844': [390, 844], 'phone-landscape-844x390': [844, 390], 'tv-1920x1080': [1920, 1080] };
/** Capture at each device size, then back to where it was (a resize with the state kept). */
const matrix = async (page, name, back) => {
  if (!CAPTURE) return;
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${label}`);
  }
  await page.setViewportSize(back);
  await page.waitForTimeout(300);
  await shot(page, `${name}-resized-back`);
};

const BASE = '/p/c08/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c08'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

// A software-rendered CI runner with three browser contexts open is several times slower than eris: generous waits.
/** Every context a test opens is closed after it: three software-rendered hosts at once starve each other. */
const contexts = [];
const newContext = async (opts) => {
  const c = await browser.newContext(opts);
  contexts.push(c);
  return c;
};
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => {});
});

const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

async function openHost(mode) {
  const host = await (await newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?${mode}&test=live`);
  await wait(host, () => window.__jjNet?.code() && (window.__jjTest || window.__jjRoom?.view()?.phase === 'Lobby'), undefined, 180_000); // opening a room on a busy runner
  return { host, code: await host.evaluate(() => window.__jjNet.code()), joinUrl: await host.evaluate(() => window.__jjNet.joinUrl()) };
}

/** Emulated gamepads: `window.__pads[i]` is what navigator.getGamepads() returns (null = unplugged). */
const PADS = () => {
  window.__pads = [];
  navigator.getGamepads = () => window.__pads;
  window.__padAdd = (i) => {
    window.__pads[i] = { index: i, id: `Test pad ${i}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
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

async function hubPage(joinUrl) {
  const page = await (await newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  await page.addInitScript(PADS);
  await page.goto(`${joinUrl}?hub`);
  await wait(page, () => window.__jjHub);
  return page;
}
const hubState = (page) => page.evaluate(() => window.__jjHub.inspect());
const seats = (host) => host.evaluate(() => window.__jjRoom.view().seats);

// Every source is its own signalling stream today (see hub.ts), and a browser holds at most six HTTP/1.1 connections per
// origin, so one hub page can carry five sources here (the sixth's signalling queues behind the other streams). Production
// is HTTP/2 behind the tunnel; a single multi-source connection is the real fix. The six seats of the acceptance are four
// pads and two key clusters on TWO hub pages (two browser contexts, so two connection pools): hub A has pads 1-2 and both
// key clusters, hub B has pads 3-4.
test('four pads and two key clusters hold six seats across two hubs; each drives only its own car; one unplugged pad goes alone', { timeout: 900_000 }, async () => {
  const { host, joinUrl } = await openHost('drive');
  const hub = await hubPage(joinUrl);
  const hubB = await hubPage(joinUrl);
  for (const [h, n] of [[hub, 2], [hubB, 2]]) for (let i = 0; i < n; i++) await h.evaluate((i) => window.__padAdd(i), i);
  // Each source claims on its own press.
  for (const h of [hub, hubB]) for (let i = 0; i < 2; i++) await h.evaluate((i) => window.__padSet(i, [0, 0, 1, 0]), i);
  await hub.keyboard.down('KeyW');
  await hub.keyboard.down('KeyI');
  const joined = (h) => h.evaluate(() => window.__jjHub.inspect().filter((s) => s.seat !== null).length);
  for (const [h, n] of [[hub, 4], [hubB, 2]]) await wait(h, (n) => window.__jjHub.inspect().filter((s) => s.seat !== null).length === n, n, 90_000);
  for (const h of [hub, hubB]) for (let i = 0; i < 2; i++) await h.evaluate((i) => window.__padSet(i, [0, 0, 0, 0]), i);
  await hub.keyboard.up('KeyW');
  await hub.keyboard.up('KeyI');
  const srcA = (await hubState(hub)).filter((s) => s.seat !== null);
  const srcB = (await hubState(hubB)).filter((s) => s.seat !== null);
  const src = [...srcA, ...srcB.map((s) => ({ ...s, id: `B-${s.id}` }))];
  assert.equal(new Set(src.map((s) => s.seat)).size, 6, 'six distinct seats');
  assert.deepEqual(src.map((s) => s.kind).sort(), ['keys', 'keys', 'pad', 'pad', 'pad', 'pad']);
  assert.equal((await joined(hub)) + (await joined(hubB)), 6);
  const hostSeats = () => host.evaluate(async () => (await window.__jjTest.observe()).host.seats.length);
  for (const t0 = Date.now(); (await hostSeats()) !== 6; await host.waitForTimeout(200)) assert.ok(Date.now() - t0 < 30_000, 'the host never saw six seats');
  await matrix(hub, 'c08-hub-four-sources', { width: 1100, height: 700 });
  console.log(`# bytes ${JSON.stringify(src.map((s) => [s.id, s.stats?.stateBytes, s.stats?.batches]))}`);

  // Only hub A's pad 2 and keys B drive; the other four stay where they are.
  const obs = () => host.evaluate(() => window.__jjTest.observe());
  // The claim presses boosted a few cars: let every one coast to a stop before measuring.
  for (const t0 = Date.now(); ; await host.waitForTimeout(500)) {
    const o = await obs();
    if (o.cars.every((c) => Math.abs(c.forwardSpeed) < 0.3)) break;
    assert.ok(Date.now() - t0 < 40_000, 'the cars never came to rest');
  }
  const start = await obs();
  await hub.evaluate(() => window.__padSet(1, [0, -1, 0, 0]));
  await hub.keyboard.down('KeyI');
  // What each source's endpoint holds at once: only the two driven sources have a throttle.
  await hub.waitForTimeout(700);
  const held = Object.fromEntries((await hubState(hub)).map((s) => [s.id, s.drive?.throttle ?? 0]));
  assert.ok(held.pad1 > 0.5 && held.keys2 > 0.5, `the pressed sources drive: ${JSON.stringify(held)}`);
  assert.ok(held.pad0 === 0 && held.keys1 === 0, `the others hold nothing: ${JSON.stringify(held)}`);
  assert.equal((await hubState(hubB)).filter((s) => (s.drive?.throttle ?? 0) !== 0).length, 0, "hub B's sources hold nothing");
  const ep = Object.fromEntries(src.map((s) => [s.id, s.endpoint]));
  const carOf = (state, e) => state.cars.find((c) => c.car === state.host.seats.find((s) => s.endpoint === e)?.car);
  const movedSince = (state, e) => Math.hypot(...carOf(state, e).position.map((v, i) => v - carOf(start, e).position[i]));
  // Early, before the driven cars can reach a neighbour on the grid: the four others haven't moved.
  const early = await obs();
  for (const id of ['pad0', 'keys1', 'B-pad0', 'B-pad1']) assert.ok(movedSince(early, ep[id]) < 1.5, `${id} stayed put (${movedSince(early, ep[id]).toFixed(2)} m)`);
  // A software-rendered host steps slowly in wall time: wait for the distance, not for a fixed few seconds.
  let now = await obs();
  for (const t0 = Date.now(); movedSince(now, ep.pad1) <= 5 || movedSince(now, ep.keys2) <= 5; now = await obs()) {
    assert.ok(Date.now() - t0 < 60_000, `the driven cars moved ${movedSince(now, ep.pad1).toFixed(1)} and ${movedSince(now, ep.keys2).toFixed(1)} m in 60 s`);
    await host.waitForTimeout(500);
  }
  await hub.keyboard.up('KeyI');
  await hub.evaluate(() => window.__padSet(1, [0, 0, 0, 0]));

  // Unplug hub A's pad 1: only its row and seat change.
  await hub.evaluate(() => window.__padUnplug(0));
  await wait(hub, () => window.__jjHub.inspect().find((s) => s.id === 'pad0').state === 'unplugged');
  const after2 = await hubState(hub);
  for (const s of after2) assert.equal(s.state === 'unplugged', s.id === 'pad0', `${s.id} is ${s.state}`);
  await hub.locator('[data-source=pad0]', { hasText: /Unplugged/ }).waitFor({ timeout: 5000 }); // the list repaints every 250 ms
  assert.match(await hub.locator('[data-source=pad1]').innerText(), /Connected|Ready/);
  assert.equal((await hubState(hubB)).filter((s) => s.state === 'unplugged').length, 0, "hub B's pads are untouched");
  await shot(hub, 'c08-hub-pad1-unplugged-1100x700');
  await host.waitForTimeout(3500);
  assert.equal(await hostSeats(), 6, 'no seat was lost');
});

test('each source leaves on its own; the hub shows seat, kind, state and path; Identify flashes that row', { timeout: 240_000 }, async () => {
  const { host, joinUrl } = await openHost('room');
  const hub = await hubPage(joinUrl);
  await hub.evaluate(() => {
    window.__padAdd(0);
    window.__padAdd(1);
    window.__padSet(0, [0, 0, 1, 0]);
    window.__padSet(1, [0, 0, 1, 0]);
  });
  await wait(hub, () => window.__jjHub.inspect().filter((s) => s.kind === 'pad' && s.seat !== null).length === 2, undefined, 90_000);
  await hub.evaluate(() => {
    window.__padSet(0, [0, 0, 0, 0]);
    window.__padSet(1, [0, 0, 0, 0]);
  });
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  // The row shows kind, state and the connection path.
  await wait(hub, () => /Direct|Relay/.test(document.querySelector('[data-source=pad0] [data-path]')?.textContent ?? ''), undefined, 90_000); // the path badge waits on ICE stats, slow on a software-rendered runner
  const row = await hub.locator('[data-source=pad0]').innerText();
  assert.match(row, /Pad 1/);
  // Identify (View/Select = button 8) flashes pad 0's row in its colour, and the TV gets that seat's Identify.
  await hub.waitForTimeout(3300); // past the seat reducer's join-flash window
  const seat0 = (await hubState(hub)).find((s) => s.id === 'pad0').seat;
  await hub.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: true }));
  await hub.locator('[data-source=pad0].hub-flash').waitFor({ timeout: 5000 });
  await shot(hub, 'c08-hub-identify-flash-1100x700');
  assert.equal(await hub.locator('[data-source=pad1].hub-flash').count(), 0, 'only that row flashes');
  await wait(host, (n) => window.__jjRoom.events().some((e) => e.event?.Identify), seat0, 10_000);
  await hub.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: false }));
  // Leave: hold View/Select + Start on pad 1; pad 0 keeps its seat.
  await hub.evaluate(() => window.__padSet(1, [0, 0, 0, 0], { 8: true, 9: true }));
  await wait(hub, () => window.__jjHub.inspect().find((s) => s.id === 'pad1').state === 'left', undefined, 8000);
  await hub.evaluate(() => window.__padSet(1, [0, 0, 0, 0], { 8: false, 9: false }));
  await hub.waitForTimeout(150); // let a tick see it let go, or the next press isn't a new join
  assert.equal((await hubState(hub)).find((s) => s.id === 'pad0').state, 'connected');
  // And it can rejoin by itself with a press.
  await hub.evaluate(() => window.__padSet(1, [0, 0, 1, 0]));
  await wait(hub, () => window.__jjHub.inspect().find((s) => s.id === 'pad1').seat !== null && window.__jjHub.inspect().find((s) => s.id === 'pad1').state === 'connected', undefined, 60_000);
});

test('a phone with one paired pad holds two seats and shows the connection badge', { timeout: 480_000 }, async () => {
  const { host, joinUrl } = await openHost('room');
  const ctx = await newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.addInitScript(PADS);
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(page, () => /Direct|Relay/.test(document.querySelector('[data-hud=conn]')?.textContent ?? ''), undefined, 90_000); // the path badge waits on ICE stats, slow on a software-rendered runner
  await page.evaluate(() => {
    window.__padAdd(0);
    window.__padSet(0, [0, 0, 1, 0]);
  });
  await wait(page, () => window.__jjHub?.inspect().find((s) => s.kind === 'pad')?.seat != null, undefined, 90_000);
  await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0]));
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  const src = await page.evaluate(() => window.__jjHub.inspect());
  assert.deepEqual(src.map((s) => s.kind).sort(), ['pad', 'touch']);
  await matrix(page, 'c08-phone-with-pad', { width: 844, height: 390 });
  assert.notEqual(src[0].seat ?? 'x', src[1].seat);
});
