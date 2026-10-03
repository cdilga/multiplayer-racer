// capture.mjs: serves the repo root, loads index.html in Chromium (WebGPU), writes hero.png, side.png and a 2x crop.
// usage: node capture.mjs [--webgl] [--tag name] [--q "k=v&k2=v2"] [--crop x,y,w,h] [--views hero,side]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const ROOT = path.resolve(new URL('../../../..', import.meta.url).pathname);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(ROOT + '/package.json');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const webgl = argv.includes('--webgl'), tag = arg('--tag', ''), extra = arg('--q', ''), views = arg('--views', 'hero,side').split(',');
const crop = arg('--crop', '').split(',').filter(Boolean).map(Number);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const report = { port, webgl, views: {} };
for (const view of views) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
  const qs = `view=${view}${webgl ? '&webgl=1' : ''}${extra ? '&' + extra : ''}`;
  await page.goto(`http://127.0.0.1:${port}/docs/evidence/P1-F11/fresh-agent/index.html?${qs}`);
  try { await page.waitForFunction(() => window.__frames >= 12, null, { timeout: 60000 }); } catch (e) { logs.push('[timeout] ' + e.message); }
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => ({ info: window.__info, errors: window.__errors, frames: window.__frames }));
  const name = `${view}${webgl ? '-webgl2' : ''}${tag ? '-' + tag : ''}`;
  const file = path.join(HERE, name + '.png');
  await page.screenshot({ path: file });
  report.views[view] = { name, ...info, logs: logs.filter((l) => !l.includes('GPU stall')).slice(0, 12) };
  if (view === 'hero' && crop.length === 4) {
    const src = PNG.sync.read(fs.readFileSync(file)), [cx, cy, cw, ch] = crop, out = new PNG({ width: cw * 2, height: ch * 2 });
    for (let y = 0; y < ch * 2; y++) for (let x = 0; x < cw * 2; x++) {
      const si = ((cy + (y >> 1)) * src.width + cx + (x >> 1)) * 4, di = (y * out.width + x) * 4;
      for (let k = 0; k < 4; k++) out.data[di + k] = src.data[si + k];
    }
    fs.writeFileSync(path.join(HERE, `crop-halftone-2x${webgl ? '-webgl2' : ''}${tag ? '-' + tag : ''}.png`), PNG.sync.write(out));
  }
  await page.close();
}
const gpu = await (async () => { const p = await browser.newPage(); await p.goto(`http://127.0.0.1:${port}/docs/evidence/P1-F11/fresh-agent/index.html?view=hero`, { waitUntil: 'domcontentloaded' }); const g = await p.evaluate(async () => { const a = navigator.gpu && await navigator.gpu.requestAdapter(); return a ? { vendor: a.info?.vendor, architecture: a.info?.architecture, description: a.info?.description } : null; }); await p.close(); return g; })();
report.gpuAdapter = gpu; report.browser = browser.version();
fs.writeFileSync(path.join(HERE, `captures${webgl ? '-webgl2' : ''}${tag ? '-' + tag : ''}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close(); server.close();
