// P1-A03 / A05 / A07 browser tests: the host's audio on the real web build (web/dist), through the introspection surface
// `window.__jjAudio` (the trigger log, the engines, the mix state). Sound can't be heard in CI, so each test checks the log
// (what played, when, with which caption and mix state), the offline-rendered effects (not silent) and the CPU numbers.
// Needs: scripts/build-host-wasm.sh && npx --prefix web vite build.
//   node --test --test-concurrency=1 web/host/tests/audio.test.mjs
// Writes to docs/evidence/P1-A03|A05|A07/ (JJ_EVIDENCE_DIR overrides the root).
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evRoot = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence');
const ev = (bead) => join(evRoot, bead);
const runs = { 'P1-A03': {}, 'P1-A05': {}, 'P1-A07': {} };
let live; // Chromium with autoplay allowed: contexts run, clips decode and "play"
let blocked; // Chromium with the default policy: no gesture, contexts stay suspended
let server;

before(async () => {
  live = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  blocked = await chromium.launch({ args: ['--autoplay-policy=document-user-activation-required'] });
  server = await serve(join(repo, 'web/dist'));
  for (const b of Object.keys(runs)) await mkdir(ev(b), { recursive: true });
});

after(async () => {
  await live?.close();
  await blocked?.close();
  server?.close();
  const browser = `Chromium ${live?.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}`;
  for (const [bead, data] of Object.entries(runs)) await writeFile(join(ev(bead), 'browser-run.json'), `${JSON.stringify({ browser, ...data }, null, 2)}\n`);
});

async function open(browser, query = '?test=live') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await openHost(page, `${server.url}/host/${query}`);
  await page.waitForFunction(() => window.__jjAudio !== undefined, null, { timeout: 30_000 });
  return { page, errors };
}

const room = (o = {}) => ({
  phase: 'Lobby',
  remainingMs: null,
  round: 1,
  laps: 3,
  freeDrive: false,
  armed: false,
  seats: [
    { seat: 1, number: 1, name: 'A', rgb: [1, 2, 3], colourIndex: 0, ready: true, presence: 'Connected', local: true, car: 0, laps: 0, position: 1, finished: false },
    { seat: 2, number: 2, name: 'B', rgb: [1, 2, 3], colourIndex: 1, ready: true, presence: 'Connected', local: false, car: 1, laps: 0, position: 2, finished: false },
  ],
  results: null,
  standings: [],
  ...o,
});
const seats = (pos1) => room().seats.map((s) => ({ ...s, position: s.seat === pos1 ? 1 : 2 }));

/** A scripted round, as the worker would feed it: the room view's phases and the sim events, on a virtual clock (10 s per step). */
async function scriptedRound(page) {
  await page.evaluate(
    ({ steps }) => {
      const a = window.__jjAudio;
      let t = 1000;
      const at = () => (t += 10_000);
      const room = (o) => ({ ...steps.room, ...o });
      a.feedRoom(room({ phase: 'Lobby', seats: steps.room.seats.map((s) => ({ ...s, ready: false })) }), at());
      a.feedRoom(room({ phase: 'Lobby' }), at()); // everyone ready
      a.feedRoom(room({ phase: 'Countdown', remainingMs: 3000 }), at());
      a.feedRoom(room({ phase: 'Countdown', remainingMs: 2000 }), at());
      a.feedRoom(room({ phase: 'Countdown', remainingMs: 1000 }), at());
      a.feedRoom(room({ phase: 'Running', remainingMs: 120000 }), at());
      a.feedEvents([{ Lap: { seat: 1, lap: 2 } }], at()); // laps 3: lap 2 done is the final lap
      a.feedEvents([{ PartDetached: { seat: 2, part: 4, cause: 'Car', instigator: 1 } }], at()); // a door
      a.feedEvents([{ PartDetached: { seat: 2, part: 8, cause: 'Scenery', instigator: null } }], at()); // a wheel
      a.feedEvents([{ PartDetached: { seat: 2, part: 1, cause: 'Scenery', instigator: null } }], at()); // bodywork
      a.feedEvents([{ Wrecked: { seat: 2, cause: 'Car', instigator: 1 } }], at());
      a.feedEvents([{ Wrecked: { seat: 1, cause: 'OutOfBounds', instigator: null } }], at());
      a.feedEvents([{ SeatJoined: { seat: 3, number: 3 } }], at());
      a.feedEvents([{ Finished: { seat: 1, place: 1, time_ms: 61000 } }], at());
      a.feedEvents([{ Finished: { seat: 2, place: 2, time_ms: 61200 } }], at()); // within 500 ms: a photo finish
      a.feedRoom(room({ phase: 'Finalising', remainingMs: 5000, seats: steps.room.seats.map((s, i) => ({ ...s, finished: i === 0 })) }), at());
      a.feedRoom(room({ phase: 'Intermission', remainingMs: 20000 }), at());
      a.feedEvents([{ Results: { rows: [] } }], at());
      a.feedEvents([{ PrepareRequested: { preparation: 2, seed: 9 } }], at());
    },
    { steps: { room: room() } },
  );
}

