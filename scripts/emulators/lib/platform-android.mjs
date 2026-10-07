// P1-F08: the Android emulator platform for drive.mjs. Runs on eris (KVM): adb is local, the page is
// http://localhost:<port> through `adb reverse`, gestures are CDP Input.dispatchTouchEvent in Chrome.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { sleep, until } from './stack.mjs';

const SDK = path.join(os.homedir(), 'Android/Sdk');
const ADB = path.join(SDK, 'platform-tools/adb');
const EMU = path.join(SDK, 'emulator/emulator');
const AVD = 'jj-ctrl-api37-play';
const sh = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, ...o }); return { code: r.status, out: (r.stdout || '').trim() }; };
const adb = (...a) => sh(ADB, a.flatMap((x) => x.split(' ')));
const adbShell = (cmd) => sh(ADB, ['shell', cmd]);
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

export async function androidPlatform({ api, port, log, opt }) {
  const wasRunning = adb('devices').out.includes('emulator-');
  if (!wasRunning) {
    log('starting', AVD);
    spawnSync('bash', ['-c', `nohup ${EMU} -avd ${AVD} -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect -read-only >> ~/Work/runs/f08-emulator.log 2>&1 < /dev/null &`]);
  }
  await until('emulator boot', () => adbShell('getprop sys.boot_completed').out === '1', 300000, 3000);
  const prop = (p) => adbShell(`getprop ${p}`).out;
  const chrome = adbShell('dumpsys package com.android.chrome').out.match(/versionName=(\S+)/)?.[1] || '?';
  const machine = { host: os.hostname(), kernel: sh('uname', ['-sr']).out, cpus: os.cpus().length, memGiB: Math.round(os.totalmem() / 2 ** 30) };
  const target = { avd: AVD, model: prop('ro.product.model'), android: `${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')})`, browser: `Chrome ${chrome}`, orientation: 'landscape' };
  // Landscape, as the sticks are played.
  const rotate = () => { adbShell('settings put system accelerometer_rotation 0'); adbShell('settings put system user_rotation 1'); adbShell('wm user-rotation lock 1'); };
  rotate();
  const cdpPort = await freePort();
  adb(`reverse tcp:${port} tcp:${port}`);
  adb(`forward tcp:${cdpPort} localabstract:chrome_devtools_remote`);
  adbShell('pm clear com.android.chrome');
  adbShell('input keyevent KEYCODE_HOME');
  let cdp = null;
  const url = (u) => u;
  const dismiss = ['Stay signed out', 'No thanks', 'Not now', 'Got it', 'Accept & continue', 'Accept &amp; continue', 'Continue', 'Skip', 'Don’t allow', 'No, thanks'];
  const dismissPass = () => {
    adbShell('uiautomator dump /sdcard/jj-f08.xml');
    const xml = adbShell('cat /sdcard/jj-f08.xml').out;
    for (const t of dismiss) {
      const m = xml.match(new RegExp(`text="${t}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
      if (m) { adbShell(`input tap ${(+m[1] + +m[3]) >> 1} ${(+m[2] + +m[4]) >> 1}`); log('dismissed', t); return true; }
    }
    return false;
  };
  async function openCdp() {
    const t = await until('chrome devtools', async () => { try { const r = await fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: AbortSignal.timeout(3000) }); const j = await r.json(); return j.find((x) => x.type === 'page' && x.url.includes('localhost')) || false; } catch { return false; } }, 45000, 1000);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error('cdp open timeout')), 8000); });
    let id = 0; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d); pending.delete(d.id); } };
    return { send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); setTimeout(() => rej(new Error(`cdp ${method} timed out`)), 10000); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() };
  }
  const tp = (p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(tp) });
  const withCdp = async (fn) => {
    for (let i = 0; ; i++) {
      try { if (!cdp) cdp = await openCdp(); return await fn(); }
      catch (e) { try { cdp?.close(); } catch {} cdp = null; if (i >= 2) throw e; log('cdp retry:', e.message); dismissPass(); }
    }
  };
  let pageUrl = '';
  const plat = {
    label: 'Android emulator', machine, target,
    async open(u) {
      pageUrl = u;
      adbShell(`am start -a android.intent.action.VIEW -d ${u} com.android.chrome`);
      const end = Date.now() + 90000;
      while (Date.now() < end) {
        const evs = await api.events().catch(() => []);
        if (evs.some((e) => e.kind === 'load' && e.data.path === new URL(u).pathname)) return;
        if (dismissPass()) continue;
        if (!adbShell('dumpsys activity activities').out.match(/topResumedActivity=.*com\.android\.chrome/)) adbShell(`am start -a android.intent.action.VIEW -d ${u} com.android.chrome`);
        await sleep(2500);
      }
    },
    /** Runs `expr` in the page (CDP Runtime.evaluate, by value, awaiting a promise). */
    async evaluate(expr) { return withCdp(async () => (await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value); },
    /** Taps Chrome's camera permission prompt the way a player would ("Allow" / "While using the app"). */
    async allowCamera() {
      adbShell('uiautomator dump /sdcard/jj-f08.xml');
      const xml = adbShell('cat /sdcard/jj-f08.xml').out;
      for (const t of ['While using the app', 'Allow', 'Allow only this time']) {
        const m = xml.match(new RegExp(`text="${t}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
        if (m) { adbShell(`input tap ${(+m[1] + +m[3]) >> 1} ${(+m[2] + +m[4]) >> 1}`); log('allowed camera via', t); return true; }
      }
      return false;
    },
    async settle() { for (let i = 0; i < 4; i++) { await sleep(1200); if (!dismissPass()) break; } },
    async tap(rect) { await withCdp(async () => { const p = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, id: 1 }; await touch('touchStart', [p]); await sleep(60); await touch('touchEnd', []); }); },
    async holdTwo(fingers, ms) {
      await withCdp(async () => {
        const pts = fingers.map((f, i) => ({ ...f.from, id: i + 1 }));
        await touch('touchStart', pts);
        const steps = 10;
        for (let s = 1; s <= steps; s++) { await sleep(60); await touch('touchMove', fingers.map((f, i) => ({ id: i + 1, x: f.from.x + (f.to.x - f.from.x) * s / steps, y: f.from.y + (f.to.y - f.from.y) * s / steps }))); }
        // Hold: re-send the final positions so the fingers stay down and the stick stays deflected.
        const end = Date.now() + Math.max(0, ms - 700);
        while (Date.now() < end) { await sleep(100); await touch('touchMove', fingers.map((f, i) => ({ id: i + 1, x: f.to.x + (Date.now() % 2), y: f.to.y }))); }
        await touch('touchEnd', []);
      });
    },
    async background() { cdp?.close(); cdp = null; adbShell('input keyevent KEYCODE_HOME'); },
    async foreground() { adbShell('monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1'); rotate(); },
    async shot(name) {
      const r = spawnSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 });
      if (r.stdout?.length) writeFileSync(path.join(process.env.JJ_EVIDENCE_DIR || opt('out', os.tmpdir()), `drive-android-${name}.png`), r.stdout);
    },
    async close() {
      try { cdp?.close(); } catch {}
      adbShell('am force-stop com.android.chrome'); adb('reverse --remove-all');
      if (!wasRunning && opt('keep') !== '1') adb('emu kill');
    },
  };
  return plat;
}
