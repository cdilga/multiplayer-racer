// P1-C12: normal joins, real WebRTC and host sim; emulated Gamepad API / keyboard events.
// Samples are cohorts, never source limits. Receipts default to scratch unless explicitly recaptured.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach, gpu } from './lib/chromium.mjs';
import { evidencePath } from '../lib/evidence.mjs';
import { summariseAges, redactedStats, receiptProblems } from '../../../tools/net/qualify-lib.mjs';

const BASE = '/p/c12/';
let browser, server;
before(async () => {
  server = await serve(build('./', `c12${process.env.JJ_BUILD_SUFFIX ?? ''}`), BASE, { JJ_STUN_URLS: '' });
  // The headless shell forces SwiftShader on macOS even in native mode. Full Chromium can use the host GPU.
  browser = await chromium.launch({ channel: process.env.JJ_CHROMIUM_GPU === 'native' ? 'chromium' : undefined, args: chromiumArgs });
});
after(async () => { await browser?.close(); await server?.close(); });
closeContextsAfterEach(() => browser);
const wait = (p, fn, arg, ms = 90_000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const bounded = async (job, why, ms = 10_000) => {
  let timer;
  try {
    return await Promise.race([job, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${why} did not respond within ${ms} ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
};
const until = async (p, fn, why, ms = 90_000) => {
  for (const start = Date.now(); !(await fn()); await p.waitForTimeout(100)) assert.ok(Date.now() - start < ms, why);
};
const observe = async (p) => {
  let timer;
  try {
    return await Promise.race([
      p.evaluate(() => window.__jjTest.observe()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('host observation did not respond within 10 s')), 10_000); }),
    ]);
  } catch (e) {
    console.error('C12 readout at failure:', await bounded(p.evaluate(() => ({ phase: window.__jjRoom?.view()?.phase, pauses: window.__jjTest?.pauseReasons() })), 'main-thread diagnostics').catch(() => null));
    throw e;
  } finally { clearTimeout(timer); }
};
const seats = async (p) => (await observe(p)).host.seats.filter((s) => s.presence !== 'Left');
const rows = (p) => p.evaluate(() => window.__jjSources.inspect());
const carOf = (o, n) => o.cars.find((c) => c.car === o.host.seats.find((s) => s.number === n)?.car);
const shot = async (p, name) => {
  if (!process.env.JJ_CAPTURE_DIR) return;
  mkdirSync(process.env.JJ_CAPTURE_DIR, { recursive: true });
  await p.screenshot({ path: join(process.env.JJ_CAPTURE_DIR, `${name}.png`) });
};
const shotMatrix = async (p, name) => {
  if (!process.env.JJ_CAPTURE_DIR) return;
  const original = p.viewportSize();
  for (const [width, height] of [[1366, 768], [1920, 1080], [412, 915], [915, 412], [375, 667]]) {
    await p.setViewportSize({ width, height });
    await p.waitForTimeout(600);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'no horizontal overflow after resize');
    if (await p.locator('.join-card').count()) {
      const button = p.getByRole('button', { name: 'Join the race', exact: true });
      await button.evaluate((b) => b.scrollIntoView({ block: 'end' }));
      assert.ok(await button.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const s = b.closest('.card-screen').getBoundingClientRect();
        return r.top >= s.top && r.bottom <= s.bottom && b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), 'source guidance does not cover the real Join button');
    }
    await shot(p, `${name}-${width}x${height}`);
    if (await p.locator('[data-keyboard-options]').count()) {
      await p.locator('[data-keyboard-options] .qr-card').scrollIntoViewIfNeeded();
      await shot(p, `${name}-scrolled-actions-${width}x${height}`);
      await p.locator('[data-jj-input-drawer]').evaluate((el) => { el.scrollTop = 0; });
    }
  }
  await p.setViewportSize(original);
};

