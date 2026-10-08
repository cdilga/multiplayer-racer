// P1-C07 personal controller settings, through a real host and a real phone page (WebRTC: run on eris).
//   node --test web/tests/journeys/c07-settings.test.mjs   (JJ_CHROMIUM_GPU=1 on eris)
// Menu{open} is checked without knowing the wire encoding: the Help card (the tutorial, C06) already sends Menu{true} on
// open and Menu{false} on close, so the bytes it puts on the cmd channel are the reference the Settings sheet must match.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';


// `JJ_CAPTURE_DIR=<dir>`: save the visual self-review matrix there (eris.sh points it into the run dir).
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};
const SIZES = { 'phone-portrait-390x844': [390, 844], 'phone-landscape-844x390': [844, 390], 'tv-1920x1080': [1920, 1080] };
/** Capture at each device size, then back to where it was (a resize with the state kept). */
const matrix = async (page, name, back) => {
  if (!CAPTURE) return;
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await shot(page, `${name}-${label}`);
  }
  await page.setViewportSize(back);
  await page.waitForTimeout(300);
  await shot(page, `${name}-resized-back`);
};

const BASE = '/p/c07/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c07'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

/** A host plus one phone that has joined and has the tutorial skipped. `init` runs on the phone before its page. */
async function seated(init) {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    // Record every cmd-channel message (hex) so Menu{open} can be compared byte for byte.
    window.__cmds = [];
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (d) {
      if (this.label === 'cmd' || this.label.includes('cmd')) window.__cmds.push([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''));
      return send.call(this, d);
    };
  });
  if (init) await page.addInitScript(init);
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await shot(page, 'c07-play-screen-with-settings-button-844x390');
  return { host, page, ctx, joinUrl };
}

const prefs = (page) => page.evaluate(() => window.__jjSettings.inspect().prefs);
const openSettings = async (page) => {
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.waitForSelector('[data-overlay=settings]');
};
const pick = (page, name, v) => page.locator(`[data-set=${name}][data-v=${v}]`).click();

test('settings persist across reloads, camera distance included; remember off forgets them', { timeout: 150_000 }, async () => {
  const { page, joinUrl } = await seated();
  assert.equal((await prefs(page)).layout, 'floating', 'defaults to floating sticks');
  await openSettings(page);
  await pick(page, 'layout', 'fixed');
  await pick(page, 'steering', 'direct');
  await pick(page, 'cameraDistance', 'far');
  await page.locator('[data-toggle=reducedMotion]').click();
  await matrix(page, 'c07-settings', { width: 844, height: 390 });
  await page.getByRole('button', { name: 'Save and back to driving' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'reduced', 'reduced motion uses the kit tokens');
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'playing');
  const p = await prefs(page);
  assert.deepEqual([p.layout, p.steering, p.cameraDistance, p.reducedMotion], ['fixed', 'direct', 'far', true]);
  assert.equal((await page.evaluate(() => window.__jjController.inspect())).cameraDistance, 'far', 'the session carries the camera distance');
  // Remember off: applied now, record removed, defaults after a reload.
  await openSettings(page);
  await page.locator('[data-toggle=remember]').click();
  assert.equal((await prefs(page)).remember, false);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('jj.prefs.')).length), 0, 'no saved record');
  await page.getByRole('button', { name: 'Save and back to driving' }).click();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'playing');
  const d = await prefs(page);
  assert.deepEqual([d.layout, d.steering, d.cameraDistance, d.remember], ['floating', 'gentle', 'host', true]);
});

test('invalid stored values use the defaults, field by field', { timeout: 120_000 }, async () => {
  const { page, joinUrl } = await seated();
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('jj.ctl.'));
    const realm = k.split('.')[2];
    localStorage.setItem(`jj.prefs.${realm}`, JSON.stringify({ v: 1, layout: 'sideways', steering: 'direct', vibration: 'yes' }));
  });
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'playing');
  const p = await prefs(page);
  assert.deepEqual([p.layout, p.steering, p.vibration], ['floating', 'direct', true]);
});

test('with storage denied the controller still plays and says the settings are applied for now', { timeout: 120_000 }, async () => {
  const { page } = await seated(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
  });
  assert.equal((await page.evaluate(() => window.__jjController.inspect())).phase, 'playing');
  await openSettings(page);
  await pick(page, 'steering', 'direct');
  assert.equal((await prefs(page)).steering, 'direct', 'applied in memory');
  await page.locator('[data-note=save-failed]').waitFor();
  await page.locator('[data-note=save-failed]').scrollIntoViewIfNeeded();
  await shot(page, 'c07-settings-storage-denied-844x390');
  assert.match(await page.locator('[data-note=save-failed]').innerText(), /Applied for now — this browser couldn't remember your settings/);
});

