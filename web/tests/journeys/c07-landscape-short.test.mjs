// The play screen in a short landscape viewport (a phone with its browser chrome showing: about 844x340, 640x300 with a
// toolbar): nothing overlaps. The round banner clears the tools, the tools stay on one line with the name readable, each
// stick base sits inside its dashed zone, the boost meter keeps its track, and the page doesn't scroll.
// (From the Android lane's drive-android-g03-returned.png: banner over Leave, bases outside their zones, a solid meter.)
//   node --test web/tests/journeys/c07-landscape-short.test.mjs   (WebRTC: run on eris)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/c07short/';
const CAPTURE = process.env.JJ_CAPTURE_DIR;
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'c07short'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

test('at short landscape heights nothing overlaps on the play screen', { timeout: 180_000 }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await host.goto(`${server.origin}${BASE}host?room&test=live`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const page = await (await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } })).newPage();
  await page.goto(joinUrl);
  await wait(page, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await page.locator('#name').fill('Marlene');
  await page.getByRole('button', { name: 'Join the race' }).click();
  await wait(page, () => window.__jjController.inspect().phase === 'playing');
  await wait(page, () => window.__jjTutorial.inspect()?.open === true);
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await wait(page, () => /Tap Ready/.test(document.querySelector('[data-round-banner]')?.textContent ?? ''));

  for (const [w, h] of [[844, 390], [844, 340], [740, 360], [800, 300], [640, 300]]) {
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    await wait(page, () => document.querySelector('.screen.play') && /Tap Ready/.test(document.querySelector('[data-round-banner]')?.textContent ?? ''));
    if (CAPTURE) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(CAPTURE, { recursive: true });
      await page.screenshot({ path: `${CAPTURE}/c07-short-landscape-${w}x${h}.png` });
    }
    const m = await page.evaluate(() => {
      const r = (e) => {
        const b = e.getBoundingClientRect();
        return { l: b.left, t: b.top, r: b.right, b: b.bottom };
      };
      const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      const banner = r(document.querySelector('[data-round-banner]'));
      const tools = [...document.querySelectorAll('.tools .btn')].filter((b) => !b.hidden).map((b) => ({ n: b.textContent.trim(), ...r(b) }));
      const strip = r(document.querySelector('.strip'));
      const nm = document.querySelector('.strip .nm');
      const zones = [...document.querySelectorAll('.zone')].map((z) => ({ z: r(z), b: r(z.querySelector('.base')) }));
      const meter = document.querySelector('.pod .meter');
      const fill = meter.querySelector('i');
      return {
        banner,
        bannerHitsTools: tools.filter((t) => hit(banner, t)).map((t) => t.n),
        bannerHitsStrip: hit(banner, strip),
        bannerInside: banner.l >= 0 && banner.r <= innerWidth && banner.t >= 0 && banner.b <= innerHeight,
        toolsSpread: Math.max(...tools.map((t) => t.t)) - Math.min(...tools.map((t) => t.t)),
        toolsRight: Math.max(...tools.map((t) => t.r)),
        toolsClippedLeft: Math.min(...tools.map((t) => t.l)),
        toolsScroll: document.querySelector('.tools').scrollWidth - document.querySelector('.tools').clientWidth,
        nameCut: nm.scrollWidth > nm.clientWidth + 1,
        basesInside: zones.every(({ z, b }) => b.l >= z.l - 1 && b.r <= z.r + 1 && b.t >= z.t - 1 && b.b <= z.b + 1),
        meterTrack: fill.getBoundingClientRect().width < meter.getBoundingClientRect().width * 0.5,
        pageScroll: document.documentElement.scrollHeight - innerHeight,
        iw: innerWidth,
      };
    });
    const at = `${w}x${h}`;
    assert.deepEqual(m.bannerHitsTools, [], `${at}: the banner covers ${m.bannerHitsTools}`);
    assert.equal(m.bannerHitsStrip, false, `${at}: the banner sits on the strip`);
    assert.ok(m.bannerInside, `${at}: the banner is on screen`);
    assert.ok(m.toolsSpread < 6, `${at}: the tools wrapped (${m.toolsSpread}px apart)`);
    assert.ok(m.toolsRight <= m.iw + 1 && m.toolsClippedLeft >= 0, `${at}: tools run off the screen`);
    assert.ok(m.toolsScroll <= 1, `${at}: the tools row scrolls sideways (${m.toolsScroll}px hidden)`);
    assert.equal(m.nameCut, false, `${at}: the name is cut off`);
    assert.ok(m.basesInside, `${at}: a stick base overflows its zone`);
    assert.ok(m.meterTrack, `${at}: the boost meter has no track`);
    assert.ok(m.pageScroll <= 1, `${at}: the page scrolls by ${m.pageScroll}px`);
  }
});
