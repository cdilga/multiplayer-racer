// The journey lane preflight (P1-F10, plan §13.1): which lanes exist on THIS run, labelled honestly. A lane that couldn't
// run is reported as unavailable with the reason, never claimed. `node web/tests/journeys/harness/lanes.mjs [--json out]`.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000, ...o });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

export const AVD = process.env.JJ_ANDROID_AVD ?? 'jj-ctrl-api37-play';
export const SDK = path.join(os.homedir(), 'Android/Sdk');
export const ADB = path.join(SDK, 'platform-tools/adb');
export const EMULATOR = path.join(SDK, 'emulator/emulator');

/** The machine this run is on (what a receipt names). */
export function machine() {
  const cpu = os.cpus()[0]?.model ?? 'unknown cpu';
  return { host: os.hostname(), platform: `${os.platform()}/${os.arch()}`, kernel: sh('uname', ['-sr']).out, cpu, cpus: os.cpus().length, memGiB: Math.round(os.totalmem() / 2 ** 30) };
}

async function playwrightLane(id, label, browserType) {
  try {
    const { chromium, webkit, firefox } = await import('playwright');
    const type = { chromium, webkit, firefox }[browserType];
    const exe = type.executablePath();
    if (exe && existsSync(exe)) return { id, label, available: true, executable: exe };
    // A headless run may use Playwright's headless shell instead of the full browser (the CI image ships only that), so a
    // missing full binary isn't proof: a launch is.
    try {
      const b = await type.launch();
      const version = b.version();
      await b.close();
      return { id, label, available: true, executable: `${browserType} (Playwright default, ${version})` };
    } catch {
      return { id, label, available: false, reason: `${browserType} isn't installed for Playwright here (${exe || 'no path'})` };
    }
  } catch (e) {
    return { id, label, available: false, reason: e.message.split('\n')[0] };
  }
}

function androidLane() {
  const id = 'android-emulator';
  const label = 'Android emulator';
  if (!existsSync(EMULATOR) || !existsSync(ADB)) return { id, label, available: false, reason: `no Android SDK at ${SDK} on this machine` };
  const avds = sh(EMULATOR, ['-list-avds']).out.split('\n');
  if (!avds.includes(AVD)) return { id, label, available: false, reason: `AVD ${AVD} not found (have: ${avds.filter(Boolean).join(', ') || 'none'})` };
  if (os.platform() === 'linux' && !existsSync('/dev/kvm')) return { id, label, available: false, reason: 'no /dev/kvm: the emulator would be unusably slow' };
  return { id, label, available: true, avd: AVD };
}

function iosLane() {
  const id = 'ios-simulator';
  const label = 'iOS Simulator';
  if (os.platform() !== 'darwin') return { id, label, available: false, reason: 'iOS Simulator runs on macOS only' };
  const r = sh('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
  if (r.code !== 0) return { id, label, available: false, reason: `xcrun simctl failed: ${r.err.split('\n')[0]}` };
  try {
    const devices = Object.entries(JSON.parse(r.out).devices)
      .flatMap(([rt, ds]) => ds.map((d) => ({ ...d, runtime: rt })))
      .filter((d) => /iphone/i.test(d.name));
    if (!devices.length) return { id, label, available: false, reason: 'no iPhone simulator device is available' };
    return { id, label, available: true, device: devices[0].name, udid: devices[0].udid, runtime: devices[0].runtime.replace(/.*SimRuntime\./, '') };
  } catch (e) {
    return { id, label, available: false, reason: e.message };
  }
}

function macChromeLane() {
  const id = 'macos-chrome-headed';
  const label = 'macOS Chrome headed (real GPU)';
  const app = '/Applications/Google Chrome.app';
  if (os.platform() !== 'darwin') return { id, label, available: false, reason: 'macOS only' };
  return existsSync(app)
    ? { id, label, available: true, note: 'perf receipt and judged captures only; an owner step, never run unattended (keep the Mac light)' }
    : { id, label, available: false, reason: `${app} not found` };
}

/** Every §13.1 lane with its availability on this machine. */
export async function preflight() {
  const lanes = [
    await playwrightLane('chromium', `Chromium (${os.platform()}, Playwright)`, 'chromium'),
    await playwrightLane('webkit', 'WebKit (Playwright; not Safari)', 'webkit'),
    await playwrightLane('firefox', 'Firefox (Playwright)', 'firefox'),
    iosLane(),
    androidLane(),
    macChromeLane(),
    { id: 'macos-safari', label: 'macOS Safari', available: false, reason: 'no lane: the owner checks it in Q02' },
    { id: 'windows', label: 'Windows browsers', available: false, reason: 'no lane: the owner checks them in Q02' },
    { id: 'real-devices', label: 'Real phones, pads and the TCL', available: false, reason: 'no lane: owner playtests' },
  ];
  return { takenAt: new Date().toISOString(), machine: machine(), lanes };
}

export function formatReport(r) {
  const w = Math.max(...r.lanes.map((l) => l.id.length));
  return [
    `lanes on ${r.machine.host} (${r.machine.platform}, ${r.machine.cpu})`,
    ...r.lanes.map((l) => `  ${l.available ? 'available  ' : 'unavailable'} ${l.id.padEnd(w)}  ${l.label}${l.available ? '' : `: ${l.reason}`}`),
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await preflight();
  console.log(formatReport(r));
  const i = process.argv.indexOf('--json');
  if (i > 0) writeFileSync(process.argv[i + 1], `${JSON.stringify(r, null, 2)}\n`);
}
