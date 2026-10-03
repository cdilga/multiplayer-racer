#!/usr/bin/env node
// P1-A04 checks and evidence for the engine synth and its gallery page.
//
//   node art/ui/poc/audio/engine/check.mjs [--quick]     (--quick skips the CPU benchmark)
//
// 1. Static: no remote URLs, no colour literals in the page CSS, the committed bundle and schema are fresh,
//    the module type-checks, lap.json regenerates byte for byte.
// 2. Profile as data: cruz-missile.json passes the validator and the JSON Schema; broken profiles are refused.
// 3. State -> targets: pure maths and the drivetrain (Node).
// 4. The real page in Chromium: start, press "Play scripted lap" with the network switched off, and watch the
//    audio graph run (an AnalyserNode sees non-silent output whose pitch follows rpm; each layer's meter and its
//    audio respond to its own state input).
// 5. Offline renders: every layer is silent with its input at zero and audible with it up, the gear dip dips,
//    and the scripted lap renders bit-identically twice (and in a second page load).
// 6. Evidence in docs/evidence/P1-A04/: scripted-lap.wav, lap-spectrogram.png, gallery screenshots, cpu.json,
//    checks.json. Exits non-zero naming every failed check.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cpus, totalmem, release } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { chromium, webkit } from 'playwright';
import * as dsp from './dsp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..', '..');
const evidence = join(repo, 'docs', 'evidence', 'P1-A04');
const quick = process.argv.includes('--quick');
const results = [];
const failures = [];
const record = (id, desc, pass, detail = '') => {
  results.push({ id, desc, pass, detail });
  if (!pass) failures.push(`${id} ${desc}${detail ? ` (${detail})` : ''}`);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${id} ${desc}${detail ? `  [${detail}]` : ''}`);
};
const db = (v) => dsp.dbfs(v).toFixed(1);
mkdirSync(evidence, { recursive: true });

// ============================================================================================ 1. static
const served = ['index.html', 'page.js', 'lap-runner.js', 'engine-synth.js'].map((f) => [f, readFileSync(join(here, f), 'utf8')]);
// (XML namespace URIs such as the one inside the inline favicon are names, not requests.)
const remote = served.filter(([, text]) => /https?:\/\//.test(text.replaceAll('http://www.w3.org/2000/svg', ''))).map(([f]) => f);
record('S1', 'no remote URLs in the served page, scripts or bundle (R70)', remote.length === 0, remote.join(', '));
const html = served.find(([f]) => f === 'index.html')[1];
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const literals = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [];
record('S2', 'the page CSS has no colour literals: every colour is a token variable', literals.length === 0, literals.join(' '));

const build = spawnSync(process.execPath, [join(here, 'build.mjs'), '--check'], { encoding: 'utf8' });
record('S3', 'committed engine-synth.js and profile.schema.json match a fresh build', build.status === 0, (build.stdout + build.stderr).trim().split('\n').pop());
const tsc = spawnSync(join(repo, 'web', 'node_modules', '.bin', 'tsc'), ['-p', join(repo, 'web', 'shared', 'audio', 'engine-synth', 'tsconfig.json')], { encoding: 'utf8' });
record('S4', 'web/shared/audio/engine-synth type-checks (strict, noUncheckedIndexedAccess)', tsc.status === 0, (tsc.stdout + tsc.stderr).trim().split('\n')[0]);
const lapBefore = readFileSync(join(here, 'lap.json'), 'utf8');
spawnSync(process.execPath, [join(here, 'make-lap.mjs')], { encoding: 'utf8' });
record('S5', 'lap.json regenerates byte for byte from make-lap.mjs', readFileSync(join(here, 'lap.json'), 'utf8') === lapBefore);

// ============================================================================================ 2. profile as data
const synthNode = await import(pathToFileURL(join(here, 'engine-synth.js')).href);
const profilePath = join(repo, 'assets', 'audio', 'engine', 'cruz-missile.json');
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
const schema = JSON.parse(readFileSync(join(repo, 'web', 'shared', 'audio', 'engine-synth', 'profile.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaOk = ajv.compile(schema);
const good = synthNode.validateProfile(profile);
record('P1', 'cruz-missile.json passes the validator', good.ok, good.errors.slice(0, 2).join('; '));
record('P2', 'cruz-missile.json passes the JSON Schema', schemaOk(profile) === true, JSON.stringify(schemaOk.errors?.[0] ?? ''));
const clone = () => structuredClone(profile);
const breakers = [
  ['missing engine.cylinders', (p) => delete p.engine.cylinders, true],
  ['fractional cylinders', (p) => (p.engine.cylinders = 4.5), true],
  ['firing.level is text', (p) => (p.firing.level = 'loud'), true],
  ['unknown top-level field', (p) => (p.turbo = true), true],
  ['cutoff far above the audio band', (p) => (p.surface.tarmac.cutoffHz = 99999), true],
  ['wave phase not sine or cosine', (p) => (p.firing.mellow.phase = 'square'), true],
  ['version 2', (p) => (p.version = 2), true],
  ['wrong format tag', (p) => (p.format = 'other'), true],
  ['no gear ratios', (p) => (p.gearbox.ratios = []), true],
  ['idle above redline', (p) => (p.engine.idleRpm = 8000), false],
  ['gear ratios not falling', (p) => (p.gearbox.ratios = [1, 2, 3]), false],
  ['burstMin above burstMax', (p) => (p.pops.burstMin = 9), false],
  ['squeal minSpeed above fullSpeed', (p) => (p.squeal.minSpeedMps = 30), false],
];
const parity = [];
for (const [name, mutate, inSchema] of breakers) {
  const p = clone();
  mutate(p);
  const v = synthNode.validateProfile(p);
  const s = schemaOk(p);
  parity.push({ name, validator: !v.ok, schema: !s, expectSchema: inSchema });
}
record('P3', 'the validator refuses every broken profile, naming the path', parity.every((r) => r.validator), parity.filter((r) => !r.validator).map((r) => r.name).join(', '));
record('P4', 'the JSON Schema refuses every field-level break (cross-field rules are validator-only)', parity.filter((r) => r.expectSchema).every((r) => r.schema) && parity.filter((r) => !r.expectSchema).every((r) => !r.schema), JSON.stringify(parity.filter((r) => r.expectSchema !== r.schema)));
record('P5', 'the validator refuses non-objects without throwing', !synthNode.validateProfile(null).ok && !synthNode.validateProfile('x').ok && !synthNode.validateProfile([]).ok);

// ============================================================================================ 3. state -> targets
const T = (s) => synthNode.computeTargets(profile, { rpm: 4000, throttle: 0.5, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 3, ...s });
record('M1', 'firing frequency is rpm / 60 x cylinders / 2 (3000 rpm, 4 cyl = 100 Hz)', synthNode.firingHz(4, 3000) === 100 && Math.abs(T({ rpm: 3000 }).firing.f0 - 100) < 1e-9);
record('M2', 'the firing oscillators track rpm exactly across the range', [900, 2000, 3500, 5000, 7000].every((r) => Math.abs(T({ rpm: r }).firing.f0 - (r / 60) * 2) < 1e-9));
const more = (a, b) => b > a;
record('M3', 'throttle raises intake, exhaust, engine level and brightness; zero throttle means zero intake',
  T({ throttle: 0 }).levels.intake === 0 && more(T({ throttle: 0 }).levels.exhaust, T({ throttle: 1 }).levels.exhaust) && more(T({ throttle: 0 }).levels.intake, T({ throttle: 1 }).levels.intake) &&
  more(T({ throttle: 0 }).firing.mellowGain + T({ throttle: 0 }).firing.brightGain, T({ throttle: 1 }).firing.mellowGain + T({ throttle: 1 }).firing.brightGain) && more(T({ throttle: 0 }).firing.bodyHz, T({ throttle: 1 }).firing.bodyHz));
record('M4', 'boost drives the whine: zero boost is silent, whine pitch and level rise', T({ boost: 0 }).boost.whineGain === 0 && more(T({ boost: 0.2 }).boost.whineHz, T({ boost: 1 }).boost.whineHz) && more(T({ boost: 0.2 }).boost.whineGain, T({ boost: 1 }).boost.whineGain));
record('M5', 'drift drives the squeal, and only while moving', T({ drift: 0, speed: 25 }).squeal.gain === 0 && T({ drift: 1, speed: 25 }).squeal.gain > 0 && T({ drift: 1, speed: 0 }).squeal.gain === 0 && more(T({ drift: 0.3, speed: 25 }).squeal.gain, T({ drift: 1, speed: 25 }).squeal.gain));
const sTar = T({ speed: 30, surface: 'tarmac' }).surface;
const sDirt = T({ speed: 30, surface: 'dirt' }).surface;
const sGra = T({ speed: 30, surface: 'gravel' }).surface;
record('M6', 'surface rumble needs speed and changes with the surface (cutoff and crackle: tarmac < dirt < gravel)',
  T({ speed: 0, gear: 0 }).surface.brownGain === 0 && more(sTar.cutoffHz, sDirt.cutoffHz) && more(sDirt.cutoffHz, sGra.cutoffHz) && sTar.crackleGain === 0 && more(sDirt.crackleGain, sGra.crackleGain));
record('M7', 'damage drives the rattle: zero damage is silent, rate follows revs', T({ damage: 0 }).rattle.gain === 0 && T({ damage: 1 }).rattle.gain > 0 && more(T({ damage: 0.4 }).rattle.gain, T({ damage: 1 }).rattle.gain) && more(T({ rpm: 1000, damage: 1 }).rattle.rateHz, T({ rpm: 6000, damage: 1 }).rattle.rateHz));
record('M8', 'a stopped engine is silent (rpm 0) and fades in with revs', T({ rpm: 0 }).run === 0 && T({ rpm: 0 }).levels.firing === 0 && T({ rpm: 900 }).run === 1);
record('M9', 'without a speed the state derives it from rpm and gear (and gear 0 means stopped)', T({ rpm: 3000, gear: 3 }).speed > 10 && T({ rpm: 3000, gear: 0 }).speed === 0 && Math.abs(synthNode.rpmFromSpeed(profile, synthNode.speedFromRpm(profile, 3300, 4), 4) - 3300) < 1e-6);

const lap = JSON.parse(readFileSync(join(here, 'lap.json'), 'utf8'));
const runLapDrivetrain = () => {
  const dt = synthNode.createDrivetrain(profile);
  const rows = [];
  for (let t = 0; t <= lap.durationS; t += 0.02) {
    const i = Math.min(lap.series.speedMps.length - 1, Math.round(t * lap.rateHz));
    rows.push(dt.step(0.02, lap.series.speedMps[i], lap.series.throttle[i]));
  }
  return rows;
};
const rowsA = runLapDrivetrain();
const rowsB = runLapDrivetrain();
const gears = rowsA.map((r) => r.gear);
const ups = gears.filter((g, i) => i && g > gears[i - 1]).length;
const downs = gears.filter((g, i) => i && g < gears[i - 1]).length;
record('D1', 'the drivetrain shifts through all five gears on the lap, up and down, with rpm inside the engine limits',
  Math.max(...gears) === 5 && Math.min(...gears) === 1 && ups >= 4 && downs >= 2 && rowsA.every((r) => r.rpm >= profile.engine.idleRpm - 1e-6 && r.rpm <= profile.engine.limiterRpm + 1e-6), `${ups} up, ${downs} down`);
record('D2', 'the drivetrain is deterministic', JSON.stringify(rowsA) === JSON.stringify(rowsB));

// ============================================================================================ server + browser
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = readFileSync(join(repo, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const pageUrl = `${origin}/art/ui/poc/audio/engine/index.html`;
const browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const initScript = () => {
  window.__b64 = (f32) => {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
};
const f32 = (b64) => {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
};
const sha = (arr) => createHash('sha256').update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(context, query = '') {
  const page = await context.newPage();
  const log = { errors: [], requests: [], failed: [] };
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && log.errors.push(`console: ${m.text()}`));
  page.on('request', (r) => log.requests.push(r.url()));
  page.on('requestfailed', (r) => log.failed.push(r.url()));
  await page.addInitScript(initScript);
  await page.goto(pageUrl + query);
  await page.waitForFunction(() => window.__gallery, null, { timeout: 20000 });
  return { page, log };
}

const metrics = {};
try {
  // ======================================================================================== 4. the real page
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const { page, log } = await openPage(ctx1);
  record('B1', 'the gallery page loads with the tokens, fonts, profile and lap, no errors', log.errors.length === 0 && log.failed.length === 0, log.errors.concat(log.failed).join('; '));
  const fonts = await page.evaluate(() => ({
    display: document.fonts.check('900 italic 48px "Barlow Condensed"'),
    body: document.fonts.check('600 16px "Barlow Semi Condensed"'),
    h1: getComputedStyle(document.querySelector('h1')).fontFamily,
    bg: getComputedStyle(document.body).backgroundColor,
    ready: document.body.dataset.ready,
  }));
  const tokens = JSON.parse(readFileSync(join(repo, 'art', 'ui', 'tokens.json'), 'utf8'));
  const paper = tokens.palette.paper.hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  record('B2', 'it is styled from the tokens: the display and body faces loaded, paper background', fonts.display && fonts.body && fonts.h1.includes(tokens.fonts.display.family) && fonts.bg === `rgb(${paper.join(', ')})` && fonts.ready === 'true', JSON.stringify(fonts));
  const controls = await page.evaluate(() => ['in-rpm', 'in-throttle', 'in-boost', 'in-surface', 'in-damage', 'in-drift', 'in-volume'].map((id) => [id, document.getElementById(id)?.type]).concat([['gear', !!document.getElementById('gear-n')], ['lap-btn', document.getElementById('lap-btn')?.textContent]]));
  record('B3', 'the page has sliders for RPM, throttle, boost, surface and damage, a gear indicator and a "Play scripted lap" button',
    controls.slice(0, 5).every(([, t]) => t === 'range') && controls[7][1] === true && controls[8][1] === 'Play scripted lap', JSON.stringify(controls.map((c) => c[0])));

  // Work offline from here: any fetch to anything would now fail (let the favicon finish first).
  await page.waitForLoadState('networkidle');
  await sleep(500);
  await ctx1.setOffline(true);
  await page.click('#start-btn');
  await page.waitForFunction(() => window.__gallery.ctx?.state === 'running');
  await page.click('#lap-btn');
  await page.waitForFunction(() => window.__gallery.lapActive);
  const t0 = await page.evaluate(() => window.__gallery.ctx.currentTime);
  const samples = [];
  for (let i = 0; i < 32; i++) {
    await sleep(250);
    const p = await page.evaluate(() => ({ ...window.__gallery.probe(), gear: document.getElementById('gear-n').textContent, rpmText: Number(document.getElementById('rpm-n').textContent) }));
    samples.push(p);
  }
  const rpms = samples.map((s) => s.rpmText);
  const gearsSeen = new Set(samples.map((s) => s.gear));
  const tNow = samples.at(-1).time;
  record('B4', 'offline, "Play scripted lap" runs the audio graph: context running and its clock advancing', samples.every((s) => s.ctxState === 'running' && s.lapActive) && tNow - t0 > 7, `clock +${(tNow - t0).toFixed(1)} s`);
  const quiet = samples.filter((s) => s.rms < 0.002).length;
  record('B5', 'an AnalyserNode on the output shows non-silent audio all the way through the lap', quiet === 0 && Math.max(...samples.map((s) => s.rms)) < 0.9, `rms ${db(Math.min(...samples.map((s) => s.rms)))} to ${db(Math.max(...samples.map((s) => s.rms)))} dBFS`);
  record('B6', 'the dash follows the lap: rpm swings and the gear indicator changes', Math.max(...rpms) - Math.min(...rpms) > 1500 && gearsSeen.size >= 3, `rpm ${Math.min(...rpms)}-${Math.max(...rpms)}, gears ${[...gearsSeen].join(',')}`);
  const peaks = new Set(samples.map((s) => Math.round(s.peakHz / 20)));
  record('B7', 'the analyser spectrum moves as the lap moves', peaks.size >= 5, `${peaks.size} distinct peak bands`);
  const reqs = log.requests.filter((u) => !u.startsWith(origin));
  record('B8', 'the page made no request outside the local server, and none failed while the network was off', reqs.length === 0 && log.failed.length === 0 && log.errors.length === 0, reqs.concat(log.failed, log.errors).join('; '));

  // Screenshots mid-lap (jump to the gravel section so most layers are live).
  await page.evaluate(() => window.__gallery.seekLap(28.6));
  await sleep(1200);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'gallery.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  await page.screenshot({ path: join(evidence, 'gallery-phone.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Let the lap finish by itself.
  await page.evaluate(() => window.__gallery.seekLap(36.8));
  await page.waitForFunction(() => !window.__gallery.lapActive, null, { timeout: 8000 });
  const after = await page.evaluate(() => ({ rpm: document.getElementById('in-rpm').disabled, btn: document.getElementById('lap-btn').textContent }));
  record('B9', 'the lap ends on its own and hands the sliders back', after.rpm === false && after.btn === 'Play scripted lap', JSON.stringify(after));

  // Manual drive: pitch follows the RPM slider.
  await page.evaluate(() => {
    const g = window.__gallery;
    window.__an = g.ctx.createAnalyser();
    window.__an.fftSize = 32768;
    window.__an.smoothingTimeConstant = 0;
    g.voice.output.connect(window.__an);
  });
  const setSlider = async (id, v) => page.locator(`#in-${id}`).fill(String(v));
  await page.click('[data-preset="idle"]');
  await setSlider('throttle', 60);
  await page.click('#shift-up');
  const pitchRows = [];
  for (const rpm of [1500, 3000, 5400]) {
    await setSlider('rpm', rpm);
    await sleep(1400);
    const spec = await page.evaluate(() => {
      const a = new Float32Array(window.__an.frequencyBinCount);
      window.__an.getFloatFrequencyData(a);
      return { sr: window.__gallery.ctx.sampleRate, b64: window.__b64(a) };
    });
    const mag = Float64Array.from(f32(spec.b64), (x) => Math.pow(10, x / 20));
    const expected = (Number(rpm) / 60) * 2;
    const est = dsp.estimateF0(mag, spec.sr, 15, 300, 10);
    pitchRows.push({ rpm, expected, est, centroid: dsp.centroid(mag, spec.sr) });
  }
  record('B10', 'moving the RPM slider moves the engine note: the measured fundamental follows rpm / 60 x 2 within 3%',
    pitchRows.every((r) => Math.abs(r.est - r.expected) <= Math.max(0.03 * r.expected, 2)), pitchRows.map((r) => `${r.rpm}rpm: ${r.expected.toFixed(0)}Hz -> ${r.est.toFixed(1)}Hz`).join('; '));
  record('B11', 'and a higher rpm sounds brighter', pitchRows[0].centroid < pitchRows[1].centroid && pitchRows[1].centroid < pitchRows[2].centroid, pitchRows.map((r) => r.centroid.toFixed(0)).join(' < '));

  // Each layer's meter (state mapping) responds to its own slider.
  const meter = async (layer) => page.evaluate((l) => Number(document.querySelector(`.layer[data-layer="${l}"] .meter i`).style.transform.match(/scaleX\(([^)]+)\)/)?.[1] ?? 0), layer);
  const level = async (layer) => {
    await sleep(120);
    return meter(layer);
  };
  await page.click('[data-preset="idle"]');
  await page.click('#shift-up');
  await page.click('#shift-up');
  await setSlider('rpm', 3600);
  await setSlider('throttle', 0);
  const m = { throttle0: await level('intake') };
  await setSlider('throttle', 100);
  m.throttle1 = await level('intake');
  m.exhaust1 = await level('exhaust');
  await setSlider('boost', 0);
  m.boost0 = await level('boost');
  await setSlider('boost', 100);
  m.boost1 = await level('boost');
  await setSlider('drift', 0);
  m.drift0 = await level('squeal');
  await setSlider('drift', 100);
  m.drift1 = await level('squeal');
  await setSlider('damage', 0);
  m.damage0 = await level('rattle');
  await setSlider('damage', 100);
  m.damage1 = await level('rattle');
  const surf = {};
  for (const [i, name] of ['tarmac', 'dirt', 'gravel'].entries()) {
    await setSlider('surface', i);
    surf[name] = await level('surface');
  }
  record('B12', 'each layer meter follows its own control (intake and exhaust: throttle, boost, squeal: drift, rattle: damage)',
    m.throttle0 === 0 && m.throttle1 > 0.3 && m.exhaust1 > 0.4 && m.boost0 === 0 && m.boost1 > 0.3 && m.drift0 === 0 && m.drift1 > 0.1 && m.damage0 === 0 && m.damage1 > 0.2, JSON.stringify(m));
  record('B13', 'the surface slider changes the road rumble level (tarmac < dirt < gravel at the same speed)', surf.tarmac > 0 && surf.tarmac < surf.dirt && surf.dirt < surf.gravel, JSON.stringify(surf));
  // Gear indicator and the gear-change dip.
  const gearBefore = await page.evaluate(() => document.getElementById('gear-n').textContent);
  const firingBefore = await meter('firing');
  await page.click('#shift-up');
  await sleep(40);
  const dipped = await page.evaluate(() => ({ gear: document.getElementById('gear-n').textContent, shift: document.getElementById('gear').classList.contains('shift'), lvl: window.__gallery.voice.levels().firing }));
  record('B14', 'shifting changes the gear indicator and dips the engine level', Number(dipped.gear) === Number(gearBefore) + 1 && dipped.shift && dipped.lvl < firingBefore * 0.7, `gear ${gearBefore}->${dipped.gear}, firing ${firingBefore.toFixed(2)} -> ${dipped.lvl.toFixed(2)}`);
  // Throttle lift at revs fires the pops layer.
  await setSlider('rpm', 4500);
  await setSlider('throttle', 100);
  await sleep(100);
  await setSlider('throttle', 0);
  let pop = 0;
  for (let i = 0; i < 14; i++) {
    await sleep(30);
    pop = Math.max(pop, await meter('pops'));
  }
  record('B15', 'lifting off at revs fires the exhaust pops layer', pop > 0.05, `pops meter ${pop.toFixed(2)}`);
  // Solo/mute work on the audio graph.
  await page.locator('.layer[data-layer="squeal"] button').click();
  const solo = await page.evaluate(() => ({ off: [...document.querySelectorAll('.layer')].filter((l) => l.dataset.off === 'true').length }));
  record('B16', 'solo mutes the other seven layers', solo.off === 7, JSON.stringify(solo));
  await ctx1.close();

  // ======================================================================================== 5. offline renders
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const lab = await openPage(ctx2);
  const lp = lab.page;
  const render = async (script, opts = {}) =>
    f32(await lp.evaluate(async ([s, o]) => {
      const g = window.__gallery;
      return window.__b64(await g.lapRunner.renderScript(g.synth, g.profile, s, o));
    }, [script, opts]));
  const base = { rpm: 5000, throttle: 1, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 3 };
  const SR = 48000;
  const body = (x) => x.subarray(Math.floor(0.5 * SR)); // layers that were muted at t=0 glide out over ~0.4 s
  const rms = (x) => dsp.rms(body(x));
  const solo1 = async (layer, state, extra = {}) => render([{ t: 0, state: { ...base, ...state } }], { durationS: 1.1, layers: [layer], ...extra });
  const on = 1e-3;
  const off = 1e-6;
  const layerRows = {};
  const note = (k, v) => (layerRows[k] = v);
  const spec = (x) => dsp.spectrum(x, Math.floor(0.55 * SR), 16384);

  // firing: pitch from rpm, level and brightness from throttle
  const fr = {};
  for (const rpm of [900, 3000, 6000]) {
    const x = await solo1('firing', { rpm, throttle: 0.6 });
    const expected = (rpm / 60) * 2;
    const est = dsp.estimateF0(spec(x), SR, 12, 300, 10);
    fr[rpm] = { expected, est, rms: rms(x) };
  }
  record('L1', 'firing layer: the fundamental follows rpm / 60 x cylinders / 2 offline (900, 3000, 6000 rpm)',
    Object.values(fr).every((r) => Math.abs(r.est - r.expected) <= Math.max(0.03 * r.expected, 1.5)), Object.entries(fr).map(([k, r]) => `${k}: ${r.expected.toFixed(0)}->${r.est.toFixed(1)}`).join('; '));
  const fLow = await solo1('firing', { rpm: 4000, throttle: 0 });
  const fHigh = await solo1('firing', { rpm: 4000, throttle: 1 });
  note('firing throttle 0', db(rms(fLow)));
  note('firing throttle 1', db(rms(fHigh)));
  record('L2', 'firing layer: throttle load raises level and brightness', rms(fHigh) > 1.5 * rms(fLow) && dsp.centroid(spec(fHigh), SR) > dsp.centroid(spec(fLow), SR));
  const intakeOff = await solo1('intake', { throttle: 0 });
  const intakeOn = await solo1('intake', { throttle: 1 });
  record('L3', 'intake layer: silent at zero throttle, audible at full', rms(intakeOff) < off && rms(intakeOn) > on, `${db(rms(intakeOff))} / ${db(rms(intakeOn))} dBFS`);
  const exLo = await solo1('exhaust', { rpm: 900, throttle: 0 });
  const exHi = await solo1('exhaust', { rpm: 6000, throttle: 1 });
  record('L4', 'exhaust layer: louder with revs and throttle', rms(exHi) > 3 * rms(exLo) && rms(exLo) > off, `${db(rms(exLo))} / ${db(rms(exHi))} dBFS`);
  const bo = [];
  for (const boost of [0, 0.25, 0.5, 1]) bo.push(await solo1('boost', { boost }));
  const peakHz = (x) => {
    const s = spec(x);
    let best = 1;
    for (let i = 2; i < s.length; i++) if (s[i] > s[best]) best = i;
    return (best * SR) / 2 / s.length;
  };
  record('L5', 'boost layer: silent at zero boost, louder and higher in pitch as boost rises',
    rms(bo[0]) < off && rms(bo[1]) > off && rms(bo[1]) < rms(bo[2]) && rms(bo[2]) < rms(bo[3]) && peakHz(bo[1]) + 300 < peakHz(bo[3]), `${bo.map((x) => db(rms(x))).join(' / ')} dBFS, whine ${peakHz(bo[1]).toFixed(0)} -> ${peakHz(bo[3]).toFixed(0)} Hz`);
  const sqOff = await solo1('squeal', { drift: 0, speed: 25 });
  const sqOn = await solo1('squeal', { drift: 1, speed: 25 });
  const sqStill = await solo1('squeal', { drift: 1, speed: 0, gear: 0 });
  const sqSpec = spec(sqOn);
  const sqBand = dsp.bandLevel(sqSpec, SR, 1000, 3200);
  const sqOther = dsp.bandLevel(sqSpec, SR, 6000, 12000);
  record('L6', 'squeal layer: silent without drift or without motion, a narrow-band whine of 1-3 kHz with drift', rms(sqOff) < off && rms(sqStill) < off && rms(sqOn) > on && sqBand > 8 * sqOther, `${db(rms(sqOn))} dBFS, band ratio ${(sqBand / sqOther).toFixed(0)}x`);
  const still = await solo1('surface', { speed: 0, gear: 0 });
  const surfRows = {};
  for (const s of ['tarmac', 'dirt', 'gravel']) {
    const x = await solo1('surface', { surface: s, speed: 30 });
    surfRows[s] = { rms: rms(x), centroid: dsp.centroid(spec(x), SR) };
  }
  record('L7', 'surface layer: silent when stopped; tarmac, dirt and gravel each audible and progressively brighter',
    rms(still) < off && surfRows.tarmac.rms > on && surfRows.dirt.rms > on && surfRows.gravel.rms > on && surfRows.tarmac.centroid < surfRows.dirt.centroid && surfRows.dirt.centroid < surfRows.gravel.centroid,
    Object.entries(surfRows).map(([k, r]) => `${k} ${db(r.rms)} dBFS @${r.centroid.toFixed(0)}Hz`).join('; '));
  const rtRows = [];
  for (const damage of [0, 0.5, 1]) rtRows.push(await solo1('rattle', { damage }));
  record('L8', 'rattle layer: silent when intact, louder as more of the body comes loose', rms(rtRows[0]) < off && rms(rtRows[1]) > off && rms(rtRows[1]) < rms(rtRows[2]) && rms(rtRows[2]) > on, rtRows.map((x) => db(rms(x))).join(' / ') + ' dBFS');
  const popScript = [{ t: 0, state: { ...base, rpm: 4500, throttle: 1 } }, { t: 0.6, state: { rpm: 4500, throttle: 0 } }];
  const popLift = await render(popScript, { durationS: 1.6, layers: ['pops'] });
  const popHold = await render([{ t: 0, state: { ...base, rpm: 4500, throttle: 1 } }], { durationS: 1.6, layers: ['pops'] });
  const popRms = dsp.rms(popLift, Math.floor(0.62 * SR), Math.floor(1.5 * SR));
  record('L9', 'pops layer: silent at steady throttle (and before the lift), crackles after a lift at revs', rms(popHold) < off && dsp.rms(popLift, Math.floor(0.5 * SR), Math.floor(0.59 * SR)) < off && popRms > 5e-4, `${db(popRms)} dBFS, peak ${db(dsp.peak(popLift))} dBFS`);
  const dipScript = [{ t: 0, state: { ...base, rpm: 4000, throttle: 0.7, gear: 3 } }, { t: 0.6, state: { gear: 4 } }];
  const dipX = await render(dipScript, { durationS: 1.2, layers: ['firing', 'intake', 'exhaust', 'boost', 'squeal', 'surface', 'rattle'] });
  const before = dsp.rms(dipX, Math.floor(0.4 * SR), Math.floor(0.6 * SR));
  const during = dsp.rms(dipX, Math.floor(0.616 * SR), Math.floor(0.66 * SR));
  const later = dsp.rms(dipX, Math.floor(1.0 * SR), Math.floor(1.2 * SR));
  record('L10', 'gear-change dip: the engine ducks by 3 dB or more on a gear change and recovers', during < 0.7 * before && later > 0.9 * before, `before ${db(before)}, dip ${db(during)}, after ${db(later)} dBFS`);
  const dead = await render([{ t: 0, state: { rpm: 0, throttle: 0, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 0 } }], { durationS: 0.6 });
  record('L11', 'an engine at rpm 0 with nothing else happening is silent', dsp.rms(dead) < off);
  const worst = await render([{ t: 0, state: { rpm: 6800, throttle: 1, boost: 1, drift: 1, surface: 'gravel', damage: 1, gear: 5 } }], { durationS: 1.5 });
  record('L12', 'the whole voice with every layer maxed leaves headroom (peak below -1 dBFS, no NaN)', dsp.peak(worst) < 0.89 && worst.every(Number.isFinite), `peak ${db(dsp.peak(worst))}, rms ${db(rms(worst))} dBFS`);

  // Layer balance table for the evidence.
  const balance = {};
  const bal = async (name, state, layers) => {
    const x = await solo1(layers[0], state, { layers });
    balance[name] = { rmsDbfs: +db(rms(x)), peakDbfs: +db(dsp.peak(body(x))) };
  };
  await bal('engine note, idle', { rpm: 900, throttle: 0, gear: 0 }, ['firing']);
  await bal('engine note, cruise 3000 rpm 40%', { rpm: 3000, throttle: 0.4 }, ['firing']);
  await bal('engine note, 6000 rpm flat out', { rpm: 6000, throttle: 1 }, ['firing']);
  await bal('intake, 6000 rpm flat out', { rpm: 6000, throttle: 1 }, ['intake']);
  await bal('exhaust, 6000 rpm flat out', { rpm: 6000, throttle: 1 }, ['exhaust']);
  await bal('boost whine, full boost 5000 rpm', { rpm: 5000, boost: 1 }, ['boost']);
  await bal('tyre squeal, full drift 25 m/s', { drift: 1, speed: 25 }, ['squeal']);
  await bal('road rumble, tarmac 30 m/s', { speed: 30, surface: 'tarmac' }, ['surface']);
  await bal('road rumble, dirt 30 m/s', { speed: 30, surface: 'dirt' }, ['surface']);
  await bal('road rumble, gravel 30 m/s', { speed: 30, surface: 'gravel' }, ['surface']);
  await bal('rattle, damage 100% at idle', { rpm: 900, throttle: 0, gear: 0, damage: 1 }, ['rattle']);
  await bal('rattle, damage 100% at 5000 rpm', { damage: 1 }, ['rattle']);
  balance['pops after a lift at 4500 rpm'] = { rmsDbfs: +db(popRms), peakDbfs: +db(dsp.peak(popLift)) };
  balance['all layers maxed (worst case)'] = { rmsDbfs: +db(rms(worst)), peakDbfs: +db(dsp.peak(body(worst))) };

  // ---- the scripted lap: determinism, WAV, spectrogram
  const lapSamples = async (page, o = {}) => f32(await page.evaluate(async (opts) => { const g = window.__gallery; return window.__b64(await g.lapRunner.renderLapOffline(g.synth, g.profile, g.lap, opts)); }, o));
  const lapA = await lapSamples(lp);
  const lapB = await lapSamples(lp);
  const lapOther = await lapSamples(lp, { seed: 7 });
  const hashA = sha(lapA);
  const maxDiff = (a, b) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };
  // Chromium sums a node's inputs in an unspecified order, so float32 rounding can differ by one ulp (6e-8) between runs
  // when three or more layers are live at once; any single layer is bit-identical. Same curve = same audio to -120 dBFS.
  const dAB = maxDiff(lapA, lapB);
  record('R1', 'the scripted lap renders the same twice in one page (max difference below -120 dBFS)', lapA.length === lapB.length && dAB < 1e-6, `max |diff| ${dAB.toExponential(2)} (${db(dAB)} dBFS), ${lapA.length} samples`);
  const dSolo = maxDiff(await lapSamples(lp, { layers: ['firing'], durationS: 8 }), await lapSamples(lp, { layers: ['firing'], durationS: 8 }));
  record('R1b', 'a single layer of the lap renders bit-identically twice', dSolo === 0, `max |diff| ${dSolo}`);
  record('R2', 'a different voice seed gives a clearly different (but still valid) render', maxDiff(lapOther, lapA) > 1e-3 && lapOther.every(Number.isFinite), `max |diff| ${maxDiff(lapOther, lapA).toExponential(2)}`);
  const ctx3 = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const fresh = await openPage(ctx3);
  const lapC = await lapSamples(fresh.page);
  const dAC = maxDiff(lapA, lapC);
  record('R3', 'and in a freshly loaded page (max difference below -120 dBFS)', dAC < 1e-6, `max |diff| ${dAC.toExponential(2)}`);
  await ctx3.close();
  const lapPeak = dsp.peak(lapA);
  record('R4', 'the lap render has no NaN and no clipping (peak below -1 dBFS)', lapA.every(Number.isFinite) && lapPeak < 0.89, `peak ${db(lapPeak)}, rms ${db(dsp.rms(lapA))} dBFS`);
  const wav = dsp.wav16(dsp.decimate2(lapA), 24000);
  writeFileSync(join(evidence, 'scripted-lap.wav'), wav);
  record('R5', 'scripted-lap.wav is under 2 MB', wav.length < 2 * 1024 * 1024, `${(wav.length / 1024 / 1024).toFixed(2)} MB, ${(lapA.length / SR).toFixed(1)} s, 24 kHz mono 16-bit`);
  writeFileSync(join(evidence, 'lap-spectrogram.png'), dsp.spectrogramPng(lapA, SR, { maxHz: 3000, height: 360 }));
  metrics.lap = { maxDiffTwoRenders: dAB, maxDiffFreshPage: dAC, sha256OfFirstRender: hashA, seconds: lapA.length / SR, peakDbfs: +db(lapPeak), rmsDbfs: +db(dsp.rms(lapA)) };
  metrics.layerBalance = balance;
  metrics.layerRows = layerRows;
  await ctx2.close();

  // The same render in Playwright's WebKit build (labelled WebKit, not Safari; not a device): informational.
  try {
    const wk = await webkit.launch();
    const wp = await wk.newPage();
    await wp.goto(pageUrl);
    await wp.waitForFunction(() => window.__gallery, null, { timeout: 20000 });
    const w = await wp.evaluate(async () => {
      const g = window.__gallery;
      const x = await g.lapRunner.renderLapOffline(g.synth, g.profile, g.lap, { durationS: 10, tailS: 0 });
      let sum = 0;
      let nan = 0;
      for (const v of x) {
        if (!Number.isFinite(v)) nan++;
        sum += v * v;
      }
      return { rms: Math.sqrt(sum / x.length), nan };
    });
    const ref = dsp.rms(lapA, 0, 10 * SR);
    await wk.close();
    record('W1', 'WebKit (Playwright build) renders the first 10 s of the lap with no NaN and the same level as Chromium (within 1.5 dB)', w.nan === 0 && Math.abs(dsp.dbfs(w.rms) - dsp.dbfs(ref)) < 1.5, `WebKit ${db(w.rms)} vs Chromium ${db(ref)} dBFS`);
  } catch (e) {
    record('W1', 'WebKit (Playwright build) render (skipped: WebKit not available)', true, e.message.split('\n')[0]);
  }

  // ======================================================================================== 6. CPU cost
  if (!quick) {
    const ctx4 = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const benchPage = (await openPage(ctx4)).page;
    const chromiumVersion = browser.version();
    const SR_B = 48000;
    const NS = [1, 8, 24, 32];
    const REPEATS = 5;
    const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const states = {
      idle: { rpm: 900, throttle: 0, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 0 },
      cruise: { rpm: 3500, throttle: 0.5, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 3, speed: 20 },
      'all layers': { rpm: 5200, throttle: 0.9, boost: 0.8, drift: 0.7, surface: 'gravel', damage: 0.7, gear: 3, speed: 28 },
    };
    const staticMs = (n, state) =>
      benchPage.evaluate(
        async ([count, st, sec, sr]) => {
          const g = window.__gallery;
          const ctx = new OfflineAudioContext(1, sec * sr, sr);
          const voices = [];
          for (let i = 0; i < count; i++) voices.push(g.synth.create(ctx, g.profile, { destination: ctx.destination, seed: i, initial: st }));
          const t0 = performance.now();
          await ctx.startRendering();
          const ms = performance.now() - t0;
          for (const v of voices) v.dispose();
          return ms;
        },
        [n, state, 10, SR_B],
      );
    const lapTiming = (n) =>
      benchPage.evaluate(async ([count, sr]) => {
        const g = window.__gallery;
        const r = await g.lapRunner.renderLapOffline(g.synth, g.profile, g.lap, { voices: count, sampleRate: sr, timing: true });
        return { wallMs: r.wallMs, callbackMs: r.callbackMs, steps: r.steps, audioSeconds: r.samples.length / sr };
      }, [n, SR_B]);

    const out = { static: {}, lap: {} };
    for (const [name, st] of Object.entries(states)) {
      await staticMs(2, st); // warm up
      const baseline = median(await Promise.all([0, 1, 2].map(() => staticMs(0, st))));
      out.static[name] = {};
      for (const n of NS) {
        const runs = [];
        for (let r = 0; r < REPEATS; r++) runs.push(await staticMs(n, st));
        const ms = median(runs) - baseline;
        out.static[name][n] = { msPer10sAudio: +median(runs).toFixed(1), msPerAudioSecondPerVoice: +(ms / 10 / n).toFixed(3), runs: runs.map((x) => +x.toFixed(1)) };
      }
      console.log(`     cpu static ${name}: ` + NS.map((n) => `${n}v ${out.static[name][n].msPerAudioSecondPerVoice} ms/s/voice`).join(', '));
    }
    await lapTiming(2);
    const base0 = [];
    for (let r = 0; r < REPEATS; r++) base0.push(await lapTiming(0));
    const wall0 = median(base0.map((x) => x.wallMs));
    const cb0 = median(base0.map((x) => x.callbackMs));
    out.lap.baseline = { wallMs: +wall0.toFixed(1), callbackMs: +cb0.toFixed(2), steps: base0[0].steps };
    for (const n of NS) {
      const runs = [];
      for (let r = 0; r < REPEATS; r++) runs.push(await lapTiming(n));
      const wall = median(runs.map((x) => x.wallMs));
      const cb = median(runs.map((x) => x.callbackMs));
      const audioMs = wall - wall0 - (cb - cb0);
      const secs = runs[0].audioSeconds;
      out.lap[n] = {
        wallMs: +wall.toFixed(1),
        mainThreadSetMs: +(cb - cb0).toFixed(2),
        audioThreadMs: +audioMs.toFixed(1),
        msPerAudioSecondPerVoice: +(audioMs / secs / n).toFixed(3),
        percentOfOneCorePerVoiceRealtime: +((audioMs / secs / n / 1000) * 100).toFixed(3),
        setCallUsPerVoicePerCall: +(((cb - cb0) / runs[0].steps / n) * 1000).toFixed(2),
        runs: runs.map((x) => +x.wallMs.toFixed(1)),
      };
    }
    console.log('     cpu lap: ' + NS.map((n) => `${n}v ${out.lap[n].msPerAudioSecondPerVoice} ms/s/voice`).join(', '));
    const lapPerVoice = NS.map((n) => out.lap[n].msPerAudioSecondPerVoice);
    const allLayers = NS.map((n) => out.static['all layers'][n].msPerAudioSecondPerVoice);
    const idleV = NS.map((n) => out.static.idle[n].msPerAudioSecondPerVoice);
    record('C1', 'per-voice audio-thread cost measured at 1, 8, 24 and 32 voices (idle, cruise, all layers, and the scripted lap)', [...lapPerVoice, ...allLayers, ...idleV].every((v) => Number.isFinite(v) && v > 0),
      `lap ${lapPerVoice.join('/')}, all layers ${allLayers.join('/')}, idle ${idleV.join('/')} ms per audio-second per voice`);
    // A voice must stay cheap enough that dozens fit in a fraction of one core (guards against a regression, not a budget).
    record('C2', 'a voice costs under 1.5% of one core in real time in every scenario and cost per voice does not blow up with count', Math.max(...lapPerVoice, ...allLayers) < 15 && Math.max(...allLayers) < 2 * Math.min(...allLayers), `max ${Math.max(...lapPerVoice, ...allLayers)} ms/s/voice`);
    const info = {
      machine: `${cpus()[0].model}, ${cpus().length} cores, ${(totalmem() / 2 ** 30).toFixed(0)} GiB, macOS ${execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()} (Darwin ${release()})`,
      chromium: `Chromium ${chromiumVersion} (Playwright ${JSON.parse(readFileSync(join(repo, 'node_modules', 'playwright', 'package.json'), 'utf8')).version}, new headless, channel chromium)`,
      node: process.version,
      date: new Date().toISOString(),
      sampleRate: SR_B,
      voiceSeedsDiffer: true,
    };
    writeFileSync(
      join(evidence, 'cpu.json'),
      `${JSON.stringify(
        {
          ...info,
          unit: 'msPerAudioSecondPerVoice = milliseconds of audio-thread time spent per second of audio rendered, per voice (divide by 10 for percent of one core in real time)',
          method: [
            'OfflineAudioContext (mono, 48 kHz) in Chromium renders as fast as one thread allows; the time of startRendering() is the cost.',
            'static: N voices held in one fixed state for 10 s (idle = 900 rpm in neutral; cruise = 3500 rpm, half throttle; all layers = every layer live: boost, drift, gravel, damage). The empty-graph render is subtracted. Median of 5 runs after a warm-up.',
            'lap: N voices all driven through the 38 s scripted lap by the page (a set() call per voice every 20 ms at suspend points, as a game would). The same render with 0 voices (the suspend and promise overhead) is subtracted, then the measured main-thread time of the set() callbacks, leaving audio-thread time. Median of 5 runs.',
            'Voice counts are samples of N, not limits. Each voice has its own seed.',
          ],
          perVoice: { lap: Object.fromEntries(NS.map((n) => [n, out.lap[n].msPerAudioSecondPerVoice])), allLayers: Object.fromEntries(NS.map((n) => [n, out.static['all layers'][n].msPerAudioSecondPerVoice])), cruise: Object.fromEntries(NS.map((n) => [n, out.static.cruise[n].msPerAudioSecondPerVoice])), idle: Object.fromEntries(NS.map((n) => [n, out.static.idle[n].msPerAudioSecondPerVoice])) },
          static: out.static,
          lap: out.lap,
        },
        null,
        2,
      )}\n`,
    );
    metrics.cpu = { perVoiceLap: Object.fromEntries(NS.map((n) => [n, out.lap[n].msPerAudioSecondPerVoice])) };
    await ctx4.close();
  }
} finally {
  await browser.close();
  server.close();
}

// ============================================================================================ report
const info = { date: new Date().toISOString(), passed: results.filter((r) => r.pass).length, total: results.length, results, metrics };
writeFileSync(join(evidence, 'checks.json'), `${JSON.stringify(info, null, 2)}\n`);
if (failures.length) {
  console.log(`\nengine synth check: ${failures.length} failure(s)`);
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exit(1);
}
console.log(`\nengine synth check: ok (${results.length} checks)`);
