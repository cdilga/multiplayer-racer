// node spikes/art-pipeline/D-props-kit-surfaces/capture.mjs  (serves repo root separately)
import { chromium } from 'playwright';
const PORT = process.env.PORT || 8420;
const browser = await chromium.launch({ channel: 'chrome' });
let report;
for (const view of ['track', 'bin', 'squish']) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR', m.text()); });
  await page.goto(`http://localhost:${PORT}/spikes/art-pipeline/D-props-kit-surfaces/ingame.html?view=${view}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  report = await page.evaluate(() => window.__report);
  const outName = view === 'squish' ? 'wheelie_bin_squish_sequence.png' : `ingame_${view}.png`;
  await page.screenshot({ path: `spikes/art-pipeline/D-props-kit-surfaces/out/${outName}` });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
