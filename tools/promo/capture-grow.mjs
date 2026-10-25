// Owner 26 Oct: the host grid growing from one screen to 64, easing into a few narrated stops. A real room fills with
// 64 synthetic controllers through the real Hello/Claim/Pick/Ready path (64 is a filmed sample, never a limit), every
// selectable vehicle in the field, a real generated-track race under the autopilot, and the host's own grid
// layout/reflow animation. Frames are stepped: 2 sim ticks (120 Hz) and 1/60 s of page clock per frame.
//   JJ_PROMO_CAPTURE=/tmp/jj-promo-grow JJ_PROMO_STOPS='[...]' node tools/promo/capture-grow.mjs
// JJ_PROMO_STOPS: [{n, hold, via, step}]: `hold` seconds at each stop, reached through the `via` counts, `step` s each.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build, serve } from '../../web/landing/tests/lib/site.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const out = process.env.JJ_PROMO_CAPTURE ?? '/tmp/jj-promo-grow';
mkdirSync(out, { recursive: true });
const N = 64;
const FPS = 60;
const [W, H] = (process.env.JJ_PROMO_SIZE ?? '1920x1080').split('x').map(Number);
const seed = Number(process.env.JJ_PROMO_SEED ?? 7);
const stops = JSON.parse(process.env.JJ_PROMO_STOPS ?? '[{"n":1,"hold":3},{"n":4,"hold":2.6},{"n":16,"hold":2.4},{"n":64,"hold":4.5}]');
const roster = JSON.parse(readFileSync('web/shared/src/roster.json', 'utf8')).cars.map((c) => c.id);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const evidence = {
  head: git('rev-parse', 'HEAD'),
  dirty: git('status', '--short').split('\n').filter(Boolean),
  testingWasm: sha(readFileSync('web/host/src/testing/pkg/jj_wasm_host_testing_bg.wasm')),
  cohort: N,
  controllers: 'Synthetic controller endpoints through the real host controller path; not 64 human players',
  driving: 'Sim autopilot drives every car (staged footage)',
  fps: FPS, simHz: 120, size: [W, H], seed, stops, shots: [],
};

const dist = process.env.JJ_PROMO_BUILD ?? build('./', 'promo-grow');
// The footer and QR name the public site, not this capture server.
const server = await serve(dist, '/p/promo/', { JJ_STUN_URLS: '', JJ_PUBLIC_ORIGIN: 'https://jammers.dilger.dev' });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.error(e.message));
// The page clock: real until the shots start, then exactly 1/60 s per captured frame (the grid's 300 ms reflow
// tween and the render interpolation see the same time the sim steps).
await page.addInitScript(() => {
  const real = performance.now.bind(performance);
  let virt = null;
  window.__promoClock = { start: () => (virt = real()), advance: (ms) => (virt += ms) };
  performance.now = () => virt ?? real();
});
const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 300000 });
const send = (frames) => page.evaluate(async (frames) => {
  for (const [endpoint, frame] of frames) window.__jjTest.input({ type: 'controller', endpoint, frame });
  await window.__jjTest.step(1);
}, frames);
let seq = 0;
// Held neutral sticks keep every endpoint live; the autopilot drives.
const neutral = () => send(Array.from({ length: N }, (_, i) => [`mate-${i}`, { state: { source: 0, seq: seq++ % 65536, drive: [0, 0], action: [0, 0] } }]));
const chrome = () => page.addStyleTag({ content: '[data-jj-input-drawer],#jj-caption,.jj-chip,[data-jj-join-chip]{visibility:hidden!important}' });

