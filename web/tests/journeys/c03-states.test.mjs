// P1-C03: every §11 controller state, drawn from the URL-fragment opener (`#state=…`, R90) with no network, with its
// wording and its next action. The causes that lead to each state on a live room are `c03-resume.test.mjs`.
//   node --test web/tests/journeys/c03-states.test.mjs
// Wording follows R112 (room, never game). `JJ_CAPTURE_DIR` saves every state at three phone sizes for the self-review.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/c03states/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c03states'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** state: [fragment, wording that must show, the next action's button (or null), words that must NOT appear] */
const STATES = {
  finding: ['finding', /Finding room ABCD/, null],
  'no-such-room': ['no-such-room', /No room with code ABCD/, 'Try another code'],
  'room-ended': ['room-ended', /That room has ended/, 'Join another room'],
  'preview-expired': ['preview-expired', /This test build has expired/, null],
  connecting: ['connecting', /Connecting/, null],
  'finding-relay': ['finding-relay', /Finding a relay/, null],
  'no-route': ['no-route', /Can't reach the host from this network/, 'Retry'],
  'ready-to-join': ['ready-to-join&name=Davo', /Room ABCD/, 'Join the race'],
  joining: ['joining', /Joining/, null],
  reconnecting: ['reconnecting&seat=12', /Reconnecting as #12/, null],
  'host-gone': ['host-gone', /The host seems to have gone/, 'Enter a new code'],
  'host-paused': ['host-paused&seat=12', /Host paused/, null],
  'another-tab': ['another-tab', /Playing in another tab/, 'Use this one'],
  'update-needed': ['update-needed', /Updating/, null],
  playing: ['playing&seat=12', /#12/, 'Ready'],
};
const SIZES = { 'phone-landscape-844x390': [844, 390], 'phone-portrait-390x844': [390, 844], 'phone-small-375x667': [375, 667] };

async function open(state, [width, height]) {
  const page = await (await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${server.origin}${BASE}j/ABCD#state=${STATES[state][0]}`);
  await page.waitForFunction(() => document.documentElement.dataset.jjController === 'ready', undefined, { timeout: 30_000 });
  await page.waitForTimeout(200);
  return { page, errors };
}

for (const [state, [, wording, action]] of Object.entries(STATES)) {
  test(`§11 ${state}: its wording${action ? ` and its action "${action}"` : ''}, never "game", nothing off the edge`, { timeout: 60_000 }, async () => {
    for (const [label, size] of Object.entries(SIZES)) {
      const { page, errors } = await open(state, size);
      const text = await page.evaluate(() => document.body.innerText);
      assert.match(text, wording, `${state}: ${label}`);
      assert.doesNotMatch(text, /\bgame\b/i, `${state}: R112 says room, never game`);
      if (action) assert.ok((await page.getByRole('button', { name: action }).count()) >= 1, `${state}: has "${action}"`);
      const fit = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, vover: document.documentElement.scrollHeight - innerHeight }));
      assert.ok(fit.over <= 1 && fit.vover <= 1, `${state} ${label}: the page scrolls (${JSON.stringify(fit)})`);
      assert.deepEqual(errors, [], `${state}: no errors or failed requests`);
      if (CAPTURE) {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(CAPTURE, { recursive: true });
        await page.screenshot({ path: `${CAPTURE}/c03-state-${state}-${label}.png` });
      }
      await page.context().close();
    }
  });
}

test('the next actions do what they say', { timeout: 60_000 }, async () => {
  // Try another code / Enter a new code / Join another room go back to the landing page (the join card there).
  for (const [state, button] of [['no-such-room', 'Try another code'], ['host-gone', 'Enter a new code'], ['room-ended', 'Join another room']]) {
    const { page } = await open(state, SIZES['phone-landscape-844x390']);
    await page.getByRole('button', { name: button }).click();
    await page.waitForURL(`${server.origin}${BASE}`);
    await page.context().close();
  }
  // Use this one takes the seat back in this tab (it starts connecting).
  const { page } = await open('another-tab', SIZES['phone-landscape-844x390']);
  await page.getByRole('button', { name: 'Use this one' }).click();
  await page.waitForFunction(() => window.__jjController.inspect().phase !== 'another-tab', undefined, { timeout: 10_000 });
  await page.context().close();
});

test('host paused keeps the sticks on screen, dimmed, with the wording over them and no touch taken', { timeout: 60_000 }, async () => {
  const { page } = await open('host-paused', SIZES['phone-landscape-844x390']);
  const r = await page.evaluate(() => {
    const card = document.querySelector('[data-overlay=paused]');
    return { has: !!card, pe: card && getComputedStyle(card).pointerEvents, sticks: getComputedStyle(document.querySelector('.sticks')).opacity };
  });
  assert.deepEqual([r.has, r.pe], [true, 'none']);
  assert.ok(Number(r.sticks) < 0.6, 'the sticks are dimmed');
});
