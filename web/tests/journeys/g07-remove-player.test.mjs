// P1-G07: the host removes a player, through the real host page and synthetic controllers (no WebRTC; the host page's test
// surface feeds their hello, claim and ready frames). In the Lobby the host opens the menu's player list, removes a
// player after the confirmation and the seat's card goes; then in a race the host removes a connected player from the
// pause menu: the seat leaves the room view at a tick boundary and its tile reflows. Captures go to $JJ_CAPTURE_DIR
// (default docs/evidence/P1-G07). A controller cannot send RemoveSeat: the controller protocol has no such message, and
// the host's command sent as controller bytes is refused and counted (`a_controller_cannot_remove_a_seat`, native, in CI).
// A real phone's "The host removed you" screen and Join again are in g07-join-again.test.mjs.
//   node --test web/tests/journeys/g07-remove-player.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/g07/';
const CAPTURE = process.env.JJ_CAPTURE_DIR ?? resolve(import.meta.dirname, '../../../docs/evidence/P1-G07');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'g07'), BASE, { JJ_STUN_URLS: '' });
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
const seats = (host) => host.evaluate(() => window.__jjRoom.view().seats.map((s) => s.number));

async function join(host, from, to) {
  for (let k = from; k <= to; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
  }
  await wait(host, (n) => window.__jjRoom.view().seats.length === n, to);
}

