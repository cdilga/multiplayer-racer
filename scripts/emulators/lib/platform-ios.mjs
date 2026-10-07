// P1-F08: the iOS Simulator platform for drive.mjs (runs on the Mac, the only Mac-pinned job). The page is
// http://localhost:<port> (an ssh tunnel to the stack on eris, so a secure context); gestures are XCUITest touches in
// Mobile Safari, fed by the lane's command queue (see ios/F08UITests/F08UITests.swift `testDrive`).
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep, until } from './stack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_NAME = 'jj-f08-iphone';
const sh = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, ...o }); return { code: r.status, out: (r.stdout || '').trim() }; };
const runAsync = (cmd, args, o = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...o });
  let stdout = '', stderr = '';
  p.stdout.on('data', (c) => (stdout += c)); p.stderr.on('data', (c) => (stderr += c));
  const timer = o.timeout ? setTimeout(() => p.kill(), o.timeout) : null;
  p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  o.onProc?.(p);
});

export async function iosPlatform({ api, port, log, opt }) {
  const base = `http://localhost:${port}`;
  const machine = { host: os.hostname(), model: sh('sysctl', ['-n', 'hw.model']).out, macOS: sh('sw_vers', ['-productVersion']).out, xcode: sh('xcodebuild', ['-version']).out.replace(/\n/g, ' '), stack: 'jj-server + host Chromium on eris, tunnelled over ssh' };
  const rt = JSON.parse(sh('xcrun', ['simctl', 'list', 'runtimes', '-j']).out).runtimes.filter((r) => r.isAvailable && r.identifier.includes('iOS')).at(-1);
  const devs = JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', '-j']).out).devices;
  let dev = Object.values(devs).flat().find((d) => d.name === DEV_NAME);
  const udid = dev ? dev.udid : sh('xcrun', ['simctl', 'create', DEV_NAME, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', rt.identifier]).out;
  sh('xcrun', ['simctl', 'shutdown', udid]); sh('xcrun', ['simctl', 'erase', udid]);
  log('booting', DEV_NAME);
  sh('xcrun', ['simctl', 'boot', udid]);
  sh('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeout: 300000 });
  const safariPath = sh('xcrun', ['simctl', 'get_app_container', udid, 'com.apple.mobilesafari']).out;
  const safariVer = safariPath ? sh('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(safariPath, 'Info.plist')]).out : '';
  const target = { simulator: DEV_NAME, deviceType: 'iPhone 17', runtime: `${rt.name} (${rt.buildversion})`, browser: `Mobile Safari ${safariVer}`.trim(), orientation: 'portrait (upright)' };
  const dd = path.join(os.tmpdir(), 'jj-f08-ios-dd');
  const proj = path.join(here, '../ios/F08Host.xcodeproj');
  const common = ['-project', proj, '-scheme', 'F08Host', '-destination', `id=${udid}`, '-derivedDataPath', dd];
  const env = { ...process.env, TEST_RUNNER_JJ_COLLECTOR: base, TEST_RUNNER_JJ_CODE: 'ABCD' };
  log('xcodebuild build-for-testing');
  const b = await runAsync('xcodebuild', ['build-for-testing', ...common], { env });
  if (b.status !== 0) throw new Error('build-for-testing failed:\n' + (b.stdout + b.stderr).split('\n').slice(-30).join('\n'));
  let xt = null; let xtOut = { stdout: '', stderr: '' };
  const cmd = (c) => fetch(base + '/__lane/cmd', { method: 'POST', body: JSON.stringify(c), signal: AbortSignal.timeout((c.timeoutMs || 90000) + 5000) }).then((r) => r.json());
  // The web view's frame is not the page's origin (status bar, toolbar): one harmless tap on empty page space, read back
  // from the page's own pointerdown, gives the offset between where XCUITest was told and where the page was touched.
  let off = { dx: 0, dy: 0 };
  const calibrate = async () => {
    const downs = async () => (await api.events().catch(() => [])).filter((e) => e.kind === 'touch-summary').at(-1)?.data.downs ?? [];
    const n = (await downs()).length;
    const want = { x: 200, y: 150 };
    await cmd({ op: 'tap', x: want.x, y: want.y, ms: 80 });
    const got = await until('calibration tap', async () => { const d = await downs(); return d.length > n ? d.at(-1) : false; }, 15000, 500);
    off = { dx: want.x - got[1], dy: want.y - got[2] };
    log('calibration offset (css px)', JSON.stringify(off));
  };
  const plat = {
    label: 'iOS Simulator', machine, target,
    async open(url, waitKind) {
      await runAsync('xcrun', ['simctl', 'launch', udid, 'com.apple.mobilesafari'], { timeout: 60000 });
      await sleep(5000);
      const pathname = new URL(url).pathname;
      const loaded = async () => (await api.events().catch(() => [])).some((e) => (waitKind ? e.kind === waitKind : e.kind === 'load' && e.data.path === pathname));
      for (let i = 0; i < 8 && !(await loaded()); i++) {
        await runAsync('xcrun', ['simctl', 'openurl', udid, url], { timeout: 60000 });
        await until('Safari page load', loaded, 20000, 500).catch(() => log('openurl attempt', i + 1, 'did not load'));
      }
      if (!(await loaded())) throw new Error('Mobile Safari never loaded ' + url);
      if (xt) return;
      // The XCUITest runner stays up for the whole run and takes commands from the lane.
      const started = runAsync('xcodebuild', ['test-without-building', '-only-testing:F08UITests/F08UITests/testDrive', ...common], { env, onProc: (p) => (xt = p) }).then((r) => (xtOut = r));
      await sleep(1500); await calibrate();
    },
    async settle() { await sleep(1500); },
    async tap(rect) {
      const r = await cmd({ op: 'tap', x: rect.x + rect.w / 2 + off.dx, y: rect.y + rect.h / 2 + off.dy, ms: 80 });
      if (!r.ok) throw new Error('tap failed: ' + r.error);
    },
    async holdTwo(fingers, ms) {
      const sh2 = (p) => ({ x: p.x + off.dx, y: p.y + off.dy });
      const r = await cmd({ op: 'hold', fingers: fingers.map((f) => ({ from: sh2(f.from), to: sh2(f.to) })), ms, timeoutMs: ms + 60000 });
      if (!r.ok) throw new Error('hold failed: ' + r.error);
    },
    async background() { await cmd({ op: 'home' }); },
    async foreground() { await cmd({ op: 'activate' }); },
    async shot(name) { sh('xcrun', ['simctl', 'io', udid, 'screenshot', path.join(opt('out', os.tmpdir()), `drive-ios-${name}.png`)]); },
    async close() {
      try { await cmd({ op: 'done', timeoutMs: 15000 }); } catch {}
      await sleep(1500); xt?.kill();
      sh('xcrun', ['simctl', 'shutdown', udid]); // never leave the simulator idle (Mac load)
    },
  };
  return plat;
}
