// bench.mjs — node bench.mjs → out/bench.json + out/bench_<case>.png (system Chrome, Metal)
import fs from 'node:fs'; import { chromium } from 'playwright'; import { OUT, saveDataURL } from './lib.mjs';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto('http://127.0.0.1:8124/spikes/art-pipeline/J-cruze-lowpoly/bench.html');
await page.waitForFunction(() => document.title === 'READY');
const cases = [];
for (const w of [[1920, 1080], [3840, 2160]]) for (const lod of [0, 1, 2]) for (const mode of ['naive', 'instanced']) cases.push({ n: 24, lod, mode, shadows: 'once', w: w[0], h: w[1] });
cases.push({ n: 24, lod: 1, mode: 'instanced', shadows: 'per-tile', w: 1920, h: 1080 }, { n: 24, lod: 1, mode: 'naive', shadows: 'per-tile', w: 1920, h: 1080 }, { n: 24, lod: 1, mode: 'instanced', shadows: 'off', w: 1920, h: 1080 });
cases.push({ n: 48, lod: 1, mode: 'instanced', shadows: 'once', w: 1920, h: 1080 }, { n: 1, lod: 0, mode: 'instanced', shadows: 'once', w: 1920, h: 1080 }, { n: 4, lod: 0, mode: 'instanced', shadows: 'once', w: 1920, h: 1080 });
const res = [];
for (const c of cases) {
  const r = await page.evaluate((c) => window.__bench.run(c), c); res.push(r);
  console.log(JSON.stringify(r));
  if (c.w === 1920 && (c.n !== 24 || c.shadows === 'once') && c.mode === 'instanced') saveDataURL(`${OUT}bench_n${c.n}_lod${c.lod}.png`, await page.evaluate(() => window.__bench.shot()));
}
fs.writeFileSync(OUT + 'bench.json', JSON.stringify(res, null, 1));
await browser.close();
