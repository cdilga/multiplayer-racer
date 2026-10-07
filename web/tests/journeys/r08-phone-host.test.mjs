// P1-R08: the host page on a phone viewport (DPR 2-3, portrait and landscape) in a real room with four synthetic players:
// the lobby lists them, the race lays out four tiles with their HUD inside, the footer stays under the tiles, and the
// canvas backing store equals the on-screen size in device pixels. Synthetic controllers (no WebRTC). Chromium
// emulation, not a phone. Captures `phone-host-<state>-<orientation>` go to $JJ_CAPTURE_DIR (default docs/evidence/P1-R08).
//   JJ_CHROMIUM_GPU=1 node --test web/tests/journeys/r08-phone-host.test.mjs   (run on eris)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/r08/';
const CAPTURE = process.env.JJ_CAPTURE_DIR ?? resolve(import.meta.dirname, '../../../docs/evidence/P1-R08');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'r08'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
  mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

for (const dpr of [2, 3]) {
  for (const [orient, vp] of [
    ['portrait', { width: 412, height: 915 }],
    ['landscape', { width: 915, height: 412 }],
  ]) {
    test(`phone host DPR ${dpr} ${orient}: a real room's 4-player race is laid out and sharp`, { timeout: 300_000 }, async () => {
      const host = await (await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, hasTouch: true, isMobile: true })).newPage();
      const errors = [];
      host.on('pageerror', (e) => errors.push(e.message));
      try {
        await host.goto(`${server.origin}${BASE}host?room&test=live&laps=2`);
        await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
        for (let k = 1; k <= 4; k++) {
          await frame(host, `syn${k}`, { hello: true });
          await frame(host, `syn${k}`, { claim: `Racer ${k}` });
        }
        await wait(host, () => window.__jjRoom.view().seats.length === 4);
        await host.waitForSelector('.lcard');
        assert.equal(await host.locator('.lcard').count(), 4);
        if (dpr === 2) await host.screenshot({ path: `${CAPTURE}/phone-host-lobby-${orient}.png` });
        for (let k = 1; k <= 4; k++) await frame(host, `syn${k}`, { ready: true });
        await wait(host, () => window.__jjRoom.view().phase === 'Running');
        await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
        await wait(host, () => document.querySelectorAll('.hud-tile[data-seat]').length === 4);
        await host.waitForTimeout(1500);
        const r = await host.evaluate(() => {
          const rect = (e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height };
          };
          const c = document.querySelector('canvas');
          return {
            vw: innerWidth,
            vh: innerHeight,
            foot: rect(document.querySelector('.jj-foot')),
            boxes: [...document.querySelectorAll('.hud-tile[data-seat]')].map(rect),
            tiles: window.__jjRender.tileRects(),
            limitedBy: window.__jjRender.stats().limitedBy,
            scale: window.__jjRender.stats().scale ?? 1,
            canvas: { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight },
          };
        });
        await host.screenshot({ path: `${CAPTURE}/phone-host-race-${orient}-dpr${dpr}.png` });
        assert.equal(r.boxes.length, 4);
        for (const [i, b] of r.boxes.entries()) {
          assert.ok(b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= r.vw + 0.5 && b.y + b.h <= r.vh + 0.5, `tile ${i} on screen`);
          assert.ok(!overlap(b, r.foot), `tile ${i} clear of the footer`);
          for (let j = i + 1; j < r.boxes.length; j++) assert.ok(!overlap(b, r.boxes[j]), `tiles ${i}/${j} overlap`);
        }
        if (!r.limitedBy) {
          // A slow (software-rendered) host lowers its Render resolution to keep its frame budget (`scale` < 1, the
          // chip says "auto-lowered"): the backing store is then that fraction of the device pixels, still exactly.
          const px = dpr * r.scale;
          assert.ok(Math.abs(r.canvas.w - r.canvas.cssW * px) <= 1.5, `canvas width ${r.canvas.w} = ${r.canvas.cssW} css px x ${px}`);
          assert.ok(Math.abs(r.canvas.h - r.canvas.cssH * px) <= 1.5, `canvas height ${r.canvas.h} = ${r.canvas.cssH} css px x ${px}`);
          for (const t of r.tiles) {
            const b = r.boxes[t.seat - 1];
            assert.ok(Math.abs(t.w - b.w * px) <= 1.5 && Math.abs(t.h - b.h * px) <= 1.5, `tile ${t.seat} backing store = on-screen px x the Render resolution`);
          }
        }
        assert.deepEqual(errors, []);
      } finally {
        await host.context().close();
      }
    });
  }
}
