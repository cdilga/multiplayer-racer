#!/usr/bin/env node
// P1-F08: what the iOS Simulator can show without a host. Runs on the Mac, no browser on the Mac. The lane's
// own server serves (a) a sticks fixture (NOT the controller) for the two-finger / no-zoom / no-scroll engine check and
// the background -> foreground check, and (b) a clip decoder page that decodes every shipped clip (A03/A07).
//   node scripts/emulators/ios-local.mjs [--out docs/evidence/P1-F08] [--dist web/dist-test/f08] [--repeat 2]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iosPlatform } from './lib/platform-ios.mjs';
import { sleep, startStack, until } from './lib/stack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const log = (...a) => console.error('[ios-local]', ...a);
const outDir = path.resolve(opt('out', path.join(here, '../../docs/evidence/P1-F08')));
const dist = path.resolve(here, '../..', opt('dist', 'web/dist-test/f08'));
mkdirSync(outDir, { recursive: true });
const o = (n, d) => (n === 'out' ? outDir : opt(n, d));

async function run(n) {
  const st = await startStack({ dist });
  const base = `http://localhost:${st.port}`;
  const api = { events: () => fetch(base + '/__lane/events').then((r) => r.json()) };
  const plat = await iosPlatform({ api, port: st.port, log, opt: o });
  const R = { label: plat.label, machine: { ...plat.machine, stack: 'jj-server + lane proxy on the Mac (no host: no browser on the Mac)' }, target: plat.target, run: n, startedAt: new Date().toISOString() };
  try {
    // 1. Two fingers on the sticks fixture.
    await plat.open(`${base}/__lane/fixture-sticks.html`);
    await until('rects', async () => (await api.events()).some((e) => e.kind === 'rects' && e.data.drive), 20000);
    const rects = (await api.events()).filter((e) => e.kind === 'rects').at(-1).data;
    const c = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const A = c(rects.drive), B = c(rects.action);
    await plat.holdTwo([{ from: A, to: { x: A.x - 40, y: A.y - 60 } }, { from: B, to: { x: B.x + 60, y: B.y } }], 3500);
    await sleep(1200);
    const ev = await api.events();
    const ts = ev.filter((e) => e.kind === 'touch-summary').at(-1).data, ctl = ev.filter((e) => e.kind === 'ctl').at(-1)?.data;
    R.twoFinger = {
      fixtureNotController: true, rects: { drive: rects.drive, action: rects.action, viewport: `${rects.vw}x${rects.vh}` },
      zoneDown: ts.zoneDown, downs: ts.downs, fingers: { A, B }, bothZonesAtOnce: ts.bothZonesAtOnce, maxSimultaneousTouches: ts.maxSimultaneousTouches, maxSimultaneousPointers: ts.maxSimultaneousPointers,
      maxStick: ctl?.maxStick, visualViewportScale: { min: ctl?.vvMin, max: ctl?.vvMax }, scrollMax: ctl?.scrollMax,
    };
    R.twoFinger.pass = !!(ts.bothZonesAtOnce && ts.maxSimultaneousPointers >= 2 && ctl?.maxStick.steer > 0.3 && ctl?.maxStick.throttle > 0.3 && ctl.vvMin === 1 && ctl.vvMax === 1 && ctl.scrollMax === 0);
    await plat.shot('local-sticks');
    // 2. Background -> foreground.
    const before = (await api.events()).length;
    await plat.background();
    await until('hidden', async () => (await api.events()).slice(before).some((e) => e.kind === 'hidden'), 20000);
    await sleep(1500);
    await plat.foreground();
    const vis = await until('visible', async () => (await api.events()).slice(before).find((e) => e.kind === 'visible-after-hidden'), 40000);
    const hid = (await api.events()).slice(before).find((e) => e.kind === 'hidden');
    R.visibility = { events: (await api.events()).slice(before).filter((e) => ['hidden', 'pagehide', 'visible-after-hidden'].includes(e.kind)).map((e) => e.kind), hiddenToVisibleMs: vis.at - hid.at, pass: true };
    // 3. Clips.
    await plat.open(`${base}/__lane/fixture-clips.html`, 'clips');
    const clips = (await until('clips', async () => (await api.events()).find((e) => e.kind === 'clips'), 180000, 1000)).data;
    R.clips = { total: clips.total, failed: clips.failed, canPlayType: clips.canPlayType, failures: clips.results.filter((r) => !r.ok), sample: clips.results.slice(0, 3), pass: clips.total > 0 && clips.failed === 0 };
  } catch (e) { R.error = String(e.stack || e) + ' cause=' + String(e.cause?.stack || e.cause); log('FAILED', e.message, String(e.cause)); }
  finally { await plat.close(); await st.stop(); }
  R.finishedAt = new Date().toISOString();
  writeFileSync(path.join(outDir, `ios-local-run${n}.json`), JSON.stringify(R, null, 2) + '\n');
  const p = (b) => (b ? 'PASS' : 'FAIL');
  console.log(`[${R.label}] run ${n} ${Object.entries(R.target).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (R.error) console.log(`[${R.label}] run ${n}: ERROR ${R.error.split('\n')[0]}`);
  else {
    console.log(`[${R.label}] run ${n}: two-finger sticks (fixture): ${p(R.twoFinger.pass)} ${JSON.stringify(R.twoFinger)}`);
    console.log(`[${R.label}] run ${n}: background/foreground: ${p(R.visibility.pass)} ${R.visibility.events.join(' -> ')}`);
    console.log(`[${R.label}] run ${n}: shipped clips decode: ${p(R.clips.pass)} ${R.clips.total - R.clips.failed}/${R.clips.total} decoded; canPlayType=${JSON.stringify(R.clips.canPlayType)}`);
  }
  return !R.error && R.twoFinger.pass && R.clips.pass;
}
let ok = true;
for (let n = 1; n <= +opt('repeat', '1'); n++) ok = (await run(n)) && ok;
process.exit(ok ? 0 : 1);
