import { confirmInitialVehicle } from './lib/vehicle.mjs';
// P1-C03: the lobby's car picker, offline on the state opener. Any number of cars from data (`&roster=N` stands extra cars in), the
// pick kept per device, and Ready never behind it. (The TV's "choosing" state and the host seeing the pick need a wire message
// that doesn't exist yet: see the self-review.)
//   node --test web/tests/journeys/c03-car.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import roster from '../../shared/src/roster.json' with { type: 'json' };

// The real cars come first (the roster grows, R123); stand-ins `test-0`… follow them.
const REAL = roster.cars.length;

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
  await confirmInitialVehicle(page);
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
  await page.getByRole('button', { name: /^(Choose|Change) car$/ }).click();
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
  assert.deepEqual([r.name, r.tag, r.stats, r.arrows, r.thumbs, r.img], ['Cruz Missile', 'Aussie classic', 4, 2, REAL, true]);
  await shot(page, 'c03-car-one-844x390');
  await page.getByRole('button', { name: 'Use this vehicle' }).click();
  assert.equal(await picker(page), null);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('any number of cars: arrows, thumbnails and a swipe walk the whole roster, and the pick is kept per device', { timeout: 60_000 }, async () => {
  const { ctx, page } = await open('playing&round=lobby&roster=40');
  await page.getByRole('button', { name: /^(Choose|Change) car$/ }).click();
  await page.locator('[data-overlay=cars]').waitFor();
  assert.equal(await page.locator('.thumb').count(), 40, 'forty cars, no cap');
  const name = () => page.locator('[data-car-name]').textContent();
  assert.equal(await name(), 'Cruz Missile');
  await page.getByRole('button', { name: 'Next car' }).click();
  assert.equal(await name(), 'Tradie Ute');
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
  await page.getByRole('button', { name: 'Use this vehicle' }).click();
  // Kept: the next visit to the picker starts on it, and the session carries it.
  assert.equal((await page.evaluate(() => window.__jjController.inspect())).carChoice, `test-${8 - REAL}`);
  await page.getByRole('button', { name: /^(Choose|Change) car$/ }).click();
  assert.equal(await page.locator('.thumb[aria-selected=true]').getAttribute('data-i'), '8');
  await ctx.close();
});