const cues = (log) => log.filter((l) => l.kind === 'cue');

test('A03: a scripted round plays each moment from its event, with the sheet caption, music following the phases', { timeout: 120_000 }, async () => {
  const { page, errors } = await open(live);
  await page.evaluate(() => window.__jjAudio.unlock());
  await page.waitForFunction(() => window.__jjAudio.state().mix === 'running', null, { timeout: 10_000 });
  await scriptedRound(page);
  await page.waitForTimeout(800);
  await page.waitForTimeout(4500); // the last cue's duck ends in real time
  const log = await page.evaluate(() => window.__jjAudio.log());
  const played = cues(log);
  const byMoment = (m) => played.filter((c) => c.moment === m);
  const expected = {
    welcome: 'room.opened',
    'all-ready': 'lobby.all_ready',
    countdown: 'phase.countdown',
    'final-lap': 'race.final_lap',
    'door-off': 'part.detached.door',
    'wheel-off': 'part.detached.wheel',
    'bodywork-off': 'part.detached.bodywork',
    wreck: 'car.wrecked',
    'off-course': 'car.out_of_bounds',
    'late-joiner': 'seat.late_join',
    'first-finisher': 'race.first_finish',
    'photo-finish': 'race.photo_finish',
    'time-up': 'race.time_up',
    winner: 'round.results',
    'next-round': 'intermission.next_ready',
  };
  const sheet = await page.evaluate(() => window.__jjAudio.moments());
  for (const [moment, trigger] of Object.entries(expected)) {
    const c = byMoment(moment)[0];
    assert.ok(c, `a ${moment} cue played (${played.map((p) => p.moment).join(', ')})`);
    assert.equal(c.trigger, trigger, `${moment} fired by the sheet's event`);
    assert.equal(sheet.find((m) => m.moment === moment).trigger, trigger);
    assert.ok(c.caption.length > 3, `${moment} has its caption`);
    assert.equal(c.played, true, `${moment} was playable (context ${c.mix.state})`);
  }
  // The right moment: order follows the script.
  const order = played.map((p) => p.moment);
  const at = (m) => order.indexOf(m);
  assert.ok(at('welcome') < at('countdown') && at('countdown') < at('final-lap') && at('final-lap') < at('door-off') && at('door-off') < at('winner') && at('winner') < at('next-round'), order.join(' > '));
  // The off-course cue is the plain-instruction one, with its caption.
  const off = byMoment('off-course')[0];
  const offVariants = (await page.evaluate(() => window.__jjAudio.variants())).filter((v) => v.moment === 'off-course');
  assert.equal(offVariants.length, 4, 'off-course-1..4');
  assert.equal(offVariants.find((v) => v.variant === off.variant).caption, off.caption, "the cue shows its variant's sheet caption");
  assert.match(offVariants.find((v) => v.variant === 1).caption, /Out past whoop whoop/);
  assert.ok(offVariants.every((v) => /track/i.test(v.caption)), 'every off-course caption carries the plain instruction');
  // Music follows the phases: lobby, (none in the countdown), race, results.
  const music = log.filter((l) => l.kind === 'music').map((m) => m.cue);
  assert.deepEqual(music, ['lobby', 'none', 'race', 'results']);
  // Captions shown: the last cue's caption is on screen until it ends.
  const caps = await page.evaluate(() => window.__jjAudio.captions());
  assert.ok(caps.length >= Object.keys(expected).length);
  await page.evaluate(() => window.__jjAudio.say('wreck', 5e10));
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => window.__jjAudio.captionShown())).length > 3, 'a caption is on screen');
  await page.screenshot({ path: join(ev('P1-A03'), 'caption.jpg'), quality: 80, type: 'jpeg' });
  // Ducking: the announcer talking took the music and engines down.
  const ducks = log.filter((l) => l.kind === 'duck');
  assert.ok(ducks.some((d) => d.down) && ducks.some((d) => !d.down), 'the mix ducked and recovered');
  assert.deepEqual(errors, []);
  runs['P1-A03'].scripted = { cues: played.map((c) => ({ moment: c.moment, clip: c.clip, trigger: c.trigger, caption: c.caption })), music };
  await writeFile(join(ev('P1-A03'), 'cue-log.json'), `${JSON.stringify(log, null, 1)}\n`);
  await page.close();
});

