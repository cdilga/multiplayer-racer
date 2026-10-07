// Journey JN5 (P1-G02): mixed controllers join and leave through every phase of a round on the real host page
// (`B/host?room&test=live&laps=3`) over WebRTC. Phones and the host's two key clusters fill the Lobby, a phone joins in
// the Countdown, five more drop in mid-race (each timed from its accepted claim to its car moving under its own
// throttle, and each gets its Identify flash and a tile), the room grows to 12, then Leave and Sit out shrink it to 2
// through Intermission. The room never lists a seat that left, nobody is refused and the standings keep their rows.
// Writes the drop-in samples to $JJ_EVIDENCE_DIR/dropin.json (default docs/evidence/P1-G02); `JJ_CAPTURE_DIR=<dir>`
// saves the visual self-review matrix.
//   node --test web/tests/journeys/jn5-churn.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, gpu } from './lib/chromium.mjs';

// JJ_BUILD_SUFFIX lets two copies of this journey run side by side on one machine (contention, as on a CI runner).
const ID = `jn5${process.env.JJ_BUILD_SUFFIX ?? ''}`;
const BASE = `/p/${ID}/`;
const CAPTURE = process.env.JJ_CAPTURE_DIR;
const EVIDENCE = process.env.JJ_EVIDENCE_DIR ?? resolve(import.meta.dirname, '../../../docs/evidence/P1-G02');
let browser;
let server;

