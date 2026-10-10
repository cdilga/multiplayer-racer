// P1-C02 controller app, offline half: every check that needs no host runs on the state opener (`B/j/ABCD#state=playing`,
// P1-C03's R90 test surface), in Chromium and, where this machine has it, WebKit.
//   node --test web/tests/journeys/c02-controller.test.mjs
// - two simultaneous touch points drive two independent sticks (real CDP touch points in Chromium; pointer events with
//   one pointer id per thumb in both engines, which is what the sticks listen to);
// - pinch, double-tap, scroll and selection change nothing;
// - the pod's indicators are not focusable or tappable, top-centre in landscape and a centred row above the sticks in
//   portrait;
// - the player's colour is on screen at all times, and Identify plays the "Cooee #N" flash from the secondary button;
// - portrait asks to turn sideways; the first tap asks for full screen then a wake lock, and a wake lock is re-requested
//   when the page comes back.
// The wire half (sticks to DRIVE/ACTION semantics at the host) is `c02-wire.test.mjs`.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PNG } from 'pngjs';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/c02/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let server;
const engines = [];

before(async () => {
  server = await serve(build('./', 'c02'), BASE, { JJ_STUN_URLS: '' });
  engines.push({ name: 'chromium', browser: await chromium.launch({ args: chromiumArgs }) });
  try {
    engines.push({ name: 'webkit', browser: await webkit.launch() });
  } catch (e) {
    console.log(`# webkit unavailable here: ${String(e.message).split('\n')[0]}`);
  }
});
after(async () => {
  for (const e of engines) await e.browser.close();
  await server?.close();
});

const url = (state) => `${server.origin}${BASE}j/ABCD#state=${state}`;
const shot = async (page, name) => {
  if (!CAPTURE) return;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};

async function open(engine, state, size, { init } = {}) {
  const ctx = await engine.browser.newContext({ viewport: size, hasTouch: true, isMobile: engine.name === 'chromium' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(url(state));
  await page.waitForFunction(() => document.documentElement.dataset.jjController === 'ready', undefined, { timeout: 30_000 });
  return { ctx, page, errors };
}

const sticks = (page) => page.evaluate(() => window.__jjController.inspect().sticks);
const box = (page, sel) => page.locator(sel).first().boundingBox();
const LAND = { width: 844, height: 390 };
const PORT = { width: 390, height: 844 };

for (const engine of ['chromium', 'webkit']) {
  describe(`${engine}: touch`, () => {
    const eng = () => engines.find((e) => e.name === engine);

    test('two simultaneous touch points drive two independent sticks (landscape and portrait)', { timeout: 60_000, skip: false }, async (t) => {
      if (!eng()) return t.skip('engine not installed');
      for (const size of [LAND, PORT]) {
        const { ctx, page } = await open(eng(), 'playing', size);
        // Each thumb is a pointer id; the stick that owns the zone follows only its own pointer.
        const press = (kind, id, dx, dy) =>
          page.evaluate(([kind, id, dx, dy]) => {
            const z = document.querySelector(`.zone.${kind}`);
            const r = z.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            const fire = (type, px, py) => z.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: px, clientY: py, isPrimary: id === 1 }));
            fire('pointerdown', x, y);
            fire('pointermove', x + dx, y + dy);
          }, [kind, id, dx, dy]);
        const release = (kind, id) => page.evaluate(([kind, id]) => document.querySelector(`.zone.${kind}`).dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true })), [kind, id]);
        await press('drive', 1, 200, 0); // DRIVE right
        await press('action', 2, 0, -200); // ACTION up, at the same time
        let s = await sticks(page);
        assert.ok(s.drive.x > 0.9 && Math.abs(s.drive.y) < 0.1 && s.drive.touch, `${engine} drive ${JSON.stringify(s.drive)}`);
        assert.ok(s.action.y < -0.9 && Math.abs(s.action.x) < 0.1 && s.action.touch, `${engine} action ${JSON.stringify(s.action)}`);
        await release('drive', 1);
        s = await sticks(page);
        assert.ok(!s.drive.touch && s.drive.x === 0 && s.action.touch && s.action.y < -0.9, `${engine}: letting go of one leaves the other: ${JSON.stringify(s)}`);
        await release('action', 2);
        s = await sticks(page);
        assert.deepEqual([s.drive.touch, s.action.touch, s.action.y], [false, false, 0]);
        await ctx.close();
      }
    });
  });
}

