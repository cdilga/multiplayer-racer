// node shot.mjs "<query>" out.png [w h]   — screenshot dev.html with system Chrome (real GPU)
import { chromium } from 'playwright';
const [, , query, out, w = '1280', h = '720'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('CONSOLE', m.type(), m.text()); });
await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/dev.html?w=${w}&h=${h}&${query}`);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
console.log(JSON.stringify(await page.evaluate(() => window.__report)));
await page.screenshot({ path: out });
await browser.close();
