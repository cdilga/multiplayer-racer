// P1-C06 journey: a newcomer's phone in the Lobby (no warm-up drive, R110) is coached through each control by doing
// it: steer, brake/reverse, boost, drift, OI!, cone, wheelie. Each step clears on the gesture; Skip is one tap and
// remembered; Help shows it again; nothing pauses (the room view stays in the Lobby, the host's sim keeps ticking).
//   node --test web/tests/journeys/c06-tutorial.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const BASE = '/p/c06/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c06'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });

async function hostAndPhone() {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  return { host, page, ctx };
}

const sticks = (page, d, a, ms = 120) =>
  page.evaluate(
    async ([d, a, ms]) => {
      window.__jjController.setSticks({ ...d, touch: d.x !== 0 || d.y !== 0 }, { ...a, touch: a.x !== 0 || a.y !== 0 });
      await new Promise((r) => setTimeout(r, ms));
      window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false });
      await new Promise((r) => setTimeout(r, 60));
    },
    [d, a, ms],
  );
const z = { x: 0, y: 0 };
const step = (page) => page.evaluate(() => window.__jjTutorial.inspect().step);
const waitStep = async (page, n) => {
  try {
    await wait(page, (n) => window.__jjTutorial.inspect()?.step === n, n, 10_000);
  } catch (e) {
    const t = await page.evaluate(() => ({ tut: window.__jjTutorial.inspect(), stats: window.__jjController.inspect().stats }));
    throw new Error(`step ${n} never came: ${JSON.stringify(t)}`);
  }
};

test('C06: a newcomer is coached through every control by doing it; nothing pauses', { timeout: 180_000 }, async () => {
  const { host, page, ctx } = await hostAndPhone();
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await shot(page, 'phone-tutorial-step1');
  await sticks(page, { x: 1, y: 0 }, z);
  await sticks(page, { x: -1, y: 0 }, z);
  await shot(page, 'phone-tutorial-step1-won');
  await waitStep(page, 1);
  await shot(page, 'phone-tutorial-step2');
  await sticks(page, { x: 0, y: -1 }, z);
  await sticks(page, { x: 0, y: 1 }, z);
  await waitStep(page, 2);
  await shot(page, 'phone-tutorial-step3-boost');
  await sticks(page, z, { x: 1, y: 0 });
  await waitStep(page, 3);
  await shot(page, 'phone-tutorial-step4-drift');
  await sticks(page, z, { x: -1, y: 0 });
  await waitStep(page, 4);
  await shot(page, 'phone-tutorial-oi');
  await sticks(page, z, { x: 0, y: -1 }, 80);
  await shot(page, 'phone-tutorial-oi-ticked');
  await waitStep(page, 5);
  await shot(page, 'phone-tutorial-step6-cone');
  await sticks(page, z, { x: 0, y: 1 }, 80);
  await waitStep(page, 6);
  await shot(page, 'phone-tutorial-step7-wheelie');
  // The wheelie: pull the left stick all the way back, hold for the preload, let go.
  await sticks(page, { x: 0, y: 1 }, z, 600);
  await waitStep(page, 7);
  await shot(page, 'phone-tutorial-done');
  assert.equal(await host.evaluate(() => window.__jjRoom.view().phase), 'Lobby', 'the tutorial never starts or holds anything');
  assert.equal((await host.evaluate(() => window.__jjTest.observe())).host.pauseMask, 0, 'the host never paused');
  await page.getByRole('button', { name: "Let's race" }).click();
  assert.equal((await page.evaluate(() => window.__jjTutorial.inspect())).open, false);
  // Help shows it again from the start.
  await page.getByRole('button', { name: /Help/ }).click();
  await wait(page, () => window.__jjTutorial.inspect()?.open === true && window.__jjTutorial.inspect().step === 0);
  await shot(page, 'phone-tutorial-help-again');
  await ctx.close();
});

test('C06: Skip is one tap on any step, never blocks Ready, and is remembered', { timeout: 120_000 }, async () => {
  const { host, page } = await hostAndPhone();
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await sticks(page, { x: 1, y: 0 }, z);
  await sticks(page, { x: -1, y: 0 }, z);
  await waitStep(page, 1);
  await shot(page, 'phone-tutorial-before-skip');
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  assert.equal((await page.evaluate(() => window.__jjTutorial.inspect())).open, false);
  await shot(page, 'phone-tutorial-skipped');
  await page.getByRole('button', { name: /^Ready/ }).click();
  await shot(page, 'phone-ready-pressed');
  await wait(host, () => window.__jjRoom.view().seats[0]?.ready === true);
  await page.reload();
  await wait(page, () => window.__jjController?.inspect().phase === 'playing', undefined, 30_000);
  await page.waitForTimeout(1500);
  assert.notEqual((await page.evaluate(() => window.__jjTutorial.inspect()))?.open, true, 'a skipped tutorial stays skipped');
  void step;
});

