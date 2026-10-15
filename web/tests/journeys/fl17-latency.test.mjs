// P1-FL17 (R134, the Carmack lens): thumb-to-screen latency, stage by stage. The real host (`B/host?drive&test=live`)
// and a real phone controller from one build, served by jj-server, over WebRTC in Chromium. The phone's drive stick is
// moved by touch events (CDP), so the path starts at a real pointer event: touch -> the controller's send -> off the data
// channel on the host's main thread -> into the sim worker -> applied at a tick boundary -> the first frame drawn at or
// past that tick. Both pages run in one browser, so every stamp shares one clock. CI fails if a host-side stage is over
// its committed budget (lib/latency-budget.json): the render stages only with a real GPU (JJ_CHROMIUM_GPU=1, the CI GPU
// workflow); the whole-path numbers are reported, not gated (they depend on the network and the phone). `JJ_LATENCY_OUT=<file.json>` writes the receipt. TURN: set `TURN_STATIC_AUTH_SECRET` and
// `JJ_TURN_URLS` (tools/net/local-coturn.sh up) and the run repeats with both pages forced onto the relay.
//   node --test web/tests/journeys/fl17-latency.test.mjs
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, gpu } from './lib/chromium.mjs';
import { BUDGET, joinStages, overBudget, summarise } from './lib/latency.mjs';
import { confirmInitialVehicle } from './lib/vehicle.mjs';

const BASE = '/p/fl17/';
const OUT = process.env.JJ_LATENCY_OUT;
const TURN = process.env.TURN_STATIC_AUTH_SECRET && process.env.JJ_TURN_URLS;
/** Stick moves per run, ~30 a second: enough for a p99. */
const MOVES = Number(process.env.JJ_LATENCY_MOVES ?? 300);
let browser;
let server;
const receipt = { bead: 'br-bbki.17', p1: 'P1-FL17', browser: 'Playwright Chromium (one machine, two contexts)', renderer: gpu ? 'GPU' : 'SwiftShader', budget: BUDGET, runs: {} };

before(async () => {
  server = await serve(build('./', 'fl17'), BASE, TURN ? { TURN_STATIC_AUTH_SECRET: process.env.TURN_STATIC_AUTH_SECRET, JJ_TURN_URLS: process.env.JJ_TURN_URLS } : { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (OUT) writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
});

const wait = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });

async function run(label, ice) {
  const q = ice === 'relay' ? '&ice=relay' : '';
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostCtx.newPage();
  await host.goto(`${server.origin}${BASE}host?drive&test=live${q}`);
  await wait(host, () => window.__jjNet?.code() && window.__jjTest, undefined, 60_000);
  const joinUrl = await host.evaluate(() => window.__jjNet.joinUrl());
  const phoneCtx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  const phone = await phoneCtx.newPage();
  await phone.goto(ice === 'relay' ? `${joinUrl}${joinUrl.includes('?') ? '&' : '?'}ice=relay` : joinUrl);
  await wait(phone, () => window.__jjController?.inspect().phase === 'ready-to-join');
  await phone.locator('#name').fill('Thumbs');
  await phone.getByRole('button', { name: 'Join the race' }).click();
  await wait(phone, () => window.__jjController.inspect().phase === 'playing');
  await confirmInitialVehicle(phone);
  for (const sel of ['[data-act=tut-skip]', '[data-act=skip]']) {
    const el = phone.locator(sel).first();
    if (await el.count() && await el.isVisible()) await el.click().catch(() => {});
  }
  if (ice === 'relay') {
    const path = await host.evaluate(() => window.__jjNet.paths?.());
    assert.ok(JSON.stringify(path).includes('relay'), `${label}: the host isn't on the relay: ${JSON.stringify(path)}`);
  }

  // Real touches on the drive zone: down, then a figure of small moves at ~30 Hz, each a new stick value.
  const zone = await phone.locator('.zone.drive').boundingBox();
  const cx = zone.x + zone.width / 2;
  const cy = zone.y + zone.height * 0.58;
  const cdp = await phoneCtx.newCDPSession(phone);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await host.evaluate(() => window.__jjRender.tickTrace(true));
  await touch('touchStart', cx, cy);
  for (let i = 0; i < MOVES; i++) {
    const a = (i / 20) * Math.PI;
    await touch('touchMove', cx + Math.cos(a) * 30, cy - 10 - Math.abs(Math.sin(a)) * 30);
    await phone.waitForTimeout(33);
  }
  await touch('touchEnd', cx, cy);
  await host.waitForTimeout(500);
  const frames = await host.evaluate(() => window.__jjRender.tickTrace(false));
  const net = await host.evaluate(() => window.__jjTest.netStamps());
  const sent = await phone.evaluate(() => window.__jjController.latency());
  const rows = joinStages(sent, net, frames);
  const summary = summarise(rows, frames);
  receipt.runs[label] = summary;
  console.log(`# ${label}: ${JSON.stringify(summary)}`);
  assert.ok(rows.length >= MOVES / 3, `${label}: only ${rows.length} touches traced through to a frame (of ${MOVES} moves)`);
  assert.deepEqual(overBudget(summary, gpu), [], `${label}: host-side stages over budget`);
  await phoneCtx.close();
  await hostCtx.close();
}

test('FL17: thumb-to-screen stages on loopback WebRTC, host-side within budget', { timeout: 240_000 }, () => run('lan-loopback', 'all'));
test('FL17: the same through TURN (relay forced)', { timeout: 240_000, skip: TURN ? false : 'no TURN configured (TURN_STATIC_AUTH_SECRET, JJ_TURN_URLS)' }, () => run('turn-relay', 'relay'));
