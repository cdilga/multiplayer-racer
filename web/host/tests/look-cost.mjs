// P1-R10 / P1-R12 frame-cost delta at 24 tiles, HEADED on this machine's GPU (never SwiftShader numbers). The renderer bench
// (host/?bench: 24 Cruz Missiles x 24 chase tiles, each frame waited to GPU completion) with the look and effects on, against
// the same page with them off (`?look=plain&fx=off`: plain materials, no ink hulls, no particles). Interleaved, repeated, so
// drift between runs shows. The bar (P1-R10): the 24-tile scene pass within U05's measurement + 20 %
// (art/ui/accepted/2026-10-07/poc/world/README.md: 12.4 ms GPU at 1080p, 24 tiles, WebGPU M1 Pro, timestamp queries).
//   npm --prefix web run build && node web/host/tests/look-cost.mjs [--channel chrome] [--repeats 3] [--out docs/evidence/P1-R10/cost.json]
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

const rows = [];
for (const [w, h] of [[1920, 1080], [3840, 2160]]) {
  for (let k = 0; k < repeats; k++) {
    for (const [label, query] of [['plain', '&look=plain&fx=off'], ['look+fx', '']]) {
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
