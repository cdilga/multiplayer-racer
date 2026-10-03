#!/usr/bin/env node
// P1-U02.3 evidence for the footer, the host menu, the pause flow and global captions, in Chromium on this machine's GPU:
// every state below is captured at 1080p (and the footer states at 21:9 and 4K) and checked in the rendered page:
//   - nothing but the countdown and the Identify flash covers a playing tile: every element outside a tile that meets a
//     tile's rectangle is a failure, unless the world is paused (the pause flow, the QR hover) or the element belongs to
//     that tile (data-own, the off-screen "your car" arrow);
//   - the host puck is gone; the footer holds the join, Pause, Fullscreen and the menu; the menu's buttons sit in it;
//   - diagnostics grow the footer and the grid stays above it; the QR hover shows a scannable QR and pauses;
//   - captions sit in the footer or a spare cell, never on a tile; dynamic moves the QR, standings and captions into
//     spare cells, static keeps them in the footer.
// Run: node art/ui/poc/tv/capture-host.mjs   Output: docs/evidence/P1-U02.3/
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U02.3');
const STATES = [
  'grid&n=8', 'grid&n=24', 'grid&n=32', 'grid&n=99', 'grid&n=3', 'grid&n=3&layout=static', 'grid&n=8&layout=static',
  'hud&n=8', 'identify&n=8&seat=3', 'overlays&n=8', 'countdown&n=8',
  'menu&n=8', 'qr-hover&n=32', 'diagnostics&n=8', 'diagnostics&n=32',
  'paused&n=8', 'paused&n=8&sub=players', 'paused&n=8&sub=end', 'paused&n=8&sub=disband',
  'captions&n=8', 'captions&n=8&layout=static', 'captions&n=13',
];
const WIDE = ['grid&n=8', 'grid&n=32', 'menu&n=8', 'paused&n=8', 'captions&n=13'];
const slug = (s) => s.replace(/&/g, '_').replace(/[^a-z0-9_=,-]/gi, '');
const { base, close } = await serveArtUi();
mkdirSync(join(out, 'captures'), { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(page, state) {
  await page.goto(`${base}/poc/tv/index.html#${state}`);
  await page.waitForFunction((h) => window.__poc?.ready === true && window.__poc.hash === h, `#${state}`, { timeout: 60000 });
  await page.waitForTimeout(250);
}

const inspect = () => {
  const k = innerHeight / 1080;
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const meet = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const tiles = [...document.querySelectorAll('.tile')].map((t) => ({ seat: t.dataset.seat, ...box(t) }));
  const paused = window.__poc.paused();
  const over = [];
  for (const e of document.querySelectorAll('#ui *')) {
    if (e.closest('.tile')) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('[hidden]')) continue;
    const r = box(e);
    if (r.w < 1 || r.h < 1) continue;
    for (const t of tiles) {
      if (meet(r, t) <= 1) continue;
      if (e.closest('[data-own]')?.dataset.own === t.seat) continue;
      over.push(`${e.tagName.toLowerCase()}.${[...e.classList].join('.')} over #${t.seat}`);
      break;
    }
  }
  const foot = document.querySelector('.foot');
  const fr = foot && box(foot);
  const qrPop = document.querySelector('.qr-pop .qr');
  const cap = document.querySelector('.footcap, .cellcap');
  return {
    tiles: tiles.length,
    paused,
    overlaysOnTiles: paused ? [] : [...new Set(over)].slice(0, 12),
    coveredWhilePaused: paused ? new Set(over).size : 0,
    puck: !!document.querySelector('.puck'),
    footer: fr && {
      heightTvPx: +(fr.h / k).toFixed(1),
      join: { code: foot.querySelector('.f-room .code')?.textContent, address: foot.querySelector('.f-sub')?.textContent.trim(), qr: foot.classList.contains('has-qr') },
      buttons: [...foot.querySelectorAll('.f-right button, .f-mid button')].map((b) => b.getAttribute('aria-label') ?? b.textContent.trim()),
      logo: !!foot.querySelector('.f-logo') && getComputedStyle(foot.querySelector('.f-logo')).display !== 'none',
      tilesAbove: tiles.every((t) => t.y + t.h <= fr.y + 0.5),
    },
    diag: !!document.querySelector('.f-diag:not([hidden])'),
    qrPop: qrPop && { scannable: qrPop.getBoundingClientRect().width >= 296 * k, sizeTvPx: Math.round(qrPop.getBoundingClientRect().width / k) },
    caption: cap && { where: cap.classList.contains('footcap') ? 'footer' : 'cell', onTile: !!cap.closest('.tile') },
    cells: [...document.querySelectorAll('.filler.cell')].map((f) => f.dataset.role),
    pauseCard: document.querySelector('.pcard')?.className ?? null,
    pauseButton: foot?.querySelector('.f-pause')?.textContent.trim(),
  };
};

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const rows = [];
for (const state of STATES) {
  await open(page, state);
  if (state.startsWith('identify')) await page.evaluate(() => window.__poc.identifyAt(150));
  const r = await page.evaluate(inspect);
  await page.screenshot({ path: join(out, 'captures', `${slug(state)}.jpg`), type: 'jpeg', quality: 82 });
  rows.push({ state, ...r });
}
for (const res of [{ id: '21x9', width: 2560, height: 1080 }, { id: '4k', width: 3840, height: 2160 }]) {
  const ctx = await browser.newContext({ viewport: { width: res.width, height: res.height } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  mkdirSync(join(out, 'captures', res.id), { recursive: true });
  for (const state of WIDE) {
    await open(p, state);
    const r = await p.evaluate(inspect);
    rows.push({ state: `${state} @${res.id}`, ...r });
    await p.screenshot({ path: join(out, 'captures', res.id, `${slug(state)}.jpg`), type: 'jpeg', quality: 82 });
  }
  await ctx.close();
}
const version = browser.version();
await browser.close();
await close();

const by = (s) => rows.find((r) => r.state === s);
const fails = [];
const need = (ok, what) => { if (!ok) fails.push(what); };
for (const r of rows) {
  need(r.overlaysOnTiles.length === 0, `${r.state}: covers a playing tile: ${r.overlaysOnTiles.join('; ')}`);
  need(!r.puck, `${r.state}: the host puck is back`);
  if (r.footer) need(r.footer.tilesAbove, `${r.state}: a tile reaches under the footer`);
}
for (const n of [8, 24, 32, 99]) {
  const f = by(`grid&n=${n}`)?.footer;
  need(f && f.join.code === 'ROO7' && /jammers\.dilger\.dev/.test(f.join.address) && f.buttons.includes('Pause') && f.buttons.includes('Fullscreen') && f.buttons.includes('Host menu') && f.logo, `footer at N=${n}`);
}
need(by('grid&n=3').cells.includes('qr') && !by('grid&n=3').footer.join.qr, 'dynamic N=3: the QR moves to a spare cell, not the footer');
need(!by('grid&n=3&layout=static').cells.some((c) => c !== 'backdrop') && by('grid&n=3&layout=static').footer.join.qr, 'static N=3: QR in the footer, spare cells backdrop');
need(by('grid&n=32').footer.join.qr, 'N=32: no cell fits the QR, so it is in the footer');
need(['Players', 'Diagnostics', 'Dynamic', 'Static', 'Settings…'].every((b) => by('menu&n=8').footer.buttons.includes(b)) && !by('menu&n=8').paused, 'menu: the host buttons in the footer, game still running');
need(by('qr-hover&n=32').paused && by('qr-hover&n=32').qrPop?.scannable, 'QR hover: a scannable QR and the game paused');
for (const s of ['diagnostics&n=8', 'diagnostics&n=32']) need(by(s).diag && by(s).footer.heightTvPx > 88 && !by(s).paused, `${s}: footer grows, game running`);
for (const s of ['paused&n=8', 'paused&n=8&sub=players', 'paused&n=8&sub=end', 'paused&n=8&sub=disband']) need(by(s).paused && by(s).pauseCard && by(s).pauseButton === 'Resume', `${s}: paused first, the card shown`);
need(by('captions&n=8&layout=static').caption?.where === 'footer', 'static captions: in the footer');
need(by('captions&n=13').caption?.where === 'cell', 'dynamic captions at N=13: in a spare cell');
need(rows.every((r) => !r.caption?.onTile), 'no caption on a tile');
need(errors.length === 0, `page errors: ${errors.join('; ')}`);

const report = { format: 'jj.u023-report.v1', browser: `Chromium ${version} (Playwright, channel chromium, GPU args), ${process.platform}/${process.arch}`, pass: fails.length === 0, fails, rows, errors };
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${rows.length} states: ${fails.length ? `${fails.length} FAILED\n  ${fails.join('\n  ')}` : 'all checks pass'}`);
process.exit(fails.length ? 1 : 0);
