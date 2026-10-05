#!/usr/bin/env node
// br-dim.3 (R111): the TV POC renders at CSS size x devicePixelRatio, not at CSS pixels.
// For deviceScaleFactor 1, 2, 3 (EMULATED by Playwright, not real high-DPR screens) at 412x915 and 1920x1080, on
// #grid&n=4/12/32: canvas.width/height == round(CSS x DPR), __poc.backing() agrees and is not clamped, and a tile's scene
// pixels are sharper than a forced 1x render (window.devicePixelRatio overridden to 1 on the same DPR screen, so the
// browser upscales exactly as it did before this change): Laplacian variance of the first tile's crop, native / forced.
// Writes docs/evidence/br-dim.3/poc-dpr-check.json plus poc-*.jpg crops. Run: node art/ui/poc/tv/dpr-check.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'br-dim.3');
mkdirSync(out, { recursive: true });
const failures = [];
const rows = [];

const lapVar = (png) => {
  const { width: w, height: h, data } = png;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let n = 0, s = 0, s2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const l = g[(y - 1) * w + x] + g[(y + 1) * w + x] + g[y * w + x - 1] + g[y * w + x + 1] - 4 * g[y * w + x];
    n++; s += l; s2 += l * l;
  }
  return s2 / n - (s / n) ** 2;
};

const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium' });

async function load(w, h, dpr, hash, forced1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  if (forced1) await ctx.addInitScript(() => Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 }));
  const page = await ctx.newPage();
  await page.goto(`${base}/poc/tv/index.html${hash}`);
  await page.waitForFunction((x) => window.__poc?.ready === true && window.__poc.hash === x, hash, { timeout: 30000 });
  await page.evaluate(() => { window.__poc.held = true; });
  await page.waitForTimeout(300);
  return { ctx, page };
}

async function tileCrop(page, dpr, name) {
  const v = await page.evaluate(() => { const t = window.__poc.views()[0]; return { x: t.x, y: t.y, w: t.w, h: t.h }; });
  const png = await page.screenshot({ clip: { x: v.x, y: v.y, width: v.w, height: v.h }, type: 'png' });
  const jpg = await page.screenshot({ clip: { x: v.x, y: v.y, width: v.w, height: v.h }, type: 'jpeg', quality: 90 });
  if (name) writeFileSync(join(out, name), jpg);
  return { v, lap: lapVar(PNG.sync.read(png)) };
}

for (const [w, h] of [[412, 915], [1920, 1080]]) {
  for (const n of [4, 12, 32]) {
    const hash = `#grid&n=${n}`;
    const lapByDpr = {};
    for (const dpr of [1, 2, 3]) {
      const a = await load(w, h, dpr, hash, false);
      const b = await a.page.evaluate(() => ({ backing: window.__poc.backing(), cssW: innerWidth, cssH: innerHeight, dpr: devicePixelRatio, cw: document.getElementById('world').width, ch: document.getElementById('world').height }));
      const wantW = Math.round(b.cssW * dpr), wantH = Math.round(b.cssH * dpr);
      const ok = b.cw === wantW && b.ch === wantH && b.backing.w === wantW && b.backing.h === wantH && !b.backing.clamped && b.dpr === dpr;
      if (!ok) failures.push(`${w}x${h} n=${n} dpr=${dpr}: canvas ${b.cw}x${b.ch} backing ${b.backing.w}x${b.backing.h}, want ${wantW}x${wantH}`);
      const nat = await tileCrop(a.page, dpr, n === 32 && dpr === 2 && w === 412 ? `poc-after-${w}x${h}-n32-dpr2.jpg` : null);
      await a.ctx.close();
      const f = await load(w, h, dpr, hash, true);
      const fb = await f.page.evaluate(() => ({ cw: document.getElementById('world').width, ch: document.getElementById('world').height }));
      const forcedOk = fb.cw === Math.round(b.cssW) && fb.ch === Math.round(b.cssH);
      if (!forcedOk) failures.push(`${w}x${h} n=${n} dpr=${dpr}: forced-1x baseline canvas ${fb.cw}x${fb.ch} is not CSS size`);
      const old = await tileCrop(f.page, dpr, n === 32 && dpr === 2 && w === 412 ? `poc-before-${w}x${h}-n32-dpr2.jpg` : null);
      await f.ctx.close();
      const ratio = old.lap > 0 ? nat.lap / old.lap : null;
      if (dpr > 1 && !(ratio > 1)) failures.push(`${w}x${h} n=${n} dpr=${dpr}: native not sharper (Laplacian var ${nat.lap.toFixed(1)} vs forced-1x ${old.lap.toFixed(1)})`);
      lapByDpr[dpr] = ratio;
      rows.push({ viewport: `${w}x${h}`, n, dpr, css: [b.cssW, b.cssH], canvas: [b.cw, b.ch], want: [wantW, wantH], clamped: b.backing.clamped, tile0_css: nat.v, lapVar_native: +nat.lap.toFixed(2), lapVar_forced1x: +old.lap.toFixed(2), sharper_x: ratio && +ratio.toFixed(2), canvas_ok: ok });
    }
  }
}
await browser.close();
close?.();
writeFileSync(join(out, 'poc-dpr-check.json'), JSON.stringify({ note: 'deviceScaleFactor is EMULATED (Playwright), headless chromium; forced-1x = window.devicePixelRatio overridden to 1 (the pre-R111 POC behaviour)', rows, failures }, null, 1));
console.log(rows.map((r) => `${r.viewport} n=${r.n} dpr=${r.dpr} canvas=${r.canvas} lapVar x${r.sharper_x}`).join('\n'));
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'ok');
process.exit(failures.length ? 1 : 0);
