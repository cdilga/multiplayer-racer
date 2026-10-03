#!/usr/bin/env node
// P1-U05 motion reel recorder: plays the live reel (index.html) in Chromium on this Mac's GPU and writes the evidence.
//   node art/ui/poc/motion/record.mjs                 videos (full + reduced), stills (both), timeline.json, README.md, local-receipt.txt
//   node art/ui/poc/motion/record.mjs --stills-only   skip the videos (stills pass only)
//   node art/ui/poc/motion/record.mjs --video-only    skip the stills pass
// Output: docs/evidence/P1-U05/motion/ (reel.webm, reel-reduced.webm, stills/*.jpg, timeline.json, README.md, local-receipt.txt).
// The expected durations are recomputed here from art/ui/tokens.json, independently of the page, and compared with the
// durations the page measured on its own clock (performance.now) while playing.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const out = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs', 'evidence', 'P1-U05', 'motion');
const stills = join(out, 'stills');
const args = process.argv.slice(2);
const DO_VIDEO = !args.includes('--stills-only');
const DO_STILLS = !args.includes('--video-only');
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const FRAME_MS = 1000 / 60;
const TOL_MS = 50; // pass if within +-50 ms or one frame at 60 Hz, whichever is larger
const tokens = JSON.parse(readFileSync(join(repo, 'art', 'ui', 'tokens.json'), 'utf8')).motion;

const log = [];
const say = (s = '') => { console.log(s); log.push(s); };

// ------------------------------------------------------------------------------------------------ expected durations
function expected(entry, reduced) {
  const n = (name) => tokens.named[name];
  const pick = (name, key) => (reduced && n(name).reduced?.[key] !== undefined ? n(name).reduced[key] : n(name)[key]);
  switch (entry.name) {
    case 'countdown-beat': return pick('countdown-beat', 'durationMs');
    case 'reflow': return pick('reflow', 'durationMs');
    case 'sticker-in': return pick('sticker-in', 'durationMs');
    case 'identify-pulse': return pick('identify-pulse', 'durationMs') * (pick('identify-pulse', 'repeat') ?? 1);
    case 'wreck-shake': return pick('wreck-shake', 'durationMs');
    case 'back-in-ticks': return 3 * tokens.durationsMs.countdownBeat;
    case 'respawn-cut': return 0;
    case 'phase-change': return tokens.durationsMs.fast + pick('toast', 'durationMs');
    case 'results-reveal': return pick('results-reveal', 'durationMs');
    default: throw new Error(`no expectation for ${entry.name}`);
  }
}
const STEP_NAMES = { a: 'countdown', b: 'join', c: 'identify', d: 'wreck + respawn', e: 'phase changes', f: 'results reveal' };

// Where the expected value lives in tokens.json (the reduced variants sit under .reduced).
function tokenPath(name, reduced) {
  const r = reduced ? '.reduced' : '';
  const named = (n, extra = '') => `motion.named.${n}${r}.durationMs${extra}`;
  switch (name) {
    case 'identify-pulse': return named(name, ' x repeat');
    case 'phase-change': return `motion.durationsMs.fast + motion.named.toast${r}.durationMs`;
    case 'back-in-ticks': return '3 x motion.durationsMs.countdownBeat';
    case 'respawn-cut': return 'a cut (0 ms)';
    default: return named(name);
  }
}

