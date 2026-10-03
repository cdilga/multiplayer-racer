#!/usr/bin/env node
// P1-U03 checks and captures for the phone mocks.
//   Layout: Playwright WebKit and Chromium, mobile emulation (touch, isMobile), 375×667, 430×932, 412×915, portrait and
//   landscape: no horizontal scroll, no overlapping boxes, every touch target ≥ tokens.layout.minTouchTargetPx.
//   Multi-touch: two simultaneous pointers (and, in Chromium, two real CDP touch points) move the two sticks
//   independently. Standalone: no request leaves the local folder. Captures: every state in device frames.
// Output: docs/evidence/P1-U03/ (frames/*.jpg, check-report.json). Exit 1 on any failure.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { serveArtUi } from '../../lib/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', '..', '..', 'docs', 'evidence', 'P1-U03');
mkdirSync(join(out, 'frames'), { recursive: true });
const DEVICES = [['small-iphone', 375, 667], ['large-iphone', 430, 932], ['mid-android', 412, 915]];
const { base, close } = await serveArtUi();
const failures = [];
const report = { base, layout: [], multitouch: [], network: { external: [] }, captures: [] };

// The state list lives in phone.js; read it in a page so there's one source.
const probe = await chromium.launch({ channel: 'chromium' });
const pp = await probe.newPage();
await pp.goto(`${base}/poc/phone/index.html#race`);
await pp.waitForFunction(() => window.__phone?.ready === true);
const STATES = await pp.evaluate(() => window.__phone.states);
const minTouch = await pp.evaluate(async () => (await (await fetch('../../tokens.json')).json()).layout.minTouchTargetPx);
await probe.close();
const ALL = Object.values(STATES).flat();

