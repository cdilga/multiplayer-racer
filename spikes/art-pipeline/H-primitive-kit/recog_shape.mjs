// node recog_shape.mjs <outdir> <paint> "<label>|<query fragment>" ...   e.g. "v2|rc=shape&sh=wr:0.06;k:0.9"
import { chromium } from 'playwright';
import fs from 'node:fs';
const [, , outdir, paint, ...variants] = process.argv;
fs.mkdirSync(outdir, { recursive: true });
const VIEWS = {
  sliver: { t: [-0.75, 1.25, -0.75], az: 205, el: 22, d: 2.4, fov: 30 },
  user: { t: [-0.75, 1.0, -1.45], az: 232, el: 12, d: 2.7, fov: 30 },
  rearq: { t: [-0.4, 0.95, -1.2], az: 212, el: 14, d: 5.2, fov: 30 },
  rear: { t: [0, 0.9, -1.5], az: 180, el: 3, d: 6.5, fov: 24 },
  side: { t: [0, 0.75, 0], az: 90, el: 2, d: 9.2, fov: 20 },
  front3q: { t: [0, 0.68, 0.2], az: -35, el: 9, d: 5.6, fov: 30 },
  chase: { t: [0, 0.5, -0.1], az: 198, el: 38, d: 7.6, fov: 30 },
};
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
for (const v of variants) {
  const [label, frag = ''] = v.split('|');
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => console.log('PAGEERR', label, e.message));
  await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=900&h=600&nointact=1&paint=${paint}&accent=ffd23f&${frag}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  for (const [name, c] of Object.entries(VIEWS)) {
    await page.evaluate(([c]) => { const s = window.__demo; s.look(c.t, c.az, c.el, c.d, c.fov); s.render(); }, [c]);
    await page.screenshot({ path: `${outdir}/${label}_${name}.png` });
  }
  await page.close();
}
await browser.close();
