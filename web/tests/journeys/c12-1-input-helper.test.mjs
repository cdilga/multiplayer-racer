// P1-C12.1: the native input helper feeding a real host page through the real join path (loopback WebSocket, pairing,
// LocalSource into the worker). The helper is the real binary (crates/jj-input-helper): on its scripted backend here
// (CI), and on Linux evdev with uinput virtual devices when JJ_HELPER_UINPUT=1 (eris; the desktop never sees the keys:
// the helper grabs them). Device counts are samples, never limits.
//
//   JJ_INPUT_HELPER_BIN   the helper binary (else the workspace debug build, built here if missing)
//   JJ_CAPTURE_DIR        drawer screenshots for the visual self-review
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs, closeContextsAfterEach } from './lib/chromium.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const BASE = '/p/c121/';
const CODE = '135790';
let browser, server, dist;

function helperBin() {
  if (process.env.JJ_INPUT_HELPER_BIN) return process.env.JJ_INPUT_HELPER_BIN;
  const bin = join(process.env.CARGO_TARGET_DIR ?? join(repo, 'target'), 'debug', 'jj-input-helper');
  if (!existsSync(bin)) execFileSync('cargo', ['build', '-q', '-p', 'jj-input-helper'], { cwd: repo, stdio: 'inherit' });
  return bin;
}

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

/** Starts the helper; resolves with its stdin, its status lines and a stopper once it listens. */
async function startHelper(args) {
  const port = await freePort();
  const child = spawn(helperBin(), ['--port', String(port), '--allow-origin', server.origin, '--state', 'none', '--pair-code', CODE, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      lines.push(...String(d).split('\n').filter(Boolean));
      if (lines.some((l) => l.startsWith('Pairing code:'))) resolve();
    });
    child.on('exit', (c) => reject(new Error(`helper exited ${c}: ${err}`)));
  });
  const h = {
    port,
    lines,
    send: (ev) => child.stdin.write(`${JSON.stringify(ev)}\n`),
    stop: () => new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : (child.once('exit', r), child.kill()))),
  };
  helpers.push(h);
  return h;
}

before(async () => {
  dist = build('./', `c121${process.env.JJ_BUILD_SUFFIX ?? ''}`);
  // The image build puts the helper's builds here (docker/jj-server.Dockerfile); the test serves this machine's.
  mkdirSync(join(dist, 'downloads'), { recursive: true });
  copyFileSync(helperBin(), join(dist, 'downloads', 'jj-input-helper-linux-x86_64'));
  writeFileSync(join(dist, 'downloads', 'index.json'), JSON.stringify({ files: ['jj-input-helper-linux-x86_64'] }));
  server = await serve(dist, BASE, { JJ_STUN_URLS: '' });
  browser = await chromium.launch({ args: chromiumArgs });
});
after(async () => { await browser?.close(); await server?.close(); });
closeContextsAfterEach(() => browser);
// Every helper a test started stops after it, passed or failed (a running helper keeps the test process alive).
const helpers = [];
afterEach(async () => { for (const h of helpers.splice(0)) await h.stop(); });