// br-bwju.9 (owner 2026-10-12: "it's kinda unclear you can change car ... you can't clearly see how many choices you
// really have"): the lobby shows the car as a pick, by name, with a worded Change car and its place in the roster.
test('the lobby shows the car by name with a worded Change car and "Car i of N", on screen and uncovered, at 390x844 and 844x390', { timeout: 90_000 }, async () => {
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 375, height: 667 }, { width: 640, height: 300 }]) {
    const label = `${size.width}x${size.height}`;
    const { ctx, page, errors } = await open('playing&round=lobby&roster=12', size);
    const upright = page.getByRole('button', { name: 'Play upright anyway' });
    if (await upright.count()) {
      await upright.click();
      // Upright, the tutorial offers itself once the turn-sideways card goes.
      const skip = page.getByRole('button', { name: 'Skip tutorial' });
      await skip.waitFor({ timeout: 2_000 }).then(() => skip.click(), () => {});
    }
    const change = page.getByRole('button', { name: 'Change car' });
    assert.equal(await change.isVisible(), true, `${label}: Change car shows`);
    const seen = await page.evaluate(() => {
      const on = (el) => {
        const r = el.getBoundingClientRect();
        // The pod's words take no touches, so the hit lands on the pod under them, unless something covers them.
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && (hit === el || el.contains(hit) || hit?.contains(el));
      };
      const btn = document.querySelector('[data-act=car]');
      const words = btn.querySelector('.lbl');
      return {
        words: getComputedStyle(words).display !== 'none' ? words.textContent : '',
        btn: on(btn),
        name: document.querySelector('[data-car-pick]').textContent,
        nameOn: on(document.querySelector('[data-car-pick]')),
        count: document.querySelector('[data-car-at]').textContent,
        countOn: on(document.querySelector('[data-car-at]')),
        scroll: document.scrollingElement.scrollHeight - innerHeight,
      };
    });
    assert.deepEqual(seen, { words: 'Change car', btn: true, name: 'Cruz Missile', nameOn: true, count: 'Car 1 of 12', countOn: true, scroll: 0 }, label);
    await shot(page, `c03-car-lobby-${label}`);
    // The picker counts too, and the pod follows the pick.
    await change.click();
    await page.locator('[data-overlay=cars]').waitFor();
    assert.equal(await page.locator('[data-car-count]').textContent(), 'Car 1 of 12');
    assert.equal(await page.locator('[data-thumbs-label]').textContent(), 'All 12 cars: tap one or swipe');
    assert.equal(await page.locator('.thumb').count(), 12, 'every car in the roster');
    await page.getByRole('button', { name: 'Next car' }).click();
    assert.equal(await page.locator('[data-car-count]').textContent(), 'Car 2 of 12');
    await page.getByRole('button', { name: 'Use this vehicle' }).click();
    assert.equal(await page.locator('[data-car-pick]').textContent(), 'Tradie Ute');
    assert.equal(await page.locator('[data-car-at]').textContent(), 'Car 2 of 12');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('Ready follows the explicit vehicle confirmation and remains visible in the lobby', { timeout: 60_000 }, async () => {
  const { ctx, page } = await open('playing&round=lobby');
  const ready = page.getByRole('button', { name: /^Ready/ });
  assert.equal(await ready.isEnabled(), true);
  assert.equal(await ready.isVisible(), true);
  await ctx.close();
});

test('the picker fits phones in landscape, portrait and the small phone, with Done reachable', { timeout: 90_000 }, async () => {
  for (const [label, size] of [['landscape-844x390', { width: 844, height: 390 }], ['portrait-390x844', { width: 390, height: 844 }], ['small-375x667', { width: 375, height: 667 }], ['short-640x300', { width: 640, height: 300 }]]) {
    const { ctx, page } = await open('playing&round=lobby&roster=6', size);
    await page.getByRole('button', { name: /^(Choose|Change) car$/ }).click();
    await page.locator('[data-overlay=cars]').waitFor();
    const done = page.getByRole('button', { name: 'Use this vehicle' });
    await done.scrollIntoViewIfNeeded();
    const fit = await page.evaluate(() => {
      const d = document.querySelector('[data-act=car-done]').getBoundingClientRect();
      return { right: d.right, left: d.left, top: d.top, bottom: d.bottom, w: innerWidth, h: innerHeight, over: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(fit.left >= 0 && fit.right <= fit.w && fit.top >= 0 && fit.bottom <= fit.h && fit.over <= 1, `${label}: ${JSON.stringify(fit)}`);
    // Nothing sits over it: the point at the middle of Done lands on Done.
    assert.equal(await page.evaluate(() => { const d = document.querySelector('[data-act=car-done]').getBoundingClientRect(); return document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2)?.closest('[data-act=car-done]') !== null; }), true, `${label}: something covers Done`);
    await shot(page, `c03-car-${label}`);
    await ctx.close();
  }
});

// br-bwju.10 (owner 2026-10-17: "I see crayon like drawings in places in the UI where we should have a proper render"):
// every real roster car shows its own render, made from its in-game model, in the big panel and its thumbnail; only the
// `&roster=N` stand-ins are silhouettes.
test('every real roster car has its own render in the picker, big and thumbnail; only stand-ins are silhouettes', { timeout: 120_000 }, async () => {
  for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    const label = `${size.width}x${size.height}`;
    const { ctx, page, errors } = await open(`playing&round=lobby&roster=${REAL + 2}`, size);
    const upright = page.getByRole('button', { name: 'Play upright anyway' });
    if (await upright.count()) {
      await upright.click();
      const skip = page.getByRole('button', { name: 'Skip tutorial' });
      await skip.waitFor({ timeout: 2_000 }).then(() => skip.click(), () => {});
    }
    await page.getByRole('button', { name: /^(Choose|Change) car$/ }).click();
    await page.locator('[data-overlay=cars]').waitFor();
    const thumbs = await page.evaluate(() => [...document.querySelectorAll('.thumb')].map((t) => (t.querySelector('.carimg.sil') ? 'sil' : t.querySelector('img.carimg') ? 'img' : 'none')));
    assert.deepEqual(thumbs, [...Array(REAL).fill('img'), 'sil', 'sil'], `${label}: thumbnails`);
    const srcs = new Set();
    for (let i = 0; i < REAL; i++) {
      await page.locator(`.thumb[data-i="${i}"]`).click();
      await page.waitForFunction(() => { const im = document.querySelector('img.carimg.big'); return im?.complete && im.naturalWidth > 0; }, undefined, { timeout: 10_000 });
      const car = await page.evaluate(() => { const im = document.querySelector('img.carimg.big'); return { name: document.querySelector('[data-car-name]').textContent, src: im.getAttribute('src'), w: im.naturalWidth }; });
      assert.equal(car.name, roster.cars[i].name);
      assert.ok(car.w >= 400, `${car.name}: a real render, ${car.w} px wide`);
      srcs.add(car.src);
      await shot(page, `bwju10-${roster.cars[i].id}-${label}`);
    }
    assert.equal(srcs.size, REAL, 'each car its own render');
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});
