// Crowded nameplate changes must keep every label without forcing browser layout once per label (br-dsq4).
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { build } from '../../node_modules/vite/dist/node/index.js';
import { serve } from './lib/surface.mjs';

test('crowded nameplates retain every label and batch browser layout on creation and style changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jj-nameplates-'));
  let browser, server;
  try {
    const module = resolve(import.meta.dirname, '../src/identity/nameplates.ts');
    await writeFile(join(dir, 'index.html'), '<script type="module" src="/probe.mjs"></script>');
    await writeFile(join(dir, 'probe.mjs'), `
      import { mountNameplates } from ${JSON.stringify(module)};
      const root = document.createElement('div'); document.body.append(root);
      const world = { vehicles: { numberOf: i => i + 1, nameOf: i => 'Racer ' + (i + 1), paintOf: () => '#2563eb' } };
      mountNameplates(root, world);
      window.paint = font => {
        const points = [];
        for (let tile = 1; tile <= 20; tile++) for (let car = 0; car < 50; car++) {
          const x = ((tile - 1) % 10) * 192, y = Math.floor((tile - 1) / 10) * 90;
          points.push({ tile, car, id: car, x: x + 96, y: y + 40, carX: x + 96, carY: y + 65, font,
            clip: { left: x, right: x + 192, top: y, bottom: y + 90 } });
        }
        world.onNameplates(points);
        return [...root.querySelectorAll('.identity-nameplate')].map(e => {
          const r = e.getBoundingClientRect();
          return { tile: Number(e.dataset.tile), car: Number(e.dataset.car), text: e.textContent,
            x: r.x, y: r.y, w: r.width, h: r.height };
        });
      };
    `);
    await build({ root: dir, configFile: false, publicDir: false, logLevel: 'silent', build: { outDir: join(dir, 'dist') } });
    server = await serve(join(dir, 'dist'));
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(server.url);
    await page.waitForFunction(() => window.paint);
    await page.evaluate(() => document.fonts.load('900 italic 18px "Barlow Condensed"'));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'LayoutCount').value;
    for (const font of [14, 18, 18]) {
      const before = await layouts();
      const labels = await page.evaluate(font => window.paint(font), font);
      const count = (await layouts()) - before;
      assert.ok(count <= 10, `browser layout is batched, not per label: ${count} layouts for ${labels.length} labels`);
      assert.equal(labels.length, 1000, 'all labels retained in all 20 viewports');
      assert.equal(new Set(labels.map(l => `${l.tile}:${l.car}`)).size, 1000);
      for (const label of labels) {
        assert.equal(label.text, `#${label.car + 1}${font >= 18 ? ` Racer ${label.car + 1}` : ''}`);
        const x = ((label.tile - 1) % 10) * 192;
        assert.ok(label.w > 0 && label.h > 0);
        assert.ok(Number.isFinite(label.x) && Number.isFinite(label.y));
        assert.ok(label.x >= x - 0.1 && label.x + label.w <= x + 192.1, 'label stays within its viewport horizontally');
      }
    }
  } finally {
    await browser?.close();
    server?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
