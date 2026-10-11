// br-bwju.4: raw sticks and bike-named damage through the shipped WASM core's host fixture surface.
// Evidence is opt-in: JJ_EVIDENCE_DIR=<dir>; default runs leave committed receipts untouched.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const read = p => readFileSync(join(root, p), 'utf8');
const wasm = await import(join(root, 'web/host/src/testing/pkg/jj_wasm_host_testing.js'));
wasm.initSync({ module: readFileSync(join(root, 'web/host/src/testing/pkg/jj_wasm_host_testing_bg.wasm')) });

for (const name of ['controls', 'damage']) {
  test(`bike ${name}: native journal and WASM host agree bit for bit`, async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'jj-bike-parity-'));
    const fixturePath = `scenarios/bikes/${name}.json`;
    const fixture = JSON.parse(read(fixturePath));
    const mapJson = read(fixture.map);
    const profileJson = read('scenarios/bikes/profile.json');
    const [bin, ...prefix] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
    let sim;
    try {
      const [native] = JSON.parse(execFileSync(bin, [...prefix, 'sim', '--json', '--profile', 'scenarios/bikes/profile.json', '--out', scratch, fixturePath], { cwd: root, encoding: 'utf8' }));
      assert.equal(native.ok, true);
      assert.equal(native.replayMatches, true);
      sim = new wasm.HostSim(wasm.encode_init(wasm.canonical_map(mapJson), fixture.seed));
      const cmd = c => JSON.parse(sim.test(JSON.stringify(c)));
      cmd({ cmd: 'hold', on: true });
      cmd({ cmd: 'load', fixture, mapJson, profileJson });
      cmd({ cmd: 'step', ticks: fixture.ticks });
      const hash = cmd({ cmd: 'hash' });
      const outcome = cmd({ cmd: 'outcome' });
      const state = cmd({ cmd: 'observe' });
      assert.equal(hash.stateHash, native.stateHash);
      assert.ok(outcome.checks.every(c => c.ok));
      assert.equal(state.cars[0].wheels.length, 2);
      assert.deepEqual(state.cars[0].parts.map(p => p.part), ['core', 'front', 'back', 'rider', 'wheel_F', 'wheel_R']);
      if (process.env.JJ_EVIDENCE_DIR) {
        mkdirSync(process.env.JJ_EVIDENCE_DIR, { recursive: true });
        writeFileSync(join(process.env.JJ_EVIDENCE_DIR, `${name}-wasm.json`), JSON.stringify({ method: 'Node WASM host fixture; simulation proxy only, no vehicle-model acceptance', native: native.stateHash, replayMatches: native.replayMatches, hash, outcome, state }, null, 2) + '\n');
      }
    } finally {
      sim?.free();
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
