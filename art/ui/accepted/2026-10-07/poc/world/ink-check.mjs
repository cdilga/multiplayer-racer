#!/usr/bin/env node
// P1-U05 (br-dim.11) bunched-car legibility check: does a car's body colour stay visible inside its ink outline when the tiles are small?
//   node art/ui/poc/world/ink-check.mjs [--out docs/evidence/br-dim.11] [--name after] [--extra "inkscale=1&mipbias=0.5"]
//        [--tiles 24,32,64] [--dpr 1,2,3] [--sizes phone-p,phone-l,tv] [--threshold 0.6] [--tiny 48] [--shots] [--fail]
// For every size x tile count x DPR it renders the same frozen frame (?freeze=90, fixed 1/60 s steps, grain and shimmer off, the
// bunched starting grid: 4 cars a row, 3.1 m between lanes, 9 m between rows, so every chase tile sees cars close ahead of it) three
// times in iframes at the real size: the final look, the ink channel (debug=edge: how much ink each pixel got, 0..1) and the car mask
// (debug=dynamic: the dynamic-id pixels, cars and their kit). For each car's screen box (window.__world.carBoxes(): the car box's eight
// corners projected through its tile's camera, clipped to the tile, expanded by a margin for the outline that spills outside):
//   body px  = car-mask pixels in the box, weighted (1 - ink)       ink px = sum of the ink channel in the box within 4 device px of a car pixel
//   inkRatio = ink px / body px                                      (the check: under --threshold at the tiny sizes)
//   darkRatio = pixels darker than a luminance of 0.2 inside the car mask / car-mask px, from the final frame (what the eye sees as black)
// Tiny = a car whose box is --speck..--tiny device px wide (16..48); narrower ones are specks (a 1 px outline alone covers most of a 6 px car: reported, not judged). Pass = every (size, n, dpr) cell with tiny cars has its p90 inkRatio under
// the threshold. DPR is Playwright's deviceScaleFactor: EMULATED, not a real device's panel. Writes ink-check-<name>.json (and, with
// --shots, the final frame of each cell as a jpg for the self-review).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const take = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };
const out = take('--out', join(here, '..', '..', '..', '..', 'docs', 'evidence', 'br-dim.11'));
const name = take('--name', 'run');
const extra = take('--extra', '');
const THRESH = +take('--threshold', '0.6');
const TINY = +take('--tiny', '48');
const SPECK = +take('--speck', '16'); // cars narrower than this (device px) are specks: a 1 px outline alone is most of them, reported but not judged
const FREEZE = +take('--freeze', '90');
const TILES = take('--tiles', '24,32,64').split(',').map(Number);
const DPRS = take('--dpr', '1,2,3').split(',').map(Number);
const SIZES = { 'phone-p': [412, 915], 'phone-l': [915, 412], tv: [1920, 1080] };
const sizes = take('--sizes', 'phone-p,phone-l,tv').split(',');
const shots = argv.includes('--shots');
mkdirSync(out, { recursive: true });

const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

