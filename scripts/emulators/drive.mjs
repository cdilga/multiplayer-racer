#!/usr/bin/env node
// P1-F08 drive scenarios: the real controller page on an emulator joins a real host (Chromium on eris) over
// WebRTC and the lane reads what happened from the page (probe) and from the host (`__jjTest.observe`).
//   C02  two fingers drive both sticks independently, no zoom or scroll
//   C03  background -> foreground returns the same seat within 3 s
//   G03  a backgrounded phone goes to the autopilot and takes its car back
//
//   node scripts/emulators/drive.mjs android [--repeat 2] [--out docs/evidence/P1-F08] [--port 7461]   (on eris)
//   node scripts/emulators/drive.mjs ios     [--repeat 2] ...                                       (on the Mac)
// Android runs wholly on eris (stack, emulator and driver). iOS runs on the Mac against the stack on eris through
// an ssh tunnel (the page is `http://localhost:<port>`, a secure context, on both).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, until } from './lib/stack.mjs';
import { androidPlatform } from './lib/platform-android.mjs';
import { iosPlatform } from './lib/platform-ios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const log = (...a) => console.error('[drive]', ...a);

// ---------------------------------------------------------------- the stack (on eris) and its HTTP API
async function startStackProcess(port) {
  // The stack runs from the clone's own tree: on eris directly (Android), or over ssh in eris's clone (iOS from the Mac).
  const args = `scripts/emulators/stack-run.mjs --port ${port} --gpu ${opt('gpu', 'vulkan')}`;
  const onEris = os.hostname().toLowerCase().includes('eris');
  const p = onEris ? spawn('node', args.split(' '), { cwd: path.resolve(here, '../..'), stdio: ['pipe', 'pipe', 'inherit'] })
    : spawn('ssh', ['-o', 'BatchMode=yes', 'eris', `cd ~/Work/dev/multiplayer-racer && exec node ${args}`], { stdio: ['pipe', 'pipe', 'inherit'] });
  const ready = await new Promise((res, rej) => {
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; const m = /READY (\{.*\})/.exec(buf); if (m) res(JSON.parse(m[1])); });
    p.on('exit', (c) => rej(new Error('stack exited ' + c)));
    setTimeout(() => rej(new Error('stack start timeout')), 120000);
  });
  return { ...ready, proc: p, stop: () => { try { p.stdin.end(); } catch {} setTimeout(() => p.kill(), 3000); } };
}
const apiFor = (base) => {
  const j = (p, init) => fetch(base + p, { ...init, signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  return {
    events: () => j('/__lane/events'),
    observe: () => j('/__lane/host/observe'),
    command: (c) => j('/__lane/host/command', { method: 'POST', body: JSON.stringify(c) }),
    info: () => j('/__lane/info'),
    reset: () => fetch(base + '/__lane/reset', { signal: AbortSignal.timeout(5000) }),
  };
};

// ---------------------------------------------------------------- the scenario
const ofKind = (evs, k) => evs.filter((e) => e.kind === k);
const lastData = (evs, k) => ofKind(evs, k).at(-1)?.data;
async function waitEv(api, what, pred, ms = 30000) {
  return until(what, async () => { const evs = await api.events(); return pred(evs) || false; }, ms, 250);
}
const seatOf = (obs, endpoint) => obs.host.seats.find((s) => s.endpoint === endpoint);
const carOf = (obs, seat) => seat && obs.cars.find((c) => c.car === seat.car);

async function scenario(plat, api, code, port) {
  const R = { steps: {} };
  const url = `http://localhost:${port}/j/${code}`;
  await plat.open(url);
  await waitEv(api, 'controller page load', (e) => ofKind(e, 'load').some((x) => x.data.path === new URL(url).pathname), 90000);
  R.page = { secureContext: lastData(await api.events(), 'load')?.isSecureContext, origin: lastData(await api.events(), 'load')?.origin, ua: lastData(await api.events(), 'load')?.userAgent };
  await waitEv(api, 'ready-to-join (WebRTC connected to the host)', (e) => ofKind(e, 'ctl').some((x) => x.data.phase === 'ready-to-join'), 60000);
  await plat.settle();
  // Join.
  let rects = lastData(await api.events(), 'rects');
  await plat.tap(rects.join, rects);
  const playing = await waitEv(api, 'playing', (e) => ofKind(e, 'ctl').find((x) => x.data.phase === 'playing'), 40000);
  await sleep(1500);
  await plat.settle(); // a system prompt (Chrome's "Viewing full screen") may sit over the page
  // The first-run tutorial covers the sticks: skip it with a real tap, like a player.
  for (let i = 0; i < 6; i++) { const r = lastData(await api.events(), 'rects'); if (!r.skip) break; await plat.tap(r.skip, r); await sleep(1200); }
  // Held upright the controller asks to be turned sideways once; play upright anyway, as a player may.
  { const r = lastData(await api.events(), 'rects'); if (r.upright) { await plat.tap(r.upright, r); await sleep(1000); } }
  await sleep(800);
  const me = lastData(await api.events(), 'ctl');
  R.seat = { number: me.you.number, endpoint: me.link.endpointId };
  let obs = await api.observe();
  const seat = seatOf(obs, R.seat.endpoint);
  R.hostSeatFound = !!seat;
  R.hostObserveSample = { seat, car: carOf(obs, seat) };
  await plat.shot('playing');

  // ---- C02
  rects = lastData(await api.events(), 'rects');
  const d = rects.drive, a = rects.action;
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const A = centre(d), B = centre(a);
  const t0 = Date.now();
  const hold = plat.holdTwo([
    { from: A, to: { x: A.x - d.w * 0.2, y: A.y - d.h * 0.3 } }, // drive stick: up and left (throttle, steer left)
    { from: B, to: { x: B.x + a.w * 0.3, y: B.y } }, // action stick: right (boost)
  ], 4500);
  const speeds = [];
  while (Date.now() - t0 < 4800) { const o = await api.observe(); speeds.push(carOf(o, seatOf(o, R.seat.endpoint))?.forwardSpeed ?? 0); await sleep(300); }
  await hold;
  await sleep(500);
  const ev = await api.events();
  const ts = lastData(ev, 'touch-summary'), ctl = lastData(ev, 'ctl');
  R.c02 = {
    maxStick: ctl.maxStick, zoneDown: ts.zoneDown, bothZonesAtOnce: ts.bothZonesAtOnce,
    maxSimultaneousPointers: ts.maxSimultaneousPointers, maxSimultaneousTouches: ts.maxSimultaneousTouches,
    visualViewportScale: { min: ctl.vvMin, max: ctl.vvMax }, scrollMax: ctl.scrollMax,
    actionsSent: ctl.stats?.actions ?? null, hostMaxForwardSpeed: Math.max(...speeds),
  };
  R.c02.pass = R.c02.maxStick.throttle > 0.3 && R.c02.maxStick.steer > 0.3 && R.c02.bothZonesAtOnce && R.c02.maxSimultaneousPointers >= 2 &&
    R.c02.visualViewportScale.min === 1 && R.c02.visualViewportScale.max === 1 && R.c02.scrollMax === 0 && R.c02.hostMaxForwardSpeed > 2;
  await plat.shot('c02');

  // ---- C03: a short background cycle (under the 2 s dropout), then the same seat must be back within 3 s.
  const seatsBefore = (await api.observe()).host.seats.length;
  const c03 = await cycle(plat, api, 1500);
  const obsAfter = await api.observe();
  R.c03 = { ...c03, sameSeat: c03.number === R.seat.number && c03.endpoint === R.seat.endpoint, seatsBefore, seatsAfter: obsAfter.host.seats.length };
  R.c03.pass = R.c03.sameSeat && R.c03.backMs !== null && R.c03.backMs <= 3000 && seatsBefore === R.c03.seatsAfter;

  // ---- G03: background long enough for the autopilot, watch the host, come back and steer to take the car back.
  const watch = []; let watching = true;
  const watcher = (async () => { while (watching) { try { const o = await api.observe(); const s = seatOf(o, R.seat.endpoint); watch.push({ t: Date.now(), seat: s, car: carOf(o, s) }); } catch {} await sleep(400); } })();
  const g = await cycle(plat, api, 7000);
  await plat.settle(); // Chrome shows "Viewing full screen" again when it comes back
  await plat.shot('g03-returned');
  const zdBefore = lastData(await api.events(), 'touch-summary').zoneDown.drive;
  rects = lastData(await api.events(), 'rects');
  const A2 = centre(rects.drive);
  await plat.holdTwo([{ from: A2, to: { x: A2.x, y: A2.y - rects.drive.h * 0.3 } }], 3000);
  await sleep(2500);
  await plat.shot('g03-end');
  watching = false; await watcher;
  const evG = await api.events();
  R.g03 = { cycle: g, driveZoneTouchesAfterReturn: lastData(evG, 'touch-summary').zoneDown.drive - zdBefore, lastCtlDrive: lastData(evG, 'ctl').drive, hostSamples: watch.length, firstSample: watch[0], midSample: watch[Math.floor(watch.length / 2)], lastSample: watch.at(-1) };
  Object.assign(R.g03, summariseAutopilot(watch, R.seat.endpoint));
  return R;
}
// Filled in once the host's observe shape is known: which field says "the autopilot has this car".
function summariseAutopilot(watch) {
  const has = (w) => !!w.car?.autopilot; // an object (mode, target...) while the autopilot drives, null otherwise
  const flags = watch.map(has);
  const first = flags.indexOf(true);
  const lastTrue = flags.lastIndexOf(true);
  return { autopilotSeen: first >= 0, autopilotReleased: first >= 0 && lastTrue < flags.length - 1 && flags.at(-1) === false };
}
async function cycle(plat, api, hiddenMs) {
  const before = (await api.events()).length;
  await plat.background();
  await waitEv(api, 'hidden', (e) => e.slice(before).some((x) => x.kind === 'hidden'), 20000);
  await sleep(hiddenMs);
  await plat.foreground();
  const vis = await waitEv(api, 'visible again', (e) => e.slice(before).find((x) => x.kind === 'visible-after-hidden'), 40000);
  await sleep(5200);
  const evs = (await api.events()).slice(before);
  const back = evs.filter((e) => e.kind === 'resume-ctl').find((e) => e.data.phase === 'playing' && e.data.linkState === 'connected' && e.data.ch === 'open');
  const last = evs.filter((e) => e.kind === 'resume-ctl').at(-1)?.data || {};
  return { hiddenMs, backMs: back ? back.data.sinceVisibleMs : null, number: (back || { data: last }).data.number, endpoint: (back || { data: last }).data.endpoint, lastPhase: last.phase, lastLink: last.linkState };
}

// ---------------------------------------------------------------- main
async function main() {
  if (mode !== 'ios' && mode !== 'android') { console.error('usage: drive.mjs ios|android [--repeat N]'); process.exit(2); }
  const repeat = +opt('repeat', '1');
  const outDir = path.resolve(process.env.JJ_EVIDENCE_DIR || opt('out', path.join(here, '../../docs/evidence/P1-F08')));
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (let n = 1; n <= repeat; n++) {
    const port = +opt('port', '7461') + n;
    const st = await startStackProcess(port);
    const onEris = os.hostname().toLowerCase().includes('eris');
    let tun = null;
    if (!onEris && mode === 'ios') { tun = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${st.port}:127.0.0.1:${st.port}`, 'eris'], { stdio: 'ignore' }); await sleep(2000); }
    const api = apiFor(`http://127.0.0.1:${st.port}`);
    const plat = mode === 'ios' ? await iosPlatform({ api, port: st.port, log, opt }) : await androidPlatform({ api, port: st.port, log, opt });
    const started = new Date().toISOString();
    let r;
    try { r = await scenario(plat, api, st.code, st.port); r.error = null; }
    catch (e) { r = { error: String(e.stack || e) }; log('FAILED', e.message); await plat.shot?.('failure').catch(() => {}); }
    finally { await plat.close(); tun?.kill(); st.stop(); }
    r = { label: plat.label, machine: plat.machine, target: plat.target, run: n, startedAt: started, finishedAt: new Date().toISOString(), hostCode: st.code, ...r };
    writeFileSync(path.join(outDir, `drive-${mode}-run${n}.json`), JSON.stringify(r, null, 2) + '\n');
    const p = (b) => (b ? 'PASS' : 'FAIL');
    console.log(`[${r.label}] run ${n}/${repeat} ${Object.entries(r.target || {}).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    if (r.error) console.log(`[${r.label}] run ${n}: ERROR ${r.error.split('\n')[0]}`);
    else {
      console.log(`[${r.label}] run ${n}: C02 two-finger sticks: ${p(r.c02.pass)} ${JSON.stringify(r.c02)}`);
      console.log(`[${r.label}] run ${n}: C03 same seat <=3 s: ${p(r.c03.pass)} back=${r.c03.backMs}ms seat=#${r.c03.number}`);
      console.log(`[${r.label}] run ${n}: G03 autopilot seen=${r.g03.autopilotSeen} released=${r.g03.autopilotReleased}`);
    }
    results.push(r);
    await sleep(3000);
  }
  process.exit(results.every((r) => !r.error && r.c02.pass && r.c03.pass) ? 0 : 1);
}
main().catch((e) => { console.error(e.stack || e); process.exit(1); });
