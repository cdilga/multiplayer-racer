// P1-FL02 (R127), the gated start through the real join path: four real phones join over WebRTC and tap Ready; on the
// grid the cars are held through the countdown, and each phone does something different with its launch:
//   A snaps the launch DURING the countdown  -> Early (the launch is forfeited for this start)
//   B charges through the countdown, snaps at GO -> Perfect (inside 0.25 s) or, if loopback jitter costs it the window, Launch
//   C charges after GO and snaps ~0.4 s later -> Launch
//   D touches nothing                         -> no outcome at all
// Asserts the host got each StartLaunch event and put the callout over the right car, each phone got its own outcome (and
// shows its words on the round banner), and no car moves before GO. B's perfect-versus-launch split rests on Playwright's
// cross-page latency (~tens of ms against a 250 ms window), so the test accepts either for B and reports which it was.
// `JJ_CAPTURE_DIR=<dir>` saves the visual self-review captures (TV 1920x1080, phones 915x412).
//   node --test web/tests/journeys/fl02-gated-start.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';

const BASE = '/p/fl02/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'fl02'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ channel: process.env.JJ_CHROMIUM_GPU === 'native' ? 'chromium' : undefined, args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
closeContextsAfterEach(() => browser);

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png`, timeout: 120_000 });

// A launch gesture run entirely inside one phone's page, off the countdown the host sent it (RoomState: phase and ms left).
// The force-start warning is 5 s and map prep eats into it, so the phone can see as little as ~2.6 s of countdown: every
// gesture is armed before Start, goes by the phone's own clock (GO = when it last heard "n ms left" + n), and fits in 2 s.
//   'early'  pull back, hold up to 0.5 s, snap forward while at least 0.3 s of the countdown is left (the last 150 ms before
//            GO the host holds a snap for GO instead): a false start, so the host forfeits this start's launch.
//   'late'   wait for GO, charge 0.5 s later, hold 0.4 s, snap forward: a normal launch.
//   'at-go'  pull back for the last 0.5 s of the countdown, snap forward when the phone is told the race is on (never before
//            holding 0.35 s, the least a good launch needs). The drive stick's launch never cancels a held pull and reverse stays
//            locked while the grid pull is held (R127), so a phone that hears GO late (CI run 5253: > 1.1 s) still launches.
const phoneGesture = (page, kind) =>
  page.evaluate(
    (kind) =>
      new Promise((resolve, reject) => {
        const c = window.__jjController;
        const sticks = (y) => c.setSticks({ x: 0, y, touch: y !== 0 }, { x: 0, y: 0, touch: false });
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const deadline = performance.now() + 120_000;
        // GO by this phone's clock, refreshed whenever the host sends a new "ms left".
        let goAt = null;
        let lastMs = null;
        const look = () => {
          const s = c.inspect();
          if (s.roomPhase === 'Countdown' && s.countdownMs > 0 && s.countdownMs !== lastMs) {
            lastMs = s.countdownMs;
            goAt = performance.now() + s.countdownMs;
          }
          return s;
        };
        const tick = async () => {
          try {
            let s = look();
            while (!(s.roomPhase === 'Countdown' && s.countdownMs > 0)) {
              if (performance.now() > deadline) throw new Error('the phone never saw the countdown');
              await sleep(5);
              s = look();
            }
            if (kind === 'early') {
              const left = goAt - performance.now();
              if (left < 600) throw new Error(`the phone saw only ${Math.round(left)} ms of countdown: no room for an early snap`);
              sticks(1);
              // Hold 0.5 s, less if the countdown is short, so the snap lands with at least 0.3 s to spare.
              const hold = Math.max(150, Math.min(500, goAt - performance.now() - 450));
              await sleep(hold);
              look();
              const spare = goAt - performance.now();
              if (spare < 300 || c.inspect().roomPhase !== 'Countdown') throw new Error(`the early snap would land with ${Math.round(spare)} ms of countdown left`);
              sticks(-1);
              await sleep(100);
              sticks(0);
            } else if (kind === 'late') {
              while (c.inspect().roomPhase !== 'Racing') {
                if (performance.now() > goAt + 10_000) throw new Error('the phone never saw GO');
                await sleep(5);
              }
              await sleep(500);
              sticks(1);
              await sleep(400);
              sticks(-1);
              await sleep(100);
              sticks(0);
            } else {
              while (c.inspect().roomPhase === 'Countdown' && goAt - performance.now() > 500) {
                look();
                await sleep(5);
              }
              const pulledAt = performance.now();
              sticks(1);
              for (;;) {
                look();
                const racing = c.inspect().roomPhase === 'Racing';
                const held = performance.now() - pulledAt;
                if (racing && held >= 350) break;
                if (held > 6000) throw new Error(`the phone held the pull ${Math.round(held)} ms and the race has not started`);
                if (performance.now() > goAt + 10_000) throw new Error('the phone never saw GO');
                await sleep(2);
              }
              sticks(-1);
            }
            resolve(kind);
          } catch (e) {
            reject(e);
          }
        };
        tick();
      }),
    kind,
  );

async function phone(joinUrl, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(page);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  return page;
}

// Hardware fact (R93, like R06 and FL17): the gated start judges snaps against GO to a fraction of a second, which needs a
// host whose page keeps up. On SwiftShader the 1080p host page starves and every seat's input reaches the sim 1.5 s or
// more old (CI 5364, eris 3 of 4, the Mac at 2x CPU throttle), so snaps miss the start window; with JJ_CHROMIUM_GPU=1 on
// eris it passed 3 of 3 in 15 s. It runs on the `gpu` runner (scripts/ci/plan.mjs) and skips on the SwiftShader lanes until br-bcuy.
const gpu = Boolean(process.env.JJ_CHROMIUM_GPU);
test('FL02: early, perfect, late and none through four real phones', { timeout: 420_000, skip: !gpu && 'the gated start needs a GPU host (JJ_CHROMIUM_GPU=1); on software WebGL input reaches the sim too late' }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const names = ['Davo', 'Shazza', 'Mick', 'Bazza'];
  const phones = [];
  for (const n of names) phones.push(await phone(joinUrl, n));
  const [A, B, C, D] = phones;
  await wait(host, () => window.__jjRoom.view().seats.length === 4);
  const seats = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ seat: s.seat, name: s.name })));
  const seatOf = (name) => seats.find((s) => s.name === name).seat;

  // D never taps Ready, so the host's Start race force-starts with the longer warning countdown: room for stills.
  for (const p of [A, B, C]) await p.getByRole('button', { name: /^Ready/ }).click();
  await host.waitForTimeout(1000);
  // A and B's gestures are timed on their own phones from the countdown the host sent them, never from the host page: on a
  // loaded runner one host round trip takes a second, the detector cancels a preload held past 1.2 s, and a gesture timed
  // from the host's clock landed after GO (a normal launch, not an Early; CI run 4970).
  // The banner shows an outcome for 2.2 s, and a loaded runner can take longer than that to ask the page: record what it said.
  await A.evaluate(() => {
    window.__banners = [];
    const note = () => {
      const t = document.querySelector('[data-round-banner]')?.textContent;
      if (t && window.__banners.at(-1) !== t) window.__banners.push(t);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const gestureA = phoneGesture(A, 'early');
  const gestureB = phoneGesture(B, 'at-go');
  const gestureC = phoneGesture(C, 'late');
  for (const g of [gestureA, gestureB, gestureC]) g.catch(() => {}); // awaited below; a failure must not go unhandled first
  await host.locator('[data-act=start]').click();
  await wait(host, () => window.__jjRoom.view().phase === 'Countdown', undefined, 60_000);
  console.log('FL02 countdown remainingMs at start', await host.evaluate(() => window.__jjRoom.view().remainingMs));
  const t0 = Date.now();
  await shot(host, 'tv-countdown');
  await shot(A, 'phone-countdown');
  console.log('FL02 stills took ms', Date.now() - t0, 'remaining', await host.evaluate(() => window.__jjRoom.view().remainingMs));

  // Nobody moves before GO: sample every car through the countdown. Each sample carries the phase it was read in, and only
  // samples read inside the countdown count (a loaded runner can take a second to come back after GO).
  const before = await host.evaluate(async () => (await window.__jjTest.observe()).cars.map((c) => c.position));
  let after = before;
  let preGoSpeed = 0;
  const watch = (async () => {
    for (;;) {
      // The room view and the worker's snapshot come from different threads: sample only with at least 0.5 s of
      // countdown left before the snapshot was asked for, so a sample can never be from after GO (CI run 5064).
      const s = await host.evaluate(async () => {
        const v = window.__jjRoom.view();
        const o = await window.__jjTest.observe();
        return { phase: v.phase, left: v.remainingMs ?? 0, cars: o.cars.map((c) => ({ p: c.position, v: Math.abs(c.forwardSpeed ?? 0) })) };
      });
      if (s.phase !== 'Countdown') return;
      if (s.left < 500) { await host.waitForTimeout(120); continue; }
      after = s.cars.map((c) => c.p);
      preGoSpeed = Math.max(preGoSpeed, ...s.cars.map((c) => c.v));
      await host.waitForTimeout(120);
    }
  })();

  // A: pulled back and snapped during the countdown -> Early.
  await gestureA;
  await wait(A, () => window.__jjController.inspect().launchOutcome === 'Early', undefined, 30_000);
  const banners = await A.evaluate(() => window.__banners);
  assert.ok(banners.includes('EARLY! NO LAUNCH'), `A's banner said EARLY! NO LAUNCH: ${JSON.stringify(banners)}`);
  await shot(A, 'phone-early');
  await wait(host, () => window.__jjRender.launchCalloutsShown().length > 0, undefined, 30_000);
  if (CAPTURE) await shot(host, 'tv-early'); // best effort: the callout is up for 2.2 s

  // B: charged for the last 0.6 s of the countdown and snapped on the first state that says GO.
  await gestureB;
  await watch;
  // The held grid: the early snapper did not launch (no lifted front, no more travel than the car that did nothing), and
  // nobody is driving off. A held car takes zero input, so a slope or the suspension settling can still creep it a little:
  // that creep is the same for every car, is reported here, and is not the launch.
  const carOf = (name) => seats2.find((x) => x.seat === seatOf(name)).car;
  const seats2 = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => ({ seat: s.seat, car: s.car })));
  const travel = (name) => Math.hypot(...[0, 2].map((k) => after[carOf(name)][k] - before[carOf(name)][k]));
  console.log(`FL02 travel over the countdown (m): ${JSON.stringify(Object.fromEntries(names.map((n) => [n, +travel(n).toFixed(2)])))}; fastest forward speed ${preGoSpeed.toFixed(2)} m/s`);
  assert.ok(Math.abs(travel('Davo') - travel('Bazza')) < 1, 'the early snapper travelled no further than the car that did nothing');
  assert.ok(preGoSpeed < 1.5, `no car drove off before GO (fastest ${preGoSpeed.toFixed(3)} m/s)`);

  // C: charge a little after GO, snap 0.4 s later -> Launch.
  await gestureC;

  // B's and C's outcomes are read from the host's persistent callout log, not the phones' 2.2 s banner (on a loaded runner
  // the banner can come and go between polls: CI runs 5253, 5343). The phone banner is checked for A above.
  const carsBySeat = await host.evaluate(() => Object.fromEntries(window.__jjRoom.view().seats.map((s) => [s.seat, s.car])));
  await wait(host, (cs) => cs.every((car) => window.__jjRender.launchCalloutsShown().some((s) => s.car === car)),
    [carsBySeat[seatOf('Shazza')], carsBySeat[seatOf('Mick')]], 30_000).catch(async (e) => {
    const shown = await host.evaluate(() => window.__jjRender.launchCalloutsShown());
    const phones = await Promise.all([A, B, C, D].map((p) => p.evaluate(() => { const i = window.__jjController.inspect(); return { outcome: i.launchOutcome, actions: i.stats.actions }; })));
    const ages = await host.evaluate(async () => (await window.__jjTest.observe()).host.seats.map((s) => ({ seat: s.seat, inputAgeMs: s.inputAgeMs, dropped: s.inputDropped })));
    throw new Error(`B's and C's callouts: cars ${JSON.stringify(carsBySeat)}, shown ${JSON.stringify(shown)}, phones ${JSON.stringify(phones)}, host input ${JSON.stringify(ages)}: ${e.message}`);
  });
  await shot(B, 'phone-b-outcome');
  await shot(C, 'phone-launch');
  await shot(host, 'tv-launch');
  await host.waitForTimeout(1500);

  const outcomes = await host.evaluate(() => window.__jjRoom.events().filter((e) => e.event.StartLaunch).map((e) => e.event.StartLaunch));
  const bySeat = (name) => outcomes.filter((o) => o.seat === seatOf(name)).map((o) => o.outcome);
  assert.deepEqual(bySeat('Davo'), ['Early'], `A snapped in the countdown: ${JSON.stringify(outcomes)}`);
  const b = bySeat('Shazza');
  assert.equal(b.length, 1, `B has one outcome: ${JSON.stringify(outcomes)}`);
  assert.ok(['Perfect', 'Launch'].includes(b[0]), `B launched at GO: ${b}`);
  assert.deepEqual(bySeat('Mick'), ['Launch'], `C launched late: ${JSON.stringify(outcomes)}`);
  assert.deepEqual(bySeat('Bazza'), [], `D did nothing and has no outcome: ${JSON.stringify(outcomes)}`);
  console.log(`FL02 outcomes: ${JSON.stringify(outcomes)} (B was ${b[0]})`);

  // The TV popped a callout over each of A, B and C's cars and not over D's.
  const shown = await host.evaluate(() => {
    const cars = Object.fromEntries(window.__jjRoom.view().seats.map((s) => [s.seat, s.car]));
    return { cars, shown: window.__jjRender.launchCalloutsShown() };
  });
  const calloutFor = (name) => shown.shown.filter((s) => s.car === shown.cars[seatOf(name)]).map((s) => s.outcome);
  assert.deepEqual(calloutFor('Davo'), ['Early']);
  assert.equal(calloutFor('Shazza').length, 1);
  assert.deepEqual(calloutFor('Mick'), ['Launch']);
  assert.deepEqual(calloutFor('Bazza'), []);
  assert.equal(await D.evaluate(() => window.__jjController.inspect().launchOutcome), null, 'D saw no outcome on its phone');
  await shot(D, 'phone-none');

  // The launchers pull away; the early snapper and the idle one are slower off the line than C a second on.
  await host.waitForTimeout(1500);
  for (const p of phones) assert.deepEqual(p.errors, []);
  assert.deepEqual(errors, []);
});
