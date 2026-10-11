// P1-PT-chevrons: real kit pixel readability plus journaled placement in a generated round.
// JJ_CAPTURE_DIR adds the inspected close views and the phone/TV/chase/fullscreen matrix.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { build as buildPages } from '../../landing/tests/lib/site.mjs';
import { PNG } from 'pngjs';
import { serveReal, openHost } from './lib/surface.mjs';
import { chromiumArgs } from '../../tests/journeys/lib/chromium.mjs';

const root = resolve(import.meta.dirname, '../../..');
let browser, server, code;
const out = process.env.JJ_CAPTURE_DIR;
const report = { browser: '', hardware: `${process.platform}/${process.arch}`, shots: [], readability: {} };
before(async () => {
  const result = await build({ root: join(root, 'web'), logLevel: 'silent', configFile: false,
    build: { write: false, lib: { entry: join(import.meta.dirname, 'chevrons-capture-entry.ts'), formats: ['iife'], name: 'ChevronBundle' } } });
  code = (Array.isArray(result) ? result[0] : result).output[0].code;
  browser = await chromium.launch({ channel: process.env.JJ_CHROMIUM_GPU === 'native' ? 'chromium' : undefined, args: chromiumArgs });
  report.browser = `Chromium ${browser.version()}`;
  server = await serveReal(process.env.JJ_DIST ?? buildPages('/', 'chevrons'));
  if (out) mkdirSync(out, { recursive: true });
});
after(async () => {
  await browser?.close(); await server?.close();
  if (out) writeFileSync(join(out, 'browser-run.json'), `${JSON.stringify(report, null, 2)}\n`);
});
async function capture(page, name) {
  if (!out) return;
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 88 });
  report.shots.push(name);
}

test('one black chevron remains distinct from its yellow board in a 192x108 tile', async () => {
  const page = await browser.newPage({ viewport: { width: 192, height: 108 } });
  await page.setContent('<body style="margin:0"></body>');
  await page.addScriptTag({ content: code });
  report.renderer = (await page.evaluate(() => window.Chevron.draw(192, 108, 'front'))).renderer;
  const pixels = PNG.sync.read(await page.locator('canvas').screenshot());
  if (out) writeFileSync(join(out, 'readability.png'), PNG.sync.write(pixels));
  let yellow = 0, black = 0;
  // Central printed sheet only: no sky, post or outside board edge in this rectangle.
  for (let y = 26; y < 67; y++) for (let x = 83; x < 109; x++) {
    const at = (y * pixels.width + x) * 4, [r, g, b] = pixels.data.subarray(at, at + 3);
    if (r > 180 && g > 110 && b < 80) yellow++;
    if (r < 80 && g < 80 && b < 90) black++;
  }
  assert.ok(yellow > 150 && black > 40, `yellow field and black arrow remain readable: ${yellow}/${black}`);
  report.readability = { viewport: [192, 108], yellowPixels: yellow, blackPixels: black, scope: 'close board in smallest sample tile; distant boards still shrink naturally' };
  await capture(page, 'small-tile');
  for (const view of ['front', 'right', 'rear', 'side']) {
    await page.setViewportSize({ width: 720, height: 720 });
    await page.evaluate((view) => window.Chevron.draw(720, 720, view), view);
    await capture(page, `kit-${view}`);
  }
  await page.close();
});

test('generated corner row shows the raised single boards from the real chase camera and after fullscreen', { timeout: 180_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openHost(page, `${server.url}/host/?test=live&room&res=1&autores=off&laps=1`);
  await page.waitForFunction(() => window.__jjPrepare);
  await page.evaluate(() => window.__jjTest.join('Chevron check', { lobby: true }));
  await page.evaluate(() => window.__jjRoom.start());
  await page.waitForFunction(() => window.__jjPrepare.stats().committed === 1 && window.__jjRoom.view()?.phase === 'Running', null, { timeout: 90_000 });
  const setup = await page.evaluate(async () => {
    const s = window.__jjTest; await s.hold(true);
    const pts = window.__jjPrepare.mapInfo().route, n = pts.length;
    let target = 0, best = -1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 6) % n], c = pts[(i + 12) % n];
      const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
      const turn = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
      if (turn > best) [best, target] = [turn, i];
    }
    const at = (target - 8 + n) % n, [x, z, y] = pts[at], [nx, nz] = pts[(at + 1) % n];
    await s.command({ cmd: 'autopilot', on: false });
    await s.command({ cmd: 'place', car: 0, pose: { x, y: y + 0.05, z, headingDeg: Math.atan2(nx - x, nz - z) * 180 / Math.PI } });
    await s.step(120);
    return { target, at, turn: best, state: await s.observe() };
  });
  await page.waitForTimeout(1200);
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas.jj-world').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
  });
  const kit = await page.evaluate(() => window.__jjRender.map().kit);
  assert.ok(kit['wayfinding/chevron-post'] > 0, 'generated map contains real chevron instances');
  report.generated = { setup, kit, stats: await page.evaluate(() => window.__jjRender.stats()) };
  for (const [w, h] of [[1366, 768], [1920, 1080], [915, 412], [412, 915], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(600);
    await capture(page, `chase-${w}x${h}`);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('canvas.jj-world').click({ position: { x: 900, y: 400 } });
  await page.evaluate(() => document.documentElement.requestFullscreen());
  assert.ok(await page.evaluate(() => !!document.fullscreenElement));
  await page.waitForTimeout(600); await capture(page, 'chase-fullscreen');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(600); await capture(page, 'chase-after-fullscreen');
  assert.deepEqual(errors, []);
  await page.close();
});
