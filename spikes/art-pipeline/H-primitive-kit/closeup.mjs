// node closeup.mjs out/name.png "tx,ty,tz" az el dist fov [paint]  — arbitrary close-up of the Cruze
import { chromium } from 'playwright';
const [, , out, tgt, az, el, dist, fov = '24', paint = 'e0392f', extra = ''] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=1400&h=900&nointact=1&paint=${paint}&accent=ffd23f${extra}`);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
await page.evaluate(([t, az, el, d, f]) => { const s = window.__demo; s.look(t.split(',').map(Number), +az, +el, +d, +f); s.render(); }, [tgt, az, el, dist, fov]);
await page.screenshot({ path: out }); await browser.close();
