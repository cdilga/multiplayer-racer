import { confirmInitialVehicle } from './lib/vehicle.mjs';
// Journey JN3 (P1-G01): the party loop through the real host page (`B/host?room&test=live&laps=1`) and real phones over
// WebRTC. Two players join; the Lobby has no driving cars (R110); both tap Ready; the countdown puts them on the grid;
// the autopilot races a 1-lap round (test surface `autopilot`); Round complete shows both results on the TV and each
// phone its place (an idle phone gets the takeover cue, P1-G03); the next round starts. `JJ_CAPTURE_DIR=<dir>` saves the visual self-review matrix.
//   node --test web/tests/journeys/jn3-round-loop.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, gpu } from './lib/chromium.mjs';

const BASE = '/p/jn3/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'jn3'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });
const phase = (host) => host.evaluate(() => window.__jjRoom.view()?.phase);

async function phone(url, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(page);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  return { ctx, page };
}

// The idle-cue case needs fresh 20 Hz phone samples. Software GL in CI 9116 starved both phones for 2.5 s and
// triggered dropout instead; run this real-time multi-page journey on the GPU lane with the other latency checks.
test('JN3: two players race a 1-lap round, see results, and the next round starts', { timeout: 420_000, skip: !gpu && 'real-time phone refresh and idle takeover run on the GPU lane (CI 9116)' }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  await shot(host, 'tv-lobby-empty');

  const a = await phone(joinUrl, 'Davo');
  const b = await phone(joinUrl, 'Shazza');
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  assert.equal((await host.evaluate(() => window.__jjTest.observe())).cars.length, 0, 'the Lobby has no driving cars (R110)');
  await shot(host, 'tv-lobby-two-players');
  await shot(a.page, 'phone-lobby-not-ready');

  // Both tap Ready: the round starts on its own.
  await a.page.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => window.__jjRoom.view().seats.filter((s) => s.ready).length === 1);
  await shot(host, 'tv-lobby-one-ready');
  await b.page.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase));
  await shot(host, 'tv-countdown');
  await shot(a.page, 'phone-countdown');
  assert.equal((await host.evaluate(() => window.__jjTest.observe())).cars.length, 2, 'the countdown puts both on the grid');

  await wait(host, () => window.__jjRoom.view().phase === 'Running');
  // Startup rendering or the tutorial can already have handed a car to autopilot. The idle-cue scenario
  // starts from two freshly player-driven cars: deliberate input earns the real handback, then both let go.
  for (const { page } of [a, b]) await page.evaluate(() => window.__jjController.setSticks({ x: 0, y: -0.5, touch: true }, { x: 0, y: 0, touch: false }));
  await wait(host, async () => {
    const o = await window.__jjTest.observe();
    return o.host.seats.length === 2 && o.host.seats.every((s) => s.fresh && !s.inputDropped && !s.menuOpen)
      && o.cars.every((c) => c.autopilot == null && c.input.throttle > 0.3);
  });
  for (const { page } of [a, b]) await page.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
  await wait(host, async () => {
    const o = await window.__jjTest.observe();
    return o.host.seats.every((s) => s.fresh && !s.inputDropped && !s.menuOpen)
      && o.cars.every((c) => c.autopilot == null && c.input.throttle < 0.05);
  });
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await host.waitForTimeout(3000);
  await shot(host, 'tv-racing');
  // P1-G03: nobody has touched a stick since the start, so at 15 s the phones get the takeover cue, then the autopilot.
  // The 15 s are the host's sim clock, which a loaded software-WebGL runner runs well below real time (CI run 5196 saw 33 s of wall
  // time pass with the cars ~31 sim s along), so the wait is for the cue, not for a wall-clock bound.
  await wait(a.page, () => /Still there\?/.test(document.querySelector('[data-round-banner]')?.textContent ?? ''), undefined, 90_000).catch(async (e) => {
    const banner = await a.page.evaluate(() => document.querySelector('[data-round-banner]')?.textContent);
    const view = await host.evaluate(async () => ({ room: window.__jjRoom.view(), observed: await window.__jjTest.observe() }));
    const controller = await a.page.evaluate(() => ({ state: window.__jjController.inspect(), tutorial: window.__jjTutorial.inspect() }));
    throw new Error(`no idle cue: banner ${JSON.stringify(banner)}, host ${JSON.stringify(view)}, controller ${JSON.stringify(controller)}: ${e.message}`);
  });
  await shot(a.page, 'phone-idle-cue');
  await wait(a.page, () => /autopilot is driving/.test(document.querySelector('[data-round-banner]')?.textContent ?? ''), undefined, 10_000);
  await shot(a.page, 'phone-idle-autopilot');
  // P1-R06: Identify from the phone pulses that seat's tile on the TV; press-to-visible over loopback WebRTC.
  const seatA = (await host.evaluate(() => window.__jjRoom.view().seats)).find((s) => s.name === 'Davo').seat;
  const identify = [];
  for (let k = 0; k < 5; k++) {
    const before = await host.evaluate(() => window.__jjRoom.identified().length);
    const pressed = await a.page.evaluate(() => {
      const t = Date.now();
      document.querySelector('[data-act=identify]').click();
      return t;
    });
    // On software WebGL the wait outlasts the loose bound below, so a slow pulse fails on its time, not on a timeout.
    await wait(host, (n) => window.__jjRoom.identified().length > n, before, gpu ? 5000 : 15_000);
    const shown = (await host.evaluate(() => window.__jjRoom.identified())).at(-1);
    assert.equal(shown.seat, seatA, "the pulse is on Davo's tile");
    const carA = (await host.evaluate(() => window.__jjRoom.view().seats)).find((s) => s.name === 'Davo').car;
    // The mark lasts 1.6 s; a slow host may draw past it before this check, so the record of marks put up is asserted.
    const mark = (await host.evaluate(() => window.__jjRender.identifyMarksShown())).at(-1);
    assert.equal(mark?.car, carA, "Davo's number floats over his car in every view");
    identify.push(shown.wall - pressed);
    if (k === 0) await shot(host, 'tv-identify');
    // Identify is one per 3 s per seat (master §5.2) of host time, which a loaded software-WebGL host runs below real time
    // (CI run 5196), so a 3.3 s wall gap could land inside the cooldown there (CI run 5422).
    await host.waitForTimeout(gpu ? 3300 : 4500);
  }
  console.log(`# identify press → TV pulse (ms): ${identify.join(', ')}`);
  const renderer = gpu ? 'host on a GPU (ANGLE Vulkan)' : 'host on SwiftShader (software WebGL)';
  if (process.env.JJ_EVIDENCE_DIR) mkdirSync(process.env.JJ_EVIDENCE_DIR, { recursive: true });
  if (process.env.JJ_EVIDENCE_DIR) writeFileSync(`${process.env.JJ_EVIDENCE_DIR}/identify.json`, `${JSON.stringify({ transport: 'loopback WebRTC (Playwright Chromium)', renderer, samplesMs: identify }, null, 1)}\n`);
  // The 150 ms target holds for a host drawing on a GPU. On software WebGL each host frame takes ~150 ms and both the
  // press and the event wait behind one (CI's busy runner: 0.7-1 s), so there the samples get a loose bound only.
  // The 150 ms bound is the GPU lane's (gpu.yml); on a shared software-WebGL runner this only proves the pulse shows.
  const limit = gpu ? 150 : 8000;
  assert.ok(Math.max(...identify) <= limit, `press-to-visible ${identify} ms (≤ ${limit} ms, ${renderer})`);
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 300_000);
  // Results have a real deadline. Inspect/capture them without letting a slow renderer consume it.
  await host.evaluate(() => window.__jjTest.hold(true));
  const results = await host.evaluate(() => window.__jjRoom.view().results);
  assert.equal(results.length, 2, JSON.stringify(results));
  assert.deepEqual(results.map((r) => r.place).sort(), [1, 2]);
  await wait(host, () => document.querySelectorAll('[data-results] [data-row]').length === 2);
  await shot(host, 'tv-round-complete');
  await wait(a.page, () => /You came/.test(document.querySelector('[data-round-banner]')?.textContent ?? ''));
  await shot(a.page, 'phone-results');

  // The next round.
  await host.getByRole('button', { name: 'Start next round now' }).click();
  await host.evaluate(async () => { await window.__jjTest.step(1); await window.__jjTest.hold(false); });
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase) && window.__jjRoom.view().round === 2);
  assert.deepEqual(errors, []);
  await a.ctx.close();
  await b.ctx.close();
});
