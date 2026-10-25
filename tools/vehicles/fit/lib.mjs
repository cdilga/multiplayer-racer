// lib.mjs (br-bwju.3): serves the repo root on 127.0.0.1 and opens the fit page for one car in Playwright Chromium.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
let server, browser;

export async function open(car, { model, params } = {}) {
  server = http.createServer((req, res) => {
    const file = path.join(REPO, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  // Baseline captures must not temporarily rewrite the shared working tree. Imports retain their original URL.
  for (const [file, override] of [['model.js',model],['params.json',params]]) if (override) {
    await page.route(`**/art/vehicles/${car}/${file}`, route => route.fulfill({ status:200, contentType:file.endsWith('.json')?'application/json':'text/javascript', body:fs.readFileSync(override,'utf8') }));
  }
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/vehicles/fit/index.html?car=${encodeURIComponent(car)}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  return page;
}
export async function close() { await browser?.close(); server?.close(); }
export const saveDataURL = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
