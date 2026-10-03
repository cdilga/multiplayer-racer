// P1-S03a, the WASM half of the feel bank's parity rule (plan §7.2): every feel scenario and S03 affordance row runs
// through the host's worker build (jj-wasm-host, `testing`) in Node via the test surface (`load`, `step`/`until`,
// `outcome`, `hash`). Each holds its envelopes, and its full-state hash equals the native `jj sim` run's.
// Needs scripts/build-host-wasm.sh and the native jj (JJ_BIN, else `cargo run`).
//   node --test web/host/tests/feel-wasm.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repo = resolve(import.meta.dirname, '../../..');
const S03_ROWS = ['fwd-back-rest', 'brake-stop', 'turn-around', 'unstick-wall', 'authority', 'rejoin-route'];

async function bank() {
  const feel = (await readdir(join(repo, 'scenarios/feel'))).filter((f) => f.endsWith('.json')).sort();
  return [...feel.map((f) => `scenarios/feel/${f}`), ...S03_ROWS.map((r) => `scenarios/affordances/${r}.json`)];
}

function nativeHashes(files) {
  const [cmd, ...args] = process.env.JJ_BIN
    ? [process.env.JJ_BIN]
    : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  // Exit 1 (a failing envelope) still prints the outcomes; the assertions below say which.
  let out;
  try {
    out = execFileSync(cmd, [...args, 'sim', '--json', ...files], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
  } catch (e) {
    out = e.stdout;
  }
  return new Map(JSON.parse(out).map((o) => [o.scenario, o]));
}

test('feel bank: WASM (jj-wasm-host in Node) holds every envelope and matches the native hashes', { timeout: 600_000 }, async () => {
  const wasm = await import(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing.js'));
  wasm.initSync({ module: await readFile(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing_bg.wasm')) });
  const files = await bank();
  const native = nativeHashes(files);
  const rows = [];
  for (const file of files) {
    const fx = JSON.parse(await readFile(join(repo, file), 'utf8'));
    const mapJson = await readFile(join(repo, fx.map), 'utf8');
    const sim = new wasm.HostSim(wasm.encode_init(wasm.canonical_map(mapJson), fx.seed));
    const cmd = (c) => JSON.parse(sim.test(JSON.stringify(c)));
    cmd({ cmd: 'hold', on: true });
    cmd({ cmd: 'load', fixture: fx, mapJson });
    if (fx.until) cmd({ cmd: 'until', until: fx.until, maxTicks: fx.ticks });
    else cmd({ cmd: 'step', ticks: fx.ticks });
    const { checks } = cmd({ cmd: 'outcome' });
    const { tick, stateHash } = cmd({ cmd: 'hash' });
    sim.free();
    const n = native.get(fx.scenario);
    rows.push({ scenario: fx.scenario, tick, wasm: stateHash, native: n?.stateHash, failed: checks.filter((c) => !c.ok) });
  }
  console.log(rows.map((r) => `${r.wasm === r.native ? 'same' : 'DIFF'} ${r.scenario} @${r.tick} ${r.wasm.slice(0, 12)}`).join('\n'));
  for (const r of rows) {
    assert.deepEqual(r.failed, [], `${r.scenario}: envelopes in WASM`);
    assert.equal(r.wasm, r.native, `${r.scenario}: native and WASM full-state hashes`);
  }
});
