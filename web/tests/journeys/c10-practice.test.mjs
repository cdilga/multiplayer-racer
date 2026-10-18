// Artifacts default to OS scratch; set JJ_EVIDENCE_DIR / JJ_CAPTURE_DIR explicitly to recapture a committed receipt.
import { evidencePath } from '../lib/evidence.mjs';
// P1-C10 journey: the practice scene for newcomers, through the real host page (a real room, its round loop and grid).
//  1. Four controllers race (the test surface's fake controllers join through the real controller path). A newcomer joins
//     with Practice first, as the join screen's button sends it: their seat drives its own practice world in the worker,
//     their tile shows the practice course with the C06 prompts, and the round has only its four cars. The newcomer
//     practises (steer, drive, brake), then chooses Join the race and enters the running round at the tail, a late entrant.
//     The practice world's cost is measured (worker ms per tick before, during and after; the tile's draws), and a bug
//     clip saved at the end replays natively (`jj sim --replay`) to the browser's own full-state hash, through every
//     checkpoint taken while the newcomer practised: the round's tick hash never saw the practice world.
//  2. A real phone (landscape and portrait) joins a running round: the join card offers Practise first beside Join the
//     race (optional, never a queue), the practice bar's Join the race enters the round at the tail, and Help offers
//     Practice again while the round races. TV and phone captures for the visual self-review.
// Run on eris (browsers don't run on the Mac):
//   JJ_CHROMIUM_GPU=1 JJ_SERVER_BIN=… JJ_BIN=<jj binary> node --test web/tests/journeys/c10-practice.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidence = join(evidencePath(''), 'P1-C10');
const CAPTURE = process.env.JJ_CAPTURE_DIR ?? join(evidence, 'captures');
const BASE = '/p/c10/';
const run = {};
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c10'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  mkdirSync(evidence, { recursive: true });
  mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
  writeFileSync(
    join(evidence, 'journey-run.json'),
    `${JSON.stringify({ browser: `Chromium ${browser?.version()} (Playwright headless${process.env.JJ_CHROMIUM_GPU ? ', GPU' : ''}), ${process.platform}/${process.arch}`, takenAt: new Date().toISOString(), ...run }, null, 2)}\n`,
  );
});
closeContextsAfterEach(() => browser);

/** `jj sim --replay …`, as the F07 journey judges a clip. */
function replay(file, args) {
  const [cmd, ...pre] = process.env.JJ_BIN ? [resolve(repo, process.env.JJ_BIN)] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  const r = spawnSync(cmd, [...pre, 'sim', '--replay', ...args, file], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout)[0].report;
}

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const shot = (page, name) => page.screenshot({ path: join(CAPTURE, `${name}.png`) });
/** Lets the TV's grid settle (it animates as seats come and go) before a capture. */
const settle = (page) =>
  page.evaluate(async () => {
    let last = '';
    for (let i = 0; i < 40; i++) {
      const now = JSON.stringify(window.__jjRender.tileRects());
      if (now === last) return;
      last = now;
      await new Promise((r) => setTimeout(r, 250));
    }
  });

