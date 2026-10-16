// P1-W04/W02a/W05 (owner 2026-10-10: the right-stick flicks fire real items picked up on track). A real room on a
// generated track: two controllers race on the autopilot through the item stations; the host claims each box for the
// car's seat; a car holding a boomerang flicks it forward and it flies out and back as data and on the TV. Captures go to
// JJ_CAPTURE_DIR (or docs/evidence/P1-W05/captures) for the visual self-review.
import { evidencePath } from '../lib/evidence.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';

const BASE = '/p/w05/';
const CAPTURE = process.env.JJ_CAPTURE_DIR ?? join(evidencePath('P1-W05'), 'captures');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'w05'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const items = (host) => host.evaluate(async () => (await window.__jjTest.observe()).items);

test('W05: cars pick boxes up at the stations and a boomerang flicked forward flies out and back', { timeout: 600_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  host.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 90_000);
  for (let k = 1; k <= 2; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
    await frame(host, `syn${k}`, { ready: true });
  }
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));

  const first = await items(host);
  assert.ok(first.stations.length > 0, 'the generated track has item stations');

  // Race until the stations have handed out boxes and, ideally, a car holds a boomerang.
  let holder = null;
  for (let i = 0; i < 16 && !holder; i++) {
    await host.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 600, every: 30 }));
    const it = await items(host);
    holder = it.queues.find((q) => q.queue.front?.item === 'boomerang' || q.queue.back?.item === 'boomerang')?.car ?? null;
    if (i === 0) await host.screenshot({ path: join(CAPTURE, 'race-stations.png') });
  }
  const picked = await items(host);
  assert.ok(picked.stations.some((s) => s.taken > 0), `a station gave a box: ${JSON.stringify(picked.stations.map((s) => s.taken))}`);
  assert.ok(picked.events.some((e) => e.kind === 'Picked'), 'a pickup event');
  // A right-stick flick, applied the way the host applies a phone's Action (the phone's own gesture detection is the
  // controller journeys'; P1-C11/S08).
  const flickCar = async (car) => {
    const r = await host.evaluate((car) => window.__jjTest.command({ cmd: 'utility', car, forward: true }), car);
    await host.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 36, every: 6 }));
    await host.waitForTimeout(300);
    console.log(`# flick: ${JSON.stringify(r)}`);
    return r;
  };
  const queueOf = async (car) => (await items(host)).queues.find((q) => q.car === car).queue;
  // The draws are a fair coin per box: if no box held a boomerang this run, a car eats a sanga (a flick) to make room
  // and is handed a boomerang through the host's journalled pickup (the stations are proven above; this is the throw).
  const viaStation = holder !== null;
  if (!viaStation) {
    holder = picked.queues[0].car;
    // The clock is held first: the cars are driving through the stations, and a flick followed by stepped ticks let the
    // holder take another box and fill its queue again before the hand-over (CI run 5233: pickupItem refused "full").
    await host.evaluate(() => window.__jjTest.hold(true));
    if ((await queueOf(holder)).back) {
      const eat = await host.evaluate((car) => window.__jjTest.command({ cmd: 'utility', car, forward: true }), holder);
      console.log(`# made room with a flick: ${JSON.stringify(eat)}`);
    }
    const r = await host.evaluate((car) => window.__jjTest.command({ cmd: 'pickupItem', car, item: 'boomerang' }), holder);
    console.log(`# no boomerang drawn in the run; pickupItem ${JSON.stringify(r)}`);
    assert.ok(r.accepted, `the boomerang is handed over: ${JSON.stringify(r)}`);
  }
  await host.screenshot({ path: join(CAPTURE, 'picked-up.png') });
  // From here the room's clock is held and stepped, so the TV shows exactly the ticks the journey asks for (an unheld
  // test room runs ahead of real time and the 2 s flight would be over before a screenshot).
  await host.evaluate(() => window.__jjTest.hold(true));
  // A sanga queued in front is eaten by the first flick; the boomerang goes with the next.
  if ((await queueOf(holder)).front?.item !== 'boomerang') await flickCar(holder);
  await flickCar(holder);
  const thrown = await items(host);
  assert.equal(thrown.boomerangs.length, 1, `the boomerang is in the air: ${JSON.stringify(thrown.refusals)}`);
  await host.screenshot({ path: join(CAPTURE, 'boomerang-in-flight.png') });
  // The TV draws it: one boomerang instance in the frame on screen while it flies.
  assert.equal((await host.evaluate(() => window.__jjRender.props()))['item/boomerang'], 1, 'the TV draws the boomerang in the air');
  await host.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 360, every: 12 }));
  const landed = (await items(host)).boomerangs[0];
  assert.ok(landed.ended, `the flight ended: ${JSON.stringify(landed)}`);
  console.log(`# boomerang ${viaStation ? 'from a station' : 'given'}; stations ${first.stations.length}, taken ${picked.stations.filter((s) => s.taken > 0).length}; flight ${JSON.stringify(landed.ended)}, hits ${landed.hits.length}`);
  assert.deepEqual(errors, []);
});

test('W05: a phone shows the item it holds and the flick that uses it', { timeout: 300_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?drive&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjTest, undefined, 90_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  for (const [w, h] of [[844, 390], [390, 844]]) {
    const phone = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: w, height: h } })).newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(joinUrl);
    await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
    await phone.getByRole('button', { name: 'Join the race' }).click();
    await wait(phone, () => window.__jjController.inspect().phase === 'playing');
    await confirmInitialVehicle(phone);
    const skip = phone.getByRole('button', { name: 'Skip tutorial' });
    if (await skip.count()) await skip.click();
    const endpoint = (await phone.evaluate(() => window.__jjController.inspect())).link.endpointId;
    const car = await (await wait(host, async (ep) => (await window.__jjTest.observe()).host.seats.find((s) => s.endpoint === ep)?.car ?? false, endpoint)).jsonValue();
    // Spawn protection refuses offensive items: let it end (it does once the car is clear), then a boomerang in front and
    // a sanga queued behind it, given through the host's journalled pickup.
    await wait(host, async (car) => !(await window.__jjTest.observe()).cars.find((c) => c.car === car)?.protected, car, 30_000).catch(() => {});
    await host.evaluate(() => window.__jjTest.step(240));
    for (const item of ['boomerang', 'sanga']) await host.evaluate(([car, item]) => window.__jjTest.command({ cmd: 'pickupItem', car, item }), [car, item]);
    await host.evaluate(() => window.__jjTest.step(6));
    // Rendered, not just in the DOM: innerText is empty for anything the phone doesn't actually show.
    // (The display face sets it in capitals.)
    await wait(phone, () => /boomerang/i.test(document.querySelector('[data-hud=item]')?.innerText ?? ''), undefined, 15_000).catch(() => {});
    await phone.screenshot({ path: join(CAPTURE, `phone-item-${w}x${h}.png`) });
    const chip = await phone.locator('[data-hud=item]').innerText();
    assert.match(chip, /boomerang/i);
    assert.match(chip, /\+1/);
    assert.match(chip, /flick/i);
  }
  assert.deepEqual(errors, []);
});