// The TV side (P1-C06 "shown on the seat's tile and on the controller"): the host detects each control for the seat and
// shows the next one on that seat's tile in the race, clearing it as it sees the control.
const promptOf = (host, n = 0) => host.evaluate((n) => window.__jjRoom.view().seats[n]?.prompt ?? null, n);
const tilePrompt = (host) => host.evaluate(() => [...document.querySelectorAll('.hud-tile [data-prompt]')].filter((e) => !e.hidden).map((e) => e.textContent));
const startRace = async (page, host) => {
  await page.locator('[data-act=ready]').click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
};

test('C06: the host sees each control and the seat\'s tile shows the next one in the race; it never pauses', { timeout: 240_000 }, async () => {
  const { host, page, ctx } = await hostAndPhone();
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await wait(host, () => window.__jjRoom.view().seats[0]?.prompt?.step === 0, undefined, 10_000);
  // The host sees the steer goals as they happen.
  await sticks(page, { x: 1, y: 0 }, z);
  await wait(host, () => window.__jjRoom.view().seats[0].prompt?.done?.includes('right'), undefined, 10_000);
  await sticks(page, { x: -1, y: 0 }, z);
  await wait(host, () => window.__jjRoom.view().seats[0].prompt?.step === 1, undefined, 10_000);
  // The race starts (the card gets out of the way); the tile carries on from the control the host last saw.
  await startRace(page, host);
  await wait(host, () => [...document.querySelectorAll('.hud-tile [data-prompt]')].some((e) => !e.hidden && /Go and stop/.test(e.textContent)), undefined, 20_000);
  await shot(host, 'tv-prompt-go-and-stop-1280x720');
  await sticks(page, { x: 0, y: -1 }, z);
  await sticks(page, { x: 0, y: 1 }, z);
  await wait(host, () => [...document.querySelectorAll('.hud-tile [data-prompt]')].some((e) => !e.hidden && /Boost/.test(e.textContent)), undefined, 20_000);
  await shot(host, 'tv-prompt-boost-1280x720');
  await sticks(page, z, { x: 1, y: 0 });
  await wait(host, () => window.__jjRoom.view().seats[0].prompt?.step === 3, undefined, 10_000);
  assert.deepEqual(await tilePrompt(host).then((t) => t.length), 1, 'one prompt on the one tile');
  assert.equal((await host.evaluate(() => window.__jjTest.observe())).host.pauseMask, 0, 'prompts never paused the host');
  assert.equal(await host.evaluate(() => window.__jjRoom.view().phase), 'Running', 'the race runs on');
  await ctx.close();
});

test('C06: skip hides the TV prompt too, and nothing is shown afterwards', { timeout: 180_000 }, async () => {
  const { host, page } = await hostAndPhone();
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await wait(host, () => window.__jjRoom.view().seats[0]?.prompt?.step === 0, undefined, 10_000);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await wait(host, () => window.__jjRoom.view().seats[0].prompt === null, undefined, 10_000);
  await startRace(page, host);
  await host.waitForTimeout(2500);
  assert.equal((await tilePrompt(host)).length, 0, 'no prompt on the tile after a skip');
  await shot(host, 'tv-no-prompt-after-skip-1280x720');
});

test('C06: a newcomer who joins a race in progress gets the prompts on their tile', { timeout: 240_000 }, async () => {
  const { host, page } = await hostAndPhone();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await startRace(page, host);
  const ctx2 = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const late = await ctx2.newPage();
  await late.goto(await host.evaluate(() => window.__jjNet.joinUrl()));
  await wait(late, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await late.getByRole('button', { name: 'Join the race' }).click();
  await wait(late, () => window.__jjController.inspect().phase === 'playing');
  await wait(host, () => window.__jjRoom.view().seats.length === 2 && window.__jjRoom.view().seats[1].prompt?.step === 0, undefined, 30_000);
  assert.equal((await late.evaluate(() => window.__jjTutorial.inspect())).open, false, 'no card in a race (it would hand the car to the autopilot)');
  await wait(host, () => [...document.querySelectorAll('.hud-tile [data-prompt]')].some((e) => !e.hidden && /Steer/.test(e.textContent)), undefined, 30_000);
  await shot(host, 'tv-prompt-late-joiner-steer-1280x720');
  await sticks(late, { x: 1, y: 0 }, z);
  await sticks(late, { x: -1, y: 0 }, z);
  await wait(host, () => window.__jjRoom.view().seats[1].prompt?.step === 1, undefined, 10_000);
});
