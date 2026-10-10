// br-0uqj (R125): sound for drift, the R120 exit boost, air and surfaces, on the real web build through `window.__jjAudio`.
// A scripted drive (lib/motion-scenario.mjs) feeds car records through the director's snapshot path; the probe checks each
// cue fired at its sim event with levels following their drivers (slip, speed, height, fall speed), and renders every new
// effect offline to show it is audible. A second test records the host's own output for the owner's listen-through clip.
//   JJ_DIST=<build dir> node --test --test-concurrency=1 web/host/tests/audio-motion.test.mjs
// Writes docs/evidence/br-0uqj/ (JJ_EVIDENCE_DIR overrides the root): probe.json, listen-through.ogg + README.md.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { motionScenario } from './lib/motion-scenario.mjs';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const out = join(process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence'), 'br-0uqj');
let browser;
let server;

before(async () => {
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
  await mkdir(out, { recursive: true });
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await openHost(page, `${server.url}/host/?test`);
  await page.waitForFunction(() => window.__jjAudio !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => window.__jjAudio.unlock());
  await page.waitForFunction(() => window.__jjAudio.state().mix === 'running', null, { timeout: 10_000 });
  return { page, errors };
}

const sfxOf = (log, kind) => log.filter((l) => l.kind === 'sfx' && l.sfx === kind);
const at = (samples, phase, f = () => true) => samples.filter((s) => s.phase === phase && f(s));
const max = (xs) => Math.max(...xs);

test('br-0uqj: each cue fires at its sim event, with levels following their drivers', { timeout: 120_000 }, async () => {
  const { page, errors } = await open();
  const r = await page.evaluate(motionScenario, { realtime: false });
  const { samples, log, marks } = r;
  const L = (s) => s.levels;

  // Drift: a start chirp when the flag rises, an end note with the held time when it falls.
  const start = sfxOf(log, 'drift-start');
  assert.equal(start.length, 1, 'one drift start');
  const end = log.filter((l) => l.kind === 'motion' && l.event === 'drift-end');
  assert.equal(end.length, 1, 'one drift end');
  assert.ok(end[0].heldS > 1.5 && end[0].heldS < 2.6, `drift held ${end[0].heldS} s`);
  assert.ok(start[0].at < end[0].at);

  // Squeal tracks slip: silent straight, louder and higher with more slip; a drift squeals harder than a scrub.
  const straight = max(at(samples, 'cruise-tarmac').map((s) => L(s).squeal));
  const light = max(at(samples, 'slide-light', (s) => s.car.yaw > 0.2).map((s) => L(s).squeal));
  const deep = max(at(samples, 'slide-deep', (s) => s.car.yaw > 0.5).map((s) => L(s).squeal));
  const scrub = max(at(samples, 'scrub-no-drift-flag').map((s) => L(s).squeal));
  assert.ok(straight < 0.01, `no squeal straight: ${straight}`);
  assert.ok(light > 0.02 && deep > light * 1.3, `squeal follows slip: ${light} -> ${deep}`);
  const hzLight = max(at(samples, 'slide-light', (s) => s.car.yaw > 0.2).map((s) => L(s).squealHz));
  const hzDeep = max(at(samples, 'slide-deep', (s) => s.car.yaw > 0.5).map((s) => L(s).squealHz));
  assert.ok(hzDeep > hzLight, `pitch follows slip: ${hzLight} -> ${hzDeep} Hz`);
  assert.ok(scrub > 0 && scrub < deep, `a scrub without the drift flag is quieter than a drift: ${scrub} < ${deep}`);
  assert.ok(max(at(samples, 'slide-deep', (s) => L(s).slip > 0.5).map((s) => L(s).slip)) > 0.5, 'slip is derived from the record (heading against velocity)');

  // The exit boost: its own sound, after the drift, sized by the drift held; a later plain boost is the whoosh.
  const exit = sfxOf(log, 'drift-exit-boost');
  assert.equal(exit.length, 1, 'one exit boost');
  assert.ok(exit[0].at > end[0].at && exit[0].heldS > 1.5, `exit boost after the drift end, heldS ${exit[0].heldS}`);
  assert.ok(exit[0].intensity >= 0.5, `sized by the drift held: ${exit[0].intensity}`);
  const whoosh = sfxOf(log, 'boost-whoosh');
  assert.equal(whoosh.length, 1, 'the plain boost is the whoosh');
  assert.ok(whoosh[0].at > exit[0].at);

  // Surfaces: one change cue per change, in the new surface's voice; the rolling level follows speed.
  const changes = log.filter((l) => l.kind === 'sfx' && l.reason === 'car.surface_change').map((l) => `${l.from}>${l.to}`);
  assert.deepEqual(changes, ['tarmac>gravel', 'gravel>dirt', 'dirt>off-track', 'off-track>tarmac']);
  const fast = at(samples, 'tarmac-fast').at(-1);
  const slow = at(samples, 'tarmac-slow').at(-1);
  assert.ok(L(fast).roll > L(slow).roll * 1.4, `rolling follows speed: ${L(slow).roll} -> ${L(fast).roll}`);
  assert.equal(L(at(samples, 'gravel').at(-1)).surface, 'gravel');
  assert.equal(L(at(samples, 'off-track').at(-1)).surface, 'off-track');

  // Air: a take-off whoosh per jump that leaves the ground for long enough, wind only after 0.3 s and rising with height,
  // a landing thud scaled by the fall; the short hop gets no wind and no thud.
  const takeoffs = sfxOf(log, 'takeoff-whoosh');
  assert.equal(takeoffs.length, 3, `take-offs: ${takeoffs.length} (all three hops leave the ground for longer than the 0.1 s confirmation)`);
  const winds = log.filter((l) => l.kind === 'motion' && l.event === 'wind-on');
  assert.equal(winds.length, 2, 'wind comes in for the two jumps over 0.3 s, not the hop');
  assert.ok(winds.every((w) => w.airS >= 0.3));
  const landings = sfxOf(log, 'landing-thud');
  assert.equal(landings.length, 2, 'a thud per real landing');
  assert.ok(landings[0].intensity > landings[1].intensity, `thud scales with the fall: ${landings.map((l) => `${l.fallMps} m/s -> ${l.intensity}`)}`);
  const windBig = max(samples.filter((s) => s.phase === 'jump-big').map((s) => L(s).wind));
  const windMed = max(samples.filter((s) => s.phase === 'jump-medium').map((s) => L(s).wind));
  const windHop = max(samples.filter((s) => s.phase === 'hop-short').map((s) => L(s).wind));
  assert.ok(windBig > windMed && windMed > 0 && windHop === 0, `wind rises with height/air time: big ${windBig}, medium ${windMed}, hop ${windHop}`);
  const bigSeries = samples.filter((s) => s.phase === 'jump-big' && L(s).airborne);
  const earlyHz = L(bigSeries.find((s) => s.car.y > 1)).windHz;
  const topHz = max(bigSeries.map((s) => L(s).windHz));
  assert.ok(topHz > earlyHz, `wind pitch rises with height: ${earlyHz} -> ${topHz} Hz`);
  assert.equal(max(samples.filter((s) => s.phase === 'after-big').map((s) => L(s).wind)), 0, 'wind is gone on the ground');
  assert.ok(max(samples.filter((s) => s.phase === 'jump-big').map((s) => L(s).roll)) < max(samples.map((s) => L(s).roll)), 'rolling noise falls away in the air');
  assert.ok(samples.some((s) => L(s).voiced), 'the layers were built as real nodes (audio running)');
  assert.deepEqual(errors, []);

  const trim = (x) => ({ at: x.at, kind: x.kind, sfx: x.sfx, event: x.event, reason: x.reason, intensity: x.intensity, played: x.played, heldS: x.heldS, from: x.from, to: x.to, fallMps: x.fallMps, airS: x.airS, speed: x.speed, slip: x.slip });
  const cueLog = log.filter((l) => l.kind === 'motion' || (l.kind === 'sfx' && /drift|takeoff|landing|surface|boost/.test(l.sfx))).map(trim);
  await writeFile(join(out, 'probe.json'), `${JSON.stringify({ browser: `Chromium ${browser.version()} (Playwright headless), ${process.platform}/${process.arch}`, scenario: marks, cues: cueLog, levels: samples.map((s) => ({ t: s.t, phase: s.phase, yaw: +s.car.yaw.toFixed(2), speed: s.car.speed, y: s.car.y, ...Object.fromEntries(Object.entries(s.levels).filter(([k]) => ['surface', 'slip', 'squeal', 'squealHz', 'roll', 'wind', 'windHz'].includes(k)).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v])) })) }, null, 1)}\n`);
  await page.close();
});

test('br-0uqj: every new effect renders audible offline, and the exit boost is longer and louder than the plain whoosh', { timeout: 60_000 }, async () => {
  const { page, errors } = await open();
  const kinds = ['drift-start', 'drift-exit-boost', 'takeoff-whoosh', 'surface-tarmac', 'surface-dirt', 'surface-gravel', 'surface-off-track'];
  const renders = await page.evaluate(async (ks) => {
    const o = {};
    for (const k of [...ks, 'boost-whoosh']) o[k] = await window.__jjAudio.renderSfx(k, 0.8);
    return o;
  }, kinds);
  for (const k of kinds) assert.ok(renders[k].peak > 0.03 && renders[k].peak <= 1.2 && renders[k].rms > 0.001, `${k} audible: ${JSON.stringify(renders[k])}`);
  assert.ok(renders['drift-exit-boost'].tailMs > renders['boost-whoosh'].tailMs, 'the exit boost rings longer than the whoosh');
  assert.ok(renders['drift-exit-boost'].tailMs >= 1000, `a roar of about 1.2 s: ${renders['drift-exit-boost'].tailMs} ms`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('br-0uqj: the listen-through clip, recorded from the host mix during the scripted drive', { timeout: 120_000 }, async () => {
  const { page, errors } = await open();
  const r = await page.evaluate(motionScenario, { realtime: true });
  assert.ok(r.recording.length > 5000, 'the recording has audio');
  const dir = await mkdtemp(join(tmpdir(), 'jj-listen-'));
  try {
    await writeFile(join(dir, 'in.webm'), Buffer.from(r.recording, 'base64'));
    // Re-wrap as Ogg Opus, no re-encode (the recorder already encoded Opus).
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, 'in.webm'), '-c:a', 'copy', join(out, 'listen-through.ogg')]);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(out, 'listen-through.ogg')]).toString());
    r.durationS = +probe.format.duration;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.ok(r.durationS > r.totalS * 0.8, `clip ${r.durationS}s for a ${r.totalS}s drive`);
  assert.deepEqual(errors, []);
  // Cue timestamps: the log's clock is ms since the mix was made; the recording started at the drive's first log entry.
  const t0 = r.log.find((l) => l.kind === 'record')?.at ?? r.log[0].at;
  const rows = r.log
    .filter((l) => l.kind === 'motion' || (l.kind === 'sfx' && /drift|takeoff|landing|surface|boost/.test(l.sfx)))
    .map((l) => `| ${((l.at - t0) / 1000).toFixed(1)} | ${l.sfx ?? l.event} | ${l.reason ?? ''} | ${l.heldS !== undefined ? `held ${l.heldS} s ` : ''}${l.fallMps !== undefined ? `fall ${l.fallMps} m/s ` : ''}${l.intensity !== undefined ? `level ${l.intensity}` : ''}${l.from ? ` ${l.from} to ${l.to}` : ''} |`);
  const phases = r.marks.map((m) => `| ${m.startS.toFixed(1)} | ${m.name}${m.airS ? ` (air ${m.airS} s)` : ''} |`);
  await writeFile(
    join(out, 'README.md'),
    `# br-0uqj listen-through (R125)\n\n\`listen-through.ogg\` (Ogg Opus, ${r.durationS.toFixed(1)} s) is the host's own master output (after the limiter) recorded while a scripted car drives the host's audio path: cruise, a drift with a countersteer and the R120 exit boost, a plain boost, a scrub, surface changes (tarmac, gravel, dirt, off-track), two jumps and a short hop. The engine, tyre, rolling, wind and effect layers all play together, as in a round.\n\nRegenerate: \`JJ_DIST=web/dist node --test web/host/tests/audio-motion.test.mjs\` (the clip and this table are rewritten from the run). Chromium headless, software audio.\n\n## What to listen for\n\n- Tyre squeal gets louder and higher as the slide gets deeper; a scrub without the drift flag is quieter; none on loose ground beyond a hiss.\n- Drift exit: a gear-drop blip then a 1.2 s exhaust roar, clearly longer and lower than the plain boost whoosh that follows later.\n- Rolling noise changes character per surface: tarmac hum, gravel crunch, dirt, a low off-track rumble. A small thump marks each change.\n- Jumps: take-off whoosh, engine unloads, wind arrives after 0.3 s and rises with height, landing thump bigger for the big jump. The short hop has none of these.\n\n## Scenario phases (seconds into the clip)\n\n| s | phase |\n|---|---|\n${phases.join('\n')}\n\n## Cue timestamps (seconds into the clip, +/- 0.1)\n\n| s | cue | reason | detail |\n|---|---|---|---|\n${rows.join('\n')}\n\nSteady layers (squeal, rolling, wind) have no event: their levels per phase are in \`probe.json\`.\n`,
  );
  await page.close();
});
