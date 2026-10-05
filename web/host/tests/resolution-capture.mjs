// P1-R (br-dim.3) measurement run (R111): native-pixel coverage at 3840x2160, scene vs tile device pixels at DPR 1/2/3, a
// sharpness metric against a deliberately 0.5-scaled render, the far car's on-screen size, and the frame cost (reported,
// never capped). Writes docs/evidence/br-dim.3/resolution-run.json and JPG captures.
//   npm --prefix web run build && node web/host/tests/resolution-capture.mjs          (headed Chrome if installed, else headless)
//   JJ_HEADLESS=1 forces headless Chromium. Emulated DPR (Playwright deviceScaleFactor) is labelled as emulated.
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const out = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/br-dim.3');
await mkdir(out, { recursive: true });
const server = await serve(join(repo, 'web/dist'));
let browser;
let mode = 'headless Chromium (SwiftShader/software GL)';
if (!process.env.JJ_HEADLESS) {
  try {
    browser = await chromium.launch({ headless: false, channel: 'chrome' });
    mode = 'headed Google Chrome (system GPU)';
  } catch (e) {
    console.error('headed Chrome unavailable, falling back to headless:', e.message.split('\n')[0]);
  }
}
browser ??= await chromium.launch();
const helper = await browser.newPage();

const q = (tiles, extra = '') => `?synthetic=32&freeze=300&map&tiles=${tiles}&autores=injected${extra}`;
async function open(query, viewport, dpr) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: dpr });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openHost(page, `${server.url}/host/${query}`);
  await page.waitForFunction(() => (window.__jjRender?.stats().frames ?? 0) >= 4, null, { timeout: 180_000 });
  return { page, errors };
}

/** Frame cost: rAF intervals over 90 frames (what the display loop sees; includes vsync pacing). */
const frameCost = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const dts = [];
        let last = performance.now();
        const step = (t) => {
          dts.push(t - last);
          last = t;
          if (dts.length < 91) requestAnimationFrame(step);
          else {
            const s = dts.slice(1).sort((a, b) => a - b);
            done({ frames: s.length, medianMs: +s[s.length >> 1].toFixed(2), p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(2), maxMs: +s.at(-1).toFixed(2) });
          }
        };
        requestAnimationFrame(step);
      }),
  );

/** Laplacian variance (mean over the tile rects, edge-inset) of a PNG screenshot, decoded in a helper page. */
async function sharpness(png, rects) {
  return helper.evaluate(
    async ([b64, rs]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const vars = [];
      for (const r of rs) {
        const [x, y, w, h] = [r.x + 4, r.y + 4, r.w - 8, r.h - 8];
        if (w < 8 || h < 8) continue;
        const d = g.getImageData(x, y, w, h).data;
        const gray = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        let sum = 0;
        let sum2 = 0;
        let n = 0;
        for (let j = 1; j < h - 1; j++)
          for (let i = 1; i < w - 1; i++) {
            const v = 4 * gray[j * w + i] - gray[j * w + i - 1] - gray[j * w + i + 1] - gray[(j - 1) * w + i] - gray[(j + 1) * w + i];
            sum += v;
            sum2 += v * v;
            n++;
          }
        vars.push(sum2 / n - (sum / n) ** 2);
      }
      return { imgW: img.width, imgH: img.height, tiles: vars.length, meanLaplacianVar: +(vars.reduce((a, b) => a + b, 0) / vars.length).toFixed(2) };
    },
    [png.toString('base64'), rects],
  );
}

const run = {
  label: 'P1-R br-dim.3 resolution run (R111)',
  hardware: `${cpus()[0]?.model ?? '?'} x${cpus().length}, ${platform()}/${arch()}`,
  browser: `${mode}, Chromium ${browser.version()} (Playwright)`,
  dprNote: 'DPR other than the machine’s own is EMULATED by Playwright deviceScaleFactor; not a real high-DPR display or phone.',
  coverage: [],
  dprMatrix: [],
  errors: [],
};

