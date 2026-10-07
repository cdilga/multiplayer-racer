// P1-F05b browser tests: the host page's test surface, on the real web build (web/dist) in headless Chromium.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build, and the native `jj` (JJ_BIN, else `cargo run`).
//   node --test web/host/tests/surface.test.mjs
// Writes its evidence to docs/evidence/P1-F05b/ (JJ_EVIDENCE_DIR overrides).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { assertTestable, openHost, serve, serveReal, track } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const dist = join(repo, 'web/dist');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-F05b');
const FIXTURE = 'scenarios/introspection/three-cars.json';

let browser;
let preview;
const runs = {};

/** The native run's full-state hash for a fixture (`jj sim --json`). */
function nativeHash(fixture) {
  const [cmd, ...args] = process.env.JJ_BIN
    ? [process.env.JJ_BIN]
    : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  const out = execFileSync(cmd, [...args, 'sim', '--json', fixture], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const o = JSON.parse(out);
  return (Array.isArray(o) ? o[0] : o).stateHash;
}

async function hostPage(server, query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  const mode = await openHost(page, `${server.url}/host/${query}`);
  return { page, mode };
}

before(async () => {
  browser = await chromium.launch();
  preview = await serve(dist, 'preview');
});

after(async () => {
  await browser?.close();
  preview?.close();
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, 'browser-run.json'), `${JSON.stringify({ browser: `Chromium ${browser.version()} (Playwright headless), ${process.platform}/${process.arch}`, ...runs }, null, 2)}\n`);
});

test('AC1: spawn three cars through the surface, step the held sim 600 ticks, match the native hash', { timeout: 300_000 }, async () => {
  const native = nativeHash(FIXTURE);
  const fixture = JSON.parse(await readFile(join(repo, FIXTURE), 'utf8'));
  const mapJson = await readFile(join(repo, fixture.map), 'utf8');
  const { page, mode } = await hostPage(preview, '?test');
  assert.equal(mode, 'test');
  // Held by default: the clock moves nothing.
  const t0 = (await page.evaluate(() => window.__jjTest.status())).tick;
  await page.waitForTimeout(300);
  assert.equal((await page.evaluate(() => window.__jjTest.status())).tick, t0, 'test mode starts held');
  const result = await page.evaluate(
    async ({ fixture, mapJson }) => {
      const s = window.__jjTest;
      await s.load({ ...fixture, cars: [], inputs: [] }, mapJson);
      const spawned = await s.spawn(fixture.cars);
      await s.inputs(fixture.inputs);
      const stepped = await s.step(600);
      const hash = await s.hash();
      const outcome = await s.outcome();
      const observed = await s.observe();
      return { spawned, stepped, hash, outcome, cars: observed.cars.length };
    },
    { fixture, mapJson },
  );
  await page.close();
  runs.ac1 = { fixture: FIXTURE, native, browser: result.hash.stateHash, tick: result.stepped.tick, spawned: result.spawned.cars, checks: result.outcome.checks };
  assert.deepEqual(result.spawned.cars, [0, 1, 2]);
  assert.equal(result.stepped.tick, 600);
  assert.equal(result.hash.stateHash, native, 'the browser host and the native run diverged');
  assert.ok(result.outcome.checks.every((c) => c.ok), JSON.stringify(result.outcome.checks));
});

