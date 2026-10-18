// br-qw28 (R125): between rounds, in a real room (jj-server, `host?room&test=live`) with three real phones over WebRTC
// and generated tracks. Results hold, then the phones vote the next track: Rematch / New track / Surprise me; the most
// votes win, a tie is a Rematch, and the host can choose instead. Before the countdown the TV flies the new track from
// the start line round to the finish in the flyover's time, and any press skips it.
// - Round 1: two phones vote New track, one Rematch: New track wins (the tally on the TV and on each phone). The flyover
//   runs out on its own: the camera follows the route from its start to its end in about 6 s.
// - Round 2: one Rematch, one New track: a tie, so a Rematch, on round 2's own seed. A phone skips the flyover.
// - Round 3: every phone votes Rematch; the host chooses Surprise me: main draws the style.
// JJ_CAPTURE_DIR=<dir> keeps the TV and phone stills for the self-review (docs/evidence/P1-G-between/).
//   node --test web/tests/journeys/g-between-rounds.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, gpu } from './lib/chromium.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/between/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-G-between');
let browser, server;
before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'between'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const shot = (page, name) => (process.env.JJ_CAPTURE_DIR ? page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 80 }) : null);
const between = (host) => host.evaluate(() => window.__jjRoom.view().between);

test('three phones vote the next track: most votes win, a tie is a Rematch, the host can choose; the TV flies the new track, and a press skips it', { timeout: 900_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const phones = [];
  for (const name of ['Davo', 'Shazza', 'Bazza']) {
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
    const phone = await ctx.newPage();
    phone.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await phone.goto(joinUrl);
    await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
    await phone.locator('#name').fill(name);
    await phone.getByRole('button', { name: 'Join the race' }).click();
    await wait(phone, () => window.__jjController.inspect().phase === 'playing');
    await confirmInitialVehicle(phone);
    const skip = phone.getByRole('button', { name: 'Skip tutorial' });
    await skip.click({ timeout: 10_000 }).catch(() => {});
    phones.push(phone);
  }
  for (const p of phones) await p.getByRole('button', { name: /^Ready/ }).click();
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 180_000);
  // The seed the round on now races (the host's committed preparation), and main's record of how it was prepared.
  const current = () => host.evaluate(() => window.__jjRoom.view().preparation.current);
  const prepared = (seed) => host.evaluate((seed) => window.__jjPrepare.seeds().filter((e) => e.seed === seed).at(-1) ?? null, seed);
  const seed1 = await current();
  assert.ok(Number.isFinite(seed1), `round 1 races a generated track: ${seed1}`);

  const finish = () => host.evaluate(() => window.__jjTest.command({ cmd: 'finishRace' }));
  const voteOpen = () => wait(host, () => window.__jjRoom.view().between?.voteOpen === true, undefined, 60_000);
  const vote = async (phone, choice) => {
    await wait(phone, () => !!document.querySelector('[data-vote-panel] [data-vote]'), undefined, 15_000);
    // A real tap at the button; a loaded software-GL runner's frames come too far apart for Playwright's "stable" wait.
    await phone.locator(`[data-vote-panel] [data-vote=${choice}]`).click({ force: true, timeout: 10_000 }).catch(() => {});
  };

  // ---------- Round 1: New track 2, Rematch 1 ----------
  await finish();
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission' && !!document.querySelector('[data-screen=results] [data-vote]'));
  // The results hold first (a slow runner can reach the screen after it, when the vote is already open).
  const r1 = await between(host);
  assert.ok(r1.voteOpen ? r1.resultsLeftMs === 0 : r1.resultsLeftMs > 0 && r1.resultsLeftMs <= r1.resultsMs, JSON.stringify(r1));
  await voteOpen();
  await vote(phones[0], 'new');
  await vote(phones[1], 'new');
  await vote(phones[2], 'rematch');
  await wait(host, () => { const v = window.__jjRoom.view().between.votes; return v.new === 2 && v.rematch === 1; }, undefined, 10_000);
  await wait(host, () => document.querySelector('[data-votes=new]')?.textContent === '2' && document.querySelector('[data-votes=rematch]')?.textContent === '1', undefined, 10_000);
  // Each phone sees the tally (or, if the 10 s ran out meanwhile on a slow runner, the result).
  await wait(phones[2], () => document.querySelector('[data-vote=new] .vn')?.textContent === '2' || /Next: New track/.test(document.querySelector('[data-vote-panel]')?.textContent ?? ''), undefined, 10_000);
  const lit = await phones[0].evaluate(() => document.querySelector('[data-vote=new]')?.getAttribute('aria-pressed') ?? null);
  if (lit !== null) assert.equal(lit, 'true', "a phone's own vote is lit");
  // The TV's seconds count down between room updates (or, on a slow runner, the vote has closed meanwhile).
  await wait(host, () => {
    const m = document.querySelector('[data-vote-head]')?.textContent.match(/(\d+) s/);
    return !window.__jjRoom.view().between?.voteOpen || (!!m && Number(m[1]) <= 8);
  }, undefined, 15_000);
  await shot(host, 'tv-vote-1920x1080');
  await shot(phones[0], 'phone-vote-844x390');
  // The vote closes: New track. The flyover runs out on its own, following the route start to finish in ~6 s.
  await host.evaluate(() => window.__jjRender.flyoverTrace(true));
  await wait(host, () => window.__jjRoom.view().between?.flyoverLeftMs != null, undefined, 60_000);
  assert.equal((await between(host)).decided, 'new');
  await host.waitForTimeout(2500);
  await shot(host, 'tv-flyover-1920x1080');
  await shot(phones[1], 'phone-flyover-844x390');
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 60_000);
  const trace = await host.evaluate(() => window.__jjRender.flyoverTrace(false));
  // The path's shape is measured on the gpu runner (gpu.yml): SwiftShader draws a 1080p flyover a few frames a second.
  assert.ok(trace.length >= 2, `the flyover drew frames: ${trace.length}`);
  const along = trace.map((f) => f.along);
  assert.ok(along.every((a, i) => i === 0 || a >= along[i - 1] - 1e-9), 'it only goes forward along the route');
  if (gpu) {
    const secs = (trace.at(-1).at - trace[0].at) / 1000;
    assert.ok(trace.length > 20, `the flyover drew frames: ${trace.length}`);
    assert.ok(along[0] < 0.05 && along.at(-1) > 0.95, `start to finish: ${along[0]} → ${along.at(-1)}`);
    assert.ok(secs > 4.5 && secs < 7.5, `in about 6 s: ${secs.toFixed(2)} s`);
  }
  const seed2 = await current();
  assert.notEqual(seed2, seed1, 'New track: a new seed');

  // ---------- Round 2: a tie is a Rematch; a phone skips the flyover ----------
  await finish();
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission');
  await voteOpen();
  await vote(phones[0], 'rematch');
  await vote(phones[1], 'new');
  await wait(host, () => { const v = window.__jjRoom.view().between.votes; return v.rematch === 1 && v.new === 1; }, undefined, 10_000);
  await wait(host, () => window.__jjRoom.view().between?.flyoverLeftMs != null, undefined, 60_000);
  assert.equal((await between(host)).decided, 'rematch', 'a tie is a Rematch');
  await wait(phones[2], () => !!document.querySelector('[data-act=skip-flyover]'), undefined, 10_000);
  // Measured on the host's sim clock (a slow runner's wall clock runs ahead of it): the flyover ends well before its 6 s.
  const tickNow = () => host.evaluate(async () => (await window.__jjTest.observe()).tick);
  const skipFrom = await tickNow();
  // A tap on the phone's Skip (a slow runner's flyover can run out before the tap lands: the gpu runner's always lands).
  const tapped = await phones[2].evaluate(() => {
    const b = document.querySelector('[data-act=skip-flyover]');
    b?.click();
    return !!b;
  });
  await wait(host, () => window.__jjRoom.view().between?.flyoverLeftMs == null, undefined, 10_000);
  const skippedAfterMs = ((await tickNow()) - skipFrom) * (1000 / 120);
  if (tapped || gpu) assert.ok(skippedAfterMs < 4000, `a press skips the flyover: it ended ${skippedAfterMs.toFixed(0)} ms of game time later`);
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 60_000);
  assert.equal(await current(), seed2, "the Rematch races round 2's own seed again");

  // ---------- Round 3: the phones say Rematch, the host chooses Surprise me ----------
  await finish();
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission' && !!document.querySelector('[data-act=next-track][data-choice=surprise]'));
  // The host chooses while the results are up; the phones then vote Rematch, and the host's pick stands.
  // (The results screen is redrawn once more as the round's results settle, so the card is found afresh at the tap.)
  await wait(host, () => {
    if (window.__jjRoom.view().between?.hostChoice === 'surprise') return true;
    document.querySelector('[data-act=next-track][data-choice=surprise]')?.click();
    return false;
  }, undefined, 20_000);
  // (A slow software-GL runner can be past the 10 s vote by now: the host's pick stands either way.)
  await wait(host, () => window.__jjRoom.view().between?.voteOpen || !!window.__jjRoom.view().between?.decided, undefined, 60_000);
  if ((await between(host)).voteOpen) {
    for (const p of phones) if (await p.evaluate(() => !!document.querySelector('[data-vote-panel] [data-vote]'))) await vote(p, 'rematch');
    await shot(host, 'tv-vote-host-pick-1920x1080');
  }
  await wait(host, () => window.__jjRoom.view().between?.decided === 'surprise', undefined, 60_000);
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  const s4 = await prepared(await current());
  assert.match(s4?.plan ?? '', /^surprise:/, `Surprise me draws the style: ${JSON.stringify(s4)}`);
  assert.deepEqual(errors, []);
});
