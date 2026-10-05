#!/usr/bin/env node
// P1-U02.4 evidence for the lobby, the end of round and the intermission, in Chromium on this machine's GPU:
// every state below is captured at 1080p (the 8- and 32-player ones also at 4K) and checked in the rendered page:
//   - lobby (br-dim.6, replaces the warm-up yard): the roster shows every player at once (one card each, none paged);
//     the join card's QR is scannable size; Start race is there; no box overflows the screen;
//   - end of round (POC1-17): round complete, the podium (each car live in its window), every standing (or paged), the
//     next-race timer, the join QR and the host's three actions are all present;
//   - intermission (POC1-16): the share of the screen the main replay takes, the highlights beside it, the QR's size, and
//     the widest empty run in the join band beside the QR (round 1 left a wide gap there);
//   - every screen: text and the QR inside title-safe, other chrome inside action-safe (GUIDE §4), nothing off the screen.
// Run: node art/ui/poc/tv/capture-rounds.mjs   Output: docs/evidence/P1-U02.4/ (JJ_EVIDENCE_DIR overrides)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U02.4');
const STATES = ['lobby&n=2', 'lobby&n=8', 'lobby&n=16', 'lobby&n=32', 'lobby&n=48', 'lobby&n=60', 'lobby&n=140', 'lobby&n=150', 'results&n=8', 'results&n=32', 'intermission&n=8', 'intermission&n=32'];
const BIG = ['lobby&n=8', 'lobby&n=32', 'results&n=8', 'results&n=32', 'intermission&n=8', 'intermission&n=32'];
const slug = (s) => s.replace(/&/g, '_').replace(/[^a-z0-9_=,-]/gi, '');
const { base, close } = await serveArtUi();
mkdirSync(join(out, 'captures'), { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [], external = [];
async function open(page, state) {
  await page.goto(`${base}/poc/tv/index.html#${state}`);
  await page.waitForFunction((h) => window.__poc?.ready === true && window.__poc.hash === h, `#${state}`, { timeout: 60000 });
  await page.waitForTimeout(400);
}

const inspect = () => {
  const k = innerHeight / 1080, W = innerWidth, H = innerHeight;
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const q = (s) => document.querySelector(s);
  const tv = (v) => Math.round(v / k);
  const offscreen = [...document.querySelectorAll('#ui *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1); }).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
  const views = window.__poc.carsSeen();
  const n = +(location.hash.match(/n=(\d+)/)?.[1] ?? 8);
  const qr = q('.lob-join .qr, .jb-join .qr');
  // GUIDE §4: text and the join QR inside title-safe (5 % of each dimension), other chrome inside action-safe (3.5 %); the 3D
  // views may bleed. The footer band is U02.3's own and isn't part of these screens.
  const ts = { l: 0.05 * W, r: 0.95 * W, t: 0.05 * H, b: 0.95 * H }, as = { l: 0.035 * W, r: 0.965 * W, t: 0.035 * H, b: 0.965 * H };
  const outside = (r, a) => r.left < a.l - 1 || r.right > a.r + 1 || r.top < a.t - 1 || r.bottom > a.b + 1;
  const tag = (e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`;
  const textOut = new Set(), chromeOut = new Set();
  for (const e of document.querySelectorAll('.screen *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const text = [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    if (text || e.matches('.qr')) { if (outside(r, ts)) textOut.add(tag(e)); } else if (e.matches('.card, .btn, .eor-hero, .hl-view, .hl-mini, .podcar, .podinfo, .tag, .strip, .bn') && outside(r, as)) chromeOut.add(tag(e));
  }
  const res = { n, offscreen: [...new Set(offscreen)].slice(0, 10), qrTvPx: qr ? tv(qr.getBoundingClientRect().width) : null, outsideTitleSafe: [...textOut].slice(0, 10), outsideActionSafe: [...chromeOut].slice(0, 10) };
  if (location.hash.startsWith('#lobby')) {
    res.lobby = {
      rosterShown: document.querySelectorAll('.lob-roster .lcard').length,
      rosterTier: q('.lob-roster')?.dataset.tier ?? '',
      startRace: [...document.querySelectorAll('.lob-go button')].some((b) => /Start race/.test(b.textContent)),
    };
    res.pass = res.lobby.rosterShown === n && res.lobby.startRace && res.qrTvPx >= 260 && res.offscreen.length === 0;
  } else if (location.hash.startsWith('#results')) {
    const pods = views.filter((v) => v.kind === 'reel');
    res.endOfRound = {
      banner: q('.eor-head .bn')?.textContent.trim(),
      heroShare: pods[0] ? +((pods[0].w * pods[0].h) / (W * H)).toFixed(3) : 0,
      podium: pods.map((v) => ({ seat: v.seat, carInside: v.inside.includes(v.seat), sizeTvPx: `${tv(v.w)}x${tv(v.h)}` })),
      standingsShown: document.querySelectorAll('.eor-table .trow').length,
      pageNote: q('.eor-table .page-note')?.textContent ?? '',
      timer: q('.jb-next')?.textContent.trim().replace(/\s+/g, ' '),
      actions: [...document.querySelectorAll('.jb-acts .btn')].map((b) => b.firstChild?.nextSibling?.firstChild?.textContent ?? b.textContent.trim()),
    };
    res.pass = res.endOfRound.heroShare >= 0.3 && pods.length === 3 && pods.every((v) => v.inside.includes(v.seat)) && (res.endOfRound.standingsShown === n || /Page 1 of/.test(res.endOfRound.pageNote)) && res.endOfRound.actions.length === 3 && res.qrTvPx >= 260 && res.offscreen.length === 0;
  } else if (location.hash.startsWith('#intermission')) {
    const main = views.find((v) => v.kind === 'highlight');
    const band = q('.jband'), bb = box(band);
    // The widest empty horizontal run inside the band: its children's boxes against the band's width (round 1: the gap
    // between "Jump in" and the buttons).
    const spans = [...band.querySelectorAll('.jb-join, .jb-mid > *, .jb-acts')].map(box).map((r) => [r.x, r.x + r.w]).sort((a, b) => a[0] - b[0]);
    let gap = 0, edge = bb.x + 48 * k;
    for (const [a, b] of spans) { gap = Math.max(gap, a - edge); edge = Math.max(edge, b); }
    gap = Math.max(gap, bb.x + bb.w - 48 * k - edge);
    res.intermission = {
      replayShare: main ? +((main.w * main.h) / (W * H)).toFixed(3) : 0,
      replaySizeTvPx: main ? `${tv(main.w)}x${tv(main.h)}` : null,
      replayCarInside: main ? main.inside.includes(main.seat) : false,
      sideHighlights: views.filter((v) => v.kind === 'reel').map((v) => ({ seat: v.seat, carInside: v.inside.includes(v.seat) })),
      bandWidestGapTvPx: tv(gap),
      topThree: document.querySelectorAll('.jb-pod').length,
      actions: document.querySelectorAll('.jb-acts .btn').length,
    };
    res.pass = res.intermission.replayShare >= 0.3 && res.intermission.replayCarInside && res.intermission.sideHighlights.length >= 3 && res.intermission.sideHighlights.every((v) => v.carInside) && res.intermission.bandWidestGapTvPx <= 120 && res.qrTvPx >= 260 && res.offscreen.length === 0;
  }
  res.pass = res.pass && res.outsideTitleSafe.length === 0 && res.outsideActionSafe.length === 0;
  return res;
};

const report = { format: 'jj.u024-rounds.v1', base, captures: [], states: {} };
for (const [res, w, h, list] of [['1080p', 1920, 1080, STATES], ['4k', 3840, 2160, BIG]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push(`${res} ${e.message}`));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  for (const s of list) {
    await open(page, s);
    const file = `captures/${res}-${slug(s)}.jpg`;
    await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 86 });
    report.captures.push(file);
    if (res === '1080p') report.states[s] = await page.evaluate(inspect);
  }
  await page.close();
}
await browser.close();
await close();
report.errors = errors; report.external = external;
report.pass = Object.values(report.states).every((r) => r.pass) && !errors.length && !external.length;
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const [s, r] of Object.entries(report.states)) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${s} ${JSON.stringify(r.lobby ?? r.endOfRound ?? r.intermission)} qr ${r.qrTvPx} offscreen ${r.offscreen.length} title-safe ${r.outsideTitleSafe} action-safe ${r.outsideActionSafe}`);
console.log(errors.length ? errors : 'no errors', external.length ? external : 'no external requests', report.pass ? 'PASS' : 'FAIL');
process.exit(report.pass ? 0 : 1);