test('AC2: a helper session joins three fake controllers, drives one until a fact holds, and captures with metadata', { timeout: 120_000 }, async () => {
  const { page } = await hostPage(preview, '?test');
  const session = await page.evaluate(async () => {
    const s = window.__jjTest;
    const joined = [await s.join('Ava'), await s.join('Bo'), await s.join('Cy')];
    s.drive(joined[0].endpoint, [0, 32767]);
    const car = joined[0].car;
    const until = await s.untilFact((st) => st.cars[car].speed >= 8, { maxTicks: 1200 });
    await s.overlay(true);
    const meta = await s.captureMeta('helper-session');
    return { joined, until: { held: until.held, tick: until.tick, ticks: until.ticks }, state: until.state, meta };
  });
  const dir = join(evidenceDir, 'helper-session');
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'capture.png') });
  await writeFile(join(dir, 'capture.json'), `${JSON.stringify(session.meta, null, 2)}\n`);
  await writeFile(join(dir, 'session.json'), `${JSON.stringify({ joined: session.joined, until: session.until, state: session.state }, null, 2)}\n`);
  await page.close();
  runs.ac2 = { joined: session.joined, until: session.until, capture: 'helper-session/capture.png', meta: session.meta };
  assert.equal(session.joined.length, 3);
  assert.deepEqual(new Set(session.joined.map((j) => j.car)).size, 3, 'three seats, three cars');
  assert.ok(session.until.held, `the driven car reached 8 m/s: ${JSON.stringify(session.until)}`);
  const others = session.state.cars.filter((c) => c.car !== session.joined[0].car);
  assert.ok(others.every((c) => c.speed < 1), 'only the driven controller moved its car');
  for (const k of ['commit', 'map', 'seed', 'viewport', 'browser', 'backend', 'stateHash', 'tick']) assert.ok(session.meta[k] !== undefined, `capture metadata has ${k}`);
});

test('AC4: against the real jj-server, no URL flag never loads the test chunk and a production realm answering 404 leaves the host as shipped', { timeout: 120_000 }, async () => {
  // The preview realm serves the test chunk like any asset; production answers every path under /test/ with 404, and /host with 200.
  const previewReal = await serveReal(dist, 'preview');
  const productionReal = await serveReal(dist, 'production');
  try {
    const status = async (server, path) => (await fetch(`${server.url}${path}`)).status;
    const chunk = (await readdir(join(dist, 'test'))).find((f) => f.endsWith('.js'));
    assert.ok(chunk, 'the build has a test/ chunk');
    assert.equal(await status(productionReal, '/host'), 200, 'production: /host is served');
    assert.equal(await status(productionReal, `/test/${chunk}`), 404, 'production: the test chunk is 404');
    assert.equal(await status(productionReal, '/test/'), 404, 'production: /test/ is 404');
    assert.equal(await status(previewReal, '/host'), 200, 'preview: /host is served');
    assert.equal(await status(previewReal, `/test/${chunk}`), 200, 'preview: the test chunk is served');

    // No URL flag: the page never asks for anything under /test/ and has no surface.
    const plainPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    track(previewReal, plainPage);
    const plainMode = await openHost(plainPage, `${previewReal.url}/host`);
    await plainPage.waitForTimeout(500);
    const plain = { mode: plainMode, surface: await plainPage.evaluate(() => window.__jjTest !== undefined), testRequests: previewReal.requests.filter((p) => p.startsWith('/test/')) };
    await plainPage.close();
    // `?test` on a production realm: the chunk is asked for, gets 404, and the host runs as shipped.
    const prodPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    prodPage.on('pageerror', (e) => console.error('pageerror', e.message));
    track(productionReal, prodPage);
    const prodMode = await openHost(prodPage, `${productionReal.url}/host?test`);
    await prodPage.waitForTimeout(500);
    const gated = {
      mode: prodMode,
      surface: await prodPage.evaluate(() => window.__jjTest !== undefined),
      testRequests: productionReal.requests.filter((p) => p.startsWith('/test/')),
    };
    await prodPage.close();
    runs.ac4 = { server: 'jj-server (real), realms preview and production', noFlag: plain, productionRealm: gated, guardrail: '' };
    assert.deepEqual(plain, { mode: 'ready', surface: false, testRequests: [] });
    assert.equal(gated.mode, 'ready', 'the host booted as shipped');
    assert.equal(gated.surface, false);
    assert.ok(gated.testRequests.length >= 1, 'it asked for the chunk and got 404');
    assert.throws(() => assertTestable('https://jammers.dilger.dev/host/?test'), /refusing/);
    runs.ac4.guardrail = 'assertTestable refuses https://jammers.dilger.dev/host/?test';
  } finally {
    await previewReal.close();
    await productionReal.close();
  }
});
