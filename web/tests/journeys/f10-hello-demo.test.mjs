// P1-F10's demo journey on the G00 hello room: the room grows to 12 mixed controllers (10 Playwright phones, one emulated pad, one
// emulator) and shrinks back to 2, with joins and leaves in the middle of it, and after every step the host's markers are exactly
// the controllers that are in the room (no phantom marker, none missing). Each controller has its own browser context and evidence
// folder. The lane is chosen by the environment so one file serves the matrix:
//   JJ_LANE=chromium|webkit|firefox   the engine the phones and the pad run on (default chromium)
//   JJ_EMULATORS=android,ios          which emulator joins (the lane must exist on this machine; none by default)
//   JJ_EVIDENCE_DIR                   default docs/evidence/P1-F10
//   node --test web/tests/journeys/f10-hello-demo.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import playwright from 'playwright';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from './lib/chromium.mjs';
import { ControllerPool } from './harness/controllers.mjs';
import { machine, preflight } from './harness/lanes.mjs';

const LANE = process.env.JJ_LANE ?? 'chromium';
const EMULATORS = (process.env.JJ_EMULATORS ?? '').split(',').filter(Boolean);
const NAME = [LANE, ...EMULATORS].join('+');
const ID = `f10${LANE}`;
const BASE = `/p/${ID}/`;
const EVIDENCE = process.env.JJ_EVIDENCE_DIR ?? resolve(import.meta.dirname, '../../../docs/evidence/P1-F10');
let browser; // the controllers' engine
let hostBrowser; // the host page: Chromium always (WebKit and Firefox are controller lanes, the host runs smoke elsewhere)
let server;
let report;

before(async () => {
  report = await preflight();
  const lane = report.lanes.find((l) => l.id === LANE);
  assert.ok(lane?.available, `lane ${LANE} isn't available here: ${lane?.reason}`);
  server = await serve(build('./', ID), BASE, { JJ_STUN_URLS: '' });
  hostBrowser = await playwright.chromium.launch({ args: chromiumArgs });
  browser = LANE === 'chromium' ? hostBrowser : await playwright[LANE].launch();
  mkdirSync(EVIDENCE, { recursive: true });
});
after(async () => {
  if (browser !== hostBrowser) await browser?.close();
  await hostBrowser?.close();
  await server?.close();
});

test(`F10 demo (${NAME}): the hello room grows to 12 mixed controllers and back to 2, with churn, and the host never shows a phantom`, { timeout: 900_000 }, async () => {
  const hostCtx = await hostBrowser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostCtx.newPage();
  const errors = [];
  host.on('pageerror', (e) => errors.push(e.message));
  await host.goto(`${server.origin}${BASE}host?hello`);
  await host.waitForFunction(() => window.__jjHello?.code(), undefined, { timeout: 90_000 });
  const evidence = join(EVIDENCE, `demo-${NAME}`);
  mkdirSync(evidence, { recursive: true });
  const port = Number(new URL(server.origin).port);
  const pool = new ControllerPool({
    base: `${server.origin}${BASE}`,
    host,
    browsers: { [LANE]: browser },
    engine: LANE,
    evidence,
    port,
    emulators: { ios: report.lanes.find((l) => l.id === 'ios-simulator') },
    log: (m) => console.log(`# ${m}`),
  });

  const steps = [];
  const checkpoint = async (label) => {
    const r = await pool.check();
    steps.push({ label, ...r, kinds: [...pool.live.values()].map((c) => c.kind) });
    console.log(`# ${label}: ${r.live} in the room, ${r.markers} markers${r.ok ? '' : ` PHANTOM ${r.phantoms} MISSING ${r.missingAre}`}`);
    assert.ok(r.ok, `${label}: phantoms ${JSON.stringify(r.phantoms)}, missing ${JSON.stringify(r.missingAre)}`);
  };
  const moveSome = async (cs) => {
    for (const [i, c] of cs.entries()) await pool.stick(c, i % 2 ? 0.6 : -0.6, i % 3 ? 0.4 : -0.4);
  };
  const phones = [];
  const emulators = [];
  let pad;

  // Grow: four phones, then a pad and two more phones with two phones leaving in the middle of it.
  for (let i = 0; i < 4; i++) phones.push(await pool.add('phone'));
  await checkpoint('4 phones');
  await moveSome(phones);
  pad = await pool.add('pad');
  phones.push(await pool.add('phone'));
  await pool.remove(phones.shift());
  phones.push(await pool.add('phone'));
  await pool.remove(phones.shift());
  await checkpoint('pad + churn (5 in the room)');
  // The emulators join mid-session.
  for (const kind of EMULATORS) {
    if (!report.lanes.find((l) => l.id === (kind === 'android' ? 'android-emulator' : 'ios-simulator'))?.available) continue;
    emulators.push(await pool.add(kind));
    await checkpoint(`${kind} emulator joined`);
  }
  // Grow to 12 (10 phones, 1 pad, 1 emulator when there is one; otherwise one more phone stands in and the receipt says so).
  while (phones.length < 10) phones.push(await pool.add('phone'));
  const target = 10 + 1 + EMULATORS.length;
  while (pool.size < Math.max(12, target)) phones.push(await pool.add('phone'));
  await checkpoint(`${pool.size} controllers`);
  assert.ok(pool.size >= 12, 'the room reached 12');
  await moveSome([...phones.slice(0, 3), pad, ...emulators]);

  // Shrink to 2 with joins in the middle.
  for (let i = 0; i < 4; i++) await pool.remove(phones.shift());
  await checkpoint('4 phones left');
  phones.push(await pool.add('phone'));
  for (const e of emulators.splice(0)) await pool.remove(e);
  await pool.remove(pad);
  await checkpoint('emulators and pad left');
  while (pool.size > 2) await pool.remove(phones.shift());
  await checkpoint('down to 2');
  assert.equal(pool.size, 2);
  assert.deepEqual(errors, []);

  const receipt = {
    journey: 'F10 demo on the G00 hello room',
    lane: LANE,
    laneLabel: report.lanes.find((l) => l.id === LANE).label,
    machine: machine(),
    hostEngine: 'Chromium (Playwright)',
    controllerEngine: report.lanes.find((l) => l.id === LANE).label,
    emulators: EMULATORS.length ? [...pool.timeline.filter((t) => t.op === 'add' && /emulator|simulator/i.test(t.engine)).map((t) => t.engine)] : 'none requested (the emulator lanes are separate receipts)',
    peak: Math.max(...pool.timeline.map((t) => t.size)),
    finalSize: pool.size,
    steps,
    timeline: pool.timeline.map(({ op, id, kind, engine, size }) => ({ op, id, kind, engine, size })),
    takenAt: new Date().toISOString(),
  };
  writeFileSync(join(EVIDENCE, `demo-${NAME}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  await pool.closeAll();
});
