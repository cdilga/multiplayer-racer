import { confirmInitialVehicle } from './lib/vehicle.mjs';
// P1-FL13 (R130): the Buttons layout, a steer stick plus on-screen buttons, chosen and arranged per player.
//  1. A real phone (Chromium, loopback WebRTC, the real host in free drive on the greybox) switches to Buttons in
//     Settings and remaps two inputs (Boost and Gas each to a new spot); each button, pressed with a real touch, puts
//     the same intent on the host's car as the one-stick layout's stick would (throttle, brake/reverse, steer, boost, OI!,
//     cone); then the phone drives a lap of the greybox on the steer stick and the Gas button, both held by real touches.
//  2. Multi-touch: the steer stick, Gas and Boost held at once by three pointers all register (Chromium and WebKit, the
//     controller in `playing` through the state opener).
//   node --test web/tests/journeys/fl13-buttons.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/fl13/';
let server;
before(async () => {
  server = await serve(build('./', 'fl13'), BASE, { JJ_STUN_URLS: '' });
});
after(async () => {
  await server?.close();
});

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const centre = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; });

/** Settings: switch to Buttons and move Boost (top outside, slot 2) to bottom inside (3) and Gas (5) to where Boost was. */
async function chooseButtons(page) {
  await page.click('[data-act=settings]');
  await page.click('[data-set=controls][data-v=buttons]');
  const slot = (n) => page.click(`.slotpick[data-slot="${n}"]`);
  await slot(2); // Boost off the pad
  await slot(3); // ... onto the empty spot
  await slot(5); // Gas off the pad
  await slot(2); // ... onto Boost's old spot
  const b = await page.evaluate(() => [...document.querySelectorAll('.slotpick')].map((e) => e.textContent.trim()));
  assert.deepEqual(b, ['Drop', 'Fire', 'Gas', 'Boost', 'Brake', '+'], `the arrangement reads back: ${JSON.stringify(b)}`);
  await page.click('[data-act=save]');
  await wait(page, () => document.querySelector('.sticks.buttons .padbtn[data-input=gas]'));
  const at = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.pad .slot')].map((s) => [s.dataset.slot, s.querySelector('.padbtn')?.dataset.input ?? null])));
  assert.deepEqual(at, { 0: 'drop', 1: 'fire', 2: 'gas', 3: 'boost', 4: 'brake', 5: null }, `the pad follows the arrangement: ${JSON.stringify(at)}`);
}

