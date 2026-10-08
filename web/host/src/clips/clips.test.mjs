// P1-F07 (bug clips) and P1-F12 (session recorder) browser tests, on the real host page through the real build, with the
// native `jj sim --replay` as the judge. Run on eris (browsers don't run on the Mac):
//   scripts/remote/eris.sh --run f07 'scripts/build-host-wasm.sh && JJ_BIN=target/debug/jj node --test web/host/src/clips/clips.test.mjs'
// (`JJ_BIN` defaults to `cargo run -p jj-tools`.) Evidence goes to docs/evidence/P1-F07/ and P1-F12/ (JJ_EVIDENCE_DIR
// overrides both).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../../landing/tests/lib/site.mjs';
import { chromiumArgs } from '../../../tests/journeys/lib/chromium.mjs';

const repo = resolve(import.meta.dirname, '../../../..');
const out7 = join(process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence'), 'P1-F07');
const out12 = join(process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence'), 'P1-F12');
const BASE = '/p/clips/';
let browser;
let server;
const runs = { f07: {}, f12: {} };

before(async () => {
  server = await serve(build('./', 'clips'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  mkdirSync(out7, { recursive: true });
  mkdirSync(out12, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
  const env = { browser: `Chromium ${browser?.version()} (Playwright headless), ${process.platform}/${process.arch}`, takenAt: new Date().toISOString() };
  writeFileSync(join(out7, 'browser-run.json'), `${JSON.stringify({ ...env, ...runs.f07 }, null, 2)}\n`);
  writeFileSync(join(out12, 'browser-run.json'), `${JSON.stringify({ ...env, ...runs.f12 }, null, 2)}\n`);
});

/** `jj sim --replay …`: the exit code, stdout and stderr. */
function replay(file, args = []) {
  const [cmd, ...pre] = process.env.JJ_BIN ? [resolve(repo, process.env.JJ_BIN)] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  const r = spawnSync(cmd, [...pre, 'sim', '--replay', ...args, file], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const replayJson = (file, build) => {
  const r = replay(file, ['--json', '--build', build]);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout)[0].report;
};

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
async function testHost(path = 'host?test') {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.origin}${BASE}${path}`);
  await wait(page, () => document.documentElement.dataset.jjHost === 'test', undefined, 60_000);
  return { page, errors };
}

/** A scripted G04 free-drive session: one fake controller joins and drives; returns the live state hash at the end. */
async function driveSession(page, ticks) {
  return page.evaluate(async (ticks) => {
    const s = window.__jjTest;
    const j = await s.join('Ava');
    s.drive(j.endpoint, [0, 32767]);
    await s.untilFact((st) => Math.abs(st.cars[0].speed) > 6, { maxTicks: 1500 });
    await s.untilFact(() => false, { maxTicks: ticks });
    const hash = await s.hash();
    return { hash, j };
  }, ticks);
}

test('F07 AC1: a clip saved from a scripted free-drive session replays to the same end-state hash', { timeout: 300_000 }, async () => {
  const { page, errors } = await testHost();
  const { hash } = await driveSession(page, 600);
  const saved = await page.evaluate(async () => {
    const s = await window.__jjTest.saveClip('AC1: end of the scripted drive');
    return { bundle: s.bundle, saveMs: s.saveMs, maxFrameMs: s.maxFrameMs, bytes: s.bytes };
  });
  const file = join(out7, 'free-drive.jjclip');
  writeFileSync(file, JSON.stringify(saved.bundle));
  const r = replayJson(file, saved.bundle.build);
  writeFileSync(join(out7, 'free-drive.replay.json'), `${JSON.stringify(r, null, 2)}\n`);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.worlds[0].ticks, hash.tick);
  assert.equal(r.worlds[0].endHash, hash.stateHash, 'the native replay of the browser clip ends in the browser host\'s hash');
  assert.equal(r.mark.tick, hash.tick);
  assert.equal(saved.bundle.worlds[0].label, 'free drive');
  assert.ok(saved.bundle.worlds[0].chunks.length > 0 && saved.bundle.worlds[0].checkpoints.length >= 1);
  runs.f07.ac1 = { tick: hash.tick, browserHash: hash.stateHash, replayHash: r.worlds[0].endHash, build: saved.bundle.build, clipBytes: saved.bytes, checkpoints: saved.bundle.worlds[0].checkpoints.length };
  assert.deepEqual(errors, []);
  await page.close();
});

test('F07 AC2: a clip saved after an injected worker fault replays up to the fault\'s tick', { timeout: 300_000 }, async () => {
  const { page } = await testHost();
  const { hash } = await driveSession(page, 300);
  await page.evaluate(async () => window.__jjTest.clips.checkpoint());
  await page.evaluate(() => window.__jjTest.panic());
  await wait(page, () => window.__jjTest.clips.fault !== null);
  const saved = await page.evaluate(async () => (await window.__jjTest.saveClip('AC2: after the fault')).bundle);
  const file = join(out7, 'after-fault.jjclip');
  writeFileSync(file, JSON.stringify(saved));
  assert.equal(saved.fault.tick, hash.tick);
  assert.match(saved.fault.message, /debug_panic|unreachable|RuntimeError/);
  const human = replay(file, ['--build', saved.build]);
  assert.equal(human.code, 0, human.stdout + human.stderr);
  assert.match(human.stdout, /faulted in world 0 at tick/);
  const r = replayJson(file, saved.build);
  writeFileSync(join(out7, 'after-fault.replay.json'), `${JSON.stringify(r, null, 2)}\n`);
  assert.equal(r.worlds[0].ticks, hash.tick, 'replayed up to the fault\'s tick');
  assert.equal(r.worlds[0].endHash, hash.stateHash);
  runs.f07.ac2 = { faultTick: saved.fault.tick, message: saved.fault.message, replayTicks: r.worlds[0].ticks, replayHash: r.worlds[0].endHash, browserHash: hash.stateHash };
  await page.close();
});

test('F07 AC3: a clip from a different build is refused with a clear message', { timeout: 300_000 }, async () => {
  const { page } = await testHost();
  await driveSession(page, 120);
  const saved = await page.evaluate(async () => (await window.__jjTest.saveClip('AC3')).bundle);
  const file = join(out7, 'free-drive-short.jjclip');
  writeFileSync(file, JSON.stringify(saved));
  const other = saved.build.startsWith('0') ? '1' + saved.build.slice(1) : '0' + saved.build.slice(1);
  const refused = replay(file, ['--build', other]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, new RegExp(`saved by build ${saved.build}`));
  assert.match(refused.stderr, /--any-build/);
  writeFileSync(join(out7, 'different-build.refusal.txt'), refused.stderr);
  runs.f07.ac3 = { clipBuild: saved.build, replayerBuild: other, exit: refused.code, message: refused.stderr.trim() };
  await page.close();
});

test('F07 AC4: saving a clip never pauses or stutters the host (frame time recorded), and Ctrl/Cmd+Shift+B downloads one', { timeout: 300_000 }, async () => {
  const { page } = await testHost('host?test=live');
  // A long session so the clip is big, with the host animating while it runs.
  await page.evaluate(async () => {
    const s = window.__jjTest;
    await s.hold(true);
    const j = await s.join('Ava');
    s.drive(j.endpoint, [0, 32767]);
    await s.untilFact(() => false, { maxTicks: 6000, every: 6 });
    await s.hold(false);
  });
  await page.waitForTimeout(500);
  const before = await page.evaluate(async () => ({ pacing: window.__jjTest.clips.meter.pacing(), tick: (await window.__jjTest.status()).tick }));
  const tick0 = before.tick;
  const saves = await page.evaluate(async () => {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const s = await window.__jjTest.saveClip(`AC4 save ${i}`);
      rows.push({ saveMs: s.saveMs, maxFrameMs: s.maxFrameMs, bytes: s.bytes });
      await new Promise((r) => setTimeout(r, 200));
    }
    return rows;
  });
  const after = await page.evaluate(() => window.__jjTest.status());
  assert.ok(after.tick > tick0 + 30, `the sim kept running through the saves (tick ${tick0} -> ${after.tick})`);
  for (const s of saves) assert.ok(s.maxFrameMs === null || s.maxFrameMs < 120, `a frame gap of ${s.maxFrameMs} ms while saving`);
  const pacing = await page.evaluate(() => window.__jjTest.clips.meter.pacing());
  const download = page.waitForEvent('download', { timeout: 10_000 });
  await page.keyboard.press('Control+Shift+B');
  const d = await download;
  assert.match(d.suggestedFilename(), /^jj-clip-.*\.jjclip$/);
  runs.f07.ac4 = { saves, framePacingBefore: before.pacing, framePacingAfter: pacing, simTicksDuringSaves: after.tick - tick0, hotkeyDownload: d.suggestedFilename() };
  await page.close();
});

test('F12: a scripted two-round session records, survives a worker fault, never uploads, and replays round by round', { timeout: 900_000 }, async () => {
  const { page, errors } = await testHost('host?room&test=live&laps=1');
  await wait(page, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const sent = [];
  page.on('request', (r) => r.postData() && sent.push(r.postData()));
  page.on('websocket', (ws) => ws.on('framesent', (f) => typeof f.payload === 'string' && sent.push(f.payload)));
  const frame = (endpoint, f) => page.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
  const phase = () => page.evaluate(() => `${window.__jjRoom.view().phase}:${window.__jjRoom.view().round}`);
  const runUntil = async (done, label) => {
    for (let i = 0; i < 80; i++) {
      await page.evaluate(() => window.__jjTest.step(300));
      await page.waitForTimeout(170);
      await page.evaluate(() => window.__jjTest.step(1));
      if (done(await phase())) return;
    }
    throw new Error(`never reached ${label}: ${await phase()}`);
  };

  for (const [e, name] of [['syn1', 'Davo'], ['syn2', 'Shazza']]) {
    await frame(e, { hello: true });
    await frame(e, { claim: name });
  }
  await wait(page, () => window.__jjRoom.view().seats.length === 2);
  await page.evaluate(() => {
    window.__jjTest.noteConnection('syn1', 'lan');
    window.__jjTest.noteConnection('syn2', 'relay');
  });

  // Round 1: both ready, the autopilot races a lap, the clock held and stepped so every fact is exact.
  await frame('syn1', { ready: true });
  await frame('syn2', { ready: true });
  await wait(page, () => window.__jjRoom.view().phase === 'Running', undefined, 120_000);
  await page.evaluate(async () => {
    const t = window.__jjTest;
    await t.hold(true);
    await t.command({ cmd: 'autopilot', on: true });
    // A host pad too, so there are input ages to summarise.
    for (let i = 0; i < 30; i++) {
      t.input({ type: 'local', source: 1, axes: [0, 0, 0, 0], buttons: 0, seq: i, sampledAt: performance.timeOrigin + performance.now() });
      await t.step(2);
    }
  });
  // The lap itself isn't what this test judges (the recorder is), and a software-GL host takes minutes to drive one: run the
  // autopilot for a few seconds of sim time, then end the race as the rules end it (`finishRace`, journaled like any command).
  await page.evaluate(async () => {
    await window.__jjTest.step(600);
    await window.__jjTest.command({ cmd: 'finishRace' });
  });
  await runUntil((p) => p.startsWith('Intermission'), 'Intermission');
  const r1 = await page.evaluate(async () => {
    await window.__jjTest.clips.checkpoint();
    return window.__jjTest.hash();
  });

  // Round 2.
  await page.getByRole('button', { name: 'Start next round now' }).click();
  await runUntil((p) => p.startsWith('Running:2'), 'round 2 running');
  await page.evaluate(async () => {
    await window.__jjTest.command({ cmd: 'autopilot', on: true });
    await window.__jjTest.step(900);
  });
  const r2 = await page.evaluate(async () => {
    await window.__jjTest.clips.checkpoint();
    await window.__jjTest.session.sampleInputAges();
    return window.__jjTest.hash();
  });

  const { bundle, id } = await page.evaluate(async () => {
    const s = await window.__jjTest.saveSession();
    return { bundle: s.bundle, id: window.__jjTest.session.id };
  });
  const file = join(out12, 'two-rounds.jjsession');
  writeFileSync(file, JSON.stringify(bundle));
  const report = replayJson(file, bundle.build);
  writeFileSync(join(out12, 'two-rounds.replay.json'), `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(report.ok, true, JSON.stringify(report));
  const roundWorlds = report.worlds.filter((w) => w.round !== null);
  assert.ok(roundWorlds.length >= 2, `rounds in the session: ${JSON.stringify(report.worlds.map((w) => [w.index, w.label, w.ticks]))}`);
  assert.equal(roundWorlds.find((w) => w.round === 1).endHash, r1.stateHash, 'round 1 replays to its end-state hash');
  assert.equal(report.worlds.at(-1).endHash, r2.stateHash, 'round 2 replays to its end-state hash');
  for (const w of report.worlds) assert.ok(w.checkpoints.every((c) => c.ok));

  // P1-M08a: a prepared-map round's clip names its track: the seed is the session seed plus the preparation id.
  const seeded = bundle.worlds.filter((w) => w.trackSeed !== null);
  assert.ok(seeded.length >= 1, `no world carries its track seed: ${JSON.stringify(bundle.worlds.map((w) => [w.index, w.label, w.trackSeed, w.preparation]))}`);
  for (const w of seeded) assert.equal(w.trackSeed, w.sessionSeed + w.preparation, 'track seed = session seed + preparation id');
  assert.ok(bundle.notes.trackSeeds.length >= 1);
  runs.f12.trackSeeds = seeded.map((w) => ({ world: w.index, label: w.label, preparation: w.preparation, trackSeed: w.trackSeed, mapHash: w.mapHash }));

  // The JSON summary.
  const sum = bundle.summary;
  writeFileSync(join(out12, 'summary.json'), `${JSON.stringify(sum, null, 2)}\n`);
  assert.ok(sum.rounds.filter((r) => r.round !== null).length >= 2);
  assert.ok(sum.rosterChanges.filter((c) => c.kind === 'joined').length >= 2);
  assert.deepEqual(sum.connectionPaths.map((c) => [c.endpoint, c.path]), [['syn1', 'lan'], ['syn2', 'relay']]);
  assert.ok(sum.inputAge.length >= 1 && typeof sum.inputAge[0].p95Ms === 'number' && typeof sum.inputAge[0].p99Ms === 'number', JSON.stringify(sum.inputAge));
  assert.ok(sum.framePacing.frames > 0 && sum.framePacing.p95Ms > 0);
  assert.equal(sum.recording.uploaded, false);

  // Nothing leaves the page: no request body or socket frame mentions the session or carries its journal.
  const needles = [id, bundle.worlds[0].map.slice(0, 64)];
  for (const body of sent) for (const n of needles) assert.ok(!body.includes(n), 'session data in an outgoing request');

  // The cost, measured.
  const tap = await page.evaluate(() => window.__jjTest.tapStats());
  const cost = await page.evaluate(() => window.__jjTest.session.cost());
  assert.ok(tap.totalMs / tap.polls < 2, `a journal poll costs ${tap.totalMs / tap.polls} ms in the worker`);
  assert.ok(cost.mainIntakeMeanMs < 1, `main's intake ${cost.mainIntakeMeanMs} ms per message`);

  // A worker fault: the store still holds the session, and it replays too.
  await page.evaluate(() => window.__jjTest.panic());
  await wait(page, () => window.__jjTest.clips.fault !== null);
  await page.waitForTimeout(500);
  const stored = await page.evaluate(async (id) => (await window.__jjTest.session.flush(), await window.__jjTest.session.loadStored(id)), id);
  assert.ok(stored.worlds.length >= 2 && stored.fault, 'the store kept the session through the fault');
  const stFile = join(out12, 'after-fault.jjsession');
  writeFileSync(stFile, JSON.stringify(stored));
  const stReport = replayJson(stFile, stored.build);
  assert.equal(stReport.ok, true);
  writeFileSync(join(out12, 'after-fault.replay.json'), `${JSON.stringify(stReport, null, 2)}\n`);
  runs.f12 = {
    ...runs.f12,
    rounds: report.worlds.map((w) => ({ world: w.index, label: w.label, trackSeed: w.track_seed ?? w.trackSeed, ticks: w.ticks, endHash: w.endHash, checkpoints: w.checkpoints.length })),
    roundOneBrowserHash: r1.stateHash,
    roundTwoBrowserHash: r2.stateHash,
    tapCost: { polls: tap.polls, meanMs: tap.totalMs / tap.polls, maxMs: tap.maxMs, chunkChars: tap.chunkChars },
    sessionCost: cost,
    framePacing: sum.framePacing,
    sessionFileBytes: JSON.stringify(bundle).length,
    uploaded: false,
    outgoingBodiesChecked: sent.length,
    afterFault: { worlds: stored.worlds.length, replayOk: stReport.ok },
  };
  assert.deepEqual(errors.filter((e) => !/debug_panic|unreachable/.test(e)), []);
  await page.close();
});
