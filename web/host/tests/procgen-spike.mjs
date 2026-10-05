// P1-M02 spike captures (not part of node --test): the spike's generated maps on the real host stack.
//   (cd spikes/procgen && cargo build --release && ./target/release/procgen-spike bench 8 out
//      && cargo build --release --lib --target wasm32-unknown-unknown && node wasm-check.mjs out)
//   npm --prefix web run build && node web/host/tests/procgen-spike.mjs
// Writes docs/evidence/P1-M02/: an overview of every biome × candidate, a recorded drive per biome (keys on the real
// sim worker), and WASM generation times in Chromium under CPU throttling (a phone stand-in, labelled as such).
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const spike = join(repo, 'spikes/procgen');
const ev = join(repo, 'docs/evidence/P1-M02');
const dist = join(repo, 'web/dist');
fs.mkdirSync(join(ev, 'captures'), { recursive: true });
fs.mkdirSync(join(ev, 'drives'), { recursive: true });
// The maps and the WASM ride along with the build under spike-maps/ (web/dist is build output, never committed).
fs.cpSync(join(spike, 'out/maps'), join(dist, 'spike-maps'), { recursive: true });
fs.copyFileSync(join(spike, 'target/wasm32-unknown-unknown/release/jj_procgen_spike.wasm'), join(dist, 'spike-maps/spike.wasm'));
const server = await serve(dist);
const browser = await chromium.launch();
const BIOMES = ['town', 'rocks', 'outback-dirt', 'outback-bitumen'];
const out = { browser: `Chromium ${browser.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}` };

async function frames(page, n) {
  await page.waitForFunction((k) => (window.__jjRender?.stats().frames ?? 0) >= k, n, { timeout: 60_000 });
}

// Overviews: every biome with every undulation × scatter (seed 1).
for (const b of BIOMES) {
  for (const u of ['flat', 'noise', 'route']) {
    for (const s of ['poisson', 'blue', 'cluster']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await openHost(page, `${server.url}/host/?mapUrl=${encodeURIComponent(`/spike-maps/${b}-${u}-${s}-s1.json`)}`);
      await page.addStyleTag({ content: '[data-jj-input-drawer]{display:none}' }); // the map, not the empty drawer
      await frames(page, 15);
      await page.screenshot({ path: join(ev, 'captures', `${b}-${u}-${s}.jpg`), quality: 70 });
      await page.close();
    }
  }
}

// Drives: one per biome on the recommended candidates, keys on the real sim, chase camera, recorded.
const RECOMMENDED = { town: 'route-cluster', rocks: 'route-cluster', 'outback-dirt': 'route-poisson', 'outback-bitumen': 'route-blue' };
out.drives = {};
for (const b of BIOMES) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, recordVideo: { dir: join(ev, 'drives'), size: { width: 960, height: 540 } } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openHost(page, `${server.url}/host/?test=live&tiles=1&mapUrl=${encodeURIComponent(`/spike-maps/${b}-${RECOMMENDED[b]}-s1.json`)}`);
  const observe = () => page.evaluate(() => window.__jjTest.observe());
  await page.keyboard.down('KeyW');
  for (const t0 = Date.now(); (await observe()).host.seats.length < 1 && Date.now() - t0 < 10_000; ) await page.waitForTimeout(100);
  const start = await observe();
  // Weave: steer left and right in turn while holding throttle, ~12 s of driving; sum the path between samples.
  const car = (s) => s.cars.find((c) => c.car === s.host.seats[0]?.car);
  let path = 0;
  let prev = car(start);
  const sample = async () => {
    const c = car(await observe());
    if (c && prev) path += Math.hypot(c.position[0] - prev.position[0], c.position[2] - prev.position[2]);
    prev = c;
  };
  for (let k = 0; k < 6; k++) {
    await page.keyboard.down(k % 2 ? 'KeyA' : 'KeyD');
    await page.waitForTimeout(700);
    await sample();
    await page.keyboard.up(k % 2 ? 'KeyA' : 'KeyD');
    await page.waitForTimeout(1300);
    await sample();
  }
  const end = await observe();
  await page.keyboard.up('KeyW');
  const z = car(end);
  out.drives[b] = {
    map: `${b}-${RECOMMENDED[b]}-s1.json`,
    ticks: end.tick - start.tick,
    pathM: +path.toFixed(1),
    recoveries: z?.race?.recoveries,
    upY: z?.upY,
    errors,
  };
  await page.close();
  const video = await page.video().path();
  await ctx.close();
  fs.renameSync(video, join(ev, 'drives', `${b}.webm`));
}

// WASM generation time in Chromium, unthrottled and at 4× and 6× CPU throttling (a mid and a low phone stand-in).
out.wasm = {};
for (const rate of [1, 4, 6]) {
  const page = await browser.newPage();
  await page.goto(`${server.url}/host/?bench`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const ms = await page.evaluate(async () => {
    const { instance } = await WebAssembly.instantiateStreaming(fetch('/spike-maps/spike.wasm'), {});
    const t = [];
    for (let b = 0; b < 4; b++) {
      for (let seed = 1; seed <= 4; seed++) {
        const t0 = performance.now();
        instance.exports.spike_generate(seed, 0, b, 2, 0);
        t.push(performance.now() - t0);
      }
    }
    return t;
  });
  out.wasm[`throttle${rate}x`] = { worstMs: Math.max(...ms), meanMs: ms.reduce((x, y) => x + y, 0) / ms.length };
  await page.close();
}

fs.writeFileSync(join(ev, 'host-run.json'), `${JSON.stringify(out, null, 1)}\n`);
await browser.close();
server.close();
console.log(JSON.stringify(out.drives), JSON.stringify(out.wasm));
