// P1-R05 browser tests: the per-seat race cameras on the real web build (web/dist) in headless Chromium.
// Needs: scripts/build-host-wasm.sh && npm --prefix web run build.
//   node --test web/host/tests/camera.test.mjs
// Writes its captures and numbers to docs/evidence/P1-R05/ (JJ_EVIDENCE_DIR overrides).
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';
import { newReverse, reverseYaw, stepReverse } from '../src/camera/reverse.ts';
import { openHost, serve } from './lib/surface.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const evidenceDir = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-R05');
const runs = {};
let browser;
let server;

before(async () => {
  browser = await chromium.launch();
  server = await serve(join(repo, 'web/dist'));
  await mkdir(evidenceDir, { recursive: true });
});

after(async () => {
  await browser?.close();
  server?.close();
  await writeFile(
    join(evidenceDir, 'browser-run.json'),
    `${JSON.stringify({ browser: `Chromium ${browser?.version()} (Playwright headless, software GL), ${process.platform}/${process.arch}`, ...runs }, null, 2)}\n`,
  );
});

async function open(path, viewport = { width: 1920, height: 1080 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  const mode = await openHost(page, `${server.url}/host/${path}`);
  return { page, errors, mode };
}

const frames = (page, n) => page.waitForFunction((k) => (window.__jjRender?.stats().frames ?? 0) >= k, n, { timeout: 30_000 });

test('captures first-person-4 and mixed-fp-tp-12', async () => {
  const shots = {
    'first-person-4': '?synthetic=8&map&tiles=4&cams=fp,fp,fp,fp',
    'mixed-fp-tp-12': '?synthetic=24&map&tiles=12&cams=fp,tp,tp,fp,tp,fp,tp,tp,fp,tp,fp,tp',
  };
  for (const [name, path] of Object.entries(shots)) {
    const { page, errors } = await open(path);
    await frames(page, 30);
    const cams = await page.evaluate(() => window.__jjRender.cameras());
    const fp = Object.values(cams).filter((c) => c.mode === 'fp').length;
    assert.equal(fp, name === 'first-person-4' ? 4 : 5, `${name}: first-person seats`);
    await page.screenshot({ path: join(evidenceDir, `${name}.jpg`), quality: 82 });
    assert.deepEqual(errors, []);
    runs[name] = cams;
    await page.close();
  }
});

test('a respawn cuts the camera (no swoop frames)', async () => {
  // Seat 2 chases synthetic car index 1, which respawns at tick 203 (and every 10 s after), jumping back to its grid
  // slot. The camera must jump with it in one frame (a cut), never glide across.
  const { page, errors } = await open('?synthetic=8&map&tiles=2', { width: 1280, height: 720 });
  await page.waitForFunction(() => (window.__jjRender?.stats().tick ?? 0) > 260, null, { timeout: 60_000 });
  const cams = await page.evaluate(() => window.__jjRender.cameras());
  assert.ok(cams[2].cuts >= 1, `seat 2 cut on the respawn (cuts ${cams[2].cuts})`);
  // The chase holds its preset's offset from the car every frame (the farthest preset: 11.5 m back, 6.2 m up), so a
  // camera gliding across the map after the jump would be far from its car.
  const farthest = Math.hypot(11.5, 6.2);
  for (const seat of [1, 2]) assert.ok(cams[seat].maxGapM <= farthest + 0.05, `seat ${seat}'s camera stayed by its car (max ${cams[seat].maxGapM} m)`);
  assert.deepEqual(errors, []);
  runs.respawn = cams;
  await page.close();
});

test('toggling the camera keeps the meaning of held steering', async () => {
  // A real seat on the sim: Keys A holds throttle and right (W + D). The steer the sim applies, and the way the car
  // turns, are the same in third person, after a toggle to first person, and back.
  const { page, errors, mode } = await open('?test=live&tiles=1', { width: 1280, height: 720 });
  assert.equal(mode, 'test');
  const observe = () => page.evaluate(() => window.__jjTest.observe());
  await page.keyboard.down('KeyW');
  for (const t0 = Date.now(); (await observe()).host.seats.length < 1; await page.waitForTimeout(50)) {
    assert.ok(Date.now() - t0 < 10_000, 'Keys A claimed a seat');
  }
  await page.keyboard.down('KeyD');
  const car = async () => {
    const s = await observe();
    const c = s.cars.find((x) => x.car === s.host.seats[0].car);
    return { tick: s.tick, heading: c.headingDeg, steer: c.input.steer };
  };
  /** Over 60 ticks (0.5 s): the applied steer at the end and the heading change. */
  const measure = async () => {
    const a = await car();
    let b = a;
    // The applied steer is the strongest seen over the window: a slow (software-rendered CI) host can miss a key sample for
    // a frame, and the one sample at the window's end then reads 0 although the key never let go.
    let steer = a.steer;
    for (const t0 = Date.now(); b.tick - a.tick < 60; b = await car()) {
      assert.ok(Date.now() - t0 < 30_000, 'the sim advanced');
      await page.waitForTimeout(40);
      if (Math.abs(b.steer) > Math.abs(steer)) steer = b.steer;
    }
    if (Math.abs(b.steer) > Math.abs(steer)) steer = b.steer;
    let d = (b.heading - a.heading) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return { steer, turn: d };
  };
  for (const t0 = Date.now(); Math.abs((await car()).steer) < 0.5; await page.waitForTimeout(40)) {
    assert.ok(Date.now() - t0 < 10_000, 'the held steer is applied');
  }
  const tp = await measure();
  await page.evaluate(() => window.__jjRender.setCamera(1, 'fp'));
  const fp = await measure();
  await page.evaluate(() => window.__jjRender.setCamera(1, 'tp'));
  const tp2 = await measure();
  const cams = await page.evaluate(() => window.__jjRender.cameras());
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  assert.equal(fp.steer, tp.steer, 'the same applied steer in first person');
  assert.equal(tp2.steer, tp.steer, 'and back in third person');
  assert.ok(Math.abs(tp.turn) > 1, `the car turns (${tp.turn.toFixed(1)}° in 0.5 s)`);
  assert.equal(Math.sign(fp.turn), Math.sign(tp.turn), 'the same way in first person');
  assert.equal(cams[1].mode, 'tp');
  assert.deepEqual(errors, []);
  runs.toggle = { tp, fp, tpAgain: tp2 };
  await page.close();
});

// The reversing camera's state machine (br-dim.4), stepped as pure data: explicit dt, explicit signed speeds (R90).
const CFG = JSON.parse(await readFile(join(repo, 'assets/profiles/camera.json'), 'utf8')).reverse;
const DT = 1 / 60;
const deg = (r) => (r * 180) / Math.PI;

/** Scripted drive, [seconds, signed m/s]: forward, a brief reverse tap, forward, a real reverse, forward again. */
const SCRIPT = [[2, 18], [0.2, -4], [1.5, 8], [3, -6], [3, 12]];

function drive(script) {
  const s = newReverse();
  const log = [];
  let t = 0;
  for (const [secs, v] of script) {
    for (let i = 0; i < Math.round(secs / DT); i++) {
      stepReverse(s, v, DT, CFG);
      t += DT;
      log.push({ t, v, reversing: s.reversing, tt: s.t, yaw: reverseYaw(s) });
    }
  }
  return log;
}

test('reverse profile is data and sane', () => {
  for (const k of ['enterMps', 'enterHoldS', 'exitMps', 'exitHoldS', 'blendS']) assert.ok(CFG[k] > 0, k);
  assert.ok(CFG.enterHoldS > 0.2, 'a tap shorter than the hold cannot flip it');
});

test('reversing camera: forward, tap, reverse, forward: swings to the rear and back within the blend time, no flip on a tap', () => {
  const log = drive(SCRIPT);
  // 1. The brief tap (2.0 s..2.2 s) never starts a swing: the yaw stays exactly 0 until the real reverse.
  const tapEnd = 2 + 0.2 + 1.5;
  assert.ok(log.filter((e) => e.t <= tapEnd).every((e) => e.yaw === 0 && !e.reversing), 'no flip, no yaw on a brief reverse tap');
  // 2. Real reverse from 3.7 s: swing completes within enterHold + blend, monotonically, never overshooting, no snap.
  const t0 = tapEnd;
  const swing = log.filter((e) => e.t > t0 && e.t <= t0 + 3);
  const full = swing.find((e) => e.yaw >= Math.PI - 1e-9);
  assert.ok(full, 'the swing reaches the rear');
  assert.ok(full.t - t0 <= CFG.enterHoldS + CFG.blendS + 2 * DT, `reached the rear in ${(full.t - t0).toFixed(2)} s (hold ${CFG.enterHoldS} + blend ${CFG.blendS})`);
  let maxStep = 0;
  for (let i = 1; i < log.length; i++) {
    assert.ok(log[i].yaw >= 0 && log[i].yaw <= Math.PI + 1e-12, 'never overshoots');
    maxStep = Math.max(maxStep, Math.abs(deg(log[i].yaw - log[i - 1].yaw)));
  }
  // smoothstep peak rate is 1.5 / blendS of a half turn: per 1/60 s frame
  assert.ok(maxStep <= (180 * 1.5 * DT) / CFG.blendS + 1e-6, `no snap: the biggest frame step is ${maxStep.toFixed(2)} deg`);
  // 3. Forward again: back to 0 within exitHold + blend.
  const fwdAt = tapEnd + 3;
  const back = log.find((e) => e.t > fwdAt && e.yaw === 0);
  assert.ok(back && back.t - fwdAt <= CFG.exitHoldS + CFG.blendS + 2 * DT, `back behind the car in ${(back.t - fwdAt).toFixed(2)} s`);
  assert.equal(log.at(-1).yaw, 0);
});

test('reversing camera: slow creeping backwards below the threshold never swings; replay is bit for bit', () => {
  assert.ok(drive([[5, -(CFG.enterMps - 0.1)]]).every((e) => e.yaw === 0));
  const a = JSON.stringify(drive(SCRIPT));
  const b = JSON.stringify(drive(SCRIPT));
  assert.equal(a, b, 'the second run is identical');
  // frame-rate independence of the outcome: the same script at 30 fps ends in the same mode
  const s = newReverse();
  for (const [secs, v] of SCRIPT) for (let i = 0; i < secs * 30; i++) stepReverse(s, v, 1 / 30, CFG);
  assert.equal(s.reversing, false);
});

test('reversing camera: a flip part-way through a swing turns round from where it is (no snap)', () => {
  const s = newReverse();
  for (let i = 0; i < 30; i++) stepReverse(s, -6, DT, CFG); // 0.5 s: reversing, mid swing
  assert.ok(s.reversing && s.t > 0 && s.t < 1);
  const mid = reverseYaw(s);
  for (let i = 0; i < 60; i++) {
    const before = reverseYaw(s);
    stepReverse(s, 10, DT, CFG);
    assert.ok(Math.abs(reverseYaw(s) - before) < (Math.PI * 1.5 * DT) / CFG.blendS + 1e-9, 'continuous');
  }
  assert.ok(mid > 0);
});

// The chase point stays clear of undulating ground (P1-R05): rig.ts bundled as it ships and driven as pure data. The car
// drives a rolling road (8 m rises every 30 m); every frame the camera sits above the ground under it by the preset's
// clearance and keeps its line of sight to the car over the ground. The control: with no ground function the same drive
// puts the camera inside a rise, so the check has teeth.
async function loadRig() {
  const bundle = await rolldown({ input: join(repo, 'web/host/src/camera/rig.ts'), external: ['three'], logLevel: 'silent' });
  const { output } = await bundle.generate({ format: 'esm' });
  const file = join(repo, 'web/host/tests/.rig-bundle.mjs');
  await writeFile(file, output[0].code);
  await bundle.close();
  return import(`${file}?${Date.now()}`);
}

test('the chase point stays clear of undulating ground (and would not without it)', async () => {
  const { CameraRig } = await loadRig();
  const { Vector3, Quaternion, PerspectiveCamera } = await import('three');
  const prof = JSON.parse(await readFile(join(repo, 'assets/profiles/camera.json'), 'utf8'));
  const rolling = (x, z) => 4 + 4 * Math.sin((z / 30) * Math.PI * 2); // 0..8 m, a rise every 30 m
  const drive = (ground) => {
    const rig = new CameraRig();
    rig.groundAt = ground;
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
    const car = { pos: new Vector3(0, rolling(0, 0) + 0.4, 0), rot: new Quaternion(), life: 1 };
    let worstClear = Infinity;
    let worstLos = Infinity;
    for (let f = 0; f < 900; f++) {
      car.pos.z += 0.25; // 15 m/s at 60 fps
      car.pos.y = rolling(car.pos.x, car.pos.z) + 0.4;
      rig.update(1, cam, car, 1 / 60);
      worstClear = Math.min(worstClear, cam.position.y - rolling(cam.position.x, cam.position.z));
      const eye = car.pos.y + prof.rig.pullInEyeUpM;
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const z = cam.position.z + (car.pos.z - cam.position.z) * t;
        const y = cam.position.y + (eye - cam.position.y) * t;
        worstLos = Math.min(worstLos, y - rolling(cam.position.x, z));
      }
    }
    return { worstClear: +worstClear.toFixed(2), worstLos: +worstLos.toFixed(2) };
  };
  const clear = drive(rolling);
  const control = drive(null);
  runs.groundClearance = { withGround: clear, withoutGround: control, groundClearM: prof.rig.groundClearM };
  assert.ok(clear.worstClear >= prof.rig.groundClearM - 0.01, `the chase point stayed ${prof.rig.groundClearM} m over the ground (worst ${clear.worstClear} m)`);
  assert.ok(clear.worstLos >= 0.2 - 0.01, `the car stayed in sight over the rises (worst ${clear.worstLos} m)`);
  assert.ok(control.worstClear < 0 || control.worstLos < 0, `without the ground the same drive buries the camera or hides the car (${JSON.stringify(control)})`);
});

