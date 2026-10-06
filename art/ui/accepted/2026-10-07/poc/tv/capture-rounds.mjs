#!/usr/bin/env node
// P1-U02.4 evidence for the lobby and (br-dim.7) the merged round-complete + highlights screen, in Chromium on this machine's GPU:
// every state below is captured at 1080p (the 8- and 32-player ones also at 4K) and checked in the rendered page:
//   - lobby (br-dim.6, replaces the warm-up yard): the roster shows every player at once (one card each, none paged);
//     the join card's QR is scannable size; Start race is there; no box overflows the screen;
//   - round complete + highlights (br-dim.7; #results and #intermission open the same screen): the replay takes 50-67 % of the
//     screen and shows the highlighted car, every placing is on screen (no cap), the join QR, the next-race chip and the
//     host's three actions are all there (the full layout measurement is merged-check.mjs);
//   - every screen: text and the QR inside title-safe, other chrome inside action-safe (GUIDE §4), nothing off the screen.
// Run: node art/ui/poc/tv/capture-rounds.mjs   Output: docs/evidence/P1-U02.4/ (JJ_EVIDENCE_DIR overrides)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.JJ_EVIDENCE_DIR ?? join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U02.4');
const STATES = ['lobby&n=2', 'lobby&n=8', 'lobby&n=16', 'lobby&n=32', 'lobby&n=48', 'lobby&n=60', 'lobby&n=140', 'lobby&n=150', 'results&n=1', 'results&n=8', 'results&n=32', 'results&n=150', 'intermission&n=8', 'intermission&n=32'];
const BIG = ['lobby&n=8', 'lobby&n=32', 'results&n=8', 'results&n=32', 'intermission&n=8'];
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
  const qr = q('.lob-join .qr, .rd-join .qr');
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
    if (text || e.matches('.qr')) { if (outside(r, ts)) textOut.add(tag(e)); } else if (e.matches('.card, .btn, .hl-view, .rd-row, .rd-cell, .tag, .strip, .bn') && outside(r, as)) chromeOut.add(tag(e));
  }
  const res = { n, offscreen: [...new Set(offscreen)].slice(0, 10), qrTvPx: qr ? tv(qr.getBoundingClientRect().width) : null, outsideTitleSafe: [...textOut].slice(0, 10), outsideActionSafe: [...chromeOut].slice(0, 10) };
  if (location.hash.startsWith('#lobby')) {
    res.lobby = {
      rosterShown: document.querySelectorAll('.lob-roster .lcard').length,
      rosterTier: q('.lob-roster')?.dataset.tier ?? '',
      startRace: [...document.querySelectorAll('.lob-go button')].some((b) => /Start race/.test(b.textContent)),
    };
    res.pass = res.lobby.rosterShown === n && res.lobby.startRace && res.qrTvPx >= 260 && res.offscreen.length === 0;
  } else if (location.hash.startsWith('#results') || location.hash.startsWith('#intermission')) {
    const main = views.find((v) => v.kind === 'highlight');
    const player = (e) => e.matches('.rd-row, .rd-cell');
    res.round = {
      banner: q('.rd-head .bn')?.textContent.trim(),
      videoShare: main ? +((main.w * main.h) / (W * H)).toFixed(3) : 0,
      videoCarInside: main ? main.inside.includes(main.seat) : false,
      placingsShown: [...document.querySelectorAll('.rd-row, .rd-cell')].filter(player).length,
      tier: q('.rd-rest')?.dataset.tier ?? 'rows only',
      chip: q('.rd-next')?.textContent.trim().replace(/\s+/g, ' '),
      actions: [...document.querySelectorAll('.rd-acts .btn')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')),
    };
    res.pass = res.round.videoShare >= 0.5 && res.round.videoShare <= 0.67 && res.round.videoCarInside && res.round.placingsShown === n && res.round.actions.length === 3 && !!res.round.chip && res.qrTvPx >= 200 && res.offscreen.length === 0;
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
for (const [s, r] of Object.entries(report.states)) console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${s} ${JSON.stringify(r.lobby ?? r.round)} qr ${r.qrTvPx} offscreen ${r.offscreen.length} title-safe ${r.outsideTitleSafe} action-safe ${r.outsideActionSafe}`);
console.log(errors.length ? errors : 'no errors', external.length ? external : 'no external requests', report.pass ? 'PASS' : 'FAIL');
process.exit(report.pass ? 0 : 1);