describe('chromium: real touch points', () => {
  test('two CDP touch points drive both sticks independently; no zoom, no scroll', { timeout: 60_000 }, async () => {
    const eng = engines.find((e) => e.name === 'chromium');
    const { ctx, page } = await open(eng, 'playing', LAND);
    const cdp = await ctx.newCDPSession(page);
    const d = await box(page, '.zone.drive');
    const a = await box(page, '.zone.action');
    const p1 = { x: d.x + d.width / 2, y: d.y + d.height / 2, id: 1 };
    const p2 = { x: a.x + a.width / 2, y: a.y + a.height / 2, id: 2 };
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [p1, p2]);
    await touch('touchMove', [{ ...p1, x: p1.x + 150 }, { ...p2, y: p2.y - 150 }]);
    let s = await sticks(page);
    assert.ok(s.drive.x > 0.9 && s.action.y < -0.9, JSON.stringify(s));
    await touch('touchEnd', [{ ...p1, x: p1.x + 150 }]);
    s = await sticks(page);
    assert.ok(!s.drive.touch && s.action.touch, `one finger lifted: ${JSON.stringify(s)}`);
    await touch('touchEnd', []);
    s = await sticks(page);
    assert.deepEqual([s.drive.touch, s.action.touch], [false, false]);
    // A pinch and a long scroll over the sticks change nothing: no page zoom, no scroll.
    // A pinch with two real touch points (spreading apart), in the middle of the screen and over the sticks. (CDP's
    // synthesizePinchGesture injects a compositor gesture with no touch sequence, so touch-action never sees it.)
    for (const cx of [420, p1.x]) {
      await touch('touchStart', [{ x: cx - 15, y: 195, id: 11 }, { x: cx + 15, y: 195, id: 12 }]);
      for (let k = 1; k <= 10; k++) await touch('touchMove', [{ x: cx - 15 - k * 12, y: 195, id: 11 }, { x: cx + 15 + k * 12, y: 195, id: 12 }]);
      await touch('touchEnd', []);
    }
    // A swipe up through the middle of the screen (between the sticks) and the mouse wheel: neither scrolls the page.
    await touch('touchStart', [{ x: 420, y: 330, id: 7 }]);
    for (let y = 330; y > 100; y -= 20) await touch('touchMove', [{ x: 420, y, id: 7 }]);
    await touch('touchEnd', []);
    await page.mouse.wheel(0, 500);
    const v = await page.evaluate(() => ({ scale: visualViewport.scale, sy: scrollY, sx: scrollX, h: document.documentElement.scrollHeight - innerHeight }));
    assert.equal(v.scale, 1, 'no zoom');
    assert.deepEqual([v.sx, v.sy], [0, 0], 'no scroll');
    assert.ok(v.h <= 1, 'the page does not scroll');
    await ctx.close();
  });
});

for (const engine of ['chromium', 'webkit']) {
  describe(`${engine}: touch hygiene`, () => {
    test('double-tap, pinch gestures, selection and the context menu change nothing', { timeout: 60_000 }, async (t) => {
      const eng = engines.find((e) => e.name === engine);
      if (!eng) return t.skip('engine not installed');
      const { ctx, page } = await open(eng, 'playing', LAND);
      const r = await page.evaluate(() => {
        const css = (el) => getComputedStyle(el);
        const dbl = new MouseEvent('dblclick', { cancelable: true, bubbles: true });
        document.body.dispatchEvent(dbl);
        const gs = new Event('gesturestart', { cancelable: true, bubbles: true });
        document.body.dispatchEvent(gs);
        const zones = [...document.querySelectorAll('.zone')].map((z) => css(z).touchAction);
        return { html: css(document.documentElement).touchAction, body: css(document.body).touchAction, userSelect: css(document.body).userSelect || css(document.body).webkitUserSelect, zones, dbl: dbl.defaultPrevented, gs: gs.defaultPrevented, vp: document.querySelector('meta[name=viewport]')?.content };
      });
      assert.equal(r.html, 'none');
      assert.equal(r.body, 'none');
      assert.deepEqual(r.zones, ['none', 'none']);
      assert.equal(r.userSelect, 'none');
      assert.ok(r.dbl, 'double-tap zoom is cancelled');
      assert.ok(r.gs, 'a pinch gesture (Safari) is cancelled');
      await page.mouse.dblclick(420, 100);
      await page.mouse.click(420, 200, { clickCount: 3 });
      await page.keyboard.press('ControlOrMeta+a');
      assert.equal(await page.evaluate(() => getSelection().toString()), '', 'nothing can be selected');
      assert.deepEqual(await page.evaluate(() => [scrollX, scrollY]), [0, 0]);
      await ctx.close();
    });
  });
}

