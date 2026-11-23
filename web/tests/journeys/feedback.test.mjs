// Player feedback (br-1s9h, owner 2026-11-23): the TV's footer Feedback button and the phone's "Send feedback" open the
// shared sheet and send to the owner's inbox, with the TV's picture; the phone's picture is taken and uploaded by the TV.
// The inbox host is stubbed in every context here (the sheet's script comes from lib/games-feedback-widget.js), so
// nothing is ever posted to the real one from a test run.
//   AC1  the footer button overlaps no other footer item at TV, laptop and phone-host sizes; the sheet's picture of the
//        world is not blank; the room isn't paused and no menu opens.
//   AC2  the phone's sheet at iPhone SE to Pro Max sizes (Chromium and WebKit); the TV uploads its own frame for it.
//   AC3  the details sent (build, room, connection, phase).
//   AC4  no request to the inbox host before somebody asks to give feedback.
//   node --test web/tests/journeys/feedback.test.mjs   (JJ_CAPTURE_DIR=<dir> keeps screenshots)
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';

const BASE = '/p/fbk/';
const INBOX = 'https://games-feedback.dilger.dev';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const WIDGET = readFileSync(join(import.meta.dirname, 'lib', 'games-feedback-widget.js'), 'utf8');
let server;
let browser;
let safari;

