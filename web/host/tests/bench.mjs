// P1-R01 backend bench, HEADED on this machine's GPU (never headless/SwiftShader numbers). Not part of `node --test`:
//   npm --prefix web run build && node web/host/tests/bench.mjs [--channel chrome] [--out docs/evidence/P1-R01/bench.json]
// Runs host/?bench in a real browser window: 24 Cruz Missiles × 24 chase tiles per backend, at 1080p and 4K, shadows
// off and on, and writes the table with the hardware, browser and build it ran on.
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
const out = resolve(repo, arg('--out', 'docs/evidence/P1-R01/bench.json'));
const n = Number(arg('--n', 24));

const server = await serve(join(repo, 'web/dist'));
const browser = await chromium.launch({ headless: false, channel: channel === 'chromium' ? undefined : channel, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`${server.url}/host/?bench`);
await page.waitForFunction(() => document.documentElement.dataset.jjHost === 'bench');

const rows = [];
for (const backend of arg('--backends', 'webgpu,webgl2,webgl').split(',')) {
  for (const [w, h] of [[1920, 1080], [3840, 2160]]) {
    for (const shadows of [false, true]) {
      const r = await page.evaluate((o) => window.__bench.run(o), { backend, n, lod: 1, shadows, w, h, frames: 120 });
      rows.push(r);
      console.log(JSON.stringify(r));
    }
  }
}
const gpu = execSync("system_profiler SPDisplaysDataType | grep 'Chipset Model' | head -1", { encoding: 'utf8' }).split(':')[1]?.trim();
const result = {
  machine: `${cpus()[0]?.model} (${gpu}), ${process.platform}/${process.arch}`,
  browser: `${channel === 'chrome' ? 'Google Chrome' : 'Chromium'} ${browser.version()} (Playwright, headed)`,
  build: execSync('git rev-parse --short=12 HEAD', { cwd: repo, encoding: 'utf8' }).trim(),
  cohort: `${n} cars × ${n} chase tiles, Cruz Missile LOD1, every tile draws the whole pack; 10 warm-up + 120 timed frames, each waited to GPU completion`,
  rows,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
await browser.close();
server.close();