test('camera distance is a setting: the host default follows the player count, a player may override, and null goes back', async () => {
  const { CameraRig, distanceFor } = await loadRig();
  const prof = JSON.parse(await readFile(join(repo, 'assets/profiles/camera.json'), 'utf8'));
  const rig = new CameraRig();
  for (const n of [1, 4, 12, 24, 99]) {
    rig.players = n;
    assert.equal(rig.distance(1), distanceFor(n), `the default for ${n} players`);
    assert.ok(['near', 'mid', 'far'].includes(rig.distance(1)));
  }
  rig.players = 4;
  const host = rig.distance(1);
  const other = ['near', 'mid', 'far'].find((d) => d !== host);
  rig.setDistance(2, other);
  assert.equal(rig.distance(2), other, "a player's own choice");
  assert.equal(rig.distance(1), host, "another player's tile keeps the host default");
  rig.hostDistance = other === 'far' ? 'near' : 'far';
  assert.equal(rig.distance(1), rig.hostDistance, 'the host can pin one distance for everybody');
  assert.equal(rig.distance(2), other, 'a pinned host default does not touch an override');
  rig.setDistance(2, null);
  assert.equal(rig.distance(2), rig.hostDistance, 'null goes back to the host default');
  assert.ok(prof.chase.near.backM < prof.chase.mid.backM && prof.chase.mid.backM < prof.chase.far.backM, 'near < mid < far');
  runs.distanceSetting = { byCount: prof.distance.byCount, default: prof.distance.default };
});
