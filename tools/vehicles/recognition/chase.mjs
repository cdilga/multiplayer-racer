#!/usr/bin/env node
// chase.mjs (br-bwju.12): the in-game chase view of one roster car, from the real host page (synthetic oval, one tile, the race
// chase camera), for the recognition test and the self-review. Run where the GPU is (eris), after `npm --prefix web run build`:
//   JJ_CHROMIUM_GPU=1 node tools/vehicles/recognition/chase.mjs <vehicle id> --out <dir> [--paint '#f06a1a'] [--size 1280x720]
//   → <dir>/chase-<n>.png: the chase camera behind the car at a few moments of its lap (frozen ticks), UI hidden.
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { chromiumArgs } from '../../../web/tests/journeys/lib/chromium.mjs';
import { openHost, serve } from '../../../web/host/tests/lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const id = args[0], out = resolve(opt('--out', '.')), [W, H] = opt('--size', '1280x720').split('x').map(Number);
if (!id) { console.error('usage: chase.mjs <vehicle id> --out <dir>'); process.exit(2); }
await mkdir(out, { recursive: true });
const server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
const browser = await chromium.launch(process.env.JJ_CHROMIUM_GPU === '1' ? { headless: true, args: chromiumArgs } : {});
const HIDE = '.jj-chip,.jj-render-chip,aside,.jj-arrows,button,[class*=banner],[class*=toast],.jj-hud{display:none!important}';
try {
  // freeze ticks: on a straight, going into the bend, mid bend, out of it (the synthetic oval, 18 m/s)
  const ticks = [200, 420, 640, 860];
  for (const [n, tick] of ticks.entries()) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await openHost(page, `${server.url}/host/?synthetic=1&vehicles=${id}&map&look=on&tiles=1&res=1&autores=off&freeze=${tick}`);
    await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) > 60, null, { timeout: 90_000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.addStyleTag({ content: HIDE });
    await page.screenshot({ path: join(out, `chase-${n + 1}.png`), type: 'png' });
    await page.close();
  }
  console.log(`wrote ${ticks.length} chase views of ${id} to ${out}; Chromium ${browser.version()}`);
} finally { await browser.close(); server.close(); }