test('A03: a moment that repeats never repeats its previous variant (off-course and wreck over eight plays each)', { timeout: 60_000 }, async () => {
  const { page } = await open(live);
  await page.evaluate(() => window.__jjAudio.unlock());
  for (const [k, moment] of ['off-course', 'wreck', 'lead-change'].entries()) {
    const seen = await page.evaluate(
      ([m, base]) => {
        const a = window.__jjAudio;
        a.clear();
        for (let i = 0; i < 8; i++) a.say(m, base + i * 60_000);
        return a.log('cue').map((c) => c.variant);
      },
      [moment, (k + 1) * 10_000_000],
    );
    assert.equal(seen.length, 8, `${moment}: ${JSON.stringify(seen)}`);
    for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], `${moment}: variant ${seen[i]} repeated at ${i} (${seen})`);
    assert.ok(new Set(seen).size > 1, `${moment} varies`);
    runs['P1-A03'][`variants-${moment}`] = seen;
  }
  await page.close();
});

test('A03: blocked or muted audio changes nothing else; the round and the sim carry on and the log still records the cues', { timeout: 180_000 }, async () => {
  const hashes = {};
  for (const [name, browser, mute] of [['live', live, false], ['muted', live, true], ['blocked', blocked, false]]) {
    const { page, errors } = await open(browser, name === 'blocked' ? '?test&audio=blocked' : '?test');
    if (name !== 'blocked') await page.evaluate(() => window.__jjAudio.unlock());
    if (mute) await page.evaluate(() => window.__jjAudio.setMuted(true));
    await page.evaluate(() => window.__jjAudio.clear());
    const fx = { scenario: 'audio-neutral', what: 'audio must change nothing', map: 'maps/greybox-loop.json', seed: 5, ticks: 300, cars: [] };
    // The held test host: spawn two cars, drive, step, hash. Same inputs in every browser mode.
    const stateHash = await page.evaluate(async (fixture) => {
      const s = window.__jjTest;
      await s.load({ ...fixture, cars: [], inputs: [] });
      await s.spawn([{ routePoint: 20, lateral: 0 }, { routePoint: 40, lateral: 3 }]);
      await s.inputs([{ car: 0, fromTick: 0, throttle: 0.7 }, { car: 1, fromTick: 30, throttle: 1, steer: 0.4 }]);
      window.__jjAudio.feedEvents([{ Wrecked: { seat: 1, cause: 'OutOfBounds', instigator: null } }, { PartDetached: { seat: 1, part: 4, cause: 'Car', instigator: null } }], 5e9);
      await s.step(300);
      return (await s.hash()).stateHash;
    }, fx);
    const log = await page.evaluate(() => window.__jjAudio.log());
    const state = await page.evaluate(() => window.__jjAudio.state());
    hashes[name] = { stateHash, cues: cues(log).map((c) => [c.moment, c.played]), mix: state.mix, muted: state.muted };
    assert.deepEqual(errors, [], name);
    await page.close();
  }
  assert.equal(hashes.live.stateHash, hashes.muted.stateHash, 'muting changed the sim');
  assert.equal(hashes.live.stateHash, hashes.blocked.stateHash, 'blocked audio changed the sim');
  assert.deepEqual(hashes.live.cues.map((c) => c[0]), hashes.blocked.cues.map((c) => c[0]), 'the same cues were triggered');
  assert.ok(hashes.blocked.cues.length >= 1 && hashes.blocked.cues.every((c) => c[1] === false), `nothing was played while blocked: ${JSON.stringify(hashes.blocked)}`);
  assert.ok(['blocked', 'locked'].includes(hashes.blocked.mix), `blocked audio reports ${hashes.blocked.mix}`);
  assert.ok(hashes.muted.cues.every((c) => c[1] === false), 'muted plays nothing');
  assert.ok(hashes.live.cues.some((c) => c[1] === true), 'live audio played');
  runs['P1-A03'].neutrality = hashes;
});

