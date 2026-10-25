// Run from repository root; omit --base to serve the actual POC checkout locally.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { serveArtUi } from '../../../art/ui/lib/serve.mjs';

const args = process.argv.slice(2);
const baseFlag = args.indexOf('--base');
const site = baseFlag < 0 ? await serveArtUi() : { base: args[baseFlag + 1], close: async () => {} };
const out = `docs/evidence/P1-PROMO-poc/${baseFlag < 0 ? 'local' : 'deployed'}`;
mkdirSync(out, { recursive: true });
const results = [];
try {
  for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await engine.launch(name === 'Chromium' ? { channel: 'chromium' } : {});
    try {
      for (const [width, height] of [[412, 915], [1920, 1080]]) {
        const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 500, isMobile: width < 500 });
        const errors = [], videoResponses = [], videoRequests = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => { if (r.url().endsWith('.mp4')) videoRequests.push(r.url()); });
        page.on('response', r => { if (r.url().endsWith('.mp4')) videoResponses.push({ status: r.status(), type: r.headers()['content-type'] }); });
        await page.goto(`${site.base}/poc/#g-promo`);
        const video = page.locator('#g-promo video');
        await video.waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await video.evaluate(v => v.paused), true);
        assert.equal(videoRequests.length, 0, 'MP4 must not download before interaction');
        assert.equal(await page.locator('#g-promo a[download]').getAttribute('href'), await page.locator('#g-promo source').getAttribute('src'));
        await page.locator('#g-promo').screenshot({ path: `${out}/${name}-${width}-poster.png` });
        await video.click();
        await video.evaluate(v => v.play());
        await page.waitForFunction(() => document.querySelector('video').currentTime > 0.25);
        await video.evaluate(v => { v.pause(); v.currentTime = 45; });
        await page.waitForFunction(() => {
          const v = document.querySelector('video');
          return !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - 45) < 0.5;
        });
        const media = await video.evaluate(v => ({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, currentTime: v.currentTime, error: v.error?.message ?? null }));
        assert.equal(media.error, null);
        assert.equal(media.width, 1280);
        assert.equal(media.height, 720);
        assert.ok(media.duration > 59 && media.duration < 61);
        assert.ok(videoResponses.some(r => [200, 206].includes(r.status) && r.type?.startsWith('video/mp4')));
        assert.deepEqual(errors, []);
        await page.locator('#g-promo').screenshot({ path: `${out}/${name}-${width}-seek.png` });
        results.push({ browser: name, version: browser.version(), viewport: { width, height }, media, videoResponses, noAutoload: true, download: true, pass: true });
        await page.close();
      }
    } finally { await browser.close(); }
  }
} finally {
  writeFileSync(`${out}/playback.json`, `${JSON.stringify({ base: site.base, checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
  await site.close();
}
console.log(JSON.stringify(results));
