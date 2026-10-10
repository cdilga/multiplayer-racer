// node docs/evidence/br-bwju.2/tools/run.mjs --triton <triton.glb>   writes the evidence images beside this folder (headless Chromium, no GPU run)
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2), triton = a.includes('--triton') ? a[a.indexOf('--triton') + 1] : null;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = u === '/__triton.glb' ? triton : path.join(REPO, u);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': T[path.extname(file)] ?? 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const jobs = [['compare', 'reference-lod0/sheet.png'], ['damage', 'damage-strip.png'], ['overview', 'damage-strip-overview.png'], ['paints', 'paints-strip.png'], ['world-large', 'grid-1.png'], ['world-medium', 'grid-4.png'], ['world-small', 'grid-24.png']];
for (const [mode, file] of jobs) {
  if (mode === 'compare' && !triton) continue;
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto(`${base}/docs/evidence/br-bwju.2/tools/index.html?mode=${mode}`);
  await page.waitForFunction(() => document.title === 'READY' || document.title.startsWith('ERROR'), null, { timeout: 120000 });
  const t = await page.title(); if (t !== 'READY') throw new Error(`${mode}: ${t}`);
  const url = await page.evaluate(() => window.__out); const dest = path.join(OUT, file); fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(url.split(',')[1], 'base64'));
  if (mode === 'compare') fs.writeFileSync(path.join(OUT, 'reference-lod0/score.json'), JSON.stringify(await page.evaluate(() => window.__score), null, 1) + '\n');
  console.log('wrote', path.relative(REPO, dest)); await page.close();
}
console.log('browser: Playwright Chromium', browser.version()); await browser.close(); server.close();
