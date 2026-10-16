// br-293l: WebKit lost the number badges' paint and drew the docked QR near-black after a host resize. A real room
// (jj-server, `host?room&test=live`) races with enough seats that the QR docks in the footer, then the host is resized
// round and round (TV, laptop, phone both ways) and put in and out of full screen, three times over, in Chromium and in
// WebKit. After every step each visible number badge (player tiles, positions) must be painted in its seat colour; a QR in
// a grid cell must decode to the room's join URL from a screenshot, and the small docked footer QR must be paper and ink.
// JJ_CAPTURE_DIR=<dir> keeps a still per step.
//   node --test web/tests/journeys/r-resize-paint.test.mjs   (JJ_PREVIEW_URL=<preview>/ for a deployed build)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { chromium, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';

// JJ_PREVIEW_URL=https://jammers-preview.dilger.dev/p/v02-<sha8>/ runs the same against a deployed preview.
const deployed = process.env.JJ_PREVIEW_URL ? new URL(process.env.JJ_PREVIEW_URL) : null;
const BASE = deployed ? deployed.pathname.replace(/\/?$/, '/') : '/p/rresize/';
const OUT = process.env.JJ_CAPTURE_DIR;
const SIZES = [[1920, 1080], [1366, 768], [915, 412], [412, 915]];
const ROUNDS = 3;
let server;
before(async () => { server = deployed ? { origin: deployed.origin, close: async () => {} } : await serve(build('./', 'rresize'), BASE, { JJ_STUN_URLS: '' }); });
after(async () => { await server?.close(); });

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);
/** Two animation frames after layout: what the next screenshot can be expected to show. */
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Synthetic seats join and ready until the race runs and the QR has no grid cell (it docks in the footer). */
async function raceWithDockedQr(host) {
  let k = 0;
  const add = async () => {
    k++;
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
    await frame(host, `syn${k}`, { ready: true });
  };
  // Four seats join and claim before any readies, so the race starts with four cars (a seat that readies alone can
  // start a one-car race in a slower engine).
  for (k = 1; k <= 4; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
  }
  k = 4;
  for (let i = 1; i <= 4; i++) await frame(host, `syn${i}`, { ready: true });
  await wait(host, () => window.__jjRoom.view().phase === 'Running', undefined, 90_000);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  for (let t0 = Date.now(); !(await host.evaluate(() => /\bqr\b/.test(document.documentElement.dataset.gridDock ?? ''))); ) {
    assert.ok(Date.now() - t0 < 120_000, 'the QR never docked in the footer');
    await add();
    await host.waitForTimeout(800);
  }
}

/** The visible badges with their boxes and resolved seat colour, and the visible QR's box (footer or grid cell). */
const scene = (host) => host.evaluate(() => {
  // On screen and not clipped or covered: the hit test at its centre lands on it (the positions strip clips copies).
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (!(r.width > 4 && r.height > 4 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight)) return false;
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return !!hit && (hit === e || e.contains(hit) || hit.contains(e));
  };
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(innerWidth, r.right) - Math.max(0, r.left), h: Math.min(innerHeight, r.bottom) - Math.max(0, r.top) }; };
  const fill = (e) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--b)';
    e.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c.match(/[\d.]+/g).slice(0, 3).map(Number);
  };
  const badges = [...document.querySelectorAll('.hud-badge, .jj-foot .badge, .jj-filler .badge')].filter(shown).map((e) => ({ text: e.textContent.trim(), rgb: fill(e), ...box(e) }));
  const qr = [...document.querySelectorAll('.foot-qr img, .jj-qrcell .qr')].find(shown);
  return { badges, qr: qr ? { where: qr.closest('.foot-qr') ? 'footer' : 'grid', ...box(qr) } : null, fullscreen: !!document.fullscreenElement };
});

/** The share of a box's pixels near `rgb`. A painted badge is a good part its seat colour (small ones are half text and
 *  pattern: ~0.15 at 28x18 px); a blank one shows the scene or the footer's navy (~0). */
function share(png, b, rgb) {
  let near = 0;
  let n = 0;
  for (let y = Math.ceil(b.y); y < Math.floor(b.y + b.h); y++) {
    for (let x = Math.ceil(b.x); x < Math.floor(b.x + b.w); x++) {
      const i = (y * png.width + x) * 4;
      n++;
      if (Math.hypot(png.data[i] - rgb[0], png.data[i + 1] - rgb[1], png.data[i + 2] - rgb[2]) < 80) near++; // seat patterns stripe the fill
    }
  }
  return n ? near / n : 0;
}

/** The share of a box's pixels that are light (paper) and dark (ink). */
function tones(png, b) {
  let light = 0;
  let dark = 0;
  let n = 0;
  for (let y = Math.ceil(b.y); y < Math.floor(b.y + b.h); y++) {
    for (let x = Math.ceil(b.x); x < Math.floor(b.x + b.w); x++) {
      const i = (y * png.width + x) * 4;
      const l = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
      n++;
      if (l > 170) light++;
      else if (l < 90) dark++;
    }
  }
  return { light: light / n, dark: dark / n };
}

