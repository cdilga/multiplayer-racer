// Journey JN4 (P1-G05): crashes end to end, through the real host page and the real controller path (the test surface's
// fake controllers join with Hello + Claim as cmd-channel bytes and send DRIVE state frames, as a phone's would arrive; no
// WebRTC). Four controllers are driven into the staged collisions of `scenarios/crashes/jn4-crashes.json` (the same file
// `crates/jj-sim/tests/crashes.rs` calibrates natively): a side swipe, a T-bone and a head-on. Each stage teleports the cars
// with the test surface's `place` command (the F05b setup) and holds their DRIVE sticks forward while they collide. Then:
//  - the expected parts go loose, then detach (stage by stage, read off the sim's own part states);
//  - every piece that came off is debris in the world, drawn by the renderer where it lies, seen by the tiles of the cars
//    it fell from, still there (never removed, merged or frozen) after the cars drive on, and it moves when a car hits it;
//  - nobody stays stuck: each controller holds DRIVE forward and its car drives away, or wrecks and respawns at its anchor
//    inside about 2 s; the room never pauses (no pause reason at any point);
//  - a bug clip saved at the end replays natively (`jj sim --replay`) to the browser's own full-state hash.
// Needs the two test hooks in `docs/evidence/P1-G05/test-hooks.patch` (`place` on the test surface, `__jjRender.tilesSee`).
// Run on eris (browsers don't run on the Mac):
//   scripts/remote/eris.sh --run g05 'scripts/build-host-wasm.sh && JJ_BIN=target/debug/jj node --test web/tests/journeys/jn4-crashes.test.mjs'
// `JJ_CAPTURE_DIR=<dir>` saves the visual self-review captures; `JJ_EVIDENCE_DIR` moves docs/evidence.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidence = join(process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence'), 'P1-G05');
const CAPTURE = process.env.JJ_CAPTURE_DIR ?? join(evidence, 'captures');
const BASE = '/p/jn4/';
// `JJ_JN4_ORBIT=90,90,90,90`: every tile's camera swings that many degrees round its car (a side-on view, as P1-S04b's captures
// use) and the captures are named `orbit-*`, so the damage is legible in them.
const ORBIT = process.env.JJ_JN4_ORBIT;
const SHOT = ORBIT ? 'orbit-' : '';
const scenario = JSON.parse(readFileSync(join(repo, 'scenarios/crashes/jn4-crashes.json'), 'utf8'));
const run = {};
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'jn4'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  mkdirSync(evidence, { recursive: true });
  mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
  writeFileSync(
    join(evidence, 'browser-run.json'),
    `${JSON.stringify({ browser: `Chromium ${browser?.version()} (Playwright headless), ${process.platform}/${process.arch}`, takenAt: new Date().toISOString(), ...run }, null, 2)}\n`,
  );
});

/** `jj sim --replay …`, as the F07 journey judges a clip. */
function replay(file, args) {
  const [cmd, ...pre] = process.env.JJ_BIN ? [resolve(repo, process.env.JJ_BIN)] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  const r = spawnSync(cmd, [...pre, 'sim', '--replay', ...args, file], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout)[0].report;
}

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const shot = (page, name) => page.screenshot({ path: join(CAPTURE, `${SHOT}${name}.png`) });

