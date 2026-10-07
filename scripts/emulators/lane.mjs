#!/usr/bin/env node
// P1-F08 emulator lane: Mobile Safari on the iOS Simulator (the Mac) and Chrome on the Android emulator
// (eris, driven from the Mac). Results are labelled "iOS Simulator" / "Android emulator" with machine,
// OS and browser versions. Never "device".
//
//   node scripts/emulators/lane.mjs ios     [--repeat 2] [--out docs/evidence/P1-F08] [--tag name]
//   node scripts/emulators/lane.mjs android [--repeat 2] [--out docs/evidence/P1-F08] [--tag name]
//   node scripts/emulators/lane.mjs compare <a.json> <b.json>
//
// Other flags: --dist <web build dir> (default web/dist-test/f08, built if missing), --code ABCD,
//              --keep (leave the simulator/emulator running), --eris <ssh host> (default eris).
//
// How it works: jj-server serves the real web build; a small proxy (lib/lane-server.mjs) in front of it
// injects a test probe (lib/probe.js) into HTML pages. The probe reports what the page itself received
// (isSecureContext, typed code, touch identifiers, visibilitychange) and the lane asserts on that.
// Gestures are real: XCUITest in Mobile Safari (ios/), and CDP Input.dispatchTouchEvent plus adb input
// in Chrome (Android).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLaneServer } from './lib/lane-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[lane]', ...a);

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes('--' + name);

function sh(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...o });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function runAsync(cmd, args, o = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...o });
    let stdout = '', stderr = '';
    p.stdout.on('data', (c) => (stdout += c)); p.stderr.on('data', (c) => (stderr += c));
    const timer = o.timeout ? setTimeout(() => p.kill(), o.timeout) : null;
    p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}