/** Every shipped clip decodes in this browser (the A03/A07 decode check): the built assets, fetched and decoded on a bare page. */
async function decodeEveryClip(engine, name) {
  const dir = join(repo, 'web/dist/assets');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.ogg') || f.endsWith('.m4a'));
  const browser = await engine.launch();
  const page = await browser.newPage();
  await page.goto(`${server.url}/host/index.html`).catch(() => {});
  const res = await page.evaluate(async (list) => {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    const ctx = new Ctor();
    const failed = [];
    const retried = [];
    let ok = 0;
    for (const f of list) {
      // One retry: a decode that fails once and passes on the second try is recorded, not hidden.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const buf = await ctx.decodeAudioData(await (await fetch(`../assets/${f}`)).arrayBuffer());
          if (buf.duration > 0.2) ok++;
          else failed.push(`${f} (${buf.duration}s)`);
          if (attempt) retried.push(f);
          break;
        } catch (e) {
          if (attempt) failed.push(`${f}: ${String(e).slice(0, 60)}`);
        }
      }
    }
    return { ok, failed, retried, canOggOpus: document.createElement('audio').canPlayType('audio/ogg; codecs=opus'), ua: navigator.userAgent };
  }, files);
  const version = browser.version();
  await browser.close();
  return { engine: name, version, files: files.length, ...res };
}

test('A03/A07: every shipped clip decodes in Chromium and WebKit (an AAC twin would be picked by canPlayType where it does not)', { timeout: 240_000 }, async () => {
  const results = [];
  for (const [engine, name] of [[chromium, 'Chromium'], [webkit, 'WebKit']]) {
    try {
      results.push(await decodeEveryClip(engine, name));
    } catch (e) {
      results.push({ engine: name, error: String(e).slice(0, 300) });
    }
  }
  for (const b of ['P1-A03', 'P1-A07']) runs[b].decode = results;
  await writeFile(join(ev('P1-A03'), 'decode-check.json'), `${JSON.stringify(results, null, 2)}\n`);
  const chromiumRes = results.find((r) => r.engine === 'Chromium');
  assert.deepEqual(chromiumRes.failed, [], 'Chromium decodes every clip');
  assert.ok(chromiumRes.ok >= 70, `${chromiumRes.ok} clips decoded`);
  const wk = results.find((r) => r.engine === 'WebKit');
  assert.ok(!wk.error, `WebKit ran: ${wk.error}`);
  assert.deepEqual(wk.failed, [], `WebKit decodes every clip (canPlayType ogg/opus: "${wk.canOggOpus}")`);
});