async function hostRoom(viewport = { width: 1280, height: 720 }) {
  const host = await (await browser.newContext({ viewport })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=99`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);
  return { host, errors };
}

/** Four fake controllers claim, Ready, and the round starts; returns their endpoints. */
async function fourRacing(host) {
  const racers = await host.evaluate(async () => {
    const s = window.__jjTest;
    const out = [];
    for (const name of ['Ava', 'Bree', 'Cal', 'Dee']) out.push(await s.join(name, { lobby: true }));
    for (const r of out) s.input({ type: 'controller', endpoint: r.endpoint, frame: { ready: true } });
    return out;
  });
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 180_000);
  return racers;
}

test('P1-C10: a newcomer practises in their own world while four race, then joins at the tail; the round never sees it', { timeout: 900_000 }, async () => {
  const { host, errors } = await hostRoom();
  const racers = await fourRacing(host);
  await host.evaluate(() => window.__jjTest.hold(true));
  const room = () => host.evaluate(() => window.__jjRoom.view());
  const observe = () => host.evaluate(() => window.__jjTest.observe());
  // The four hold full throttle from here on (re-sent each step, as a phone's refresh would).
  await host.evaluate((eps) => eps.forEach((e) => window.__jjTest.drive(e, [0, 32767])), racers.map((r) => r.endpoint));
  /** Worker ms per tick over `ticks`, stepping 6 at a time with the sticks re-sent (median of three runs). */
  const tickCost = (ticks) =>
    host.evaluate(async (ticks) => {
      const runs = [];
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        await window.__jjTest.untilFact(() => false, { maxTicks: ticks, every: 6 });
        runs.push((performance.now() - t0) / ticks);
      }
      runs.sort((a, b) => a - b);
      return +runs[1].toFixed(3);
    }, ticks);
  const drawStats = () => host.evaluate(() => { const s = window.__jjRender.stats(); return { drawCalls: s.drawCalls, triangles: s.triangles, frameMs: +(s.frameMs ?? 0).toFixed(2), cars: s.cars }; });
  run.cost = { roundOnly: { msPerTick: await tickCost(120), draws: await drawStats() } };

  // The newcomer joins with Practice first: a seat, no car in the round, its own practice car.
  const nu = await host.evaluate(() => window.__jjTest.join('Newbie', { practice: true }));
  await host.evaluate((e) => window.__jjTest.drive(e, null), nu.endpoint);
  // The room view reaches the page with the next room message.
  await wait(host, (n) => window.__jjRoom.view().seats.some((s) => s.seat === n), nu.seat);
  let seat = (await room()).seats.find((s) => s.seat === nu.seat);
  assert.equal(seat.practice, true, 'the newcomer practises');
  assert.equal(seat.roundCar, null, 'and has no car in the round');
  assert.equal((await observe()).cars.length, 4, 'the round has only its four racers');
  const prompt0 = seat.prompt;
  assert.equal(prompt0?.step, 0, `the C06 prompts start in practice: ${JSON.stringify(prompt0)}`);
  // The TV: a fifth tile follows the practice car on the practice course.
  await host.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 60, every: 6 }));
  await wait(host, (car) => window.__jjRender.follow()?.includes(car), seat.car);
  await wait(host, () => window.__jjRender.practice().slots.length === 1);
  assert.ok(seat.car >= 0x40000000, 'the tile follows the practice car (its own snapshot id)');
  await settle(host);
  await wait(host, () => [...document.querySelectorAll('.hud-tile [data-practice]')].some((e) => e.offsetParent));
  await shot(host, 'tv-practice-tile-1280x720');
  // The practice tile draws with its own shadow pass (the sun's box over its car).
  await wait(host, () => (window.__jjRender.stats().practiceShadowPasses ?? 0) > 0);

  // Practice: steer right then left (the first prompt), drive up the course and brake (the second), as a phone does.
  const sticks = (drive, action, ticks) =>
    host.evaluate(async ([e, drive, action, ticks]) => {
      window.__jjTest.drive(e, drive, action);
      await window.__jjTest.untilFact(() => false, { maxTicks: ticks, every: 6 });
    }, [nu.endpoint, drive, action, ticks]);
  const start = (await observe()).host.seats.find((s) => s.seat === nu.seat).practice;
  await sticks([0, 0], [32767, 0], 90);
  await sticks([0, 0], [-32767, 0], 90);
  await wait(host, (s) => window.__jjRoom.view().seats.find((x) => x.seat === s)?.prompt?.step >= 1, nu.seat, 30_000);
  await shot(host, 'tv-practice-prompt-go-1280x720');
  await sticks([0, 32767], [0, 0], 240);
  await sticks([0, -32767], [0, 0], 120);
  await wait(host, (s) => window.__jjRoom.view().seats.find((x) => x.seat === s)?.prompt?.step >= 2, nu.seat, 30_000);
  run.cost.withPractice = { msPerTick: await tickCost(120), draws: await drawStats() };
  await sticks([0, 32767], [6000, 0], 240);
  await settle(host);
  await shot(host, 'tv-practice-driving-1280x720');
  const moved = (await observe()).host.seats.find((s) => s.seat === nu.seat).practice;
  const driven = Math.hypot(moved.x - start.x, moved.z - start.z);
  assert.ok(driven > 15, `the practice car drove on its course (${driven.toFixed(1)} m)`);
  const obs = await observe();
  assert.equal(obs.cars.length, 4, 'still only the four racers in the round');
  assert.equal(obs.host.pauseMask, 0, 'the room never paused');
  run.practice = { drivenM: +driven.toFixed(1), promptStep: (await room()).seats.find((s) => s.seat === nu.seat).prompt?.step, slot: moved.slot, practiceTick: moved.tick };

  // Join the race: the newcomer enters the running round at the tail, like any late joiner (R63).
  await host.evaluate(async (e) => {
    window.__jjTest.drive(e, null);
    await window.__jjTest.untilFact(() => false, { maxTicks: 150, every: 6 });
    window.__jjTest.practice(e, false);
    await window.__jjTest.untilFact(() => false, { maxTicks: 6, every: 6 });
  }, nu.endpoint);
  await wait(host, (n) => window.__jjRoom.view().seats.find((s) => s.seat === n)?.practice === false, nu.seat);
  seat = (await room()).seats.find((s) => s.seat === nu.seat);
  assert.equal(seat.practice, false, 'Join the race ended practice');
  assert.ok(seat.car !== null && seat.car < 0x40000000, `a car in the round: ${seat.car}`);
  assert.equal(seat.position, 5, 'entered at the tail (fifth of five)');
  assert.equal((await observe()).cars.length, 5);
  await host.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 60, every: 6 }));
  await wait(host, () => window.__jjRender.practice().slots.length === 0);
  run.cost.afterJoin = { msPerTick: await tickCost(120), draws: await drawStats() };
  await settle(host);
  await shot(host, 'tv-joined-at-tail-1280x720');
  run.join = { position: seat.position, car: seat.car };

  // The round's tick hash never saw the practice world: a clip of the round (its journal, with checkpoint hashes taken
  // while the newcomer practised) replays natively to the browser's own hash.
  const hash = await host.evaluate(() => window.__jjTest.hash());
  const saved = await host.evaluate(async () => {
    const s = await window.__jjTest.saveClip('P1-C10: practice while four race, then join');
    return { bundle: s.bundle, bytes: s.bytes };
  });
  const file = join(evidence, 'practice.jjclip');
  writeFileSync(file, JSON.stringify(saved.bundle));
  const r = replay(file, ['--json', '--build', saved.bundle.build]);
  writeFileSync(join(evidence, 'practice.replay.json'), `${JSON.stringify(r, null, 2)}\n`);
  assert.equal(r.ok, true, JSON.stringify(r));
  const last = r.worlds[r.worlds.length - 1];
  assert.equal(last.endHash, hash.stateHash, "the native replay ends in the browser host's full-state hash");
  // The results reel never recorded the practice car (frames, events, actors).
  const reel = await host.evaluate(() => window.__jjReel.inspect());
  const practiceIn = JSON.stringify(reel).match(/"car":\s*(1073741\d{3})/);
  assert.equal(practiceIn, null, `no practice car in the reel: ${practiceIn}`);
  run.reel = { clips: reel.recorder.clips.length, latestTick: reel.recorder.latestTick };
  run.clip = { tick: hash.tick, browserHash: hash.stateHash, replayHash: last.endHash, worlds: r.worlds.length, checkpoints: r.worlds.map((w) => w.checkpoints?.length ?? 0), bytes: saved.bytes };
  assert.deepEqual(errors, []);
});

test('P1-C10: a phone sees Practise first on the join card while a round runs, practises, joins from the bar, and Help offers it again', { timeout: 600_000 }, async () => {
  const { host, errors } = await hostRoom({ width: 1920, height: 1080 });
  await fourRacing(host);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  // The owner's phones (docs/process/visual-self-review.md): 915x412 landscape, 412x915 portrait, a small 375x667.
  for (const [w, h, tag] of [[915, 412, 'landscape-915x412'], [412, 915, 'portrait-412x915'], [375, 667, 'small-375x667']]) {
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: w, height: h } });
    const phone = await ctx.newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(joinUrl);
    await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join' && window.__jjController.inspect().roomPhase === 'Racing');
    // Optional, never a queue: Join the race stays the big button; Practise first sits under it.
    await wait(phone, () => document.querySelector('[data-act=practise-first]'));
    await shot(phone, `phone-join-card-practise-first-${tag}`);
    await phone.getByRole('button', { name: 'Practise first' }).click();
    await wait(phone, () => window.__jjController.inspect().phase === 'playing' && window.__jjController.inspect().practising);
    const me = await phone.evaluate(() => window.__jjController.inspect().you.seat);
    await wait(host, (s) => window.__jjRoom.view().seats.find((x) => x.seat === s)?.practice === true, me, 30_000);
    // Dismiss the turn-sideways card in portrait (the controller still works upright).
    await phone.locator('[data-act=upright]').click({ timeout: 2000 }).catch(() => {});
    await wait(phone, () => document.querySelector('[data-practice-bar]'));
    const practiceOf = () => host.evaluate((s) => window.__jjTest.observe().then((o) => o.host.seats.find((x) => x.seat === s).practice), me);
    const from = await practiceOf();
    // Drive the practice car from the phone: steer, then throttle.
    await phone.evaluate(async () => {
      const c = window.__jjController;
      const none = { x: 0, y: 0, touch: false };
      for (const [d, a] of [[none, { x: 1, y: 0, touch: true }], [none, { x: -1, y: 0, touch: true }], [{ x: 0, y: -1, touch: true }, none]]) {
        c.setSticks(d, a);
        await new Promise((r) => setTimeout(r, 700));
      }
    });
    await shot(phone, `phone-practising-${tag}`);
    await settle(host);
    await shot(host, `tv-practice-tile-phone-${tag}-1920x1080`);
    if (tag.startsWith('landscape')) {
      // The TV resized (a laptop's 1366x768) while a tile shows a practice course, then back.
      await host.setViewportSize({ width: 1366, height: 768 });
      await settle(host);
      await shot(host, 'tv-practice-tile-resized-1366x768');
      await host.setViewportSize({ width: 1920, height: 1080 });
    }
    // Turned the other way while practising (the play screen is rebuilt; the bar comes back with it), and full screen.
    // Joining asked for full screen (R101): leave it first, or the window can't be resized.
    const windowed = () => phone.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });
    await windowed();
    await phone.setViewportSize({ width: h, height: w });
    await phone.locator('[data-act=upright]').click({ timeout: 2000 }).catch(() => {});
    await wait(phone, () => document.querySelector('[data-practice-bar]'));
    await shot(phone, `phone-practising-turned-${tag}`);
    await windowed();
    await phone.setViewportSize({ width: w, height: h });
    await phone.locator('[data-act=upright]').click({ timeout: 2000 }).catch(() => {});
    await wait(phone, () => document.querySelector('[data-practice-bar]'));
    // The full-screen tool (it may already be on from joining: shown either way).
    await phone.locator('[data-act=fullscreen]').click();
    await phone.waitForTimeout(400);
    await shot(phone, `phone-practising-fullscreen-${tag}`);
    if (await phone.evaluate(() => !!document.fullscreenElement)) await phone.evaluate(() => document.exitFullscreen());
    await phone.locator('[data-act=fs-note-ok]').click({ timeout: 1000 }).catch(() => {});
    const pr = await practiceOf();
    const moved = Math.hypot(pr.x - from.x, pr.z - from.z);
    assert.ok(moved > 2, `the phone drives its practice car (${moved.toFixed(1)} m: ${JSON.stringify([from, pr])})`);
    await phone.evaluate(() => window.__jjController.setSticks({ x: 0, y: 0, touch: false }, { x: 0, y: 0, touch: false }));
    // Join the race from the bar: in the round at the tail.
    await phone.getByRole('button', { name: 'Join the race' }).click();
    await wait(host, (s) => { const x = window.__jjRoom.view().seats.find((y) => y.seat === s); return x && !x.practice && x.car !== null && x.car < 0x40000000; }, me, 30_000);
    const seat = await host.evaluate((s) => window.__jjRoom.view().seats.find((x) => x.seat === s), me);
    const cars = await host.evaluate(() => window.__jjRoom.view().seats.filter((s) => s.car !== null).length);
    assert.equal(seat.position, cars, `entered at the tail (${seat.position} of ${cars})`);
    await wait(phone, () => !window.__jjController.inspect().practising && !document.querySelector('[data-practice-bar]'));
    await shot(phone, `phone-joined-${tag}`);
    // Help while racing offers Practice again.
    await phone.locator('[data-act=help]').click();
    await wait(phone, () => document.querySelector('.coach [data-act=practice]'));
    await shot(phone, `phone-help-practice-${tag}`);
    await phone.locator('.coach [data-act=practice]').click();
    await wait(host, (s) => window.__jjRoom.view().seats.find((x) => x.seat === s)?.practice === true, me, 30_000);
    const back = await host.evaluate((s) => window.__jjRoom.view().seats.find((x) => x.seat === s), me);
    assert.ok(back.roundCar !== null, 'a racer who practises keeps its round car (on the autopilot)');
    await phone.getByRole('button', { name: 'Join the race' }).click();
    await wait(host, (s) => window.__jjRoom.view().seats.find((x) => x.seat === s)?.practice === false, me, 30_000);
    run[`phone-${tag}`] = { seat: me, joinedAt: seat.position, of: cars, drivenM: +moved.toFixed(1) };
    await ctx.close();
  }
  assert.deepEqual(errors, []);
});
