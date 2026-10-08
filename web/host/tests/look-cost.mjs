// P1-R10 / P1-R12 frame-cost delta at 24 tiles, HEADED on this machine's GPU (never SwiftShader numbers). The renderer bench
// (host/?bench: 24 Cruz Missiles x 24 chase tiles, each frame waited to GPU completion) with the look and effects on, against
// the same page with them off (`&look=plain`: plain materials, no ink hulls, no particles). Interleaved, repeated, so
// drift between runs shows. The bar (P1-R10): the 24-tile scene pass within U05's measurement + 20 %
// (art/ui/accepted/2026-10-07/poc/world/README.md: 12.4 ms GPU at 1080p, 24 tiles, WebGPU M1 Pro, timestamp queries).
//   npm --prefix web run build && node web/host/tests/look-cost.mjs [--fx] [--channel chrome] [--repeats 3] [--out docs/evidence/P1-R10/cost.json]
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const channel = arg('--channel', 'chrome');
const out = resolve(repo, arg('--out', 'docs/evidence/P1-R10/cost.json'));
const repeats = Number(arg('--repeats', 3));
const server = await serve(join(repo, 'web/dist'));
const browser = await chromium.launch({ headless: false, channel: channel === 'chromium' ? undefined : channel });

async function measure(query, w, h) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${server.url}/host/?bench${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.jjHost === 'bench');
  const r = await page.evaluate((o) => window.__bench.run(o), { backend: 'webgl', n: 24, lod: 1, shadows: true, w, h, frames: 120 });
  await page.close();
  return r;
}

// `--fx` (P1-R12): the effects' own cost. The synthetic field with the effects demo (every family firing across 24 cars) on
// 24 chase tiles over the greybox, the look on, effects on vs `&fx=off`; each frame drawn synchronously and waited to GPU
// completion with a 1-pixel readback (the rAF interval is vsync-bound, so it can't show a delta under the refresh).
if (process.argv.includes('--fx')) {
  const fxOut = resolve(repo, arg('--out', 'docs/evidence/P1-R12/cost.json'));
  const fxRows = [];
  async function fxMeasure(query, w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(`${server.url}/host/?synthetic=24&map&fxdemo&tiles=24&res=1&autores=off${query}`);
    await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) > 90, null, { timeout: 60_000 });
    const r = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const px = new Uint8Array(4);
      const t = [];
      for (let i = 0; i < 130; i++) {
        const t0 = performance.now();
        window.__jjRender.frame();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (i >= 10) t.push(performance.now() - t0);
      }
      t.sort((a, b) => a - b);
      const fx = window.__jjRender.vehicles()?.fx;
      return { ms_median: +t[t.length >> 1].toFixed(2), ms_p90: +t[Math.floor(t.length * 0.9)].toFixed(2), draws: window.__jjRender.stats().drawCalls, particles: fx?.particles ?? 0, alive: fx?.alive ?? {} };
    });
    await page.close();
    return { w, h, ...r };
  }
  for (const [w, h] of [[1920, 1080], [3840, 2160]])
    for (let k = 0; k < repeats; k++)
      for (const [label, query] of [['look', '&fx=off'], ['look+fx', '']]) {
        const r = await fxMeasure(query, w, h);
        fxRows.push({ label, run: k + 1, ...r });
        console.log(label, w, h, JSON.stringify({ ms_median: r.ms_median, ms_p90: r.ms_p90, draws: r.draws, particles: r.particles }));
      }
  const m = (label, w) => {
    const v = fxRows.filter((r) => r.label === label && r.w === w).map((r) => r.ms_median).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const summary = Object.fromEntries([1920, 3840].map((w) => [`${w}x${w === 1920 ? 1080 : 2160}`, { look: m('look', w), lookFx: m('look+fx', w), delta: +(m('look+fx', w) - m('look', w)).toFixed(2) }]));
  const gpu = execSync("system_profiler SPDisplaysDataType | grep 'Chipset Model' | head -1", { encoding: 'utf8' }).split(':')[1]?.trim();
  await mkdir(dirname(fxOut), { recursive: true });
  await writeFile(
    fxOut,
    `${JSON.stringify({ machine: `${cpus()[0]?.model} (${gpu}), ${process.platform}/${process.arch}`, browser: `${channel === 'chrome' ? 'Google Chrome' : 'Chromium'} ${browser.version()} (Playwright, headed), WebGLRenderer`, build: execSync('git rev-parse --short=12 HEAD', { cwd: repo, encoding: 'utf8' }).trim(), cohort: '24 synthetic cars on 24 chase tiles over the greybox, effects demo (every family firing), the look on; effects on vs fx=off; 10 warm-up + 120 synchronous frames each, waited to GPU completion; median of the repeats', summary, rows: fxRows }, null, 2)}\n`,
  );
  await browser.close();
  server.close();
  process.exit(0);
}

const rows = [];
for (const [w, h] of [[1920, 1080], [3840, 2160]]) {
  for (let k = 0; k < repeats; k++) {
    for (const [label, query] of [['plain', '&look=plain'], ['look+fx', '&look=on']]) {
      const r = await measure(query, w, h);
      rows.push({ label, run: k + 1, ...r });
      console.log(label, w, h, JSON.stringify({ ms_median: r.ms_median, ms_p90: r.ms_p90, ms_throughput: r.ms_throughput, draws: r.draws_per_frame }));
    }
  }
}
const med = (label, w, key) => {
  const v = rows.filter((r) => r.label === label && r.w === w).map((r) => r[key]).sort((a, b) => a - b);
  return v[v.length >> 1];
};
const summary = Object.fromEntries(
  [1920, 3840].map((w) => [
    `${w}x${w === 1920 ? 1080 : 2160}`,
    Object.fromEntries(['ms_median', 'ms_throughput'].map((k) => [k, { plain: med('plain', w, k), lookFx: med('look+fx', w, k), delta: +(med('look+fx', w, k) - med('plain', w, k)).toFixed(2), deltaPct: +((100 * (med('look+fx', w, k) - med('plain', w, k))) / med('plain', w, k)).toFixed(1) }])),
  ]),
);
const gpu = execSync("system_profiler SPDisplaysDataType | grep 'Chipset Model' | head -1", { encoding: 'utf8' }).split(':')[1]?.trim();
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  `${JSON.stringify(
    {
      machine: `${cpus()[0]?.model} (${gpu}), ${process.platform}/${process.arch}`,
      browser: `${channel === 'chrome' ? 'Google Chrome' : 'Chromium'} ${browser.version()} (Playwright, headed), WebGLRenderer`,
      build: execSync('git rev-parse --short=12 HEAD', { cwd: repo, encoding: 'utf8' }).trim(),
      cohort: '24 cars x 24 chase tiles, Cruz Missile LOD1, sun shadows on; look (toon ramp + ink hulls) and effects (lamp glows) vs plain; 10 warm-up + 120 timed frames each, waited to GPU completion; median of the repeats',
      summary,
      rows,
    },
    null,
    2,
  )}\n`,
);
await browser.close();
server.close();
