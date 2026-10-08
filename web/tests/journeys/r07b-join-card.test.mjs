// P1-R07b: the host footer's docked QR opens the big join card. A race runs with enough synthetic seats that no spare grid
// cell holds the QR (html[data-grid-dock~=qr]), so the footer docks it; clicking it pauses the race and shows the kit's paper
// QR card (QR, room code, domain) with the join URL, big and centred. The QR is decoded from the screen and a real phone
// (loopback WebRTC) joins the room from that URL while the race is paused; Resume lifts the pause. The pause menu carries
// the join card too (its QR decodes to the same URL). Then the card is checked at every display mode (TV, desk, handheld,
// auto) and size (1920x1080, 1366x768, a phone host both ways, full screen): on screen, clear of the footer, scannable.
// Captures go to $JJ_CAPTURE_DIR (default docs/evidence/P1-R07b).
//   node --test web/tests/journeys/r07b-join-card.test.mjs   (WebRTC: run on eris)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/r07b/';
const CAPTURE = process.env.JJ_CAPTURE_DIR ?? resolve(import.meta.dirname, '../../../docs/evidence/P1-R07b');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'r07b'), BASE, { JJ_STUN_URLS: '' });
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
const shot = (page, name) => page.screenshot({ path: `${CAPTURE}/${name}.png` });

/** Decodes the QR image under `selector` from a screenshot of the page (what a phone camera would see). */
async function decode(page, selector) {
  const png = PNG.sync.read(await page.locator(selector).first().screenshot());
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
}

/** Synthetic seats join and ready until the race runs and the grid has no spare cell for the QR (it docks in the footer). */
async function raceWithDockedQr(host) {
  let k = 0;
  const add = async () => {
    k++;
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
    await frame(host, `syn${k}`, { ready: true });
  };
  for (let i = 0; i < 4; i++) await add();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  // How many tiles fill the grid depends on the screen: add racers (mid-race joins) until the QR has no cell.
  for (let t0 = Date.now(); !(await host.evaluate(() => /\bqr\b/.test(document.documentElement.dataset.gridDock ?? ''))); ) {
    assert.ok(Date.now() - t0 < 120_000, 'the QR never docked in the footer');
    await add();
    await host.waitForTimeout(800);
  }
  await host.locator('.foot-qr').waitFor({ state: 'visible' });
  return k;
}

/** Layout checks for the open join card: inside the screen, clear of the footer, a whole QR of scannable size. */
async function measure(host) {
  return host.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const card = document.querySelector('[data-join-card=big]');
    const qr = card.querySelector('.qr');
    const foot = r(document.querySelector('.jj-foot'));
    const panel = r(document.querySelector('[data-join-big]'));
    const c = r(card);
    const q = r(qr);
    return {
      inside: panel.left >= -0.5 && panel.top >= -0.5 && panel.right <= innerWidth + 0.5 && panel.bottom <= foot.top + 0.5,
      cardInPanel: c.left >= panel.left - 0.5 && c.right <= panel.right + 0.5 && c.top >= panel.top - 0.5 && c.bottom <= panel.bottom + 0.5,
      panelScroll: document.querySelector('[data-join-big]').scrollHeight - document.querySelector('[data-join-big]').clientHeight,
      qrPx: Math.round(q.width),
      centredX: Math.abs((panel.left + panel.right) / 2 - innerWidth / 2),
      url: document.querySelector('[data-join-big] [data-join-url]')?.textContent ?? null,
      code: card.querySelector('.qr-code')?.textContent ?? null,
      profile: document.documentElement.dataset.profile ?? null,
    };
  });
}

