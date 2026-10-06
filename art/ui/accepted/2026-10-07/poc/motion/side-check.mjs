#!/usr/bin/env node
// P1-U05.6 (POC2-15) evidence: the side-by-side reel (side.html) plays Full and Reduced together, and they look different.
// Samples both sides every frame through the countdown and Identify: the exposure flash's opacity, the countdown number's
// scale and the Identify label's scale and the tile border, then captures matched stills and a video of the two playing.
// Run: node art/ui/poc/motion/side-check.mjs   Output: docs/evidence/P1-U05.6/ (JJ_EVIDENCE_DIR overrides)
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U05.6');
mkdirSync(join(out, 'side'), { recursive: true });
rmSync(join(out, 'video-tmp'), { recursive: true, force: true });
const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 620 }, recordVideo: { dir: join(out, 'video-tmp'), size: { width: 1600, height: 620 } } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/poc/motion/side.html?autoplay=0`);
await page.waitForFunction(() => window.sideReady?.() === true, null, { timeout: 90000 });
await page.waitForTimeout(500);

// One side's visible state now: the countdown flash and number, the Identify flash, label and border.
const probe = () => {
  const read = (id) => {
    const d = document.getElementById(id).contentDocument;
    const op = (sel) => { const e = d.querySelector(sel); return e ? +getComputedStyle(e).opacity : null; };
    const sc = (sel) => { const e = d.querySelector(sel); if (!e) return null; const m = getComputedStyle(e).transform; if (!m || m === 'none') return 1; const v = m.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number); return v ? +Math.hypot(v[0], v[1]).toFixed(3) : 1; };
    return { cdFlash: op('.cd-flash .flash'), cdScale: sc('.cd-flash b'), idFlash: op('.cooee .flash'), idScale: sc('.cooee b'), ring: d.querySelector('.tile[style*="--ring"]')?.style.getPropertyValue('--ring') ?? null };
  };
  return { full: read('full'), reduced: read('reduced') };
};
await page.evaluate(() => { window.__samples = []; for (const id of ['full', 'reduced']) document.getElementById(id).contentWindow.__reel.playAll(); });
const samples = [];
const stills = [];
const t0 = Date.now();
while (Date.now() - t0 < 26000) {
  const s = await page.evaluate(probe);
  samples.push({ t: Date.now() - t0, ...s });
  const shoot = (tag) => { if (!stills.some((x) => x.tag === tag)) stills.push({ tag, at: Date.now() - t0, file: `side/${tag}.jpg` }); return page.screenshot({ path: join(out, 'side', `${tag}.jpg`), type: 'jpeg', quality: 82 }); };
  if (s.full.cdFlash > 0.6 && !stills.some((x) => x.tag === 'countdown-flash')) await shoot('countdown-flash');
  if (s.full.idFlash > 0.6 && !stills.some((x) => x.tag === 'identify-flash')) await shoot('identify-flash');
  await page.waitForTimeout(30);
}
const path = await page.video().path();
await ctx.close();
renameSync(path, join(out, 'side-by-side.webm'));
rmSync(join(out, 'video-tmp'), { recursive: true, force: true });
await browser.close();
await close();

const max = (side, k) => Math.max(0, ...samples.map((s) => s[side][k]).filter((v) => v != null && !Number.isNaN(+v)).map(Number));
const summary = {
  full: { countdownFlashMax: max('full', 'cdFlash'), countdownScaleMax: max('full', 'cdScale'), identifyFlashMax: max('full', 'idFlash'), identifyScaleMax: max('full', 'idScale') },
  reduced: { countdownFlashMax: max('reduced', 'cdFlash'), countdownScaleMax: max('reduced', 'cdScale'), identifyFlashMax: max('reduced', 'idFlash'), identifyScaleMax: max('reduced', 'idScale') },
};
const pass = summary.full.countdownFlashMax > 0.6 && summary.reduced.countdownFlashMax === 0 && summary.full.identifyFlashMax > 0.6 && summary.reduced.identifyFlashMax === 0
  && summary.full.countdownScaleMax > 1.05 && summary.reduced.countdownScaleMax <= 1.001 && errors.length === 0 && stills.length === 2;
writeFileSync(join(out, 'side-report.json'), `${JSON.stringify({ format: 'jj.u056-side.v1', what: 'side.html: Full (left) and Reduced (right) started on the same frame; per-sample visible state of the countdown and Identify', summary, stills, samples: samples.length, errors, pass }, null, 2)}\n`);
console.log(JSON.stringify(summary), `stills ${stills.map((s) => s.tag)}`, errors.length ? errors : 'no errors', pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
