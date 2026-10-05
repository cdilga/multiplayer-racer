#!/usr/bin/env node
// Quick look for the self-review loop: screenshot one page (or one element of it) from this checkout at a viewport.
// Usage: node art/ui/lib/shot.mjs <path> <WxH> <out.png> [--sel <css>] [--mobile] [--webkit] [--wait <ms>] [--eval <js>] [--resize <WxH>]
//   --resize changes the viewport after load (a rotation, the browser bars showing or hiding) before the shot;
//   --mobile emulates a phone (meta viewport honoured, touch, DPR 2.625); --sel crops to the first match;
//   --eval runs a snippet after load (forcing a state, focusing a button) before the shot.
import { serveArtUi } from './serve.mjs';
import { chromium, webkit } from 'playwright';

const argv = process.argv.slice(2);
const take = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv.splice(i, 2)[1]; };
const has = (f) => { const i = argv.indexOf(f); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const sel = take('--sel'), wait = +take('--wait', '1500'), ev = take('--eval'), resize = take('--resize');
const mobile = has('--mobile'), wk = has('--webkit');
const [path, vp, out] = argv;
const [width, height] = vp.split('x').map(Number);
const s = await serveArtUi();
const browser = await (wk ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: wk ? 3 : 2.625 } : {}) });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(s.base + path, { waitUntil: 'load' });
await page.waitForTimeout(wait);
if (ev) { await page.evaluate(ev); await page.waitForTimeout(400); }
if (resize) { const [rw, rh] = resize.split('x').map(Number); await page.setViewportSize({ width: rw, height: rh }); await page.waitForTimeout(1200); } // a rotation, or the bars coming and going
const pr = take('--print');
if (pr) console.log(await page.evaluate(pr)); // a value to read back (what covers a point, a layout number)
if (sel) await page.locator(sel).first().screenshot({ path: out });
else await page.screenshot({ path: out });
await browser.close();
await s.close();
console.log(out);
