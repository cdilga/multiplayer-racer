import { confirmInitialVehicle } from './lib/vehicle.mjs';
// P1-C14: host keyboard players (add, remove, off) and controls you can find for every controller. Headless Chromium on the real
// host page served by jj-server, with the Gamepad API emulated and real key events (as c13-one-join). Each test is one acceptance
// row; JJ_CAPTURE_DIR=<dir> saves the visual self-review captures (docs/evidence/P1-C14).
//   node --test web/tests/journeys/c14-controls.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const CAPTURE = process.env.JJ_CAPTURE_DIR;
const shot = async (page, name) => {
  if (!CAPTURE) return;
  await page.mouse.move(2, 2); // the last click's pointer would hold the drawer open
  mkdirSync(CAPTURE, { recursive: true });
  await page.screenshot({ path: `${CAPTURE}/${name}.png` });
};
const BASE = '/p/c14/';
let browser;
let server;

before(async () => {
  server = await serve(build('./', `c14${process.env.JJ_BUILD_SUFFIX ?? ''}`), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

/** Emulated Gamepad API on the host page: `window.__pads` is what navigator.getGamepads() returns (null = unplugged). */
const PADS = () => {
  window.__pads = [null, null, null, null];
  navigator.getGamepads = () => window.__pads;
  window.__padAdd = (i) => {
    const pad = { index: i, id: `Test pad ${i}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pads[i] = pad;
    const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: pad });
    window.dispatchEvent(e);
  };
  window.__padSet = (i, axes, buttons = {}) => {
    const p = window.__pads[i];
    if (!p) return;
    p.axes = axes;
    for (const [b, v] of Object.entries(buttons)) p.buttons[b] = { pressed: v, value: v ? 1 : 0 };
  };
  window.__padUnplug = (i) => {
    const pad = window.__pads[i];
    window.__pads[i] = null;
    const e = new Event('gamepaddisconnected');
    Object.defineProperty(e, 'gamepad', { value: { ...pad, connected: false } });
    window.dispatchEvent(e);
  };
};

/** A host page. `room`: the real lobby (no cars); `drive`: free drive (a claimed seat drives at once). */
async function openHost(mode, viewport = { width: 1366, height: 768 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await ctx.addInitScript(PADS);
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${server.origin}${BASE}host?${mode}&test=live`);
  await wait(page, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 180_000);
  return page;
}
const seats = (page) => page.evaluate(() => window.__jjRoom.view().seats);
/** Seats that are still in the room (a seat that left stays as `Left`). */
const live = async (page) => (await seats(page)).filter((s) => s.presence !== 'Left');
const until = async (page, fn, why, ms = 30_000) => {
  for (const t0 = Date.now(); !(await fn()); await page.waitForTimeout(150)) assert.ok(Date.now() - t0 < ms, why);
};
const row = (page, source) => page.locator(`[data-jj-input-drawer] li[data-source="${source}"]`);
const act = (page, source, a) => row(page, source).locator(`button[data-act="${a}"]`);
const controllers = async (page) => { await page.evaluate(() => window.__jjChrome.openMenu()); await page.getByRole('button',{name:'Controllers',exact:true}).click(); };


test('AC1: every key cluster is listed before anyone joins; Add claims its seat with no key press, Leave removes it, Keyboard players off ignores the cluster keys', { timeout: 300_000 }, async () => {
  const page = await openHost('room');
  await controllers(page);
  // Listed up front, each with how to join and an Add button.
  for (const [source, key] of [[1, 'W'], [2, 'I']]) {
    assert.equal(await row(page, source).getAttribute('data-state'), 'press to join');
    assert.match(await row(page, source).innerText(), new RegExp(`press ${key} to join`));
    assert.equal(await act(page, source, 'add').count(), 1, `Add on cluster ${source}`);
  }
  assert.equal((await seats(page)).length, 0, 'listing a cluster claims nothing');
  await shot(page, 'drawer-lobby-before-join');

  // Add claims the seat as if pressed: no key went down.
  await act(page, 1, 'add').click();
  await until(page, async () => (await live(page)).some((s) => s.localSource === 1), 'Add never claimed a seat for Keys A');
  assert.equal((await live(page)).length, 1);
  await until(page, async () => (await row(page, 1).getAttribute('data-state')) === 'playing', 'the row says playing');
  assert.equal(await act(page, 1, 'leave').count(), 1, 'Leave on a seated cluster');
  const first = (await live(page))[0].seat;

  // Leave removes it.
  await act(page, 1, 'leave').click();
  await until(page, async () => (await live(page)).length === 0, 'Leave never took the seat');
  // The drawer projects local state on its own render clock; seat removal can precede that projection.
  await until(page, async () => (await row(page, 1).getAttribute('data-state')) === 'left', 'Leave never reached the visible drawer row');
  assert.equal(await row(page, 1).getAttribute('data-state'), 'left');
  // Add again is a new player (no press needed after Leave either).
  await act(page, 1, 'add').click();
  await until(page, async () => (await live(page)).length === 1, 'Add after Leave never claimed');
  assert.notEqual((await live(page))[0].seat, first, 'a new seat');
  await act(page, 1, 'leave').click();
  await until(page, async () => (await live(page)).length === 0, 'left again');

  // Keyboard players off: Keys B's keys do nothing, Add is disabled, and the choice is remembered for this browser.
  await page.locator('[data-jj-input-drawer] button[data-act="keys-toggle"]').click();
  assert.equal(await page.evaluate(() => window.__jjControls.keyboardPlayers()), false);
  assert.match(await page.locator('[data-jj-input-drawer] button[data-act="keys-toggle"]').innerText(), /off/);
  assert.equal(await act(page, 2, 'add').isDisabled(), true, 'Add is off while the keyboard is');
  await page.keyboard.down('KeyI');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyI');
  await page.keyboard.up('KeyW');
  assert.equal((await live(page)).length, 0, 'cluster keys are ignored while the keyboard players are off');
  assert.equal(await page.evaluate(() => localStorage.getItem('jj.hostKeyboardPlayers')), 'off');
  await shot(page, 'drawer-lobby-keyboard-off');
  // Back on: the same keys play.
  await page.locator('[data-jj-input-drawer] button[data-act="keys-toggle"]').click();
  await page.keyboard.down('KeyI');
  await until(page, async () => (await live(page)).some((s) => s.localSource === 2), 'Keys B never joined with the keyboard back on');
  await page.keyboard.up('KeyI');
});

test('AC2: an unplugged pad with a held seat shows Remove in the drawer, and Remove takes its seat and car away', { timeout: 300_000 }, async () => {
  const page = await openHost('drive');
  await page.evaluate(() => window.__padAdd(0));
  await page.evaluate(() => window.__padSet(0, [0, -1, 0, 0]));
  await until(page, async () => (await live(page)).some((s) => s.localSource === 100), 'the pad never claimed');
  await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0]));
  assert.equal(await act(page, 100, 'remove').count(), 0, 'plugged in: Leave, not Remove');
  const held = (await live(page)).find((s) => s.localSource === 100);
  await until(page, async () => (await page.evaluate(() => window.__jjTest.observe())).host.seats.some((s) => s.seat === held.seat && s.car !== null), 'the pad has a car');
  await page.evaluate(() => window.__padUnplug(0));
  await until(page, async () => (await row(page, 100).getAttribute('data-state')) === 'unplugged', 'the row never showed unplugged');
  assert.equal(await act(page, 100, 'remove').count(), 1, 'Remove for a held seat');
  assert.equal((await live(page)).length, 1, 'unplugging keeps the seat');
  await shot(page, 'drawer-unplugged-remove');
  await act(page, 100, 'remove').click();
  await until(page, async () => (await live(page)).length === 0, 'Remove never took the seat');
  // Its car stops being driven at once (no input, no autopilot); the body stays as scenery (S04c's rules), as c13's Remove.
  await until(page, async () => {
    const c = (await page.evaluate(() => window.__jjTest.observe())).cars.find((x) => x.car === held.car);
    return c && (c.autopilot ?? null) === null && Math.abs(c.input.throttle) < 0.01;
  }, 'its car never stopped');
  assert.equal(await row(page, 100).getAttribute('data-state'), 'left');
  assert.equal(await act(page, 100, 'remove').count(), 0);
});

/** Holds the pad's sticks at `axes` for `ms`, then lets go. Raw Gamepad axes: the left stick's y is -1 for up. */
const hold = (page, axes, ms = 350, i = 0) =>
  page.evaluate(
    async ([axes, ms, i]) => {
      window.__padSet(i, axes);
      await new Promise((r) => setTimeout(r, ms));
      window.__padSet(i, [0, 0, 0, 0]);
      await new Promise((r) => setTimeout(r, 150));
    },
    [axes, ms, i],
  );
const cards = (page) => page.evaluate(() => [...document.querySelectorAll('[data-controls] [data-card]')].map((c) => ({ card: c.dataset.card, seat: c.closest('[data-seat]')?.dataset.number, held: c.closest('[data-seat]')?.dataset.held })));

test('AC3: a pad that claims a seat gets its controls card on the lobby tile, which folds once its controls are used; holding Identify shows it again; the countdown folds a cluster card', { timeout: 400_000 }, async () => {
  const page = await openHost('room');
  await page.evaluate(() => window.__padAdd(0));
  assert.deepEqual(await cards(page), [], 'a plugged-in pad with no seat has no card');
  await hold(page, [0, 0, 1, 0]);
  await until(page, async () => (await cards(page)).some((c) => c.card === 'pad'), 'the pad card never showed on its tile');
  const [pad] = await cards(page);
  assert.equal(pad.seat, String((await live(page))[0].number), 'on the pad\'s own seat');
  assert.equal(await page.locator('[data-controls] [data-card="pad"] .jj-stick').count() > 0, true, 'drawn with sticks, not a phone');
  const box = await page.locator('[data-controls] [data-card="pad"]').boundingBox();
  assert.ok(box && box.width > 150 && box.height > 80, `the card is drawn at a readable size: ${JSON.stringify(box)}`);
  await shot(page, 'lobby-pad-card-1366x768');
  // Use the other controls one at a time: still showing until the last one.
  await hold(page, [0, 0, -1, 0]);
  await hold(page, [0, -1, 0, 0]);
  await hold(page, [0, 1, 0, 0]);
  await hold(page, [1, -0.3, 0, 0]);
  await hold(page, [0, 0, 0, -1]);
  await hold(page, [0, 0, 0, 1]);
  assert.equal((await cards(page)).length, 1, 'six of seven used: the card is still there');
  await page.evaluate(async () => {
    window.__padSet(0, [0, 1, 0, 0]); // pull the left stick all the way back, hold, snap forward: the launch
    await new Promise((r) => setTimeout(r, 600));
    window.__padSet(0, [0, -1, 0, 0]);
    await new Promise((r) => setTimeout(r, 350));
    window.__padSet(0, [0, 0, 0, 0]);
  });
  await until(page, async () => (await cards(page)).length === 0, `the card never folded after every control was used: ${JSON.stringify(await page.evaluate(() => window.__jjControls.sources().map((s) => s.used)))}`);
  // Holding Identify (View, button 8) shows it again for as long as it is held.
  await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: true }));
  await until(page, async () => (await cards(page)).some((c) => c.card === 'pad' && c.held === 'true'), 'holding Identify never showed the card');
  await shot(page, 'lobby-pad-card-identify-held-1366x768');
  await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: false }));
  await until(page, async () => (await cards(page)).length === 0, 'the card never folded after Identify was let go');

  // A key cluster claims from Host menu → Controllers.
  await controllers(page);
  await act(page, 1, 'add').click();
  await page.evaluate(()=>window.__jjChrome.closeMenu());
  await until(page, async () => (await cards(page)).some((c) => c.card === 'keys-1'), 'the Keys A card never showed');
  assert.match(await page.locator('[data-controls] [data-card="keys-1"]').innerText(), /W[\s\S]*S/);
  await shot(page, 'lobby-keys-card-1366x768');
  await page.evaluate(() => window.__jjRoom.start()); // the host's Start race
  await until(page, async () => ['Preparing', 'Countdown', 'Running'].includes(await page.evaluate(() => window.__jjRoom.view().phase)), 'the round never started', 90_000);
  assert.equal((await cards(page)).length, 0, 'no card in the countdown');
});

