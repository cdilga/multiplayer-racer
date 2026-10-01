// Template: node shot.mjs "<url>" out.png [width height]
// Opens a page in the system Chrome (real GPU), waits for document.title === 'READY', screenshots. Requires `npm i playwright`
// (already a repo dependency). Serve the repo with: python3 -m http.server 8123 --bind 127.0.0.1   (never bind all interfaces)
import { chromium } from 'playwright';
const [, , url, out, w = '1280', h = '720'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text()); });
await page.goto(url);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
console.log(JSON.stringify(await page.evaluate(() => window.__report ?? {})));
await page.screenshot({ path: out });
await browser.close();
