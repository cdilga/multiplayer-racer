// node capture_textured.mjs  (serves repo root separately: python3 -m http.server <port> from repo root)
import { chromium } from 'playwright';
const PORT = process.env.PORT || 8210;
const BASE = `http://localhost:${PORT}/spikes/art-pipeline/A-textures-uv`;
const runs = [
  { n: 6, w: 1920, h: 1080, dirt: '0.1,0.15,0.1,0.2,0.15,0.1', out: 'ingame_identity_grid.png' },
  { n: 1, w: 1280, h: 720, dirt: 0.05, out: 'ingame_hero_clean.png' },
  { n: 1, w: 1280, h: 720, dirt: 0.95, out: 'ingame_hero_dirty.png' },
];
// note: the chase-cam always frames directly behind the car regardless of car.rotation.y (camera
// offset is derived FROM that same rotation), so an `angle` override doesn't produce a genuine 3/4
// view -- see REPORT.md. The rear view above is enough to prove the mask-driven shader; a nicer
// hero angle would need a camera offset independent of car facing (not built for this spike).
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
for (const r of runs) {
  const page = await browser.newPage({ viewport: { width: r.w, height: r.h } });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR', m.text()); });
  const angle = r.angle !== undefined ? `&angle=${r.angle}` : '';
  await page.goto(`${BASE}/ingame_textured.html?n=${r.n}&w=${r.w}&h=${r.h}&dirt=${r.dirt}${angle}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  const rep = await page.evaluate(() => window.__report);
  await page.screenshot({ path: `spikes/art-pipeline/A-textures-uv/out/${r.out}` });
  results.push({ ...r, ...rep });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