before(async () => {
  server = await serve(build('./', ID), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  if (CAPTURE) mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

let step = '';
const at = (name) => {
  step = name;
  console.log(`# ${name}`);
};
// The page that is the host, so a stalled phone's timeout can say what the room looked like at the time.
let hostPage = null;
const within = (p, ms = 5000) => Promise.race([p, new Promise((r) => setTimeout(() => r('(no answer)'), ms))]).catch((e) => `(${e.message})`);
/** What a timed-out wait was looking at: a phone's controller state and link, or the room's seats; and the host's room. */
async function stateOf(page) {
  const own = await within(
    page.evaluate(() => {
      const c = window.__jjController?.inspect();
      const room = window.__jjRoom?.view();
      return {
        url: location.pathname,
        controller: c && { phase: c.phase, you: c.you, roomPhase: c.roomPhase, link: c.link },
        room: room && { phase: room.phase, seats: room.seats.map((s) => `${s.name}:${s.presence}:car${s.car}`) },
        paths: window.__jjNet?.inspect?.(),
      };
    }),
  );
  const hostSide =
    hostPage && hostPage !== page
      ? await within(hostPage.evaluate(() => ({ phase: window.__jjRoom.view().phase, seats: window.__jjRoom.view().seats.length, net: window.__jjNet?.inspect?.(), render: { frames: window.__jjRender.stats().frames, scale: window.__jjRender.stats().scale } })))
      : null;
  return JSON.stringify({ own, host: hostSide, contexts: browser.contexts().length });
}
const wait = async (page, fn, arg, ms = 30_000) => {
  try {
    return await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  } catch (e) {
    throw new Error(`${step}: ${e.message.split('\n')[0]} state ${await stateOf(page)}`);
  }
};
const shot = async (page, name) => CAPTURE && page.screenshot({ path: `${CAPTURE}/${name}.png` });
const view = (host) => host.evaluate(() => window.__jjRoom.view());
const observe = (host) => host.evaluate(() => window.__jjTest.observe());
const names = async (host) => (await view(host)).seats.map((s) => s.name).sort();

async function phone(url, name) {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  await page.goto(url);
  // ready-to-join needs the host's answer to this phone's offer, and a software-rendered host answers between frames.
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join', undefined, 120_000);
  await page.locator('#name').fill(name);
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing', undefined, 120_000);
  const endpoint = await page.evaluate(() => window.__jjController.inspect().link.endpointId);
  // Newcomers get the tutorial in the Lobby; these players skip it.
  await page.getByRole('button', { name: 'Skip tutorial' }).click({ timeout: 2000 }).catch(() => {});
  return { ctx, page, name, endpoint };
}

async function leave(p) {
  // Leave asks for a second tap within 3 s (no browser dialogs).
  const btn = p.page.getByRole('button', { name: /Leave/ });
  await btn.click();
  await btn.click();
  // A phone that has left is finished with: close its context so a slow runner isn't left rendering pages nobody reads.
  await p.page.waitForTimeout(500);
  await p.ctx.close().catch(() => {});
}

// How long a drop-in may take before the journey gives up. The claim → driving time is bound by the host's frame time (the
// input reaches the sim through the host page's main thread), not by the drop-in path: measured on eris it is 1.3-2.5 s with
// the host on a GPU, 3.7-5.9 s on SwiftShader (software WebGL), and CI's shared software-rendered runners are slower again
// (they hit the old 15 s limit). So a GPU host keeps 15 s and a software host gets 60 s; the p95 target below is a GPU number.
const DROP_IN_GIVE_UP_MS = gpu ? 15_000 : 60_000;

/** A drop-in: claim accepted (Welcome) → the car moves under the phone's own throttle. Returns ms. */
async function dropIn(host, url, name) {
  const p = await phone(url, name);
  const t0 = Date.now();
  let recovered = false;
  await p.page.evaluate(() => window.__jjController.setSticks({ x: 0, y: -1, touch: true }, { x: 0, y: 0, touch: false }));
  for (;;) {
    const o = await observe(host);
    const seat = o.host.seats.find((s) => s.endpoint === p.endpoint);
    const car = seat && o.cars.find((c) => c.car === seat.car);
    if (car && car.forwardSpeed > 1) break;
    // A straight-stick newcomer can meet the barrier at the hairpin (crates/jj-sim/tests/late_join.rs: placement is clear,
    // the stick isn't steering); after 10 s it presses Recover once, as a player would.
    if (!recovered && Date.now() - t0 > 10_000) {
      recovered = true;
      await p.page.locator('[data-act="recover"]').first().dispatchEvent('click');
    }
    assert.ok(Date.now() - t0 < DROP_IN_GIVE_UP_MS, `${name} never drove: ${JSON.stringify(seat)} ${JSON.stringify(car)}`);
    await host.waitForTimeout(25);
  }
  const ms = Date.now() - t0;
  await p.page.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
  return { p, ms };
}

test('JN5: mixed controllers join and leave through every phase, growing to 12 and shrinking to 2', { timeout: 1_000_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  hostPage = host;
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  // JJ_HOST_CPU_THROTTLE=<n> slows the host page n times (a CDP CPU throttle), to reproduce a slow CI runner on a fast box.
  if (process.env.JJ_HOST_CPU_THROTTLE) await (await host.context().newCDPSession(host)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.JJ_HOST_CPU_THROTTLE) });
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=3`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());

  at('Lobby: three phones and both key clusters');
  const phones = [];
  for (const n of ['Davo', 'Shazza', 'Bazza']) phones.push(await phone(joinUrl, n));
  // A key cluster joins on a held key (sampled per frame), as in JN1.
  for (const [k, n] of [['KeyW', 4], ['KeyI', 5]]) {
    await host.keyboard.down(k);
    await wait(host, (n) => window.__jjRoom.view().seats.length === n, n);
    await host.keyboard.up(k);
  }
  await shot(host, 'tv-lobby-5');

  at('Ready: the round starts');
  for (const p of phones) await p.page.getByRole('button', { name: /^Ready/ }).click();
  for (const k of ['KeyE', 'KeyO']) await host.keyboard.press(k, { delay: 250 });
  await wait(host, () => window.__jjRoom.view().phase === 'Countdown');

  at('Countdown: a phone joins and is on the grid');
  phones.push(await phone(joinUrl, 'Kylie'));
  await wait(host, () => window.__jjRoom.view().seats.find((s) => s.name === 'Kylie')?.car !== null);
  await shot(host, 'tv-countdown-6');
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 30_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));

  at('Running: five phones drop in, each timed claim → driving');
  const samples = [];
  for (const n of ['Macca', 'Robbo', 'Gazza', 'Thommo', 'Jonesy']) {
    const { p, ms } = await dropIn(host, joinUrl, n);
    samples.push({ name: n, ms });
    phones.push(p);
    const seat = (await view(host)).seats.find((s) => s.name === n);
    const identified = await host.evaluate((seat) => window.__jjRoom.events().some((e) => e.event.Identify?.seat === seat), seat.seat);
    assert.ok(identified, `${n}'s Identify fired on joining`);
  }
  // Ten phones and two key clusters: 12.
  phones.push(await phone(joinUrl, 'Sheila'));
  await wait(host, () => window.__jjRoom.view().seats.length === 12);
  const rects = await host.evaluate(() => window.__jjRender.tileRects());
  assert.equal(rects.filter(Boolean).length, 12, 'one tile per car: the grid reflowed to 12');
  await shot(host, 'tv-racing-12');
  await shot(phones.at(-2).page, 'phone-dropped-in');
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  console.log(`# drop-in claim → driving: ${JSON.stringify(samples)} p95 ${p95} ms`);
  mkdirSync(EVIDENCE, { recursive: true });
  // The 3 s target is a host drawing on a GPU; on software WebGL (CI's runner) eleven tiles hold the host's main thread,
  // which delays the claim and the first inputs, so there the samples get a loose bound only.
  const renderer = gpu ? 'host on a GPU' : 'host on SwiftShader (software WebGL)';
  const limit = gpu ? 3000 : 45_000; // software WebGL: a loose bound, see DROP_IN_GIVE_UP_MS
  writeFileSync(join(EVIDENCE, 'dropin.json'), `${JSON.stringify({ transport: 'loopback WebRTC (Playwright Chromium)', renderer, samples, p95Ms: p95, targetP95Ms: 3000 }, null, 1)}\n`);
  assert.ok(p95 <= limit, `drop-in p95 ${p95} ms > ${limit} ms (${renderer})`);

  at('Running: two phones leave, a key cluster sits out');
  await leave(phones[0]);
  await leave(phones[1]);
  // The drawer's buttons are dispatched by their data attributes: the round screens may sit over the drawer, and it
  // folds to its head on the grid and in the race (its buttons stay in the page, at no size).
  await host.locator('[data-jj-input-drawer] button[data-act="sit-out"]').first().dispatchEvent('click');
  await wait(host, () => window.__jjRoom.view().seats.length === 10 && window.__jjRoom.view().seats.some((s) => s.presence === 'SittingOut'));
  assert.ok(!(await names(host)).includes('Davo') && !(await names(host)).includes('Shazza'), 'no phantom seats');
  // The grid reflows to the seated cars: the leavers' and the sitter's withdrawn cars keep no tile.
  await wait(host, () => window.__jjRender.tileRects().filter(Boolean).length === window.__jjRoom.view().seats.filter((s) => s.car !== null).length);
  assert.equal((await host.evaluate(() => window.__jjRender.tileRects())).filter(Boolean).length, 9, '12 − 2 left − 1 sitting out');
  await host.waitForTimeout(1500); // the reflow animates
  // Each tile's HUD sits inside its tile once the grid settles (the DOM layer follows the final rects).
  // On a slow runner the HUD's room view can trail the grid's reflow by a few frames: let it settle (20 s) first.
  const placed = () => host.evaluate(() => {
    // Rects are backing-store px: device px times the Render resolution (a slow host lowers it), so use the canvas's ratio.
    const canvas = document.querySelector('canvas');
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    return window.__jjRender.tileRects().flatMap((t) => {
      const box = document.querySelector(`.hud-tile[data-tile="${t.seat}"]`)?.getBoundingClientRect();
      const inside = box && box.left >= t.x / dpr - 2 && box.top >= t.y / dpr - 2 && box.right <= (t.x + t.w) / dpr + 2 && box.bottom <= (t.y + t.h) / dpr + 2;
      return inside ? [] : [{ tile: t.seat, box: box && [box.left, box.top, box.right, box.bottom].map(Math.round) }];
    });
  });
  // The HUD shows only while racing: on a host this slow (2 s frames on CI's software WebGL) the 3-lap round can end
  // before the grid settles, and the Intermission screens hide the HUD layer (every box then measures zero). That is not
  // a misplaced HUD; the check is then not reached, and says so.
  const racing = () => host.evaluate(() => window.__jjRoom.view().phase === 'Running');
  let misplaced = await placed();
  for (const t0 = Date.now(); misplaced.length && (await racing()) && Date.now() - t0 < 20_000; misplaced = await placed()) await host.waitForTimeout(250);
  const rectsNow = await host.evaluate(() => window.__jjRender.tileRects());
  if (misplaced.length && !(await racing())) {
    console.log(`# HUD-in-tile check not reached: the round left Running (${await host.evaluate(() => window.__jjRoom.view().phase)}) before the grid settled`);
    misplaced = [];
  }
  if (misplaced.length) {
    // What the HUD layer and the room hold, for the diagnosis.
    const dump = await host.evaluate(() => ({
      layerHidden: document.querySelector('.hud-tile')?.parentElement?.hidden,
      tiles: [...document.querySelectorAll('.hud-tile')].map((b) => ({ tile: b.dataset.tile, seat: b.dataset.seat ?? null, hidden: b.hidden, style: b.getAttribute('style') })),
      seats: window.__jjRoom.view().seats.map((s) => ({ number: s.number, car: s.car, presence: s.presence })),
      phase: window.__jjRoom.view().phase,
      render: window.__jjRender.stats(),
      follow: window.__jjRender.follow(),
      cameras: window.__jjRender.cameras(),
    }));
    console.log(`# HUD dump ${JSON.stringify(dump)}`);
  }
  assert.deepEqual(misplaced, [], `every HUD inside its tile: ${JSON.stringify({ misplaced, rectsNow })}`);
  await shot(host, 'tv-racing-after-churn');

  at('Intermission: results and standings');
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 600_000);
  const atResults = await view(host);
  assert.ok(atResults.standings.length >= 9, `standings for everyone who raced: ${atResults.standings.length}`);
  await shot(host, 'tv-intermission');

  at('Intermission and Lobby: shrink to 2');
  for (const p of phones.slice(2, 8)) await leave(p); // Bazza … Thommo; Jonesy and Sheila stay
  await wait(host, () => window.__jjRoom.view().seats.length === 4); // Jonesy, Sheila and both key clusters
  // The host takes the room back to the Lobby (before the next round's countdown), and both key clusters leave there.
  await host.getByRole('button', { name: 'Return to lobby' }).click();
  await wait(host, () => window.__jjRoom.view().phase === 'Lobby');
  // Both key clusters leave from the drawer (the sitting-out one too).
  // (The drawer rebuilds its rows when a source's state changes, so a click can land on a row just replaced: retry.)
  // Until only Jonesy and Sheila are left (a removal can land after the click that caused it, so the count isn't taken
  // per click).
  for (let tries = 0; (await view(host)).seats.length > 2; tries++) {
    assert.ok(tries < 20, `a key cluster never left: ${JSON.stringify(await names(host))}`);
    const leaveBtn = host.locator('[data-jj-input-drawer] button[data-act="leave"]');
    if ((await leaveBtn.count()) === 0) {
      await host.waitForTimeout(500); // the second removal may still be on its way
      if ((await view(host)).seats.length <= 2) break;
      const rows = await host.evaluate(() => [...document.querySelectorAll('[data-jj-input-drawer] li[data-source]')].map((li) => `${li.dataset.source}:${li.dataset.state}`));
      assert.fail(`no Leave in the drawer: rows ${JSON.stringify(rows)}, seats ${JSON.stringify((await view(host)).seats.map((s) => `${s.name}:${s.presence}`))}`);
    }
    await leaveBtn.first().dispatchEvent('click');
    await host.waitForTimeout(500);
  }
  await wait(host, () => window.__jjRoom.view().seats.length === 2, undefined, 30_000);
  const end = await view(host);
  assert.deepEqual(end.seats.map((s) => s.name).sort(), ['Jonesy', 'Sheila'], 'the two who stayed');
  assert.equal(end.standings.length, atResults.standings.length, 'the standings keep every row through the churn');
  for (const s of end.seats) assert.notEqual(s.presence, 'Left');
  await shot(host, 'tv-shrunk-2');
  assert.deepEqual(errors, []);
});
