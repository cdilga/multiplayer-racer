// node spikes/art-pipeline/capture.mjs  (serves repo root on :8123 separately)
import { chromium } from 'playwright';
const runs = [
  { n: 1, w: 1280, h: 720, dent: 0, out: 'ingame_hero.png' },
  { n: 1, w: 1280, h: 720, dent: 1, out: 'ingame_hero_dented.png' },
  { n: 4, w: 1920, h: 1080, dent: 0, out: 'ingame_grid4_1080p.png' },
  { n: 12, w: 3840, h: 2160, dent: 0.6, out: 'ingame_grid12_4k.png' },
  { n: 24, w: 3840, h: 2160, dent: 0.3, out: 'ingame_grid24_4k.png' },
];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const results = [];
for (const r of runs) {
  const page = await browser.newPage({ viewport: { width: r.w, height: r.h } });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(`http://localhost:8123/spikes/art-pipeline/ingame.html?n=${r.n}&w=${r.w}&h=${r.h}&dent=${r.dent}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  const rep = await page.evaluate(() => window.__report);
  await page.screenshot({ path: `spikes/art-pipeline/out/${r.out}` });
  results.push({ ...r, ...rep });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
