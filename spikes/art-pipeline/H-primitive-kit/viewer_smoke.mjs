// node viewer_smoke.mjs "<query>"   — load the INTERACTIVE viewer (no capture flag, intact bake on) and report whether it reaches READY
import { chromium } from 'playwright';
const q = process.argv[2] ?? '';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERR ' + e.message));
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ' ' + m.text()); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:8123/spikes/art-pipeline/H-primitive-kit/index.html?${q}`);
try {
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 45000 });
  const s = await page.evaluate(() => document.getElementById('stats')?.textContent);
  console.log(`READY in ${Date.now() - t0} ms | ${s}`);
} catch (e) { console.log(`NOT READY after ${Date.now() - t0} ms; title=${await page.title().catch(() => '?')}`); }
console.log(logs.slice(0, 8).join('\n') || '(no console errors)');
await browser.close();
