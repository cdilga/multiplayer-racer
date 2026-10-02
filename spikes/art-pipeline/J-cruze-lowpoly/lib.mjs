// lib.mjs — Playwright + system Chrome against the localhost-only server (node serve.mjs 8124).
import { chromium } from 'playwright';
import fs from 'node:fs';
export const OUT = new URL('./out/', import.meta.url).pathname;
let browser;
export async function open(qs = '') {
  browser ??= await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.text()); });
  await page.goto(`http://127.0.0.1:8124/spikes/art-pipeline/J-cruze-lowpoly/index.html?${qs}`);
  await page.waitForFunction(() => document.title === 'READY', null, { timeout: 60000 });
  return page;
}
export const close = async () => { await browser?.close(); browser = null; };
export function saveDataURL(file, url) { fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); }
