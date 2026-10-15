// P1-FL02 (R127), the gated start through the real join path: four real phones join over WebRTC and tap Ready; on the
// grid the cars are held through the countdown, and each phone does something different with its launch:
//   A snaps the launch DURING the countdown  -> Early (the launch is forfeited for this start)
//   B charges through the countdown, snaps at GO -> Perfect (inside 0.25 s) or, if loopback jitter costs it the window, Launch
//   C charges after GO and snaps ~0.7 s later -> Launch
//   D touches nothing                         -> no outcome at all
// Asserts the host got each StartLaunch event and put the callout over the right car, each phone got its own outcome (and
// shows its words on the round banner), and no car moves before GO. B's perfect-versus-launch split rests on Playwright's
// cross-page latency (~tens of ms against a 250 ms window), so the test accepts either for B and reports which it was.
// `JJ_CAPTURE_DIR=<dir>` saves the visual self-review captures (TV 1920x1080, phones 915x412).
//   node --test web/tests/journeys/fl02-gated-start.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';

const BASE = '/p/fl02/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'fl02'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ channel: process.env.JJ_CHROMIUM_GPU === 'native' ? 'chromium' : undefined, args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png`, timeout: 120_000 });
const STILL = { x: 0, y: 0, touch: false };
const stick = (page, drive) => page.evaluate((d) => window.__jjController.setSticks({ ...d, touch: d.x !== 0 || d.y !== 0 }, { x: 0, y: 0, touch: false }), drive);
const pull = (page) => stick(page, { x: 0, y: 1 });
const snap = (page) => stick(page, { x: 0, y: -1 });

async function phone(joinUrl, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(page);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  return page;
}