describe('the pod: indicators, not buttons', () => {
  for (const [name, size] of [['landscape', LAND], ['portrait', PORT]]) {
    test(`${name}: not focusable or tappable, and where the design puts it`, { timeout: 60_000 }, async () => {
      const eng = engines.find((e) => e.name === 'chromium');
      const { ctx, page } = await open(eng, 'playing&round=racing&boost=140', size);
      const r = await page.evaluate(() => {
        const pod = document.querySelector('.pod');
        const all = [pod, ...pod.querySelectorAll('*')];
        const b = pod.getBoundingClientRect();
        const sticks = document.querySelector('.sticks').getBoundingClientRect();
        const zone = document.querySelector('.zone.drive').getBoundingClientRect();
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return {
          focusable: all.filter((e) => e.matches('button,a,input,select,textarea,[tabindex],[contenteditable]')).length,
          pointerEvents: all.every((e) => getComputedStyle(e).pointerEvents === 'none'),
          tapFallsThrough: !pod.contains(hit),
          centreX: cx / innerWidth,
          top: b.top,
          bottom: b.bottom,
          sticksTop: sticks.top,
          zoneTop: zone.top,
          h: innerHeight,
          meter: getComputedStyle(pod.querySelector('.meter i')).width,
        };
      });
      assert.equal(r.focusable, 0, 'nothing in the pod can take focus');
      assert.ok(r.pointerEvents, 'every part ignores the pointer');
      assert.ok(r.tapFallsThrough, 'a tap on the pod lands on whatever is under it');
      assert.ok(Math.abs(r.centreX - 0.5) < 0.1, `centred (${r.centreX.toFixed(2)})`);
      if (name === 'landscape') assert.ok(r.top < r.h * 0.4, `top-centre in landscape (top ${r.top} of ${r.h})`);
      else assert.ok(r.bottom <= r.zoneTop + 2, `a row above the sticks in portrait (pod bottom ${r.bottom}, sticks ${r.zoneTop})`);
      // A tap on it changes no input state.
      await page.touchscreen.tap(r.centreX * size.width, (r.top + r.bottom) / 2);
      const s = await sticks(page);
      assert.deepEqual([s.drive.touch, s.action.touch, s.drive.x, s.action.x], [false, false, 0, 0]);
      await shot(page, `c02-pod-${name}`);
      await ctx.close();
    });
  }
});

