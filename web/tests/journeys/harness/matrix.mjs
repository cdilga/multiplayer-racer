#!/usr/bin/env node
// The milestone platform matrix (P1-F10, plan §13.1), run by `scripts/beads/batch-verify.sh run --matrix milestone`: the F10 demo
// journey in every lane this machine has, each lane recorded with its label and machine; a lane that couldn't run says so and
// why. Writes docs/evidence/P1-F10/matrix-<host>-<stamp>.json (override the folder with JJ_EVIDENCE_DIR).
//
//   node web/tests/journeys/harness/matrix.mjs [--tier every-wave|milestone]
//
// Lanes (§13.1): Chromium (every wave and milestone), WebKit (controllers; milestone), Firefox (milestone only), the Android
// emulator and the iOS Simulator (milestone). Before any demo runs, a one-phone WebRTC probe decides whether this machine can
// connect two browsers over loopback at all: where it can't (a Mac blocking local UDP), every WebRTC lane here is reported
// unavailable with that reason instead of timing out ten times.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatReport, machine, preflight } from './lanes.mjs';

const here = import.meta.dirname;
const web = resolve(here, '../../..');
const repo = resolve(web, '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const tier = arg('--tier', 'milestone');
const EVIDENCE = process.env.JJ_EVIDENCE_DIR ?? join(repo, 'docs/evidence/P1-F10');
mkdirSync(EVIDENCE, { recursive: true });

/** Can two browsers on this machine connect over WebRTC at all? (Chromium host, one Chromium phone, the hello room.) */
async function loopbackProbe() {
  const { chromium } = await import('playwright');
  const { build, serve } = await import(join(web, 'landing/tests/lib/site.mjs'));
  const { chromiumArgs } = await import('./../lib/chromium.mjs');
  const server = await serve(build('./', 'f10probe'), '/p/f10probe/', { JJ_STUN_URLS: '' });
  const browser = await chromium.launch({ args: chromiumArgs });
  try {
    const host = await (await browser.newContext()).newPage();
    await host.goto(`${server.origin}/p/f10probe/host?hello`);
    await host.waitForFunction(() => window.__jjHello?.code(), undefined, { timeout: 60_000 });
    const code = await host.evaluate(() => window.__jjHello.code());
    const phone = await (await browser.newContext({ hasTouch: true, isMobile: true })).newPage();
    await phone.goto(`${server.origin}/p/f10probe/j/${code}?hello`);
    try {
      await phone.waitForFunction(() => window.__jjHello?.link().state === 'connected', undefined, { timeout: 30_000 });
      return { ok: true };
    } catch {
      const l = await phone.evaluate(() => window.__jjHello?.link());
      return { ok: false, why: `a Chromium phone never connected to a Chromium host over loopback WebRTC (ice ${l?.ice}, pc ${l?.pc}, link ${l?.state}); WebRTC journeys run on eris` };
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

function runDemo(env, name) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--test', join(here, '../f10-hello-demo.test.mjs')], {
    cwd: web,
    env: { ...process.env, JJ_EVIDENCE_DIR: EVIDENCE, ...env },
    encoding: 'utf8',
    timeout: 1_500_000,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  const failed = out.split('\n').find((l) => /AssertionError|TimeoutError|Error:/.test(l));
  const receipt = join(EVIDENCE, `demo-${name}.json`);
  return {
    status: r.status === 0 ? 'passed' : 'failed',
    seconds: Math.round((Date.now() - t0) / 1000),
    ...(r.status === 0 ? { receipt: `demo-${name}.json`, peak: JSON.parse(readFileSync(receipt, 'utf8')).peak } : { reason: (failed ?? out.trim().split('\n').slice(-3).join(' ')).trim().slice(0, 400) }),
  };
}

const pre = await preflight();
console.log(formatReport(pre));
const byId = Object.fromEntries(pre.lanes.map((l) => [l.id, l]));
const probe = await loopbackProbe().catch((e) => ({ ok: false, why: `the loopback probe itself failed: ${e.message.split('\n')[0]}` }));
console.log(probe.ok ? 'loopback WebRTC: connects' : `loopback WebRTC: ${probe.why}`);

const plan = [
  { id: 'chromium', when: ['every-wave', 'milestone'], env: { JJ_LANE: 'chromium' }, name: 'chromium', needs: 'chromium' },
  { id: 'webkit', when: ['every-wave', 'milestone'], env: { JJ_LANE: 'webkit' }, name: 'webkit', needs: 'webkit' },
  { id: 'firefox', when: ['milestone'], env: { JJ_LANE: 'firefox' }, name: 'firefox', needs: 'firefox' },
  { id: 'android-emulator', when: ['milestone'], env: { JJ_LANE: 'chromium', JJ_EMULATORS: 'android' }, name: 'chromium+android', needs: 'android-emulator' },
  { id: 'ios-simulator', when: ['milestone'], env: { JJ_LANE: 'chromium', JJ_EMULATORS: 'ios' }, name: 'chromium+ios', needs: 'ios-simulator' },
];
const results = [];
for (const lane of plan) {
  const l = byId[lane.needs];
  const base = { lane: lane.id, label: l.label, machine: machine().host };
  if (!lane.when.includes(tier)) results.push({ ...base, status: 'not-in-tier', reason: `${lane.id} runs at ${lane.when.join(' and ')}` });
  else if (!l.available) results.push({ ...base, status: 'unavailable', reason: l.reason });
  else if (!probe.ok) results.push({ ...base, status: 'unavailable', reason: probe.why });
  else results.push({ ...base, ...runDemo(lane.env, lane.name), ...(l.avd ? { avd: l.avd } : {}), ...(l.device ? { device: l.device, runtime: l.runtime } : {}) });
  console.log(`${results.at(-1).status.padEnd(12)} ${lane.id}${results.at(-1).reason ? `: ${results.at(-1).reason}` : ''}`);
}
const receipt = { journey: 'F10 demo on the G00 hello room, per lane', tier, takenAt: new Date().toISOString(), machine: machine(), loopback: probe, preflight: pre.lanes.map(({ id, label, available, reason }) => ({ id, label, available, ...(reason ? { reason } : {}) })), lanes: results };
const file = join(EVIDENCE, `matrix-${machine().host.replace(/\..*/, '')}-${tier}.json`);
writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`receipt: ${file}`);
process.exitCode = results.some((r) => r.status === 'failed') ? 1 : 0;