const wait = (p, fn, arg, ms = 60_000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
const observe = (p) => p.evaluate(() => window.__jjTest.observe());
const seats = async (p) => (await observe(p)).host.seats.filter((s) => s.presence !== 'Left');
const carOf = (o, endpoint) => o.cars.find((c) => c.car === o.host.seats.find((s) => s.endpoint === endpoint && s.presence !== 'Left')?.car);
const until = async (p, fn, why, ms = 60_000) => {
  for (const start = Date.now(); !(await fn()); await p.waitForTimeout(100)) assert.ok(Date.now() - start < ms, why);
};
const shot = async (p, name) => {
  if (!process.env.JJ_CAPTURE_DIR) return;
  mkdirSync(process.env.JJ_CAPTURE_DIR, { recursive: true });
  await p.locator('[data-input-helper]').scrollIntoViewIfNeeded();
  await p.screenshot({ path: join(process.env.JJ_CAPTURE_DIR, `${name}.png`) });
};

async function hostPage(port, viewport = { width: 1366, height: 768 }) {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on('pageerror', (e) => console.error('C12.1 host error:', e.message));
  await p.goto(`${server.origin}${BASE}host?drive&test=live&helperPort=${port}`);
  await wait(p, () => window.__jjNet?.code() && window.__jjTest, undefined, 180_000);
  return p;
}

async function pair(p) {
  const panel = p.locator('[data-input-helper]');
  await panel.locator('button[data-act="helper-connect"]').click();
  await wait(p, () => document.querySelector('[data-input-helper]')?.dataset.helperState === 'pairing');
  return panel;
}

/** Holds one key on each of two keyboards and checks both cars got their own input (no crossing). */
async function drives(p, a, b, why) {
  await until(p, async () => {
    const o = await observe(p);
    const ca = carOf(o, `local:${a.source}`), cb = carOf(o, `local:${b.source}`);
    return ca && cb && ca.autopilot == null && cb.autopilot == null && ca.input.throttle > 0.9 && cb.input.brake > 0.9;
  }, why);
}

test('a helper with two keyboards gives two seats on two cars with the same layout; the browser cluster stands down; Install links this OS\'s build from our server', { timeout: 300_000 }, async () => {
  const helper = await startHelper(['--backend', 'stdin']);
  const host = await hostPage(helper.port);
  const panel = host.locator('[data-input-helper]');
  await wait(host, () => document.querySelector('[data-input-helper] [data-mine]'));
  // AC3: not installed: the Install action links this visitor's OS build, served by our own server.
  assert.equal(await panel.getAttribute('data-helper-state'), 'off');
  const href = await panel.locator('[data-mine]').getAttribute('href');
  assert.equal(href, `${BASE}downloads/jj-input-helper-linux-x86_64`);
  const dl = await host.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, disposition: r.headers.get('content-disposition'), size: (await r.arrayBuffer()).byteLength };
  }, href);
  assert.deepEqual(dl, { status: 200, disposition: 'attachment; filename="jj-input-helper-linux-x86_64"', size: readFileSync(helperBin()).length });
  await shot(host, 'helper-not-installed');

  // Pairing: a wrong code is refused (and said so); the code the helper's window shows pairs.
  await pair(host);
  assert.ok(helper.lines.includes(`Pairing code: ${CODE} (type it into the game's Keys & pads drawer)`), helper.lines.join('\n'));
  await panel.locator('[data-helper-code]').fill('000000');
  await panel.locator('button[data-act="helper-pair"]').click();
  await panel.locator('.dr-error').waitFor();
  await shot(host, 'helper-pairing-wrong-code');
  await panel.locator('[data-helper-code]').fill(CODE);
  await panel.locator('[data-helper-code]').press('Enter');
  await wait(host, () => document.querySelector('[data-input-helper]')?.dataset.helperState === 'paired');
  assert.ok(await host.evaluate(() => !!localStorage.getItem('jj.inputHelperToken')), 'the pairing is kept for next time');

  // Two keyboards and six pads (samples) on the scripted backend.
  const kb = [1, 2].map((h) => ({ handle: h, name: `Keyboard ${h === 1 ? 'left' : 'right'}` }));
  for (const k of kb) helper.send({ e: 'added', handle: k.handle, stable: `kbd${k.handle}`, kind: 'keyboard', name: k.name });
  for (let i = 0; i < 6; i++) helper.send({ e: 'added', handle: 10 + i, stable: `pad${i}`, kind: 'pad', name: `Pad model ${i + 1}` });
  await wait(host, () => document.querySelectorAll('[data-input-helper] [data-helper-device][data-connected="true"]').length === 8);
  assert.match(await panel.innerText(), /2 keyboards and 6 pads/);
  await until(host, () => helper.lines.some((l) => l.startsWith('Capturing 2 keyboards and 6 pads')), 'the helper says what it captures');
  await wait(host, () => document.querySelectorAll('[data-jj-input-drawer] li[data-helper]').length === 8);
  const helperRows = await host.locator('[data-jj-input-drawer] li[data-helper]').evaluateAll((els) => els.map((e) => [Number(e.dataset.source), e.dataset.kind]));
  assert.equal(helperRows.length, 8, `eight helper sources: ${JSON.stringify(helperRows)}`);
  assert.equal(new Set(helperRows.map(([s]) => s)).size, 8);
  await shot(host, 'helper-connected-devices');

  // The same W on both keyboards: each keyboard's keys drive only its own car (left holds W, right holds S, then swap).
  const [a, b] = [{ source: 1001 }, { source: 1002 }];
  helper.send({ e: 'key', handle: 1, code: 'KeyW', down: true });
  helper.send({ e: 'key', handle: 2, code: 'KeyS', down: true });
  await until(host, async () => (await seats(host)).filter((s) => /^local:100[12]$/.test(s.endpoint)).length === 2, 'two keyboards, two seats');
  await drives(host, a, b, 'left keyboard throttles its car, right keyboard brakes its own');
  helper.send({ e: 'key', handle: 1, code: 'KeyW', down: false });
  helper.send({ e: 'key', handle: 2, code: 'KeyS', down: false });
  helper.send({ e: 'key', handle: 2, code: 'KeyW', down: true });
  helper.send({ e: 'key', handle: 1, code: 'KeyS', down: true });
  await drives(host, b, a, 'swapped: the same keys, the other car each');
  const o = await observe(host);
  assert.notEqual(carOf(o, 'local:1001').car, carOf(o, 'local:1002').car, 'two cars');

  // No double input: the browser's own copy of the keys drives nothing while the helper has the keyboards.
  await host.keyboard.down('KeyW');
  await host.keyboard.down('KeyI');
  await host.waitForTimeout(1200);
  const extra = (await seats(host)).filter((s) => s.endpoint === 'local:1' || s.endpoint === 'local:2');
  assert.deepEqual(extra, [], 'Keys A and Keys B claim nothing while the helper owns the keyboards');
  assert.equal(await host.locator('[data-jj-input-drawer] li[data-source="1"]').getAttribute('data-state'), 'the input helper has these');
  await host.keyboard.up('KeyW');
  await host.keyboard.up('KeyI');
  // Host UI keys still reach the page (Escape opens the host menu in a room; here: the key isn't swallowed).
  assert.equal(await host.evaluate(() => { const e = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', cancelable: true }); dispatchEvent(e); return e.defaultPrevented; }), false);

  // Unplugging the right keyboard affects only its seat: its car goes to the autopilot, the left one keeps driving.
  helper.send({ e: 'removed', handle: 2 });
  await until(host, async () => {
    const o2 = await observe(host);
    return carOf(o2, 'local:1002')?.autopilot != null && carOf(o2, 'local:1001')?.autopilot == null && carOf(o2, 'local:1001').input.brake > 0.9;
  }, 'only the unplugged keyboard\'s car autopilots');
  await shot(host, 'helper-keyboard-unplugged');

  // The helper stops capturing when the page goes, and says so.
  await host.context().close();
  await until({ waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)) }, () => helper.lines.at(-1) === 'Not capturing: no game page is paired.', 'capture stops with the page');
  await helper.stop();
});