describe('the player colour and Identify', () => {
  test("the seat's colour is on screen (strip and frame), and Identify from the secondary button plays the Cooee flash", { timeout: 60_000 }, async () => {
    const eng = engines.find((e) => e.name === 'chromium');
    const { ctx, page } = await open(eng, 'playing&seat=12', LAND);
    const seat = await page.evaluate(() => getComputedStyle(document.querySelector('.screen.play')).getPropertyValue('--seat').trim());
    assert.match(seat, /^#[0-9a-f]{6}$/i);
    const colours = await page.evaluate(() => ({ number: getComputedStyle(document.querySelector('.strip .seatno')).color, knob: getComputedStyle(document.querySelector('.zone.drive .knob')).backgroundColor }));
    const rgb = (h) => `rgb(${[1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
    assert.equal(colours.number, rgb(seat), 'the number in the strip is the seat colour');
    assert.equal(colours.knob, rgb(seat), 'the DRIVE knob is the seat colour');
    // The frame round the whole screen (POC1-21): the pixels at the very edge are the seat colour.
    const png = PNG.sync.read(await page.screenshot());
    const px = (x, y) => [png.data[(y * png.width + x) * 4], png.data[(y * png.width + x) * 4 + 1], png.data[(y * png.width + x) * 4 + 2]];
    const want = [1, 3, 5].map((i) => Number.parseInt(seat.slice(i, i + 2), 16));
    for (const [x, y] of [[1, Math.floor(png.height / 2)], [png.width - 2, Math.floor(png.height / 2)], [Math.floor(png.width / 2), 1], [Math.floor(png.width / 2), png.height - 2]]) {
      const got = px(x, y);
      assert.ok(got.every((v, i) => Math.abs(v - want[i]) < 24), `the frame at (${x},${y}) is the seat colour ${seat}: ${got}`);
    }
    await page.locator('[data-act=identify]').click();
    await page.locator('.cooee-phone').waitFor({ timeout: 5000 });
    assert.match(await page.locator('.cooee-phone').textContent(), /Cooee #12/i);
    await shot(page, 'c02-identify-flash');
    await page.locator('.cooee-phone').waitFor({ state: 'detached', timeout: 5000 });
    await ctx.close();
  });

  test('the Cooee flash is see-through and both sticks keep driving under it (owner playtest 1)', { timeout: 60_000 }, async () => {
    const eng = engines.find((e) => e.name === 'chromium');
    const { ctx, page } = await open(eng, 'playing&seat=12', LAND);
    const cdp = await ctx.newCDPSession(page);
    const d = await box(page, '.zone.drive');
    const a = await box(page, '.zone.action');
    await page.locator('[data-act=identify]').click();
    await page.locator('.cooee-phone').waitFor({ timeout: 5000 });
    const look = await page.evaluate(([dx, dy]) => {
      const o = document.querySelector('.cooee-phone');
      const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/) ?? c.match(/color\(srgb ([^)]+)\)/); const parts = m ? m[1].split(/[ ,/]+/).filter(Boolean) : []; return parts.length >= 4 ? Number(parts[3]) : 1; };
      return { bg: alpha(getComputedStyle(o).backgroundColor), events: getComputedStyle(o).pointerEvents, hit: document.elementFromPoint(dx, dy)?.closest('.cooee-phone') !== null };
    }, [d.x + d.width / 2, d.y + d.height / 2]);
    assert.ok(look.bg <= 0.5, `the wash lets the sticks show through (background alpha ${look.bg})`);
    assert.equal(look.events, 'none', 'touches pass through the flash');
    assert.equal(look.hit, false, 'the drive stick, not the flash, is what a thumb lands on');
    const p1 = { x: d.x + d.width / 2, y: d.y + d.height / 2, id: 1 };
    const p2 = { x: a.x + a.width / 2, y: a.y + a.height / 2, id: 2 };
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [p1, p2]);
    await touch('touchMove', [{ ...p1, y: p1.y - 150 }, { ...p2, x: p2.x + 150 }]);
    assert.ok(await page.locator('.cooee-phone').count(), 'still flashing while driving');
    const s = await sticks(page);
    assert.ok(s.drive.y < -0.9 && s.action.x > 0.9 && s.drive.touch && s.action.touch, `both sticks drive under the flash: ${JSON.stringify(s)}`);
    await shot(page, 'c02-identify-flash-driving');
    await touch('touchEnd', []);
    await ctx.close();
  });
});

describe('landscape first, full screen and the wake lock', () => {
  test('portrait asks once to turn sideways and still plays upright; landscape never asks', { timeout: 60_000 }, async () => {
    const eng = engines.find((e) => e.name === 'chromium');
    const p = await open(eng, 'playing', PORT);
    await p.page.locator('[data-overlay=rotate]').waitFor();
    assert.match(await p.page.locator('[data-overlay=rotate]').textContent(), /Turn sideways/i);
    await shot(p.page, 'c02-rotate-prompt');
    await p.page.getByRole('button', { name: 'Play upright anyway' }).click();
    assert.equal(await p.page.locator('[data-overlay=rotate]').count(), 0);
    await p.ctx.close();
    const l = await open(eng, 'playing', LAND);
    assert.equal(await l.page.locator('[data-overlay=rotate]').count(), 0);
    await l.ctx.close();
  });

  test('the first tap asks for full screen then a wake lock; the wake lock is asked for again when the page returns', { timeout: 60_000 }, async () => {
    const eng = engines.find((e) => e.name === 'chromium');
    const { ctx, page } = await open(eng, 'ready-to-join', LAND, {
      init: () => {
        window.__calls = [];
        Element.prototype.requestFullscreen = async function () {
          window.__calls.push('fullscreen');
        };
        const lock = { released: false, release() {}, addEventListener() {} };
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => (window.__calls.push('wake'), lock) } });
      },
    });
    await page.getByRole('button', { name: 'Join the race' }).click();
    await page.waitForFunction(() => window.__calls.includes('wake'));
    const calls = await page.evaluate(() => window.__calls);
    assert.ok(calls.indexOf('fullscreen') >= 0 && calls.indexOf('fullscreen') < calls.indexOf('wake'), `fullscreen then wake: ${calls}`);
    const before = calls.filter((c) => c === 'wake').length;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction((n) => window.__calls.filter((c) => c === 'wake').length > n, before);
    await ctx.close();
  });
});
