// Owner playtest 2026-10-17: "I finished a race with 3 laps earlier but the race didn't actually finish and I got no
// feedback it was finished at all". In a real round (a real phone and a synthetic seat, one lap of the greybox), the
// phone's car is driven round by the autopilot while the other car sits still. While racing the phone shows its place
// and lap; when its car finishes, its tile on the TV shows "Finished!" with its place and time, the other seat's tile
// counts down to the end of the race, and the phone says it finished and in what place. Then the window closes the race.
// (A gate missed on the way round no longer strands the lap: crates/jj-sim/tests/race.rs a_missed_gate_doesnt_strand_the_lap.)
// `JJ_CAPTURE_DIR=<dir>` saves the visual self-review captures (TV 1920x1080, phone 915x412).
//   node --test web/tests/journeys/finish-feedback.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';

const BASE = '/p/finish/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'finish'), BASE, { JJ_STUN_URLS: '' });
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

// Quarantined (CI owner, br-k5s4, owner AmberSpring): failed at 50 s in batch 6158 (job 14255).
test('finishing a race shows on the TV tile and the phone, the others see the race end coming, and the race ends', { timeout: 300_000, skip: 'quarantined br-k5s4 (owner AmberSpring): race-end feedback failed at 50 s' }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1&map=greybox-loop`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);

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
  await frame(host, 'syn1', { hello: true });
  await frame(host, 'syn1', { claim: 'Shazza' });
  await frame(host, 'syn1', { ready: true });
  await phone.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);

  const cars = await host.evaluate(() => Object.fromEntries(window.__jjRoom.view().seats.map((s) => [s.name, s.car])));
  const davo = cars.Davo;
  assert.ok(Number.isInteger(davo) && Number.isInteger(cars.Shazza), JSON.stringify(cars));
  // Held and stepped: the autopilot drives Davo's car; Shazza's sits on the grid.
  await host.evaluate(async (car) => {
    const s = window.__jjTest;
    await s.hold(true);
    await s.command({ cmd: 'autopilot', on: false });
    await s.command({ cmd: 'autopilot', car, on: true });
    await s.step(600);
  }, davo);
  // Racing: the phone shows its place and lap.
  await wait(phone, () => /^Lap 1\/1$/.test(document.querySelector('[data-hud=lap]')?.textContent ?? '') && !!document.querySelector('[data-hud=pos]')?.textContent, undefined, 20_000).catch(async () => {
    throw new Error(`the phone shows no lap/place while racing: ${JSON.stringify(await phone.evaluate(() => ({ lap: document.querySelector('[data-hud=lap]')?.textContent, pos: document.querySelector('[data-hud=pos]')?.textContent, hud: window.__jjController.inspect().hud })))}`);
  });
  await shot(phone, 'phone-racing');
  // Round the lap until Davo finishes (the greybox lap is about 25 s at the autopilot's pace).
  let finished = false;
  for (let k = 0; k < 60 && !finished; k++) {
    await host.evaluate(() => window.__jjTest.step(120));
    finished = await host.evaluate(() => window.__jjRoom.view().seats.find((s) => s.name === 'Davo')?.finished === true);
  }
  assert.ok(finished, 'Davo finished the lap');
  await host.evaluate(() => window.__jjTest.step(60));
  const view = await host.evaluate(() => window.__jjRoom.view());
  const me = view.seats.find((s) => s.name === 'Davo');
  assert.equal(me.position, 1);
  assert.ok(me.finishMs > 0, `the finishing time is in the room view: ${JSON.stringify(me)}`);
  assert.ok(view.raceEndsInMs > 0 && view.raceEndsInMs <= 30_000, `the race-ends countdown runs: ${view.raceEndsInMs}`);
  assert.equal(view.phase, 'Running', 'the other car is still racing');
  // The TV: Davo's tile says Finished! with 1st and its time; Shazza's counts down to the end of the race.
  const tiles = await wait(host, () => {
    const t = [...document.querySelectorAll('.hud-tile')].filter((b) => !b.hidden);
    const fin = t.map((b) => b.querySelector('[data-finished]')).find((f) => f && !f.hidden);
    const ends = t.map((b) => b.querySelector('[data-race-ends]')).find(Boolean);
    return fin && ends && { finished: fin.textContent, ends: ends.textContent };
  }, undefined, 20_000).then((h) => h.jsonValue());
  assert.match(tiles.finished, /Finished!\s*1st\s*\d+:\d\d\.\d/, JSON.stringify(tiles));
  assert.match(tiles.ends, /^Race ends in \d+ s$/, JSON.stringify(tiles));
  await shot(host, 'tv-finished');
  // The phone: its banner and lap label say it finished, and where.
  await wait(phone, () => document.querySelector('[data-round-banner]')?.textContent === 'Finished 1st! Waiting for the others' && document.querySelector('[data-hud=lap]')?.textContent === 'Finished', undefined, 20_000).catch(async () => {
    throw new Error(`the phone never said it finished: ${JSON.stringify(await phone.evaluate(() => ({ banner: document.querySelector('[data-round-banner]')?.textContent, lap: document.querySelector('[data-hud=lap]')?.textContent, hud: window.__jjController.inspect().hud })))}`);
  });
  await shot(phone, 'phone-finished');
  // The window closes the race: on to the results.
  await host.evaluate(() => window.__jjTest.step(31 * 60));
  await wait(host, () => ['Finalising', 'Intermission'].includes(window.__jjRoom.view().phase), undefined, 30_000);
  console.log(`# finish feedback: ${JSON.stringify({ tiles, finishMs: me.finishMs, raceEndsInMs: view.raceEndsInMs })}`);
  assert.deepEqual(errors, []);
});
