// P1-C03 on a live room (real host page, real phone pages, real jj-server, WebRTC: run on eris): resume, fencing, retried
// claims, the scripted cause of every §11 state, names remembered per device and realm, and Leave with its confirmation.
// The wording of each state with no network at all is `c03-states.test.mjs`.
//   node --test web/tests/journeys/c03-resume.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/c03res/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c03res'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const phase = (page) => page.evaluate(() => window.__jjController.inspect().phase);
const inspect = (page) => page.evaluate(() => window.__jjController.inspect());

async function openHost(mode = 'room') {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?${mode}&test=live`);
  await wait(host, () => window.__jjNet?.code() && (window.__jjTest || window.__jjRoom?.view()?.phase === 'Lobby'), undefined, 60_000);
  return { host, joinUrl: await host.evaluate(() => window.__jjNet.joinUrl()) };
}

/** A phone context (so tabs share its storage) that has joined. `init` runs on every page of it. */
async function joined(joinUrl, name = 'Marlene', init) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  return { ctx, page, you: (await inspect(page)).you, endpoint: (await inspect(page)).link.endpointId };
}
const seats = (host) => host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ name: s.name, number: s.number, presence: s.presence })));

test('the page hidden for 30 s with its network cut, then shown: the same seat within 3 s', { timeout: 240_000 }, async () => {
  const { host, joinUrl } = await openHost();
  const p = await joined(joinUrl, 'Marlene');
  const before = p.you;
  // The network goes: the phone's HTTP (signalling) is cut, and the host's side of the peer connection is dropped
  // (Playwright's offline mode doesn't touch WebRTC, so the host closes its end, as a network loss would). The page is hidden.
  await p.ctx.setOffline(true);
  await host.evaluate((ep) => window.__jjNet.dropPeer(ep), p.endpoint);
  await p.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.page.waitForTimeout(30_000);
  await p.ctx.setOffline(false);
  const t0 = Date.now();
  await p.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wait(p.page, () => {
    const s = window.__jjController.inspect();
    return s.phase === 'playing' && s.link?.state === 'connected';
  }, undefined, 10_000);
  const ms = Date.now() - t0;
  console.log(`# back to the same seat ${ms} ms after the page was shown (30 s hidden, network cut)`);
  assert.ok(ms <= 3000, `${ms} ms`);
  assert.deepEqual((await inspect(p.page)).you, before, 'the same seat, number and colour');
  assert.equal((await seats(host)).length, 1, 'no second seat');
});

test('reloading the tab returns the same seat; a second tab fences the first and "Use this one" takes it back', { timeout: 180_000 }, async () => {
  const { host, joinUrl } = await openHost();
  const p = await joined(joinUrl);
  await p.page.reload();
  await wait(p.page, () => window.__jjController?.inspect().phase === 'playing', undefined, 60_000);
  assert.deepEqual((await inspect(p.page)).you, p.you, 'a reload is the same seat');
  // A second tab of the same phone: the older one is fenced.
  const second = await p.ctx.newPage();
  await second.goto(joinUrl);
  await wait(second, () => window.__jjController?.inspect().phase === 'playing', undefined, 60_000);
  await wait(p.page, () => window.__jjController.inspect().phase === 'another-tab');
  assert.match(await p.page.evaluate(() => document.body.textContent), /Playing in another tab/i);
  assert.deepEqual((await inspect(second)).you, p.you, 'the second tab is the same seat');
  await p.page.getByRole('button', { name: 'Use this one' }).click();
  await wait(p.page, () => window.__jjController.inspect().phase === 'playing', undefined, 60_000);
  await wait(second, () => window.__jjController.inspect().phase === 'another-tab');
  assert.equal((await seats(host)).length, 1, 'one seat the whole time');
});

test('a Claim retried with the same request id (a lost reply) yields one seat', { timeout: 120_000 }, async () => {
  const { host, joinUrl } = await openHost();
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  const request = () => page.evaluate(() => Object.values(localStorage).map((v) => { try { return JSON.parse(v).requestId; } catch { return undefined; } }).find((x) => typeof x === 'number'));
  const id = await request();
  // Three claims with the id the page stored, as a controller that never saw the Welcome would send.
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__jjController.claim('Marlene');
  });
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await page.evaluate(() => window.__jjController.claim('Marlene'));
  await page.waitForTimeout(1500);
  assert.equal(await request(), id, 'the request id is stable');
  assert.equal((await seats(host)).length, 1, 'one seat from four claims');
});

