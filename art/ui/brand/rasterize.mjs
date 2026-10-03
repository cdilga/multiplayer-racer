#!/usr/bin/env node
// Helper for make.py: rasterise SVG files to PNG with Chromium (Playwright), no CDN, no network.
// Usage: node rasterize.mjs jobs.json   where jobs.json = [{ "svg": path, "out": path, "w": px, "h": px }, ...]
// Each SVG is drawn at exactly w x h CSS px on a transparent page (device scale 1), so 16 px and
// 32 px favicons are rendered natively rather than downscaled.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// Default Playwright browser; CHROMIUM_EXECUTABLE overrides it, and the full Chromium build is the
// fallback when only that is installed.
const exe = process.env.CHROMIUM_EXECUTABLE;
const browser = await (exe ? chromium.launch({ executablePath: exe }) : chromium.launch()).catch(() =>
  chromium.launch({ channel: 'chromium' }),
);
try {
  const page = await browser.newPage({ viewport: { width: 1, height: 1 }, deviceScaleFactor: 1 });
  for (const j of jobs) {
    const uri = `data:image/svg+xml;base64,${readFileSync(j.svg).toString('base64')}`;
    await page.setViewportSize({ width: j.w, height: j.h });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:${j.w}px;height:${j.h}px}</style><img id="i" src="${uri}">`,
    );
    await page.waitForFunction(() => {
      const i = document.getElementById('i');
      return i.complete && i.naturalWidth > 0;
    });
    await page.screenshot({ path: j.out, omitBackground: true, clip: { x: 0, y: 0, width: j.w, height: j.h } });
  }
} finally {
  await browser.close();
}
