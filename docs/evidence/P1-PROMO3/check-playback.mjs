// P1-PROMO3: the POC trailer player. Run from the repository root; omit --base to serve the POC checkout locally.
// No MP4 request before interaction, real playback, a seek into the 64-tile grid, the captions track loads, 1080p
// media, Chromium and WebKit at phone and TV sizes. (WebKit is Playwright WebKit, not Safari.)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { serveArtUi } from '../../../art/ui/lib/serve.mjs';

const args = process.argv.slice(2);
const baseFlag = args.indexOf('--base');
const site = baseFlag < 0 ? await serveArtUi() : { base: args[baseFlag + 1], close: async () => {} };
const out = `docs/evidence/P1-PROMO3/${baseFlag < 0 ? 'local' : 'deployed'}`;
mkdirSync(out, { recursive: true });
const SEEK = 16;
const results = [];
try {
  for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await engine.launch(name === 'Chromium' ? { channel: 'chromium' } : {});
    try {
      for (const [width, height] of [[412, 915], [1920, 1080]]) {
        const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 500, isMobile: width < 500 });
        const errors = [], videoRequests = [], videoResponses = [], vtt = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => { if (r.url().endsWith('.mp4')) videoRequests.push(r.url()); });
        page.on('response', (r) => {
          if (r.url().endsWith('.mp4')) videoResponses.push({ status: r.status(), type: r.headers()['content-type'] });
          if (r.url().endsWith('.vtt')) vtt.push({ status: r.status(), type: r.headers()['content-type'] });
        });
        await page.goto(`${site.base}/poc/#g-promo`);
        const entry = page.locator('[data-entry=promo-stevo]');
        const video = entry.locator('video');
        await video.waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await video.evaluate((v) => v.paused), true);
        assert.equal(videoRequests.length, 0, 'no MP4 may download before interaction');
        assert.equal(await entry.locator('a[download]').first().getAttribute('href'), await entry.locator('source').getAttribute('src'));
        await entry.screenshot({ path: `${out}/${name}-${width}-poster.png` });
        await video.evaluate((v) => { v.textTracks[0].mode = 'hidden'; });
        await video.click();
        await video.evaluate((v) => v.play());
        await page.waitForFunction(() => document.querySelector('[data-entry=promo-stevo] video').currentTime > 0.25);
        await video.evaluate((v, t) => { v.pause(); v.currentTime = t; }, SEEK);
        await page.waitForFunction((t) => {
          const v = document.querySelector('[data-entry=promo-stevo] video');
          return !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - t) < 0.5;
        }, SEEK);
        await page.waitForFunction(() => (document.querySelector('[data-entry=promo-stevo] video').textTracks[0].cues?.length ?? 0) > 0);
        const media = await video.evaluate((v) => ({
          duration: v.duration, width: v.videoWidth, height: v.videoHeight, currentTime: v.currentTime, error: v.error?.message ?? null,
          cues: v.textTracks[0].cues.length, activeCue: v.textTracks[0].activeCues?.[0]?.text ?? null,
        }));
        assert.equal(media.error, null);
        assert.equal(media.width, 1920);
        assert.equal(media.height, 1080);
        assert.ok(media.duration > 57 && media.duration < 61, `duration ${media.duration}`);
        assert.equal(media.cues, 11);
        assert.ok(videoResponses.some((r) => [200, 206].includes(r.status) && r.type?.startsWith('video/mp4')));
        assert.ok(vtt.some((r) => r.status === 200 && r.type?.startsWith('text/vtt')), `captions served as text/vtt: ${JSON.stringify(vtt)}`);
        assert.deepEqual(errors, []);
        await entry.screenshot({ path: `${out}/${name}-${width}-seek.png` });
        results.push({ browser: name, version: browser.version(), viewport: { width, height }, media, videoResponses, vtt, noAutoload: true, pass: true });
        await page.close();
      }
    } finally { await browser.close(); }
  }
} finally {
  writeFileSync(`${out}/playback.json`, `${JSON.stringify({ base: site.base, checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
  await site.close();
}
console.log(JSON.stringify(results.map((r) => [r.browser, r.viewport.width, r.media.activeCue])));
