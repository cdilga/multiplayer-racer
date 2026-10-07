// R03's "distinguishable surfaces" rule on a generated four-biome map (P1-M06/M08b): the graded dirt road reads against the
// red-earth ground from the chase camera, at 1080p and at a small tile's size. The same distance as map.test.mjs's greybox
// test (CIE76 on screenshot pixels), but the spots are found in the picture itself: `world.project` projects through the
// overview camera, not a chase tile's, so on a row above the car the road is whatever lies between the nearest cream edge
// lines left and right of the centre, and the ground is what lies just outside them.
// The real host page (test build), a generated Playtest-1 track, one player on the autopilot stepped to the middle of the dirt stretch.
//   scripts/build-host-wasm.sh && npm --prefix web run build && node --test web/host/tests/readability.test.mjs
// (JJ_DIST serves another build.) Writes docs/evidence/P1-M06/readability.json and a capture per viewport (JJ_EVIDENCE_DIR overrides).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-M06');
const runs = {};
let browser;
let server;

before(async () => {
  browser = await chromium.launch();
  server = await serve(process.env.JJ_DIST ?? join(repo, 'web/dist'));
  await mkdir(evidenceDir, { recursive: true });
});

after(async () => {
  await browser?.close();
  server?.close();
  await writeFile(join(evidenceDir, 'readability.json'), `${JSON.stringify({ browser: `Chromium ${browser.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}`, ...runs }, null, 2)}\n`);
});

/** CIE76 distance between two sRGB colours (the same as map.test.mjs). */
function deltaE([r1, g1, b1], [r2, g2, b2]) {
  const lab = (r, g, b) => {
    const f = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [R, G, B] = [f(r), f(g), f(b)];
    const [x, y, z] = [(R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.9505, R * 0.2126 + G * 0.7152 + B * 0.0722, (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.089];
    const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * h(y) - 16, 500 * (h(x) - h(y)), 200 * (h(y) - h(z))];
  };
  const [a, b] = [lab(r1, g1, b1), lab(r2, g2, b2)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

async function dirtView(width, height, name) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openHost(page, `${server.url}/host/?test=live&room&res=1&autores=off&laps=1`);
  await page.waitForFunction(() => window.__jjPrepare !== undefined, null, { timeout: 60_000 });
  await page.evaluate(() => window.__jjTest.join('Ava', { lobby: true }));
  await page.evaluate(() => window.__jjRoom.start());
  await page.waitForFunction(() => window.__jjPrepare.stats().committed === 1, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__jjRoom.view()?.phase === 'Running', null, { timeout: 60_000 });
  await page.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  // Step to the middle of the dirt stretch; the road ahead of the car is then the dirt road.
  const reached = await page.evaluate(async () => {
    const info = window.__jjPrepare.mapInfo();
    const dirt = info.segments.find((s) => s.name === 'outback-dirt');
    const target = Math.round((dirt.from + dirt.to) / 2);
    const nearest = (p) => {
      let best = 0;
      let d = Infinity;
      info.route.forEach(([x, z], i) => {
        const dd = (x - p[0]) ** 2 + (z - p[2]) ** 2;
        if (dd < d) [d, best] = [dd, i];
      });
      return best;
    };
    const r = await window.__jjTest.untilFact((s) => Math.abs(nearest(s.cars[0].position) - target) <= 2, { maxTicks: 40_000, every: 20 });
    const here = nearest(r.state.cars[0].position);
    return { held: r.held, here, onDirt: here >= dirt.from && here <= dirt.to };
  });
  await new Promise((r) => setTimeout(r, 1_200));
  const png = await page.screenshot();
  await writeFile(join(evidenceDir, `readability-${name}.png`), png);
  const sampled = await page.evaluate(
    async ([b64, w, h]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height).getContext('2d');
      c.drawImage(img, 0, 0);
      const cream = (p) => p[0] > 225 && p[1] > 218 && p[2] > 195 && p[0] - p[2] < 60;
      const rows = [0.5, 0.54, 0.58, 0.62].map((f) => Math.round(h * f));
      const roads = [];
      const grounds = [];
      const found = [];
      for (const y of rows) {
        const row = c.getImageData(0, y, w, 1).data;
        const px = (x) => [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]];
        const mid = Math.round(w / 2);
        let l = mid;
        while (l > 2 && !cream(px(l))) l--;
        let r = mid;
        while (r < w - 3 && !cream(px(r))) r++;
        if (l <= 2 || r >= w - 3 || r - l < w * 0.08) continue;
        found.push([y, l, r]);
        const step = Math.max(2, Math.round((r - l) / 24));
        for (let x = l + Math.round((r - l) * 0.15); x < r - Math.round((r - l) * 0.15); x += step) roads.push(px(x));
        const gap = Math.max(10, Math.round(w * 0.015));
        for (const x of [l - gap, l - 2 * gap, l - 3 * gap, r + gap, r + 2 * gap, r + 3 * gap]) if (x > 2 && x < w - 3) grounds.push(px(x));
      }
      return { roads, grounds, found };
    },
    [png.toString('base64'), width, height],
  );
  await page.close();
  assert.deepEqual(errors, []);
  assert.ok(reached.held && reached.onDirt, `the car is on the dirt stretch: ${JSON.stringify(reached)}`);
  assert.ok(sampled.roads.length >= 12 && sampled.grounds.length >= 8, `road (${sampled.roads.length}) and ground (${sampled.grounds.length}) samples found between the edge lines: ${JSON.stringify(sampled.found)}`);
  const colour = (px) => [0, 1, 2].map((ch) => median(px.map((p) => p[ch])));
  const [road, ground] = [colour(sampled.roads), colour(sampled.grounds)];
  return { viewport: [width, height], road, ground, deltaE: +deltaE(road, ground).toFixed(1), roadSamples: sampled.roads.length, groundSamples: sampled.grounds.length, rows: sampled.found };
}

test('the graded dirt road is clearly distinguishable from the red-earth ground at 1080p and in a small tile', { timeout: 180_000 }, async () => {
  for (const [w, h, name] of [[1920, 1080, '1080p'], [640, 360, 'small-tile']]) {
    const r = await dirtView(w, h, name);
    runs[name] = r;
    // Clearly distinguishable: well past the greybox test's ΔE 20 (the road also has its cream edge lines).
    assert.ok(r.deltaE >= 25, `dirt road and red-earth ground at ${name}: ΔE ${r.deltaE} (road ${r.road}, ground ${r.ground})`);
  }
});
