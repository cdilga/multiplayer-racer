// br-dim.4 journey: the chase camera swings round when the car reverses, on the real host path (web/dist, headless
// Chromium). The controllers are the test surface's fake controllers: they join through the real controller path
// (Hello + Claim as cmd-channel bytes) and send DRIVE state, which is what a phone does; no real WebRTC phone is in the
// loop (honest label). Run:  npm --prefix web run build && node web/host/tests/reverse-camera.mjs
// Writes JPGs and reverse-run.json to docs/evidence/br-dim.4/.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const ev = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/br-dim.4');
await mkdir(ev, { recursive: true });
const server = await serve(join(repo, 'web/dist'));
const browser = await chromium.launch();
const out = { browser: `Chromium ${browser.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}`, runs: {} };

const FULL = 32767;
async function scenario(name, viewport, players) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  await openHost(page, `${server.url}/host/?test=live&tiles=${players}`);
  const eps = [];
  for (let i = 0; i < players; i++) eps.push(await page.evaluate((n) => window.__jjTest.join(`P${n}`), i + 1));
  const seat = eps[0].seat;
  const drive = (y, x = 0) => page.evaluate(([e, a, b]) => window.__jjTest.drive(e, [a, b]), [eps[0].endpoint, x, y]);
  // Only the first fake sends DRIVE. Found on the way: every fake joins as source 1 and the sim applies the last frame
  // it saw to all of them, so competing senders flicker every car's input; with one sender all tiles do the same drive.
  const cam = () => page.evaluate((s) => window.__jjRender.cameras()[s], seat);
  const log = [];
  const shot = async (label) => {
    const c = await cam();
    await page.screenshot({ path: join(ev, `${name}-${label}.jpg`), type: 'jpeg', quality: 80 });
    const after = await cam();
    log.push({ label, ...c.reverse, speed: c.speed, yawDegAfterShot: after.reverse.yawDeg, cuts: after.cuts });
  };
  // The sim runs on its own clock, but a fake's stick is only re-sent by the surface's untilFact, so a pump re-sends it
  // every 30 ms (as a phone does) for the whole scenario; all waits below poll the camera in the page's own frames.
  await page.evaluate(() => {
    const pump = async () => { await window.__jjTest.untilFact(() => false, { maxTicks: 1, every: 1 }); window.__pump = setTimeout(pump, 30); };
    pump();
  });
  // Per-frame trace of the camera's swing (render time), to show it is smooth at the tile size under test.
  await page.evaluate((s) => {
    window.__trace = [];
    const tick = (now) => { const r = window.__jjRender.cameras()[s]?.reverse; if (r) window.__trace.push([Math.round(now), r.yawDeg]); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, seat);
  const until = async (pred, timeoutMs = 20000) => {
    const t0 = Date.now();
    let c = await cam();
    while (!pred(c)) {
      assert.ok(Date.now() - t0 < timeoutMs, `${name}: condition not reached (${JSON.stringify(c)})`);
      await page.waitForTimeout(25);
      c = await cam();
    }
    return c;
  };
  // The swing runs on render time (not sim ticks), so poll in the page's own frames to catch it part-way round.
  const midSwing = () => page.waitForFunction((s) => { const b = window.__jjRender.cameras()[s].reverse.blend; return b > 0.3 && b < 0.7; }, seat, { polling: 'raf', timeout: 5000 }).catch(() => log.push({ label: 'missed-mid-swing' }));
  // 1. Forward.
  await drive(FULL);
  await until((c) => c.speed > 6);
  const fwd = await cam();
  assert.equal(fwd.reverse.reversing, false);
  await shot('1-forward');
  // 2. Brake to a stop, then hold reverse.
  await drive(-FULL);
  const rev = await until((c) => c.reverse.reversing);
  await midSwing();
  await shot('2-mid-swing');
  await until((c) => c.reverse.blend >= 1);
  await until((c) => c.reverse.signedMps < -2);
  await shot('3-reversing');
  assert.ok((await cam()).reverse.yawDeg > 179);
  // 3. Forward again.
  await drive(FULL);
  await until((c) => !c.reverse.reversing);
  await midSwing();
  await shot('4-mid-swing-back');
  await until((c) => c.reverse.blend <= 0);
  await until((c) => c.speed > 5);
  await shot('5-back-forward');
  const trace = await page.evaluate(() => window.__trace);
  let maxJump = 0;
  for (let i = 1; i < trace.length; i++) maxJump = Math.max(maxJump, Math.abs(trace[i][1] - trace[i - 1][1]));
  assert.ok(Math.max(...trace.map((p) => p[1])) >= 179 && trace.at(-1)[1] === 0, `${name}: swung to the rear and back`);
  // Never a snap: with frames of up to maxDtS (0.1 s) the smoothstep's biggest per-frame step is 1.5 * 180 deg * 0.1 / blendS.
  assert.ok(maxJump <= (1.5 * 180 * 0.1) / 0.7 + 1, `${name}: biggest per-frame yaw step ${maxJump.toFixed(1)} deg`);
  assert.deepEqual(errors, [], `${name}: page errors`);
  out.runs[name] = { viewport, players, firstReversing: rev.reverse, maxFrameYawStepDeg: +maxJump.toFixed(1), frames: trace.length, log };
  await page.close();
}

try {
  await scenario('phone-1tile-412x915', { width: 412, height: 915 }, 1);
  await scenario('tv-6tiles-1920x1080', { width: 1920, height: 1080 }, 6);
} finally {
  await writeFile(join(ev, 'reverse-run.json'), `${JSON.stringify(out, null, 2)}\n`);
  await browser.close();
  server.close();
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.runs).map(([k, v]) => [k, v.log.map((l) => `${l.label}:${l.yawDeg}`)]))));
