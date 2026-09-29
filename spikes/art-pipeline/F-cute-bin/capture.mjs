// node spikes/art-pipeline/F-cute-bin/capture.mjs <round_tag>  (serves repo root separately)
import { chromium } from 'playwright';
const PORT = process.env.PORT || 8611;
const ROUND = process.argv[2] || 'roundX';
const OUTDIR = 'spikes/art-pipeline/F-cute-bin/out';
const browser = await chromium.launch({ channel: 'chrome' });

const jobs = [
  { view: '3q', file: `${ROUND}_hero_3q.png`, w: 900, h: 900 },
  { view: 'front', file: `${ROUND}_turn_front.png`, w: 700, h: 900 },
  { view: 'side', file: `${ROUND}_turn_side.png`, w: 700, h: 900 },
  { view: 'back', file: `${ROUND}_turn_back.png`, w: 700, h: 900 },
  { view: 'top', file: `${ROUND}_turn_top.png`, w: 700, h: 900 },
  { view: 'squish', file: `${ROUND}_squish.png`, w: 1900, h: 700 },
  { view: 'silhouette', file: `${ROUND}_silhouette.png`, w: 60, h: 60 },
];

let lastReport;
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.w, height: job.h } });
  page.on('pageerror', (e) => console.log('PAGEERR', job.view, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERR', job.view, m.text()); });
  await page.goto(`http://localhost:${PORT}/spikes/art-pipeline/F-cute-bin/render.html?view=${job.view}&w=${job.w}&h=${job.h}&_=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 30000 });
  lastReport = await page.evaluate(() => window.__report);
  await page.screenshot({ path: `${OUTDIR}/${job.file}`, omitBackground: job.view === 'silhouette' });
  await page.close();
  console.log('CAPTURED', job.view, '->', job.file, JSON.stringify(lastReport));
}
await browser.close();
