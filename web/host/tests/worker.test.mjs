// P1-S02 browser tests: the host's sim worker (jj-wasm-host as WASM in a real module Web Worker) in headless Chromium.
// Needs the pkg and the harness built first:
//   scripts/build-host-wasm.sh && npx --prefix web vite build --config web/host/tests/vite.config.ts
//   node --test web/host/tests/
// Writes what it measured to docs/evidence/P1-S02/browser-run.json (JJ_EVIDENCE overrides the path).
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const repo = resolve(import.meta.dirname, '../../..');
const dist = join(repo, 'web/dist-test');
const evidencePath = process.env.JJ_EVIDENCE ?? join(repo, 'docs/evidence/P1-S02/browser-run.json');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const STOP = 720;
const evidence = { browser: '', ac1: [], ac2: {}, ac3: {}, ac4: {}, ac5: {} };

let server;
let browser;
let page;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = () => page.evaluate(() => window.__jj.status());

async function untilTick(tick, timeoutMs = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const s = await status();
    if (s.tick >= tick) return s;
    assert.ok(Date.now() - t0 < timeoutMs, `tick ${s.tick} never reached ${tick} (pause mask ${s.pauseMask})`);
    await sleep(50);
  }
}

/** The native tests' pad: full throttle for 2 s, then steering for 2 s, then coasting; a sample every 6 ticks. */
function drive(t) {
  return t < 240 ? [0, 32_767] : t < 480 ? [16_000, 20_000] : [0, 0];
}

function padScript() {
  const s = [];
  for (let t = 0; t < STOP; t += 6) s.push({ tick: t, input: { type: 'local', source: 1, axes: [...drive(t), 0, 0] } });
  return s;
}

/** The same driving through the controller wire: Hello and Claim at tick 0, then state records on source handle 1. */
function wireScript() {
  const s = [
    { tick: 0, input: { type: 'controller', endpoint: 'phone', frame: { hello: true } } },
    { tick: 0, input: { type: 'controller', endpoint: 'phone', frame: { claim: 'Ava' } } },
  ];
  let k = 0;
  for (let t = 0; t < STOP; t += 6) {
    k++;
    s.push({ tick: t, input: { type: 'controller', endpoint: 'phone', frame: { state: { source: 1, seq: k, drive: drive(t) } } } });
  }
  return s;
}

/** Thirty phones joining one after another while the pad drives: a steady stream of events and outbound bytes. */
function crowdScript() {
  const s = padScript();
  for (let i = 0; i < 30; i++) {
    const endpoint = `p${i}`;
    s.push({ tick: 10 + i * 20, input: { type: 'controller', endpoint, frame: { hello: true } } });
    s.push({ tick: 10 + i * 20, input: { type: 'controller', endpoint, frame: { claim: `P${i}` } } });
  }
  return s;
}

async function runToStop(opts) {
  const t0 = Date.now();
  await page.evaluate((o) => window.__jj.start(o), { ...opts, stopAt: STOP });
  const s = await untilTick(STOP);
  const wallMs = Date.now() - t0;
  await sleep(100); // the last drain and snapshot reach main
  const render = await page.evaluate(() => window.__jj.render());
  const lines = await page.evaluate(() => window.__jj.lines());
  return { ...(await status()), wallMs, render, lines, tickAtFirstSeen: s.tick };
}

