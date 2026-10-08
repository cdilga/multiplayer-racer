// P1-C02b: full screen on the phone controller. A real phone joins a real room (loopback WebRTC). The tools row's full-screen
// button enters and leaves full screen and shows the state; the settings sheet's Full screen switch does the same and follows
// fullscreenchange (an exit the page didn't ask for flips it too). Mid-race, losing full screen without asking (the system
// gesture: an exit the page didn't make) shows a small "Back to full screen" prompt; the drive stick still drives under it;
// one tap restores full screen and the prompt goes. Where the Fullscreen API is missing (iPhone Safari; emulated here by
// removing it before the page loads, as the WebKit lane has no phone Safari), the control explains Add to Home Screen instead.
// Captures go to $JJ_CAPTURE_DIR (default docs/evidence/P1-C02b).
//   node --test web/tests/journeys/c02b-fullscreen.test.mjs   (WebRTC: run on eris)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/c02b/';
const CAPTURE = process.env.JJ_CAPTURE_DIR ?? resolve(import.meta.dirname, '../../../docs/evidence/P1-C02b');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c02b'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const fsState = (page) => page.evaluate(() => window.__jjFullscreen.inspect());
const shot = (page, name) => page.screenshot({ path: `${CAPTURE}/${name}.png` });

async function openHost() {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  return host;
}

async function joinPhone(joinUrl, { width, height, noApi = false, name = 'Marlene' }) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width, height } });
  if (noApi)
    await ctx.addInitScript(() => {
      // iPhone Safari: no element full screen for pages.
      delete Element.prototype.requestFullscreen;
      delete Element.prototype.webkitRequestFullscreen;
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true });
    });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  // Joining asks for full screen once (keep awake on): let that land, then start from the windowed state the owner reported.
  if (!noApi) await wait(page, () => !!document.fullscreenElement, undefined, 5_000);
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
  await wait(page, () => !document.fullscreenElement);
  return page;
}

