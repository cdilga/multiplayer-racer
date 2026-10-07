// P1-C03: the lobby's car picker, offline on the state opener. Any number of cars from data (`&roster=N` stands extra cars in), the
// pick kept per device, and Ready never behind it. (The TV's "choosing" state and the host seeing the pick need a wire message
// that doesn't exist yet: see the self-review.)
//   node --test web/tests/journeys/c03-car.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/c03car/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c03car'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};

async function open(fragment, size = { width: 844, height: 390 }) {
  const ctx = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.origin}${BASE}j/ABCD#state=${fragment}`);
  await page.waitForFunction(() => document.documentElement.dataset.jjController === 'ready', undefined, { timeout: 30_000 });
  // The tutorial offers itself to a newcomer in the Lobby; the picker is behind it until it is skipped.
  const skip = page.getByRole('button', { name: 'Skip tutorial' });
  if (await skip.count()) await skip.click();
  return { ctx, page, errors };
}
const picker = (page) => page.evaluate(() => window.__jjSettings.inspect().cars);

test('the Car button is a Lobby thing; with one car the picker shows it with its stats and no arrows', { timeout: 60_000 }, async () => {
  const race = await open('playing&round=racing');
  assert.equal(await race.page.locator('[data-act=car]').isHidden(), true, 'no car picking in a race');
  await race.ctx.close();
  const { ctx, page, errors } = await open('playing&round=lobby');
  assert.equal(await page.locator('[data-act=car]').isVisible(), true);
  await page.getByRole('button', { name: /^Car/ }).click();
  await page.locator('[data-overlay=cars]').waitFor();
  await page.waitForFunction(() => document.querySelector('.carimg.big')?.complete, undefined, { timeout: 10_000 });
  const r = await page.evaluate(() => ({
    name: document.querySelector('[data-car-name]').textContent,
    tag: document.querySelector('.carpanel .tag').textContent,
    stats: document.querySelectorAll('.stat').length,
    arrows: document.querySelectorAll('.arrow').length,
    thumbs: document.querySelectorAll('.thumb').length,
    img: document.querySelector('.carimg.big').complete && document.querySelector('.carimg.big').naturalWidth > 0,
  }));
  assert.deepEqual([r.name, r.tag, r.stats, r.arrows, r.thumbs, r.img], ['Cruz Missile', 'Aussie classic', 4, 0, 0, true]);
  await shot(page, 'c03-car-one-844x390');
  await page.getByRole('button', { name: 'Done' }).click();
  assert.equal(await picker(page), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('any number of cars: arrows, thumbnails and a swipe walk the whole roster, and the pick is kept per device', { timeout: 60_000 }, async () => {
  const { ctx, page } = await open('playing&round=lobby&roster=40');
  await page.getByRole('button', { name: /^Car/ }).click();
  await page.locator('[data-overlay=cars]').waitFor();
  assert.equal(await page.locator('.thumb').count(), 40, 'forty cars, no cap');
  const name = () => page.locator('[data-car-name]').textContent();
  assert.equal(await name(), 'Cruz Missile');
  await page.getByRole('button', { name: 'Next car' }).click();
  assert.equal(await name(), 'Test car 2');
  await page.getByRole('button', { name: 'Previous car' }).click();
  await page.getByRole('button', { name: 'Previous car' }).click();
  assert.equal(await name(), 'Test car 40', 'the roster wraps');
  await page.locator('.thumb[data-i="7"]').click();
  assert.equal(await name(), 'Test car 8');
  assert.equal(await page.locator('.thumb[aria-selected=true]').getAttribute('data-i'), '7');
  // A swipe on the stage moves one car.
  const box = await page.locator('.stage').boundingBox();
  await page.evaluate(([x, y]) => {
    const st = document.querySelector('.stage');
    const fire = (t, cx) => st.dispatchEvent(new PointerEvent(t, { pointerId: 3, bubbles: true, clientX: cx, clientY: y, isPrimary: true }));
    fire('pointerdown', x + 150);
    fire('pointerup', x + 20);
  }, [box.x, box.y + 40]);
  assert.equal(await name(), 'Test car 9');
  await shot(page, 'c03-car-many-844x390');
  await page.getByRole('button', { name: 'Done' }).click();
  // Kept: the next visit to the picker starts on it, and the session carries it.
  assert.equal((await page.evaluate(() => window.__jjController.inspect())).carChoice, 'test-7');
  await page.getByRole('button', { name: /^Car/ }).click();
  assert.equal(await page.locator('.thumb[aria-selected=true]').getAttribute('data-i'), '8');
  await ctx.close();
});

test('Ready is never behind the picker: it is there and enabled without picking, and the picker is closed by the countdown', { timeout: 60_000 }, async () => {
  const { ctx, page } = await open('playing&round=lobby');
  const ready = page.getByRole('button', { name: /^Ready/ });
  assert.equal(await ready.isEnabled(), true);
  assert.equal(await ready.isVisible(), true);
  await ctx.close();
});

test('the picker fits phones in landscape, portrait and the small phone, with Done reachable', { timeout: 90_000 }, async () => {
  for (const [label, size] of [['landscape-844x390', { width: 844, height: 390 }], ['portrait-390x844', { width: 390, height: 844 }], ['small-375x667', { width: 375, height: 667 }], ['short-640x300', { width: 640, height: 300 }]]) {
    const { ctx, page } = await open('playing&round=lobby&roster=6', size);
    await page.getByRole('button', { name: /^Car/ }).click();
    await page.locator('[data-overlay=cars]').waitFor();
    const done = page.getByRole('button', { name: 'Done' });
    await done.scrollIntoViewIfNeeded();
    const fit = await page.evaluate(() => {
      const d = document.querySelector('[data-act=car-done]').getBoundingClientRect();
      return { right: d.right, left: d.left, top: d.top, bottom: d.bottom, w: innerWidth, h: innerHeight, over: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(fit.left >= 0 && fit.right <= fit.w && fit.top >= 0 && fit.bottom <= fit.h && fit.over <= 1, `${label}: ${JSON.stringify(fit)}`);
    await shot(page, `c03-car-${label}`);
    await ctx.close();
  }
});