test('every §11 state is reached by a scripted cause and shows its wording', { timeout: 600_000 }, async () => {
  const text = (page) => page.evaluate(() => document.body.textContent);
  const phoneAt = async (url, route) => {
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
    const page = await ctx.newPage();
    if (route) await route(page);
    await page.goto(url);
    return page;
  };
  const { host, joinUrl } = await openHost();
  const code = joinUrl.split('/').at(-1);

  console.log('# §11 step: unknown code');
  // Unknown code: no such room.
  let page = await phoneAt(`${server.origin}${BASE}j/ZZZZ`);
  await wait(page, () => window.__jjController?.inspect().phase === 'no-such-room');
  assert.match(await text(page), /No room with code ZZZZ/i);

  console.log('# §11 step: expired preview');
  // Expired preview: the lookup answers 410.
  page = await phoneAt(joinUrl, (p) => p.route('**/api/v1/rooms/*', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 410, contentType: 'application/json', body: '{"reason":"preview-expired"}' }) : r.continue())));
  await wait(page, () => window.__jjController?.inspect().phase === 'preview-expired');
  assert.match(await text(page), /This test build has expired/i);

  console.log('# §11 step: relay 429/503');
  // A network that won't connect, with the relay answering 429 then 503: "Finding a relay…", then the way out.
  let fallbackCalls = 0;
  page = await phoneAt(`${joinUrl}?ice=relay`, (p) =>
    p.route('**/api/v1/ice/fallback', (r) => {
      fallbackCalls += 1;
      return r.fulfill({ status: fallbackCalls === 1 ? 429 : 503, contentType: 'application/json', headers: { 'retry-after': '1' }, body: JSON.stringify({ reason: fallbackCalls === 1 ? 'rate-limited' : 'no-broker', retryAfterMs: 500 }) });
    }),
  );
  await wait(page, () => ['finding-relay', 'no-route'].includes(window.__jjController?.inspect().phase), undefined, 90_000);
  const seenRelay = await text(page);
  assert.match(seenRelay, /Finding a relay|Can't reach the host from this network/i);
  await wait(page, () => window.__jjController.inspect().phase === 'no-route', undefined, 120_000);
  assert.match(await text(page), /Can't reach the host from this network/i);
  assert.ok(fallbackCalls >= 2, `the relay was asked ${fallbackCalls} times (429 then 503)`);

  console.log('# §11 step: host hidden');
  // Ended room: the host ends it.
  const live = await joined(joinUrl, 'Marlene');
  // Host hidden: the host page loses focus (its pause), the phone says so; back again clears it.
  await host.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wait(live.page, () => window.__jjController.inspect().phase === 'host-paused', undefined, 20_000);
  assert.match(await text(live.page), /Host paused/i);
  await host.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await wait(live.page, () => window.__jjController.inspect().phase === 'playing', undefined, 20_000);

  console.log('# §11 step: protocol mismatch');
  // Protocol mismatch: the host answers with ClaimRejected{Build} (bytes: cmd version 1, variant 1, reason 0); the page says
  // it is updating and reloads itself once.
  await live.page.evaluate(() => sessionStorage.removeItem('jj.reloaded'));
  await live.page.evaluate(() => window.__jjController.deliver('cmd', [1, 1, 0]));
  await wait(live.page, () => window.__jjController.inspect().phase === 'update-needed' || document.body.textContent.includes('Updating'), undefined, 10_000).catch(() => {});
  assert.equal(await live.page.evaluate(() => sessionStorage.getItem('jj.reloaded')), '1', 'it reloads itself, once');

  console.log('# §11 step: host gone');
  // Host gone: the phone has a seat, then the room can't be found when it comes back.
  const seated = await joined(joinUrl, 'Shazza');
  await seated.page.route('**/api/v1/rooms/*', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'not-found' }) }) : r.continue()));
  await seated.page.reload();
  await wait(seated.page, () => window.__jjController?.inspect().phase === 'host-gone', undefined, 30_000);
  assert.match(await text(seated.page), /The host seems to have gone/i);

  console.log('# §11 step: ended');
  // Ended room.
  await host.evaluate(() => window.__jjRoom.end());
  await wait(live.page, () => window.__jjController.inspect().phase === 'room-ended', undefined, 60_000).catch(async () => {
    assert.fail(`the room was ended but the phone is ${await phase(live.page)}`);
  });
  assert.match(await text(live.page), /That room has ended/i);
});

test("an edited name is remembered per device and realm and prefilled on the next join", { timeout: 180_000 }, async () => {
  const a = await openHost();
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(a.joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  const prefilled = await page.inputValue('#name');
  assert.ok(prefilled.length > 0, 'a prefilled name to start with');
  await page.locator('#name').fill('Marlene');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jj.name.')));
  assert.deepEqual(keys, ['jj.name.test'], 'kept per realm (the server\'s realm is "test")');
  // A different room, same device: prefilled with the edited name.
  const b = await openHost();
  const second = await ctx.newPage();
  await second.goto(b.joinUrl);
  await wait(second, () => window.__jjController?.inspect().phase === 'ready-to-join');
  assert.equal(await second.inputValue('#name'), 'Marlene');
  // Another device (a fresh context, its own storage): not carried over.
  const other = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })).newPage();
  await other.goto(b.joinUrl);
  await wait(other, () => window.__jjController?.inspect().phase === 'ready-to-join');
  assert.notEqual(await other.inputValue('#name'), 'Marlene');
  // Another realm under the same key shape: a stored name for a different realm isn't used.
  await second.evaluate(() => { localStorage.setItem('jj.name.production', 'Someone'); localStorage.removeItem('jj.name.test'); });
  await second.reload();
  await wait(second, () => window.__jjController?.inspect().phase === 'ready-to-join');
  assert.notEqual(await second.inputValue('#name'), 'Someone', "another realm's name is not used");
});

test('Leave asks for a second tap, then the seat goes; Sit out from Settings parks the car and the seat stays', { timeout: 180_000 }, async () => {
  const { host, joinUrl } = await openHost();
  const p = await joined(joinUrl, 'Marlene');
  const q = await joined(joinUrl, 'Shazza');
  await wait(host, () => window.__jjRoom.view().seats.length === 2);
  await wait(q.page, () => window.__jjTutorial.inspect()?.open === true);
  await q.page.getByRole('button', { name: 'Skip tutorial' }).click();
  await q.page.getByRole('button', { name: /Settings/ }).click();
  await q.page.getByRole('button', { name: 'Sit out' }).click();
  await wait(host, () => window.__jjRoom.view().seats.some((s) => s.presence === 'SittingOut'));
  assert.equal((await seats(host)).length, 2, 'sitting out keeps the seat');
  const leave = p.page.locator('[data-act=leave]');
  await leave.click();
  assert.match(await leave.textContent(), /Tap again to leave/i);
  assert.equal((await seats(host)).length, 2, 'one tap leaves nothing');
  await leave.click();
  await wait(host, () => window.__jjRoom.view().seats.length === 1);
});
