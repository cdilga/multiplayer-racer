// Artifacts default to OS scratch; set JJ_EVIDENCE_DIR / JJ_EVIDENCE / JJ_CAPTURE_DIR explicitly to recapture a committed receipt.
import { evidencePath } from '../lib/evidence.mjs';
// P1-R06: Identify on a crowded TV. Synthetic controllers (the host page's test surface feeds their hello, claim,
// ready and identify frames as they'd arrive from phones, so no WebRTC is needed) fill a room: at 24 one seat's
// Identify pulses only its own tile and floats its number over its car; then the room grows to 120 (no cap) and a
// three-digit seat's badge, Cooee label and number over its car render without clipping. Captures `identify-24` and
// `identify-108` to $JJ_CAPTURE_DIR (default OS scratch).
//   JJ_CHROMIUM_GPU=1 node --test web/tests/journeys/r06-identify.test.mjs   (24-120 tiles want a GPU host)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, gpu } from './lib/chromium.mjs';

const BASE = '/p/r06/';
const CAPTURE = evidencePath('P1-R06', 'JJ_CAPTURE_DIR');
let browser;
let server;

before(async () => {
  server = await serve(build('./', 'r06'), BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ channel: process.env.JJ_CHROMIUM_GPU === 'native' ? 'chromium' : undefined, args: chromiumArgs });
  mkdirSync(CAPTURE, { recursive: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const wait = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const frame = (host, endpoint, f) => host.evaluate(([endpoint, f]) => window.__jjTest.input({ type: 'controller', endpoint, frame: f }), [endpoint, f]);

async function join(host, from, to) {
  for (let k = from; k <= to; k++) {
    await frame(host, `syn${k}`, { hello: true });
    await frame(host, `syn${k}`, { claim: `Racer ${k}` });
  }
  await wait(host, (n) => window.__jjRoom.view().seats.length === n, to);
}

/** Presses Identify for seat number `n`; returns what the TV shows for it. */
async function identify(host, n) {
  const before = await host.evaluate(() => window.__jjRoom.identified().length);
  // A claim flashes Identify itself and starts the seat's 3 s (sim-time) limit; a loaded host runs fewer ticks than real
  // time, so a press soon after joining can be refused as limited. Press again until it lands, as a player would.
  for (let tries = 0; ; tries++) {
    await frame(host, `syn${n}`, { identify: true });
    try {
      // Capture the live pulse atomically with its own new event. A different seat's delayed join flash must
      // not satisfy this wait, and a second round-trip on a 120-tile host can outlast the 1.6 s pulse.
      const shown = await host.waitForFunction(({ n, before }) => {
        const room = window.__jjRoom.view();
        const seat = room.seats.find((s) => s.number === n);
        if (!window.__jjRoom.identified().slice(before).some(e => e.seat === seat.seat)) return false;
        const box = document.querySelector(`.hud-tile.identify[data-seat="${seat.seat}"]`);
        if (!box) return false;
        const fits = (el) => !!el && el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().width > 0;
        const c = box.querySelector('.hud-cooee')?.getBoundingClientRect();
        const t = box.getBoundingClientRect();
        return {
          seat: seat.seat, car: seat.car,
          pulsing: [...document.querySelectorAll('.hud-tile.identify')].map(b => Number(b.dataset.seat)),
          marks: window.__jjRender.identifyMarks(),
          badge: box.querySelector('.hud-badge')?.textContent,
          badgeFits: fits(box.querySelector('.hud-badge')),
          cooee: box.querySelector('.hud-cooee')?.textContent,
          cooeeInside: !!c && c.left >= t.left && c.right <= t.right,
        };
      }, {n, before}, {timeout:1500,polling:50});
      // Capture the compositor now: Playwright's normal screenshot waits for font/layout stability, which can
      // consume the entire transient on a crowded host. CDP captures the actual browser surface without that wait.
      const cdp = await host.context().newCDPSession(host);
      try {
        const { data } = await cdp.send('Page.captureScreenshot', {format:'png',fromSurface:true,captureBeyondViewport:false});
        writeFileSync(`${CAPTURE}/identify-${n === 7 ? '24' : n}.png`, Buffer.from(data,'base64'));
      } finally { await cdp.detach(); }
      const state = await shown.jsonValue();
      await shown.dispose();
      return state;
    } catch (e) {
      if (tries >= 12) throw e;
    }
  }
}

test("R06: Identify pulses only its seat's tile and floats its number over its car, at 24 seats and at 120 (three digits)", { timeout: 600_000, skip: !gpu && '24-120 tiles need a GPU host (JJ_CHROMIUM_GPU=1); software WebGL stalls the page' }, async () => {
  const host = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?room&test=live&laps=5`);
  await wait(host, () => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');

  await join(host, 1, 24);
  for (let k = 1; k <= 24; k++) await frame(host, `syn${k}`, { ready: true });
  await wait(host, () => window.__jjRoom.view().phase === 'Running');
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await host.waitForTimeout(2000);
  const at24 = await identify(host, 7);
  assert.deepEqual(at24.pulsing, [7], `only #7's tile pulses: ${JSON.stringify(at24)}`);
  assert.deepEqual(at24.marks, [at24.car], 'its number floats over its car');
  assert.equal(at24.cooee, 'Cooee #7');

  // Grow to 120: drop-ins get numbers past 99.
  await join(host, 25, 120);
  await host.evaluate(() => window.__jjTest.command({ cmd: 'autopilot', on: true }));
  await host.waitForTimeout(2500);
  const at108 = await identify(host, 108);
  assert.deepEqual(at108.pulsing, [108], JSON.stringify(at108));
  assert.equal(at108.badge, '#108');
  assert.ok(at108.badgeFits, `the three-digit badge isn't clipped: ${JSON.stringify(at108)}`);
  assert.deepEqual(at108.marks, [at108.car]);
  assert.equal(at108.cooee, 'Cooee #108');
  assert.ok(at108.cooeeInside, 'the Cooee label stays inside its tile');
  assert.deepEqual(errors, []);
});
