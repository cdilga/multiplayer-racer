#!/usr/bin/env node
// P1-U05.5 evidence: the shader and lighting POC (R108, POC2-09 to 14).
//   node art/ui/poc/world/capture-looks.mjs            captures: every look at 1, 8 and 24 tiles; the close-up per ink mode, the
//                                                      halftone before/after debug channels; the shimmer frames and metric
//   node art/ui/poc/world/capture-looks.mjs --perf     HEADED on this Mac's GPU (?ts=1): frame cost per look at 1, 8 and 24 tiles,
//                                                      and per lighting/AA/ink option against the recommended set. The screen must
//                                                      be awake and unlocked: a locked or sleeping screen stops the window's frames.
//                                                      --perf --headless measures the same on the same GPU without a window
//   node art/ui/poc/world/capture-looks.mjs --shimmer  only the shimmer frames and metric (merged into report.json)
//   node art/ui/poc/world/capture-looks.mjs --smoke    three states, the recommended look, errors only
// Output: docs/evidence/P1-U05.5/ (JJ_EVIDENCE_DIR overrides): looks/*.jpg, closeup/*.jpg, shimmer/*, report.json, perf.json
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U05.5');
for (const d of ['looks', 'closeup', 'shimmer']) mkdirSync(join(out, d), { recursive: true });
const PERF = process.argv.includes('--perf'), HEADLESS = process.argv.includes('--headless'), SMOKE = process.argv.includes('--smoke'), SHIMMER_ONLY = process.argv.includes('--shimmer');
const ARGS = ['--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const LOOKS = JSON.parse(readFileSync(join(here, 'shaders', 'looks.json'), 'utf8'));
const machine = (() => {
  try { return `${execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string']).toString().trim()} (${execFileSync('sysctl', ['-n', 'hw.model']).toString().trim()}), macOS ${execFileSync('sw_vers', ['-productVersion']).toString().trim()}`; } catch { return 'unknown'; }
})();
const { base, close } = await serveArtUi();
const errors = [], external = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:') && u !== 'about:blank') external.push(u); });
};
const open = async (page, state, params = {}) => {
  await page.goto('about:blank');
  await page.goto(`${base}/poc/world/index.html?${new URLSearchParams({ bar: '0', ...params })}#${state}`);
  await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(500);
};
const file = (state, params) => [state.replace(/&/g, '_').replace(/=/g, ''), ...Object.entries(params).filter(([k]) => k !== 'ts').map(([k, v]) => `${k}-${v}`)].join('__');