test('Buttons, real phone and host: remap two inputs, each button is the one-stick intent, and a lap on the steer stick and Gas', { timeout: 420_000 }, async () => {
  const browser = await chromium.launch({ args: chromiumArgs });
  try {
    const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await host.goto(`${server.origin}${BASE}host?drive&test=live`);
    await wait(host, () => window.__jjNet?.code() && window.__jjTest, undefined, 60_000);
    const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
    const page = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } })).newPage();
    await page.goto(joinUrl);
    await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
    await page.getByRole('button', { name: 'Join the race' }).click();
    await wait(page, () => window.__jjController.inspect().phase === 'playing');
    await confirmInitialVehicle(page);
    await wait(page, () => window.__jjTutorial.inspect()?.open === true);
    await confirmInitialVehicle(page);
    await page.getByRole('button', { name: 'Skip tutorial' }).click();
    await chooseButtons(page);
    const endpoint = (await page.evaluate(() => window.__jjController.inspect())).link.endpointId;
    const seen = () => host.evaluate(async (ep) => {
      const o = await window.__jjTest.observe();
      const seat = o.host.seats.find((s) => s.endpoint === ep);
      const car = o.cars.find((c) => c.car === seat?.car);
      return { ...car?.input, action: car?.action, autopilot: car?.autopilot != null, position: car?.position, heading: ((car?.headingDeg ?? 0) * Math.PI) / 180, speed: car?.speed };
    }, endpoint);
    const until = async (what, ok, ms = 20_000) => {
      let s;
      for (const t0 = Date.now(); ; await host.waitForTimeout(120)) {
        s = await seen();
        if (!s.autopilot && ok(s)) return s;
        assert.ok(Date.now() - t0 < ms, `${what}: the host saw ${JSON.stringify(s)}`);
      }
    };
    // Real touches (CDP), several at once: each call states every finger now down.
    const cdp = await page.context().newCDPSession(page);
    const fingers = new Map();
    const touch = async (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
    const down = async (id, p) => { fingers.set(id, p); await touch('touchStart'); };
    const move = async (id, p) => { fingers.set(id, p); await touch('touchMove'); };
    const up = async (id) => { fingers.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [...fingers.entries()].map(([i, p]) => ({ id: i, x: p.x, y: p.y })) }); };
    const btn = (input) => centre(page, `.padbtn[data-input=${input}]`);
    const steerAt = await centre(page, '[data-box=zone-steer] .base');

    // Gas: throttle, no steer, no brake.
    await down(2, await btn('gas'));
    const gas = await until('gas', (s) => s.throttle > 0.8);
    assert.ok(Math.abs(gas.steer) < 0.1 && gas.brake < 0.1, `Gas is throttle only: ${JSON.stringify(gas)}`);
    // The steer stick, with Gas still held (two fingers): steer both ways, throttle stays.
    await down(1, steerAt);
    await move(1, { x: steerAt.x + 70, y: steerAt.y });
    const r = await until('steer right', (s) => Math.abs(s.steer) > 0.6 && s.throttle > 0.8);
    await move(1, { x: steerAt.x - 70, y: steerAt.y });
    await until('steer left', (s) => Math.sign(s.steer) === -Math.sign(r.steer) && Math.abs(s.steer) > 0.6);
    await up(1);
    // Boost, with Gas held: boosting.
    await down(3, await btn('boost'));
    await until('boost', (s) => s.action?.boosting === true && s.throttle > 0.8);
    await up(3);
    await up(2);
    // Brake: brake or reverse, never throttle.
    await down(4, await btn('brake'));
    const brake = await until('brake', (s) => s.brake > 0.5 || s.throttle < -0.5);
    assert.ok(!(brake.throttle > 0.1), `Brake is never throttle: ${JSON.stringify(brake)}`);
    await up(4);
    // Fire and Drop: one OI! and one cone per press, Fire even while Boost is held.
    const before = (await seen()).action;
    await down(3, await btn('boost'));
    await down(5, await btn('fire'));
    await up(5);
    await up(3);
    await until('OI!', (s) => s.action.oi === before.oi + 1);
    await down(6, await btn('drop'));
    await up(6);
    await until('cone', (s) => s.action.cones === before.cones + 1);

    // A lap of the greybox: Gas held, steering on the stick toward the road a few points ahead, on the Some assist (R125:
    // a steer-to-line, the player still on the Gas button): a closed loop through Playwright lags ~100 ms, which on Off
    // wedged the car on a rail (br-bbki.14).
    await page.evaluate(() => window.__jjController.setAssist('some'));
    const map = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../maps/greybox-loop.json'), 'utf8'));
    const pts = map.route.points.map((p) => [p.x / 1000, p.z / 1000]);
    const n = pts.length;
    const nearest = (p) => pts.reduce((b, q, i) => ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < (pts[b][0] - p[0]) ** 2 + (pts[b][1] - p[1]) ** 2 ? i : b), 0);
    let s = await seen();
    let last = nearest([s.position[0], s.position[2]]);
    // Driven as a player would: Gas on the straights and off above 11 m/s, a firm steer toward the road 10 m ahead, and
    // Brake to back out (steering the other way) if the car is ever stuck against a rail.
    let travelled = 0;
    const gasAt = await btn('gas');
    const brakeAt = await btn('brake');
    let gasDown = false;
    await down(1, steerAt);
    const t0 = Date.now();
    let stuckSince = null;
    while (travelled < n) {
      assert.ok(Date.now() - t0 < 180_000, `the lap took too long: ${travelled}/${n} points; the host sees ${JSON.stringify(s)}`);
      s = await seen();
      const here = nearest([s.position[0], s.position[2]]);
      const step = (here - last + n) % n;
      if (step < n / 4) travelled += step;
      last = here;
      const [ax, az] = pts[(here + 4) % n];
      const want = Math.atan2(ax - s.position[0], az - s.position[2]);
      let err = want - s.heading;
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      // The sim's heading turns the other way to a push right: a target to the left (positive error) is a push left.
      const push = Math.max(-1, Math.min(1, -err * 3 * Math.sign(-r.steer)));
      stuckSince = s.speed < 0.6 ? (stuckSince ?? Date.now()) : null;
      if (stuckSince !== null && Date.now() - stuckSince > 2000) {
        if (gasDown) await up(2);
        gasDown = false;
        await move(1, { x: steerAt.x - push * 60, y: steerAt.y });
        await down(7, brakeAt);
        await host.waitForTimeout(1200);
        await up(7);
        stuckSince = null;
        continue;
      }
      await move(1, { x: steerAt.x + push * 60, y: steerAt.y });
      const wantGas = s.speed < 11;
      if (wantGas && !gasDown) await down(2, gasAt);
      if (!wantGas && gasDown) await up(2);
      gasDown = wantGas;
      await host.waitForTimeout(80);
    }
    await up(1);
    if (gasDown) await up(2);
    assert.ok(travelled >= n, `the car went round: ${travelled}/${n}`);
  } finally {
    await browser.close();
  }
});

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${engine}: steer + Gas + Boost held at once by three pointers all register`, { timeout: 120_000 }, async () => {
    const browser = await type.launch(engine === 'chromium' ? { args: chromiumArgs } : {});
    try {
      const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: engine === 'chromium' });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(`${server.origin}${BASE}j/ABCD#state=playing&round=racing&boost=140`);
      await wait(page, () => document.documentElement.dataset.jjController === 'ready');
      for (const sel of ['[data-act=upright]', '[data-act=tut-skip]', '[data-act=skip]']) {
        const el = page.locator(sel).first();
        if (await el.count() && await el.isVisible()) await el.click().catch(() => {});
      }
      await chooseButtons(page);
      const held = await page.evaluate(async () => {
        const fire = (el, type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y, isPrimary: id === 11 }));
        const at = (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
        const zone = document.querySelector('[data-box=zone-steer]');
        const [sx, sy] = at(zone.querySelector('.base'));
        const gas = document.querySelector('.padbtn[data-input=gas]');
        const boost = document.querySelector('.padbtn[data-input=boost]');
        fire(zone, 'pointerdown', 11, sx, sy);
        fire(zone, 'pointermove', 11, sx + 60, sy);
        fire(gas, 'pointerdown', 12, ...at(gas));
        fire(boost, 'pointerdown', 13, ...at(boost));
        await new Promise((r) => setTimeout(r, 100));
        const sticks = window.__jjController.inspect().sticks;
        const pressed = [...document.querySelectorAll('.padbtn.is-pressed')].map((e) => e.dataset.input).sort();
        fire(boost, 'pointerup', 13, ...at(boost));
        fire(gas, 'pointerup', 12, ...at(gas));
        fire(zone, 'pointerup', 11, sx + 60, sy);
        await new Promise((r) => setTimeout(r, 50));
        return { sticks, pressed, after: window.__jjController.inspect().sticks };
      });
      assert.ok(held.sticks.drive.x > 0.5, `steer held: ${JSON.stringify(held)}`);
      assert.equal(held.sticks.drive.y, -1, `Gas held (the left stick full up): ${JSON.stringify(held)}`);
      assert.equal(held.sticks.action.x, 1, `Boost held (the right stick right): ${JSON.stringify(held)}`);
      assert.deepEqual(held.pressed, ['boost', 'gas'], 'both buttons paint pressed');
      assert.deepEqual([held.after.drive.x, held.after.drive.y, held.after.action.x, held.after.action.y], [0, 0, 0, 0], 'all let go: neutral');
      assert.deepEqual(errs, []);
    } finally {
      await browser.close();
    }
  });
}

