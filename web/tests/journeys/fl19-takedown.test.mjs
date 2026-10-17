// P1-FL19 (R134): a takedown in a real round. A real phone (the attacker) and a synthetic seat (the victim) race on the
// flat greybox loop; the sim is held and the two cars set up as jj-sim's T-bone fixture (crates/jj-sim/tests/takedown.rs
// T_BONE: the victim still, the attacker across its front axle at 40 m/s; the 22 m/s rear-quarter ram only swung the
// victim 73 degrees on the greybox, under the spin bar). The ram spins the victim:
// the host gets the Takedown event, the TV pops TAKEDOWN over the attacker's car, and the attacker's phone shows it.
// `JJ_CAPTURE_DIR=<dir>` saves the visual self-review captures (TV 1920x1080, phone 915x412).
//   node --test web/tests/journeys/fl19-takedown.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';

const BASE = '/p/fl19/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'fl19'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png`, timeout: 120_000 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);

test('FL19: a ram that spins another car in a real round pops TAKEDOWN on the TV over the attacker and on its phone', { timeout: 300_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9&map=greybox-loop`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);

  // The attacker: a real phone through the real join path.
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  const phone = await ctx.newPage();
  phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await phone.goto(await host.evaluate(() => window.__jjNet.joinUrl()));
  await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.locator('#name').fill('Davo');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  await wait(phone, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(phone);
  await phone.getByRole('button', { name: 'Skip tutorial' }).click();
  // The victim: a synthetic seat.
  await frame(host, 'syn1', { hello: true });
  await frame(host, 'syn1', { claim: 'Shazza' });
  await frame(host, 'syn1', { ready: true });
  await phone.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);

  const cars = await host.evaluate(() => Object.fromEntries(window.__jjRoom.view().seats.map((s) => [s.name, s.car])));
  const attacker = cars.Davo, victim = cars.Shazza;
  assert.ok(Number.isInteger(attacker) && Number.isInteger(victim), JSON.stringify(cars));
  // Held, then set up as the sim fixture's T-bone (relative to the victim at the origin) and stepped 4 s.
  const before = await host.evaluate(async ({ attacker, victim }) => {
    const s = window.__jjTest;
    await s.hold(true);
    await s.command({ cmd: 'autopilot', on: false });
    await s.step(240); // out of spawn protection, as the fixture does
    await s.command({ cmd: 'place', car: victim, pose: { x: 0, y: 0.05, z: 0, headingDeg: 0 }, linvel: [0, 0, 0] });
    await s.command({ cmd: 'place', car: attacker, pose: { x: -14, y: 0.05, z: 1.5, headingDeg: 90 }, linvel: [40, 0, 0] });
    await s.step(1);
    return (await s.observe()).cars.length;
  }, { attacker, victim });
  assert.ok(before >= 2);
  const look = () => host.evaluate(async ({ attacker, victim }) => {
    const o = await window.__jjTest.observe();
    const c = (i) => { const x = o.cars[i]; return x && { p: x.position.map((v) => +v.toFixed(2)), v: +(x.speed ?? 0).toFixed(2), h: x.headingDeg ?? x.heading, up: x.upY }; };
    return { tick: o.tick, attacker: c(attacker), victim: c(victim) };
  }, { attacker, victim });
  const placed = await look();
  for (let k = 0; k < 8; k++) await host.evaluate(() => window.__jjTest.step(60));
  const after = await look();

  const events = await host.evaluate(() => window.__jjRoom.events().filter((e) => e.event.Takedown).map((e) => e.event.Takedown));
  assert.ok(events.some((t) => t.attacker === attacker && t.victim === victim), `the host got the takedown: ${JSON.stringify({ events, placed, after })}`);
  // The TV: TAKEDOWN popped over the attacker's car.
  await wait(host, (car) => window.__jjRender.launchCalloutsShown().some((c) => c.car === car && c.outcome === 'Takedown'), attacker, 30_000);
  await shot(host, 'tv-takedown');
  // The attacker's phone: it counted the takedown and its banner says so while it is up.
  await wait(phone, () => window.__jjController.inspect().takedowns >= 1, undefined, 30_000);
  const banner = await phone.evaluate(() => document.querySelector('[data-round-banner]')?.textContent ?? '');
  await shot(phone, 'phone-takedown');
  console.log(`# FL19 takedown: ${JSON.stringify({ events, banner })}`);
  assert.deepEqual(errors, []);
});
