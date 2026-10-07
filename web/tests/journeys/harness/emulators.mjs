// Emulator controllers for the journey pool (P1-F10): a phone that is a real mobile browser in an emulator, joined to a
// hello room and left again on demand. F08's lane (scripts/emulators/) owns the gesture-level scenarios; this is only
// "a participant that comes and goes". Android is driven by adb plus Playwright over CDP (so the page's own `__jjHello`
// is reachable); iOS Simulator by `simctl openurl` / `terminate` (Mobile Safari has no CDP: its endpoint is the marker that
// appears on the host).
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { AVD, ADB, EMULATOR } from './lanes.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000, ...o });
  return { code: r.status, out: (r.stdout ?? '').trim() };
};
const adb = (...a) => sh(ADB, a.flatMap((x) => x.split(' ')));
const adbShell = (cmd) => sh(ADB, ['shell', cmd]);
const freePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
async function until(what, fn, ms, step = 500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(step);
  }
}

const FIRST_RUN = ['Stay signed out', 'No thanks', 'Not now', 'Got it', 'Accept & continue', 'Accept &amp; continue', 'Continue', 'Skip', 'Don’t allow', 'No, thanks'];

/** Android Chrome in the emulator on THIS machine. `port` is the jj-server port the room is served on. */
export async function androidController({ port, log = () => {} }) {
  const wasRunning = adb('devices').out.includes('emulator-');
  if (!wasRunning) {
    log(`starting ${AVD}`);
    spawn('bash', ['-c', `nohup ${EMULATOR} -avd ${AVD} -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect -read-only >> /tmp/jj-f10-emulator.log 2>&1 < /dev/null &`], { stdio: 'ignore', detached: true });
  }
  await until('emulator boot', () => adbShell('getprop sys.boot_completed').out === '1', 300_000, 3000);
  const chromeVersion = adbShell('dumpsys package com.android.chrome').out.match(/versionName=(\S+)/)?.[1] ?? '?';
  const target = { avd: AVD, android: `${adbShell('getprop ro.build.version.release').out} (API ${adbShell('getprop ro.build.version.sdk').out})`, browser: `Chrome ${chromeVersion}` };
  const cdpPort = await freePort();
  adb(`reverse tcp:${port} tcp:${port}`);
  adb(`forward tcp:${cdpPort} localabstract:chrome_devtools_remote`);
  adbShell('pm clear com.android.chrome');
  // The screen stays on (a sleeping emulator throttles the page's timers and its connection looks dead to the host).
  adbShell('svc power stayon true');
  adbShell('input keyevent KEYCODE_WAKEUP');
  const dismiss = () => {
    adbShell('uiautomator dump /sdcard/jj-f10.xml');
    const xml = adbShell('cat /sdcard/jj-f10.xml').out;
    for (const t of FIRST_RUN) {
      const m = xml.match(new RegExp(`text="${t}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
      if (m) {
        adbShell(`input tap ${(+m[1] + +m[3]) >> 1} ${(+m[2] + +m[4]) >> 1}`);
        return true;
      }
    }
    return false;
  };
  let browser = null;
  let page = null;
  return {
    kind: 'android-emulator',
    label: 'Android emulator',
    target,
    /** Opens the join URL in Chrome and resolves with the page's endpoint id once it is connected. */
    async join(url) {
      adbShell('input keyevent KEYCODE_HOME');
      adbShell(`am start -a android.intent.action.VIEW -d ${url} com.android.chrome`);
      const { chromium } = await import('playwright');
      await until(
        'the emulator page',
        async () => {
          if (dismiss()) await sleep(1500);
          try {
            browser ??= await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
            page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(url.split('?')[0]));
            return page;
          } catch {
            browser = null;
            return false;
          }
        },
        120_000,
        2500,
      );
      await page.waitForFunction(() => window.__jjHello?.link().state === 'connected', undefined, { timeout: 90_000 });
      return page.evaluate(() => window.__jjHello.link().endpointId);
    },
    async setStick(x, y) {
      await page.evaluate(([x, y]) => window.__jjHello.setStick(x, y), [x, y]);
    },
    /** The phone goes away: Chrome is force-stopped (no `bye`, as a phone losing its page). */
    async leave() {
      try {
        await browser?.close();
      } catch {}
      browser = null;
      page = null;
      adbShell('am force-stop com.android.chrome');
    },
    async close() {
      await this.leave();
      adb('reverse --remove-all');
      if (!wasRunning) adb('emu kill');
    },
  };
}

/** Mobile Safari in the iOS Simulator (macOS only). The simulator shares the Mac's network, so `localhost` is the server. */
export async function iosController({ udid, log = () => {} }) {
  const simctl = (...a) => sh('xcrun', ['simctl', ...a]);
  if (!simctl('list', 'devices', 'booted').out.includes(udid)) {
    log(`booting simulator ${udid}`);
    simctl('boot', udid);
    await until('simulator boot', () => simctl('bootstatus', udid).code === 0, 180_000, 2000);
  }
  return {
    kind: 'ios-simulator',
    label: 'iOS Simulator',
    target: { udid, browser: 'Mobile Safari' },
    /** Opens the URL; the caller finds the endpoint as the marker that appears on the host. */
    async join(url) {
      simctl('openurl', udid, url);
      return null;
    },
    async setStick() {},
    async leave() {
      simctl('terminate', udid, 'com.apple.mobilesafari');
    },
    async close() {
      await this.leave();
    },
  };
}
