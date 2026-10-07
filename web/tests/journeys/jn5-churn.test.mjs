// Journey JN5 (P1-G02): mixed controllers join and leave through every phase of a round on the real host page
// (`B/host?room&test=live&laps=1`) over WebRTC. Phones and the host's two key clusters fill the Lobby, a phone joins in
// the Countdown, five more drop in mid-race (each timed from its accepted claim to its car moving under its own
// throttle, and each gets its Identify flash and a tile), the room grows to 12, then Leave and Sit out shrink it to 2
// through Intermission. The room never lists a seat that left, nobody is refused and the standings keep their rows.
// Writes the drop-in samples to $JJ_EVIDENCE_DIR/dropin.json (default docs/evidence/P1-G02); `JJ_CAPTURE_DIR=<dir>`
// saves the visual self-review matrix.
//   node --test web/tests/journeys/jn5-churn.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';

const BASE = '/p/jn5/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const EVIDENCE = process.env.JJ_EVIDENCE_DIR ?? resolve(import.meta.dirname, '../../../docs/evidence/P1-G02');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'jn5'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

let step = '';
const at = (name) => {
  step = name;
  console.log(`# ${name}`);
};
const wait = async (page, fn, arg, ms = 30_000) => {
  try {
    return await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  } catch (e) {
    const room = await page.evaluate(() => window.__jjRoom?.view()?.seats.map((s) => `${s.name}:${s.presence}`)).catch(() => null);
    throw new Error(`${step}: ${e.message} ${room ? `seats ${JSON.stringify(room)}` : ''}`);
  }
};
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });
const view = (host) => host.evaluate(() => window.__jjRoom.view());
const observe = (host) => host.evaluate(() => window.__jjTest.observe());
const names = async (host) => (await view(host)).seats.map((s) => s.name).sort();

async function phone(url, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(url);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  const endpoint = await page.evaluate(() => window.__jjController.inspect().link.endpointId);
  // Newcomers get the tutorial in the Lobby; these players skip it.
  await page.getByRole('button', { name: 'Skip tutorial' }).click({ timeout: 2000 }).catch(() => {});
  return { ctx, page, name, endpoint };
}

async function leave(p) {
  // Leave asks for a second tap within 3 s (no browser dialogs).
  const btn = p.page.getByRole('button', { name: /Leave/ });
  await btn.click();
  await btn.click();
}

/** A drop-in: claim accepted (Welcome) → the car moves under the phone's own throttle. Returns ms. */
async function dropIn(host, url, name) {
  const p = await phone(url, name);
  const t0 = Date.now();
  await p.page.evaluate(() => window.__jjController.setSticks({ x: 0, y: -1, touch: true }, { x: 0, y: 0, touch: false }));
  for (;;) {
    const o = await observe(host);
    const seat = o.host.seats.find((s) => s.endpoint === p.endpoint);
    const car = seat && o.cars.find((c) => c.car === seat.car);
    if (car && car.forwardSpeed > 1) break;
    assert.ok(Date.now() - t0 < 15_000, `${name} never drove: ${JSON.stringify(seat)} ${JSON.stringify(car)}`);
    await host.waitForTimeout(25);
  }
  const ms = Date.now() - t0;
  await p.page.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
  return { p, ms };
}

