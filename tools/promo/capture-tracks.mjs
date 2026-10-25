// Generated tracks, one biome each, through the real host renderer and Rust/WASM sim at 60 fps (2 ticks per frame).
// A small field under the autopilot; each map comes straight from `jj procgen`, given to both the renderer and the sim.
//   JJ_PROMO_BUILD=web/dist-test/promo-grow JJ_PROMO_CAPTURE=/tmp/jj-promo3-tracks node tools/promo/capture-tracks.mjs
import { chromium } from 'playwright';
import { build, serve } from '../../web/landing/tests/lib/site.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const out = process.env.JJ_PROMO_CAPTURE ?? '/tmp/jj-promo3-tracks';
mkdirSync(out, { recursive: true });
const [W, H] = (process.env.JJ_PROMO_SIZE ?? '1920x1080').split('x').map(Number);
const shots = [
  { id: 'dirt', recipe: 'outback-dirt', seed: 3 },
  { id: 'bitumen', recipe: 'outback-bitumen', seed: 1 },
  { id: 'town', recipe: 'town', seed: 1 },
  { id: 'rocks', recipe: 'rocks', seed: 1 },
];
const seconds = Number(process.env.JJ_PROMO_SECONDS ?? 3);
const cars = 6;
const server = await serve(process.env.JJ_PROMO_BUILD ?? build('./', 'promo-tracks'), '/p/promo/', { JJ_STUN_URLS: '' });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.error(e.message));
// The page clock advances exactly 1/60 s per captured frame, so render interpolation matches the 2 ticks stepped.
await page.addInitScript(() => {
  const real = performance.now.bind(performance);
  let virt = null;
  window.__promoClock = { start: () => (virt = real()), advance: (ms) => (virt += ms) };
  performance.now = () => virt ?? real();
});
const receipt = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fps: 60, simHz: 120, size: [W, H], driving: 'Sim autopilot (staged footage)', shots: [] };
try {
  for (const shot of shots) {
    const dir = join(out, shot.id);
    mkdirSync(dir, { recursive: true });
    execFileSync(process.env.JJ_BIN ?? 'target/debug/jj', ['procgen', '--recipe', shot.recipe, '--seed', String(shot.seed), '--out', dir, '--json'], { stdio: 'ignore' });
    const map = readFileSync(join(dir, 'map.json'), 'utf8');
    const fixture = { scenario: `promo-${shot.id}`, what: 'Promotional gameplay capture', map: 'promo.json', seed: shot.seed, ticks: 3600, cars: Array.from({ length: cars }, (_, i) => ({ routePoint: 6 + i * 2, lateral: i % 2 ? 1.5 : -1.5, lift: 0.5 })), seats: Array.from({ length: cars }, (_, i) => ({ name: `Racer ${i + 1}`, car: i })), inputs: [] };
    await page.unroute('**/promo-map.json');
    await page.route('**/promo-map.json', (r) => r.fulfill({ contentType: 'application/json', body: map }));
    await page.goto(`${server.origin}/p/promo/host?test&tiles=1&look=on&camdist=mid&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/promo-map.json')}`);
    await page.waitForFunction(() => window.__jjTest && window.__jjRender);
    await page.evaluate(async ({ fixture, map }) => {
      window.__jjRender.hold();
      await window.__jjTest.load(fixture, map);
      window.__jjRender.setFollow([0]);
      await window.__jjTest.command({ cmd: 'autopilot', on: true });
      await window.__jjTest.step(480);
      window.__promoClock.start();
      window.__jjRender.frame();
    }, { fixture, map });
    await page.addStyleTag({ content: 'body > :not(canvas):not(#app){visibility:hidden!important} #app > :not(canvas){visibility:hidden!important}' });
    const frames = join(out, `${shot.id}-frames`);
    mkdirSync(frames, { recursive: true });
    for (let f = 0; f < seconds * 60; f++) {
      await page.evaluate(async () => { await window.__jjTest.step(2); window.__promoClock.advance(1000 / 60); window.__jjRender.frame(); });
      await page.screenshot({ path: join(frames, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    }
    const state = await page.evaluate(() => window.__jjTest.observe());
    receipt.shots.push({ ...shot, finalTick: state.tick, cars: state.cars.length, speed: state.cars[0].speed });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '60', '-i', join(frames, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', join(out, `${shot.id}.mp4`)]);
    console.log('captured', shot.id);
  }
} finally {
  writeFileSync(join(out, 'capture.json'), JSON.stringify(receipt, null, 2));
  await browser.close();
  await server.close();
}