function decodeAt(png, b) {
  const pad = 6;
  const x0 = Math.max(0, Math.floor(b.x) - pad);
  const y0 = Math.max(0, Math.floor(b.y) - pad);
  const w = Math.min(png.width - x0, Math.ceil(b.w) + 2 * pad);
  const h = Math.min(png.height - y0, Math.ceil(b.h) + 2 * pad);
  // A docked footer QR is ~44 px: scale it up (nearest neighbour, as a phone's camera sees more pixels) before decoding.
  const k = 4;
  const out = new Uint8ClampedArray(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) {
    for (let x = 0; x < w * k; x++) {
      const i = ((y0 + Math.floor(y / k)) * png.width + x0 + Math.floor(x / k)) * 4;
      out.set(png.data.subarray(i, i + 4), (y * w * k + x) * 4);
    }
  }
  return jsQR(out, w * k, h * k)?.data ?? null;
}

async function check(host, joinUrl, at) {
  await host.waitForTimeout(500);
  // Hold the moving parts still so the boxes measured are the pixels captured. The positions strip's scroll runs on
  // Chromium's compositor, where a paused animation can still be drawn a step on: it's switched off for the capture
  // (the strip rests at its start), and anything else animating is paused.
  await host.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'jj-still';
    st.textContent = '.foot-pos-track { animation: none !important; }';
    document.head.append(st);
    for (const a of document.getAnimations()) a.pause();
  });
  // The positions also re-order live (the race runs on autopilot): measure on both sides of the screenshot and retry until
  // nothing moved in between.
  let s;
  let buf;
  for (let tries = 0; ; tries++) {
    await settle(host);
    s = await scene(host);
    buf = await host.screenshot();
    if (JSON.stringify(await scene(host)) === JSON.stringify(s)) break;
    assert.ok(tries < 10, `${at}: the screen never held still for a capture`);
  }
  await host.evaluate(() => { document.getElementById('jj-still')?.remove(); for (const a of document.getAnimations()) a.play(); });
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${at.replace(/\s+/g, '-')}.png`, buf); } // the frame judged
  const png = PNG.sync.read(buf);
  // Screenshots are in CSS px only at DPR 1 (the contexts below use it).
  assert.equal(png.width, await host.evaluate(() => innerWidth), `${at}: screenshot scale`);
  assert.ok(s.badges.length > 0, `${at}: no number badge on screen`);
  for (const b of s.badges) assert.ok(share(png, b, b.rgb) >= 0.08, `${at}: badge ${b.text} at ${JSON.stringify([b.x, b.y, b.w, b.h].map(Math.round))} lost its paint (${share(png, b, b.rgb).toFixed(2)} of it is its seat colour)`);
  assert.ok(s.qr, `${at}: no QR on screen`);
  if (s.qr.where === 'grid') assert.equal(decodeAt(png, s.qr), joinUrl, `${at}: the grid QR doesn't scan`);
  else {
    // The docked footer QR (~44 px, ~1.5 px a module: a tap-to-enlarge button, scanned from the big card) can't be read
    // from a 1x screenshot (at 22 px its modules blur to grey); the defect was a near-black one, so it must still be mostly
    // paper with ink in it.
    const { light, dark } = tones(png, s.qr);
    assert.ok(light >= 0.3 && 1 - light >= 0.2, `${at}: the footer QR isn't paper and ink (light ${light.toFixed(2)}, dark ${dark.toFixed(2)})`);
  }
  return s;
}

for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`${engine}: badges keep their paint and the QR scans through repeated resizes and full screen (br-293l)`, { timeout: 600_000 }, async () => {
    const browser = await type.launch(engine === 'chromium' ? { args: chromiumArgs } : {});
    try {
      const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
      const errors = [];
      host.on('pageerror', (e) => errors.push(e.message));
      await host.goto(`${server.origin}${BASE}host?room&test=live&laps=9`);
      await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
      const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
      await raceWithDockedQr(host);
      const cars = await host.evaluate(() => document.querySelectorAll('.hud-badge').length);
      assert.ok(cars >= 4, `only ${cars} player tiles in the race`);
      let fullscreenSeen = false;
      for (let round = 1; round <= ROUNDS; round++) {
        for (const [w, h] of SIZES) {
          await host.setViewportSize({ width: w, height: h });
          await check(host, joinUrl, `${engine} r${round} ${w}x${h}`);
        }
        // Full screen in and out (the document's own API, as the host's button calls it).
        await host.setViewportSize({ width: 1366, height: 768 });
        const entered = await host.evaluate(() => document.documentElement.requestFullscreen().then(() => true, () => false));
        fullscreenSeen ||= entered;
        await check(host, joinUrl, `${engine} r${round} fullscreen-${entered}`);
        if (entered) await host.evaluate(() => document.exitFullscreen());
        await check(host, joinUrl, `${engine} r${round} after-fullscreen`);
      }
      assert.deepEqual(errors, []);
      console.log(`# ${engine}: ${ROUNDS} rounds of ${SIZES.length} sizes + full screen (${fullscreenSeen ? 'entered' : 'refused by this browser'}) checked`);
    } finally {
      await browser.close();
    }
  });
}