async function until(what, fn, timeoutMs, stepMs = 500) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(stepMs);
  }
}
const freePort = () => new Promise((res) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

// ---------------------------------------------------------------- shared: web build, server, proxy
async function startStack(code) {
  const dist = path.resolve(repo, opt('dist', 'web/dist-test/f08'));
  if (!existsSync(path.join(dist, 'landing/index.html'))) {
    log('building web into', dist);
    const r = sh('npx', ['vite', 'build', '--outDir', dist, '--logLevel', 'error'], { cwd: path.join(repo, 'web') });
    if (r.code !== 0) throw new Error('web build failed: ' + r.err);
  }
  const bin = path.join(repo, 'target/debug/jj-server');
  if (!existsSync(bin)) {
    log('building jj-server');
    const r = sh('cargo', ['build', '-p', 'jj-server'], { cwd: repo });
    if (r.code !== 0) throw new Error('cargo build failed: ' + r.err);
  }
  const upstream = await freePort();
  const srv = spawn(bin, [], {
    env: { ...process.env, JJ_BIND: `127.0.0.1:${upstream}`, JJ_DIST: dist, JJ_BASE_PATH: '/' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await until('jj-server listening', () => new Promise((res) => {
    const c = net.connect(upstream, '127.0.0.1'); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false));
  }), 20000);
  const lane = await startLaneServer({ upstreamPort: upstream });
  return {
    port: lane.port, events: lane.events, code,
    reset: () => { lane.events.length = 0; },
    has: (k) => lane.events.some((e) => e.kind === k),
    stop: async () => { await lane.close(); srv.kill(); },
  };
}

// ---------------------------------------------------------------- shared: summarise the page's own reports
function summarise(events, code) {
  const loads = events.filter((e) => e.kind === 'load');
  const load = loads[0]?.data || {};
  const typed = events.filter((e) => e.kind === 'typed').at(-1)?.data?.value ?? null;
  const t2 = events.find((e) => e.kind === 'touch2')?.data || null;
  const sums = events.filter((e) => e.kind === 'touch-summary').map((e) => e.data);
  const max = (k) => Math.max(0, ...sums.map((s) => s[k] || 0));
  const kinds = events.map((e) => e.kind);
  const vis = kinds.filter((k) => k === 'hidden' || k === 'visible-after-hidden');
  const ids = t2?.touchIdentifiers || [];
  return {
    secureContext: load.isSecureContext === true,
    origin: load.origin || null,
    cryptoSubtle: load.cryptoSubtle === true,
    joinPageCodeField: load.codeField === true,
    typedCode: typed,
    typedCodeMatches: typed === code,
    twoTouchStreams: new Set(ids).size >= 2 && max('maxSimultaneousTouches') >= 2,
    touchIdentifiers: ids,
    distinctTouchIdentifiers: max('distinctTouchIdentifiers'),
    maxSimultaneousTouches: max('maxSimultaneousTouches'),
    distinctPointerIds: max('distinctPointerIds'),
    maxSimultaneousPointers: max('maxSimultaneousPointers'),
    visibilityEvents: vis,
    visibilityCycle: vis.length >= 2 && vis[0] === 'hidden' && vis.includes('visible-after-hidden'),
    pageUserAgent: load.userAgent || null,
    viewport: load.innerWidth ? `${load.innerWidth}x${load.innerHeight}@${load.devicePixelRatio}` : null,
  };
}
// The fields two runs must agree on (counts that depend on timing, ids and the viewport are excluded).
const stable = (s) => ({
  secureContext: s.secureContext, origin: s.origin?.replace(/:\d+$/, ':<port>'), cryptoSubtle: s.cryptoSubtle,
  joinPageCodeField: s.joinPageCodeField, typedCode: s.typedCode, typedCodeMatches: s.typedCodeMatches,
  twoTouchStreams: s.twoTouchStreams, distinctTwoPlus: s.distinctTouchIdentifiers >= 2,
  visibilityCycle: s.visibilityCycle, firstVisibility: s.visibilityEvents[0], lastVisibility: s.visibilityEvents.at(-1),
});
function acLines(label, s) {
  const p = (b) => (b ? 'PASS' : 'FAIL');
  return [
    `[${label}] AC1 secure-context+typed-code: ${p(s.secureContext && s.typedCodeMatches)} (isSecureContext=${s.secureContext}, origin=${s.origin}, crypto.subtle=${s.cryptoSubtle}, typed="${s.typedCode}")`,
    `[${label}] AC2 two-finger-touch: ${p(s.twoTouchStreams)} (identifiers=${JSON.stringify(s.touchIdentifiers)}, distinctTouchIds=${s.distinctTouchIdentifiers}, maxSimultaneousTouches=${s.maxSimultaneousTouches}, distinctPointerIds=${s.distinctPointerIds})`,
    `[${label}] AC3 visibilitychange: ${p(s.visibilityCycle)} (${s.visibilityEvents.join(' -> ')})`,
  ];
}

// ---------------------------------------------------------------- iOS Simulator
const DEV_NAME = 'jj-f08-iphone';
async function runIos(code) {
  const label = 'iOS Simulator';
  const machine = {
    host: os.hostname(), model: sh('sysctl', ['-n', 'hw.model']).out, macOS: sh('sw_vers', ['-productVersion']).out,
    xcode: sh('xcodebuild', ['-version']).out.replace(/\n/g, ' '),
  };
  const rt = JSON.parse(sh('xcrun', ['simctl', 'list', 'runtimes', '-j']).out).runtimes.filter((r) => r.isAvailable && r.identifier.includes('iOS')).at(-1);
  if (!rt) throw new Error('no iOS simulator runtime');
  const devs = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', '-j']).out).devices;
  let dev = Object.values(devs).flat().find((d) => d.name === DEV_NAME);
  if (!dev) {
    const udid = sh('xcrun', ['simctl', 'create', DEV_NAME, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', rt.identifier]).out;
    dev = { udid };
  }
  const udid = dev.udid;
  // One emulator owner per machine window: this lane only ever touches its own named device.
  sh('xcrun', ['simctl', 'shutdown', udid]);
  sh('xcrun', ['simctl', 'erase', udid]);
  log('booting', DEV_NAME, udid);
  sh('xcrun', ['simctl', 'boot', udid]);
  sh('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeout: 300000 });

  const stack = await startStack(code);
  const dd = path.join(os.tmpdir(), 'jj-f08-ios-dd');
  // Async on purpose: the event loop must keep serving the page and the probe while xcodebuild runs.
  const xb = (args) => runAsync('xcodebuild', args, { env: { ...process.env, TEST_RUNNER_JJ_COLLECTOR: `http://localhost:${stack.port}`, TEST_RUNNER_JJ_CODE: code } });
  try {
    const proj = path.join(here, 'ios/F08Host.xcodeproj');
    const common = ['-project', proj, '-scheme', 'F08Host', '-destination', `id=${udid}`, '-derivedDataPath', dd];
    log('xcodebuild build-for-testing');
    const b = await xb(['build-for-testing', ...common]);
    if (b.status !== 0) throw new Error('xcodebuild build-for-testing failed:\n' + (b.stdout + b.stderr).split('\n').slice(-40).join('\n'));

    // openurl times out when SpringBoard is still settling after boot, so retry until the page reports in.
    await runAsync('xcrun', ['simctl', 'launch', udid, 'com.apple.mobilesafari'], { timeout: 60000 });
    await sleep(5000);
    for (let i = 0; i < 10 && !stack.has('load'); i++) {
      await runAsync('xcrun', ['simctl', 'openurl', udid, `http://localhost:${stack.port}/`], { timeout: 60000 });
      await until('Safari page load', () => stack.has('load'), 20000).catch(() => log('openurl attempt', i + 1, 'did not load'));
    }
    if (!stack.has('load')) throw new Error('Mobile Safari never loaded the lane page');
    log('xcodebuild test-without-building (XCUITest drives Mobile Safari)');
    const t = await xb(['test-without-building', ...common]);
    const tail = (t.stdout + t.stderr).split('\n').filter((l) => /Test Case|error:|failed|passed|\*\* TEST/.test(l)).slice(-12);
    await sleep(2500);
    if (t.status !== 0) {
      const f = path.join(os.tmpdir(), 'jj-f08-ios-fail.png');
      sh('xcrun', ['simctl', 'io', udid, 'screenshot', f]);
      log('driver failed; simulator screenshot', f);
    }
    const events = JSON.parse(JSON.stringify(stack.events));
    const summary = summarise(events, code);
    const safariPath = sh('xcrun', ['simctl', 'get_app_container', udid, 'com.apple.mobilesafari']).out;
    const plist = safariPath ? sh('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(safariPath, 'Info.plist')]).out : '';
    return {
      label, machine,
      target: { simulator: DEV_NAME, udid, deviceType: 'iPhone 17', runtime: rt.name, runtimeBuild: rt.buildversion, browser: `Mobile Safari ${plist}`.trim() },
      driver: 'XCUITest (xcodebuild) driving com.apple.mobilesafari; page readout via injected probe',
      driverOk: t.status === 0, driverTail: tail, summary, events: events.filter((e) => e.kind !== 'touch-summary'),
    };
  } finally {
    await stack.stop();
    if (!flag('keep')) sh('xcrun', ['simctl', 'shutdown', udid]);
  }
}

// ---------------------------------------------------------------- Android emulator on eris
const ADB = '~/Android/Sdk/platform-tools/adb';
const EMU = '~/Android/Sdk/emulator/emulator';
const AVD = 'jj-ctrl-api37-play';
let CDP_PORT = 19222; // per-run free port, so a stale tunnel can never collide
async function runAndroid(code) {
  const label = 'Android emulator';
  const host = opt('eris', 'eris');
  const ssh = (cmd, o = {}) => sh('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, cmd], o);
  const adb = (cmd, o = {}) => ssh(`${ADB} ${cmd}`, o);
  if (ssh('echo ok').out !== 'ok') throw new Error(`can't reach ${host}`);
  const wasRunning = adb('devices').out.includes('emulator-');
  if (!wasRunning) {
    ownedEmulator = (c) => adb(c);
    // Emulator needs KVM and ~3 GiB RAM: check eris has room first (§15.2).
    const free = ssh("awk '/MemAvailable/ {print int($2/1048576)}' /proc/meminfo").out;
    log(`starting ${AVD} on ${host} (MemAvailable ${free} GiB)`);
    ssh(`nohup ${EMU} -avd ${AVD} -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect -read-only >> ~/Work/runs/f08-emulator.log 2>&1 < /dev/null &`);
  }
  await until('emulator boot', () => adb('shell getprop sys.boot_completed').out === '1', 300000, 3000);
  const prop = (p) => adb(`shell getprop ${p}`).out;
  const chromeVer = adb('shell dumpsys package com.android.chrome').out.match(/versionName=(\S+)/)?.[1] || '?';
  const machine = {
    host: ssh('hostname').out, kernel: ssh('uname -sr').out, cpus: ssh('nproc').out,
    memGiB: ssh("awk '/MemTotal/ {print int($2/1048576)}' /proc/meminfo").out,
    emulator: ssh(`${EMU} -version 2>/dev/null | grep -m1 'Android emulator version'`).out.replace(/.*version /, ''),
  };
  const target = { avd: AVD, model: prop('ro.product.model'), android: `${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')})`, browser: `Chrome ${chromeVer}` };

  const shot = (name) => {
    const r = spawnSync('ssh', [host, `${ADB} exec-out screencap -p`], { maxBuffer: 1 << 26 });
    if (r.stdout?.length) writeFileSync(path.join(os.tmpdir(), `jj-f08-${name}.png`), r.stdout);
    log('screenshot', path.join(os.tmpdir(), `jj-f08-${name}.png`));
  };
  CDP_PORT = await freePort();
  const stack = await startStack(code);
  const tun = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-R', `${stack.port}:127.0.0.1:${stack.port}`, '-L', `${CDP_PORT}:127.0.0.1:${CDP_PORT}`, host], { stdio: 'ignore' });
  let cdp;
  try {
    await sleep(1500);
    if (tun.exitCode !== null) throw new Error('ssh tunnel to eris exited (port clash?)');
    adb(`reverse tcp:${stack.port} tcp:${stack.port}`);
    adb(`forward tcp:${CDP_PORT} localabstract:chrome_devtools_remote`);
    // Fresh Chrome profile each run.
    adb('shell pm clear com.android.chrome');
    adb('shell input keyevent KEYCODE_HOME');
    const url = `http://localhost:${stack.port}/`;
    adb(`shell am start -a android.intent.action.VIEW -d ${url} com.android.chrome`);
    // Dismiss first-run screens until the page has loaded.
    const dismiss = ['Stay signed out', 'No thanks', 'Not now', 'Got it', 'Accept & continue', 'Accept &amp; continue', 'Continue', 'Skip', 'Don’t allow', 'No, thanks'];
    const dismissPass = () => {
      adb('shell uiautomator dump /sdcard/jj-f08.xml');
      const xml = adb('shell cat /sdcard/jj-f08.xml').out;
      for (const t of dismiss) {
        const m = xml.match(new RegExp(`text="${t}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
        if (m) { adb(`shell input tap ${(+m[1] + +m[3]) >> 1} ${(+m[2] + +m[4]) >> 1}`); log('dismissed', t); return true; }
      }
      return false;
    };
    await until('page load in Chrome', () => {
      if (stack.has('load')) return true;
      if (dismissPass()) return false;
      // Chrome sometimes drops back to the launcher after first-run (a crash/restart): ask for the URL again.
      if (!adb('shell dumpsys activity activities').out.match(/topResumedActivity=.*com\.android\.chrome/)) {
        log('Chrome not in front; relaunching the URL');
        adb(`shell am start -a android.intent.action.VIEW -d ${url} com.android.chrome`);
      }
      return false;
    }, 90000, 2500).catch((e) => { shot('load-fail'); throw e; });
    // Chrome raises more prompts (notifications) after the page loads: clear them before touching.
    for (let i = 0; i < 4; i++) { await sleep(1500); if (!dismissPass()) break; }
    await sleep(500);

    cdp = await openCdp();
    const evalJs = (expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r.result?.value);
    // AC1: a real touch tap on the code field (focuses it, raises the IME), then real key events.
    const rect = await evalJs(`(() => { document.getElementById('code').scrollIntoView({ block: 'center' }); const r = document.getElementById('code').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
    await touch(cdp, 'tap', [{ x: rect.x, y: rect.y, id: 1 }]);
    await sleep(800);
    adb(`shell input text ${code}`);
    await until('typed code reported', () => stack.has('typed'), 10000).catch((e) => { shot('typed-fail'); throw e; });
    adb('shell input keyevent KEYCODE_BACK'); // hide the IME
    await sleep(600);
    // AC2: two simultaneous fingers, moving independently, on empty page space.
    const vp = await evalJs('({w: innerWidth, h: innerHeight})');
    await touch(cdp, 'pinch', [
      { x: vp.w * 0.35, y: vp.h * 0.9, id: 1 }, { x: vp.w * 0.65, y: vp.h * 0.9, id: 2 },
    ]);
    await until('two touches reported', () => stack.has('touch2'), 10000);
    cdp.close(); cdp = null;
    // AC3: background (Home) and foreground (relaunch the task).
    adb('shell input keyevent KEYCODE_HOME');
    await until('hidden', () => stack.has('hidden'), 15000);
    await sleep(1000);
    adb('shell monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1');
    await until('visible again', () => stack.has('visible-after-hidden'), 20000);
    await sleep(2500);
    const events = JSON.parse(JSON.stringify(stack.events));
    return {
      label, machine, target,
      driver: 'adb input + CDP Input.dispatchTouchEvent in Chrome (tunnelled from eris); page readout via injected probe',
      driverOk: true, summary: summarise(events, code), events: events.filter((e) => e.kind !== 'touch-summary'),
    };
  } finally {
    try { cdp?.close(); } catch {}
    adb('shell am force-stop com.android.chrome');
    adb('reverse --remove-all'); adb(`forward --remove tcp:${CDP_PORT}`);
    tun.kill();
    await stack.stop();
  }
}

async function openCdp() {
  const list = await until('chrome devtools', async () => {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, { signal: AbortSignal.timeout(3000) }); const j = await r.json(); return j.find((t) => t.type === 'page') || false; } catch { return false; }
  }, 45000, 1000);
  const ws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('cdp websocket open timeout')), 8000); });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d); pending.delete(d.id); } };
  return { send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); setTimeout(() => rej(new Error(`cdp ${method} timed out`)), 10000); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() };
}
async function touch(cdp, kind, pts) {
  const tp = (p, dx = 0, dy = 0) => ({ x: p.x + dx, y: p.y + dy, id: p.id, radiusX: 8, radiusY: 8, force: 1 });
  const ev = (type, pts2) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts2 });
  if (kind === 'tap') { await ev('touchStart', pts.map((p) => tp(p))); await sleep(60); await ev('touchEnd', []); return; }
  // pinch: two fingers move apart in opposite directions over 10 steps.
  await ev('touchStart', pts.map((p) => tp(p)));
  for (let s = 1; s <= 10; s++) {
    await sleep(30);
    await ev('touchMove', pts.map((p, i) => tp(p, (i ? 1 : -1) * s * 6, 0)));
  }
  await ev('touchEnd', []);
}

// ---------------------------------------------------------------- main
function compare(a, b) {
  const sa = JSON.stringify(stable(a.summary)), sb = JSON.stringify(stable(b.summary));
  return sa === sb ? { same: true } : { same: false, a: sa, b: sb };
}
let ownedEmulator = null; // set when this lane started the emulator, so it also stops it (not on --keep)
async function stopOwnedEmulator() {
  if (!ownedEmulator || flag('keep')) return;
  ownedEmulator('emu kill');
  await sleep(8000);
  log('stopped emulator');
}
async function main() {
  if (mode === 'compare') {
    const [a, b] = argv.slice(1).map((f) => JSON.parse(readFileSync(f, 'utf8')));
    const c = compare(a, b);
    console.log(`[${a.label}] two-run comparison: ${c.same ? 'IDENTICAL' : 'DIFFERENT'}`);
    process.exit(c.same ? 0 : 1);
  }
  if (mode !== 'ios' && mode !== 'android') { console.error('usage: lane.mjs ios|android|compare [--repeat N]'); process.exit(2); }
  const code = opt('code', 'ABCD');
  const repeat = +opt('repeat', '1');
  const outDir = path.resolve(repo, opt('out', 'docs/evidence/P1-F08'));
  mkdirSync(outDir, { recursive: true });
  const results = [];
  let failed = false;
  for (let n = 1; n <= repeat; n++) {
    const started = new Date().toISOString();
    const r = await (mode === 'ios' ? runIos(code) : runAndroid(code));
    r.run = n; r.startedAt = started; r.finishedAt = new Date().toISOString();
    const m = Object.entries(r.machine).map(([k, v]) => `${k}=${v}`).join(' ');
    const t = Object.entries(r.target).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`[${r.label}] run ${n}/${repeat} machine: ${m}`);
    console.log(`[${r.label}] run ${n}/${repeat} target: ${t}`);
    console.log(`[${r.label}] run ${n}/${repeat} driver: ${r.driver} (driverOk=${r.driverOk})`);
    for (const l of acLines(r.label, r.summary)) console.log(l.replace(`[${r.label}]`, `[${r.label}] run ${n}:`));
    const ok = r.summary.secureContext && r.summary.typedCodeMatches && r.summary.twoTouchStreams && r.summary.visibilityCycle;
    console.log(`[${r.label}] run ${n}/${repeat} RESULT: ${ok ? 'PASS' : 'FAIL'}`);
    failed ||= !ok;
    const file = path.join(outDir, `${opt('tag', mode)}-run${n}.json`);
    writeFileSync(file, JSON.stringify(r, null, 2) + '\n');
    results.push(r);
  }
  if (repeat >= 2) {
    const same = results.slice(1).every((r) => compare(results[0], r).same);
    console.log(`[${results[0].label}] ${repeat} consecutive runs: ${same ? 'IDENTICAL results' : 'DIFFERENT results'}`);
    failed ||= !same;
  }
  await stopOwnedEmulator();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error('lane error:', e.stack || e.message); await stopOwnedEmulator(); process.exit(1); });
