// W01/W03: every item fixture runs in the shipped host's testing WASM facade and
// agrees with the actual native jj CLI, including contact physics and expiry.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repo = resolve(import.meta.dirname, '../../..');
test('items: the complete fixture bank matches native hashes in host WASM', { timeout: 120_000 }, async () => {
  const files = (await readdir(join(repo, 'scenarios/items'))).filter((f) => f.endsWith('.json')).sort().map((f) => `scenarios/items/${f}`);
  const [bin, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  const native = JSON.parse(execFileSync(bin, [...args, 'sim', '--json', ...files], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }));
  assert.equal(native.length, files.length);
  const wasm = await import(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing.js'));
  wasm.initSync({ module: await readFile(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing_bg.wasm')) });
  for (const file of files) {
    const fx = JSON.parse(await readFile(join(repo, file), 'utf8'));
    const mapJson = await readFile(join(repo, fx.map), 'utf8');
    const sim = new wasm.HostSim(wasm.encode_init(wasm.canonical_map(mapJson), fx.seed));
    try {
      const cmd = (c) => JSON.parse(sim.test(JSON.stringify(c)));
      cmd({ cmd: 'hold', on: true });
      cmd({ cmd: 'load', fixture: fx, mapJson });
      cmd({ cmd: 'step', ticks: fx.ticks });
      const reference = native.find((o) => o.scenario === fx.scenario);
      assert.ok(reference?.ok && reference.replayMatches, `${fx.scenario}: native envelopes and replay`);
      assert.equal(cmd({ cmd: 'hash' }).stateHash, reference.stateHash, `${fx.scenario}: full native/WASM state`);
      const observed = cmd({ cmd: 'observe' });
      if (fx.scenario === 'sanga-tank-push') assert.ok(observed.cars[0].forwardSpeed >= 13.5);
      if (fx.scenario === 'sanga-ram-immunity') assert.ok(Math.abs(observed.cars[0].headingDeg) < 2);
      if (fx.scenario === 'sanga-solid-terrain') assert.ok(Math.abs(observed.cars[0].forwardSpeed) <= 0.5);
      if (fx.scenario === 'sanga-refresh' || fx.scenario === 'sanga-ends-cleanly') assert.equal(observed.cars[0].sanga, undefined);
      console.log(`${fx.scenario}: native/WASM ${reference.stateHash}`);
    } finally { sim.free(); }
  }
});
