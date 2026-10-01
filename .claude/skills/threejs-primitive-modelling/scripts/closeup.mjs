// Template: node closeup.mjs out.png "tx,ty,tz" az el dist fov [queryString]
// Close-up of any spot on a model page that exposes window.__demo.look(target[], az, el, dist, fov) + render()
// (see spikes/art-pipeline/H-primitive-kit/app.js). Use it after every change: 3/4 hero, dead side, and the exact area you edited.
import { chromium } from 'playwright';
const [, , out, tgt, az, el, dist, fov = '26', q = ''] = process.argv;
const base = process.env.BASE || 'http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=1400&h=900&nointact=1';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(base + q);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
await page.evaluate(([t, az, el, d, f]) => { const s = window.__demo; s.look(t.split(',').map(Number), +az, +el, +d, +f); s.render(); }, [tgt, az, el, dist, fov]);
await page.screenshot({ path: out });
await browser.close();
