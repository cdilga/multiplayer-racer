// br-m1xe (R125): keep a good track. In a real room (jj-server, `host?room&test=live`) on generated tracks, a race's
// Round complete has "Keep this track" with the track's share code and the track's best lap per car. The host keeps it,
// returns to the lobby, picks it on the host menu's Tracks page, and the next race is built from the same seed and recipe
// (the same route, point for point). A mistyped code is refused with the reason. (Ghost laps were dropped, R134.)
// JJ_CAPTURE_DIR=<dir> keeps the TV stills for the self-review (docs/evidence/P1-G-kept/).
//   node --test web/tests/journeys/g-kept-tracks.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';

const BASE = '/p/kept/';
const out = process.env.JJ_CAPTURE_DIR ?? evidencePath('P1-G-kept');
let browser, server;
before(async () => {
  mkdirSync(out, { recursive: true });
  server = await serve(build('./', 'kept'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 180_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const shot = (page, name) => (process.env.JJ_CAPTURE_DIR ? page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 80 }) : null);
const frames = (host, list) => host.evaluate(async (list) => {
  for (const [endpoint, frame] of list) window.__jjTest.input({ type: 'controller', endpoint, frame });
  await window.__jjTest.step(1);
}, list);

test('keep a track at Round complete, pick it from the Tracks page, and race the same track again; best laps are kept; a mistyped code is refused', { timeout: 900_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  const seats = ['s1', 's2'];
  for (const [k, e] of seats.entries()) await frames(host, [[e, { hello: true }], [e, { claim: `Racer ${k + 1}` }]]);
  await frames(host, seats.map((e) => [e, { ready: true }]));
  await wait(host, () => window.__jjRoom.view().phase === 'Running');
  const first = await host.evaluate(() => ({ track: window.__jjPrepare.current(), route: window.__jjPrepare.mapInfo().route }));
  assert.ok(first.track && Number.isFinite(first.track.seed), `a generated track: ${JSON.stringify(first.track)}`);

  // One lap on the autopilot, the sim held and stepped, until a car finishes; then the race ends.
  await host.evaluate(async () => {
    const t = window.__jjTest;
    t.hold(true);
    await t.command({ cmd: 'autopilot', on: true });
    for (let k = 0; k < 400 && !window.__jjRoom.view().seats.some((s) => s.finished); k++) await t.step(120);
    await t.command({ cmd: 'finishRace' });
    // Keep results on the controlled clock while the host saves the track.
    await t.step(2);
  });
  await wait(host, () => window.__jjRoom.view().phase === 'Intermission' && !document.querySelector('[data-keep]')?.hidden);
  const laps = await host.evaluate(() => window.__jjRoom.view().seats.map((s) => s.lapMs ?? []));
  assert.ok(laps.some((l) => l.length > 0 && l[0] > 0), `a lap was timed: ${JSON.stringify(laps)}`);
  // The track's best lap per car shows under the vote.
  await wait(host, () => /Best laps here/.test(document.querySelector('[data-best]')?.textContent ?? ''), undefined, 15_000);
  const code = await host.evaluate(() => document.querySelector('[data-code]')?.textContent ?? '');
  assert.match(code, /^T\d+-[0-9A-Z-]+$/, `a share code: ${code}`);
  await host.locator('[data-act=keep]').click({ force: true });
  await wait(host, () => document.querySelector('[data-act=keep]')?.textContent?.startsWith('Kept'), undefined, 10_000);
  await shot(host, 'tv-results-kept-1920x1080');
  const stored = await host.evaluate(() => JSON.parse(localStorage.getItem('jj.host.favourites') ?? '[]'));
  assert.equal(stored[0]?.code, code, `kept on this host: ${JSON.stringify(stored)}`);

  // Back to the lobby; the host menu's Tracks page races it next.
  await host.locator('[data-act=lobby]').click({ force: true });
  await host.evaluate(async () => { await window.__jjTest.step(1); await window.__jjTest.hold(false); });
  await wait(host, () => window.__jjRoom.view().phase === 'Lobby');
  await host.locator('[data-act=menu]').click();
  await host.locator('[data-act=tracks]').click();
  await wait(host, () => !!document.querySelector('[data-tracks] [data-act=fav-race]'), undefined, 10_000);
  // A mistyped code is refused with the reason.
  await host.locator('[data-tracks] input[name=code]').fill(code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A'));
  await host.locator('[data-tracks] button[type=submit]').click();
  await wait(host, () => /typo/.test(document.querySelector('[data-tracks-note]')?.textContent ?? ''), undefined, 10_000);
  await host.locator('[data-tracks] [data-act=fav-race]').first().click();
  await wait(host, () => !!window.__jjRoom.view().preparation?.favourite && document.querySelector('[data-act=fav-race]')?.textContent === 'Racing next', undefined, 10_000);
  await shot(host, 'tv-tracks-page-1920x1080');
  const fav = await host.evaluate(() => window.__jjRoom.view().preparation.favourite);
  assert.deepEqual([fav.seed, fav.recipe], [first.track.seed, first.track.recipe], 'the kept track is the next round\'s');
  await host.keyboard.press('Escape');
  // The lobby says the next race is the kept track.
  await wait(host, () => /Next track: kept T\d+-/.test(document.querySelector('.lb-kept')?.textContent ?? ''), undefined, 10_000);
  await shot(host, 'tv-lobby-kept-next-1920x1080');

  // The next race: the same seed and recipe, and the same route point for point.
  // (Returning to the lobby disarms the automatic start: the host starts it.)
  await frames(host, seats.map((e) => [e, { ready: true }]));
  await host.evaluate(() => window.__jjTest.input({ type: 'ui', ui: 'start' }));
  await wait(host, () => window.__jjRoom.view().phase === 'Running' && window.__jjRoom.view().round === 2);
  const again = await host.evaluate(() => ({ track: window.__jjPrepare.current(), route: window.__jjPrepare.mapInfo().route }));
  assert.deepEqual([again.track.seed, again.track.recipe], [first.track.seed, first.track.recipe]);
  assert.deepEqual(again.route, first.route, 'the same track, point for point');
  assert.deepEqual(errors, []);
});