function pads() {
  window.__pads = [];
  navigator.getGamepads = () => window.__pads;
  const fire = (type, gamepad) => {
    const e = new Event(type);
    Object.defineProperty(e, 'gamepad', { value: gamepad });
    dispatchEvent(e);
  };
  window.__padAdd = (i) => {
    const p = { index: i, id: `C12 pad ${i}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pads[i] = p;
    fire('gamepadconnected', p);
  };
  window.__padSet = (i, axes, buttons = {}) => {
    const p = window.__pads[i];
    p.axes = axes;
    for (const [b, v] of Object.entries(buttons)) p.buttons[b] = { pressed: v, value: Number(v) };
  };
  window.__padUnplug = (i) => {
    const p = window.__pads[i];
    window.__pads[i] = null;
    fire('gamepaddisconnected', { ...p, connected: false });
  };
  // Measurement-only taps. Every record is accounted for; there is no bound on sources.
  window.__c12Measure = false;
  window.__c12Sent = [];
  window.__c12Payload = {};
  const now = () => performance.timeOrigin + performance.now();
  const send = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (data) {
    if (window.__c12Measure && ArrayBuffer.isView(data) && data[0] === 0x10) {
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const n = d.getUint8(6), at = now();
      for (let k = 0; k < n; k++) {
        const pos = 7 + 13 * k, source = d.getUint16(pos, true), seq = d.getUint16(pos + 2, true);
        window.__c12Sent.push({ source, seq, at });
        // Account for the actual shared 7-byte header equally among the records in THIS packet.
        window.__c12Payload[source] = (window.__c12Payload[source] ?? 0) + 13 + 7 / n;
      }
    }
    return send.call(this, data);
  };
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    const i = message.input;
    if (window.__c12Measure && i?.type === 'local') window.__c12Sent.push({ source: i.source, seq: i.seq, at: i.sampledAt });
    return post.call(this, message, ...rest);
  };
}

async function hostPage(b = browser, query = '') {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  p.on('pageerror', (e) => console.error('C12 host error:', e.message));
  await p.addInitScript(pads);
  await p.goto(`${server.origin}${BASE}host?drive&test=live${query}`);
  await wait(p, () => (window.__jjNet?.code() && window.__jjTest) || document.documentElement.dataset.jjHost === 'unsupported', undefined, 180_000);
  assert.notEqual(await p.evaluate(() => document.documentElement.dataset.jjHost), 'unsupported', await p.locator('body').innerText());
  return p;
}
async function joined(url, phone = false) {
  const ctx = await browser.newContext(phone ? { hasTouch: true, isMobile: true, viewport: { width: 915, height: 412 } } : { viewport: { width: 1100, height: 700 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(pads);
  await p.goto(url);
  await wait(p, () => window.__jjSources && window.__jjController.inspect().phase === 'ready-to-join').catch(async (e) => {
    console.error('C12 join failure:', JSON.stringify({ errors, page: await bounded(p.evaluate(() => ({
      controller: window.__jjController?.inspect(), text: document.body.innerText,
      sources: !!window.__jjSources, url: location.href,
    })), 'join diagnostics').catch(() => null) }));
    throw e;
  });
  return p;
}

test('24 press-claimed seats on host, two joined laptops and two phones keep input, unplug, resume and leaving isolated', { timeout: 900_000, skip: !gpu && '24 live views require a GPU host; full and quarter-resolution SwiftShader both stall fresh input (P1-C12 receipt)' }, async () => {
  let diagnosticHost, diagnosticPages = [], diagnosticSources = [], diagnosticPattern;
  try {
  // Normal resolution and all live views: source qualification runs in the GPU workflow.
  const host = await hostPage();
  diagnosticHost = host;
  const url = await host.evaluate(() => window.__jjNet.joinUrl());
  const pages = [host];
  diagnosticPages = pages;
  for (const phone of [false, false, true, true]) pages.push(await joined(url, phone));
  const sources = [];
  diagnosticPages = pages;
  diagnosticSources = sources;
  for (const [endpoint, page] of pages.entries()) {
    const count = [4, 6, 6, 1, 1][endpoint];
    for (let i = 0; i < count; i++) {
      const before = (await seats(host)).length;
      await page.evaluate((i) => window.__padAdd(i), i);
      await page.waitForTimeout(100);
      assert.equal((await seats(host)).length, before, 'plugging in alone claims nothing');
      await page.evaluate((i) => window.__padSet(i, [0, 1, 0, 0]), i); // hold brake: deliberate input, no idle takeover
      await until(host, async () => (await seats(host)).length === before + 1, `endpoint ${endpoint} pad ${i} claims`);
      const seat = endpoint === 0 ? (await seats(host)).find((s) => s.endpoint === `local:${100 + i}`) : (await rows(page)).find((s) => s.id === `pad${i + 1}`);
      sources.push({ endpoint, page, pad: i, number: seat.number ?? seat.seat, source: endpoint === 0 ? 100 + i : seat.source, id: `pad${i + 1}` });
    }
    if (endpoint < 3) {
      for (const [id, up, down] of [[1, 'KeyW', 'KeyS'], [2, 'KeyI', 'KeyK']]) {
        const before = (await seats(host)).length;
        await page.keyboard.down(down);
        await until(host, async () => (await seats(host)).length === before + 1, `endpoint ${endpoint} keys ${id} claims`);
        const seat = endpoint === 0 ? (await seats(host)).find((s) => s.endpoint === `local:${id}`) : (await rows(page)).find((s) => s.id === `keys${id}`);
        sources.push({ endpoint, page, up, down, number: seat.number ?? seat.seat, source: endpoint === 0 ? id : seat.source, id: `keys${id}` });
      }
    }
  }
  assert.equal(sources.length, 24);
  assert.equal(new Set(sources.map((s) => s.number)).size, 24);
  assert.equal(new Set((await seats(host)).map((s) => s.car)).size, 24);
  console.log('C12: 24 distinct seats/cars claimed through the real join path');
  for (const [i, p] of pages.slice(1).entries()) assert.equal(await bounded(p.evaluate(() => window.__jjSources.sources.connections()), `endpoint ${i + 1} connection count`), 1);
  console.log('C12: four joined endpoints each use one connection');
  const set = async (s, throttle) => {
    if (s.pad !== undefined) await s.page.evaluate(([i, t]) => window.__padSet(i, [0, t ? -1 : 1, 0, 0]), [s.pad, throttle]);
    else {
      await s.page.keyboard.up(throttle ? s.down : s.up);
      await s.page.keyboard.down(throttle ? s.up : s.down);
    }
  };
  // Every source gets a distinct binary drive signature. Observing all cars after each pattern detects
  // any source permutation or crossed throttle, including across endpoints, without 48 renderer/RPC trips.
  const bits = BigInt(sources.length).toString(2).length;
  const signatures = sources.map((_, i) => BigInt(i + 1).toString(2).padStart(bits, '0'));
  for (let bit = 0; bit < bits; bit++) {
    diagnosticPattern = { bit, signatures };
    console.log(`C12: distinct drive pattern ${bit + 1}/${bits}`);
    for (const [i, s] of sources.entries()) await set(s, signatures[i][bit] === '1');
    await until(host, async () => {
      const o = await observe(host);
      return sources.every((s, i) => {
        const c = carOf(o, s.number), seat = o.host.seats.find((x) => x.number === s.number);
        if (!c || c.autopilot != null) return false;
        if (signatures[i][bit] === '1') return c.input.throttle > 0.9;
        // R116: a held full pull brakes first, then reverses. A stale queue is deliberately neutral.
        return c.input.throttle < 0.05 && (seat.fresh ? c.input.brake > 0.9 || c.input.throttle < -0.05 : c.input.brake === 0);
      });
    }, `all ${sources.length} cars receive their own drive signature, pattern ${bit + 1}`);
  }
  assert.equal(new Set(signatures).size, sources.length, 'every car was distinguished from every other car');
  for (const s of sources) await set(s, false);
  console.log('C12: all 24 sources drive only their own car');
  await shot(host, '24-host');
  await shot(pages[1], 'eight-laptop');
  await shot(pages[3], 'pad-phone-landscape');

  // Packet-to-observed-applied ages on one machine. Observing adds runner polling latency, so these are upper bounds.
  for (const p of pages) await p.evaluate(() => { window.__c12Measure = true; });
  const start = Date.now(), applied = new Map();
  const baseline = await host.evaluate(() => window.__jjTest.inputStats());
  while (Date.now() - start < 8000) {
    const sample = await host.evaluate(async () => {
      const o = await window.__jjTest.observe();
      return { at: performance.timeOrigin + performance.now(), o };
    });
    for (const seat of sample.o.host.seats) {
      const key = `${seat.endpoint}/${seat.source}/${seat.inputSeq}`;
      if (!applied.has(key)) applied.set(key, sample.at);
    }
    await host.waitForTimeout(20);
  }
  const duration = (Date.now() - start) / 1000;
  for (const p of pages) await p.evaluate(() => { window.__c12Measure = false; });
  const finalLocal = await host.evaluate(() => window.__jjTest.inputStats());
  const traces = await Promise.all(pages.map((p) => p.evaluate(() => ({ sent: window.__c12Sent, payload: window.__c12Payload }))));
  const network = await Promise.all(pages.slice(1).map(async (p) => redactedStats(await p.evaluate(async () => [...(await window.__jjSources.sources.sources.get('touch').session.link.pc.getStats()).values()]))));
  const measurements = [];
  const actualSeats = await seats(host);
  for (const s of sources) {
    const sent = new Map();
    for (const f of traces[s.endpoint].sent.filter((f) => f.source === s.source)) if (!sent.has(f.seq)) sent.set(f.seq, f.at);
    // A local sampler id (100, 101, …) has its own local endpoint, whose seat source handle is 1.
    // Network handles already belong to their shared carrier. Match the host's endpoint/handle pair in both cases.
    const hostSeat = actualSeats.find((x) => x.number === s.number);
    const ages = [...sent].flatMap(([seq, at]) => applied.has(`${hostSeat.endpoint}/${hostSeat.source}/${seq}`) ? [applied.get(`${hostSeat.endpoint}/${hostSeat.source}/${seq}`) - at] : []);
    const rtt = s.endpoint ? network[s.endpoint - 1].selectedPair?.rttMs : 0;
    const local = finalLocal.find((x) => x.source === s.source);
    const bytes = s.endpoint ? traces[s.endpoint].payload[s.source] : ((local?.sent ?? 0) - (baseline.find((x) => x.source === s.source)?.sent ?? 0)) * local.bytesPerSample;
    assert.ok(ages.length > 0, `source ${s.number} has matched applied input measurements`);
    assert.ok(ages.every((a) => a >= 0), `source ${s.number}: the observed apply follows the send`);
    assert.ok(bytes > 0, `source ${s.number} has payload records`);
    measurements.push({ endpoint: s.endpoint, source: s.source, seat: s.number, inputAge: summariseAges(ages, sent.size, rtt == null ? null : rtt / 2), payloadBytes: bytes, payloadBytesPerSecond: Math.round(bytes / duration), localAppliedAge: s.endpoint ? null : { p50Ms: local.p50, p95Ms: local.p95, p99Ms: local.p99, uncertaintyMs: 0, scope: 'rolling last 2048 applied samples; may include claim/setup before the full cohort' } });
  }
  const receipt = {
    row: 'c12-24-sources', capturedAt: new Date().toISOString(), hardware: `${process.platform}/${process.arch}; browser API emulation`, browser: `Chromium ${browser.version()}`,
    build: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), topology: 'one machine, loopback WebRTC, normal join URL', cohort: 'host 4 pads + 2 clusters; two laptops 6 pads + 2 clusters each; two phones 1 pad each; 24 seats',
    renderer: await host.evaluate(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    }),
    renderSettings: await host.evaluate(() => window.__jjRender.stats()),
    clock: { mode: 'same-clock (one machine)', uncertaintyMs: 0 },
    result: { durationSeconds: duration, driveSignatures: sources.map((s, i) => ({ seat: s.number, signature: signatures[i] })), sources: measurements, paths: network.map((n) => n.selectedPair), layers: 'Network payload: actual 13-byte records plus equal share of each actual 7-byte packet header. Local payload: encoded LocalSource bytes, no network. Network age: first wire dispatch of a sequence to first observed host-applied sequence; includes observation polling latency, an upper bound. Local exact sample-to-tick percentiles also reported. Stable refreshed sequences are not new samples. Unobserved unique sequences count as lost/coalesced. Transport bytes are not attributed per source.' },
  };
  assert.deepEqual(receiptProblems(receipt), []);
  const dir = evidencePath('P1-C12');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cohort.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log('C12: all 24 sources have measured payload and matched applied-input ages');

  const unplug = sources.filter((s) => s.pad === 0);
  const carsBefore = new Map((await seats(host)).map((s) => [s.number, s.car]));
  for (const s of unplug) await s.page.evaluate(() => window.__padUnplug(0));
  await until(host, async () => {
    const o = await observe(host);
    if (!unplug.every((s) => carOf(o, s.number)?.autopilot != null)) return false;
    for (const s of sources.filter((s) => !unplug.includes(s))) assert.equal(carOf(o, s.number).autopilot, null, `only unplugged seats autopilot: ${s.number}`);
    return true;
  }, 'one unplug per endpoint autopilots only those five seats');
  assert.equal((await seats(host)).length, 24, 'unplug holds all seats');
  for (const s of unplug) await s.page.evaluate(() => window.__padAdd(0));
  await host.waitForTimeout(300);
  const unpressed = await observe(host);
  for (const s of unplug) assert.ok(carOf(unpressed, s.number).autopilot != null, 'replug alone does not resume');
  for (const s of unplug) await set(s, false);
  await until(host, async () => {
    const o = await observe(host);
    return unplug.every((s) => {
      const c = carOf(o, s.number);
      return c?.autopilot == null && (c?.input.brake > 0.9 || c?.input.throttle < -0.05);
    });
  }, 'replug plus press resumes');
  assert.deepEqual(new Map((await seats(host)).map((s) => [s.number, s.car])), carsBefore, 'same seats and cars');
  // Explicit Leave, Remove and leave chord each affect one source, never its carrier's siblings.
  await pages[1].locator('[data-source=pad1] [data-act=leave]').click();
  await until(host, async () => (await seats(host)).length === 23, 'Leave removes one');
  await pages[2].evaluate(() => window.__padUnplug(0));
  await pages[2].locator('[data-source=pad1] [data-act=remove]').click();
  await until(host, async () => (await seats(host)).length === 22, 'Remove removes one');
  await pages[3].evaluate(() => window.__padSet(0, [0, 0, 0, 0], { 8: true, 9: true }));
  await until(host, async () => (await seats(host)).length === 21, 'the leave chord removes one');
  assert.ok((await seats(host)).every((s) => carsBefore.get(s.number) === s.car));
  } catch (e) {
    if (diagnosticHost) {
      const observation = await observe(diagnosticHost).catch((error) => ({ error: error.message }));
      const endpoints = await Promise.all(diagnosticPages.map((p) => bounded(p.evaluate(() => ({
        sources: window.__jjSources?.inspect(), local: window.__jjControls?.sources(),
        pads: window.__pads, focused: document.hasFocus(), visibility: document.visibilityState,
      })), 'cohort endpoint diagnostics').catch((error) => ({ error: error.message }))));
      const transport = await diagnosticHost.evaluate(() => window.__jjNet.inspect()).catch(() => null);
      const diagnostic = { observation, transport, endpoints, pattern: diagnosticPattern,
        sources: diagnosticSources.map(({ page, ...s }) => s) };
      mkdirSync(evidencePath('P1-C12'), { recursive: true });
      writeFileSync(join(evidencePath('P1-C12'), 'cohort-failure.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
      console.error('C12 cohort diagnostic saved:', join(evidencePath('P1-C12'), 'cohort-failure.json'));
    }
    console.error('C12 cohort failure:', e);
    throw e;
  }
});

test('Chromium full-slot guidance and second-keyboard actions show the live join QR; the numpad is a third independent cluster', { timeout: 300_000 }, async () => {
  const host = await hostPage();
  const url = await host.evaluate(() => window.__jjNet.joinUrl());
  const lap = await joined(url);
  for (const p of [host, lap]) await p.evaluate(() => { for (let i = 0; i < 4; i++) window.__padAdd(i); });
  for (const p of [host, lap]) {
    const hint = p.locator('[data-more-pads]');
    await hint.waitFor();
    assert.match(await hint.innerText(), /another laptop or phone.*Firefox/);
  }
  await host.locator('[data-keyboard-options] summary').click();
  assert.equal(await host.locator('[data-keyboard-options] a').getAttribute('href'), url);
  await host.locator('[data-keyboard-options] img.qr').waitFor();
  for (const label of ['Keys A', 'Keys B', 'Keys C']) assert.match(await host.locator('.dr-legends').innerText(), new RegExp(label));
  await shotMatrix(host, 'keyboard-actions');
  if (process.env.JJ_CAPTURE_DIR) {
    await host.setViewportSize({ width: 1920, height: 1080 });
    await host.locator('.drawer-head').click();
    await host.evaluate(() => document.documentElement.requestFullscreen());
    assert.ok(await host.evaluate(() => !!document.fullscreenElement), 'actual fullscreen entered');
    await host.waitForTimeout(600);
    await shot(host, 'keyboard-actions-fullscreen');
    await host.evaluate(() => document.exitFullscreen());
    await host.waitForTimeout(600);
    await shot(host, 'keyboard-actions-after-fullscreen');
  }
  await host.keyboard.down('Numpad8');
  await until(host, async () => (await seats(host)).some((s) => s.endpoint === 'local:3'), 'numpad press claims');
  const numpad = (await seats(host)).find((s) => s.endpoint === 'local:3');
  assert.equal(typeof numpad.inputSeq, 'number', `the real host exposes its applied wire sequence: ${JSON.stringify(numpad)}`);
  await host.keyboard.up('Numpad8');
  assert.equal((await seats(host)).length, 1, 'numpad claims only its cluster');
  await shotMatrix(lap, 'joined-full-slots');
});

test('Firefox exposes eight emulated host pads and each press claims a distinct seat', { timeout: 360_000 }, async () => {
  // Linux CPU runners cannot create WebGL in Firefox's headless mode. The same Mesa driver works with Xvfb.
  let display;
  const software = process.platform === 'linux' && !gpu;
  if (software) {
    display = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1366x768x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  }
  let ff;
  try {
    const env = software ? { ...process.env, DISPLAY: `:${await bounded(new Promise((resolve, reject) => {
      display.stdio[3].once('data', (v) => resolve(v.toString().trim()));
      display.once('error', reject);
      display.once('exit', (code) => reject(new Error(`Xvfb exited ${code}`)));
    }), 'Firefox virtual display')}`, LIBGL_ALWAYS_SOFTWARE: '1' } : undefined;
    ff = await firefox.launch({ headless: !software, env, firefoxUserPrefs: software ? { 'webgl.force-enabled': true } : {} });
    const host = await hostPage(ff);
    for (let i = 0; i < 8; i++) {
      await host.evaluate((i) => window.__padAdd(i), i);
      assert.equal((await seats(host)).length, i);
      await host.evaluate((i) => window.__padSet(i, [0, 1, 0, 0]), i);
      await until(host, async () => (await seats(host)).length === i + 1, `Firefox pad ${i} claims`);
    }
    assert.equal(new Set((await seats(host)).map((s) => s.car)).size, 8);
    assert.equal(await host.locator('[data-more-pads]').count(), 0, 'Chromium slot guidance is not a Firefox limit');
    await wait(host, () => window.__jjRender.tileRects()?.length === 8);
    await host.waitForTimeout(600);
    await shot(host, 'firefox-eight');
  } finally { await ff?.close(); display?.kill(); }
});

test('WebKit host drawer shows the room QR and all three keyboard layouts across phone and TV sizes', { timeout: 180_000 }, async () => {
  const wk = await webkit.launch();
  try {
    const host = await hostPage(wk);
    await host.locator('[data-keyboard-options] summary').click();
    const url = await host.evaluate(() => window.__jjNet.joinUrl());
    assert.equal(await host.locator('[data-keyboard-options] a').getAttribute('href'), url);
    assert.ok(await host.locator('[data-keyboard-options] img.qr').evaluate((i) => i.complete && i.naturalWidth > 0));
    for (const label of ['Keys A', 'Keys B', 'Keys C']) assert.match(await host.locator('.dr-legends').innerText(), new RegExp(label));
    await shotMatrix(host, 'webkit-keyboard-actions');
  } finally { await wk.close(); }
});
