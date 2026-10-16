#!/usr/bin/env node
// run.mjs (br-bwju.3, from br-bwju.2's Ute evidence runner): renders a baked car's review evidence through
// tools/vehicles/evidence/index.html in headless Playwright Chromium (software GL, no GPU run). Serves the repo root on 127.0.0.1.
//   node tools/vehicles/evidence/run.mjs <vehicle id> --out <dir>
//   → <dir>/{damage-strip, damage-strip-overview, paints-strip, grid-1, grid-4, grid-24}.png
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2), car = args[0], out = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : null;
if (!car || !out) { console.error('usage: run.mjs <vehicle id> --out <dir>'); process.exit(2); }
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(REPO, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': T[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
fs.mkdirSync(out, { recursive: true });
const jobs = [['damage', 'damage-strip.png'], ['overview', 'damage-strip-overview.png'], ['paints', 'paints-strip.png'], ['world-large', 'grid-1.png'], ['world-medium', 'grid-4.png'], ['world-small', 'grid-24.png']];
try {
  for (const [mode, file] of jobs) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', (e) => console.log('PAGEERR', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
    await page.goto(`${base}/tools/vehicles/evidence/index.html?car=${encodeURIComponent(car)}&mode=${mode}`);
    await page.waitForFunction(() => document.title === 'READY' || document.title.startsWith('ERROR'), null, { timeout: 120000 });
    const t = await page.title();
    if (t !== 'READY') throw new Error(`${mode}: ${t}`);
    const url = await page.evaluate(() => window.__out);
    fs.writeFileSync(path.join(out, file), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', path.relative(REPO, path.join(out, file)));
    await page.close();
  }
  console.log('browser: Playwright Chromium', browser.version());
} finally {
  await browser.close();
  server.close();
}
