// br-8h3u.14 (owner 2026-10-24: "host UI so that someone can choose to add bots from the host"): the host adds bots from
// Host menu → Bots, sets each one's skill and an L-plater, and sets a player's learner level from the Players list. One
// controller (synthetic, through the host's test surface, the frames a phone sends) joins and readies; the bots never
// hold up the start; a real 1-lap race finishes with the bots spread across the field, marked as bots in the lobby, the
// positions strip and the results.
//   node --test web/tests/journeys/bots-lplates.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/bots/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'bots'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const view = (host) => host.evaluate(() => window.__jjRoom.view());
const shot = async (page, name) => {
  if (!process.env.JJ_CAPTURE_DIR) return;
  mkdirSync(process.env.JJ_CAPTURE_DIR, { recursive: true });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${process.env.JJ_CAPTURE_DIR}/${name}.jpg`, quality: 85 });
};

test('the host adds bots and L-plates from the menu; one player and the bots race a lap', { timeout: 900_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  await frame(host, 'syn1', { hello: true });
  await frame(host, 'syn1', { claim: 'Ava' });
  await wait(host, () => window.__jjRoom.view().seats.length === 1);

  // Host menu → Bots: four bots, Easy, Easy (an L-plater on Lots), Normal, Hard.
  await host.getByRole('button', { name: 'Host menu', exact: true }).click();
  await host.getByRole('button', { name: 'Bots', exact: true }).click();
  assert.match(await host.locator('[data-bots-view]').innerText(), /No bots/);
  for (let n = 1; n <= 4; n++) {
    await host.getByRole('button', { name: 'Add a bot', exact: true }).click();
    await wait(host, (n) => window.__jjRoom.view().botList?.length === n, n);
  }
  const setBot = async (index, act, want) => {
    for (let guard = 0; guard < 3; guard++) {
      const now = await host.evaluate(([i, act]) => window.__jjRoom.view().botList[i][act === 'bot-skill' ? 'skill' : 'assist'], [index, act]);
      if (now === want) return;
      await host.locator(`[data-bots] [data-act=${act}][data-index="${index}"]`).click();
      await wait(host, ([i, act, now]) => window.__jjRoom.view().botList[i][act === 'bot-skill' ? 'skill' : 'assist'] !== now, [index, act, now]);
    }
  };
  await setBot(0, 'bot-skill', 0);
  await setBot(1, 'bot-skill', 0);
  await setBot(1, 'bot-assist', 2);
  await setBot(3, 'bot-skill', 2);
  assert.deepEqual((await view(host)).botList.map((b) => [b.skill, b.assist]), [[0, 0], [0, 2], [1, 0], [2, 0]]);
  assert.equal(await host.locator('[data-bots] li').count(), 4, 'every bot listed');
  assert.equal(await host.locator('[data-bots] [data-act=bot-assist].primary').count(), 1, 'the L-plater stands out');
  await shot(host, 'bots-page');
  // A fifth, then removed again: the list closes up.
  await host.getByRole('button', { name: 'Add a bot', exact: true }).click();
  await wait(host, () => window.__jjRoom.view().botList?.length === 5);
  await host.locator('[data-bots] [data-act=bot-remove][data-index="4"]').click();
  await wait(host, () => window.__jjRoom.view().botList?.length === 4);
  await host.getByRole('button', { name: 'Back', exact: true }).click();

  // The player's learner level from the Players list: Off → Some.
  const lp = host.locator('[data-players] [data-act=seat-assist]');
  assert.match(await lp.innerText(), /L · Off/);
  await lp.click();
  await wait(host, () => window.__jjRoom.view().seats[0].assist === 1);
  await wait(host, () => document.querySelector('[data-players] [data-act=seat-assist]')?.textContent?.includes('Some'));
  await shot(host, 'host-menu-players');
  await host.getByRole('button', { name: 'Close', exact: true }).click();

  // The lobby shows the bots after the seat, marked, with the L-plater's plate.
  await wait(host, () => document.querySelectorAll('.lb-roster .lcard.bot').length === 4);
  assert.equal(await host.locator('.lb-roster .lcard.bot .mn-lp').count(), 1);
  await shot(host, 'lobby');

  // The one player readies: the bots have no Ready and don't hold the start.
  await frame(host, 'syn1', { ready: true });
  await wait(host, () => ['Countdown', 'Running'].includes(window.__jjRoom.view().phase));
  assert.equal((await host.evaluate(() => window.__jjTest.observe())).cars.length, 5, 'the seat and four bots on the grid');
  await wait(host, () => window.__jjRoom.view().phase === 'Running');
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  // Mid-race the positions strip lists the bots among the seat, marked.
  await wait(host, () => document.querySelectorAll('.fp-item.bot').length === 4, undefined, 60_000);
  await shot(host, 'race');
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 600_000);
  const v = await view(host);
  assert.equal(v.results.length, 1);
  assert.equal(v.botResults.length, 4);
  const places = [...v.results.map((r) => r.place), ...v.botResults.map((b) => b.place)].filter((p) => p > 0);
  assert.ok(places.length >= 4, `the field finishes: ${JSON.stringify(v.botResults)}`);
  assert.equal(new Set(places).size, places.length, `one car to a place: ${places}`);
  const placeOf = (i) => v.botResults[i].place || 99;
  assert.ok(placeOf(3) < Math.max(placeOf(0), placeOf(1)), `the Hard bot beats an Easy one: ${JSON.stringify(v.botResults)}`);
  await wait(host, () => document.querySelectorAll('[data-results] [data-bot]').length === 4);
  assert.equal(await host.locator('[data-results] [data-bot] .bot-tag').count(), 4, 'bots marked in the results');
  await shot(host, 'results');
  assert.deepEqual(errors, []);
});

// The Bots page, the Players list and the lobby at a laptop and a phone-size host (portrait and landscape): six bots, every
// row's controls reachable, nothing wider than the screen.
test('the Bots page and the lobby fit a laptop and a phone-size host', { timeout: 900_000 }, async () => {
  for (const [width, height] of [[1366, 768], [915, 412], [412, 915]]) {
    const host = await (await browser.newContext({ viewport: { width, height } })).newPage();
    const errors = [];
    host.on('pageerror', (e) => errors.push(e.message));
    await host.goto(`${server.origin}${BASE}host?room&test=live`);
    await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
    await frame(host, 'syn1', { hello: true });
    await frame(host, 'syn1', { claim: 'Ava' });
    await wait(host, () => window.__jjRoom.view().seats.length === 1);
    await host.getByRole('button', { name: 'Host menu', exact: true }).click();
    await host.getByRole('button', { name: 'Bots', exact: true }).click();
    for (let n = 1; n <= 6; n++) {
      await host.getByRole('button', { name: 'Add a bot', exact: true }).click();
      await wait(host, (n) => window.__jjRoom.view().botList?.length === n, n);
    }
    await host.locator('[data-bots] [data-act=bot-assist][data-index="2"]').click();
    await wait(host, () => window.__jjRoom.view().botList[2].assist === 1);
    const fits = () => host.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    assert.ok(await fits(), `${width}x${height}: the Bots page is no wider than the screen`);
    // Each bot's row keeps its controls on one line (an L-plater's row once wrapped Remove under the rest at 412 px).
    const tall = await host.evaluate(() => [...document.querySelectorAll('[data-bots] li')].map((li) => li.getBoundingClientRect().height));
    assert.ok(Math.max(...tall) < Math.min(...tall) * 1.3, `${width}x${height}: bot rows are one line each: ${tall}`);
    for (const b of await host.locator('[data-bots] .btn').all()) {
      await b.scrollIntoViewIfNeeded();
      assert.ok(await b.isVisible(), `${width}x${height}: every bot control is reachable`);
    }
    await shot(host, `bots-page-${width}x${height}`);
    await host.getByRole('button', { name: 'Back', exact: true }).click();
    await shot(host, `host-menu-${width}x${height}`);
    await host.getByRole('button', { name: 'Close', exact: true }).click();
    await wait(host, () => document.querySelectorAll('.lb-roster .lcard.bot').length === 6);
    assert.ok(await fits(), `${width}x${height}: the lobby is no wider than the screen`);
    await shot(host, `lobby-${width}x${height}`);
    assert.deepEqual(errors, []);
    await host.close();
  }
});