test('C02b: the full-screen toggle (tools and settings) enters and leaves and follows fullscreenchange; a lost full screen mid-race prompts, never blocks', { timeout: 300_000 }, async () => {
  const host = await openHost();
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const page = await joinPhone(joinUrl, { width: 915, height: 412 });
  const btn = page.locator('.tools [data-act=fullscreen]');
  assert.equal((await fsState(page)).mode, 'api');
  // fullscreenchange fires a frame after fullscreenElement clears: wait for the button to hear it.
  await wait(page, () => document.querySelector('.tools [data-act=fullscreen]').getAttribute('aria-pressed') === 'false', undefined, 5_000);
  await shot(page, 'phone-915x412-lobby-windowed');

  // Tools row: in, then out. The player's own exit never prompts.
  await btn.click();
  await wait(page, () => !!document.fullscreenElement);
  await wait(page, () => document.querySelector('.tools [data-act=fullscreen]').getAttribute('aria-pressed') === 'true');
  assert.equal(await btn.getAttribute('aria-label'), 'Exit full screen');
  await shot(page, 'phone-915x412-lobby-fullscreen');
  await btn.click();
  await wait(page, () => !document.fullscreenElement);
  await wait(page, () => document.querySelector('.tools [data-act=fullscreen]').getAttribute('aria-pressed') === 'false');
  assert.deepEqual(await fsState(page).then((s) => [s.lost, s.prompt]), [false, false]);

  // Settings: the switch enters; an exit the page didn't make (the browser's control, a gesture) flips it back.
  await page.locator('[data-act=settings]').click();
  const sw = page.locator('[data-toggle=fullscreen]');
  await sw.scrollIntoViewIfNeeded();
  assert.equal(await sw.getAttribute('aria-checked'), 'false');
  await sw.click();
  await wait(page, () => !!document.fullscreenElement);
  await wait(page, () => document.querySelector('[data-toggle=fullscreen]')?.getAttribute('aria-checked') === 'true');
  await shot(page, 'phone-915x412-settings-fullscreen-on');
  await page.evaluate(() => document.exitFullscreen());
  await wait(page, () => document.querySelector('[data-toggle=fullscreen]')?.getAttribute('aria-checked') === 'false');
  await page.locator('[data-toggle=fullscreen]').click();
  await wait(page, () => !!document.fullscreenElement);
  await page.locator('[data-toggle=fullscreen]').click();
  await wait(page, () => !document.fullscreenElement);
  await page.getByRole('button', { name: 'Save and back to driving' }).click();
  // Out of a race, a lost full screen doesn't prompt.
  assert.equal((await fsState(page)).prompt, false);

  // Race: ready, full screen, then a system exit mid-race.
  await page.locator('.tools [data-act=ready]').click();
  await wait(page, () => window.__jjController.inspect().roomPhase === 'Racing', undefined, 60_000);
  await btn.click();
  await wait(page, () => !!document.fullscreenElement);
  await page.evaluate(() => document.exitFullscreen()); // not the page's own toggle: a gesture or the browser's control
  await wait(page, () => window.__jjFullscreen.inspect().prompt === true);
  await shot(page, 'phone-915x412-race-fullscreen-lost');
  // The prompt sits off the stick bases, and the drive stick drives with it showing.
  const geo = await page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const p = r(document.querySelector('[data-overlay=fs-prompt]'));
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const bases = [...document.querySelectorAll('.zone .base')].map(r);
    const zone = r(document.querySelector('.zone.drive'));
    return { onBase: bases.some((b) => hit(p, b)), zone: { x: zone.left + zone.width * 0.4, y: zone.top + zone.height * 0.5 } };
  });
  assert.equal(geo.onBase, false, 'the prompt covers a stick');
  await page.mouse.move(geo.zone.x, geo.zone.y);
  await page.mouse.down();
  await page.mouse.move(geo.zone.x + 40, geo.zone.y - 40, { steps: 4 });
  const drive = await page.evaluate(() => window.__jjController.inspect().sticks.drive);
  assert.ok(drive.touch && (Math.abs(drive.x) > 0.1 || Math.abs(drive.y) > 0.1), `the stick drives under the prompt: ${JSON.stringify(drive)}`);
  await page.mouse.up();
  // One tap goes back in; the prompt goes.
  await page.getByRole('button', { name: 'Back to full screen' }).click();
  await wait(page, () => !!document.fullscreenElement);
  await wait(page, () => window.__jjFullscreen.inspect().prompt === false);
  await wait(page, () => document.querySelector('.tools [data-act=fullscreen]').getAttribute('aria-pressed') === 'true', undefined, 5_000);
  // Lost again, "Not now" dismisses it without going back in.
  await page.evaluate(() => document.exitFullscreen());
  await wait(page, () => window.__jjFullscreen.inspect().prompt === true);
  await page.getByRole('button', { name: 'Not now' }).click();
  await wait(page, () => window.__jjFullscreen.inspect().prompt === false);
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);

  // Portrait: the prompt fits the upright layout too.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(400);
  if (await page.locator('[data-act=upright]').count()) await page.locator('[data-act=upright]').click();
  await page.locator('.tools [data-act=fullscreen]').click();
  await wait(page, () => !!document.fullscreenElement);
  await page.evaluate(() => document.exitFullscreen());
  await wait(page, () => window.__jjFullscreen.inspect().prompt === true);
  await shot(page, 'phone-412x915-race-fullscreen-lost');
  assert.deepEqual(page.errors, []);
});

test('C02b: where the Fullscreen API is missing (iPhone Safari), the control explains Add to Home Screen; no fake toggle', { timeout: 300_000 }, async () => {
  const host = await openHost();
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const page = await joinPhone(joinUrl, { width: 844, height: 390, noApi: true, name: 'Shazza' });
  assert.equal((await fsState(page)).mode, 'home-screen');
  await page.locator('.tools [data-act=fullscreen]').click();
  await wait(page, () => window.__jjFullscreen.inspect().note === true);
  assert.match(await page.locator('[data-overlay=fs-note]').innerText(), /Add to Home Screen/);
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
  await shot(page, 'phone-844x390-no-api-note');
  await page.getByRole('button', { name: 'Got it' }).click();
  await wait(page, () => window.__jjFullscreen.inspect().note === false);
  await page.locator('[data-act=settings]').click();
  const row = page.locator('[data-row=fullscreen]');
  await row.scrollIntoViewIfNeeded();
  assert.match(await row.innerText(), /Add to Home Screen/);
  assert.equal(await page.locator('[data-toggle=fullscreen]').count(), 0, 'no switch that does nothing');
  await shot(page, 'phone-844x390-no-api-settings');
  // Portrait, small phone.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(400);
  await shot(page, 'phone-375x667-no-api-settings');
  assert.deepEqual(page.errors, []);
});