async function openHost(width, height) {
  const host = await (await browser.newContext({ viewport: { width, height } })).newPage();
  host.errors = [];
  host.on('pageerror', (e) => host.errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=2`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  return host;
}

test('G07: the host removes a player in the lobby, after a confirmation naming them; backing out keeps them', { timeout: 300_000 }, async () => {
  const host = await openHost(1920, 1080);
  try {
    await join(host, 1, 4);
    await host.waitForSelector('.lcard');
    assert.equal(await host.locator('.lcard').count(), 4);
    // The card opens the confirmation; Keep them closes it and nothing changes.
    await host.locator('.lcard[data-number="3"]').click();
    assert.match(await host.locator('[data-confirm=remove]').innerText(), /remove #3 racer 3/i);
    await host.screenshot({ path: `${CAPTURE}/lobby-confirm-remove@1080p.png` });
    await host.getByRole('button', { name: 'Keep them' }).click();
    await host.keyboard.press('Escape');
    assert.deepEqual(await seats(host), [1, 2, 3, 4]);
    // The menu's player list removes.
    await host.locator('[data-act=menu]').click();
    await host.locator('[data-players] li[data-number="3"] [data-act=ask-remove]').click();
    await host.getByRole('button', { name: 'Remove player' }).click();
    await wait(host, () => window.__jjRoom.view().seats.every((s) => s.number !== 3), null, 10_000);
    assert.deepEqual(await seats(host), [1, 2, 4], 'the card goes; the others keep their numbers');
    await host.keyboard.press('Escape');
    assert.equal(await host.locator('.lcard').count(), 3);
    await host.screenshot({ path: `${CAPTURE}/lobby-after-remove@1080p.png` });
    // Idempotent: the seat is gone, asking again for it does nothing harmful.
    await host.evaluate(() => window.__jjTest.input({ type: 'ui', ui: 'remove-seat:3' }));
    assert.deepEqual(await seats(host), [1, 2, 4]);
    // Rejoin is a fresh claim: a new seat number, never #3 again.
    await frame(host, 'syn5', { hello: true });
    await frame(host, 'syn5', { claim: 'Racer 5' });
    await wait(host, () => window.__jjRoom.view().seats.length === 4);
    assert.ok(!(await seats(host)).includes(3), 'a fresh claim gets a new number, never #3 again');
    assert.deepEqual(host.errors, []);
  } finally {
    await host.context().close();
  }
});

test('G07: the host removes a connected player mid-race from the pause menu; the tile goes, the others race on', { timeout: 300_000 }, async () => {
  const host = await openHost(1920, 1080);
  try {
    await join(host, 1, 4);
    for (let k = 1; k <= 4; k++) await frame(host, `syn${k}`, { ready: true });
    await wait(host, () => window.__jjRoom.view().phase === 'Running');
    await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
    await wait(host, () => document.querySelectorAll('.hud-tile[data-seat]').length === 4);
    // Racer 2's bumper comes off before the removal: debris, a dynamic body of the world.
    const car2 = await host.evaluate(() => window.__jjRoom.view().seats.find((s) => s.number === 2).car);
    await host.evaluate((car) => window.__jjTest.command({ cmd: 'damage', car, part: 'front', health: 0 }), car2);
    await wait(host, async () => (await window.__jjTest.observe()).debris.some((d) => d.kind === 'Part'), null, 20_000);
    const debrisBefore = (await host.evaluate(() => window.__jjTest.observe())).debris.filter((d) => d.kind === 'Part').length;
    await host.locator('[data-act=menu]').click();
    await host.locator('[data-players] li[data-number="2"] [data-act=ask-remove]').click();
    assert.match(await host.locator('[data-confirm=remove]').innerText(), /debris stays/i);
    await host.screenshot({ path: `${CAPTURE}/race-confirm-remove@1080p.png` });
    await host.getByRole('button', { name: 'Remove player' }).click();
    await host.getByRole('button', { name: 'Resume' }).click();
    const removedAt = (await host.evaluate(() => window.__jjTest.observe())).tick;
    await wait(host, () => window.__jjRoom.view().seats.every((s) => s.number !== 2), null, 10_000);
    await wait(host, () => document.querySelectorAll('.hud-tile[data-seat]').length === 3);
    assert.deepEqual((await seats(host)).sort(), [1, 3, 4]);
    assert.equal(await host.evaluate(() => window.__jjRoom.view().phase), 'Running', 'the race goes on');
    // The withdrawal hands the car's controls back to neutral over the autopilot's quarter-second (30 ticks) blend: wait on sim
    // ticks, not wall time (a slow host runs fewer in the same second).
    await wait(host, async (t) => (await window.__jjTest.observe()).tick >= t + 45, removedAt, 60_000);
    // Debris stays: the removed car's bumper is still in the world after the removal (the sim's own test asserts it is a dynamic body).
    const after = await host.evaluate(() => window.__jjTest.observe());
    // Withdrawn: no seat owns the car any more and it stops driving (the body stays in the world until S04c's withdrawal rules).
    assert.equal(after.host.seats.some((x) => x.car === car2), false, 'no seat owns the withdrawn car');
    assert.equal(after.cars.find((c) => c.car === car2)?.input?.throttle ?? 0, 0, 'and it no longer drives');
    // Nothing is deleted or merged by the removal (the others, racing on, may shed parts of their own meanwhile: never fewer).
    assert.ok(after.debris.filter((d) => d.kind === 'Part').length >= debrisBefore, "the removed car's debris stays");
    await host.screenshot({ path: `${CAPTURE}/race-after-remove@1080p.png` });
    assert.deepEqual(host.errors, []);
  } finally {
    await host.context().close();
  }
});

test('G07: a disconnected (autopilot) seat removed in the Lobby after a round: its card goes and its standings stay', { timeout: 420_000 }, async () => {
  const host = await openHost(1920, 1080);
  try {
    await join(host, 1, 3);
    for (let k = 1; k <= 3; k++) await frame(host, `syn${k}`, { ready: true });
    await wait(host, () => window.__jjRoom.view().phase === 'Running', null, 120_000);
    // Nobody sends a stick: every seat is a silent one and the autopilot drives. Racer 3 is the one the host removes.
    await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
    await host.waitForTimeout(1500);
    await host.evaluate(() => window.__jjTest.command({ cmd: 'finishRace' }));
    await wait(host, () => window.__jjRoom.view().phase === 'Intermission', null, 120_000);
    const seat3 = await host.evaluate(() => window.__jjRoom.view().seats.find((s) => s.number === 3).seat);
    const rows = await host.evaluate(() => window.__jjRoom.view().standings.map((r) => r.seat).sort());
    assert.equal(rows.length, 3, 'the round gave every seat a standings row');
    assert.ok(rows.includes(seat3));
    await host.getByRole('button', { name: 'Return to lobby' }).click();
    await wait(host, () => window.__jjRoom.view().phase === 'Lobby');
    assert.equal(await host.locator('.lcard').count(), 3);
    await host.locator('[data-act=menu]').click();
    await host.locator('[data-players] li[data-number="3"] [data-act=ask-remove]').click();
    await host.getByRole('button', { name: 'Remove player' }).click();
    await wait(host, () => window.__jjRoom.view().seats.every((s) => s.number !== 3), null, 10_000);
    await host.keyboard.press('Escape');
    assert.equal(await host.locator('.lcard').count(), 2, 'the card goes');
    assert.equal(await host.locator('.lcard[data-number="3"]').count(), 0);
    const kept = await host.evaluate(() => window.__jjRoom.view().standings.map((r) => r.seat).sort());
    assert.deepEqual(kept, rows, "the removed seat's standings row is kept (and nobody else's changed)");
    assert.equal((await host.evaluate(() => window.__jjTest.observe())).cars.length, 0, 'no tile or car in the Lobby');
    assert.deepEqual(host.errors, []);
  } finally {
    await host.context().close();
  }
});

test('G07: the pause menu at eight players on a phone-sized host lists everyone with Remove', { timeout: 300_000 }, async () => {
  const host = await openHost(412, 915);
  try {
    await join(host, 1, 8);
    for (let k = 1; k <= 8; k++) await frame(host, `syn${k}`, { ready: true });
    await wait(host, () => window.__jjRoom.view().phase === 'Running', null, 120_000);
    await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
    await host.locator('[data-act=menu]').click();
    await wait(host, () => document.querySelectorAll('[data-players] li').length === 8);
    assert.equal(await host.locator('[data-players] [data-act=ask-remove]').count(), 8);
    await host.screenshot({ path: `${CAPTURE}/menu-race-8@phone.jpg`, type: 'jpeg', quality: 80 });
    assert.deepEqual(host.errors, []);
  } finally {
    await host.context().close();
  }
});
