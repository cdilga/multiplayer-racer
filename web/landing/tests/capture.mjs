#!/usr/bin/env node
// P1-C01 captures for the visual self-review: the landing page at the owner's devices, its states, and after a resize,
// as JPG into docs/evidence/P1-C01/. Usage: node web/landing/tests/capture.mjs [--no-build]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { build, serve } from './lib/site.mjs';

const out = 'docs/evidence/P1-C01';
mkdirSync(out, { recursive: true });
const dist = process.argv.includes('--no-build') ? join(process.cwd(), 'web/dist-test/c01-root') : build('/', 'c01-root');
const site = await serve(dist, '/');
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 82 });
const SIZES = { 'phone-390x844': [390, 844], 'phone-landscape-844x390': [844, 390], 'phone-412x915': [412, 915], 'phone-small-375x667': [375, 667], 'tablet-820x1180': [820, 1180], 'laptop-1366x768': [1366, 768], 'tv-1920x1080': [1920, 1080] };
const problems = [];

for (const [engine, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    problems.push(`${name} unavailable: ${String(e.message).split('\n')[0]}`);
    continue;
  }
  const open = async (w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: name === 'chromium' && Math.min(w, h) < 500 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${name}: error ${e.message}`));
    page.on('response', (r) => r.status() >= 400 && problems.push(`${name}: ${r.status()} ${r.url()}`));
    await page.goto(site.origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  const prefix = name === 'chromium' ? '' : 'webkit-';
  for (const [label, [w, h]] of Object.entries(SIZES)) {
    if (name === 'webkit' && !['phone-390x844', 'phone-landscape-844x390'].includes(label)) continue;
    const page = await open(w, h);
    await shot(page, `${prefix}${label}`);
    await page.close();
  }
  if (name !== 'chromium') {
    await browser.close();
    continue;
  }
  // States at the phone size.
  let page = await open(390, 844);
  await page.locator('#code').pressSequentially('ab0d');
  await shot(page, 'state-invalid-char-390x844');
  await page.locator('#code').fill('');
  await page.getByRole('button', { name: 'Join a room' }).click();
  await shot(page, 'state-empty-submit-390x844');
  await page.locator('#code').fill('ab c');
  await page.locator('#code').dispatchEvent('input');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(100);
  await shot(page, 'state-keyboard-focus-390x844');
  await page.locator('#code').fill('');
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'state-scan-toast-390x844');
  await page.close();
  // Resize: phone portrait -> landscape -> TV, and TV -> phone, without reloading.
  page = await open(390, 844);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  await shot(page, 'resize-390x844-to-844x390');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(300);
  await shot(page, 'resize-to-tv-1920x1080');
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(300);
  await shot(page, 'resize-tv-to-412x915');
  await page.close();
  await browser.close();
}
await site.close();
console.log(problems.length ? `problems:\n  ${problems.join('\n  ')}` : 'captures written, no console/network problems');
