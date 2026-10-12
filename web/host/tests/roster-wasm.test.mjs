// br-bwju.7 (R123): the WASM half of the mixed-roster determinism rule. The host's worker build (jj-wasm-host, `testing`) runs
// the same mixed-roster script as the native test in crates/jj-wasm-host/src/host/testing.rs (the roster's vehicles sent to the
// host, two phones claim and pick the first two vehicles in free drive, both drive for scenarios/roster/mixed-host.json's
// ticks) and must reach the committed hash the native run reaches.
// Needs scripts/build-host-wasm.sh (any profile). Node only, no browser:
//   node --test web/host/tests/roster-wasm.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repo = resolve(import.meta.dirname, '../../..');
const rd = async (p) => readFile(join(repo, p), 'utf8');

test('a mixed roster through the WASM host reaches the native hash', async () => {
  const wasm = await import(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing.js'));
  wasm.initSync({ module: await readFile(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing_bg.wasm')) });
  const fx = JSON.parse(await rd('scenarios/roster/mixed-host.json'));
  const roster = JSON.parse(await rd('web/shared/src/roster.json')).cars.map((c) => c.id);
  const vehicles = await Promise.all(roster.map(async (id) => [id, await rd(`assets/profiles/${id}.json`)]));

  const sim = new wasm.HostSim(wasm.encode_init(wasm.canonical_map(await rd(fx.map)), fx.seed));
  const cmd = (c) => JSON.parse(sim.test(JSON.stringify(c)));
  const net = (ep, state, bytes) => wasm.encode_net_bytes(ep, state, bytes);
  cmd({ cmd: 'hold', on: true });
  sim.handle(wasm.encode_vehicles(JSON.stringify(vehicles)));
  sim.handle(wasm.encode_ui(1, 'free-drive', true));
  for (const k of [0, 1]) {
    const ep = `fake-${k}`;
    sim.handle(net(ep, false, wasm.controller_hello(ep)));
    sim.handle(net(ep, false, wasm.controller_claim(`P${k}`)));
  }
  cmd({ cmd: 'step', ticks: 30 });
  for (const k of [0, 1]) sim.handle(net(`fake-${k}`, false, wasm.controller_pick(roster[k], false)));
  cmd({ cmd: 'step', ticks: 30 });
  const seen = cmd({ cmd: 'observe' });
  const source = (k) => seen.host.seats.find((s) => s.endpoint === `fake-${k}`).source;
  const start = sim.tick();
  for (let t = 0; t < fx.ticks; t += 6) {
    for (const k of [0, 1]) {
      const seq = t / 6 + 1;
      sim.schedule(start + t, net(`fake-${k}`, true, wasm.controller_state(source(k), seq, k === 1 ? -9000 : 0, 32767)));
    }
  }
  cmd({ cmd: 'step', ticks: fx.ticks });
  const after = cmd({ cmd: 'observe' });
  assert.deepEqual(after.cars.map((c) => c.vehicle), [0, 1], "each seat's car is the vehicle it picked");
  assert.deepEqual(after.cars.map((c) => c.massKg).map((m) => m > 0), [true, true]);
  assert.equal(sim.state_hash(), fx.hash, 'WASM and native agree on the mixed-roster hash');
  sim.free();
});