test('phone-sized host: the helper block stays inside the drawer', { timeout: 240_000 }, async () => {
  const helper = await startHelper(['--backend', 'stdin']);
  const host = await hostPage(helper.port, { width: 412, height: 915 });
  await wait(host, () => document.querySelector('[data-input-helper] [data-mine]'));
  assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'no horizontal overflow');
  await shot(host, 'helper-not-installed-phone');
  await pair(host);
  await host.locator('[data-helper-code]').fill(CODE);
  await host.locator('button[data-act="helper-pair"]').click();
  await wait(host, () => document.querySelector('[data-input-helper]')?.dataset.helperState === 'paired');
  for (let i = 0; i < 3; i++) helper.send({ e: 'added', handle: i + 1, stable: `d${i}`, kind: i ? 'pad' : 'keyboard', name: `Device ${i + 1} with a fairly long product name` });
  await wait(host, () => document.querySelectorAll('[data-input-helper] [data-helper-device]').length === 3);
  assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'no horizontal overflow when paired');
  await shot(host, 'helper-connected-phone');
  await helper.stop();
});

test('TV-sized host with no helper running: Connect keeps looking and says how to start it', { timeout: 240_000 }, async () => {
  const host = await hostPage(await freePort(), { width: 1920, height: 1080 });
  await wait(host, () => document.querySelector('[data-input-helper] [data-mine]'));
  await host.locator('[data-input-helper] button[data-act="helper-connect"]').click();
  await wait(host, () => document.querySelector('[data-input-helper]')?.dataset.helperState === 'absent');
  assert.match(await host.locator('[data-input-helper]').innerText(), /Looking for the input helper/);
  await shot(host, 'helper-looking-tv');
  await host.locator('[data-input-helper] button[data-act="helper-off"]').click();
  await wait(host, () => document.querySelector('[data-input-helper]')?.dataset.helperState === 'off');
});