test('JN4: four controllers crash head-on, T-bone and side-swipe: parts go loose then off, debris stays, nobody stays stuck, the clip replays', { timeout: 600_000 }, async () => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  // The free-drive room page (as JN1): a real room with its tile grid, the clock held so the journey steps it.
  await page.goto(`${server.origin}${BASE}host?drive&test=live&camdist=near${ORBIT ? `&tiles=4&follow=0,1,2,3&orbit=${ORBIT}` : ''}`);
  await wait(page, () => window.__jjNet?.code() && window.__jjTest && window.__jjRender, undefined, 60_000);
  await page.evaluate(() => window.__jjTest.hold(true));

  // Four fake controllers join through the real controller path and each gets a seat and a car.
  const drivers = await page.evaluate(async (n) => {
    const s = window.__jjTest;
    const out = [];
    for (const name of ['Ava', 'Bree', 'Cal', 'Dee'].slice(0, n)) out.push(await s.join(name));
    return out;
  }, scenario.park.length);
  assert.equal(new Set(drivers.map((d) => d.car)).size, 4, 'four seats, four cars');
  const endpoints = drivers.map((d) => d.endpoint);
  const cars = drivers.map((d) => d.car);
  // Spawn protection (1.5 s) ends before anything is placed: the cars are apart, so it ends on its own.
  await page.evaluate(() => window.__jjTest.untilFact(() => false, { maxTicks: 240, every: 6 }));

  const observe = () => page.evaluate(() => window.__jjTest.observe());
  const pauses = [];
  const noPause = async (when) => {
    const obs = await observe();
    const reasons = await page.evaluate(() => window.__jjTest.pauseReasons());
    pauses.push({ when, mask: obs.host.pauseMask, reasons });
    assert.equal(obs.host.pauseMask, 0, `the room never pauses (${when}): ${JSON.stringify(reasons)}`);
  };
  await noPause('before the crashes');
  /** The parts of `car` that aren't intact. */
  const damaged = (obs, car) => Object.fromEntries(obs.cars.find((c) => c.car === car).parts.filter((p) => p.state !== 'intact').map((p) => [p.part, p.state]));
  /** What the tiles of `involved` cars see: the debris pieces inside each such tile's camera frustum. */
  const tilesSee = async (obs) => {
    const pts = obs.debris.map((d) => [d.x, 0.4, d.z]);
    return page.evaluate((pts) => window.__jjRender.tilesSee(pts), pts);
  };

  /** One stage: place, hold the sticks, step while the cars collide. */
  const playStage = (stage, sticks) =>
    page.evaluate(
      async ({ stage, park, cars, endpoints, sticks }) => {
        const s = window.__jjTest;
        for (const [k, car] of cars.entries()) {
          const p = stage.place.find((q) => q.car === k);
          const at = p ?? { x: park[k][0], z: park[k][1], headingDeg: 90, linvel: [0, 0, 0] };
          await s.command({ cmd: 'place', car, pose: { x: at.x, y: 0.05, z: at.z, headingDeg: at.headingDeg }, linvel: at.linvel });
          s.drive(endpoints[k], p ? [0, Math.round(sticks * 32767)] : null);
        }
        await s.untilFact(() => false, { maxTicks: stage.ticks, every: 6 });
      },
      { stage, park: scenario.park, cars, endpoints, sticks },
    );

  // The tile grid animates as seats join: capture only once its rects have stopped moving.
  await page.evaluate(async () => {
    let last = '';
    for (let i = 0; i < 60; i++) {
      const now = JSON.stringify(window.__jjRender.tileRects());
      if (now === last) return;
      last = now;
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  const stages = [];
  let debrisSeen = 0;
  for (const [n, stage] of scenario.stages.entries()) {
    await playStage(stage, stage.throttle);
    const obs = await observe();
    // The expected parts: exactly the states the native calibration holds, read off the live host's sim.
    for (const [k, parts] of Object.entries(stage.expect)) {
      const got = damaged(obs, cars[Number(k)]);
      for (const [part, state] of Object.entries(parts)) assert.equal(got[part], state, `${stage.name}: car ${k} ${part} is ${got[part]}, expected ${state} (${JSON.stringify(got)})`);
    }
    // Debris only ever accumulates: every piece that came off stays in the world.
    assert.ok(obs.debris.length >= debrisSeen, `${stage.name}: debris never goes away (${obs.debris.length} < ${debrisSeen})`);
    debrisSeen = obs.debris.length;
    const involved = [...new Set(stage.place.map((p) => p.car))];
    const parts = obs.debris.filter((d) => d.kind === 'Part');
    // Visible: the renderer draws what lies on the road, and each involved car's tile sees a piece that came off it.
    await page.evaluate(() => new Promise((r) => { let i = 0; const f = () => (++i >= 8 ? r() : requestAnimationFrame(f)); f(); }));
    const stats = await page.evaluate(() => window.__jjRender.stats());
    const see = await tilesSee(obs);
    // Each detached part is drawn off its car (the renderer follows the debris body), not on it.
    const measure = () =>
      page.evaluate(
        (cs) =>
          cs.map((c) => {
            const by = Object.fromEntries(window.__jjRender.vehicles(c).parts.map((p) => [p.part, p]));
            return Object.fromEntries(Object.entries(by).map(([k, p]) => [k, +Math.hypot(p.position[0] - by.core.position[0], p.position[2] - by.core.position[2]).toFixed(2)]));
          }),
        cars,
      );
    // The renderer lags the sim a little (software or shared GL): give it up to 10 s to draw the parts off their cars.
    let offCar = await measure();
    for (let tries = 0; tries < 40; tries++) {
      const settled = cars.every((c, k) => Object.entries(damaged(obs, c)).every(([part, state]) => state !== 'detached' || offCar[k][part] > 1.0));
      if (settled) break;
      await page.waitForTimeout(250);
      offCar = await measure();
    }
    cars.forEach((c, k) => {
      for (const [part, state] of Object.entries(damaged(obs, c))) {
        if (state === 'detached') assert.ok(offCar[k][part] > 1.0, `${stage.name}: car ${k}'s detached ${part} is drawn ${offCar[k][part]} m from its core: off the car`);
      }
    });
    assert.equal(stats.debris, obs.debris.filter((d) => d.kind !== 'Part').length, `${stage.name}: parts are drawn as parts, the rest as debris`);
    const drawn = offCar;
    stages.push({ stage: stage.name, tick: obs.tick, damaged: Object.fromEntries(cars.map((c, k) => [k, damaged(obs, c)])), debris: obs.debris.length, parts: parts.length, drawnStats: stats.debris, tilesSee: see, drawn });
    for (const k of involved) {
      const tile = see.find((t) => t.seat === k + 1);
      assert.ok(tile?.sees.some(Boolean), `${stage.name}: car ${k}'s tile sees at least one piece of debris (${JSON.stringify(see)})`);
    }
    await shot(page, `stage-${n + 1}-${stage.name}`);
    await noPause(stage.name);
  }
  run.stages = stages;
  const settled = await observe();
  const wreckedBefore = cars.map((c) => settled.cars.find((x) => x.car === c).race.wrecks);
  const at0 = cars.map((c) => settled.cars.find((x) => x.car === c).position);
  const debrisSettled = debrisOfPieces(settled);

  // Nobody stays stuck: every controller holds DRIVE forward. Each car drives away, or wrecks and is back at its anchor in
  // about 2 s (the respawn hold). The room never pauses meanwhile.
  const da = scenario.driveAway;
  await page.evaluate(
    async ({ da, endpoints }) => {
      for (const e of endpoints) window.__jjTest.drive(e, [0, Math.round(da.throttle * 32767)]);
      await window.__jjTest.untilFact(() => false, { maxTicks: da.ticks, every: 6 });
    },
    { da, endpoints },
  );
  const after = await observe();
  const away = cars.map((c, k) => {
    const o = after.cars.find((x) => x.car === c);
    const moved = Math.hypot(o.position[0] - at0[k][0], o.position[2] - at0[k][2]);
    return { car: k, moved: +moved.toFixed(1), wrecked: o.race.wrecks > wreckedBefore[k], speed: +o.speed.toFixed(1), held: o.race.held ?? null };
  });
  run.driveAway = away;
  for (const a of away) assert.ok(a.wrecked || a.moved >= da.minTravelM, `car ${a.car} stayed stuck: ${JSON.stringify(a)}`);
  await noPause('after driving away');
  await shot(page, 'drove-away');

  // The debris is still all there and still dynamic: a car driven into a piece of it moves it, and nothing was removed.
  assert.ok(after.debris.length >= debrisSettled.length, `no debris vanished while the cars drove away (${after.debris.length} < ${debrisSettled.length})`);
  const target = debrisSettled.find((d) => d.kind === 'Part');
  assert.ok(target, 'there is a piece of debris to hit');
  const pushed = await page.evaluate(
    async ({ target, car, endpoint }) => {
      const s = window.__jjTest;
      const before = (await s.observe()).debris.map((d) => ({ x: d.x, z: d.z }));
      await s.command({ cmd: 'place', car, pose: { x: target.x - 9, y: 0.05, z: target.z, headingDeg: 90 }, linvel: [9, 0, 0] });
      s.drive(endpoint, [0, 32767]);
      await s.untilFact(() => false, { maxTicks: 240, every: 6 });
      s.drive(endpoint, null);
      const now = (await s.observe()).debris;
      return { moved: now.map((d, i) => (before[i] ? Math.hypot(d.x - before[i].x, d.z - before[i].z) : 0)), count: now.length, before: before.length };
    },
    { target, car: cars[0], endpoint: endpoints[0] },
  );
  run.pushed = pushed;
  assert.ok(Math.max(...pushed.moved) > 0.3, `a car drove into the debris and moved it: dynamic bodies (${JSON.stringify(pushed.moved)})`);
  assert.equal(pushed.count, pushed.before, 'nothing was removed or merged');
  await noPause('after hitting the debris');

  // A bug clip saved now replays natively to the browser's end state.
  const hash = await page.evaluate(() => window.__jjTest.hash());
  const saved = await page.evaluate(async () => {
    const s = await window.__jjTest.saveClip('JN4: the staged crashes');
    return { bundle: s.bundle, bytes: s.bytes };
  });
  const file = join(evidence, 'crashes.jjclip');
  writeFileSync(file, JSON.stringify(saved.bundle));
  const r = replay(file, ['--json', '--build', saved.bundle.build]);
  writeFileSync(join(evidence, 'crashes.replay.json'), `${JSON.stringify(r, null, 2)}\n`);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.worlds[0].ticks, hash.tick, 'the replay runs to the clip\'s tick');
  assert.equal(r.worlds[0].endHash, hash.stateHash, 'the native replay of the crash clip ends in the browser host\'s full-state hash');
  run.clip = { tick: hash.tick, browserHash: hash.stateHash, replayHash: r.worlds[0].endHash, build: saved.bundle.build, bytes: saved.bytes };
  run.pauses = pauses;
  assert.deepEqual(errors, []);
  await page.close();
});

/** The debris pieces of an observation. */
function debrisOfPieces(obs) {
  return obs.debris.map((d) => ({ x: d.x, z: d.z, kind: d.kind }));
}