before(async () => {
  server = await serve(build('./', 'fbk'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  safari = await webkit.launch();
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await safari?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);
closeContextsAfterEach(() => safari);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = async (page, name) => CAPTURE && page.screenshot({ path: join(CAPTURE, `${name}.png`) });

/** Stands in for the inbox in one browser context; returns what that context's pages asked of it. */
async function stubInbox(ctx, who) {
  const seen = { who, script: 0, posts: [], shots: [] };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-upload-token', 'access-control-allow-methods': 'POST, OPTIONS' };
  await ctx.route(`${INBOX}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/widget.js') {
      seen.script += 1;
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: WIDGET });
    }
    if (req.method() === 'POST' && url.pathname === '/api/feedback') {
      seen.posts.push(req.postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ id: `fb_test_${who}`, upload: { token: `token-${who}` } }) });
    }
    const m = /^\/api\/feedback\/([^/]+)\/shot$/.exec(url.pathname);
    if (req.method() === 'POST' && m) {
      seen.shots.push({ id: m[1], slot: url.searchParams.get('slot'), token: req.headers()['x-upload-token'], type: req.headers()['content-type'], bytes: req.postDataBuffer()?.length ?? 0 });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
    }
    return route.fulfill({ status: 404, headers: cors, body: 'not stubbed' });
  });
  return seen;
}

async function openHost(viewport) {
  const ctx = await browser.newContext({ viewport });
  const inbox = await stubInbox(ctx, 'tv');
  const host = await ctx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 90_000);
  return { host, inbox, errors };
}

/** Whether the footer's Feedback button stays inside the footer and the window, clear of every other thing on the page. */
const footerAudit = (host) =>
  host.evaluate(() => {
    const foot = document.querySelector('.jj-foot');
    const btn = foot.querySelector('[data-act=feedback]');
    const b = btn.getBoundingClientRect();
    const f = foot.getBoundingClientRect();
    const hits = (r) => r.width > 0 && r.height > 0 && r.left < b.right - 0.5 && r.right > b.left + 0.5 && r.top < b.bottom - 0.5 && r.bottom > b.top + 0.5;
    const bad = [];
    if (btn.hidden || b.width < 20 || b.height < 12) bad.push(`not shown (${Math.round(b.width)}x${Math.round(b.height)})`);
    if (b.left < f.left - 0.5 || b.right > Math.min(f.right, innerWidth) + 0.5 || b.top < f.top - 0.5 || b.bottom > Math.min(f.bottom, innerHeight) + 0.5) bad.push(`outside the footer: ${JSON.stringify([b.left, b.top, b.right, b.bottom].map(Math.round))} in ${JSON.stringify([f.left, f.top, f.right, f.bottom].map(Math.round))}`);
    for (const el of foot.children) {
      if (el !== btn && getComputedStyle(el).display !== 'none' && hits(el.getBoundingClientRect())) bad.push(`over ${el.className || el.nodeName}`);
    }
    // Nothing outside the footer sits on it either (the mute button, a caption, a docked card).
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (top !== btn) bad.push(`covered by ${top?.className || top?.nodeName}`);
    // And it is in the footer's band, never over a tile, the lobby or the results.
    for (const el of document.querySelectorAll('.hud-tile, .lobby, .results')) if (hits(el.getBoundingClientRect())) bad.push(`over ${el.className}`);
    return bad;
  });

/** How many clearly different colours the sheet's picture has (a blank frame has one). */
const thumbColours = (page) =>
  page.evaluate(async () => {
    const img = document.querySelector('.gfb-thumb');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return seen.size;
  });

for (const [w, h] of [[1920, 1080], [1280, 720], [844, 390], [390, 844]]) {
  test(`TV ${w}x${h}: the footer's Feedback covers nothing`, { timeout: 180_000 }, async () => {
    const { host, inbox, errors } = await openHost({ width: w, height: h });
    assert.deepEqual(await footerAudit(host), [], 'in the Lobby');
    assert.equal(inbox.script, 0, 'nothing is asked of the inbox host until somebody gives feedback');
    await shot(host, `tv-${w}x${h}-lobby`);
    assert.deepEqual(errors, []);
  });
}

test('TV: Feedback opens the sheet with a picture of the world and sends it; the room carries on', { timeout: 240_000 }, async () => {
  const { host, inbox, errors } = await openHost({ width: 1280, height: 720 });
  const code = await host.evaluate(() => window.__jjNet.code());
  // A keyboard player, so a round runs behind the sheet.
  await host.bringToFront();
  await host.keyboard.down('KeyW');
  await wait(host, () => window.__jjRoom.view().seats.length === 1);
  await host.keyboard.up('KeyW');
  await host.locator('[data-local-use="1"]').click();
  await wait(host, () => window.__jjRoom.view().seats[0].choosing === false);
  await host.keyboard.press('KeyE', { delay: 250 });
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);
  assert.deepEqual(await footerAudit(host), [], 'in a race');
  await shot(host, 'tv-1280x720-race');
  const before = await host.evaluate(() => window.__jjTest.pauseReasons());
  await host.locator('.jj-foot [data-act=feedback]').click();
  await host.locator('[data-gfb=sheet]').waitFor({ timeout: 20_000 });
  assert.equal(inbox.script, 1, 'the sheet came from the (stubbed) inbox host');
  await shot(host, 'tv-1280x720-sheet');
  assert.ok(await host.locator('[data-gfb=include-shot]').isChecked(), 'a picture was taken and is ticked');
  assert.ok((await thumbColours(host)) > 3, 'the picture of the world is not one flat colour');
  const listed = await host.locator('[data-gfb=details]').innerText();
  for (const word of ['jammers', 'Build', code, 'Running', 'Renderer', 'the big screen']) assert.ok(listed.includes(word), `the details list ${word}: ${listed}`);
  assert.deepEqual(await host.evaluate(() => window.__jjTest.pauseReasons()), before, 'the round is not paused for feedback');
  assert.equal(await host.evaluate(() => window.__jjChrome.state.menu), false, 'no host menu opened');
  // Typing in the sheet is not driving: W here must not add a seat.
  await host.locator('[data-gfb=message]').fill('TEST the wheels are square');
  await host.keyboard.type(' www');
  await host.locator('[data-gfb=send]').click();
  await host.locator('[data-gfb=thanks]').waitFor();
  assert.equal(inbox.posts.length, 1);
  const post = inbox.posts[0];
  assert.equal(post.game, 'jammers');
  assert.equal(post.surface, 'tv');
  assert.equal(post.kind, 'bug');
  assert.equal(post.message, 'TEST the wheels are square www');
  assert.match(post.build, /^fbk \(/, 'the build names the preview');
  assert.equal(post.debug.Room, code);
  assert.equal(post.debug.Mode, 'race');
  for (let i = 0; i < 100 && inbox.shots.length === 0; i += 1) await host.waitForTimeout(100);
  assert.deepEqual(inbox.shots.map((s) => [s.id, s.slot, s.token, s.type]), [['fb_test_tv', 'tv', 'token-tv', 'image/jpeg']]);
  assert.ok(inbox.shots[0].bytes > 2000, `a real JPEG went up (${inbox.shots[0].bytes} bytes)`);
  assert.equal(await host.evaluate(() => window.__jjRoom.view().seats.length), 1, 'typing claimed no seat');
  assert.deepEqual(errors, []);
});

test("phone: Send feedback in the settings sheet sends with the TV's picture, taken and uploaded by the TV", { timeout: 240_000 }, async () => {
  const { host, inbox: tv, errors } = await openHost({ width: 1280, height: 720 });
  const code = await host.evaluate(() => window.__jjNet.code());
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const phone = await stubInbox(ctx, 'phone');
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(page);
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await confirmInitialVehicle(page);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  assert.equal(phone.script + tv.script, 0, 'nothing is asked of the inbox host until somebody gives feedback');
  await page.locator('[data-act=settings]').click();
  const btn = page.locator('.settings-body [data-act=feedback]');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.locator('[data-gfb=sheet]').waitFor({ timeout: 20_000 });
  await wait(page, () => document.querySelector('[data-gfb=include-tv]')?.closest('[data-tv]')?.dataset.tv === 'ready', undefined, 20_000);
  await shot(page, 'phone-844x390-sheet');
  assert.equal(await host.locator('[data-gfb=root]').count(), 0, "the TV shows nothing while a phone's sheet is open");
  const listed = await page.locator('[data-gfb=details]').innerText();
  for (const word of ['jammers', 'Build', code, 'Connection', 'direct', 'a phone', 'Seat']) assert.ok(listed.includes(word), `the details list ${word}: ${listed}`);
  await page.locator('[data-gfb-kind=idea]').click();
  await page.locator('[data-gfb=message]').fill('TEST more sausage rolls');
  await page.locator('[data-gfb=send]').click();
  await page.locator('[data-gfb=thanks]').waitFor();
  assert.equal(phone.posts.length, 1);
  assert.equal(phone.posts[0].surface, 'phone');
  assert.equal(phone.posts[0].kind, 'idea');
  assert.equal(phone.posts[0].debug.Room, code);
  assert.deepEqual(phone.shots, [], 'the phone uploads no picture itself');
  for (let i = 0; i < 100 && tv.shots.length === 0; i += 1) await host.waitForTimeout(100);
  assert.deepEqual(tv.shots.map((s) => [s.id, s.slot, s.token, s.type]), [['fb_test_phone', 'tv', 'token-phone', 'image/jpeg']], "the TV added its picture to the phone's feedback");
  assert.ok(tv.shots[0].bytes > 2000, `a real JPEG went up (${tv.shots[0].bytes} bytes)`);
  assert.equal(tv.posts.length, 0);
  assert.equal(await host.locator('[data-gfb=root]').count(), 0);
  // The settings sheet is still there behind it, and the seat is still seated.
  await page.locator('[data-gfb=root]').waitFor({ state: 'detached', timeout: 10_000 });
  assert.equal(await page.locator('.settings-body').count(), 1);
  assert.equal(await host.evaluate(() => window.__jjRoom.view().seats.length), 1);
  // Cancelled feedback is dropped: the TV uploads nothing more.
  await page.locator('.settings-body [data-act=feedback]').click();
  await wait(page, () => document.querySelector('[data-gfb=include-tv]')?.closest('[data-tv]')?.dataset.tv, undefined, 20_000);
  await page.locator('[data-gfb=cancel]').click();
  assert.equal(await page.locator('[data-gfb=root]').count(), 0);
  await host.waitForTimeout(500);
  assert.equal(tv.shots.length, 1);
  assert.deepEqual([...errors, ...pageErrors], []);
});

// iPhone SE, 15, Pro Max, upright and sideways, in both engines: the sheet fits, its buttons are on screen, and words go in.
const PHONES = [[375, 667], [667, 375], [393, 852], [852, 393], [430, 932], [932, 430], [320, 568]];
for (const [engine, launcher] of [['chromium', () => browser], ['webkit', () => safari]]) {
  for (const [w, h] of PHONES) {
    test(`phone ${engine} ${w}x${h}: the sheet opens from Settings, fits and takes words`, { timeout: 90_000 }, async () => {
      const ctx = await launcher().newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: engine === 'chromium', deviceScaleFactor: 2 });
      const inbox = await stubInbox(ctx, 'phone');
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${server.origin}${BASE}j/ABCD#state=playing&round=racing`);
      await page.waitForFunction(() => document.documentElement.dataset.jjController === 'ready');
      const upright = page.locator('[data-act=upright]');
      if (await upright.isVisible().catch(() => false)) await upright.click();
      await page.locator('[data-act=settings]').click();
      const btn = page.locator('.settings-body [data-act=feedback]');
      await btn.scrollIntoViewIfNeeded();
      const covered = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top === el || el.contains(top) ? null : (top?.className ?? 'nothing');
      });
      assert.equal(covered, null, 'Send feedback is reachable in the settings sheet');
      await btn.tap();
      await page.locator('[data-gfb=sheet]').waitFor({ timeout: 20_000 });
      await shot(page, `phone-${engine}-${w}x${h}`);
      const fit = await page.evaluate(async () => {
        const bad = [];
        const panel = document.querySelector('[data-gfb=sheet]').getBoundingClientRect();
        if (panel.left < 0 || panel.right > innerWidth + 0.5 || panel.top < 0 || panel.bottom > innerHeight + 0.5) bad.push(`panel ${JSON.stringify([panel.left, panel.top, panel.right, panel.bottom].map(Math.round))} in ${innerWidth}x${innerHeight}`);
        for (const name of ['message', 'send', 'cancel', 'add-photo']) {
          const el = document.querySelector(`[data-gfb=${name}]`);
          el.scrollIntoView({ block: 'nearest' });
          await new Promise((r) => requestAnimationFrame(() => r()));
          const r = el.getBoundingClientRect();
          if (r.top < -0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(`${name} off screen`);
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!(top === el || el.contains(top))) bad.push(`${name} covered by ${top?.className ?? 'nothing'}`);
          if (name !== 'message' && r.height < 43.5) bad.push(`${name} is ${Math.round(r.height)} px tall`);
        }
        if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('the page scrolls sideways');
        return bad;
      });
      assert.deepEqual(fit, []);
      await page.locator('[data-gfb=message]').fill('TEST from a small phone');
      await page.locator('[data-gfb=send]').tap();
      await page.locator('[data-gfb=thanks]').waitFor();
      assert.equal(inbox.posts.length, 1);
      assert.equal(inbox.posts[0].surface, 'phone');
      assert.equal(inbox.posts[0].message, 'TEST from a small phone');
      assert.equal(inbox.posts[0].debug.Room, 'ABCD');
      assert.deepEqual(errors, []);
    });
  }
}

test("phone: when the inbox can't be reached the button says so and the game carries on", { timeout: 60_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  await ctx.route(`${INBOX}/**`, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto(`${server.origin}${BASE}j/ABCD#state=playing&round=racing`);
  await page.waitForFunction(() => document.documentElement.dataset.jjController === 'ready');
  await page.locator('[data-act=settings]').click();
  const btn = page.locator('.settings-body [data-act=feedback]');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForFunction(() => /can’t be reached/.test(document.querySelector('.settings-body [data-act=feedback]')?.textContent ?? ''), undefined, { timeout: 15_000 });
  assert.equal(await page.locator('[data-gfb=root]').count(), 0);
  assert.equal(await page.locator('.settings-body').count(), 1);
});