function judge(timeline, reduced) {
  const rows = timeline.map((e) => {
    const exp = expected(e, reduced);
    const delta = e.measuredMs - exp;
    const pass = Math.abs(delta) <= Math.max(TOL_MS, FRAME_MS) && e.tokenMs === exp && e.reduced === reduced;
    const row = { seq: e.seq, step: e.step, stepName: STEP_NAMES[e.step], name: e.name, label: (e.label ?? e.name) + (e.step === 'e' && e.name === 'countdown-beat' ? (e.phase ? ' (countdown to race)' : ' (countdown phase)') : ''), tokenPath: tokenPath(e.name, reduced), tokenMs: exp, pageTokenMs: e.tokenMs, measuredMs: e.measuredMs, deltaMs: +delta.toFixed(2), frames: e.frames, fps: e.measuredMs > 0 ? +((e.frames / e.measuredMs) * 1000).toFixed(0) : null, startMs: e.startMs, endMs: e.endMs, pass };
    for (const k of ['periodMs', 'cycleMs', 'exitMs', 'enterMs', 'cardMs', 'staggerMs', 'phase', 'timeSinceWreckMs']) if (e[k] !== undefined) row[k] = e[k];
    if (e.name === 'countdown-beat' && e.periodMs != null) { row.periodDeltaMs = +(e.periodMs - exp).toFixed(2); row.pass = row.pass && Math.abs(row.periodDeltaMs) <= Math.max(TOL_MS, FRAME_MS); }
    if (e.name === 'identify-pulse') { const per = tokens.named['identify-pulse'].durationMs; row.cycleDeltaMs = e.cycleMs.map((c) => +(c - per).toFixed(2)); row.pass = row.pass && e.cycleMs.every((c) => Math.abs(c - per) <= Math.max(TOL_MS, FRAME_MS)); }
    return row;
  });
  return { rows, passed: rows.filter((r) => r.pass).length, total: rows.length, allPass: rows.every((r) => r.pass) };
}

// ------------------------------------------------------------------------------------------------ machine
const machine = (() => {
  try {
    const model = execFileSync('sysctl', ['-n', 'hw.model']).toString().trim();
    const cpu = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string']).toString().trim();
    const os = execFileSync('sw_vers', ['-productVersion']).toString().trim();
    return `${cpu} (${model}), macOS ${os}`;
  } catch { return 'unknown'; }
})();

const { base, close } = await serveArtUi();
mkdirSync(out, { recursive: true });
mkdirSync(stills, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: GPU_ARGS });
const browserLabel = `Chromium ${browser.version()} (Playwright ${JSON.parse(readFileSync(join(repo, 'node_modules', 'playwright', 'package.json'), 'utf8')).version}, channel chromium, headless, --use-angle=metal)`;
say(`$ node art/ui/poc/motion/record.mjs ${args.join(' ')}`.trim());
say(`machine: ${machine}`);
say(`browser: ${browserLabel}`);
say(`tolerance: +-${TOL_MS} ms or one frame at 60 Hz (${FRAME_MS.toFixed(1)} ms), whichever is larger`);

