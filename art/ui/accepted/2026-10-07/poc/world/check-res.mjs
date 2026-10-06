import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';
const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, w, h, dpr, q] of [['phone dpr2.6', 412, 915, 2.6, ''], ['phone res=0.5', 412, 915, 2.6, '&res=0.5'], ['tv 4k css1920 dpr2', 1920, 1080, 2, '']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${base}/poc/world/index.html?forceWebGL=1${q}#grid&n=4`, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const r = await page.evaluate(() => { const c = document.querySelector('canvas'); return { canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight], dpr: devicePixelRatio, ready: window.__world?.ready, render: window.__world?.options?.().render }; });
  console.log(name, JSON.stringify(r), errs.slice(0, 2));
  await ctx.close();
}
await browser.close(); await close();
