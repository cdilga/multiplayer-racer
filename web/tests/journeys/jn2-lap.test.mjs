// Journey JN2 (P1-G01): a lap through the real host page (`B/host?room&test=live&laps=2`) with a synthetic controller
// (the test surface feeds its hello, claim and ready frames as a phone's would arrive; no WebRTC). The round runs on the
// room's own Lobby -> Countdown -> Running phases; the journey then holds the clock and steps it, so every fact is exact:
//  - the gates are passed one at a time, in order (each anchor is the next gate along the route), and the lap counter
//    and the tile's HUD move from "Lap 1/2" to "Lap 2/2" when the last gate is crossed;
//  - a shortcut doesn't count: a car dropped further round the route (a teleport never crosses a gate) drives past
//    gates that aren't the next expected one and earns none;
//  - no checkpoint graphic is drawn (R106): no gate or checkpoint model among the map's draws, no such text on the page
//    (the finish gantry is the only line graphic).
// `JJ_CAPTURE_DIR=<dir>` saves the visual self-review captures.
//   node --test web/tests/journeys/jn2-lap.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/jn2/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'jn2'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const hud = (host) => host.evaluate(() => document.querySelector('.hud-tile .hud-lap')?.textContent ?? null);
const race = (host, car) => host.evaluate(async (car) => (await window.__jjTest.observe()).cars.find((c) => c.car === car).race, car);

test('JN2: a lap completes with its gates in order, the HUD counts it, a shortcut earns nothing, and no checkpoint is drawn', { timeout: 600_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=2`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);

  await frame(host, 'syn1', { hello: true });
  await frame(host, 'syn1', { claim: 'Davo' });
  await wait(host, () => window.__jjRoom.view().seats.length === 1);
  await frame(host, 'syn1', { ready: true });
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 60_000);
  const car = (await host.evaluate(() => window.__jjRoom.view().seats[0])).car;
  assert.equal(typeof car, 'number', 'the seat has a car on the grid');

  // From here the clock is held and stepped: every fact below is exact.
  await host.evaluate(() => window.__jjTest.hold(true));
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  assert.equal((await race(host, car)).gatesPassed, 0, 'no gate before the first crossing');
  await wait(host, () => /Lap 1\/2/.test(document.querySelector('.hud-tile .hud-lap')?.textContent ?? ''));
  await shot(host, 'tv-lap1-start');

  // The first gate along the route is the finish line; the lap closes on the same gate.
  assert.equal((await host.evaluate(() => window.__jjTest.until({ car: 0, metric: 'gatesPassed', min: 1 }, 6000))).held, true);
  const finishLine = (await race(host, car)).anchorRoutePoint;

  // A shortcut: a second car dropped ahead on the route (a teleport never crosses a gate) drives on past gates that
  // aren't its next one. It earns none, while the first car's count is untouched by it.
  const spawned = await host.evaluate(async () => {
    const t = window.__jjTest;
    const { cars } = await t.spawn([{ routePoint: 150 }]);
    const o = await t.observe();
    await t.inputs([{ car: cars[0], fromTick: o.tick, throttle: 1 }]);
    return { car: cars[0], at: o.cars.find((c) => c.car === cars[0]).position, race: o.cars.find((c) => c.car === cars[0]).race };
  });
  await host.evaluate(() => window.__jjTest.step(900));
  const cut = await host.evaluate(async (id) => {
    const c = (await window.__jjTest.observe()).cars.find((x) => x.car === id);
    return { race: c.race, position: c.position };
  }, spawned.car);
  const moved = Math.hypot(cut.position[0] - spawned.at[0], cut.position[2] - spawned.at[2]);
  assert.ok(moved > 40, `the shortcut car drove ${moved.toFixed(0)} m past the gates ahead of it: ${JSON.stringify([spawned, cut])}`);
  assert.equal(cut.race.gatesPassed, 0, `a shortcut earns no gate: ${JSON.stringify(cut.race)}`);
  assert.equal(cut.race.laps, 0);
  assert.equal(cut.race.progressM, 0, 'and no legal progress');
  await shot(host, 'tv-shortcut');

  // The lap, gate by gate: each gate is the next one along the route (anchors rise by one gate spacing, wrapping once).
  const anchors = [];
  let gates = (await race(host, car)).gatesPassed; // the shortcut's 900 ticks ran the lap on
  assert.ok(gates > 0, 'the lap is under way');
  for (;;) {
    const u = await host.evaluate((n) => window.__jjTest.until({ car: n.car, metric: 'gatesPassed', min: n.gates + 1 }, 6000), { car, gates });
    assert.equal(u.held, true, `gate ${gates + 1} is reached within 100 s`);
    const r = await race(host, car);
    gates += 1;
    assert.equal(r.gatesPassed, gates, `exactly one gate per crossing: ${JSON.stringify(r)}`);
    anchors.push(r.anchorRoutePoint);
    if (r.laps >= 1) break;
    assert.ok(gates < 80, 'the lap closes after one loop of gates');
    if (gates === 8) {
      await wait(host, () => /Lap 1\/2/.test(document.querySelector('.hud-tile .hud-lap')?.textContent ?? ''));
      await shot(host, 'tv-lap1-midway');
    }
  }
  // Anchors are the gates' route points: strictly rising by the gate spacing, wrapping past the route's end exactly once
  // (the first gate is the finish line, the lap ends when it has been round them all and back through the line).
  const steps = anchors.slice(1).map((a, k) => a - anchors[k]);
  const spacing = Math.max(...steps);
  assert.equal(steps.filter((s) => s < 0).length, 1, `the route's end is crossed once: ${steps}`);
  assert.ok(steps.filter((s) => s > 0).every((s) => s <= spacing && s >= spacing - 4), `each gate is the next along the route: ${steps}`);
  assert.equal(new Set(anchors).size, anchors.length, `no gate repeated inside the lap: ${anchors}`);
  assert.equal(anchors.at(-1), finishLine, 'the lap closes on the finish line, the gate it opened with');

  // The counter and HUD moved on: lap 2 of 2, on the seat and on the tile.
  assert.equal((await race(host, car)).laps, 1);
  await wait(host, () => window.__jjRoom.view().seats[0].laps === 1);
  await host.evaluate(() => window.__jjTest.step(30));
  await wait(host, () => /Lap 2\/2/.test(document.querySelector('.hud-tile .hud-lap')?.textContent ?? ''), undefined, 15_000).catch(async (e) => {
    throw new Error(`the HUD says ${JSON.stringify(await hud(host))}: ${e.message}`);
  });
  await shot(host, 'tv-lap2-hud');

  // R106: no checkpoint in the world or on the page.
  const world = await host.evaluate(() => ({ kit: Object.keys(window.__jjRender.map().kit), text: document.body.innerText, html: document.body.innerHTML }));
  const graphics = world.kit.filter((k) => /check|gate(?!way)|marker|flag|hoop|ring/i.test(k));
  assert.deepEqual(graphics, [], `no gate or checkpoint model among the map's draws (R106): ${graphics}`);
  assert.ok(world.kit.includes('wayfinding/finish-gantry'), 'the finish line is the race-banner gantry');
  assert.doesNotMatch(world.text, /checkpoint/i, 'no checkpoint text on the TV');
  assert.doesNotMatch(world.html, /checkpoint/i, 'no checkpoint element or label');
  assert.deepEqual(errors, []);
});
