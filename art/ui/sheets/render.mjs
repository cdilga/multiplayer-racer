#!/usr/bin/env node
// Render the P1-U01 design sheets to PNG with Playwright (Chromium), serving art/ui over a local
// HTTP server so fonts, icons and tokens load like they will in the game (no CDN, R70).
// Usage: node art/ui/sheets/render.mjs [--out <dir>] [sheet ...]   (default: every sheet below)
// Output: docs/evidence/P1-U01/<sheet>.png (or <dir>/) and, for sheets that report, <sheet>.json.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const out = outAt >= 0 ? argv.splice(outAt, 2)[1] : join(here, '..', '..', '..', 'docs', 'evidence', 'P1-U01');
const SHEETS = {
  cvd: { width: 1600, height: 900 },
  fonts: { width: 1600, height: 900 },
  components: { width: 1600, height: 900 },
  brand: { width: 1600, height: 900 },
};
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = readFileSync(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
mkdirSync(out, { recursive: true });

const names = argv.length ? argv : Object.keys(SHEETS);
const browser = await chromium.launch({ channel: 'chromium' }); // new headless on the full build
let failed = false;
try {
  for (const name of names) {
    const vp = SHEETS[name];
    if (!vp) throw new Error(`unknown sheet ${name}`);
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
    page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
    await page.goto(`${base}/sheets/${name}.html`);
    await page.waitForFunction(() => window.sheetReady === true, null, { timeout: 30000 });
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
    const report = await page.evaluate(() => window.sheetReport ?? null);
    if (report) writeFileSync(join(out, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
    const ok = errors.length === 0 && (report?.ok ?? true);
    failed ||= !ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}.png${report ? ` (+ ${name}.json)` : ''}${errors.length ? ` errors: ${errors.join('; ')}` : ''}`);
    if (report?.failures?.length) for (const f of report.failures) console.log(`     ${f}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