test('a stored Buttons layout reads back sound: valid slots kept, clashes and junk dropped, nothing stored the default', async () => {
  const { DEFAULT_BUTTONS, sanitise } = await import('../../controller/src/app/prefs-data.ts');
  assert.deepEqual(sanitise({}).buttons, DEFAULT_BUTTONS, 'nothing stored: the default arrangement');
  assert.equal(sanitise({ v: 1, controls: 'buttons' }).controls, 'buttons');
  assert.equal(sanitise({ v: 1, controls: 'paddles' }).controls, 'dual', 'an unknown layout is two sticks');
  const mine = { steer: 'right', slots: { gas: 0, brake: 3, boost: null, fire: 5, drop: 4 } };
  assert.deepEqual(sanitise({ v: 1, buttons: mine }).buttons, mine, 'a valid arrangement round-trips');
  const bad = sanitise({ v: 1, buttons: { steer: 'up', slots: { gas: 2, brake: 2, boost: 9, fire: 1.5, drop: 'x' } } }).buttons;
  assert.deepEqual(bad, { steer: 'left', slots: { gas: 2, brake: null, boost: null, fire: null, drop: null } }, `a clash keeps the first, junk has no button: ${JSON.stringify(bad)}`);
});

// The jammers-ui controller-button rule (R130): the Buttons layout in `playing` at the owner's phone sizes, both
// orientations, with every state its controls show. It asserts what a look can't be trusted to (every pad button a target
// of at least 48 CSS px, none overlapping the strip, the pod or the steer stick, a press painting differently); with
// JJ_CAPTURE_DIR=<dir> it saves a still of each for the self-review (docs/evidence/P1-FL13/).
const OUT = process.env.JJ_CAPTURE_DIR;
const hits = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${engine}: the Buttons layout looks finished in every state, landscape and portrait`, { timeout: 300_000 }, async () => {
    const browser = await type.launch(engine === 'chromium' ? { args: chromiumArgs } : {});
    try {
      for (const [w, h] of [[915, 412], [412, 915], [667, 375], [375, 667]]) {
        const tag = `${engine}-${w}x${h}`;
        const open = async (frag) => {
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: engine === 'chromium' });
          const page = await ctx.newPage();
          await page.goto(`${server.origin}${BASE}j/ABCD#state=${frag}`);
          await wait(page, () => document.documentElement.dataset.jjController === 'ready');
          for (const sel of ['[data-act=upright]', '[data-act=tut-skip]', '[data-act=skip]']) {
            const el = page.locator(sel).first();
            if (await el.count() && await el.isVisible()) await el.click().catch(() => {});
          }
          return { ctx, page };
        };
        const shot = async (page, name) => {
          if (OUT) await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
        };
        const check = async (page, what) => {
          const l = await page.evaluate(() => {
            const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
            const pad = [...document.querySelectorAll('.padbtn')].map((e) => ({ input: e.dataset.input, ...box(e) }));
            const keep = [...document.querySelectorAll('.strip, .pod, [data-box=zone-steer] .base, .tools')].filter((e) => e.offsetParent).map((e) => ({ what: e.className, ...box(e) }));
            return { pad, keep, over: document.documentElement.scrollWidth - innerWidth };
          });
          assert.equal(l.pad.length, 5, `${tag} ${what}: five buttons`);
          for (const b of l.pad) {
            assert.ok(b.w >= 48 && b.h >= 48, `${tag} ${what}: ${b.input} is ${b.w.toFixed(0)}x${b.h.toFixed(0)} (48 px at least)`);
            for (const k of l.keep) assert.ok(!hits(b, k), `${tag} ${what}: ${b.input} overlaps ${k.what}`);
            assert.ok(b.x >= 0 && b.x + b.w <= w && b.y + b.h <= h, `${tag} ${what}: ${b.input} is on screen`);
          }
          assert.ok(l.over <= 0, `${tag} ${what}: no sideways scroll`);
        };
        const toButtons = async (page, right = false) => {
          await page.click('[data-act=settings]');
          await page.click('[data-set=controls][data-v=buttons]');
          if (right) await page.click('[data-set=buttonsSteer][data-v=right]');
          await page.locator('[data-box=arrange]').scrollIntoViewIfNeeded();
          return async () => {
            await page.click('[data-act=save]');
            await wait(page, () => document.querySelector('.sticks.buttons .padbtn'));
            await page.waitForTimeout(300);
          };
        };
        // Idle (the arranger captured on the way), then held: the steer stick pushed with Gas and Boost down, then Fire.
        {
          const { ctx, page } = await open('playing&round=racing&boost=140');
          const save = await toButtons(page);
          await shot(page, 'settings-arrange');
          await save();
          await check(page, 'idle');
          await shot(page, 'idle');
          const paint = await page.evaluate(async () => {
            const fire = (el, t, id, x, y) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
            const at = (el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; };
            const zone = document.querySelector('[data-box=zone-steer]');
            const [sx, sy] = at(zone.querySelector('.base'));
            fire(zone, 'pointerdown', 21, sx, sy);
            fire(zone, 'pointermove', 21, sx + 50, sy);
            const gas = document.querySelector('.padbtn[data-input=gas]');
            const boost = document.querySelector('.padbtn[data-input=boost]');
            const idle = getComputedStyle(gas).transform;
            fire(gas, 'pointerdown', 22, ...at(gas));
            fire(boost, 'pointerdown', 23, ...at(boost));
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            return { idle, pressed: getComputedStyle(gas).transform };
          });
          assert.notEqual(paint.pressed, paint.idle, `${tag}: a held button paints differently`);
          await shot(page, 'held-steer-gas-boost');
          await page.evaluate(() => {
            const b = document.querySelector('.padbtn[data-input=fire]');
            const r = b.getBoundingClientRect();
            b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 24, pointerType: 'touch', bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
          });
          await page.waitForTimeout(100);
          await shot(page, 'held-fire');
          await ctx.close();
        }
        // The launch cooling; the lobby with the stick on the right (the pad mirrors) and the Buttons tutorial.
        for (const [name, frag, right] of [['cooling', 'playing&round=racing&boost=140&cool=0.6', false], ['lobby-steer-right', 'playing&round=lobby', true]]) {
          const { ctx, page } = await open(frag);
          await (await toButtons(page, right))();
          await check(page, name);
          await shot(page, name);
          if (right) {
            assert.ok(await page.evaluate(() => {
              const [pad, steer] = ['[data-box=pad]', '[data-box=zone-steer]'].map((s) => document.querySelector(s).getBoundingClientRect());
              return pad.x < steer.x;
            }), `${tag}: with the stick on the right the pad is on the left`);
            await page.click('[data-act=help]');
            await wait(page, () => window.__jjTutorial.inspect()?.open === true);
            await shot(page, 'tutorial');
          }
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
}