// R111 coverage: tile backing-store pixels vs the display's pixel grid.
for (const [name, viewport, dpr] of [
  ['3840x2160 CSS @ DPR 1', { width: 3840, height: 2160 }, 1],
  ['1920x1080 CSS @ DPR 2 (emulated)', { width: 1920, height: 1080 }, 2],
]) {
  for (const tiles of [1, 4, 12, 32]) {
    const { page, errors } = await open(q(tiles), viewport, dpr);
    const m = await page.evaluate(() => ({
      s: window.__jjRender.stats(),
      rects: window.__jjRender.tileRects(),
      canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height],
      inner: [innerWidth, innerHeight, devicePixelRatio],
    }));
    const display = [Math.round(m.inner[0] * m.inner[2]), Math.round(m.inner[1] * m.inner[2])];
    const canvasPx = m.canvas[0] * m.canvas[1];
    const tilePx = m.rects.reduce((a, r) => a + r.w * r.h, 0);
    const inside = m.rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= m.canvas[0] && r.y + r.h <= m.canvas[1]);
    run.coverage.push({
      display: name,
      tiles,
      displayGrid: display,
      canvasBackingStore: m.canvas,
      canvasEqualsDisplayGrid: m.canvas[0] === display[0] && m.canvas[1] === display[1],
      resolution: m.s.resolution,
      limitedBy: m.s.limitedBy,
      displayPixels: display[0] * display[1],
      canvasPixels: canvasPx,
      tileBackingPixels: tilePx,
      tileShareOfDisplayPct: +((tilePx / (display[0] * display[1])) * 100).toFixed(1),
      note: 'the rest is the 5 % safe margin, gutters and spare cells (QR/code), drawn in the same backing store',
      tilesInsideCanvas: inside,
      frameCost: await frameCost(page),
    });
    if (tiles === 12) await page.screenshot({ path: join(out, `coverage-${dpr === 1 ? '4k-dpr1' : '1080css-dpr2'}-12tiles.jpg`), type: 'jpeg', quality: 70 });
    run.errors.push(...errors);
    await page.close();
  }
}

// Scene pixels == tile device pixels, and sharpness native vs deliberately 0.5-scaled, DPR 1/2/3.
for (const dpr of [1, 2, 3]) {
  for (const tiles of [4, 12, 32]) {
    const row = { dpr, dprEmulated: dpr !== 1, tiles, viewportCss: [1280, 720] };
    for (const [label, extra] of [['native', ''], ['half', '&res=0.5']]) {
      const { page, errors } = await open(q(tiles, extra), { width: 1280, height: 720 }, dpr);
      const m = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        const r = c.getBoundingClientRect();
        return { s: window.__jjRender.stats(), rects: window.__jjRender.tileRects(), far: window.__jjRender.farCars(), css: [r.width, r.height], canvas: [c.width, c.height] };
      });
      const png = await page.screenshot({ type: 'png' });
      // Screenshot is in device pixels; rects are in backing-store pixels (smaller than that at 0.5).
      const [fx, fy] = [(m.css[0] * dpr) / m.canvas[0], (m.css[1] * dpr) / m.canvas[1]];
      const sharp = await sharpness(png, m.rects.map((r) => ({ x: Math.round(r.x * fx), y: Math.round(r.y * fy), w: Math.round(r.w * fx), h: Math.round(r.h * fy) })));
      row[label] = {
        backingStore: m.canvas,
        canvasCssDevicePx: [Math.round(m.css[0] * dpr), Math.round(m.css[1] * dpr)],
        backingToDevicePxRatio: [+(m.canvas[0] / (m.css[0] * dpr)).toFixed(3), +(m.canvas[1] / (m.css[1] * dpr)).toFixed(3)],
        sceneEqualsDeviceGrid: m.canvas[0] === Math.round(m.css[0] * dpr) && m.canvas[1] === Math.round(m.css[1] * dpr),
        resolution: m.s.resolution,
        screenshotPx: [sharp.imgW, sharp.imgH],
        sharpnessLaplacianVar: sharp.meanLaplacianVar,
        farCar: label === 'native' ? summariseFar(m.far) : undefined,
        frameCost: label === 'native' ? await frameCost(page) : undefined,
      };
      if (label === 'native' && tiles === 12 && dpr === 2) {
        await page.getByTestId('render-chip').click();
        await page.screenshot({ path: join(out, 'dpr2-12tiles-setting-open.jpg'), type: 'jpeg', quality: 75 });
        await page.keyboard.press('Escape');
      }
      if (label === 'native' && tiles === 12) await page.screenshot({ path: join(out, `dpr${dpr}-12tiles-native.jpg`), type: 'jpeg', quality: 75 });
      if (label === 'half' && tiles === 12) await page.screenshot({ path: join(out, `dpr${dpr}-12tiles-half.jpg`), type: 'jpeg', quality: 75 });
      if (label === 'native' && tiles === 32 && dpr === 3) await page.screenshot({ path: join(out, 'dpr3-32tiles-native.jpg'), type: 'jpeg', quality: 75 });
      run.errors.push(...errors);
      await page.close();
    }
    row.sharpnessNativeOverHalf = +(row.native.sharpnessLaplacianVar / row.half.sharpnessLaplacianVar).toFixed(2);
    run.dprMatrix.push(row);
  }
}

function summariseFar(far) {
  const seen = far.filter((t) => t.visible > 0);
  return {
    tilesWithOtherCarsVisible: seen.length,
    smallestCarPxAcrossTiles: seen.length ? Math.min(...seen.map((t) => t.minPx)) : null,
    largestFarthestCarM: seen.length ? Math.max(...seen.map((t) => t.farthestM)) : null,
    perTileMinPx: seen.map((t) => t.minPx),
  };
}

await writeFile(join(out, 'resolution-run.json'), `${JSON.stringify(run, null, 2)}\n`);
await browser.close();
server.close();
console.log(`wrote ${join(out, 'resolution-run.json')}; errors: ${run.errors.length}`);