const layoutCheck = () => {
  const boxes = [...document.querySelectorAll('[data-box]')].filter((e) => e.offsetParent !== null || e.getClientRects().length);
  const rect = (e) => e.getBoundingClientRect();
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (a.hidden || b.hidden) continue;
    const r = rect(a), s = rect(b);
    const ix = Math.min(r.right, s.right) - Math.max(r.left, s.left), iy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
    if (ix > 1 && iy > 1) overlaps.push(`${a.dataset.box} × ${b.dataset.box} (${Math.round(ix)}×${Math.round(iy)})`);
  }
  // Transient overlays (tutorial card, autopilot banner, menu) may cover the stick zones, never the HUD strip or tools.
  for (const o of document.querySelectorAll('[data-overlay]')) {
    const r = rect(o);
    for (const keep of document.querySelectorAll('[data-box=strip], [data-box=tools]')) {
      const s = rect(keep);
      const ix = Math.min(r.right, s.right) - Math.max(r.left, s.left), iy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
      if (ix > 1 && iy > 1) overlaps.push(`overlay ${o.dataset.overlay} covers ${keep.dataset.box} (${Math.round(ix)}×${Math.round(iy)})`);
    }
    if (r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1) overlaps.push(`overlay ${o.dataset.overlay} leaves the screen`);
  }
  const targets = [...document.querySelectorAll('button, input, [role=button], [role=switch]')].filter((e) => e.getClientRects().length);
  const small = targets.map((e) => ({ e, r: rect(e) })).filter(({ e, r }) => e.getAttribute('role') !== 'switch' && (r.width < window.__minTouch - 0.5 || r.height < window.__minTouch - 0.5)).map(({ e, r }) => `${e.getAttribute('aria-label') || e.textContent.trim().slice(0, 24) || e.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
  // Switches are drawn smaller than the target; their whole settings row is the hit area (checked as the row).
  const switchRows = [...document.querySelectorAll('[role=switch]')].map((e) => e.closest('.row')).filter((r) => r && r.getBoundingClientRect().height < window.__minTouch - 0.5).map((r) => `switch row ${Math.round(r.getBoundingClientRect().height)}px`);
  const hscroll = document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1;
  return { overlaps, small: [...small, ...switchRows], hscroll, targets: targets.length };
};

for (const [engineName, engine, launch] of [['chromium', chromium, { channel: 'chromium' }], ['webkit', webkit, {}]]) {
  const browser = await engine.launch(launch);
  for (const [dev, w, h] of DEVICES) {
    for (const [orient, vw, vh] of [['portrait', w, h], ['landscape', h, w]]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) report.network.external.push(r.url()); });
      await page.addInitScript((m) => { window.__minTouch = m; }, minTouch);
      for (const state of ALL) {
        await page.goto(`${base}/poc/phone/index.html#${state}&chrome=0`);
        await page.reload();
        await page.waitForFunction(() => window.__phone?.ready === true);
        await page.waitForTimeout(60);
        const r = await page.evaluate(layoutCheck);
        const row = { engine: engineName, device: dev, orient, viewport: `${vw}x${vh}`, state, ...r };
        report.layout.push(row);
        if (r.hscroll) failures.push(`${engineName} ${dev} ${orient} ${state}: horizontal scroll`);
        for (const o of r.overlaps) failures.push(`${engineName} ${dev} ${orient} ${state}: overlap ${o}`);
        for (const s of r.small) failures.push(`${engineName} ${dev} ${orient} ${state}: touch target ${s} < ${minTouch}px`);
      }
      // Multi-touch on the in-race controller: DRIVE left + ACTION up at the same time.
      await page.goto(`${base}/poc/phone/index.html#race&chrome=0`);
      await page.reload();
      await page.waitForFunction(() => window.__phone?.ready === true);
      const pe = await page.evaluate(async () => {
        const zone = (k) => document.querySelector(`.zone.${k}`).getBoundingClientRect();
        const d = zone('drive'), a = zone('action');
        const P = (type, id, x, y, el) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true }));
        const dz = document.querySelector('.zone.drive'), az = document.querySelector('.zone.action');
        const d0 = { x: d.left + d.width / 2, y: d.top + d.height * 0.6 }, a0 = { x: a.left + a.width / 2, y: a.top + a.height * 0.6 };
        P('pointerdown', 11, d0.x, d0.y, dz); P('pointerdown', 12, a0.x, a0.y, az);
        for (let i = 1; i <= 10; i++) { P('pointermove', 11, d0.x - i * 8, d0.y, dz); P('pointermove', 12, a0.x, a0.y - i * 8, az); }
        const both = JSON.parse(JSON.stringify(window.__phone.sticks));
        P('pointerup', 11, d0.x - 80, d0.y, dz);
        const afterDriveUp = JSON.parse(JSON.stringify(window.__phone.sticks));
        P('pointerup', 12, a0.x, a0.y - 80, az);
        return { both, afterDriveUp };
      });
      const okPE = pe.both.drive.x < -0.5 && Math.abs(pe.both.drive.y) < 0.05 && pe.both.action.y < -0.5 && Math.abs(pe.both.action.x) < 0.05 && pe.afterDriveUp.drive.x === 0 && pe.afterDriveUp.action.y < -0.5;
      const mt = { engine: engineName, device: dev, orient, method: 'pointer events (two pointerIds)', ...pe, pass: okPE };
      report.multitouch.push(mt);
      if (!okPE) failures.push(`${engineName} ${dev} ${orient}: pointer multi-touch did not move the sticks independently ${JSON.stringify(pe)}`);
      if (engineName === 'chromium') {
        const cdp = await ctx.newCDPSession(page);
        const z = await page.evaluate(() => ['drive', 'action'].map((k) => { const r = document.querySelector(`.zone.${k}`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.6 }; }));
        const pts = (dx, dy) => [{ x: z[0].x + dx, y: z[0].y, id: 1 }, { x: z[1].x, y: z[1].y + dy, id: 2 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0, 0) });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i * 10, -i * 10) });
        const real = await page.evaluate(() => JSON.parse(JSON.stringify(window.__phone.sticks)));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const okReal = real.drive.x > 0.5 && Math.abs(real.drive.y) < 0.05 && real.action.y < -0.5 && Math.abs(real.action.x) < 0.05;
        report.multitouch.push({ engine: engineName, device: dev, orient, method: 'CDP Input.dispatchTouchEvent (two touch points)', both: real, pass: okReal });
        if (!okReal) failures.push(`${engineName} ${dev} ${orient}: real two-point touch did not move the sticks independently ${JSON.stringify(real)}`);
      }
      await ctx.close();
    }
  }
  await browser.close();
}
if (report.network.external.length) failures.push(`requests left the folder: ${[...new Set(report.network.external)].join(', ')}`);

// Captures: every state in device frames (Chromium).
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 2700, height: 1650 } });
for (const state of ALL) {
  await page.goto('about:blank');
  await page.goto(`${base}/poc/phone/frames.html#${state}`);
  await page.waitForFunction(() => window.framesReady === true, null, { timeout: 30000 });
  await page.waitForTimeout(200);
  const file = `${state.replace(/&/g, '_').replace(/[^a-z0-9_=-]/gi, '')}.jpg`;
  await page.screenshot({ path: join(out, 'frames', file), type: 'jpeg', quality: 84, fullPage: true });
  report.captures.push(file);
}
await browser.close();
await close();

report.summary = { states: ALL.length, layoutRuns: report.layout.length, multitouchRuns: report.multitouch.length, captures: report.captures.length, minTouchPx: minTouch, failures };
writeFileSync(join(out, 'check-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`states ${ALL.length} × 2 engines × 3 devices × 2 orientations = ${report.layout.length} layout runs; multi-touch runs ${report.multitouch.length} (${report.multitouch.filter((m) => m.pass).length} pass); captures ${report.captures.length}; external requests ${report.network.external.length}`);
for (const f of failures.slice(0, 40)) console.log(`FAIL ${f}`);
console.log(failures.length ? `${failures.length} failure(s)` : 'all checks pass');
process.exit(failures.length ? 1 : 0);