test('A05: a scripted 8-car round: engines follow rpm, throttle, boost and surface; start on engine-on, stop on a wreck; the Cruz has no turbo', { timeout: 240_000 }, async () => {
  const { page, errors } = await open(live, '?test=live');
  await page.evaluate(() => window.__jjAudio.unlock());
  await page.waitForFunction(() => window.__jjAudio.state().mix === 'running', null, { timeout: 10_000 });
  // Eight real cars from the worker, driven through the real controller path.
  const joined = [];
  for (let i = 0; i < 8; i++) joined.push(await page.evaluate((n) => window.__jjTest.join(`P${n}`), i + 1));
  // A phone re-sends its stick; the page does the same on a timer so the live clock keeps seeing it.
  await page.evaluate(([e]) => {
    window.__jjTest.drive(e, [0, 22000]);
  }, [joined[0].endpoint]);
  await page.evaluate(() => window.__jjTest.untilFact((s) => s.cars[0].speed >= 8, { maxTicks: 1500, every: 6 }));
  // Keep the stick on while the snapshot with its throttle reaches the audio.
  await page.evaluate(() => {
    window.__pump = setInterval(() => window.__jjTest.untilFact(() => false, { maxTicks: 6, every: 6 }), 60);
  });
  await page.waitForTimeout(500);
  const engines = await page.evaluate(() => window.__jjAudio.engines());
  assert.equal(engines.length, 8, 'one engine per car');
  const own = engines.find((e) => e.car === joined[0].car);
  assert.ok(own.ignition && own.speed > 5 && own.rpm > 1500, `the driven car's engine follows its speed: ${JSON.stringify(own)}`);
  assert.ok(own.throttle > 0.2, `and its throttle: ${JSON.stringify(own)}`);
  assert.ok(engines.filter((e) => e.car !== joined[0].car).every((e) => e.rpm <= own.rpm), 'parked cars idle below the driven one');
  assert.ok(engines.every((e) => e.profile === 'cruz-missile' && e.boostLayerBuilt === false), 'the Cruz Missile has no turbo layer');
  assert.ok(engines.every((e) => e.voiced), 'all eight are voiced within the budget');
  await page.evaluate(() => clearInterval(window.__pump));
  // Wreck stops the engine (R103), and it starts again when the hold ends.
  await page.evaluate((c) => window.__jjTest.command({ cmd: 'damage', car: c, part: 'wheel_FL', health: 0 }), joined[0].car);
  await page.evaluate((c) => window.__jjTest.command({ cmd: 'damage', car: c, part: 'wheel_RR', health: 0 }), joined[0].car);
  await page.evaluate(() => window.__jjTest.step(30));
  await page.waitForTimeout(400);
  let log = await page.evaluate(() => window.__jjAudio.log('engine'));
  assert.ok(log.some((l) => l.car === joined[0].car && l.ignition === false), `the wrecked car's engine stopped: ${JSON.stringify(log.slice(-4))}`);
  await page.evaluate(() => window.__jjTest.step(420));
  await page.waitForTimeout(400);
  log = await page.evaluate(() => window.__jjAudio.log('engine'));
  const last = log.filter((l) => l.car === joined[0].car && 'ignition' in l).at(-1);
  assert.equal(last.ignition, true, 'and starts again after the hold');
  await page.close();
  // Surface, boost and turbo by feeding scripted facts through the same engine bank (a held host: no snapshots of its own).
  const held = await open(live, '?test');
  const page2 = held.page;
  await page2.evaluate(() => window.__jjAudio.unlock());
  await page2.waitForFunction(() => window.__jjAudio.state().mix === 'running', null, { timeout: 10_000 });
  const out = await page2.evaluate(async () => {
    const a = window.__jjAudio;
    const fact = (car, o) => ({ car, speed: 20, throttle: 1, boosting: false, boost: 0, drifting: false, surface: 0, damage: 0, held: false, ...o });
    const levels = {};
    a.feedRoom({ phase: 'Running', remainingMs: 1e5, round: 1, laps: 3, freeDrive: false, armed: false, standings: [], results: null, seats: [] }, 1e12);
    a.useProfile('cruz-missile');
    a.feedFacts([fact(100, { boosting: true }), fact(101, { surface: 2 })]);
    await new Promise((r) => setTimeout(r, 400));
    a.feedFacts([fact(100, { boosting: true }), fact(101, { surface: 2 })]);
    await new Promise((r) => setTimeout(r, 300));
    levels.cruz = a.engines().filter((e) => e.car >= 100);
    a.useProfile('hay-hauler');
    a.feedFacts([fact(100, { boosting: true }), fact(101, { surface: 2 })]);
    await new Promise((r) => setTimeout(r, 400));
    a.feedFacts([fact(100, { boosting: true }), fact(101, { surface: 2 })]);
    await new Promise((r) => setTimeout(r, 600));
    levels.hay = a.engines().filter((e) => e.car >= 100);
    return levels;
  });
  assert.equal(out.cruz[0].boostLevel, 0, 'no turbo sound on the Cruz Missile while boosting');
  assert.equal(out.cruz[0].boosting, true);
  assert.ok(out.hay[0].boostLayerBuilt && out.hay[0].boostLevel > 0, `a profile with a boost section does (${JSON.stringify(out.hay[0])})`);
  assert.equal(out.cruz[1].surface, 'gravel');
  // Cost: the engines offline, 8 voices, and the update cost per snapshot.
  const bench = await page2.evaluate(async () => ({ eight: await window.__jjAudio.benchEngines(8, 6), sixteen: await window.__jjAudio.benchEngines(16, 6), state: window.__jjAudio.state() }));
  assert.ok(bench.eight.realtimeFactor > 1.5, `8 engines render ${bench.eight.realtimeFactor}x real time (software, headless)`);
  assert.ok(bench.state.engineCostMs < 2, `update cost ${bench.state.engineCostMs} ms`);
  assert.deepEqual(errors, []);
  await page2.close();
  runs['P1-A05'] = { engines, startStop: log.filter((l) => l.car === joined[0].car).slice(-6), turbo: out, cost: bench };
  await writeFile(join(ev('P1-A05'), 'engine-log.json'), `${JSON.stringify({ engines, log: log.slice(-30), turbo: out, cost: bench }, null, 1)}\n`);
});