// eris: the real Linux backend reading uinput virtual devices (two keyboards, five pads: past Chromium's four slots).
test('real evdev devices: two virtual keyboards and five virtual pads are seven seats', { timeout: 300_000, skip: process.env.JJ_HELPER_UINPUT !== '1' && 'needs /dev/uinput and python-evdev (JJ_HELPER_UINPUT=1, eris)' }, async () => {
  const prefix = `jj-c121-${process.pid}`;
  const rig = spawn('python3', [join(here, 'lib', 'uinput-devices.py'), prefix, '2', '5'], { stdio: ['pipe', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { rig.stdout.once('data', (d) => (String(d).includes('ready') ? resolve() : reject(new Error(String(d))))); rig.once('exit', (c) => reject(new Error(`rig exited ${c}`))); });
  const cmd = (line) => rig.stdin.write(`${line}\n`);
  const helper = await startHelper(['--only', prefix, '--grab']);
  try {
    const host = await hostPage(helper.port);
    await pair(host);
    await host.locator('[data-helper-code]').fill(CODE);
    await host.locator('button[data-act="helper-pair"]').click();
    await wait(host, () => document.querySelectorAll('[data-input-helper] [data-helper-device][data-connected="true"]').length === 7, undefined, 30_000);
    // Every device presses once: keyboards W, pads full forward on the left stick.
    for (const k of [1, 2]) cmd(`key ${k} KEY_W 1`);
    for (let i = 1; i <= 5; i++) cmd(`abs ${i} ABS_Y -32768`);
    await until(host, async () => (await seats(host)).filter((s) => /^local:10\d\d$/.test(s.endpoint)).length === 7, 'seven devices, seven seats');
    await until(host, async () => {
      const o = await observe(host);
      return o.host.seats.filter((s) => /^local:10\d\d$/.test(s.endpoint)).every((s) => o.cars.find((c) => c.car === s.car)?.input.throttle > 0.9);
    }, 'every device drives its own car');
    await shot(host, 'helper-real-evdev-seven');
    // Unplug pad 5: only its car goes to the autopilot.
    const before = await observe(host);
    const pads = before.host.seats.filter((s) => /^local:10\d\d$/.test(s.endpoint));
    cmd('unplug pad 5');
    await until(host, async () => {
      const o = await observe(host);
      const auto = pads.filter((s) => o.cars.find((c) => c.car === s.car)?.autopilot != null);
      return auto.length === 1;
    }, 'one unplugged pad, one autopilot');
    console.log(`C12.1 real evdev: ${helper.lines.filter((l) => l.startsWith('Capturing')).at(-1)}`);
  } finally {
    rig.stdin.end();
    await helper.stop();
  }
});