if (SMOKE) {
  const browser = await chromium.launch({ channel: 'chromium', args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  watch(page, 'smoke');
  for (const [state, params] of [['tv', {}], ['closeup', {}], ['shimmer', {}], ['grid&n=24', { look: 'burnt-dusk' }]]) {
    await open(page, state, params);
    await page.screenshot({ path: join(out, 'looks', `smoke-${file(state, params)}.jpg`), type: 'jpeg', quality: 85 });
    console.log(state, JSON.stringify(await page.evaluate(() => ({ o: window.__world.options(), k: window.__world.kitStats() }))));
  }
  await browser.close(); await close();
  console.log(errors.length ? errors : 'no errors', external.length ? external : 'no external requests');
  process.exit(errors.length ? 1 : 0);
}

if (PERF) {
  const browser = await chromium.launch({ channel: 'chromium', headless: HEADLESS, args: [...ARGS, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  watch(page, 'perf');
  const rows = [];
  const adapter = await (async () => { await open(page, 'tv'); return page.evaluate(async () => { const ad = await navigator.gpu?.requestAdapter(); return ad ? `${ad.info?.vendor ?? ''} ${ad.info?.architecture ?? ''} ${ad.info?.description ?? ''}`.trim() : 'no WebGPU'; }); })();
  const save = (done) => writeFileSync(join(out, 'perf.json'), `${JSON.stringify({
    format: 'jj.u055-perf.v1',
    what: 'Frame cost of each Mad Max look at 1, 8 and 24 tiles, and of each lighting, AA, ink, road and emissive option against the recommended set (P1-U05.5, POC2-09/10/11)',
    machine, browser: `Chromium ${browser.version()} (Playwright, ${HEADLESS ? 'headless' : 'headed'}, channel chromium)`, backend: `WebGPU (${adapter})`, viewport: '1920x1080',
    method: `GPU execution per frame from WebGPU timestamp queries (renderer trackTimestamp + resolveTimestampsAsync: the shadow pass, the scene pass over every tile and the post chain), 120 frames; rAF interval over 240 frames (${HEADLESS ? "headless: Chromium's own frame clock, not the display's" : 'vsync-bound'})`,
    complete: done, errors, rows,
  }, null, 2)}\n`);
  // Each load compiles the WebGPU pipelines (most of a minute here), so the looks switch live on one loaded page per tile
  // count (__world.setLook: lights, uniforms and sky; the graph only changes for a look with heat shimmer), and only the
  // options, which change the graph, reload.
  const measure = async (group, label, state, params, live = null) => {
    if (live) await page.evaluate((id) => window.__world.setLook(id), live);
    else await open(page, state, { ts: '1', ...params });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => window.__world.perf(240, 120));
    rows.push({ group, label, params, ...r });
    save(false);
    console.log(`${group} | ${label} | ${state}: GPU p50 ${r.gpu_ms_p50} p95 ${r.gpu_ms_p95} ms; rAF p50 ${r.frame_ms_p50} ms; CPU ${r.cpu_submit_ms_mean} ms`);
  };
  for (const state of ['tv', 'grid&n=8', 'grid&n=24']) {
    await open(page, state, { ts: '1' });
    for (const L of LOOKS.looks) await measure('look', L.name, state, { look: L.id }, L.id);
  }
  // Options, one at a time against the recommended set (Fury road; outer ink; PCF 4096; FXAA; haze; textured road + AF16; emissive kit).
  const OPTIONS = [
    ['recommended set', {}],
    ['ink: none', { ink: 'none' }], ['ink: silhouette only', { ink: 'silhouette' }], ['ink: round 0 (everywhere)', { ink: 'full' }],
    ['shadows: PCF soft', { shadow: 'soft' }], ['shadows: VSM', { shadow: 'vsm' }], ['shadows: cascaded x3 2048', { shadow: 'csm' }], ['shadows: off', { shadow: 'off' }],
    ['shadow map 2048', { shadowSize: '2048' }], ['shadow map 8192', { shadowSize: '8192' }],
    ['GTAO (half res)', { ao: '1' }], ['SMAA instead of FXAA', { smaa: '1' }], ['no haze', { haze: '0' }], ['heat shimmer on', { shimmer: '1' }],
    ['no bloom', { bloom: '0' }], ['tone mapping AgX', { tm: 'agx' }], ['tone mapping ACES', { tm: 'aces' }],
    ['road: round 1 geometry lines', { roadtex: '0' }], ['road texture without AF', { af: '1' }], ['emissive kit off', { emissive: '0' }],
  ];
  for (const [label, params] of OPTIONS) await measure('option-1-tile', label, 'tv', params);
  for (const [label, params] of OPTIONS.filter(([l]) => /recommended|ink|shadows: (PCF soft|VSM|off)|shadow map|haze|road|emissive|SMAA/.test(l))) await measure('option-24-tiles', label, 'grid&n=24', params);
  save(true);
  await browser.close(); await close();
  process.exit(errors.length ? 1 : 0);
}

// ---- captures (headless, GPU) ----
const browser = await chromium.launch({ channel: 'chromium', args: ARGS });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
watch(page, 'capture');
const report = SHIMMER_ONLY ? JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) : { format: 'jj.u055-captures.v1', base, machine, browser: `Chromium ${browser.version()} (headless, WebGPU)`, looks: [], closeup: [], halftone: null, shimmer: null, emissive: null };
const shot = async (dir, name, clip) => { await page.screenshot({ path: join(out, dir, `${name}.jpg`), type: 'jpeg', quality: 86, ...(clip ? { clip } : {}) }); return `${dir}/${name}.jpg`; };

const png = (buf) => PNG.sync.read(buf);
if (!SHIMMER_ONLY) {
// POC2-09: every look on the same scene at 1, 8 and 24 tiles (the same cars, cameras and moment: the sim is deterministic from load).
for (const L of LOOKS.looks) for (const state of ['tv', 'grid&n=8', 'grid&n=24']) {
  await open(page, state, { look: L.id });
  report.looks.push({ look: L.id, state, file: await shot('looks', `${L.id}__${state.replace(/&/g, '_').replace(/=/g, '')}`), options: await page.evaluate(() => window.__world.options()) });
}

// POC2-10 / 13 / 14: the close-up (front three-quarter: the car's shaded flank and its cast shadow; rear: brake lamps and boost
// flame), per ink mode, plus round 1's halftone-on-the-car for the before.
for (const [tag, params] of [['outer', {}], ['silhouette', { ink: 'silhouette' }], ['full', { ink: 'full' }], ['none', { ink: 'none' }], ['round1-halftone-on-car', { htcar: '1', ink: 'full', look: 'round1' }], ['round1-look', { look: 'round1' }], ['burnt-dusk', { look: 'burnt-dusk' }]]) {
  await open(page, 'closeup', params);
  report.closeup.push({ tag, params, file: await shot('closeup', tag) });
}

// POC2-13 measured: the halftone channel against the dynamic-object mask on the close-up. Overlap = halftone dots drawn on a car.
const channel = async (params) => { await open(page, 'closeup', { grain: '0', ...params }); return png(await page.screenshot({ type: 'png' })); };
const overlap = (ht, dyn) => {
  let dots = 0, onCar = 0, car = 0;
  for (let i = 0; i < ht.data.length; i += 4) {
    const d = ht.data[i] > 40, c = dyn.data[i] > 128;
    if (d) dots++; if (c) car++; if (d && c) onCar++;
  }
  return { halftonePx: dots, carPx: car, halftoneOnCarPx: onCar, share: +(onCar / Math.max(1, car)).toFixed(4) };
};
{
  const dyn = await channel({ debug: 'dynamic' });
  const before = overlap(await channel({ debug: 'halftone', htcar: '1' }), dyn);
  const after = overlap(await channel({ debug: 'halftone' }), dyn);
  for (const [t, p] of [['debug-halftone-before', { debug: 'halftone', htcar: '1' }], ['debug-halftone-after', { debug: 'halftone' }], ['debug-dynamic', { debug: 'dynamic' }]]) { await open(page, 'closeup', p); await shot('closeup', t); }
  report.halftone = { what: 'Close-up, both views: pixels where the halftone pass draws dots (debug=halftone > 40/255) that are also car pixels (debug=dynamic, the objectId .g mask)', before, after, pass: after.halftoneOnCarPx === 0 && before.halftoneOnCarPx > 0 && after.halftonePx > 0 };
  console.log('halftone on car: before', before.halftoneOnCarPx, 'px, after', after.halftoneOnCarPx, 'px; dots elsewhere', after.halftonePx);
}

// POC2-14: the emissive kit's counts in the live scene.
await open(page, 'grid&n=8');
report.emissive = await page.evaluate(() => window.__world.kitStats());
}

// POC2-12: line shimmer. The #shimmer camera crawls down the start straight at the chase framing in 4 cm steps, with the sim
// clock stopped. Shimmer is aliasing: a line or edge thinner than a pixel breaks up and re-forms as it moves. So every frame
// is compared with the same frame rendered at S times the pixels and averaged SxS down (a supersampled reference, the same
// effect tier through &tierH): alias(t) = frame(t) - reference(t). Smooth motion of real detail moves both alike; aliasing is
// where they disagree, and it shimmers when that disagreement jumps between frames. error = mean |alias|, flicker = mean
// |alias(t+1) - alias(t)| (RGB, 0-255), per region of the lower 60% of the frame, from the projected road ribbon
// (__world.roadPolygon): `kerbs` (7.0-8.3 m from the centre line), `lines` (the cream edge lines, 6.3-6.75 m), `dirt` (the
// road inside them), which the road texture and its filtering change; and `geometry` = everything else there (guard rails,
// posts, signs, props), whose edges only anti-aliasing changes. Two scales:
//   grid-tile: one 24-tile grid tile (320x256, tier S, no FXAA and no bloom, as the 24-tile grid presents), reference 4x4
//   tv:        the full-screen tile (1920x1080, FXAA), reference 2x2
// Ink, halftone and grain are off: they are screen-space and resolution-dependent, so the reference could not match them;
// the road, kerb and rail edges are what is measured.
const FRAMES = 24, STEP = 0.1; // 2.4 m: most of a red-white kerb period (2 x 2.9 m)
const SCALES = [['grid-tile', 320, 256, 4, { fxaa: '0', bloom: '0' }], ['tv', 1920, 1080, 2, {}]];
const variants = [['round1-lines', { roadtex: '0' }], ['texture-no-af', { af: '1' }], ['texture-af16', {}], ['texture-af16-smaa', { smaa: '1' }]];
const shimmer = { what: `#shimmer camera (the chase 'mid' framing, no cars, sim clock stopped), ${FRAMES} frames ${STEP * 100} cm apart, each also rendered at S times the pixels as the reference. error = mean |frame - reference averaged SxS|; flicker = mean |alias(t+1) - alias(t)|; RGB 0-255; rows 40-100% of the frame, split by the projected road ribbon into kerbs, lines, dirt and geometry (everything else)`, off: ['ink', 'halftone', 'grain'], scales: {} };
// Even-odd scanline fill of a screen polygon into a W x H mask.
const fillPolygon = (poly, W, H) => {
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > yc) !== (yj > yc)) xs.push(xi + ((yc - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(W, Math.floor(xs[k + 1] + 0.5)); x++) mask[y * W + x] = 1;
  }
  return mask;
};
for (const [scale, W, H, S, extra] of SCALES) {
  const small = await browser.newPage({ viewport: { width: W, height: H } }), big = await browser.newPage({ viewport: { width: W * S, height: H * S } });
  watch(small, `shimmer-${scale}`); watch(big, `shimmer-${scale}-ref`);
  const rows = [];
  for (const [tag, params] of variants) {
    const q = { grain: '0', halftone: '0', ink: 'none', tierH: String(H), ...extra, ...params };
    await open(small, 'shimmer', q); await open(big, 'shimmer', q);
    let prev = null, region = null;
    const NAMES = ['geometry', 'dirt', 'lines', 'kerbs'], acc = Object.fromEntries(NAMES.map((k) => [k, { err: 0, flick: 0, n: 0, nf: 0 }]));
    const heat = new Float32Array(W * H), y0 = Math.floor(H * 0.4);
    for (let k = 0; k < FRAMES; k++) {
      const m = 20 + k * STEP;
      await small.evaluate((x) => window.__world.shimmerAt(x), m); await big.evaluate((x) => window.__world.shimmerAt(x), m);
      const f = png(await small.screenshot({ type: 'png' })), g = png(await big.screenshot({ type: 'png' }));
      if (k === FRAMES >> 1) { await small.screenshot({ path: join(out, 'shimmer', `${scale}-${tag}-frame.jpg`), type: 'jpeg', quality: 90 }); }
      // the road moves under the camera, so the bands are re-projected every frame
      const band = async (m) => fillPolygon(await small.evaluate((h) => window.__world.roadPolygon(h), m), W, H);
      const [b63, b675, b70, b83] = [await band(6.3), await band(6.75), await band(7.0), await band(8.3)];
      region = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) region[i] = b63[i] ? 1 : b675[i] ? 2 : b70[i] ? 1 : b83[i] ? 3 : 0; // 1 dirt, 2 lines, 3 kerbs (the strip between line and kerb counts as dirt)
      const alias = new Float32Array(W * H * 3);
      for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
        let ref = 0;
        for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) ref += g.data[((y * S + dy) * W * S + x * S + dx) * 4 + c];
        alias[(y * W + x) * 3 + c] = f.data[(y * W + x) * 4 + c] - ref / (S * S);
      }
      for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 3, r = acc[NAMES[region[y * W + x]]];
        r.err += (Math.abs(alias[o]) + Math.abs(alias[o + 1]) + Math.abs(alias[o + 2])) / 3; r.n++;
        if (prev) { const d = (Math.abs(alias[o] - prev[o]) + Math.abs(alias[o + 1] - prev[o + 1]) + Math.abs(alias[o + 2] - prev[o + 2])) / 3; r.flick += d; r.nf++; heat[y * W + x] += d; }
      }
      prev = alias;
    }
    const D = W > 1000 ? 2 : 1, map = new PNG({ width: W / D, height: H / D }); // full-screen heat maps at half size (the evidence stays small)
    for (let y = 0; y < H / D; y++) for (let x = 0; x < W / D; x++) {
      let v = 0; for (let dy = 0; dy < D; dy++) for (let dx = 0; dx < D; dx++) v = Math.max(v, heat[(y * D + dy) * W + x * D + dx]);
      v = Math.min(255, (v / (FRAMES - 1)) * 4);
      map.data.set([v, v * 0.55, region[y * D * W + x * D] ? 90 : 30, 255], (y * (W / D) + x) * 4); // the road ribbon is tinted blue
    }
    writeFileSync(join(out, 'shimmer', `${scale}-${tag}-heat.png`), PNG.sync.write(map));
    const row = { tag, params: q };
    for (const [k, r] of Object.entries(acc)) row[k] = { error: +(r.err / r.n).toFixed(3), flicker: +(r.flick / Math.max(1, r.nf)).toFixed(3), px: Math.round(r.n / FRAMES) };
    rows.push(row);
    console.log(`shimmer ${scale} ${tag}: ${NAMES.map((k) => `${k} ${row[k].error}/${row[k].flicker}`).join(', ')}`);
  }
  await small.close(); await big.close();
  const v0 = rows.find((v) => v.tag === 'round1-lines'), v1 = rows.find((v) => v.tag === 'texture-af16');
  const vs = rows.find((v) => v.tag === 'texture-af16-smaa');
  const cut = (a, b, k, m) => +(1 - b[k][m] / a[k][m]).toFixed(3);
  shimmer.scales[scale] = { viewport: `${W}x${H}`, reference: `${W * S}x${H * S} averaged ${S}x${S}`, presented: extra, variants: rows,
    reduction: { ...Object.fromEntries(['kerbs', 'lines', 'dirt'].map((k) => [k, { flicker: cut(v0, v1, k, 'flicker'), error: cut(v0, v1, k, 'error') }])), geometryWithSmaa: { flicker: cut(v1, vs, 'geometry', 'flicker'), error: cut(v1, vs, 'geometry', 'error') } } };
}
report.shimmer = shimmer;

await browser.close(); await close();
report.errors = errors; report.external = external;
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`looks ${report.looks.length}, close-ups ${report.closeup.length}; kit ${JSON.stringify(report.emissive)}; shimmer ${JSON.stringify(Object.fromEntries(Object.entries(shimmer.scales).map(([k, v]) => [k, v.reduction])))}; errors ${errors.length}; external ${external.length}`);
process.exit(errors.length || external.length ? 1 : 0);