test('AC4: tutorial prompts in a race show the source\'s own glyphs: keys for a cluster, stick glyphs for a pad, never a touch hint', { timeout: 400_000 }, async () => {
  const page = await openHost('room');
  await controllers(page);
  await act(page, 1, 'add').click();
  await page.evaluate(()=>window.__jjChrome.closeMenu());
  await until(page, async () => (await live(page)).length === 1, 'Keys A joined');
  await page.evaluate(() => window.__padAdd(0));
  await hold(page, [0, 0, 1, 0]);
  await until(page, async () => (await live(page)).length === 2, 'the pad joined');
  await page.locator('[data-local-use="1"]').click();
  await page.locator('[data-local-use="100"]').click();
  // Both ready: the room starts (E is Keys A's READY, button 9 the pad's).
  await page.keyboard.down('KeyE');
  await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 9: true }));
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyE');
  await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 9: false }));
  await wait(page, () => window.__jjRoom.view().phase !== 'Lobby', undefined, 15000).catch(async e => { console.log('C14 readiness', JSON.stringify(await page.evaluate(()=>({room:window.__jjRoom.view(), sources:window.__jjControls.sources(), choices:window.__jjControls.vehicleChoices()})))); throw e; });
  await wait(page, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);
  const prompts = () => page.evaluate(() => [...document.querySelectorAll('.hud-tile [data-prompt]')].filter((e) => !e.hidden).map((e) => ({ kind: e.querySelector('[data-glyphs]')?.dataset.glyphs ?? null, text: e.textContent, keys: [...e.querySelectorAll('kbd')].map((k) => k.textContent), sticks: e.querySelectorAll('.jj-stick').length })));
  await until(page, async () => (await prompts()).length === 2, 'a prompt on each tile', 60_000);
  const ps = await prompts();
  const keys = ps.find((p) => p.kind === 'keys');
  const padp = ps.find((p) => p.kind === 'pad');
  assert.ok(keys && padp, `one prompt per source kind: ${JSON.stringify(ps)}`);
  assert.deepEqual(keys.keys, ['D', 'A'], 'Keys A: steer is D then A');
  assert.ok(padp.sticks >= 2 && padp.keys.length === 0, 'the pad shows stick glyphs and no keys');
  for (const p of ps) assert.doesNotMatch(p.text, /touch|tap|thumb|finger|screen/i, 'never a touch hint');
  await shot(page, 'race-prompts-keys-and-pad-1366x768');
});

