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
// 6. Evidence in docs/evidence/P1-A04/: gallery and lab screenshots, cpu.json, checks.json.
// 7. P1-A04c (T1, K1-K8, B4b, B9b, B17-B19, M10, P6, SL8): no turbo on the Cruz Missile (offline band check), engine start and stop rendered
//    offline (non-silent, deterministic, idle and silence reached within their stated times, phases on the state
//    API), the page's start/stop key and the lap that opens and closes with them. Evidence in
//    docs/evidence/P1-A04c/: start.wav, stop.wav, ignition-trace.json, scripted-lap.wav, lap-spectrogram.png.
// Exits non-zero naming every failed check.
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
const evidenceC = join(repo, 'docs', 'evidence', 'P1-A04c');
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
mkdirSync(evidenceC, { recursive: true });

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
const hay = JSON.parse(readFileSync(join(repo, 'assets', 'audio', 'engine', 'hay-hauler.json'), 'utf8'));
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
  ['missing ignition', (p) => delete p.ignition, true],
  ['stop shorter than the schema allows', (p) => (p.ignition.stopS = 0.05), true],
  ['cranking faster than idle', (p) => (p.ignition.crankRpm = 1500), false],
  ['flare below idle', (p) => (p.ignition.flareRpm = 600), false],
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
const hayCheck = synthNode.validateProfile(hay);
const manifestFiles = JSON.parse(readFileSync(join(repo, 'assets', 'audio', 'engine', 'manifest.json'), 'utf8')).files;
const manifestRows = manifestFiles.map((f) => {
  const p = JSON.parse(readFileSync(join(repo, 'assets', 'audio', 'engine', f), 'utf8'));
  return { f, validator: synthNode.validateProfile(p).ok, schema: schemaOk(p) === true };
});
record('P7', `every profile in the vehicle-sound manifest validates against the validator and the JSON Schema (${manifestFiles.join(', ')})`,
  manifestRows.length >= 2 && manifestRows.every((r) => r.validator && r.schema), JSON.stringify(manifestRows.filter((r) => !r.validator || !r.schema)));
record('P6', 'turbo is per-vehicle data: the Cruz Missile has no boost section and the Hay Hauler has one; both pass the validator and the JSON Schema',
  !('boost' in profile) && Boolean(hay.boost) && hayCheck.ok && schemaOk(hay) === true && !schema.required.includes('boost') && schema.required.includes('ignition'), hayCheck.errors.slice(0, 2).join('; '));

// ============================================================================================ 3. state -> targets
const T = (s) => synthNode.computeTargets(profile, { rpm: 4000, throttle: 0.5, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 3, ...s });
record('M1', 'firing frequency is rpm / 60 x cylinders / 2 (3000 rpm, 4 cyl = 100 Hz)', synthNode.firingHz(4, 3000) === 100 && Math.abs(T({ rpm: 3000 }).firing.f0 - 100) < 1e-9);
record('M2', 'the firing oscillators track rpm exactly across the range', [900, 2000, 3500, 5000, 7000].every((r) => Math.abs(T({ rpm: r }).firing.f0 - (r / 60) * 2) < 1e-9));
const more = (a, b) => b > a;
record('M3', 'throttle raises intake, exhaust, engine level and brightness; zero throttle means zero intake',
  T({ throttle: 0 }).levels.intake === 0 && more(T({ throttle: 0 }).levels.exhaust, T({ throttle: 1 }).levels.exhaust) && more(T({ throttle: 0 }).levels.intake, T({ throttle: 1 }).levels.intake) &&
  more(T({ throttle: 0 }).firing.mellowGain + T({ throttle: 0 }).firing.brightGain, T({ throttle: 1 }).firing.mellowGain + T({ throttle: 1 }).firing.brightGain) && more(T({ throttle: 0 }).firing.bodyHz, T({ throttle: 1 }).firing.bodyHz));
