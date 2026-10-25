// Reproduce the POC shader/controls check against the shipped review page.
// node docs/evidence/P1-V-hawk-curves/review-probe.mjs [--base https://jammers-preview.dilger.dev] [--out <dir>]
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { serveArtUi } from '../../../art/ui/lib/serve.mjs';

const args = process.argv.slice(2);
const take = (flag, d) => args.includes(flag) ? args[args.indexOf(flag) + 1] : d;
const out = take('--out', 'docs/evidence/P1-V-hawk-curves/local-interactions');
const local = args.includes('--base') ? null : await serveArtUi();
const base = take('--base', local?.base);
await fs.mkdir(out, { recursive: true });
const results = [];
try {
  for (const [name, type, viewport] of [
    ['chromium', chromium, { width: 1366, height: 768 }],
    ['webkit', webkit, { width: 412, height: 915 }],
  ]) {
    const browser = await type.launch(name === 'chromium' ? { channel: 'chromium' } : {});
    try {
      const page = await browser.newPage({ viewport, hasTouch: name === 'webkit' });
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
      await page.goto(`${base}/poc/vehicles/review.html?v=hawk-dash`);
      await page.getByRole('button', { name: 'LOD0', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Spin', exact: true }).click();
      const stage = page.locator('#stage');
      await stage.scrollIntoViewIfNeeded();
      const capture = async (state) => {
        await page.waitForTimeout(250);
        const file = `${out}/${name}-${state}.png`;
        await stage.screenshot({ path: file });
        return file;
      };
      const files = [];
      for (const [lod, tris] of [[0, 2689], [1, 883], [2, 597]]) {
        await page.getByRole('button', { name: `LOD${lod}`, exact: true }).click();
        await page.waitForFunction((n) => document.querySelector('.vstats')?.textContent.includes(`${n} tris`), tris);
        files.push(await capture(`lod${lod}`));
      }
      await page.getByRole('button', { name: 'LOD0', exact: true }).click();
      for (const i of [1, 2, 3]) {
        await page.locator('button.swatch').nth(i).click();
        files.push(await capture(`paint${i}`));
      }
      for (const [label, state] of [['All loose', 'loose'], ['All detached', 'detached'], ['Intact', 'intact']]) {
        await page.getByRole('button', { name: label, exact: true }).click();
        files.push(await capture(state));
      }
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        brokenImages: [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src),
        controls: [...document.querySelectorAll('#controls button, #controls select')].length,
      }));
      assert.ok(layout.scrollWidth <= layout.viewport + 2);
      assert.deepEqual(layout.brokenImages, []);
      assert.deepEqual(problems, []);
      results.push({ browser: name, version: browser.version(), viewport, files, layout, problems });
    } finally { await browser.close(); }
  }
} finally {
  await local?.close();
  await fs.writeFile(`${out}/checks.json`, JSON.stringify({ base, results }, null, 2) + '\n');
}
console.log(`POC controls and assets passed in ${results.length} browser engines; inspect ${out}/*.png`);