test('AC5: the host menu\'s Controls page has a card per source kind, and its key labels follow clusters.json (a test changes the data and the page changes)', { timeout: 300_000 }, async () => {
  const { readFileSync } = await import('node:fs');
  const file = JSON.parse(readFileSync(new URL('../../host/src/input/clusters.json', import.meta.url), 'utf8'));
  const page = await openHost('room');
  assert.deepEqual(await page.evaluate(() => window.__jjControls.data().clusters), file.clusters, 'the page reads clusters.json');
  await page.evaluate(() => window.__jjChrome.openControls());
  const back = await page.locator('[data-controls-view] [data-act=host-menu]').boundingBox();
  const panel = await page.locator('[data-controls-view]').boundingBox();
  assert.ok(back && panel && back.y >= panel.y && back.y + back.height <= panel.y + panel.height - 4, 'Back stays fully inside the Controls panel');
  const ids = () => page.evaluate(() => [...document.querySelectorAll('[data-controls-page] [data-card]')].map((c) => c.dataset.card));
  assert.deepEqual(await ids(), ['phone', 'pad', 'wheel', ...file.clusters.map((c) => `keys-${c.id}`)]);
  const keysOf = (id) => page.evaluate((id) => [...document.querySelectorAll(`[data-controls-page] [data-card="${id}"] kbd`)].map((k) => k.dataset.code), id);
  const c1 = file.clusters[0];
  assert.deepEqual(await keysOf('keys-1'), [c1.drive.left, c1.drive.right, c1.drive.up, c1.drive.down, c1.action.left, c1.action.right, c1.drive.down, c1.drive.up, c1.action.up, c1.action.down, c1.identify, c1.ready]);
  assert.equal(await page.locator('[data-controls-page] [data-card="phone"] kbd, [data-controls-page] [data-card="pad"] kbd').count(), 0, 'no keycaps on a phone or pad card');
  await shot(page, 'host-menu-controls-1366x768');
  // Change the data: Keys A's throttle moves to Z and another cluster appears; the page follows, with no rebuild.
  await page.evaluate(() => {
    const d = structuredClone(window.__jjControls.data());
    d.clusters[0].drive.up = 'KeyZ';
    d.clusters.push({ id: 4, label: 'Keys D', drive: { up: 'Digit8', down: 'Digit2', left: 'Digit4', right: 'Digit6' }, action: { up: 'Numpad8', down: 'Numpad2', left: 'Numpad4', right: 'Numpad6' }, identify: 'Digit7', ready: 'Digit9' });
    window.__jjControls.setData(d);
  });
  await page.evaluate(() => window.__jjChrome.closeMenu());
  await page.evaluate(() => window.__jjChrome.openControls());
  assert.deepEqual(await ids(), ['phone', 'pad', 'wheel', ...file.clusters.map((c) => `keys-${c.id}`), 'keys-4']);
  assert.ok((await keysOf('keys-1')).includes('KeyZ') && !(await keysOf('keys-1')).includes('KeyW'), 'Keys A shows Z, not W');
  assert.match(await page.locator('[data-controls-page] [data-card="keys-4"]').innerText(), /keys d/i);
  await page.evaluate(() => window.__jjChrome.closeMenu());
});

