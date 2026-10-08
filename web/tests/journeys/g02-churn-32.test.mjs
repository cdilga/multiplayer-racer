// P1-G02 AC "one churn run at 32 synthetic controllers shows there is no cap": 32 controllers (the test surface's
// synthetic frames: the same hello / claim / ready / leave a phone sends) fill the Lobby, churn there (eight leave, eight new
// ones join), start a race with all 32 on the grid, churn mid-race (ten leave, ten drop in, each with a car), and shrink to
// two. At every step the room's seats are exactly the controllers that are in it (no phantom seat, no refused claim), and a
// car stands for every seat. Nothing in the run is sized to 24 or 32: a 33rd controller joins as well.
//   node --test web/tests/journeys/g02-churn-32.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/g02c32/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'g02c32'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const seatsOf = (host) => host.evaluate(() => window.__jjRoom.view().seats.map((s) => s.name).sort());
const sorted = (xs) => [...xs].sort();

test('churn at 32 synthetic controllers: no cap, no phantom seats', { timeout: 900_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=99`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');

  const inRoom = new Map(); // endpoint -> name
  let next = 1;
  const join = async (n) => {
    const added = [];
    for (let i = 0; i < n; i++) {
      const ep = `syn${next}`;
      const name = `Racer ${next++}`;
      await frame(host, ep, { hello: true });
      await frame(host, ep, { claim: name });
      inRoom.set(ep, name);
      added.push(name);
    }
    return added;
  };
  const drop = async (eps) => {
    for (const ep of eps) {
      await frame(host, ep, { leave: true });
      inRoom.delete(ep);
    }
  };
  const settle = async (what) => {
    const want = sorted(inRoom.values());
    await wait(host, (w) => JSON.stringify(window.__jjRoom.view().seats.map((s) => s.name).sort()) === JSON.stringify(w), want).catch(async (e) => {
      throw new Error(`${what}: seats ${JSON.stringify(await seatsOf(host))}, expected ${JSON.stringify(want)}: ${e.message}`);
    });
  };
  const cars = async () => (await host.evaluate(() => window.__jjTest.observe())).cars.length;

  // Lobby: grow to 32, churn.
  await join(32);
  await settle('32 in the Lobby');
  assert.equal(await cars(), 0, 'the Lobby has no driving cars');
  await drop([...inRoom.keys()].slice(0, 8));
  await join(8);
  await settle('Lobby churn');
  assert.equal((await seatsOf(host)).length, 32);

  // The race: all 32 Ready, all 32 on the grid.
  for (const ep of inRoom.keys()) await frame(host, ep, { ready: true });
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase), undefined, 180_000);
  await wait(host, async () => (await window.__jjTest.observe()).cars.length === 32, undefined, 180_000);
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 180_000);

  // Mid-race churn: ten leave, ten drop in and each gets a car; a 33rd as well.
  await drop([...inRoom.keys()].slice(0, 10));
  await join(11);
  await settle('race churn');
  assert.equal((await seatsOf(host)).length, 33, 'no cap at 32: a 33rd seat');
  await wait(host, async () => {
    const o = await window.__jjTest.observe();
    return o.host.seats.length === 33 && o.host.seats.every((s) => s.car !== undefined && s.car !== null);
  }, undefined, 60_000);
  const o = await host.evaluate(() => window.__jjTest.observe());
  const seatCars = new Set(o.host.seats.map((s) => s.car));
  assert.equal(seatCars.size, 33, 'every seat has its own car');
  assert.ok([...seatCars].every((c) => o.cars.some((x) => x.car === c)), 'every seat’s car exists in the world');

  // Shrink to two.
  await drop([...inRoom.keys()].slice(2));
  await settle('shrunk to 2');
  assert.equal((await seatsOf(host)).length, 2);
  assert.deepEqual(errors, []);
});