async function record(id, frames, each) {
  const dir = join(out, `${id}-frames`);
  mkdirSync(dir, { recursive: true });
  for (let f = 0; f < frames; f++) {
    if (each) await each(f);
    if (f % 30 === 0) await neutral();
    await page.evaluate(async () => { await window.__jjTest.step(2); window.__promoClock.advance(1000 / 60); window.__jjRender.frame(); });
    await page.screenshot({ path: join(dir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', join(out, `${id}.mp4`)]);
  const state = await page.evaluate(() => window.__jjTest.observe());
  const shot = { id, frames, seconds: frames / FPS, tick: state.tick, cars: state.cars.length, tiles: await page.evaluate(() => window.__jjRender.tileRects()?.length ?? 0) };
  evidence.shots.push(shot);
  writeFileSync(join(out, 'capture.json'), JSON.stringify(evidence, null, 2));
  console.log('captured', JSON.stringify(shot));
}

try {
  await page.goto(`${server.origin}/p/promo/host?room&test=live&mode=race&laps=3&seed=${seed}&look=on&res=1&autores=off`);
  await wait(() => window.__jjNet?.code() && window.__jjRoom?.view()?.phase === 'Lobby');
  await page.evaluate(() => window.__jjTest.hold(true));
  for (let i = 0; i < N; i++) {
    const e = `mate-${i}`;
    await send([[e, { hello: true }], [e, { claim: i === 0 ? 'Davo' : `Mate ${i + 1}` }], [e, { pick: { vehicle: roster[i % roster.length], open: false } }]]);
  }
  await wait((n) => window.__jjRoom.view().seats.length === n, N);
  const lobby = await page.evaluate(() => window.__jjRoom.view());
  evidence.lobby = { seats: lobby.seats.length, vehicles: Object.fromEntries(roster.map((v) => [v, lobby.seats.filter((s) => s.vehicle === v).length])) };
  assert.ok(roster.every((v) => evidence.lobby.vehicles[v] > 0), `every roster vehicle picked: ${JSON.stringify(evidence.lobby.vehicles)}`);
  await send(Array.from({ length: N }, (_, i) => [`mate-${i}`, { ready: true }]));
  await page.evaluate(() => window.__jjTest.hold(false));
  await wait(() => window.__jjRoom.view().phase === 'Running');
  await page.evaluate(async () => {
    await window.__jjTest.hold(true);
    window.__jjRender.hold();
    await window.__jjTest.command({ cmd: 'autopilot', on: true });
  });
  await chrome();
  const room = await page.evaluate(() => window.__jjRoom.view());
  // Tiles in seat-number order, as the room's own grid orders them.
  const follow = room.seats.filter((s) => s.car !== null).sort((a, b) => a.number - b.number).map((s) => s.car);
  assert.equal(follow.length, N);
  evidence.loops = await page.evaluate(() => window.__jjRender.loopShapes().length);
  evidence.map = await page.evaluate(() => window.__jjRender.map());
  // Through the countdown and well away from the line, so the field is moving and strung out when the first frame is drawn.
  for (let k = 0; k < Number(process.env.JJ_PROMO_PREROLL ?? 40); k++) { await neutral(); await page.evaluate(() => window.__jjTest.step(60)); }
  await page.evaluate(() => window.__promoClock.start());
  await page.evaluate((f) => { window.__jjRender.setFollow(f); window.__jjRender.frame(); }, follow.slice(0, 1));
  if (process.env.JJ_PROMO_PROBE) {
    for (const n of [1, 4, 16, 64]) {
      await page.evaluate((f) => window.__jjRender.setFollow(f), follow.slice(0, n));
      for (let k = 0; k < 24; k++) await page.evaluate(async () => { await window.__jjTest.step(2); window.__promoClock.advance(1000 / 60); window.__jjRender.frame(); });
      await page.screenshot({ path: join(out, `probe-${n}.jpg`), quality: 90 });
    }
    writeFileSync(join(out, 'capture.json'), JSON.stringify(evidence, null, 2));
  } else {
    // The tile count over time: held at each stop; between stops it steps through the stop's `via` counts, each held
    // `step` seconds so the host's own 300 ms join reflow lands before the next join (a join every frame restarts the
    // tween mid-flight and the tiles pile up).
    const plan = [];
    stops.forEach((s, k) => {
      for (const n of s.via ?? []) for (let f = 0; f < Math.round((s.step ?? 0.36) * FPS); f++) plan.push(n);
      if (k > 0) for (let f = 0; f < Math.round((s.step ?? 0.36) * FPS); f++) plan.push(s.n);
      for (let f = 0; f < Math.round(s.hold * FPS); f++) plan.push(s.n);
    });
    evidence.plan = { frames: plan.length, stopsAtFrame: stops.map((s) => plan.indexOf(s.n)) };
    let shown = 1;
    await record('grow', plan.length, async (f) => {
      if (plan[f] !== shown) { shown = plan[f]; await page.evaluate((fl) => window.__jjRender.setFollow(fl), follow.slice(0, shown)); }
    });
    // Further round the lap: seats 1-4 in their own 2x2 grid, the rest of the field around them. (The host's
    // Overview is for derby arenas only; on a track every player keeps their own tile.)
    for (let k = 0; k < 15; k++) { await neutral(); await page.evaluate(() => window.__jjTest.step(120)); }
    await page.evaluate((f) => { window.__jjRender.setFollow(f); window.__promoClock.advance(1000); window.__jjRender.frame(); }, follow.slice(0, 4));
    await record('pack', Number(process.env.JJ_PROMO_PACK ?? 6) * FPS);
  }
} finally {
  writeFileSync(join(out, 'capture.json'), JSON.stringify(evidence, null, 2));
  await browser.close();
  await server.close();
}