test('JN5: mixed controllers join and leave through every phase, growing to 12 and shrinking to 2', { timeout: 600_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());

  at('Lobby: three phones and both key clusters');
  const phones = [];
  for (const n of ['Davo', 'Shazza', 'Bazza']) phones.push(await phone(joinUrl, n));
  // A key cluster joins on a held key (sampled per frame), as in JN1.
  for (const [k, n] of [['KeyW', 4], ['KeyI', 5]]) {
    await host.keyboard.down(k);
    await wait(host, (n) => window.__jjRoom.view().seats.length === n, n);
    await host.keyboard.up(k);
  }
  await shot(host, 'tv-lobby-5');

  at('Ready: the round starts');
  for (const p of phones) await p.page.getByRole('button', { name: /^Ready/ }).click();
  for (const k of ['KeyE', 'KeyO']) await host.keyboard.press(k, { delay: 250 });
  await wait(host, () => window.__jjRoom.view().phase === 'Countdown');

  at('Countdown: a phone joins and is on the grid');
  phones.push(await phone(joinUrl, 'Kylie'));
  await wait(host, () => window.__jjRoom.view().seats.find((s) => s.name === 'Kylie')?.car !== null);
  await shot(host, 'tv-countdown-6');
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 30_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));

  at('Running: five phones drop in, each timed claim → driving');
  const samples = [];
  for (const n of ['Macca', 'Robbo', 'Gazza', 'Thommo', 'Jonesy']) {
    const { p, ms } = await dropIn(host, joinUrl, n);
    samples.push({ name: n, ms });
    phones.push(p);
    const seat = (await view(host)).seats.find((s) => s.name === n);
    const identified = await host.evaluate((seat) => window.__jjRoom.events().some((e) => e.event.Identify?.seat === seat), seat.seat);
    assert.ok(identified, `${n}'s Identify fired on joining`);
  }
  // Ten phones and two key clusters: 12.
  phones.push(await phone(joinUrl, 'Sheila'));
  await wait(host, () => window.__jjRoom.view().seats.length === 12);
  const rects = await host.evaluate(() => window.__jjRender.tileRects());
  assert.equal(rects.filter(Boolean).length, 12, 'one tile per car: the grid reflowed to 12');
  await shot(host, 'tv-racing-12');
  await shot(phones.at(-2).page, 'phone-dropped-in');
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  console.log(`# drop-in claim → driving: ${JSON.stringify(samples)} p95 ${p95} ms`);
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, 'dropin.json'), `${JSON.stringify({ transport: 'loopback WebRTC (Playwright Chromium)', samples, p95Ms: p95, targetP95Ms: 3000 }, null, 1)}\n`);
  assert.ok(p95 <= 3000, `drop-in p95 ${p95} ms > 3 s`);

  at('Running: two phones leave, a key cluster sits out');
  await leave(phones[0]);
  await leave(phones[1]);
  // The drawer's buttons are dispatched: the round screens may sit over the drawer.
  await host.getByRole('button', { name: 'Sit out' }).first().dispatchEvent('click');
  await wait(host, () => window.__jjRoom.view().seats.length === 10 && window.__jjRoom.view().seats.some((s) => s.presence === 'SittingOut'));
  assert.ok(!(await names(host)).includes('Davo') && !(await names(host)).includes('Shazza'), 'no phantom seats');
  await shot(host, 'tv-racing-after-churn');

  at('Intermission: results and standings');
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 300_000);
  const atResults = await view(host);
  assert.ok(atResults.standings.length >= 9, `standings for everyone who raced: ${atResults.standings.length}`);
  await shot(host, 'tv-intermission');

  at('Intermission: shrink to 2');
  for (const p of phones.slice(2, 8)) await leave(p); // Bazza … Thommo; Jonesy and Sheila stay
  // Both key clusters leave from the drawer (the sitting-out one too).
  // (The drawer rebuilds its rows when a source's state changes, so a click can land on a row just replaced: retry.)
  for (let k = 0; k < 2; k++) {
    const before = (await view(host)).seats.length;
    for (let tries = 0; (await view(host)).seats.length === before; tries++) {
      assert.ok(tries < 10, `a key cluster never left: ${JSON.stringify(await names(host))}`);
      await host.getByRole('button', { name: 'Leave' }).first().dispatchEvent('click');
      await host.waitForTimeout(500);
    }
  }
  await wait(host, () => window.__jjRoom.view().seats.length === 2, undefined, 30_000);
  const end = await view(host);
  assert.deepEqual(end.seats.map((s) => s.name).sort(), ['Jonesy', 'Sheila'], 'the two who stayed');
  assert.equal(end.standings.length, atResults.standings.length, 'the standings keep every row through the churn');
  for (const s of end.seats) assert.notEqual(s.presence, 'Left');
  await shot(host, 'tv-shrunk-2');
  assert.deepEqual(errors, []);
});
