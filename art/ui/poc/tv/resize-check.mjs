#!/usr/bin/env node
// br-dim.2: the TV grid is the same after a viewport change as a fresh load at that size, and the rear-view mirror stays
// in its tile, off the HUD labels, on or off, at the smallest and largest tiles.
//   Layout: for 32 and 100 players (first-person tiles mixed in), load at one size, change the viewport (resize, a
//   browser-bar-sized height change, a rotation, full screen on then off) and compare every tile, HUD part and mirror rect
//   (and the 3D viewports, mirrors included) with a fresh load at the final size.
//   Mirror: first-person tiles at 1, 32 and 100 players on a TV and a phone: the frame is inside its tile, clear of the
//   number/name, position/lap, boost bar and status chip, and its 3D viewport is the frame's rect; &mirror=0 leaves no
//   frame and no mirror viewport.
// Screenshots go to docs/evidence/br-dim.2/ (JJ_EVIDENCE_DIR overrides). Run: node art/ui/poc/tv/resize-check.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'br-dim.2');
mkdirSync(out, { recursive: true });
const failures = [];
const report = { layout: [], mirror: [] };

const snap = () => {
  const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v)).join(','); };
  // The position pill's text changes as the race runs ("4th" -> "11th"), so the pills are compared by the edge they're
  // anchored to (number/name: left; position/lap: right), their top and height, not their widths.
  const anchored = (e, side) => { const b = e.getBoundingClientRect(); return [side === 'left' ? b.left : b.right, b.top, b.height].map((v) => Math.round(v)).join(','); };
  const o = { k: getComputedStyle(document.documentElement).getPropertyValue('--k') };
  for (const t of document.querySelectorAll('.tile')) {
    const s = t.dataset.seat;
    o[`tile ${s}`] = r(t);
    for (const [k, sel] of [['boost', '.hud-boost'], ['chip', '.hud-status .chip'], ['mirror', '.mirror']]) {
      const e = t.querySelector(sel);
      if (e) o[`${k} ${s}`] = r(e);
    }
    o[`tl ${s}`] = anchored(t.querySelector('.hud-tl'), 'left');
    o[`tr ${s}`] = anchored(t.querySelector('.hud-tr'), 'right');
  }
  for (const v of window.__poc.views()) o[`view ${v.seat} ${v.kind}`] = [v.x, v.y, v.w, v.h].join(',');
  return o;
};
const { base, close } = await serveArtUi();
const browser = await chromium.launch({ channel: 'chromium' });
const open = async (w, h, hash) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${base}/poc/tv/index.html${hash}`);
  await page.waitForFunction((x) => window.__poc?.ready === true && window.__poc.hash === x, hash, { timeout: 30000 });
  await page.waitForTimeout(300);
  return page;
};

// ---- layout after viewport changes = a fresh load
const CHANGES = [
  ['resize 1366x768 -> 1920x1080', [1366, 768], async (p) => p.setViewportSize({ width: 1920, height: 1080 }), [1920, 1080]],
  ['resize 1920x1080 -> 1366x768', [1920, 1080], async (p) => p.setViewportSize({ width: 1366, height: 768 }), [1366, 768]],
  ['browser bars: 1920x1080 -> 1920x980', [1920, 1080], async (p) => p.setViewportSize({ width: 1920, height: 980 }), [1920, 980]],
  ['rotation 915x412 -> 412x915', [915, 412], async (p) => p.setViewportSize({ width: 412, height: 915 }), [412, 915]],
  ['full screen on then off (1920x1080)', [1920, 1080], async (p) => {
    await p.click('.f-full');
    await p.waitForTimeout(400);
    await p.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  }, [1920, 1080]],
];
for (const hash of ['#hud&n=32&base=100&fp=6,13,27&states=matrix', '#hud&n=100&fp=6,50,99&states=matrix']) {
  for (const [name, [w1, h1], change, [w2, h2]] of CHANGES) {
    const fresh = await open(w2, h2, hash);
    const want = await fresh.evaluate(snap);
    await fresh.close();
    const page = await open(w1, h1, hash);
    await change(page);
    await page.waitForTimeout(700);
    const got = await page.evaluate(snap);
    await page.close();
    const diff = Object.keys({ ...want, ...got }).filter((k) => want[k] !== got[k]);
    report.layout.push({ hash, change: name, compared: Object.keys(want).length, diff: diff.length });
    if (diff.length) failures.push(`${hash} ${name}: ${diff.length} rect(s) differ from a fresh load, e.g. ${diff.slice(0, 3).map((k) => `${k}: ${got[k]} vs ${want[k]}`).join('; ')}`);
  }
}

// ---- the mirror: inside its tile, off the HUD labels, its viewport = its frame; off with &mirror=0
const mirrorCheck = () => {
  const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;
  const views = window.__poc.views().filter((v) => v.kind === 'mirror');
  const rows = [];
  for (const m of document.querySelectorAll('.tile .mirror')) {
    const tile = m.closest('.tile'), mb = box(m), tb = box(tile);
    const inside = mb.l >= tb.l - 0.5 && mb.r <= tb.r + 0.5 && mb.t >= tb.t - 0.5 && mb.b <= tb.b + 0.5;
    const hits = ['.hud-tl', '.hud-tr', '.hud-boost', '.hud-status .chip'].filter((sel) => { const e = tile.querySelector(sel); return e && e.getBoundingClientRect().width > 0 && hit(mb, box(e)); });
    // The 3D viewport is the frame's inside (the frame's border is drawn over its edge): within 1 px of the frame's box.
    const cs = getComputedStyle(m);
    const bw = parseFloat(cs.borderLeftWidth);
    const v = views.find((x) => String(x.seat) === String(Number(tile.dataset.seat) - (window.__base ?? 0)) || x.seat === Number(tile.dataset.seat));
    const vOk = v && Math.abs(v.x - (mb.l + bw)) <= 1.5 + bw && Math.abs(v.y - (mb.t + bw)) <= 1.5 + bw && Math.abs(v.w - (mb.r - mb.l)) <= 1.5 + 2 * bw && Math.abs(v.h - (mb.b - mb.t)) <= 1.5 + 2 * bw;
    rows.push({ seat: tile.dataset.seat, tile: `${Math.round(tb.r - tb.l)}x${Math.round(tb.b - tb.t)}`, inside, hits, viewport: Boolean(vOk) });
  }
  return { frames: rows, mirrorViews: views.length };
};
for (const [w, h] of [[1920, 1080], [412, 915]]) {
  for (const [n, fp] of [[1, '1'], [32, '6,13,27'], [100, '6,50,99']]) {
    for (const on of [true, false]) {
      // &qr=0&list=0: this measures the mirror against the tile HUD at the grid's own tile sizes; the join QR and the player
      // list (br-u02-qr-list-space-jdc) take space on a phone host and are covered by qr-space-check.mjs.
      const hash = `#hud&n=${n}&fp=${fp}&states=matrix&qr=0&list=0${on ? '' : '&mirror=0'}`;
      const page = await open(w, h, hash);
      const r = await page.evaluate(mirrorCheck);
      const want = fp.split(',').length;
      const ok = on ? r.frames.length === want && r.mirrorViews === want && r.frames.every((f) => f.inside && f.hits.length === 0 && f.viewport) : r.frames.length === 0 && r.mirrorViews === 0;
      report.mirror.push({ screen: `${w}x${h}`, n, mirror: on ? 'on' : 'off', ...r, pass: ok });
      if (!ok) failures.push(`${w}x${h} n=${n} mirror ${on ? 'on' : 'off'}: ${JSON.stringify(r)}`);
      if (on && (n === 1 || n === 100 || (n === 32 && w === 1920))) await page.screenshot({ path: join(out, `mirror-${w}x${h}-n${n}.jpg`), type: 'jpeg', quality: 70 });
      await page.close();
    }
  }
}
await browser.close();
await close();

writeFileSync(join(out, 'resize-check.json'), `${JSON.stringify({ failures, ...report }, null, 2)}\n`);
for (const l of report.layout) console.log(`${l.diff ? 'FAIL' : 'ok  '} ${l.hash} ${l.change}: ${l.compared} rects${l.diff ? `, ${l.diff} differ` : ' match a fresh load'}`);
for (const m of report.mirror) console.log(`${m.pass ? 'ok  ' : 'FAIL'} mirror ${m.mirror} ${m.screen} n=${m.n}: ${m.frames.length} frame(s), ${m.mirrorViews} mirror viewport(s)${m.frames.length ? `, tiles ${[...new Set(m.frames.map((f) => f.tile))].join('/')}` : ''}`);
console.log(failures.length ? `\n${failures.length} failure(s)\n  ${failures.slice(0, 12).join('\n  ')}` : '\nresize check: ok');
process.exit(failures.length ? 1 : 0);
