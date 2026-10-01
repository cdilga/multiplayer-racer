// node isolate.mjs out.png "tx,ty,tz" az el dist "<query>" part1,part2,...  → render ONLY those parts (by userData.jj.id) from the demo car
import { chromium } from 'playwright';
const [, , out, tgt, az, el, dist, query, parts] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));
await page.goto(`http://localhost:8123/spikes/art-pipeline/H-primitive-kit/index.html?capture=1&w=1000&h=640&nointact=1&paint=e0a520&accent=ffd23f&${query}`);
await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
await page.evaluate(([t, az, el, d, parts]) => {
  const s = window.__demo, keep = new Set(parts.split(','));
  const walk = (o, on) => { const id = o.userData?.jj?.id; const here = on || (id && keep.has(id)); if (o.isMesh && o.name !== 'floor') o.visible = !!here; for (const c of o.children) walk(c, here); };
  walk(s.stage.scene, false); s.look(t.split(',').map(Number), +az, +el, +d, 30); s.render();
}, [tgt, az, el, dist, parts]);
await page.screenshot({ path: out }); await browser.close();
