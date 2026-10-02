// lib.mjs — Playwright helpers shared by the capture/bench scripts (system Chrome, GPU, localhost-only server on :8123).
import { chromium } from 'playwright';
export const OUT = new URL('./out/', import.meta.url).pathname;
let browser;
export async function open(w = 1400, h = 900, qs = '') {
  browser ??= await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto(`http://127.0.0.1:8123/spikes/art-pipeline/I-cruze-destruction/index.html?capture=1&w=${w}&h=${h}&${qs}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 120000 });
  return page;
}
export const close = async () => { await browser?.close(); browser = null; };
export const ev = (page, fn, arg) => page.evaluate(fn, arg);
export async function snap(page, name, { clip } = {}) { await page.evaluate(() => window.__demo.render()); await page.screenshot({ path: OUT + name + '.png', clip }); }
export const look = (page, t, az, el, d, fov = 30) => page.evaluate(([t, az, el, d, fov]) => window.__demo.look(t, az, el, d, fov), [t, az, el, d, fov]);
