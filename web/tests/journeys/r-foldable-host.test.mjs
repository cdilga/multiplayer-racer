// br-8qen (P1-R-foldable): an unfolded foldable (Galaxy Z Fold, Pixel Fold) hosting a race. Its near-square viewport,
// about 673x841 portrait and 841x673 landscape, is the size the grid and the results screen are most likely to get wrong.
// A real room (`host?room&test=live`) races with 1, then 2, 3 and 4 seats (each new one drops in mid-race); at both sizes
// there is a tile per seat, the tiles sit on the canvas without overlapping, each tile's HUD is on screen and the page
// doesn't scroll sideways. Then the race finishes, and the results screen's list and buttons are on screen at both sizes.
// Chromium and WebKit. JJ_CAPTURE_DIR=<dir> keeps a still per step.
//   node --test web/tests/journeys/r-foldable-host.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

const BASE = '/p/rfold/';
const OUT = process.env.JJ_CAPTURE_DIR;
export const FOLDABLE = [[673, 841], [841, 673]];
let server;
before(async () => {
  server = await serve(build('./', 'rfold'), BASE, { JJ_STUN_URLS: '' });
  if (OUT) mkdirSync(OUT, { recursive: true });
});
after(async () => {
  await server?.close();
});

const wait = (page, fn, arg, ms = 90_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frames = (host, list) => host.evaluate(async (list) => {
  for (const [endpoint, frame] of list) window.__jjTest.input({ type: 'controller', endpoint, frame });
  await window.__jjTest.step(1);
}, list);

// Tiles on the backing store (device px) and their HUDs in the page, after a painted frame at this size.
const layout = (host) => host.evaluate(() => {
  const dpr = devicePixelRatio, rects = (window.__jjRender.tileRects() ?? []).map((r) => ({ ...r, x: r.x / dpr, y: r.y / dpr, w: r.w / dpr, h: r.h / dpr }));
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  const meet = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const huds = [...document.querySelectorAll('.hud-tile')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect());
  return {
    tiles: rects.length,
    offCanvas: rects.filter((r) => r.x < -1 || r.y < -1 || r.x + r.w > canvas.width + 1 || r.y + r.h > canvas.height + 1).length,
    overlaps: rects.flatMap((a, i) => rects.slice(i + 1).filter((b) => meet(a, b))).length,
    huds: huds.length,
    hudsOffScreen: huds.filter((r) => r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1).length,
    sideScroll: document.documentElement.scrollWidth > innerWidth + 1,
  };
});

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${engine}: a foldable host shows 1-4 race tiles and the results on screen, folded out both ways`, { timeout: 600_000 }, async () => {
    const browser = await type.launch(engine === 'chromium' ? { args: chromiumArgs } : {});
    try {
      const host = await (await browser.newContext({ viewport: { width: 841, height: 673 } })).newPage();
      const errors = [];
      host.on('pageerror', (e) => errors.push(e.message));
      await host.goto(`${server.origin}${BASE}host?room&test=live&laps=99`);
      await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby', undefined, 120_000);
      await frames(host, [['f1', { hello: true }], ['f1', { claim: 'Racer 1' }]]);
      await wait(host, () => window.__jjRoom.view().seats.length === 1);
      await frames(host, [['f1', { ready: true }]]);
      await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 180_000);
      for (let n = 1; n <= 4; n++) {
        if (n > 1) await frames(host, [[`f${n}`, { hello: true }], [`f${n}`, { claim: `Racer ${n}` }]]);
        await wait(host, (n) => window.__jjRoom.view().seats.filter((s) => s.car !== null && s.car !== undefined).length === n, n, 60_000);
        for (const [width, height] of FOLDABLE) {
          await host.setViewportSize({ width, height });
          await wait(host, (n) => { window.__jjRender.frame(); return (window.__jjRender.tileRects() ?? []).length === n && document.querySelectorAll('.hud-tile').length >= n; }, n, 30_000);
          const l = await layout(host);
          assert.deepEqual(l, { tiles: n, offCanvas: 0, overlaps: 0, huds: n, hudsOffScreen: 0, sideScroll: false }, `${engine} ${n} tiles ${width}x${height}: ${JSON.stringify(l)}`);
          if (OUT) await host.screenshot({ path: `${OUT}/${engine}-race-${n}-tiles-${width}x${height}.jpg`, type: 'jpeg', quality: 80 });
        }
      }

      await host.evaluate(() => window.__jjTest.command({ cmd: 'finishRace' }));
      await wait(host, () => window.__jjRoom.view().phase === 'Intermission', undefined, 180_000);
      await wait(host, () => document.querySelector('[data-screen=results] [data-act=start]'));
      await host.evaluate(() => window.__jjTest.hold(true));
      for (const [width, height] of FOLDABLE) {
        await host.setViewportSize({ width, height });
        await host.waitForTimeout(300);
        const r = await host.evaluate(() => {
          const on = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1; };
          const rows = [...document.querySelectorAll('[data-results] > *')];
          return {
            buttons: [...document.querySelectorAll('[data-screen=results] [data-act]')].filter((e) => e.offsetParent).every(on),
            rows: rows.length,
            rowsOn: rows.filter(on).length,
            sideScroll: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        assert.deepEqual(r, { buttons: true, rows: r.rows, rowsOn: r.rows, sideScroll: false }, `${engine} results ${width}x${height}: ${JSON.stringify(r)}`);
        assert.ok(r.rows >= 4, `${engine} results ${width}x${height}: a row per racer (${r.rows})`);
        if (OUT) await host.screenshot({ path: `${OUT}/${engine}-results-${width}x${height}.jpg`, type: 'jpeg', quality: 80 });
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}
