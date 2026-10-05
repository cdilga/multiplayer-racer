// P1-M09 captures (not part of node --test): every sign family and the invented sign, drawn by the real kit.
//   node web/host/tests/signs-capture.mjs
// Writes docs/evidence/P1-M09/: sheets at the smallest TV-grid tile (192x108: 100 players at 1920x1080, from the grid
// kernel), a mid tile (274x216: 32 players) and a large one, plus a posts-and-ground view. The "x3" images are the
// same pixels enlarged 3x with no smoothing, only so a person can read them; the 1x images are the evidence.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';

const repo = resolve(import.meta.dirname, '../../..');
const out = process.env.OUT ?? join(repo, 'docs/evidence/P1-M09'); // OUT and ONLY (a sign id) are for iterating on one sign
mkdirSync(out, { recursive: true });
const dataDir = join(repo, 'assets/kit/signs/data');
const defs = readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8')));
if (process.env.ONLY) defs.splice(0, defs.length, ...defs.filter((d) => d.id === process.env.ONLY));
const order = ['warning', 'direction', 'tourist'];
defs.sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family) || a.id.localeCompare(b.id));

const result = await build({
  root: resolve(repo, 'web'),
  logLevel: 'silent',
  configFile: false,
  build: { write: false, lib: { entry: join(repo, 'web/host/tests/signs-capture-entry.ts'), formats: ['iife'], name: 'SignSheetBundle', fileName: 'x' } },
});
const code = (Array.isArray(result) ? result[0] : result).output[0].code;

const browser = await chromium.launch();
const info = { browser: `Chromium ${browser.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}`, sheets: {} };

async function sheet(name, opts, scale = 3) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  await page.setContent('<body style="margin:0;background:#222"></body>');
  await page.addScriptTag({ content: code });
  const dim = await page.evaluate((o) => window.SignSheet.flat(o), opts);
  await page.locator('canvas').screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 92 });
  if (scale > 1) {
    await page.evaluate(([s]) => {
      const src = document.querySelector('canvas');
      const big = document.createElement('canvas');
      big.width = src.width * s;
      big.height = src.height * s;
      const c = big.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(src, 0, 0, big.width, big.height);
      src.remove();
      document.body.append(big);
    }, [scale]);
    await page.locator('canvas').screenshot({ path: join(out, `${name}-x${scale}.jpg`), type: 'jpeg', quality: 92 });
  }
  info.sheets[name] = { ...dim, cell: opts.cell, fill: opts.fill, signs: opts.defs.map((d) => d.id), errors };
  await page.close();
}

const BG = '#9cc3e0';
if (process.env.ONLY) {
  await sheet('only', { defs, cell: { w: 600, h: 450 }, cols: 1, fill: 0.9, bg: BG }, 1);
  await browser.close();
  process.exit(0);
}
await sheet('smallest-tile-192x108', { defs, cell: { w: 192, h: 108 }, cols: 6, fill: 0.85, bg: BG });
await sheet('mid-tile-274x216', { defs, cell: { w: 274, h: 216 }, cols: 4, fill: 0.85, bg: BG }, 2);
await sheet('large-480x360', { defs, cell: { w: 480, h: 360 }, cols: 3, fill: 0.88, bg: BG }, 1);
// Honest lower bound: the same signs when the panel is only 40% of the smallest tile (a sign seen from further off).
await sheet('smallest-tile-far-192x108', { defs, cell: { w: 192, h: 108 }, cols: 6, fill: 0.4, bg: BG });

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.setContent('<body style="margin:0;background:#222"></body>');
await page.addScriptTag({ content: code });
const pick = (...ids) => ids.map((id) => defs.find((d) => d.id === id));
await page.evaluate((o) => window.SignSheet.world(o), { defs: pick('signs/bloody-big-jumps', 'signs/crest', 'signs/stuart-hwy', 'signs/lookout'), w: 1280, h: 480, bg: '#9cc3e0', yaw: -0.35 });
await page.locator('canvas').screenshot({ path: join(out, 'posts-in-world.jpg'), type: 'jpeg', quality: 92 });
await page.close();
await browser.close();
writeFileSync(join(out, 'browser-run.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(info.sheets).map(([k, v]) => [k, `${v.w}x${v.h} errors=${v.errors.length}`]))));
