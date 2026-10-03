// capture.mjs (P1-V02): renders a baked vehicle's contact sheets through view/index.html in Playwright Chromium and writes
// them as PNGs. Serves the repo root on 127.0.0.1 only.
//   node tools/vehicles/view/capture.mjs [--asset /art/vehicles/cruz-missile/cruz-missile.asset.json] [--out docs/evidence/P1-V02]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2), opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const asset = opt('--asset', '/art/vehicles/cruz-missile/cruz-missile.asset.json');
const out = path.resolve(opt('--out', path.join(REPO, 'docs/evidence/P1-V02')));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const file = path.join(REPO, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
fs.mkdirSync(out, { recursive: true });
try {
  for (const sheet of ['views', 'paints', 'lods', 'colliders']) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERR', e.message));
    await page.goto(`${base}/tools/vehicles/view/index.html?asset=${encodeURIComponent(asset)}&sheet=${sheet}`);
    await page.waitForFunction(() => document.title === 'READY' || document.title.startsWith('ERROR'), null, { timeout: 60000 });
    const title = await page.title();
    if (title !== 'READY') throw new Error(`${sheet}: ${title}`);
    const url = await page.evaluate(() => window.__sheet);
    const file = path.join(out, `${sheet}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`wrote ${path.relative(REPO, file)}`);
    await page.close();
  }
  console.log(`browser: Playwright Chromium ${browser.version()}`);
} finally {
  await browser.close();
  server.close();
}
