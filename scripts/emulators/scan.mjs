#!/usr/bin/env node
// P1-C04 on the Android emulator (the F08 lane): the landing page's in-page QR scanner reads a QR through the emulator's
// virtual-scene camera and joins. Labelled "Android emulator", never "device"; the iOS Simulator has no camera.
//
//   node scripts/emulators/scan.mjs [--out docs/evidence/P1-C04] [--port 7471]   (on eris: scripts/remote/eris.sh --run c04emu ...)
//
// How: jj-server serves the real web build behind the lane proxy (which injects the probe); a QR of
// `http://localhost:<port>/j/QRSC` is drawn to a PNG and made the virtual scene's wall poster; the AVD's back camera is
// switched to `virtualscene` for the run (config.ini and the posters file are restored afterwards); Chrome opens the
// landing page, a real touch taps "Scan QR code", the camera prompt is allowed through uiautomator, and the lane waits for
// the page to navigate to /j/QRSC (the probe reports every page load). The scanner uses BarcodeDetector or the bundled
// jsQR, whichever Chrome offers; the result records which.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repo, sleep, startStack, until } from './lib/stack.mjs';
import { androidPlatform } from './lib/platform-android.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const log = (...a) => console.error('[scan]', ...a);
const SDK = path.join(os.homedir(), 'Android/Sdk');
const ADB = path.join(SDK, 'platform-tools/adb');
const POSTERS = path.join(SDK, 'emulator/resources/Toren1BD.posters');
const AVD_CONFIG = path.join(os.homedir(), '.android/avd/jj-ctrl-api37-play.avd/config.ini');
const sh = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 }); return { code: r.status, out: (r.stdout || '').trim() }; };

/** A QR of `text` as a square PNG, 14 px a module with a four-module quiet zone, black on white. */
function qrPng(text, file) {
  const req = createRequire(path.join(repo, 'web/package.json'));
  const { encode } = req('uqr');
  const { PNG } = req('pngjs');
  const { data, size } = encode(text, { ecc: 'M', border: 4 });
  const px = 14;
  const png = new PNG({ width: size * px, height: size * px });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const dark = data[Math.floor(y / px)][Math.floor(x / px)];
      const i = (y * png.width + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = dark ? 0 : 255;
      png.data[i + 3] = 255;
    }
  }
  writeFileSync(file, PNG.sync.write(png));
}

async function main() {
  const outDir = path.resolve(process.env.JJ_EVIDENCE_DIR || opt('out', path.join(here, '../../docs/evidence/P1-C04')));
  mkdirSync(outDir, { recursive: true });
  const runDir = process.env.JJ_RUN_DIR || os.tmpdir();
  const dist = path.resolve(process.env.JJ_RUN_DIR ? path.join(runDir, 'dist') : path.join(repo, 'web/dist-test/f08'));
  if (!existsSync(path.join(dist, 'landing/index.html'))) {
    const r = spawnSync(process.execPath, [path.join(repo, 'web/node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: path.join(repo, 'web'), stdio: 'inherit' });
    if (r.status !== 0) throw new Error('web build failed');
  }
  const port = +opt('port', '7471');
  const stack = await startStack({ dist, port });
  const target = `http://localhost:${stack.port}/j/QRSC`;
  const png = path.join(runDir, 'scan-qr.png');
  qrPng(target, png);

  // The emulator must be down to change its camera.
  if (sh(ADB, ['devices']).out.includes('emulator-')) { sh(ADB, ['emu', 'kill']); await sleep(8000); }
  const cfg = readFileSync(AVD_CONFIG, 'utf8');
  const posters = readFileSync(POSTERS, 'utf8');
  const restore = () => { writeFileSync(AVD_CONFIG, cfg); writeFileSync(POSTERS, posters); try { unlinkSync(path.join(path.dirname(POSTERS), 'jj-scan-qr.png')); } catch {} };
  writeFileSync(AVD_CONFIG, cfg.replace(/^hw\.camera\.back=.*$/m, 'hw.camera.back=virtualscene'));
  // Both posters (the wall's and the table's) show the QR, so whichever the virtual camera faces reads.
  // The emulator reads poster images from its resources folder (a path outside it isn't picked up).
  const posterFile = path.join(path.dirname(POSTERS), 'jj-scan-qr.png');
  copyFileSync(png, posterFile);
  // The two shipped posters, plus a ring of QR posters 2.2 m out round the camera's start (it faces one of them whichever way the
  // scene's axes run), so a QR is in front of the lens without moving the virtual camera.
  const ring = [[0, -2.2, 0], [0, 2.2, 180], [2.2, 0, 90], [-2.2, 0, -90]].map(([x, z, yaw], i) => `\nposter qr${i}\nsize 1.2 1.2\nposition ${x} 0 ${z}\nrotation 0 ${yaw} 0\ndefault jj-scan-qr.png\n`).join('');
  writeFileSync(POSTERS, posters.replace(/(poster (?:wall|table)[\s\S]*?default )\S+/g, '$1jj-scan-qr.png') + ring);

  const api = { events: async () => stack.events };
  let plat;
  const result = { label: 'Android emulator', qr: target, steps: {} };
  try {
    plat = await androidPlatform({ api, port: stack.port, log, opt });
    result.machine = plat.machine;
    result.target = { ...plat.target, camera: 'virtualscene (QR posters round the lens)' };
    sh(ADB, ['shell', 'pm', 'grant', 'com.android.chrome', 'android.permission.CAMERA']);
    await plat.open(`http://localhost:${stack.port}/`);
    await until('landing page load', () => stack.events.some((e) => e.kind === 'load' && e.data.path === '/'), 90000, 500);
    await plat.settle();
    // A real touch on the Scan button.
    const rect = await plat.evaluate(`(() => { const r = document.getElementById('scan').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    result.steps.scanButton = rect;
    await plat.shot('scan-landing');
    await plat.tap(rect);
    // The camera prompt (Chrome's site permission) is a native dialog: allow it as a player would.
    let allowed = false;
    const joined = until('the page navigating to the room in the QR', async () => {
      if (!allowed) allowed = await plat.allowCamera();
      return stack.events.some((e) => e.kind === 'load' && e.data.path === '/j/QRSC');
    }, 120000, 1500);
    await sleep(1200);
    await plat.shot('scan-open');
    await joined;
    await sleep(1500);
    await plat.shot('scan-joined');
    result.steps.joined = true;
    result.scanner = await plat.evaluate(`(async () => ({ barcodeDetector: typeof BarcodeDetector !== 'undefined', url: location.href }))()`).catch(() => null);
  } catch (e) {
    result.error = String(e.stack || e);
    log('FAILED', e.message);
    await plat?.shot('scan-failure').catch(() => {});
  } finally {
    await plat?.close();
    restore();
    await stack.stop();
  }
  result.pass = !result.error && result.steps.joined === true;
  writeFileSync(path.join(outDir, 'scan-android-run.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`[Android emulator] C04 scan the QR through the virtual-scene camera and join: ${result.pass ? 'PASS' : 'FAIL'} ${result.error ? result.error.split('\n')[0] : target}`);
  process.exit(result.pass ? 0 : 1);
}
main().catch((e) => { console.error(e.stack || e); process.exit(1); });
