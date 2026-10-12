import { confirmInitialVehicle } from './lib/vehicle.mjs';
// P1-W01.3: item offers and failures through the real Rust/WASM worker + WebRTC controller.
// Sanga uses real dominance; W02 projectile, W04 stations and W05 presentation remain separate acceptance.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const ID = 'w01-item-queue';
const BASE = `/p/${ID}/`;
let server, browser;
before(async () => {
  server = await serve(build('./', ID), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test('W01/W03: real pickups fill the FIFO; Sanga ACTION consumes the front; failed boomerang ACTION retains it; round end resets it', { timeout: 120_000 }, async () => {
  const host = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=99`);
  await host.waitForFunction(() => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  const url = await host.evaluate(() => window.__jjNet.joinUrl());
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const phone = await ctx.newPage();
  await phone.goto(url);
  await phone.waitForFunction(() => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  await phone.waitForFunction(() => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(phone);
  await phone.getByRole('button', { name: 'Skip tutorial' }).click();
  await phone.getByRole('button', { name: /^Ready/ }).click();
  await host.waitForFunction(() => window.__jjRoom.view().phase === 'Running');
  await host.evaluate(async () => {
    await window.__jjTest.hold(true);
    await window.__jjTest.step(240);
  });
  const car = await host.evaluate(() => window.__jjTest.observe().then((o) => o.host.seats.find((s) => s.car !== null).car));
  const offer = (item) => host.evaluate(({ car, item }) => window.__jjTest.command({ cmd: 'pickupItem', car, item }), { car, item });
  assert.equal((await offer('sanga')).accepted, true);
  assert.equal((await offer('boomerang')).accepted, true);
  const full = await offer('sanga');
  assert.equal(full.accepted, false);
  assert.equal(full.reason, 'full');
  await host.evaluate(() => window.__jjTest.step(1));
  await phone.waitForFunction(() => window.__jjController.inspect().inventory.front === 'sanga' && window.__jjController.inspect().inventory.back === 'boomerang');
  const picked = await host.evaluate(() => window.__jjTest.observe());
  assert.equal(picked.items.events.length, 2, 'a full queue does not consume a third box');
  assert.equal((await phone.evaluate(() => window.__jjController.inspect())).lastItemEvent.item, 'boomerang');

  await phone.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: -1, touch: true }));
  await phone.waitForTimeout(300);
  await host.evaluate(() => window.__jjTest.step(2));
  await phone.waitForFunction(() => window.__jjController.inspect().inventory.front === 'boomerang' && window.__jjController.inspect().inventory.back === null);
  const used = await host.evaluate(() => window.__jjTest.observe());
  assert.equal(used.items.effects.length, 1, 'a real physical buff exists');
  assert.equal(used.items.effects[0].item, 'sanga');
  assert.equal(used.items.effects[0].expires_at - used.items.effects[0].started, 720, 'six seconds from the card');
  assert.equal(used.cars.find((c) => c.car === car).sanga.remainingTicks, used.items.effects[0].expires_at - used.tick, 'timer follows the exact simulation tick');
  assert.equal((await phone.evaluate(() => window.__jjController.inspect())).lastItemEvent.kind.Used.direction, 'Forward');
  assert.equal(used.debris.length, picked.debris.length, 'Sanga never substitutes a cone');
  await phone.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
  await phone.waitForTimeout(300);
  await host.evaluate(() => window.__jjTest.step(30));
  await phone.waitForTimeout(300);
  await phone.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 1, touch: true }));
  await phone.waitForTimeout(300);
  await host.evaluate(() => window.__jjTest.step(2));
  await phone.waitForFunction(() => window.__jjController.inspect().itemUseRefusal === 'unavailable');
  await phone.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
  const refused = await host.evaluate(() => window.__jjTest.observe());
  assert.deepEqual((await phone.evaluate(() => window.__jjController.inspect())).inventory, { front: 'boomerang', back: null });
  assert.equal(refused.items.refusals.length, 1);
  assert.equal(refused.items.effects.length, 1, 'a missing projectile handler adds no effect');
  assert.equal(refused.debris.length, picked.debris.length, 'a held item does not substitute a cone');

  await host.evaluate(async () => {
    await window.__jjTest.command({ cmd: 'finishRace' });
    await window.__jjTest.step(2);
  });
  await host.waitForFunction(() => window.__jjRoom.view().phase === 'Intermission');
  await phone.waitForFunction(() => window.__jjController.inspect().inventory.front === null && window.__jjController.inspect().inventory.back === null);
  await ctx.close();
  await host.close();
});