test('R07b: the footer QR pauses and shows the big join card; a phone joins from the decoded QR; Resume resumes; the pause menu has the card', { timeout: 420_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  const code = await host.evaluate(() => window.__jjNet.code());
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const synth = await raceWithDockedQr(host);
  await shot(host, 'tv-1920x1080-race-docked-qr');

  // The footer QR: the race pauses under the big card.
  await host.locator('.foot-qr').click();
  await host.locator('[data-join-big]').waitFor();
  await wait(host, () => window.__jjTest.pauseReasons().length > 0, undefined, 10_000);
  const m = await measure(host);
  assert.equal(m.url, joinUrl, 'the card shows the join URL');
  assert.equal(m.code, code, 'the card shows the room code');
  assert.ok(m.inside && m.cardInPanel, `the card is on screen, clear of the footer: ${JSON.stringify(m)}`);
  assert.ok(m.qrPx >= 400, `big enough to scan from the couch at 1080p (${m.qrPx}px)`);
  await host.waitForTimeout(300);
  await shot(host, 'tv-1920x1080-join-big');
  const decoded = await decode(host, '[data-join-card=big] .qr');
  assert.equal(decoded, joinUrl, 'the big QR carries the join URL');
  // The footer QR toggles it: shut (the race resumes), then open again for the phone.
  await host.locator('.foot-qr').click();
  await wait(host, () => window.__jjTest.pauseReasons().length === 0 && !window.__jjChrome.state.menu, undefined, 10_000);
  await host.locator('.foot-qr').click();
  await host.locator('[data-join-big]').waitFor({ state: 'visible' });
  await wait(host, () => window.__jjTest.pauseReasons().length > 0, undefined, 10_000);

  // A phone joins from what the QR says, while the race is paused.
  const phone = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } })).newPage();
  phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await phone.goto(decoded);
  await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.locator('#name').fill('Davo');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  // The sim takes claims at a tick boundary, and no tick runs while paused: the phone holds at Joining until Resume.
  await phone.waitForTimeout(1500);
  console.log(`# phone while paused: ${await phone.evaluate(() => window.__jjController.inspect().phase)}`);
  await shot(phone, 'phone-915x412-joined-while-paused');

  // Resume closes it, the race goes on, and the phone gets its seat and car.
  await host.getByRole('button', { name: 'Resume' }).click();
  await wait(host, () => window.__jjTest.pauseReasons().length === 0, undefined, 10_000);
  assert.equal(await host.locator('[data-join-big]').isVisible(), false, 'the card closes');
  await wait(phone, () => window.__jjController.inspect().phase === 'playing', undefined, 60_000);
  await wait(host, (n) => window.__jjRoom.view().seats.length === n, synth + 1, 20_000);
  assert.equal(await host.evaluate(() => window.__jjRoom.view().phase), 'Running');
  // Opened again, the card counts the phone. One more racer can free a grid cell for the QR (then the footer has none to
  // press), so this opens it the way the footer does, through the chrome's own surface.
  await host.evaluate(() => window.__jjChrome.openJoin());
  await wait(host, (n) => document.querySelector('[data-join-n]')?.textContent === `${n} in the room`, synth + 1, 10_000);
  await shot(host, 'tv-1920x1080-join-big-after-phone');
  await host.locator('[data-join-big] [data-act=resume]').click();
  await wait(host, () => window.__jjTest.pauseReasons().length === 0 && !window.__jjChrome.state.menu, undefined, 10_000);

  // The pause menu carries the join card too.
  await host.locator('[data-act=menu]').click();
  await host.locator('[data-menu] [data-join-card=menu]').waitFor();
  await wait(host, () => window.__jjTest.pauseReasons().length > 0, undefined, 10_000);
  assert.equal(await host.locator('[data-menu] [data-join-url]').textContent(), joinUrl);
  assert.equal(await decode(host, '[data-join-card=menu] .qr'), joinUrl, 'the menu QR carries the join URL');
  await shot(host, 'tv-1920x1080-pause-menu');
  // Esc closes the menu and the race resumes.
  await host.keyboard.press('Escape');
  await wait(host, () => window.__jjTest.pauseReasons().length === 0, undefined, 10_000);
  assert.deepEqual(errors, []);
});

test('R07b: the big join card fits and scans at every display mode and size, and in full screen', { timeout: 420_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  await raceWithDockedQr(host);
  const sizes = [
    [1920, 1080],
    [1366, 768],
    [915, 412],
    [412, 915],
  ];
  for (const [w, h] of sizes) {
    await host.setViewportSize({ width: w, height: h });
    for (const profile of ['tv', 'desk', 'handheld', 'auto']) {
      // Pick the profile the way a host does: the menu's Display buttons.
      await host.locator('[data-act=menu]').click();
      await host.locator(`[data-act=view][data-profile=${profile}]`).click();
      await host.evaluate(() => window.__jjChrome.closeMenu());
      await host.waitForTimeout(400);
      const dock = await host.evaluate(() => /\bqr\b/.test(document.documentElement.dataset.gridDock ?? ''));
      // Some size/profile pairs find a spare cell for the QR: then the grid holds it and there's no footer QR to press.
      if (dock) await host.locator('.foot-qr').click();
      else await host.evaluate(() => window.__jjChrome.openJoin());
      await host.locator('[data-join-big]').waitFor();
      await host.waitForTimeout(300);
      const m = await measure(host);
      const at = `${w}x${h} ${profile}`;
      assert.ok(m.inside && m.cardInPanel, `${at}: the card is on screen, clear of the footer: ${JSON.stringify(m)}`);
      assert.ok(m.panelScroll <= 1, `${at}: the card panel scrolls (${m.panelScroll}px)`);
      assert.ok(m.centredX <= 2, `${at}: the card is centred (${m.centredX}px off)`);
      assert.equal(await decode(host, '[data-join-card=big] .qr'), joinUrl, `${at}: the QR scans`);
      await shot(host, `join-big-${w}x${h}-${profile}`);
      await host.locator('[data-join-big] [data-act=resume]').click();
      await wait(host, () => !window.__jjChrome.state.menu, undefined, 5_000);
    }
  }
  // Full screen (the menu's button): the card redraws for the new size.
  await host.setViewportSize({ width: 1366, height: 768 });
  await host.locator('[data-act=menu]').click();
  await host.locator('[data-act=view][data-profile=auto]').click();
  await host.locator('[data-act=fullscreen]').click();
  await wait(host, () => !!document.fullscreenElement, undefined, 5_000);
  await host.evaluate(() => window.__jjChrome.closeMenu());
  await host.evaluate(() => window.__jjChrome.openJoin());
  await host.locator('[data-join-big]').waitFor();
  await host.waitForTimeout(300);
  const m = await measure(host);
  assert.ok(m.inside && m.cardInPanel && m.panelScroll <= 1, `full screen: ${JSON.stringify(m)}`);
  assert.equal(await decode(host, '[data-join-card=big] .qr'), joinUrl, 'full screen: the QR scans');
  await shot(host, 'join-big-fullscreen');
  assert.deepEqual(errors, []);
});
