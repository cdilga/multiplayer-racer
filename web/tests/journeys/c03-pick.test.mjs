// P1-C03: the lobby's car pick on the wire. A phone's picker tells the host (`Pick{vehicle, open}`), and the TV's lobby shows
// that seat as "Choosing car…" while the picker is open and the car's name once it's picked. Works for any roster size
// (`#roster=N` stands extra cars in on the phone), survives a reload (the saved pick is resent on Welcome), and Ready is
// never behind it. Real host page and phones over WebRTC: run on eris.
//   node --test web/tests/journeys/c03-pick.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/c03pick/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c03pick'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};

async function room() {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  return { host, joinUrl: await host.evaluate(() => window.__jjNet.joinUrl()) };
}
async function phone(joinUrl, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  return { ctx, page };
}
const seatOf = (host, name) => host.evaluate((n) => window.__jjRoom.view().seats.find((s) => s.name === n), name);
const card = async (host, name, want) => {
  // The lobby cards redraw a frame after the room view changes.
  for (const t0 = Date.now(); Date.now() - t0 < 10_000; await host.waitForTimeout(100)) {
    const c = await host.evaluate((n) => {
      const seat = window.__jjRoom.view().seats.find((s) => s.name === n);
      const el = seat && document.querySelector(`.lcard[data-seat="${seat.seat}"]`);
      return el ? { state: el.dataset.state, label: el.querySelector('.lb-state')?.textContent ?? null } : null;
    }, name);
    if (c && (!want || c.state === want)) return c;
  }
  throw new Error(`no ${want ?? ''} lobby card for ${name}`);
};

test('the picker opening is "Choosing car…" on the TV; Done shows the car by name; a long roster and a reload keep working', { timeout: 240_000 }, async () => {
  const { host, joinUrl } = await room();
  const p = await phone(`${joinUrl}#roster=200`, 'Marlene');
  // Not picked yet: the TV says what it has always said.
  await wait(host, () => window.__jjRoom.view().seats.some((s) => s.name === 'Marlene'));
  assert.equal((await card(host, 'Marlene', 'choosing')).state, 'choosing');
  assert.equal((await seatOf(host, 'Marlene')).vehicle ?? null, null);

  // Open the picker: the seat is choosing, with the car being looked at.
  await p.page.getByRole('button', { name: /^Car/ }).click();
  await p.page.locator('[data-overlay=cars]').waitFor();
  await wait(host, () => window.__jjRoom.view().seats.find((s) => s.name === 'Marlene')?.choosing === true);
  assert.equal((await seatOf(host, 'Marlene')).vehicle, 'cruz-missile');
  assert.equal((await card(host, 'Marlene', 'choosing')).label, 'Choosing car…');
  await shot(host, 'c03-pick-tv-choosing-1280x720');
  // Walk to a car far down a 200-car roster: each look reaches the host.
  assert.equal(await p.page.locator('.thumb').count(), 200, 'two hundred cars, no cap');
  // (Two real cars come first (the roster grows, R123), then the stand-ins `test-0`...: index 151 is `test-149`.)
  await p.page.locator('.thumb[data-i="151"]').dispatchEvent('click');
  await wait(host, () => window.__jjRoom.view().seats.find((s) => s.name === 'Marlene')?.vehicle === 'test-149');
  assert.equal((await card(host, 'Marlene', 'choosing')).state, 'choosing', 'still choosing while the picker is open');
  await shot(p.page, 'c03-pick-phone-open-844x390');

  // Done: the pick stands, and the TV names the car.
  await p.page.getByRole('button', { name: 'Done' }).click();
  await wait(host, () => window.__jjRoom.view().seats.find((s) => s.name === 'Marlene')?.choosing === false);
  assert.equal((await card(host, 'Marlene', 'picked')).label, 'Test 149');
  await shot(host, 'c03-pick-tv-picked-1280x720');

  // A reload: the saved pick is told to the host again when the seat comes back (a host that had forgotten would learn it).
  await p.page.goto(`${joinUrl}#roster=200`);
  await wait(p.page, () => window.__jjController?.inspect().phase === 'playing', undefined, 60_000);
  assert.equal((await seatOf(host, 'Marlene')).vehicle, 'test-149');
});

test('Ready is never behind the pick: a seat can be ready without choosing, and picking afterwards leaves it ready', { timeout: 180_000 }, async () => {
  const { host, joinUrl } = await room();
  const p = await phone(joinUrl, 'Shazza');
  await phone(joinUrl, 'Davo'); // a second player who isn't ready keeps the room in the Lobby (everyone ready starts the race)
  await p.page.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => window.__jjRoom.view().seats.find((s) => s.name === 'Shazza')?.ready === true);
  assert.equal((await card(host, 'Shazza', 'ready')).state, 'ready', 'ready with no car picked');
  await p.page.getByRole('button', { name: /^Car/ }).click();
  await wait(host, () => window.__jjRoom.view().seats.find((s) => s.name === 'Shazza')?.choosing === true);
  assert.equal((await seatOf(host, 'Shazza')).ready, true, 'opening the picker un-readies nobody');
  await p.page.getByRole('button', { name: 'Done' }).click();
  await wait(host, () => window.__jjRoom.view().seats.find((s) => s.name === 'Shazza')?.choosing === false);
  const s = await seatOf(host, 'Shazza');
  assert.deepEqual([s.ready, s.vehicle], [true, 'cruz-missile']);
  assert.equal((await card(host, 'Shazza', 'ready')).state, 'ready', 'ready still wins the card');
});
