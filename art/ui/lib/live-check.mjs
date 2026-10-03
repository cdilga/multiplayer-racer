#!/usr/bin/env node
// The design agent's self-look loop: open the DEPLOYED pages like a reviewer would and fail on anything broken, so a
// missing image or font never reaches the owner. Checks every page for failed requests (4xx/5xx), <img> that did not
// decode, and uncaught errors; saves a screenshot of each for the agent to look at before reporting.
// Usage: node art/ui/lib/live-check.mjs [--base <url>] [--out <dir>] [path ...]
//   default base https://jammers-preview.dilger.dev, default paths below, default out docs/evidence/design-live/.
// Exit 1 on any failure. scripts/poc-publish.sh runs it after the rsync.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const take = (flag, dflt) => { const i = argv.indexOf(flag); return i < 0 ? dflt : argv.splice(i, 2)[1]; };
const base = take('--base', 'https://jammers-preview.dilger.dev').replace(/\/$/, '');
const out = take('--out', join(here, '..', '..', '..', 'docs', 'evidence', 'design-live'));
const paths = argv.length ? argv : ['/sheets/components.html', '/sheets/brand.html', '/poc/phone/index.html#race'];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium' });
let failed = false;
try {
  for (const path of paths) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const broken = await page.evaluate(() => [...document.images].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.currentSrc || i.src));
    for (const src of broken) problems.push(`image did not load: ${src}`);
    const file = join(out, `${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'index'}.png`);
    await page.screenshot({ path: file, fullPage: true });
    failed ||= problems.length > 0;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${path} -> ${file}`);
    for (const p of [...new Set(problems)]) console.log(`     ${p}`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