// Runs in the page: three iframes, the metrics; nothing big goes back.
async function measure({ url, n, w, h, margin, wantJpg, DIL }) {
  const frame = async (extraQ) => {
    const f = document.createElement('iframe');
    f.style.cssText = `position:fixed;left:-20000px;top:0;width:${w}px;height:${h}px;border:0`;
    f.src = `${url}${extraQ}#grid&n=${n}`;
    document.body.append(f);
    const t0 = performance.now();
    while (!(f.contentWindow.__world?.ready === true && f.contentWindow.__world.snapshot?.())) {
      if (performance.now() - t0 > 180000) throw new Error('a frame never froze');
      await new Promise((r) => setTimeout(r, 100));
    }
    const W = f.contentWindow.__world, snap = W.snapshot();
    const res = { snap, boxes: W.carBoxes(), options: W.options(), rects: W.tileRects(), cssW: f.contentWindow.innerWidth, dpr: f.contentWindow.devicePixelRatio, backend: W.backend };
    res.data = snap.getContext('2d').getImageData(0, 0, snap.width, snap.height).data;
    res.W = snap.width; res.H = snap.height;
    if (wantJpg && !extraQ) { const c = document.createElement('canvas'); c.width = res.W; c.height = res.H; const g = c.getContext('2d'); g.fillStyle = '#f0f'; g.fillRect(0, 0, c.width, c.height); g.drawImage(snap, 0, 0); res.jpg = c.toDataURL('image/jpeg', 0.9); }
    f.remove();
    return res;
  };
  const fin = await frame('');
  const edge = await frame('&debug=edge&tm=none');
  const mask = await frame('&debug=dynamic&tm=none');
  const S = fin.W / fin.cssW;
  const cars = [];
  for (const t of fin.boxes) for (const c of t.cars) {
    const x0 = Math.max(0, Math.floor((c.x - margin) * S)), y0 = Math.max(0, Math.floor((c.y - margin) * S));
    const x1 = Math.min(fin.W, Math.ceil((c.x + c.w + margin) * S)), y1 = Math.min(fin.H, Math.ceil((c.y + c.h + margin) * S));
    const r = t.rect, tx0 = Math.floor(r.x * S), ty0 = Math.floor(r.y * S), tx1 = Math.ceil((r.x + r.w) * S), ty1 = Math.ceil((r.y + r.h) * S);
    let ink = 0, body = 0, dark = 0, maskPx = 0;
    for (let y = Math.max(y0, ty0); y < Math.min(y1, ty1); y++) for (let x = Math.max(x0, tx0); x < Math.min(x1, tx1); x++) {
      const i = (y * fin.W + x) * 4;
      const e = Math.min(1, edge.data[i] / 255 / 1.05), m = mask.data[i] > 128;
      if (e > 0) { // ink counts where a car is within DIL device px (the outline's own band): not ground, rail or sky ink that happens to lie in the box
        let near = m;
        for (let dy = -DIL; dy <= DIL && !near; dy++) for (let dx = -DIL; dx <= DIL; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < fin.W && yy < fin.H && mask.data[(yy * fin.W + xx) * 4] > 128) { near = true; break; } }
        if (near) ink += e;
      }
      if (m) {
        maskPx++; body += 1 - e;
        const lum = (0.2126 * fin.data[i] + 0.7152 * fin.data[i + 1] + 0.0722 * fin.data[i + 2]) / 255;
        if (lum < 0.2) dark++;
      }
    }
    cars.push({ tile: t.tile, id: c.id, widthPx: +(c.w * S).toFixed(1), heightPx: +(c.h * S).toFixed(1), maskPx, bodyPx: +body.toFixed(1), inkPx: +ink.toFixed(1), inkRatio: body >= 1 ? +(ink / body).toFixed(3) : null, darkRatio: maskPx ? +(dark / maskPx).toFixed(3) : null });
  }
  return { cars, canvasPx: [fin.W, fin.H], dpr: fin.dpr, cssW: fin.cssW, options: fin.options, backend: fin.backend, tileCss: fin.rects[0] ? [fin.rects[0].w, fin.rects[0].h] : null, jpg: fin.jpg, probe: { finMean: fin.data.reduce((a, v, i) => a + (i % 4 < 3 ? v : 0), 0) / (fin.W * fin.H * 3), a0: fin.data[3], edgeMax: edge.data.reduce((a, v, i) => (i % 4 === 0 && v > a ? v : a), 0), maskMax: mask.data.reduce((a, v, i) => (i % 4 === 0 && v > a ? v : a), 0) } };
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const cells = [];
let failed = false;
for (const sz of sizes) for (const dpr of DPRS) {
  const [w, h] = SIZES[sz];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  for (const n of TILES) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${base}/poc/world/ink-host.html`);
    const url = `${base}/poc/world/index.html?bar=0&grain=0&shimmer=0&freeze=${FREEZE}${extra ? `&${extra}` : ''}`;
    let m;
    try { m = await page.evaluate(measure, { url, n, w, h, margin: 6, DIL: 4, wantJpg: shots }); } catch (e) { console.log(sz, dpr, n, 'FAILED', e.message, errs); failed = true; await page.close(); continue; }
    const all = m.cars.filter((c) => c.inkRatio != null && c.bodyPx >= 4);
    const tinyCars = all.filter((c) => c.widthPx >= SPECK && c.widthPx < TINY), specks = all.filter((c) => c.widthPx < SPECK);
    const stat = (xs) => ({ n: xs.length, medianInk: pct(xs.map((c) => c.inkRatio), 0.5), p90Ink: pct(xs.map((c) => c.inkRatio), 0.9), maxInk: pct(xs.map((c) => c.inkRatio), 1), medianDark: pct(xs.map((c) => c.darkRatio ?? 0), 0.5), p90Dark: pct(xs.map((c) => c.darkRatio ?? 0), 0.9) });
    const cell = { size: `${w}x${h}`, sizeName: sz, dpr, tiles: n, canvasPx: m.canvasPx, nativeOk: Math.abs(m.canvasPx[0] - w * dpr) <= 1, tileCss: m.tileCss, options: { inkScale: m.options.inkScale, render: m.options.render, af: m.options.af }, carsMeasured: all.length, all: stat(all), tiny: stat(tinyCars), specks: stat(specks), big: stat(all.filter((c) => c.widthPx >= TINY)), tinyPass: tinyCars.length === 0 ? null : stat(tinyCars).p90Ink <= THRESH, cars: m.cars };
    cells.push(cell);
    if (cell.tinyPass === false) failed = true;
    console.log(`${name} ${sz} dpr${dpr} n${n}: canvas ${m.canvasPx.join('x')} native ${cell.nativeOk} tile ${m.tileCss?.map((x) => Math.round(x)).join('x')} cars ${all.length} | all median ${cell.all.medianInk} p90 ${cell.all.p90Ink} | specks(<${SPECK}) n${cell.specks.n} p90 ${cell.specks.p90Ink} | tiny(${SPECK}-${TINY}px) n${cell.tiny.n} median ${cell.tiny.medianInk} p90 ${cell.tiny.p90Ink} pass ${cell.tinyPass}`);
    if (shots && m.jpg) writeFileSync(join(out, `shot-${name}-${sz}-dpr${dpr}-n${n}.jpg`), Buffer.from(m.jpg.split(',')[1], 'base64'));
    await page.close();
  }
  await ctx.close();
}
const slim = cells.map(({ cars, ...c }) => c);
writeFileSync(join(out, `ink-check-${name}.json`), `${JSON.stringify({ when: new Date().toISOString(), name, extra, threshold: THRESH, tinyUnderPx: TINY, speckUnderPx: SPECK, freeze: FREEZE, note: 'DPR is Playwright deviceScaleFactor (emulated), Chromium on this Mac, WebGPU via Metal; inkRatio = ink coverage / body px inside each car box (debug=edge and debug=dynamic channels), darkRatio = luminance<0.2 pixels / car-mask px in the final frame', cells: slim, cars: Object.fromEntries(cells.map((c) => [`${c.sizeName}-dpr${c.dpr}-n${c.tiles}`, c.cars])) }, null, 1)}\n`);
await browser.close(); await close();
if (argv.includes('--fail') && failed) process.exit(1);