test('AC5: the phone\'s Help has the same Controls page', { timeout: 300_000 }, async () => {
  const { readFileSync } = await import('node:fs');
  const file = JSON.parse(readFileSync(new URL('../../host/src/input/clusters.json', import.meta.url), 'utf8'));
  const host = await openHost('room');
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(page);
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.locator('[data-act=controls]').click();
  assert.equal(await page.evaluate(() => window.__jjTutorial.inspect().page), 'controls');
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-controls-page] [data-card]')].map((c) => c.dataset.card));
  assert.deepEqual(ids, ['phone', 'pad', 'wheel', ...file.clusters.map((c) => `keys-${c.id}`)]);
  const keys = await page.evaluate(() => [...document.querySelectorAll('[data-controls-page] [data-card="keys-1"] kbd')].map((k) => k.dataset.code));
  assert.ok(keys.includes(file.clusters[0].identify) && keys.includes(file.clusters[0].ready));
  await shot(page, 'phone-help-controls-844x390');
  await page.locator('[data-act=back]').click();
  assert.equal(await page.evaluate(() => window.__jjTutorial.inspect().page), 'steps');
});

// ---------- Visual self-review captures (JJ_CAPTURE_DIR): the lobby, the race, Help -> Controls and the drawer at TV and laptop sizes,
// with and without cards. Looked at by hand (docs/evidence/P1-C14/self-review.md); the geometry checks below are the part a test can say.
const SIZES = { tv: { width: 1920, height: 1080 }, laptop: { width: 1366, height: 768 } };
const useAll = async (page, i) => {
  for (const axes of [[0, 0, -1, 0], [0, -1, 0, 0], [0, 1, 0, 0], [1, -0.3, 0, 0], [0, 0, 0, -1], [0, 0, 0, 1]]) await hold(page, axes, 300, i);
  await page.evaluate(async (i) => {
    window.__padSet(i, [0, 1, 0, 0]);
    await new Promise((r) => setTimeout(r, 600));
    window.__padSet(i, [0, -1, 0, 0]);
    await new Promise((r) => setTimeout(r, 350));
    window.__padSet(i, [0, 0, 0, 0]);
  }, i);
};
const tap = async (page, key, ms = 330) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};
for (const [name, viewport] of Object.entries(SIZES)) {
  test(`self-review captures at ${name}`, { skip: !CAPTURE, timeout: 600_000 }, async () => {
    const page = await openHost('room', viewport);
    const at = (what) => `${what}-${name}-${viewport.width}x${viewport.height}`;
    await shot(page, at('lobby-empty-drawer'));
    await controllers(page);
    // Four sources claim seats: two pads and both clusters, each with its card.
    await act(page, 1, 'add').click();
    await act(page, 2, 'add').click();
    await page.evaluate(()=>window.__jjChrome.closeMenu());
    await page.evaluate(() => {
      window.__padAdd(0);
      window.__padAdd(1);
    });
    await hold(page, [0, 0, 1, 0], 300, 0);
    await hold(page, [0, 0, 1, 0], 300, 1);
    await until(page, async () => (await cards(page)).length === 4, 'four cards');
    await shot(page, at('lobby-four-cards'));
    // The strip never covers the roster's cards, the Start race button or the QR.
    const rects = await page.evaluate(() => {
      const r = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().toJSON());
      return { strip: r('[data-controls] .lb-cc'), roster: r('.lcard'), start: r('[data-act=start]'), qr: r('.lb-join .qr-card') };
    });
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const s of rects.strip) for (const o of [...rects.roster, ...rects.start, ...rects.qr]) assert.ok(!hit(s, o), `a controls card covers something: ${JSON.stringify([s, o])}`);
    // Without cards: every control used on every source.
    await useAll(page, 0);
    await useAll(page, 1);
    for (const k of ['KeyD', 'KeyA', 'KeyW', 'KeyS', 'KeyF', 'KeyT', 'KeyG']) await tap(page, k);
    await tap(page, 'KeyS', 600);
    await tap(page, 'KeyW', 350);
    for (const k of ['KeyL', 'KeyJ', 'KeyI', 'KeyK', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) await tap(page, k);
    await tap(page, 'KeyK', 600);
    await tap(page, 'KeyI', 350);
    await until(page, async () => (await cards(page)).length === 0, 'every card folded', 60_000);
    await shot(page, at('lobby-four-seats-no-cards'));
    // The drawer open (hover), and the host menu's Controls page.
    await controllers(page);
    await page.screenshot({ path: CAPTURE + '/' + at('drawer-open-lobby') + '.png' });
    await page.evaluate(() => window.__jjChrome.openControls());
    await shot(page, at('host-menu-controls'));
    await page.evaluate(() => window.__jjChrome.closeMenu());
    // The race: prompts, then holding Identify shows the card in the prompt's slot.
    await page.evaluate(() => window.__jjRoom.start());
    await wait(page, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);
    await page.waitForTimeout(1500);
    await shot(page, at('race-no-card'));
    await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: true }));
    await page.keyboard.down('KeyQ');
    await wait(page, () => document.querySelectorAll('[data-prompt][data-card=identify] [data-card]').length === 2);
    await shot(page, at('race-identify-held-cards'));
    await page.evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: false }));
    await page.keyboard.up('KeyQ');
    await wait(page, () => document.querySelectorAll('[data-prompt][data-card=identify] [data-card]').length === 0);
    await page.evaluate(() => window.__jjChrome.openMenu());
    await shot(page, at('race-pause-menu'));
    await page.evaluate(() => window.__jjChrome.openControls());
    await shot(page, at('race-pause-controls'));
  });
}
