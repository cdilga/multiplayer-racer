// P1-M08a browser tests: round preparation on main. The real RoundPreparer over the real procgen worker (jj-wasm-procgen)
// and the test chunk's sim worker (jj-wasm-host) in headless Chromium: a stale job never commits, a reroll replaces a
// prepared map (and supersedes one in flight), a failed preparation retries conservatively and then settles in the Lobby,
// a broken dev map is refused with the validator's message, and every track names its seed.
//   scripts/build-host-wasm.sh && npx --prefix web vite build --config web/host/tests/vite.config.ts
//   node --test web/host/tests/prepare.test.mjs
// Writes what it measured to docs/evidence/P1-M08a/browser-run.json (JJ_EVIDENCE overrides the path).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const repo = resolve(import.meta.dirname, '../../..');
const dist = join(repo, 'web/dist-test');
const evidencePath = process.env.JJ_EVIDENCE ?? join(repo, 'docs/evidence/P1-M08a/browser-run.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const SEED = 3;
const evidence = { browser: '', runs: {} };

let server;
let browser;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(dist, path === '/' ? 'prepare-harness.html' : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch();
  evidence.browser = `Chromium ${browser.version()} (Playwright headless), ${process.platform}/${process.arch}`;
});

after(async () => {
  await browser?.close();
  server?.close();
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
});