before(async () => {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(dist, path === '/' ? 'harness.html' : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch();
  evidence.browser = `Chromium ${browser.version()} (Playwright headless), ${process.platform}/${process.arch}`;
  page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/harness.html`);
  await page.waitForFunction(() => window.__jj !== undefined);
});

after(async () => {
  await browser?.close();
  server?.close();
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
});

test('AC1: rendering at 30, 60 and 144 Hz gives the same tick hash', { timeout: 90_000 }, async () => {
  const script = padScript();
  for (const [hz, workMs] of [[30, 20], [60, 8], [144, 2]]) {
    const r = await runToStop({ renderHz: hz, renderWorkMs: workMs, script });
    assert.equal(r.tick, STOP);
    assert.ok(r.render.frames > 0 && r.render.snapshots > 0, `the renderer ran: ${JSON.stringify(r.render)}`);
    evidence.ac1.push({ renderHz: hz, renderWorkMs: workMs, tick: r.tick, hash: r.hash, frames: r.render.frames, snapshots: r.render.snapshots, wallMs: r.wallMs });
  }
  console.log(evidence.ac1.map((r) => `${r.renderHz} Hz: tick ${r.tick} ${r.hash}`).join('\n'));
  const hashes = new Set(evidence.ac1.map((r) => r.hash));
  assert.equal(hashes.size, 1, 'the render cadence changed the simulation');
});

test('AC2: controller bytes and LocalSource drive identically (source parity)', { timeout: 60_000 }, async () => {
  const local = evidence.ac1.find((r) => r.renderHz === 60) ?? (await runToStop({ renderHz: 60, script: padScript() }));
  const wire = await runToStop({ renderHz: 60, script: wireScript() });
  const welcomed = wire.lines.some((l) => l.startsWith('outbound phone Cmd'));
  const joined = wire.lines.some((l) => l.startsWith('event SeatJoined'));
  evidence.ac2 = { tick: wire.tick, localHash: local.hash, wireHash: wire.hash, welcomed, joined };
  assert.ok(welcomed && joined, `the phone was welcomed and seated: ${wire.lines.join(' | ')}`);
  assert.equal(wire.hash, local.hash, 'controller bytes and LocalSource diverged');
});

test('AC3: hiding pauses with no catch-up; resume counts down with input re-armed at neutral', { timeout: 60_000 }, async () => {
  await page.evaluate(() => window.__jj.start({ renderHz: 60 }));
  await page.evaluate(() => window.__jj.hold(1, [0, 32_767, 0, 0]));
  await untilTick(240);
  assert.ok((await status()).appliedThrottle[0] > 0.9, 'the pad drives');

  // Hidden for two seconds: the clock stops at once and nothing is replayed after.
  await page.evaluate(() => window.__jj.hide());
  await sleep(100);
  const hidden = await status();
  assert.deepEqual(await page.evaluate(() => window.__jj.pauseReasons()), ['host-hidden']);
  await sleep(2000);
  assert.equal((await status()).tick, hidden.tick, 'no ticks while hidden');
  await page.evaluate(() => window.__jj.show());
  const shownAt = Date.now();
  await sleep(200);
  const counting = await status();
  assert.equal(counting.tick, hidden.tick, 'no ticks during the countdown');
  assert.ok(counting.countdownMs > 2500, `a 3 s countdown: ${counting.countdownMs} ms`);
  assert.ok((await page.evaluate(() => window.__jj.countdownMs())) > 2000, 'main sees the countdown');
  const resumed = await untilTick(hidden.tick + 1);
  const countdownWallMs = Date.now() - shownAt;
  await sleep(1000);
  const later = await status();
  const ticksInSecond = later.tick - resumed.tick;
  assert.ok(countdownWallMs >= 2900, `ticks resumed after the countdown, not before: ${countdownWallMs} ms`);
  assert.ok(ticksInSecond > 80 && ticksInSecond < 160, `real time's ticks after resume, no catch-up: ${ticksInSecond} in ~1 s`);

  // Re-armed at neutral: the pad was held when the page hid and its last samples arrived during the pause, yet the
  // first tick after the countdown drives with neutral input until a fresh sample comes.
  await page.evaluate(() => window.__jj.hide());
  await sleep(300);
  const T = (await status()).tick;
  await page.evaluate((t) => {
    window.__jj.unhold();
    window.__jj.stopAt(t + 1);
  }, T);
  await page.evaluate(() => window.__jj.show());
  const first = await untilTick(T + 1, 6000);
  assert.equal(first.tick, T + 1);
  assert.equal(first.appliedThrottle[0], 0, 'the first tick after resume used neutral input');
  await page.evaluate(() => {
    window.__jj.stopAt(1e12);
    window.__jj.hold(1, [0, 32_767, 0, 0]);
  });
  await sleep(500);
  const fresh = await status();
  assert.ok(fresh.appliedThrottle[0] > 0.9, 'fresh input drives again');
  evidence.ac3 = {
    visibility: 'emulated: document.visibilityState + a dispatched visibilitychange (headless Chromium never hides a page)',
    hiddenTick: hidden.tick,
    hiddenForMs: 2000,
    countdownMsAt200: counting.countdownMs,
    countdownWallMs,
    ticksInFirstSecondAfterResume: ticksInSecond,
    rearm: { pauseTick: T, firstTickAfterResume: first.tick, throttleThere: first.appliedThrottle[0], throttleAfterFreshInput: fresh.appliedThrottle[0] },
  };
});

test('AC4: starving the snapshot buffers never blocks physics or drops events', { timeout: 60_000 }, async () => {
  const script = crowdScript();
  const fed = await runToStop({ renderHz: 60, script });
  const starved = await runToStop({ renderHz: 60, script, starve: true, poolSize: 3 });
  const count = (r, p) => r.lines.filter((l) => l.startsWith(p)).length;
  evidence.ac4 = {
    fed: { hash: fed.hash, published: fed.published, skipped: fed.skipped, wallMs: fed.wallMs, lines: fed.lines.length },
    starved: { hash: starved.hash, published: starved.published, skipped: starved.skipped, wallMs: starved.wallMs, lines: starved.lines.length, held: starved.render.held },
    seatJoined: count(starved, 'event SeatJoined'),
    outbound: count(starved, 'outbound '),
  };
  assert.equal(starved.published, 3, 'every pooled buffer went out and none came back');
  assert.ok(starved.skipped > STOP - 10, `publishes were skipped, not waited for: ${starved.skipped}`);
  assert.ok(starved.wallMs < 9000, `physics kept real time while starved: ${STOP} ticks in ${starved.wallMs} ms`);
  assert.equal(starved.hash, fed.hash);
  assert.ok(evidence.ac4.seatJoined >= 30 && evidence.ac4.outbound >= 30, JSON.stringify(evidence.ac4));
  assert.deepEqual(starved.lines, fed.lines, 'the starved run lost or reordered events');
});

test('AC5: a worker panic surfaces as the fault pause reason', { timeout: 30_000 }, async () => {
  await page.evaluate(() => window.__jj.start({ renderHz: 60 }));
  await untilTick(60);
  await page.evaluate(() => window.__jj.panic());
  await sleep(200);
  const reasons = await page.evaluate(() => window.__jj.pauseReasons());
  const faults = await page.evaluate(() => window.__jj.faults());
  const at = await status();
  await sleep(500);
  const still = await status();
  evidence.ac5 = { reasons, faults, tickAtFault: at.tick, tickAfter500ms: still.tick, statusMask: still.pauseMask };
  assert.ok(reasons.includes('fault'), `pause reasons: ${reasons}`);
  assert.ok(faults.length > 0, 'main was told why');
  assert.equal(still.tick, at.tick, 'the sim stopped');
  assert.equal(still.pauseMask & 16, 16);
});
