// node recog_capture.mjs <outdir> <paint-hex> <variant...>   variant = "base" or an rc list like "tail,grille"
// Renders the matched-angle views (front 3/4 ~ photo 4, rear 3/4 ~ photo 2, side ~ photo 3, chase cam) for each variant.
import { chromium } from 'playwright';
import fs from 'node:fs';
const [, , outdir, paint, ...variants] = process.argv;
fs.mkdirSync(outdir, { recursive: true });
const VIEWS = {
  front3q: { t: [0, 0.68, 0.2], az: -35, el: 9, d: 5.6, fov: 30 },
  rear3q: { t: [0, 0.72, -0.3], az: 215, el: 17, d: 5.8, fov: 30 },
  side: { t: [0, 0.72, 0], az: 90, el: 2, d: 9.2, fov: 20 },
  chase: { t: [0, 0.5, -0.1], az: 198, el: 38, d: 7.6, fov: 30 },
  closeF: { t: [0, 0.62, 1.7], az: -22, el: 8, d: 3.3, fov: 26 },
  closeR: { t: [0, 0.8, -1.8], az: 205, el: 14, d: 3.3, fov: 26 },
};
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => console.log('PAGEERR', v, e.message));
  const rc = v === 'base' ? '' : v;
  await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=900&h=600&nointact=1&paint=${paint}&accent=ffd23f&rc=${rc}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  for (const [name, c] of Object.entries(VIEWS)) {
    await page.evaluate(([c]) => { const s = window.__demo; s.look(c.t, c.az, c.el, c.d, c.fov); s.render(); }, [c]);
    await page.screenshot({ path: `${outdir}/${v.replace(/,/g, '+')}_${name}.png` });
  }
  await page.close();
}
await browser.close();
