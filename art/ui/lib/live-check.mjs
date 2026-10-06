#!/usr/bin/env node
// The design agent's self-look loop (docs/process/visual-self-review.md): open the pages like a reviewer would, on the
// devices a reviewer uses, and fail on anything broken so it never reaches the owner. Per page and viewport it checks
// failed requests (4xx/5xx), <img> that did not decode, uncaught errors, horizontal overflow past the viewport, and
// canvases that are zero-sized or one flat colour (a blank render surface). It saves a screenshot of each for the agent
// to LOOK at (Read the PNGs) before it reports; passing is necessary, not sufficient.
// Usage: node art/ui/lib/live-check.mjs [--base <url>] [--local] [--out <dir>] [--viewports 412x915,915x412,1920x1080]
//                                       [--fullscreen] [--tv] [path ...]
//   --tv checks every TV mock state (poc/tv/states.js) at phone portrait/landscape, tablet and 1920x1080.
//   default base https://jammers-preview.dilger.dev (the deployed copy: deploys can miss files); --local serves art/ui
//   from this checkout instead. Default out docs/evidence/design-live/. --fullscreen reloads the check after a
//   fullscreenchange-style resize (viewport shrink/grow) to catch layouts that only fix themselves on full screen.
// Exit 1 on any failure. scripts/poc-publish.sh runs it after the rsync.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const take = (flag, dflt) => { const i = argv.indexOf(flag); return i < 0 ? dflt : argv.splice(i, 2)[1]; };
const has = (flag) => { const i = argv.indexOf(flag); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const local = has('--local');
const fullscreen = has('--fullscreen');
let base = take('--base', 'https://jammers-preview.dilger.dev').replace(/\/$/, '');
const out = take('--out', join(here, '..', '..', '..', 'docs', 'evidence', 'design-live'));
const tv = has('--tv');
const viewports = take('--viewports', tv ? '412x915,915x412,820x1180,1920x1080' : '1600x900').split(',').map((v) => v.split('x').map(Number));
const paths = argv.length ? argv : ['/sheets/components.html', '/sheets/brand.html', '/poc/phone/index.html#race'];
// --tv adds every TV mock state (poc/tv/states.js) on the phone, tablet and TV matrix: the pages the owner reviews.
if (tv) {
  const { STATES } = await import('../poc/tv/states.js');
  if (!argv.length) paths.length = 0;
  for (const s of new Set(Object.values(STATES).flat())) paths.push(`/poc/tv/index.html#${s}`);
}
mkdirSync(out, { recursive: true });

let closeServer = async () => {};
if (local) {
  const { serveArtUi } = await import('./serve.mjs');
  const s = await serveArtUi();
  base = s.base;
  closeServer = s.close;
}

const surfaceProblems = (vw) => {
  const bad = [];
  const over = document.documentElement.scrollWidth - vw;
  if (over > 2) bad.push(`horizontal overflow: page is ${over}px wider than the viewport`);
  // Text or a control cut off by the screen edge: a page that hides its overflow (the TV mocks) can't be scrolled to it.
  // Wholly off-screen elements (parked drawers) and anything inside a scrollable box don't count.
  const clipped = [];
  for (const e of document.body.querySelectorAll('*')) {
    const control = e.matches('button, a[href], input, select, [role=button]');
    if (!control && ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const inView = r.right > 0 && r.left < vw && r.bottom > 0 && r.top < window.innerHeight;
    if (!inView || (r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1)) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility !== 'visible' || Number(cs.opacity) === 0) continue;
    let scroller = false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/auto|scroll/.test(`${s.overflowX} ${s.overflowY}`) || a.hasAttribute('data-ticker')) { scroller = true; break; } // a ticker scrolls its items past its edge on purpose
    }
    if (!scroller) clipped.push(`"${(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 24)}"`);
  }
  if (clipped.length) bad.push(`cut off by the screen edge: ${[...new Set(clipped)].slice(0, 4).join(', ')}${clipped.length > 4 ? ` and ${clipped.length - 4} more` : ''}`);
  for (const c of document.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || c.width < 2 || c.height < 2) { bad.push(`canvas is zero-sized (${c.id || c.className || 'canvas'})`); continue; }
    if (r.width < 8 || r.height < 8) continue;
    try {
      const t = document.createElement('canvas'); t.width = 16; t.height = 16;
      const g = t.getContext('2d'); g.drawImage(c, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let flat = true;
      for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) { flat = false; break; }
      // A WebGL/WebGPU canvas without preserveDrawingBuffer reads back empty once it has been shown, so a flat read is
      // only a suspicion: the caller judges the pixels actually on screen (a screenshot of the canvas's visible area).
      const x = Math.max(0, r.left), y = Math.max(0, r.top);
      const rect = { x, y, width: Math.min(r.right, vw) - x, height: Math.min(r.bottom, window.innerHeight) - y };
      if (flat && rect.width >= 8 && rect.height >= 8) bad.push({ flat: true, rect, name: c.id || c.className || 'canvas' });
    } catch { /* tainted or GPU-only canvas: the screenshot must be looked at */ }
  }
  return bad;
};

const browser = await chromium.launch({ channel: 'chromium' });
let failed = false;
try {
  for (const path of paths) {
    for (const [w, h] of viewports) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: w < 900 || h < 900, isMobile: Math.min(w, h) < 500 });
      const problems = [];
      page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
      page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
      page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const check = async (label) => {
        for (const src of await page.evaluate(() => [...document.images].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.currentSrc || i.src))) problems.push(`${label}image did not load: ${src}`);
        for (const p of await page.evaluate(surfaceProblems, w)) {
          if (typeof p === 'string') {
            problems.push(`${label}${p}`);
            continue;
          }
          const png = await page.screenshot({ clip: p.rect });
          const flat = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const t = document.createElement('canvas'); t.width = 16; t.height = 16;
            const g = t.getContext('2d'); g.drawImage(img, 0, 0, 16, 16);
            const d = g.getImageData(0, 0, 16, 16).data;
            for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false;
            return true;
          }, png.toString('base64'));
          if (flat) problems.push(`${label}canvas looks blank: one flat colour on screen (${p.name})`);
        }
      };
      await check('');
      const stem = `${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'index'}_${w}x${h}`;
      const file = join(out, `${stem}.png`);
      await page.screenshot({ path: file, fullPage: true });
      if (fullscreen) {
        // what the owner saw: layouts that only fixed themselves after full screen. Shrink then grow the viewport and recheck.
        await page.setViewportSize({ width: Math.round(w * 0.9), height: Math.round(h * 0.85) });
        await page.waitForTimeout(400);
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(600);
        await check('after resize: ');
        await page.screenshot({ path: join(out, `${stem}_after-resize.png`), fullPage: true });
      }
      failed ||= problems.length > 0;
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${path} ${w}x${h} -> ${file}`);
      for (const p of [...new Set(problems)]) console.log(`     ${p}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await closeServer();
}
console.log('Now LOOK at every screenshot above (Read the PNGs) and write docs/evidence/<id>/self-review.md.');
process.exit(failed ? 1 : 0);
