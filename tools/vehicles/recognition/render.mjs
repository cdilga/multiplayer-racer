#!/usr/bin/env node
// render.mjs (br-bwju.12): the recognition renders of a roster car: every LOD x front, front 3/4 left and right, side, rear 3/4,
// rear and top, one PNG each, from the baked GLBs through the game's paint-key material.
//   node tools/vehicles/recognition/render.mjs <vehicle id> --out <dir> [--paint '#f06a1a'] [--size 640]
//   → <dir>/lod<N>-<view>.png
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const id = args[0], out = path.resolve(opt('--out', '.'));
if (!id) { console.error('usage: render.mjs <vehicle id> --out <dir>'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(REPO, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch();
fs.mkdirSync(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  const paint = opt('--paint') ? `&paint=${encodeURIComponent(opt('--paint'))}` : '';
  const asset = encodeURIComponent(`/art/vehicles/${id}/${id}.asset.json`);
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/vehicles/recognition/index.html?asset=${asset}&size=${opt('--size', '640')}${paint}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  for (const lod of [0, 1, 2]) for (const view of ['front', 'front-left', 'front-right', 'side', 'rear-left', 'rear', 'top']) {
    const url = await page.evaluate(([l, v]) => window.__render(l, v), [lod, view]);
    fs.writeFileSync(path.join(out, `lod${lod}-${view}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`wrote 21 renders to ${out}; Playwright Chromium ${browser.version()}`);
} finally { await browser.close(); server.close(); }