test('A05: engines duck under the announcer', { timeout: 60_000 }, async () => {
  const { page } = await open(live, '?test=live');
  await page.evaluate(() => window.__jjAudio.unlock());
  await page.waitForFunction(() => window.__jjAudio.state().mix === 'running', null, { timeout: 10_000 });
  await page.waitForFunction(() => !window.__jjAudio.state().ducked, null, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => window.__jjAudio.gains());
  await page.evaluate(() => window.__jjAudio.say('countdown', 1e9));
  await page.waitForTimeout(500);
  const during = await page.evaluate(() => window.__jjAudio.gains());
  assert.ok(during.engine < before.engine * 0.7, `engine bus ${before.engine} -> ${during.engine}`);
  assert.ok(during.music < before.music * 0.5, `music bus ${before.music} -> ${during.music}`);
  await page.waitForTimeout(9000);
  const after = await page.evaluate(() => window.__jjAudio.gains());
  assert.ok(after.engine > during.engine && after.music > during.music, `recovered ${JSON.stringify(after)}`);
  runs['P1-A05'].ducking = { before, during, after };
  await page.close();
});

test('A07: a scripted crash round plays every effect at its event, scaled by impulse, inside the voice budget; each is audible', { timeout: 120_000 }, async () => {
  const { page, errors } = await open(live);
  await page.evaluate(() => window.__jjAudio.unlock());
  await page.waitForFunction(() => window.__jjAudio.state().mix === 'running', null, { timeout: 10_000 });
  await page.evaluate(() => window.__jjAudio.feedRoom({ phase: 'Running', remainingMs: 1e5, round: 1, laps: 3, freeDrive: false, armed: false, standings: [], results: null, seats: [{ seat: 1, number: 1, name: 'A', rgb: [1, 2, 3], colourIndex: 0, ready: true, presence: 'x', local: true, car: 0, laps: 0, position: 1, finished: false }] }));
  await page.evaluate(() => window.__jjAudio.clear());
  await page.evaluate(async () => {
    const a = window.__jjAudio;
    const ep = (seat, part, impulse, other) => ({ Episode: { record: { seat, part, other, owner: null, owner_tick: null, impulse_ns: impulse, closing_mm_s: 6000, tick: 1 } } });
    a.feedEvents([ep(1, 1, 1200, 'Scenery')]);
    await new Promise((r) => setTimeout(r, 80));
    a.feedEvents([ep(1, 3, 6000, { Car: { seat: 2 } })]);
    await new Promise((r) => setTimeout(r, 80));
    a.feedEvents([ep(1, 1, 18000, 'Scenery')]);
    await new Promise((r) => setTimeout(r, 80));
    a.feedEvents([ep(2, 8, 900, { Debris: { index: 3 } })]);
    a.feedEvents([{ PartLoose: { seat: 1, part: 3, cause: 'Car', instigator: 2 } }, { PartDetached: { seat: 1, part: 3, cause: 'Car', instigator: 2 } }, { Wrecked: { seat: 1, cause: 'Car', instigator: 2 } }]);
    a.feedEvents([{ Oi: { seat: 1 } }, { ConeDropped: { seat: 1, debris: 5 } }, { SeatJoined: { seat: 4, number: 4 } }, { Identify: { seat: 4 } }]);
    const fact = (o) => ({ car: 0, speed: 20, throttle: 1, boosting: false, boost: 0, drifting: false, surface: 0, damage: 0, held: false, ...o });
    a.feedFacts([fact({})], [-8]);
    a.feedFacts([fact({ boosting: true })], [0.5]); // a fall of 8 m/s stops: a landing, and the boost starts
    // A burst past the voice budget.
    for (let i = 0; i < 40; i++) a.feedEvents([ep(1, i % 10, 3000 + i * 100, 'Scenery')]);
  });
  const log = await page.evaluate(() => window.__jjAudio.log('sfx'));
  const kinds = new Set(log.map((l) => l.sfx));
  for (const k of ['impact', 'debris-rattle', 'part-rattle', 'part-clunk', 'wreck-crunch', 'oi-honk', 'cone-thunk', 'join-chime', 'identify-ping', 'landing-thud', 'boost-whoosh']) assert.ok(kinds.has(k), `${k} played (${[...kinds]})`);
  const impacts = log.filter((l) => l.sfx === 'impact').slice(0, 3).map((l) => l.intensity);
  assert.ok(impacts[0] < impacts[1] && impacts[1] < impacts[2], `impact intensity follows impulse: ${impacts}`);
  const state = await page.evaluate(() => window.__jjAudio.state());
  assert.ok(state.sfxPeakVoices <= 14, `peak ${state.sfxPeakVoices} effects at once, within the budget of 14`);
  assert.ok(log.every((l) => l.played === true || l.voices >= 0));
  // Audible: every recipe rendered offline is not silent, and decays.
  const renders = await page.evaluate(async () => {
    const out = [];
    for (const k of window.__jjAudio.sfxKinds()) out.push(await window.__jjAudio.renderSfx(k, 0.8));
    out.push(await window.__jjAudio.renderSfx('impact', 0.1), await window.__jjAudio.renderSfx('impact', 1));
    return out;
  });
  for (const r of renders) assert.ok(r.peak > 0.05 && r.peak <= 1.2 && r.rms > 0.001, `${r.kind} audible: ${JSON.stringify(r)}`);
  const light = renders.at(-2);
  const heavy = renders.at(-1);
  assert.ok(heavy.rms > light.rms * 1.5 && heavy.tailMs > light.tailMs, 'a big hit is louder and longer than a nudge');
  assert.deepEqual(errors, []);
  runs['P1-A07'].crash = { triggered: [...kinds], impactIntensities: impacts, peakVoices: state.sfxPeakVoices, dropped: state.sfxDropped, renders };
  await writeFile(join(ev('P1-A07'), 'sfx-log.json'), `${JSON.stringify({ log, renders }, null, 1)}\n`);
  await writeFile(
    join(ev('P1-A07'), 'provenance.json'),
    `${JSON.stringify({ source: 'procedural Web Audio recipes (web/host/src/audio/sfx/synth.ts); nothing generated or recorded, so no files, models or recordings enter the repo (R89)', seeded: 'noise bank mulberry32(0x5f3): a trigger sounds the same at the same intensity', announcerAndMusic: 'assets/audio/voice and music (A01/A02), unchanged', controller: 'web/controller/src/app/sound.ts: oscillator blips' }, null, 2)}\n`,
  );
  await page.close();
});

