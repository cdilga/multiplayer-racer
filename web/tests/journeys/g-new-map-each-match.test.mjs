// br-8h3u.7: "each new match gets a new map". Three consecutive 1-lap rounds in one real room (two synthetic controllers,
// `finishRace` ends each round) produce three distinct map hashes and three distinct track seeds, and the session record lists every one.
//   node --test web/tests/journeys/g-new-map-each-match.test.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/gnm/';
const N = 2;
const MATCHES = 3;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'gnm'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 300_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);

test('consecutive matches in one room get distinct courses, each seed in the session record', { timeout: 1_200_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=1`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);
  for (let k = 1; k <= N; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
  }
  await wait(host, (n) => window.__jjRoom.view().seats.length === n, N);

  for (let round = 1; round <= MATCHES; round++) {
    for (let k = 1; k <= N; k++) await frame(host, `syn${k}`, { ready: true });
    await wait(host, (r) => window.__jjRoom.view().round === r && ['Countdown', 'Running'].includes(window.__jjRoom.view().phase), round, 120_000);
    await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);
    await host.evaluate(() => window.__jjTest.command({ cmd: 'finishRace' }));
    await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 600_000);
    for (let k = 1; k <= N; k++) await frame(host, `syn${k}`, { ready: false });
  }

  const summary = await host.evaluate(() => window.__jjTest.sessionSummary());
  const played = summary.rounds.filter((r) => r.trackSeed !== null);
  assert.ok(played.length >= MATCHES, `the session record lists every match's track: ${JSON.stringify(summary.rounds)}`);
  const last = played.slice(-MATCHES);
  assert.equal(new Set(last.map((r) => r.mapHash)).size, MATCHES, `distinct course hashes: ${JSON.stringify(last)}`);
  assert.equal(new Set(last.map((r) => r.trackSeed)).size, MATCHES, `distinct track seeds: ${JSON.stringify(last)}`);
  assert.deepEqual(errors, []);
});
