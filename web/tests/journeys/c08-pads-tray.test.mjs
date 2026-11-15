// Council round 3 (fable round-2 finding 4): six pads on a phone made the players' tray 450 px tall on a 412 px screen, with
// 2 of 7 rows visible and nothing reachable past them. Past two players the driving screen's tray folds to a line of seat
// badges and "All N players", which opens the full list as a scrolling sheet: every row's Leave can be reached, at 915x412
// landscape and 390x844 portrait. Real host room, real join, emulated Gamepad API on the phone. Headless Chromium.
//   node --test web/tests/journeys/c08-pads-tray.test.mjs      (JJ_CAPTURE_DIR=<dir> saves the self-review captures)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';

const CAPTURE = process.env.JJ_CAPTURE_DIR;
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};

const BASE = '/p/c08tray/';
let browser;
let server;
before(async () => {
  server = await serve(build('./', `c08tray${process.env.JJ_BUILD_SUFFIX ?? ''}`), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

const PADS = () => {
  window.__pads = [];
  navigator.getGamepads = () => window.__pads;
  window.__padAdd = (i) => {
    window.__pads[i] = { index: i, id: `Test pad ${i}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.dispatchEvent(new Event('gamepadconnected'));
  };
  window.__padSet = (i, axes) => {
    if (window.__pads[i]) window.__pads[i].axes = axes;
  };
};

/** Where the tray and its parts sit, and whether a thumb at each part's centre lands on it. */
const layout = (page) => page.evaluate(() => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; };
  const hit = (e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); };
  const tray = document.querySelector('.hub-tray');
  const rows = [...tray.querySelectorAll('.hub-row')];
  const expand = tray.querySelector('[data-expand]');
  return { vw: innerWidth, vh: innerHeight, tray: box(tray), rows: rows.length, badgesShown: rows.filter((r) => { const b = r.querySelector('.hub-badge'); const t = tray.getBoundingClientRect(); const x = b.getBoundingClientRect(); return x.height > 0 && x.top >= t.top - 1 && x.bottom <= t.bottom + 1 && x.bottom <= innerHeight; }).length, expand: expand && getComputedStyle(expand).display !== 'none' ? { hit: hit(expand), text: expand.textContent } : null, open: tray.hasAttribute('data-open') };
});

/** In the open sheet: each pad row's Leave, scrolled to, is on the screen and takes the tap. */
const leavesReachable = (page) => page.evaluate(async () => {
  const out = [];
  // The list repaints when a row changes (its path, its state), so each button is looked up afresh.
  const leave = (i) => document.querySelectorAll('.hub-tray .hub-row [data-act=leave]')[i];
  for (let i = 0; leave(i); i++) {
    leave(i).scrollIntoView({ block: 'nearest' });
    await new Promise((r) => requestAnimationFrame(r));
    const b = leave(i);
    const r = b.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out.push(r.top >= 0 && r.bottom <= innerHeight && b.contains(at) ? true : `${Math.round(r.top)}..${Math.round(r.bottom)} hits ${at?.className}`);
  }
  return out;
});

test('six pads and the touch player on a phone: the tray fits the driving screen and every Leave is reachable, landscape and portrait', { timeout: 600_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 180_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  await ctx.addInitScript(PADS);
  await ctx.addInitScript(() => { try { localStorage.setItem('jj.tutorial', 'done'); } catch { /* */ } });
  const page = await ctx.newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjSources && window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill('Davo');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(page);
  for (const sel of ['[data-act=tut-skip]', '[data-act=skip]']) {
    const el = page.locator(sel).first();
    if (await el.count() && await el.isVisible()) await el.click().catch(() => {});
  }
  // Two players: the tray keeps its full rows (nothing folds early).
  await page.evaluate(() => window.__padAdd(0));
  await page.evaluate(() => window.__padSet(0, [0, 0, 1, 0]));
  await wait(page, () => window.__jjSources.inspect().filter((s) => s.kind === 'pad' && s.seat !== null).length === 1);
  await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0]));
  await page.waitForTimeout(300);
  const two = await layout(page);
  assert.equal(two.expand, null, `two players: no fold (${JSON.stringify(two)})`);
  // Five more pads, one press each: seven players on this phone.
  for (let i = 1; i < 6; i++) {
    await page.evaluate((i) => { window.__padAdd(i); window.__padSet(i, [0, 0, 1, 0]); }, i);
    await wait(page, (n) => window.__jjSources.inspect().filter((s) => s.kind === 'pad' && s.seat !== null).length === n, i + 1);
    await page.evaluate((i) => window.__padSet(i, [0, 0, 0, 0]), i);
  }
  await page.waitForTimeout(600);
  for (const [label, w, h] of [['landscape-915x412', 915, 412], ['portrait-390x844', 390, 844]]) {
    // Joining asks for full screen (play mode); a full-screen window can't be resized.
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen().catch(() => {}));
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(800);
    const folded = await layout(page);
    await shot(page, `c08-tray-7-folded-${label}`);
    assert.equal(folded.rows, 7, `${label}: seven rows, none dropped`);
    assert.ok(folded.tray.top >= 0 && folded.tray.bottom <= folded.vh, `${label}: the tray is on the screen (${JSON.stringify(folded.tray)})`);
    assert.ok(folded.tray.h <= folded.vh * 0.3, `${label}: the folded tray leaves the sticks their room (${folded.tray.h} of ${folded.vh} px)`);
    assert.equal(folded.badgesShown, 7, `${label}: every seat badge shows (${JSON.stringify(folded)})`);
    assert.ok(folded.expand?.hit && /All 7 players/.test(folded.expand.text), `${label}: "All 7 players" takes a tap (${JSON.stringify(folded.expand)})`);
    await page.locator('[data-expand]').click();
    await wait(page, () => document.querySelector('.hub-tray')?.hasAttribute('data-open'));
    await page.waitForTimeout(300);
    const open = await layout(page);
    await shot(page, `c08-tray-7-open-${label}`);
    assert.ok(open.tray.top >= 0 && open.tray.bottom <= open.vh, `${label}: the sheet is on the screen (${JSON.stringify(open.tray)})`);
    const leaves = await leavesReachable(page);
    assert.deepEqual(leaves, [true, true, true, true, true, true], `${label}: every pad's Leave is reachable`);
    await page.evaluate(() => document.querySelector('.hub-tray').scrollTo(0, 1e6));
    await shot(page, `c08-tray-7-open-scrolled-${label}`);
    await page.locator('[data-expand]').click();
    await wait(page, () => !document.querySelector('.hub-tray')?.hasAttribute('data-open'));
  }
  assert.equal((await page.evaluate(() => window.__jjSources.inspect())).length, 7, 'nothing left: the sheet only showed');
});