test('opening Settings sends neutral and Menu{open:true}; closing sends Menu{open:false}; no action fires', { timeout: 120_000 }, async () => {
  const { host, page } = await seated();
  // The reference bytes: the Help card's open and close (Menu is a 3-byte message: version, tag, bool; a Ping is longer).
  const menus = (from) => page.evaluate((n) => window.__cmds.slice(n).filter((c) => c.length === 6 && c.startsWith('010a')), from); // Menu is variant 10 (Ready and Tutorial are as short)
  const m0 = await page.evaluate(() => window.__cmds.length);
  await page.getByRole('button', { name: /^Help/ }).click();
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  const menuTrue = (await menus(m0)).at(-1);
  const m1 = await page.evaluate(() => window.__cmds.length);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  const menuFalse = (await menus(m1)).at(-1);
  assert.ok(menuFalse && menuTrue && menuTrue !== menuFalse, 'reference Menu{true} and Menu{false} captured');
  const before = await page.evaluate(() => ({ n: window.__cmds.length, actions: window.__jjController.inspect().stats.actions }));
  const hostEvents = (await host.evaluate(() => window.__jjRoom.events().length));
  await openSettings(page);
  await wait(page, (n) => window.__cmds.length > n, before.n);
  const opened = await page.evaluate((n) => window.__cmds.slice(n), before.n);
  assert.ok(opened.includes(menuTrue), 'Menu{open:true} sent on opening');
  const drive = await page.evaluate(() => window.__jjController.inspect().drive);
  assert.deepEqual([drive.steer, drive.throttle, drive.brake], [0, 0, 0], 'neutral while the sheet is open');
  const mid = await page.evaluate(() => window.__cmds.length);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await wait(page, (n) => window.__cmds.length > n, mid);
  const closed = await page.evaluate((n) => window.__cmds.slice(n), mid);
  assert.ok(closed.includes(menuFalse), 'Menu{open:false} sent on closing');
  assert.equal(await page.evaluate(() => window.__jjSettings.inspect().open), false);
  assert.equal((await page.evaluate(() => window.__jjController.inspect().stats.actions)) - before.actions, 0, 'no action fired');
  const fired = await host.evaluate((n) => window.__jjRoom.events().slice(n).filter((e) => /Wheelie|Oi|Utility|Boost/i.test(JSON.stringify(e.event))).length, hostEvents);
  assert.equal(fired, 0, 'the host saw no wheelie, boost or utility');
});

test("'Test these controls' shows live stick values and fires no action", { timeout: 120_000 }, async () => {
  const { page } = await seated();
  await openSettings(page);
  const before = await page.evaluate(() => window.__jjController.inspect().stats.actions);
  await page.getByRole('button', { name: 'Test these controls' }).click();
  await page.waitForSelector('[data-col=drive] .zone');
  await shot(page, 'c07-test-controls-844x390');
  // Drag the test DRIVE stick hard right, then pull it hard back (the gesture that would fire a wheelie in the race).
  const drag = (to) =>
    page.evaluate((to) => {
      const z = document.querySelector('[data-col=drive] .zone');
      const r = z.getBoundingClientRect();
      const fire = (t, x, y) => z.dispatchEvent(new PointerEvent(t, { pointerId: 7, bubbles: true, clientX: x, clientY: y, isPrimary: true }));
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      fire('pointerdown', cx, cy);
      fire('pointermove', cx + to.x, cy + to.y);
    }, to);
  await drag({ x: 200, y: 0 });
  const right = await page.evaluate(() => window.__jjSettings.inspect().test);
  assert.ok(right.drive.x > 0.5, `live value shown (${right.drive.x})`);
  await shot(page, 'c07-test-controls-live-844x390');
  assert.match(await page.locator('[data-read]').innerText(), /Drive x 0\.[5-9]|Drive x 1\.00/);
  await page.evaluate(() => document.querySelector('[data-col=drive] .zone').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })));
  await drag({ x: 0, y: 200 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('[data-col=drive] .zone').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })));
  const c = await page.evaluate(() => window.__jjController.inspect());
  assert.equal(c.stats.actions - before, 0, 'no action fired');
  assert.deepEqual([c.drive.steer, c.drive.throttle, c.drive.brake], [0, 0, 0], 'the room saw neutral');
});

test("the camera distance goes to the host: Far shows on that seat's tile in the race, Host's puts it back", { timeout: 240_000 }, async () => {
  const { host, page } = await seated();
  const distanceEvents = () => host.evaluate(() => window.__jjRoom.events().filter((e) => e.event?.CameraDistanceSet).map((e) => e.event.CameraDistanceSet));
  const seat = await host.evaluate(() => window.__jjRoom.view().seats[0].seat);
  await openSettings(page);
  await pick(page, 'cameraDistance', 'far');
  await wait(host, () => window.__jjRoom.events().some((e) => e.event?.CameraDistanceSet?.distance === 'Far'), undefined, 10_000);
  assert.deepEqual((await distanceEvents()).at(-1), { seat, distance: 'Far' }, 'the host got Far for this seat');
  await page.getByRole('button', { name: 'Save and back to driving' }).click();
  // A race: the seat's tile uses its own distance.
  await page.locator('[data-act=ready]').click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await wait(host, () => window.__jjRender?.cameras()?.[1]?.distance === 'far', undefined, 20_000);
  // Back to the host's own.
  await openSettings(page);
  await pick(page, 'cameraDistance', 'host');
  await wait(host, () => window.__jjRender.cameras()[1].distance !== 'far', undefined, 20_000);
  assert.equal((await distanceEvents()).at(-1).distance, 'Host');
});