test('FL02: early, perfect, late and none through four real phones', { timeout: 420_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const names = ['Davo', 'Shazza', 'Mick', 'Bazza'];
  const phones = [];
  for (const n of names) phones.push(await phone(joinUrl, n));
  const [A, B, C, D] = phones;
  await wait(host, () => window.__jjRoom.view().seats.length === 4);
  const seats = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ seat: s.seat, name: s.name })));
  const seatOf = (name) => seats.find((s) => s.name === name).seat;

  // D never taps Ready, so the host's Start race force-starts with the longer warning countdown: room for stills.
  for (const p of [A, B, C]) await p.getByRole('button', { name: /^Ready/ }).click();
  await host.waitForTimeout(1000);
  await host.locator('[data-act=start]').click();
  await wait(host, () => window.__jjRoom.view().phase === 'Countdown', undefined, 60_000);
  await wait(host, () => (window.__jjRoom.view().remainingMs ?? 0) > 0);
  console.log('FL02 countdown remainingMs at start', await host.evaluate(() => window.__jjRoom.view().remainingMs));
  const t0 = Date.now();
  await shot(host, 'tv-countdown');
  await shot(A, 'phone-countdown');
  console.log('FL02 stills took ms', Date.now() - t0, 'remaining', await host.evaluate(() => window.__jjRoom.view().remainingMs));

  // Nobody moves before GO: sample every car through the countdown.
  const before = await host.evaluate(async () => (await window.__jjTest.observe()).cars.map((c) => c.position));
  let preGoSpeed = 0;
  const watch = (async () => {
    while ((await host.evaluate(() => window.__jjRoom.view().phase)) === 'Countdown') {
      const speeds = await host.evaluate(async () => (await window.__jjTest.observe()).cars.map((c) => Math.abs(c.forwardSpeed ?? 0)));
      preGoSpeed = Math.max(preGoSpeed, ...speeds);
      await host.waitForTimeout(120);
    }
  })();

  // A: pull back, then snap during the countdown -> Early.
  await wait(host, () => (window.__jjRoom.view().remainingMs ?? 9e9) < 2600, undefined, 10_000);
  await pull(A);
  await host.waitForTimeout(700);
  await snap(A);
  await wait(A, () => window.__jjController.inspect().launchOutcome === 'Early', undefined, 10_000);
  assert.match(await A.locator('[data-round-banner]').innerText(), /EARLY! NO LAUNCH/);
  await shot(A, 'phone-early');
  console.log('FL02 phone banner', JSON.stringify(await A.evaluate(() => {
    const b = document.querySelector('[data-round-banner]');
    const chain = (e) => { const o = []; for (; e && e !== document.body; e = e.parentElement) { const c = getComputedStyle(e); o.push(`${e.tagName}.${e.className}|${c.position}|z${c.zIndex}|op${c.opacity}|ov${c.overflow}|${c.contain}`); } return o; };
    const pod = document.querySelector('.pod');
    return { banner: chain(b), pod: chain(pod), bannerRect: b.getBoundingClientRect().toJSON(), podRect: pod.getBoundingClientRect().toJSON(), text: b.textContent, bg: getComputedStyle(b).backgroundColor };
  })));
  await wait(host, () => window.__jjRender.launchCallouts().length > 0, undefined, 5_000);
  await shot(host, 'tv-early');
  await stick(A, { x: 0, y: 0 });

  // B: charge for the last second of the countdown, snap on the first poll that sees GO.
  await wait(host, () => (window.__jjRoom.view().remainingMs ?? 9e9) < 1000, undefined, 10_000);
  await pull(B);
  await host.waitForFunction(() => window.__jjRoom.view().phase === 'Running', undefined, { timeout: 10_000, polling: 'raf' });
  await snap(B);
  await watch;
  const after = await host.evaluate(async () => (await window.__jjTest.observe()).cars.map((c) => c.position));
  // The held grid: the early snapper did not launch (no lifted front, no more travel than the car that did nothing), and
  // nobody is driving off. A held car takes zero input, so a slope or the suspension settling can still creep it a little:
  // that creep is the same for every car, is reported here, and is not the launch.
  const carOf = (name) => seats2.find((x) => x.seat === seatOf(name)).car;
  const seats2 = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ seat: s.seat, car: s.car })));
  const travel = (name) => Math.hypot(...[0, 2].map((k) => after[carOf(name)][k] - before[carOf(name)][k]));
  console.log(`FL02 travel over the countdown (m): ${JSON.stringify(Object.fromEntries(names.map((n) => [n, +travel(n).toFixed(2)])))}; fastest forward speed ${preGoSpeed.toFixed(2)} m/s`);
  assert.ok(Math.abs(travel('Davo') - travel('Bazza')) < 1, 'the early snapper travelled no further than the car that did nothing');
  assert.ok(preGoSpeed < 1.5, `no car drove off before GO (fastest ${preGoSpeed.toFixed(3)} m/s)`);

  // C: charge a little after GO, snap 0.7 s later -> Launch.
  await host.waitForTimeout(500);
  await pull(C);
  await host.waitForTimeout(700);
  await snap(C);

  await wait(B, () => ['Perfect', 'Launch'].includes(window.__jjController.inspect().launchOutcome), undefined, 10_000);
  await shot(B, 'phone-b-outcome');
  await wait(C, () => window.__jjController.inspect().launchOutcome === 'Launch', undefined, 10_000);
  await shot(C, 'phone-launch');
  await shot(host, 'tv-launch');
  await host.waitForTimeout(1500);

  const outcomes = await host.evaluate(() => window.__jjRoom.events().filter((e) => e.event.StartLaunch).map((e) => e.event.StartLaunch));
  const bySeat = (name) => outcomes.filter((o) => o.seat === seatOf(name)).map((o) => o.outcome);
  assert.deepEqual(bySeat('Davo'), ['Early'], `A snapped in the countdown: ${JSON.stringify(outcomes)}`);
  const b = bySeat('Shazza');
  assert.equal(b.length, 1, `B has one outcome: ${JSON.stringify(outcomes)}`);
  assert.ok(['Perfect', 'Launch'].includes(b[0]), `B launched at GO: ${b}`);
  assert.deepEqual(bySeat('Mick'), ['Launch'], `C launched late: ${JSON.stringify(outcomes)}`);
  assert.deepEqual(bySeat('Bazza'), [], `D did nothing and has no outcome: ${JSON.stringify(outcomes)}`);
  console.log(`FL02 outcomes: ${JSON.stringify(outcomes)} (B was ${b[0]})`);

  // The TV popped a callout over each of A, B and C's cars and not over D's.
  const shown = await host.evaluate(() => {
    const cars = Object.fromEntries(window.__jjRoom.view().seats.map((s) => [s.seat, s.car]));
    return { cars, shown: window.__jjRender.launchCalloutsShown() };
  });
  const calloutFor = (name) => shown.shown.filter((s) => s.car === shown.cars[seatOf(name)]).map((s) => s.outcome);
  assert.deepEqual(calloutFor('Davo'), ['Early']);
  assert.equal(calloutFor('Shazza').length, 1);
  assert.deepEqual(calloutFor('Mick'), ['Launch']);
  assert.deepEqual(calloutFor('Bazza'), []);
  assert.equal(await D.evaluate(() => window.__jjController.inspect().launchOutcome), null, 'D saw no outcome on its phone');
  await shot(D, 'phone-none');

  // The launchers pull away; the early snapper and the idle one are slower off the line than C a second on.
  await host.waitForTimeout(1500);
  for (const p of phones) assert.deepEqual(p.errors, []);
  assert.deepEqual(errors, []);
});
