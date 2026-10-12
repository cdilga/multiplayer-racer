// br-gw74.14 (P1-R-judder): the camera judder probe on a real host. The live sim runs the straight-throttle fixture
// (full throttle down the greybox's main straight), one tile chases its car (third person, then first person), and `__jjRender.cameraTrace` records seat 1's camera every
// frame. Prints, per camera mode: how evenly the rendered tick advances with frame time, and the camera's frame-to-frame
// velocity change ("jerk", m/s per frame) beside the car's own, so judder the camera adds shows as camera > car.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build.
//   node web/host/tests/camera-judder.mjs [--headed | --gpu] [--channel chrome] [--seconds 2.5] [--out file.json] [--capture dir]
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openHost, serve } from './lib/surface.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const headed = argv.includes('--headed');
const seconds = Number(arg('--seconds', 2.5));
const capture = arg('--capture', null);
const repo = resolve(import.meta.dirname, '../../..');
const TICK_HZ = 120;
const fixture = JSON.parse(await readFile(join(repo, 'scenarios/straight-throttle.json'), 'utf8'));

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const r3 = (x) => +x.toFixed(3);

/** Per-frame numbers from a trace (frames of { now ms, tick, cam [x,y,z], car [x,y,z], fov }). */
export function summarise(frames) {
  const dts = [];
  const tickErr = [];
  const jerk = { cam: [], car: [] };
  const fovStep = [];
  let backwards = 0;
  const vel = { cam: null, car: null };
  for (let i = 1; i < frames.length; i++) {
    const [a, b] = [frames[i - 1], frames[i]];
    // Motion as the screen shows it: frames reach the display at their vsync (rAF) times, not when the code ran.
    const dt = (b.vsync - a.vsync) / 1000;
    if (dt <= 0) continue;
    dts.push(dt * 1000);
    const ideal = dt * TICK_HZ;
    const dTick = b.tick - a.tick;
    if (dTick < 0) backwards++;
    tickErr.push(Math.abs(dTick - ideal) / ideal);
    fovStep.push(Math.abs(b.fov - a.fov));
    for (const k of ['cam', 'car']) {
      const v = b[k].map((x, j) => (x - a[k][j]) / dt);
      if (vel[k]) jerk[k].push(Math.hypot(...v.map((x, j) => x - vel[k][j])));
      vel[k] = v;
    }
  }
  const stat = (xs) => ({ p50: r3(pct(xs, 0.5)), p95: r3(pct(xs, 0.95)), p99: r3(pct(xs, 0.99)), max: r3(Math.max(0, ...xs)) });
  return {
    frames: frames.length,
    frameMs: { p50: r3(pct(dts, 0.5)), p99: r3(pct(dts, 0.99)) },
    tickWithin5pct: r3(tickErr.filter((e) => e <= 0.05).length / Math.max(1, tickErr.length)),
    tickBackwards: backwards,
    jerkMpsPerFrame: { cam: stat(jerk.cam), car: stat(jerk.car) },
    fovStepDeg: stat(fovStep),
    carSpeedMps: r3(frames.at(-1)?.speed ?? 0),
  };
}

const browser = await chromium.launch({
  headless: !headed,
  channel: headed || argv.includes('--channel') ? arg('--channel', 'chrome') : undefined,
  // `--gpu` asks a headless browser for the GPU (60 Hz frames on a Mac, where headed follows the display's rate).
  args: ['--ignore-gpu-blocklist', ...(argv.includes('--gpu') ? ['--enable-gpu', '--use-angle=metal'] : [])],
});
const server = await serve(join(repo, 'web/dist'));
const out = { browser: `${headed ? 'headed' : 'headless'} ${browser.version()}`, platform: `${process.platform}/${process.arch}`, modes: {} };
try {
  for (const mode of ['tp', 'fp']) {
    const page = await browser.newPage({ viewport: capture ? { width: 1920, height: 1080 } : { width: 1280, height: 720 } });
    await openHost(page, `${server.url}/host/?test=live&tiles=1&cams=${mode}`);
    // The straight-throttle fixture: full throttle from rest down the greybox's 170 m main straight, run live.
    await page.evaluate(async (f) => {
      await window.__jjTest.load(f);
      await window.__jjTest.hold(false);
    }, fixture);
    await page.waitForTimeout(1000); // gathering speed
    await page.evaluate(() => window.__jjRender.cameraTrace(true));
    if (capture) {
      // Self-review stills (TV size) a few frames apart, taken while the trace runs.
      for (let k = 0; k < 3; k++) await page.screenshot({ path: join(capture, `${mode}-${k}.jpg`), quality: 80 });
    } else await page.waitForTimeout(seconds * 1000);
    const frames = await page.evaluate(() => window.__jjRender.cameraTrace(false));
    out.modes[mode] = summarise(frames);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify(out, null, 2));
if (argv.includes('--out')) await writeFile(arg('--out'), `${JSON.stringify(out, null, 2)}\n`);