test('A07: the controller taps on a button press and pings on Identify, and respects its mute', { timeout: 90_000 }, async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await live.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The controller is served at /j/<code> by the game server; the static test server serves the page for that path.
  const html = (await readFile(join(repo, 'web/dist/controller/index.html'), 'utf8')).replace('<head>', `<head><base href="${server.url}/controller/"><meta name="jj-base" content="/controller/">`);
  await page.route('**/controller/j/ABCD', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(`${server.url}/controller/j/ABCD`);
  await page.waitForFunction(() => window.__jjSound !== undefined && document.querySelector('button'), null, { timeout: 20_000 });
  await page.locator('button').first().dispatchEvent('pointerdown');
  await page.waitForTimeout(200);
  let log = await page.evaluate(() => window.__jjSound.log);
  assert.ok(log.some((l) => l.sound === 'tap' && l.played), `a button press taps: ${JSON.stringify(log)}`);
  await page.evaluate(() => window.__jjController.identify());
  log = await page.evaluate(() => window.__jjSound.log);
  assert.ok(log.some((l) => l.sound === 'identify-ping'), 'Identify pings');
  await page.evaluate(() => window.__jjSound.setMuted(true));
  const n = log.length;
  await page.locator('button').first().dispatchEvent('pointerdown');
  await page.evaluate(() => window.__jjController.identify());
  log = await page.evaluate(() => window.__jjSound.log);
  assert.ok(log.slice(n).every((l) => l.played === false), 'muted: triggers log, nothing plays');
  runs['P1-A07'].controller = log;
  assert.deepEqual(errors, []);
  await page.close();
});