const TH = (s) => synthNode.computeTargets(hay, { rpm: 3000, throttle: 0.5, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 3, ...s });
record('M4', 'boost drives the whine on a car with a turbo (Hay Hauler): zero boost is silent, whine pitch and level rise', TH({ boost: 0 }).boost.whineGain === 0 && more(TH({ boost: 0.2 }).boost.whineHz, TH({ boost: 1 }).boost.whineHz) && more(TH({ boost: 0.2 }).boost.whineGain, TH({ boost: 1 }).boost.whineGain));
record('M10', 'the Cruz Missile has no turbo: full boost maps to no whine, no whoosh and a zero boost level (POC1-01)',
  [0.5, 1].every((b) => T({ boost: b, rpm: 6000, throttle: 1 }).boost.whineGain === 0 && T({ boost: b }).boost.whooshGain === 0 && T({ boost: b }).levels.boost === 0));
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
  for (let i = 0; i < 36; i++) {
    await sleep(i < 12 ? 125 : 250);
    const p = await page.evaluate(() => ({ ...window.__gallery.probe(), gear: document.getElementById('gear-n').textContent, rpmText: Number(document.getElementById('rpm-n').textContent) }));
    samples.push(p);
  }
  const ORDER = ['off', 'cranking', 'catching', 'settling', 'running'];
  const phasesSeen = samples.map((x) => x.ignition?.phase);
  const inOrder = phasesSeen.every((ph, i) => i === 0 || ORDER.indexOf(ph) >= ORDER.indexOf(phasesSeen[i - 1]));
  record('B4b', 'the lap opens with the engine start: the state API reports cranking, then settling, then running, in order (POC1-02)',
    phasesSeen[0] === 'cranking' && phasesSeen.includes('settling') && phasesSeen.at(-1) === 'running' && inOrder, [...new Set(phasesSeen)].join(' > '));
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
  // Let the lap finish by itself: it ends with the key off, so the stop plays before the sliders come back.
  await page.evaluate(() => window.__gallery.seekLap(36.8));
  const endPhases = [];
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    const p = await page.evaluate(() => ({ active: window.__gallery.lapActive, phase: window.__gallery.voice.ignition().phase, rms: window.__gallery.probe().rms, status: document.getElementById('status').textContent }));
    endPhases.push(p);
    if (!p.active) break;
  }
  // The page's frames are not sample-exact: give the analyser up to a second to show the silence.
  let after;
  for (let i = 0; i < 10; i++) {
    await sleep(100);
    after = await page.evaluate(() => ({ rpm: document.getElementById('in-rpm').disabled, btn: document.getElementById('lap-btn').textContent, key: document.getElementById('start-btn').textContent, phase: window.__gallery.voice.ignition().phase, rms: window.__gallery.probe().rms }));
    if (after.rms < 1e-4 && after.key === 'Start engine') break;
  }
  record('B9', 'the lap ends on its own and hands the sliders back', after.rpm === false && after.btn === 'Play scripted lap', JSON.stringify(after));
  record('B9b', 'the lap ends with the engine stop: stopping, then off, the output silent and the key ready to start again (POC1-02)',
    endPhases.some((x) => x.phase === 'stopping' && x.rms > 0.002) && after.phase === 'off' && after.rms < 1e-4 && after.key === 'Start engine',
    `${[...new Set(endPhases.map((x) => x.phase))].join(' > ')}, end rms ${db(after.rms)} dBFS`);

  // The key: Start engine plays crank, catch and settle on the page, and the status line says so.
  const ig = profile.ignition;
  await page.click('#start-btn');
  const keyRows = [];
  for (let i = 0; i < 40; i++) {
    const p = await page.evaluate(() => ({ phase: window.__gallery.voice.ignition().phase, status: document.getElementById('status').textContent, key: document.getElementById('start-btn').textContent, rms: window.__gallery.probe().rms }));
    keyRows.push(p);
    if (p.status === 'Engine running') break;
    await sleep(60);
  }
  const keyPhases = [...new Set(keyRows.map((r) => r.phase))];
  record('B17', 'Start engine plays the start on the page: cranking (audible), then running, the status line following and the button becoming Stop engine (POC1-02)',
    keyRows[0].phase === 'cranking' && keyRows[0].status === 'Cranking…' && keyRows.some((r) => r.phase === 'cranking' && r.rms > 0.002) && keyRows.at(-1).phase === 'running' && keyRows.at(-1).status === 'Engine running' && keyRows.at(-1).key === 'Stop engine',
    `${keyPhases.join(' > ')}; ${[...new Set(keyRows.map((r) => r.status))].join(' / ')}`);

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
  record('B12', 'each layer meter follows its own control (intake and exhaust: throttle, squeal: drift, rattle: damage; boost on a turbo car in SL8)',
    m.throttle0 === 0 && m.throttle1 > 0.3 && m.exhaust1 > 0.4 && m.drift0 === 0 && m.drift1 > 0.1 && m.damage0 === 0 && m.damage1 > 0.2, JSON.stringify(m));
  const noTurbo = await page.evaluate(async () => {
    const g = window.__gallery;
    g.voice.set({ boost: 1 });
    await new Promise((r) => setTimeout(r, 150));
    const lv = g.voice.levels().boost;
    g.voice.set({ boost: 0 });
    const note = document.getElementById('boost-note');
    return { disabled: document.getElementById('in-boost').disabled, note: note.hidden ? '' : note.textContent, meter: lv };
  });
  record('B18', 'the Cruz has no turbo: its boost slider is disabled and says why, and asking the voice for full boost sounds nothing (POC1-01)',
    noTurbo.disabled && /no turbo/.test(noTurbo.note) && noTurbo.meter === 0, JSON.stringify(noTurbo));
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
  const solo = await page.evaluate(() => ({ off: [...document.querySelectorAll('.layer')].filter((l) => l.dataset.off === 'true').length, layers: document.querySelectorAll('.layer').length }));
  record('B16', 'solo mutes the other eight layers (starter included)', solo.off === 8 && solo.layers === 9, JSON.stringify(solo));
  await page.locator('.layer[data-layer="squeal"] button').click();

  // The key again: Stop engine plays the cut and spool-down, and the output falls silent within stopS. Revving
  // in neutral (parked, intact), so the engine is the only thing to hear.
  await page.click('[data-preset="idle"]');
  await setSlider('rpm', 3000);
  await setSlider('throttle', 40);
  await sleep(300);
  await page.click('#start-btn');
  const stopRows = [];
  const tStop = await page.evaluate(() => window.__gallery.ctx.currentTime);
  for (let i = 0; i < 40; i++) {
    const p = await page.evaluate(() => ({ t: window.__gallery.ctx.currentTime, phase: window.__gallery.voice.ignition().phase, status: document.getElementById('status').textContent, key: document.getElementById('start-btn').textContent, rms: window.__gallery.probe().rms }));
    stopRows.push(p);
    if (p.phase === 'off' && p.t - tStop > ig.stopS + 0.15) break;
    await sleep(60);
  }
  const lastStop = stopRows.at(-1);
  record('B19', `Stop engine plays the stop on the page: stopping (audible, status Stopping…), then Engine off and silence within stopS (${ig.stopS} s) (POC1-02)`,
    stopRows[0].phase === 'stopping' && stopRows[0].status === 'Stopping…' && stopRows.some((r) => r.phase === 'stopping' && r.rms > 0.002) && lastStop.phase === 'off' && lastStop.status === 'Engine off' && lastStop.key === 'Start engine' && lastStop.rms < 1e-4 && lastStop.t - tStop < ig.stopS + 0.6,
    `${[...new Set(stopRows.map((r) => r.phase))].join(' > ')}, silent at +${(lastStop.t - tStop).toFixed(2)} s, rms ${db(lastStop.rms)} dBFS`);
  await ctx1.close();

  // ======================================================================================== 5. offline renders
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const lab = await openPage(ctx2);
  const lp = lab.page;
  const render = async (script, opts = {}) =>
    f32(await lp.evaluate(async ([s, o]) => {
      const g = window.__gallery;
      return window.__b64(await g.lapRunner.renderScript(g.synth, o.profile ?? g.profile, s, o));
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
  // The Cruz has no turbo (T1 proves it stays silent), so the boost layer is checked on the Hay Hauler, which has one.
  // Parked (speed 0): the Hay Hauler's slower control glide would otherwise leave the muted road layer audible.
  for (const boost of [0, 0.25, 0.5, 1]) bo.push(await solo1('boost', { boost, rpm: 3500, speed: 0 }, { profile: hay }));
  const peakHz = (x) => {
    const s = spec(x);
    let best = 1;
    for (let i = 2; i < s.length; i++) if (s[i] > s[best]) best = i;
    return (best * SR) / 2 / s.length;
  };
  record('L5', 'boost layer (Hay Hauler): silent at zero boost, louder and higher in pitch as boost rises',
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
  {
    const x = await solo1('boost', { rpm: 3500, boost: 1, speed: 0 }, { profile: hay, layers: ['boost'] });
    balance['boost whine, Hay Hauler full boost 3500 rpm (the Cruz has no turbo)'] = { rmsDbfs: +db(rms(x)), peakDbfs: +db(dsp.peak(body(x))) };
  }
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
  writeFileSync(join(evidenceC, 'scripted-lap.wav'), wav);
  record('R5', 'scripted-lap.wav is under 2 MB', wav.length < 2 * 1024 * 1024, `${(wav.length / 1024 / 1024).toFixed(2)} MB, ${(lapA.length / SR).toFixed(1)} s, 24 kHz mono 16-bit`);
  writeFileSync(join(evidenceC, 'lap-spectrogram.png'), dsp.spectrogramPng(lapA, SR, { maxHz: 3000, height: 360 }));
  metrics.lap = { maxDiffTwoRenders: dAB, maxDiffFreshPage: dAC, sha256OfFirstRender: hashA, seconds: lapA.length / SR, peakDbfs: +db(lapPeak), rmsDbfs: +db(dsp.rms(lapA)) };
  metrics.layerBalance = balance;
  metrics.layerRows = layerRows;

  // ======================================================================================== 7. P1-A04c
  // One voice in an OfflineAudioContext: `events` [{ t, state }] are set() at their times, and the ignition status
  // is read every 10 ms *without* calling set(), so the trace shows the sequence plays out by itself and is
  // exactly what in-game audio (P1-A05) reads from the state API.
  const traceRender = async (profileJson, initial, events, durationS, every = 0.01) => {
    const r = await lp.evaluate(async ([p, init, evs, dur, step]) => {
      const g = window.__gallery;
      const sr = 48000;
      const quantum = 128;
      const frames = Math.ceil(dur * sr);
      const ctx = new OfflineAudioContext(1, frames, sr);
      const voice = g.synth.create(ctx, p, { destination: ctx.destination, initial: init });
      const at = new Map();
      const q = (t) => Math.round((t * sr) / quantum) * quantum;
      for (let t = step; t < dur; t += step) at.set(q(t), []);
      for (const e of evs) {
        if (!at.has(q(e.t))) at.set(q(e.t), []);
        at.get(q(e.t)).push(e.state);
      }
      const trace = [];
      for (const [k, states] of at) {
        if (k <= 0 || k >= frames) continue;
        ctx.suspend(k / sr).then(() => {
          for (const st of states) voice.set(st);
          const s = voice.ignition();
          trace.push({ t: +ctx.currentTime.toFixed(4), phase: s.phase, rpm: +s.rpm.toFixed(1) });
          ctx.resume();
        });
      }
      const buf = await ctx.startRendering();
      voice.dispose();
      trace.sort((a, b) => a.t - b.t);
      return { b64: window.__b64(buf.getChannelData(0).slice()), trace };
    }, [profileJson, initial, events, durationS, every]);
    return { x: f32(r.b64), trace: r.trace };
  };
  const win = (x, a, b) => dsp.rms(x, Math.floor(a * SR), Math.floor(b * SR));
  const near = (a, b, tol = 0.012) => Math.abs(a - b) <= tol;
  const firstAt = (trace, ph) => trace.find((r) => r.phase === ph)?.t ?? NaN;

  // POC1-01: no turbo on the Cruz. The same full-throttle state at boost 0 and boost 1 must render the same, and the
  // band a whine would sit in (1.5-5.5 kHz) gains nothing; the Hay Hauler (which has a turbo) proves the check hears one.
  const full = { rpm: 5000, throttle: 1, drift: 0, surface: 'tarmac', damage: 0, gear: 3 };
  const cruz0 = await render([{ t: 0, state: { ...full, boost: 0 } }], { durationS: 1.1 });
  const cruz1 = await render([{ t: 0, state: { ...full, boost: 1 } }], { durationS: 1.1 });
  const cruzSolo = await render([{ t: 0, state: { ...full, boost: 1 } }], { durationS: 1.1, layers: ['boost'] });
  const hay0 = await render([{ t: 0, state: { ...full, rpm: 3500, boost: 0 } }], { durationS: 1.1, profile: hay });
  const hay1 = await render([{ t: 0, state: { ...full, rpm: 3500, boost: 1 } }], { durationS: 1.1, profile: hay });
  const whineBand = (x) => dsp.bandLevel(spec(x), SR, 1500, 5500);
  const dCruz = maxDiff(cruz0, cruz1);
  const cruzGain = dsp.dbfs(whineBand(cruz1)) - dsp.dbfs(whineBand(cruz0));
  const hayGain = dsp.dbfs(whineBand(hay1)) - dsp.dbfs(whineBand(hay0));
  record('T1', 'POC1-01 the Cruz Missile renders no turbo at full boost: boost 1 renders the same as boost 0 and the whine band gains nothing (the Hay Hauler gains plainly)',
    dCruz < 1e-6 && rms(cruzSolo) < off && Math.abs(cruzGain) < 0.01 && hayGain > 3, `Cruz max |diff| ${dCruz.toExponential(2)}, band ${cruzGain.toFixed(2)} dB, boost solo ${db(rms(cruzSolo))} dBFS; Hay Hauler band +${hayGain.toFixed(1)} dB`);

  // POC1-02: the start, rendered from a parked car with the key turned at keyAt (ig is profile.ignition, from B17).
  const idleRpm = profile.engine.idleRpm;
  const parked = { rpm: idleRpm, throttle: 0, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 0 };
  const keyAt = 0.25;
  const settled = keyAt + ig.crankS + ig.catchS + 3 * ig.settleTauS;
  const startDur = settled + 1;
  const startA = await traceRender(profile, { ...parked, ignition: false }, [{ t: keyAt, state: { ignition: true } }], startDur);
  const startB = await traceRender(profile, { ...parked, ignition: false }, [{ t: keyAt, state: { ignition: true } }], startDur);
  const idleRef = await render([{ t: 0, state: parked }], { durationS: 1.6 });
  const sT = startA.trace;
  const crankRows = sT.filter((r) => r.phase === 'cranking');
  const flarePeak = Math.max(...sT.filter((r) => r.phase === 'catching' || r.phase === 'settling').map((r) => r.rpm));
  const lastSettling = sT.filter((r) => r.phase === 'settling').at(-1);
  const runRow = sT.find((r) => r.phase === 'running');
  const startQuiet = win(startA.x, 0, keyAt - 0.01);
  const crankRms = win(startA.x, keyAt + 0.05, keyAt + ig.crankS);
  const tailRms = win(startA.x, settled + 0.4, startDur);
  const idleRms = win(idleRef, 1.0, 1.6);
  const idleHz = synthNode.firingHz(profile.engine.cylinders, idleRpm);
  const tailF0 = dsp.estimateF0(dsp.spectrum(startA.x, Math.floor((settled + 0.3) * SR), 16384), SR, 12, 300, 10);
  record('K1', 'POC1-02 engine start offline: silent before the key, the crank audible, then cranking, catching, settling and running on the state API at the profile\'s times (within 12 ms), with no set() calls after the key',
    startQuiet < off && crankRms > on && near(firstAt(sT, 'cranking'), keyAt) && near(firstAt(sT, 'catching'), keyAt + ig.crankS) && near(firstAt(sT, 'settling'), keyAt + ig.crankS + ig.catchS) && near(firstAt(sT, 'running'), settled),
    `crank ${db(crankRms)} dBFS; cranking@${firstAt(sT, 'cranking')} catching@${firstAt(sT, 'catching')} settling@${firstAt(sT, 'settling')} running@${firstAt(sT, 'running')} (stated ${settled.toFixed(3)} s)`);
  record('K2', `POC1-02 the start cranks at ${ig.crankRpm} rpm, flares toward ${ig.flareRpm} and reaches idle within its stated time (crankS + catchS + 3 settleTauS = ${(settled - keyAt).toFixed(2)} s): rpm within 5% at the end of the settle, and the audio then matches a running idle (level within 1 dB, firing note at ${idleHz.toFixed(0)} Hz)`,
    crankRows.length > 0 && crankRows.every((r) => Math.abs(r.rpm - ig.crankRpm) <= ig.crankRpm * 0.01) && flarePeak > 0.9 * ig.flareRpm && flarePeak <= ig.flareRpm * 1.001 &&
      Boolean(lastSettling) && Math.abs(lastSettling.rpm - idleRpm) / idleRpm < 0.05 && runRow?.rpm === idleRpm && Math.abs(dsp.dbfs(tailRms) - dsp.dbfs(idleRms)) < 1 && Math.abs(tailF0 - idleHz) <= Math.max(0.03 * idleHz, 1.5),
    `flare peak ${flarePeak} rpm, ${lastSettling?.rpm} rpm at the end of the settle; tail ${db(tailRms)} vs idle ${db(idleRms)} dBFS, note ${tailF0.toFixed(1)} Hz`);
  const dStart = maxDiff(startA.x, startB.x);
  record('K3', 'POC1-02 the start renders deterministically (twice: max difference below -120 dBFS, same trace)', dStart < 1e-6 && JSON.stringify(startA.trace) === JSON.stringify(startB.trace), `max |diff| ${dStart.toExponential(2)}`);

  // POC1-02: the stop, revving in neutral (parked, intact, so the engine is the only thing to hear) with the key off at cutAt.
  const revving = { rpm: 3000, throttle: 0.5, boost: 0, drift: 0, surface: 'tarmac', damage: 0, gear: 0 };
  const cutAt = 0.4;
  const silentAt = cutAt + ig.stopS;
  const stopDur = silentAt + 0.6;
  const stopA = await traceRender(profile, { ...revving, ignition: true }, [{ t: cutAt, state: { ignition: false } }], stopDur);
  const stopB = await traceRender(profile, { ...revving, ignition: true }, [{ t: cutAt, state: { ignition: false } }], stopDur);
  const pT = stopA.trace;
  const stopping = pT.filter((r) => r.phase === 'stopping');
  const wBefore = win(stopA.x, 0.15, cutAt);
  const w1 = win(stopA.x, cutAt + 0.02, cutAt + 0.25);
  const w2 = win(stopA.x, cutAt + 0.3, cutAt + 0.55);
  const w3 = win(stopA.x, cutAt + 0.6, silentAt - 0.05);
  const afterPeak = dsp.peak(stopA.x, Math.floor((silentAt + 0.005) * SR));
  record('K4', `POC1-02 engine stop offline: audible after the cut and fading (each window quieter), then exact silence from cut + stopS (${ig.stopS} s)`,
    wBefore > on && w1 > on && w1 < wBefore && w2 < w1 && w3 < w2 && afterPeak === 0, `${db(wBefore)} > ${db(w1)} > ${db(w2)} > ${db(w3)} dBFS, then peak ${afterPeak}`);
  record('K5', 'POC1-02 the stop on the state API: stopping from the cut, off at cut + stopS (within 12 ms), the sounding rpm falling all the way from the revs',
    near(firstAt(pT, 'stopping'), cutAt) && near(firstAt(pT, 'off'), silentAt) && stopping.every((r, i) => i === 0 || r.rpm <= stopping[i - 1].rpm) && Math.abs(stopping[0].rpm - revving.rpm) / revving.rpm < 0.03 && stopping.at(-1).rpm < ig.crankRpm && pT.at(-1).rpm === 0,
    `stopping@${firstAt(pT, 'stopping')} off@${firstAt(pT, 'off')} (stated ${silentAt.toFixed(3)}), rpm ${stopping[0]?.rpm} -> ${stopping.at(-1)?.rpm}`);
  const dStop = maxDiff(stopA.x, stopB.x);
  record('K6', 'POC1-02 the stop renders deterministically (twice: max difference below -120 dBFS, same trace)', dStop < 1e-6 && JSON.stringify(stopA.trace) === JSON.stringify(stopB.trace), `max |diff| ${dStop.toExponential(2)}`);

  // Interrupted sequences: key off halfway through the crank, back on halfway through the stop.
  const offAt = 0.1 + ig.crankS / 2;
  const onAgain = offAt + ig.stopS / 2;
  const intr = await traceRender(profile, { ...parked, ignition: false }, [{ t: 0.1, state: { ignition: true } }, { t: offAt, state: { ignition: false } }, { t: onAgain, state: { ignition: true } }], onAgain + ig.crankS + ig.catchS + 3 * ig.settleTauS + 0.4);
  const iPhases = intr.trace.map((r) => r.phase).filter((ph, i, a) => i === 0 || ph !== a[i - 1]);
  record('K7', 'an interrupted start and stop (key off mid-crank, on again mid-stop) stays clean: no NaN, peak below -1 dBFS, and it ends running',
    intr.x.every(Number.isFinite) && dsp.peak(intr.x) < 0.89 && iPhases.join(',') === 'off,cranking,stopping,cranking,catching,settling,running', `${iPhases.join(' > ')}, peak ${db(dsp.peak(intr.x))} dBFS`);

  // The scripted lap opens with the start and closes with the stop (lapA is the lap render above).
  const lapPre = await lp.evaluate(() => window.__gallery.lapRunner.startStopTimes(window.__gallery.profile));
  const lapTotal = lapPre.preS + lap.durationS + lapPre.stopS;
  record('K8', 'POC1-02 the scripted lap render opens with the start (the crank audible, the starter layer live) and closes with the stop (exact silence after it)',
    win(lapA, 0.05, ig.crankS) > on && dsp.peak(lapA, Math.floor((lapTotal + 0.02) * SR)) === 0 && Math.abs(lapA.length / SR - (lapTotal + 0.5)) < 0.01,
    `pre-roll ${lapPre.preS} s, stop ${lapPre.stopS} s, ${(lapA.length / SR).toFixed(2)} s rendered`);

  writeFileSync(join(evidenceC, 'start.wav'), dsp.wav16(dsp.decimate2(startA.x), 24000));
  writeFileSync(join(evidenceC, 'stop.wav'), dsp.wav16(dsp.decimate2(stopA.x), 24000));
  writeFileSync(join(evidenceC, 'ignition-trace.json'), `${JSON.stringify({ profile: profile.id, ignition: ig, start: { keyAt, settledAt: settled, trace: sT }, stop: { cutAt, silentAt, trace: pT }, interrupted: { trace: intr.trace } }, null, 1)}\n`);
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

  // ======================================================================================== 7. sound lab (P1-A04b)
  const ctxL = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const SL = (await openPage(ctxL)).page;
  const labBase = { rpm: 4200, throttle: 0.9, boost: 0.4, drift: 0, surface: 'tarmac', damage: 0, gear: 3 };
  const labRender = async (profileJson, layers = null) =>
    f32(await SL.evaluate(async ([p, s, l]) => window.__b64(await window.__gallery.lapRunner.renderScript(window.__gallery.synth, p, [{ t: 0, state: s }], { durationS: 1.1, layers: l })), [profileJson, labBase, layers]));
  const schemaLeaves = (node, prefix = '') =>
    node.type === 'object'
      ? Object.entries(node.properties).flatMap(([k, v]) => schemaLeaves(v, prefix ? `${prefix}.${k}` : k))
 : [prefix];
  const labInfo = await SL.evaluate(() => ({ profiles: window.__gallery.lab.profiles(), current: window.__gallery.lab.currentProfileId(), paths: window.__gallery.lab.controlPaths() }));
  const wanted = schemaLeaves(schema);
  const missing = wanted.filter((p) => !labInfo.paths.includes(p));
  const extra = labInfo.paths.filter((p) => !wanted.includes(p));
  record('SL1', `every schema field has a lab control, generated from the schema (${wanted.length} fields) and every manifest profile is in the picker (${manifestFiles.length})`, missing.length === 0 && extra.length === 0 && labInfo.profiles.length === manifestFiles.length && labInfo.current === 'cruz-missile', `missing ${missing.join(', ')} extra ${extra.join(', ')}`);

  await SL.evaluate(() => window.__gallery.lab.selectProfile('hay-hauler'));
  await SL.click('#start-btn');
  await SL.waitForFunction(() => window.__gallery.ctx?.state === 'running');
  await SL.evaluate(() => window.__gallery.voice.set({ rpm: 3400, throttle: 0.8, gear: 2, boost: 0.4 }));
  await sleep(700);
  const second = await SL.evaluate(() => ({ id: window.__gallery.lab.currentProfileId(), rms: window.__gallery.probe().rms }));
  record('SL2', 'a second vehicle profile, added through the manifest alone, is pickable and plays (analyser non-silent)', second.id === 'hay-hauler' && second.rms > 0.002, `id ${second.id}, rms ${db(second.rms)} dBFS`);

  const pristine = await SL.evaluate(() => window.__gallery.lab.exportText());
  const pristineProfile = JSON.parse(pristine);
  // Compared like R1/R3 (max difference below -120 dBFS), not by hash: with several layers live, Chromium's input
  // summation order can change the last float32 bit between renders.
  const maxAbsDiff = (a, b) => a.reduce((d, v, i) => Math.max(d, Math.abs(v - b[i])), 0);
  const x0 = await labRender(pristineProfile);
  await SL.evaluate(() => window.__gallery.lab.setParam('firing.level', 2.2));
  await sleep(150);
  const editedText = await SL.evaluate(() => window.__gallery.lab.exportText());
  const x1 = await labRender(JSON.parse(editedText));
  await SL.evaluate(() => window.__gallery.lab.resetParam('firing.level'));
  await sleep(150);
  const resetText = await SL.evaluate(() => window.__gallery.lab.exportText());
  const x2 = await labRender(JSON.parse(resetText));
  const dEdit = maxAbsDiff(x0, x1);
  const dReset = maxAbsDiff(x0, x2);
  record('SL3', 'an edit changes the rendered audio and reset restores it (offline renders within -120 dBFS; the export reflects the edit)', dEdit > 1e-3 && dReset < 1e-6 && JSON.parse(editedText).firing.level === 2.2 && resetText === pristine, `edit max |diff| ${dEdit.toExponential(2)}, reset max |diff| ${dReset.toExponential(2)}`);

  await SL.evaluate(() => window.__gallery.lab.setParam('exhaust.pulseDepth', 0.9));
  await sleep(150);
  const round1 = await SL.evaluate(() => window.__gallery.lab.exportText());
  const round2 = await SL.evaluate((t) => window.__gallery.lab.importText(t) && window.__gallery.lab.exportText(), round1);
  const round3 = await SL.evaluate((t) => window.__gallery.lab.importText(t) && window.__gallery.lab.exportText(), round2);
  record('SL4', 'export then import round-trips byte for byte (and import validates)', round1 === round2 && round2 === round3, round1 === round2 ? 'stable' : 'differs after import');

  const ctxU = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const SU = (await openPage(ctxU, '?profile=hay-hauler&p.firing.level=2&p.gearbox.ratios=4.7,2.9,1.9,1.3,1')).page;
  const urlState = await SU.evaluate(() => {
    const g = window.__gallery.lab;
    return { id: g.currentProfileId(), modified: g.modifiedPaths(), level: g.liveProfile().firing.level, ratios: g.liveProfile().gearbox.ratios.join(','), url: g.url() };
  });
  record('SL5', 'the URL reproduces a tweak (?profile=…&p.…=…), arrays as comma lists', urlState.id === 'hay-hauler' && urlState.modified.includes('firing.level') && urlState.level === 2 && urlState.ratios === '4.7,2.9,1.9,1.3,1' && urlState.url.includes('p.firing.level=2'), JSON.stringify(urlState));
  await ctxU.close();

  await SL.evaluate(() => {
    const g = window.__gallery;
    g.lab.selectProfile('cruz-missile');
  });
  await sleep(150);
  await SL.evaluate(() => window.__gallery.lab.setParam('output.level', 3.2));
  await sleep(150);
  await SL.evaluate(() => window.__gallery.lab.switchSlot(1));
  await sleep(500);
  const ab = await SL.evaluate(() => ({ info: window.__gallery.lab.slotInfo(), rms: window.__gallery.probe().rms, run: window.__gallery.ctx.state }));
  record('SL6', 'A/B switches live to the other slot without stopping playback, level-matched by an offline render', ab.info.live === 1 && ab.info.matched && ab.info.gains.every((g) => Number.isFinite(g) && g > 0) && ab.run === 'running' && ab.rms > 0.002, `live ${ab.info.live}, gains ${ab.info.gains.map((g) => g.toFixed(2)).join('/')}, rms ${db(ab.rms)} dBFS`);

  const search = await SL.evaluate(() => {
    window.__gallery.lab.search('whine');
    const visible = [...document.querySelectorAll('.lab-row')].filter((r) => !r.hidden);
    return { total: document.querySelectorAll('.lab-row').length, visible: visible.length, paths: visible.map((r) => r.dataset.path), texts: visible.map((r) => `${r.dataset.path} ${r.querySelector('.lab-doc')?.textContent ?? ''}`) };
  });
  record('SL7', 'the search box filters controls (whine: every visible row mentions it)', search.visible > 0 && search.visible < search.total && search.texts.every((t) => /whine/i.test(t)), `${search.visible}/${search.total} rows: ${search.paths.join(', ')}`);

  await SL.evaluate(() => window.__gallery.lab.search(''));
  await SL.setViewportSize({ width: 390, height: 844 });
  await sleep(400);
  await SL.screenshot({ path: join(evidence, 'lab-phone.png'), fullPage: true });
  await SL.setViewportSize({ width: 1280, height: 1000 });
  await sleep(400);
  await SL.screenshot({ path: join(evidence, 'lab.png'), fullPage: true });

  // POC1-01 in the lab: the Cruz's boost section reads "not fitted"; fitting one (copied from a car that has one)
  // turns the boost control on and the whine plays; taking it off gives the Cruz back unmodified.
  await SL.evaluate(() => window.__gallery.lab.switchSlot(0));
  await SL.evaluate(() => window.__gallery.lab.selectProfile('cruz-missile'));
  await sleep(250);
  const labBoost = () => SL.evaluate(() => ({
    absent: document.querySelector('.lab-section[data-section="Boost"]')?.dataset.absent,
    fitLabel: document.querySelector('.lab-section[data-section="Boost"] .lab-fit')?.textContent,
    rowDisabled: document.querySelector('.lab-row[data-path="boost.level"] input').disabled,
    slider: document.getElementById('in-boost').disabled,
    has: Boolean(window.__gallery.lab.liveProfile().boost),
    modified: window.__gallery.lab.modifiedPaths(),
    url: window.__gallery.lab.url(),
  }));
  const fit0 = await labBoost();
  const boostSection = SL.locator('.lab-section[data-section="Boost"]');
  await SL.evaluate(() => window.__gallery.lab.search('boost'));
  await boostSection.scrollIntoViewIfNeeded();
  await boostSection.screenshot({ path: join(evidenceC, 'lab-boost-not-fitted.png') });
  await SL.evaluate(() => window.__gallery.lab.toggleSection('boost'));
  await sleep(300);
  await SL.evaluate(() => window.__gallery.voice.set({ ignition: true, rpm: 4000, throttle: 1, gear: 3, boost: 1 }));
  await sleep(400);
  const fit1 = { ...(await labBoost()), meter: await SL.evaluate(() => window.__gallery.voice.levels().boost) };
  await boostSection.screenshot({ path: join(evidenceC, 'lab-boost-fitted.png') });
  await SL.evaluate(() => window.__gallery.lab.search(''));
  await SL.evaluate(() => window.__gallery.lab.toggleSection('boost'));
  await sleep(300);
  const fit2 = { ...(await labBoost()), meter: await SL.evaluate(() => window.__gallery.voice.levels().boost) };
  record('SL8', 'POC1-01 in the lab: the Cruz\'s boost section is not fitted (its controls and the boost slider disabled); fitting a turbo enables them and the whine plays (URL p.boost=fit); taking it off restores the unmodified Cruz',
    fit0.absent === 'true' && fit0.fitLabel === 'Not fitted' && fit0.rowDisabled && fit0.slider && !fit0.has &&
      fit1.absent === 'false' && !fit1.rowDisabled && !fit1.slider && fit1.has && fit1.meter > 0.3 && fit1.url.includes('p.boost=fit') &&
      fit2.absent === 'true' && fit2.slider && !fit2.has && fit2.modified.length === 0 && fit2.meter === 0,
    JSON.stringify({ before: fit0.fitLabel, fittedMeter: fit1.meter?.toFixed(2), fittedUrl: fit1.url, after: fit2.modified }));
  // A/B between two different vehicles (P1-A04b AC3): the Cruz in A, the Hay Hauler in B, one tap apart.
  await SL.evaluate(() => window.__gallery.lab.switchSlot(1));
  await SL.evaluate(() => window.__gallery.lab.selectProfile('hay-hauler'));
  await sleep(200);
  await SL.evaluate(() => window.__gallery.lab.switchSlot(0));
  await sleep(200);
  const slotA = await SL.evaluate(() => ({ id: window.__gallery.lab.liveProfile().id, st: window.__gallery.voice.state() }));
  await SL.locator('#lab-b').click();
  await sleep(500);
  const slotB = await SL.evaluate(() => ({ id: window.__gallery.lab.liveProfile().id, st: window.__gallery.voice.state(), info: window.__gallery.lab.slotInfo(), rms: window.__gallery.probe().rms, run: window.__gallery.ctx.state, pressed: document.getElementById('lab-b').getAttribute('aria-pressed') }));
  const sameState = ['throttle', 'gear', 'surface', 'drift', 'damage', 'ignition'].every((k) => slotA.st[k] === slotB.st[k]);
  record('SL9', 'A/B between two vehicles (Cruz Missile in A, Hay Hauler in B): one tap switches at the same state, level-matched, without stopping playback',
    slotA.id === 'cruz-missile' && slotB.id === 'hay-hauler' && sameState && slotB.pressed === 'true' && slotB.info.live === 1 && slotB.info.matched && Math.abs(slotB.info.gains[1] - slotB.info.ratio) < 1e-9 && slotB.run === 'running' && slotB.rms > 0.002,
    `A ${slotA.id} -> B ${slotB.id}, B gain ${slotB.info.gains[1].toFixed(3)} (loudness ratio ${slotB.info.ratio?.toFixed(3)}, not clamped), rms ${db(slotB.rms)} dBFS`);
  await ctxL.close();

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
// P1-A04c's own checks, with the whole run's tally (the full list stays in P1-A04/checks.json).
const a04c = results.filter((r) => /^(T1|K\d|B4b|B9b|B1[789]|M10|P6|SL8)$/.test(r.id));
writeFileSync(join(evidenceC, 'checks.json'), `${JSON.stringify({ date: info.date, bead: 'P1-A04c', run: { passed: info.passed, total: info.total }, passed: a04c.filter((r) => r.pass).length, total: a04c.length, results: a04c }, null, 2)}\n`);
if (failures.length) {
  console.log(`\nengine synth check: ${failures.length} failure(s)`);
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exit(1);
}
console.log(`\nengine synth check: ok (${results.length} checks)`);
