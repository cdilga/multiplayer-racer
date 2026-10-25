// A car carried round a generated loop-the-loop (`jj procgen --mix`, a seed whose lap has a loop), through the real
// host renderer and Rust/WASM sim. The field starts on the route short of the loop's entry under the autopilot; the
// shot is kept only if the followed car goes inverted on camera. 60 fps, 2 ticks and 1/60 s of page clock per frame.
//   JJ_PROMO_BUILD=web/dist-test/promo-grow JJ_PROMO_CAPTURE=/tmp/jj-promo3-loop node tools/promo/capture-loop.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build, serve } from '../../web/landing/tests/lib/site.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const out = process.env.JJ_PROMO_CAPTURE ?? '/tmp/jj-promo3-loop';
mkdirSync(out, { recursive: true });
const [W, H] = (process.env.JJ_PROMO_SIZE ?? '1920x1080').split('x').map(Number);
const seed = Number(process.env.JJ_PROMO_SEED ?? 1);
const seconds = Number(process.env.JJ_PROMO_SECONDS ?? 8);
const back = Number(process.env.JJ_PROMO_BACK ?? 45); // route points short of the entry
execFileSync(process.env.JJ_BIN ?? 'target/debug/jj', ['procgen', '--seed', String(seed), '--mix', '--out', out, '--json'], { stdio: 'ignore' });
const map = readFileSync(join(out, 'map.json'), 'utf8');
const loop = JSON.parse(map).features.find((f) => f.kind === 'loop');
assert.ok(loop, `seed ${seed} has a loop`);
const entry = loop.params.entry;
const cars = 3;
const fixture = { scenario: 'promo-loop', what: 'Promotional loop capture', map: 'promo.json', seed, ticks: 3600, cars: Array.from({ length: cars }, (_, i) => ({ routePoint: entry - back - i * 5, lateral: i % 2 ? 1.6 : -1.6, lift: 0.5 })), seats: Array.from({ length: cars }, (_, i) => ({ name: `Racer ${i + 1}`, car: i })), inputs: [] };
const receipt = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fps: 60, simHz: 120, size: [W, H], seed, loop: loop.params, fixture, driving: 'Sim autopilot (staged footage)' };

const server = await serve(process.env.JJ_PROMO_BUILD ?? build('./', 'promo-loop'), '/p/promo/', { JJ_STUN_URLS: '' });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.error(e.message));
await page.addInitScript(() => {
  const real = performance.now.bind(performance);
  let virt = null;
  window.__promoClock = { start: () => (virt = real()), advance: (ms) => (virt += ms) };
  performance.now = () => virt ?? real();
});
try {
  await page.route('**/promo-map.json', (r) => r.fulfill({ contentType: 'application/json', body: map }));
  await page.goto(`${server.origin}/p/promo/host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/promo-map.json')}`);
  await page.waitForFunction(() => window.__jjTest && window.__jjRender);
  await page.evaluate(async ({ fixture, map }) => {
    window.__jjRender.hold();
    await window.__jjTest.load(fixture, map);
    window.__jjRender.setFollow([0]);
    await window.__jjTest.command({ cmd: 'autopilot', on: true });
    await window.__jjTest.step(120);
    window.__promoClock.start();
    window.__jjRender.frame();
  }, { fixture, map });
  await page.addStyleTag({ content: 'body > :not(canvas):not(#app){visibility:hidden!important} #app > :not(canvas){visibility:hidden!important}' });
  const frames = join(out, 'loop-frames');
  mkdirSync(frames, { recursive: true });
  let minUp = 1;
  const ups = [];
  for (let f = 0; f < seconds * 60; f++) {
    const up = await page.evaluate(async () => {
      await window.__jjTest.step(2);
      window.__promoClock.advance(1000 / 60);
      window.__jjRender.frame();
      return (await window.__jjTest.observe()).cars[0].upY;
    });
    minUp = Math.min(minUp, up);
    ups.push(Number(up.toFixed(3)));
    await page.screenshot({ path: join(frames, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
  receipt.minUp = minUp;
  receipt.invertedFrames = ups.map((u, i) => (u < -0.5 ? i : -1)).filter((i) => i >= 0);
  assert.ok(minUp < -0.5, `car 0 went round the loop on camera (min up ${minUp})`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', join(frames, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', join(out, 'loop.mp4')]);
  console.log('captured loop', minUp, receipt.invertedFrames[0], receipt.invertedFrames.at(-1));
} finally {
  writeFileSync(join(out, 'capture.json'), JSON.stringify(receipt, null, 2));
  await browser.close();
  await server.close();
}