async function openReel(context, mode) {
  const page = await context.newPage();
  page.on('pageerror', (e) => say(`PAGE ERROR (${mode}): ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') say(`console ${m.type()} (${mode}): ${m.text()}`); });
  const external = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  await page.goto(`${base}/poc/motion/index.html?reduced=${mode === 'reduced' ? 1 : 0}`);
  await page.waitForFunction(() => window.__reel?.ready === true, null, { timeout: 30000 });
  return { page, external };
}

// ------------------------------------------------------------------------------------------------ reduced-motion switches
// The three ways to ask for reduced motion: ?reduced=1, the on-screen switch, and the OS setting (prefers-reduced-motion).
const controls = [];
{
  const open = async (opts, query) => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, ...opts });
    const page = await ctx.newPage();
    await page.goto(`${base}/poc/motion/index.html${query}`);
    await page.waitForFunction(() => window.__reel?.ready === true, null, { timeout: 30000 });
    return { ctx, page };
  };
  const check = (what, got, want) => { controls.push({ what, got, want, pass: got === want }); say(`  ${got === want ? 'ok  ' : 'FAIL'} ${what}: ${got}`); };
  say('');
  say('== reduced-motion switches');
  let t = await open({}, '');
  check('default (no flag, OS prefers full motion): reduced', await t.page.evaluate(() => window.__reel.reduced), false);
  await t.page.click('#rswitch button[data-m="reduced"]');
  check('on-screen switch -> Reduced: reduced', await t.page.evaluate(() => window.__reel.reduced), true);
  check('on-screen switch shows Reduced as the active option', await t.page.evaluate(() => document.querySelector('#rswitch button.on').dataset.m), 'reduced');
  await t.page.click('#rswitch button[data-m="full"]');
  check('on-screen switch -> Full: reduced', await t.page.evaluate(() => window.__reel.reduced), false);
  await t.ctx.close();
  t = await open({}, '?reduced=1');
  check('?reduced=1: reduced', await t.page.evaluate(() => window.__reel.reduced), true);
  await t.ctx.close();
  t = await open({ reducedMotion: 'reduce' }, '');
  check('OS prefers-reduced-motion: reduce: reduced', await t.page.evaluate(() => window.__reel.reduced), true);
  await t.ctx.close();
  t = await open({ reducedMotion: 'reduce' }, '?reduced=0');
  check('OS reduce but ?reduced=0 (explicit override): reduced', await t.page.evaluate(() => window.__reel.reduced), false);
  await t.ctx.close();
  t = await open({}, '?autoplay=1');
  await t.page.waitForFunction(() => window.__reel.playing === true, null, { timeout: 10000 });
  check('?autoplay=1 starts the reel: playing', await t.page.evaluate(() => window.__reel.playing), true);
  await t.ctx.close();
}

const results = {};
let stageDims = { sw: 1749, sh: 984 };
const dirOf = (mode) => join(out, `.tmp-${mode}`);

// ------------------------------------------------------------------------------------------------ videos
if (DO_VIDEO) {
  for (const mode of ['full', 'reduced']) {
    const dir = dirOf(mode);
    rmSync(dir, { recursive: true, force: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: 1920, height: 1080 } } });
    const { page, external } = await openReel(context, mode);
    const backend = await page.evaluate(() => window.__reel.backend);
    stageDims = await page.evaluate(() => ({ sw: window.__reel.stage.sw, sh: window.__reel.stage.sh }));
    const warnings = await page.evaluate(() => window.__reel.warnings);
    const reducedFlag = await page.evaluate(() => window.__reel.reduced);
    if (reducedFlag !== (mode === 'reduced')) throw new Error(`reduced flag ${reducedFlag} for mode ${mode}`);
    await page.waitForTimeout(1200); // a beat of the idle grid at the head of the video
    const t0 = Date.now();
    const timeline = await page.evaluate(() => window.__reel.playAll());
    const wall = Date.now() - t0;
    await page.waitForTimeout(800);
    const video = page.video();
    await context.close();
    const file = join(out, mode === 'reduced' ? 'reel-reduced.webm' : 'reel.webm');
    await video.saveAs(file);
    rmSync(dir, { recursive: true, force: true });
    const j = judge(timeline, mode === 'reduced');
    results[mode] = { ...j, wallMs: wall, backend, warnings, external, videoBytes: statSync(file).size, videoFile: file };
    say('');
    say(`== ${mode} motion: ${j.passed}/${j.total} within tolerance; reel wall time ${(wall / 1000).toFixed(1)} s; video ${(results[mode].videoBytes / 1e6).toFixed(2)} MB; backend ${backend}`);
    if (warnings.length) say(`token warnings: ${warnings.join(' | ')}`);
    if (external.length) say(`EXTERNAL REQUESTS: ${external.join(', ')}`);
    for (const r of j.rows) say(`  ${r.step} ${r.label.padEnd(28)} token ${String(r.tokenMs).padStart(5)}  measured ${r.measuredMs.toFixed(1).padStart(7)}  delta ${r.deltaMs.toFixed(1).padStart(6)}  ${r.pass ? 'pass' : 'FAIL'}`);
  }
}

// ------------------------------------------------------------------------------------------------ stills
const stillNames = { full: [], reduced: [] };
if (DO_STILLS) {
  for (const f of readdirSync(stills)) if (f.endsWith('.jpg')) rmSync(join(stills, f));
  for (const mode of ['full', 'reduced']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    let n = 0;
    await page.exposeFunction('__reelShot', async (name) => {
      const file = `${mode === 'reduced' ? 'reduced' : 'full'}-${name}.jpg`;
      await page.screenshot({ path: join(stills, file), type: 'jpeg', quality: 86 });
      stillNames[mode].push(file);
      n++;
    });
    page.on('pageerror', (e) => say(`PAGE ERROR (stills ${mode}): ${e.message}`));
    await page.goto(`${base}/poc/motion/index.html?reduced=${mode === 'reduced' ? 1 : 0}`);
    await page.waitForFunction(() => window.__reel?.ready === true, null, { timeout: 30000 });
    const timeline = await page.evaluate(() => window.__reel.playAll());
    const j = judge(timeline, mode === 'reduced');
    say('');
    say(`== stills pass (${mode}): ${n} stills; reel clock paused around each shot; ${j.passed}/${j.total} within tolerance`);
    results[`stills-${mode}`] = { passed: j.passed, total: j.total, allPass: j.allPass };
    await context.close();
  }
}
await browser.close();
await close();

// ------------------------------------------------------------------------------------------------ timeline.json + README + receipt
const mb = (b) => `${(b / 1e6).toFixed(2)} MB`;
const timelineJson = {
  what: 'P1-U05 motion reel: durations the live reel measured on its own clock (performance.now) versus art/ui/tokens.json (tokens.motion), recomputed independently here',
  generated: new Date().toISOString(),
  machine,
  browser: browserLabel,
  backend: results.full?.backend ?? results.reduced?.backend,
  viewport: `1920x1080 @1x; the 16:9 TV stage is ${stageDims.sw}x${stageDims.sh} under a 96 px annotation bar`,
  tolerance: { ms: TOL_MS, frameMs60Hz: +FRAME_MS.toFixed(2), rule: 'pass if |measured - token| <= max(50 ms, one frame at 60 Hz)' },
  method: 'Each motion is a tween on one rAF clock: start = first frame it is applied, end = first frame at or after start + duration, so a measurement carries up to one frame of quantisation. The headless recording runs at the display refresh (about 120 Hz on this Mac), so one frame is about 8 ms here.',
  modes: Object.fromEntries(Object.entries(results).filter(([k]) => !k.startsWith('stills-')).map(([k, v]) => [k, { reduced: k === 'reduced', passed: v.passed, total: v.total, allPass: v.allPass, wallMs: v.wallMs, videoBytes: v.videoBytes, externalRequests: v.external, tokenWarnings: v.warnings, rows: v.rows }])),
  stillsPasses: Object.fromEntries(Object.entries(results).filter(([k]) => k.startsWith('stills-')).map(([k, v]) => [k, v])),
  stills: stillNames,
  reducedMotionSwitches: controls,
};
writeFileSync(join(out, 'timeline.json'), `${JSON.stringify(timelineJson, null, 2)}\n`);

const table = (mode) => {
  const r = results[mode];
  if (!r) return '_not recorded in this run_\n';
  const head = '| Step | Motion | Token source | Token (ms) | Measured (ms) | Delta (ms) | Result |\n|---|---|---|---:|---:|---:|---|\n';
  return head + r.rows.map((x) => `| ${x.step} ${x.stepName} | ${x.label} | \`${x.tokenPath}\` | ${x.tokenMs} | ${x.measuredMs.toFixed(1)} | ${x.deltaMs >= 0 ? '+' : ''}${x.deltaMs.toFixed(1)} | ${x.pass ? 'pass' : '**FAIL**'} |`).join('\n') + '\n';
};
const sizes = ['reel.webm', 'reel-reduced.webm'].filter((f) => { try { statSync(join(out, f)); return true; } catch { return false; } }).map((f) => `${f} ${mb(statSync(join(out, f)).size)}`).join(', ');

const readme = `# P1-U05 motion reel (evidence)

The live reel is \`art/ui/poc/motion/index.html\` (serve \`node art/ui/lib/serve.mjs\`, open \`/poc/motion/\`). It is built on U02's TV mocks
(\`../tv/world.js\`, \`../tv/grid.js\`, \`../shared/tokens.js\`, \`../tv/tv.css\`), so every timing is real, not a video edit. Every duration, easing,
repeat and stagger is read from \`art/ui/tokens.json\` (\`tokens.motion\`) at runtime; the full and reduced variants come from each named motion's
\`reduced\` entry. \`?reduced=1\` (or the on-screen Full / Reduced switch, or the OS \`prefers-reduced-motion\` setting) plays the reduced variants; \`?autoplay=1\`
plays the reel on load; keys: P play, 1-6 one transition, R toggle reduced. A script drives it with \`window.__reel = { ready, play(name), playAll(), timeline }\`.

Recorded by \`art/ui/poc/motion/record.mjs\` on ${machine}, ${browserLabel}, GPU backend ${results.full?.backend ?? results.reduced?.backend ?? 'n/a'}.
Videos: ${sizes}. Stills (${stillNames.full.length} full, ${stillNames.reduced.length} reduced): \`stills/\`. Raw numbers: \`timeline.json\`. Commands and output: \`local-receipt.txt\`.
A 16:9 TV stage (${stageDims.sw}x${stageDims.sh}, so TV px are scaled by ${(stageDims.sh / 1080).toFixed(3)}) sits under a 96 px annotation bar that names each transition, its token duration and the durations just measured;
the bar is reel furniture, not TV UI.

## What plays (in order)

| Step | Transition | What you see | Reduced version |
|---|---|---|---|
| a | Countdown (countdown-beat) | 3, 2, 1, GO as one full-screen overlay (R99), one beat (1000 ms) each: each number punches in (scale 1.4 to 1) and fades while a high-exposure flash attacks and decays behind it; cars hold on the grid until GO | The wash holds steady; numbers swap on the beat, no scale or fade |
| b | Join (sticker-in + reflow) | #6 joins a five-tile race: its tile scales 0.6 to 1 with overshoot (HUD cluster settles 4 degrees) while the second row re-divides from 3+2 to 3+3 tiles with the standard easing | Tile fades in over 120 ms (no scale); tiles cut to their new cells (0 ms) |
| c | Identify (identify-pulse) | On the pre-race grid (cars side by side), 3 x 500 ms: "Cooee #6" over a transparent high-exposure flash in #6's colour (R99; fast attack, decaying over the pulse), its tile border thickens and its badge scales up, and the car outlined in every tile it is on screen in (U02's \`setOutlines\`, drawn as a bright rim). The shared reference for the TV and the controller | The wash holds steady, border and badge step on and off (no scale), the label shows without scale, outline shows |
| d | Wreck and respawn (wreck-shake) | WRECKED! sticker and a 300 ms shake on #6's tile only, "Back in 3, 2, 1", then the respawn cuts (the car's slot is rebuilt and its chase camera starts on it, so there is no swoop) | No shake (0 ms), WRECKED! fades in, same 3 s count, same cut |
| e | Phase changes | race to lobby, lobby to countdown (3, 2, 1, GO again), countdown to race (the GO beat), race to results. Chrome exits over \`fast\` (120 ms), then the new chrome enters as a toast (200 ms, 16 px slide + fade) | Exit 120 ms, enter fades only (120 ms, no slide) |
| f | Results reveal (results-reveal) | The three podium cards drop in from the top, staggered 150 ms, 900 ms each (1200 ms total), sticker easing | Cards fade in together over 200 ms |

Between transitions the reel cuts to the state the next one needs: (c) Identify cuts to a fresh pre-race grid (cars side by side, frozen), and (d) starts the race from that grid without a countdown beat.
Re-run with \`node art/ui/poc/motion/record.mjs\` (about 3 minutes; \`--stills-only\` or \`--video-only\` to skip a pass).
Pacing between transitions (lead-ins, holds) uses \`durationsMs.reveal\`, \`countdownBeat\` and \`podium\`, so even the gaps come from tokens.

## Measured against the tokens, full motion

${results.full ? `${results.full.passed}/${results.full.total} within tolerance.` : ''}

${table('full')}
## Measured against the tokens, reduced motion

${results.reduced ? `${results.reduced.passed}/${results.reduced.total} within tolerance.` : ''}

${table('reduced')}
Tolerance: pass if within +-${TOL_MS} ms or one frame at 60 Hz (${FRAME_MS.toFixed(1)} ms), whichever is larger. Method: each motion is a tween on one rAF clock;
start is the first frame it is applied and end the first frame at or after start + duration, so a reading carries up to one frame of quantisation (this Mac's
headless Chromium runs rAF at about 120 Hz). Countdown beats also pass on beat-to-beat period; the Identify pulse also passes on each 500 ms cycle (see \`timeline.json\`).
\`tokens.json\` is read twice: by the page (to drive the motion) and by \`record.mjs\` (to recompute the expected value), and the two must agree.

## Reduced-motion switches (checked by record.mjs)

${controls.map((c) => `- ${c.pass ? 'ok' : '**FAIL**'}: ${c.what} = ${c.got}`).join('\n')}

## Known gaps and what U02/U01 could change

- **Hook for U02:** \`../tv/main.js\` is a page, not a module (no exports), so the tile, lobby and results markup is rebuilt in \`reel.js\` with U02's class names. Exporting
  \`gridScene\`, \`seatInfo\` and the lobby / results builders (behind a guard so importing does not start the page) would remove that duplication. The world also has no
  per-seat wreck / respawn call; the reel cuts the respawn by rebuilding the last seat's car slot (\`setCars(n-1)\` then \`setCars(n)\`), which puts the car back on the grid with a
  fresh chase camera. A \`world.respawn(seat)\` that resets the camera would let any seat respawn where it crashed.
- **Token gaps (U01):** the 150 ms stagger, the 0.6 to 1 and 1.4 to 1 scales, the 4 degree settle and the 16 px slide only exist in the \`does\` prose, so \`reel.js\` parses them
  (and records a warning if the wording changes). Sub-timings that tokens do not give are composed from \`durationsMs\`: the countdown punch-in is \`base\`, its fade is \`slow\`,
  the "Back in" ticks are \`countdownBeat\`, the phase exit is \`fast\`, and the phase enter is the \`toast\` motion.
- **Identify outline:** U02's \`setOutlines\` draws an inverted hull in the seat colour, which on a car painted that colour is a faint fringe. The reel wraps \`renderer.render\` to find the (private) hull group and lighten and thicken it (a \`setOutlines(seats, { tint, scale })\` option would replace that wrapper). The cut to a pre-race grid for (c) exists because late joiners and respawned cars start behind the pack, where no other tile's camera looks.
- **Seat colour 7 is ink:** its tile ring is ink on the ink gutters and its outline hull is ink, so the Identify pulse and outline are nearly invisible for #7 (and #19, #31...). The reel identifies #6 (pink) for that reason; U01/U02 should decide how seat 7 (and every 12th seat after it) reads on the gutters.
- **Sticker-in on a GL tile:** the 3D viewport scales with overshoot but cannot rotate, so the 4 degree settle is applied to the HUD cluster only.
- **Toast** (a named motion) is used as the phase-change enter; U02 has no standalone toast component, so none is shown on its own.
- **Controller flash:** the Identify motion also flashes the controller; the TV reel cannot show the phone.
- **Video:** Playwright records VP8 at its fixed bitrate and 25 fps, so fine detail softens; the stills are the sharp reference.
`;
writeFileSync(join(out, 'README.md'), readme);

const ls = (dir) => readdirSync(dir).sort().map((f) => `${statSync(join(dir, f)).size.toString().padStart(9)}  ${f}`).join('\n');
say('');
say('files:');
say(ls(out));
say('stills:');
say(ls(stills));
writeFileSync(join(out, 'local-receipt.txt'), `${log.join('\n')}\n`);
const bad = [...Object.values(results).filter((r) => r.allPass === false), ...controls.filter((c) => !c.pass)];
console.log(bad.length ? 'SOME MOTIONS OUT OF TOLERANCE' : 'all motions within tolerance');
process.exit(bad.length ? 1 : 0);