/** A fresh page and a fresh sim, preparer and procgen worker. */
async function open(options = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/prepare-harness.html`);
  await page.waitForFunction(() => window.__prep !== undefined);
  await page.evaluate((o) => window.__prep.start(o), { seed: SEED, ...options });
  // The seat joins through the controller path; wait for it to show in the room.
  await waitFor(page, () => window.__prep.room()?.seats?.length === 1, 'the seat to join');
  const api = (fn, ...args) => page.evaluate(([f, a]) => window.__prep[f](...a), [fn, args]);
  return { page, errors, api };
}

async function waitFor(page, predicate, what, timeoutMs = 20_000) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(predicate)) return;
    assert.ok(Date.now() - t0 < timeoutMs, `timed out waiting for ${what}`);
    await sleep(40);
  }
}

const phase = (page) => page.evaluate(() => window.__prep.room()?.phase);

test('a round races the map the procgen worker prepared, and its track names its seed', { timeout: 60_000 }, async () => {
  const { page, errors, api } = await open();
  await api('reroll');
  await waitFor(page, () => window.__prep.stats().delivered === 1, 'the first map to be delivered');
  assert.equal(await api('stagedFor'), 1);
  assert.equal((await api('presented')).committed, 0, 'nothing is shown before the Countdown');
  await api('startRound');
  await waitFor(page, () => ['Countdown', 'Running'].includes(window.__prep.room()?.phase), 'the Countdown');
  await waitFor(page, () => window.__prep.presented().committed === 1, 'the prepared map to be shown');
  const room = await api('room');
  assert.equal(room.preparation.verdict, 'ok');
  assert.equal(room.preparation.staleDropped, 0);
  const seeds = await api('seeds');
  assert.deepEqual(seeds.map((s) => [s.preparation, s.seed]), [[1, SEED + 1]], 'seed = session seed + preparation id');
  assert.ok(seeds[0].plan && seeds[0].attempts >= 1, 'the ladder outcome is recorded');
  assert.deepEqual((await api('presented')).commitMaps, [String(SEED + 1)], 'the map shown is the one for that seed');
  assert.deepEqual(errors, []);
  evidence.runs.commit = { seeds, presented: await api('presented'), preparation: room.preparation };
  await page.close();
});

test('a reroll replaces a prepared map: the old one is dropped and the new seed races', { timeout: 60_000 }, async () => {
  const { page, errors, api } = await open();
  await api('reroll');
  await waitFor(page, () => window.__prep.stats().delivered === 1, 'the first map');
  await api('reroll');
  await waitFor(page, () => window.__prep.stats().delivered === 2, 'the second map');
  assert.equal(await api('stagedFor'), 2, 'only the newest preparation is staged');
  const p = await api('presented');
  assert.equal(p.staged, 2);
  assert.equal(p.disposed, 1, 'the replaced map was released');
  await api('startRound');
  await waitFor(page, () => window.__prep.presented().committed === 1, 'the second map to be shown');
  const seeds = await api('seeds');
  assert.deepEqual(seeds.map((s) => s.seed), [SEED + 1, SEED + 2], 'a reroll draws the next seed');
  assert.equal((await api('presented')).committed, 1, 'exactly one map is ever shown');
  assert.deepEqual((await api('presented')).commitMaps, [String(SEED + 2)], 'and it is the second seed\'s');
  assert.deepEqual(errors, []);
  evidence.runs.reroll = { seeds, presented: await api('presented') };
  await page.close();
});

test('a stale job never commits: a superseded preparation is dropped before the renderer and the sim', { timeout: 60_000 }, async () => {
  // The first job is slow (900 ms); a reroll supersedes it and the second job is fast.
  const { page, errors, api } = await open({ delay: { 1: 900 } });
  await api('reroll');
  await sleep(150);
  await api('reroll');
  await waitFor(page, () => window.__prep.stats().delivered === 1, 'the fast job to be delivered');
  assert.equal(await api('stagedFor'), 2);
  // Wait for the slow job to finish and be thrown away.
  await waitFor(page, () => window.__prep.stats().superseded === 1, 'the slow job to be dropped', 5_000);
  const stats = await api('stats');
  assert.equal(stats.delivered, 1, 'the slow job never reached the sim');
  assert.equal((await api('presented')).staged, 1, 'and never built a mesh');
  // Even a stale MapReady that did arrive is dropped and counted by the sim, and moves nothing.
  await api('sendStale', 1);
  await waitFor(page, () => window.__prep.room()?.preparation?.staleDropped === 1, 'the sim to count the stale map');
  assert.equal(await phase(page), 'Lobby');
  await api('startRound');
  await waitFor(page, () => window.__prep.presented().committed === 1, 'the fresh map to be shown');
  assert.equal((await api('room')).preparation.verdict, 'ok');
  assert.deepEqual(errors, []);
  evidence.runs.stale = { stats: await api('stats'), seeds: await api('seeds'), room: (await api('room')).preparation };
  await page.close();
});

test('reroll during preparation: the round starts on the new seed, not the one in flight', { timeout: 60_000 }, async () => {
  const { page, errors, api } = await open({ delay: { 1: 900 } });
  await api('startRound');
  await waitFor(page, () => window.__prep.room()?.phase === 'Preparing', 'Preparing');
  await api('reroll');
  await waitFor(page, () => ['Countdown', 'Running'].includes(window.__prep.room()?.phase), 'the Countdown');
  await waitFor(page, () => window.__prep.presented().committed === 1, 'the new map to be shown');
  await sleep(1_000); // the slow first job finishes late and must change nothing
  const stats = await api('stats');
  assert.equal(stats.committed, 1);
  assert.equal(stats.superseded, 1);
  assert.deepEqual((await api('seeds')).map((s) => s.preparation), [1, 2]);
  assert.equal((await api('presented')).staged, 1, 'only the surviving preparation was built');
  assert.deepEqual(errors, []);
  evidence.runs.rerollDuringPreparation = { stats, seeds: await api('seeds') };
  await page.close();
});

test('failure: the conservative retry runs, and if that fails the room settles in the Lobby with nothing loaded', { timeout: 60_000 }, async () => {
  {
    // Only the full recipe fails: the director's one retry (the placeholder biome alone) succeeds and the round runs.
    const { page, errors, api } = await open({ fail: 'full' });
    await api('startRound');
    await waitFor(page, () => window.__prep.presented().committed === 1, 'the conservative map to be shown');
    const seeds = await api('seeds');
    assert.equal(seeds.length, 2, 'the failed job and its retry');
    assert.equal((await api('stats')).failed, 1);
    assert.deepEqual(errors, []);
    evidence.runs.conservativeRetry = { seeds, stats: await api('stats') };
    await page.close();
  }
  {
    // Everything fails: the director gives up after the retry and the room stays in the Lobby.
    const { page, errors, api } = await open({ fail: 'all' });
    await api('startRound');
    await waitFor(page, () => window.__prep.stats().failed >= 2, 'both attempts to fail');
    await waitFor(page, () => window.__prep.room()?.phase === 'Lobby' && window.__prep.room()?.preparation?.pending === null, 'the Lobby');
    await sleep(500);
    const room = await api('room');
    assert.equal(room.phase, 'Lobby');
    assert.equal(room.seats.length, 1, 'the room and its seat are kept');
    assert.notEqual(room.preparation.verdict, 'ok');
    assert.equal((await api('presented')).committed, 0, 'no invalid map is ever loaded');
    assert.equal((await api('stats')).failed, 2, 'it retried once, not forever');
    assert.deepEqual(errors, []);
    evidence.runs.failure = { stats: await api('stats'), room: room.preparation };
    await page.close();
  }
});

test('a dev map goes through the validator: a good one races, a broken one is refused with the validator\'s message', { timeout: 60_000 }, async () => {
  const greybox = await readFile(join(repo, 'maps/greybox-loop.json'), 'utf8');
  {
    const { page, errors, api } = await open({ devMap: greybox });
    await api('startRound');
    await waitFor(page, () => window.__prep.presented().committed === 1, 'the dev map to be shown');
    assert.equal((await api('seeds'))[0].plan, 'dev-map');
    assert.equal((await api('room')).preparation.verdict, 'ok');
    assert.deepEqual(errors, []);
    await page.close();
  }
  {
    const broken = JSON.parse(greybox);
    broken.route.gates = [];
    const { page, errors, api } = await open({ devMap: JSON.stringify(broken) });
    await api('startRound');
    await waitFor(page, () => window.__prep.refused().length >= 1, 'the refusal');
    const message = (await api('refused'))[0];
    assert.match(message, /gates/, `the validator's rule is named: ${message}`);
    await waitFor(page, () => window.__prep.room()?.phase === 'Lobby' && window.__prep.room()?.preparation?.pending === null, 'the Lobby');
    assert.equal((await api('presented')).committed, 0, 'a broken map is never loaded');
    assert.ok((await api('stats')).refused >= 1);
    assert.deepEqual(errors, []);
    evidence.runs.brokenDevMap = { message, stats: await api('stats') };
    await page.close();
  }
});
