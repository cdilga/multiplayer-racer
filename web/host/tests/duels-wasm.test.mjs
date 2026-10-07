// P1-S09, the WASM half of the skill-payoff duels' parity rule (plan §7.2): every duel in `scenarios/duels/orderings/` is
// judged here through the host's worker build (jj-wasm-host, `testing`) in Node, the same ordering `crates/jj-sim/tests/
// duels.rs` judges natively. For each fixture, the whole run's full-state hash must equal the native `jj sim` run's, and
// each car's time to the gate is measured on a fresh WASM world (`until` on that car's metric, so the world is the one
// the native run has) before the ordering's beats and known gaps are checked.
// Needs scripts/build-host-wasm.sh and the native jj (JJ_BIN, else `cargo run`).
//   node --test web/host/tests/duels-wasm.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repo = resolve(import.meta.dirname, '../../..');
const TICK_HZ = 120;

function nativeHashes(files) {
  const [cmd, ...args] = process.env.JJ_BIN ? [process.env.JJ_BIN] : ['cargo', 'run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--'];
  let out;
  try {
    out = execFileSync(cmd, [...args, 'sim', '--json', ...files], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
  } catch (e) {
    out = e.stdout;
  }
  return new Map(JSON.parse(out).map((o) => [o.scenario, o]));
}

/** A fresh WASM host world with the fixture loaded. */
function world(wasm, fx, mapJson) {
  const sim = new wasm.HostSim(wasm.encode_init(wasm.canonical_map(mapJson), fx.seed));
  const cmd = (c) => JSON.parse(sim.test(JSON.stringify(c)));
  cmd({ cmd: 'hold', on: true });
  cmd({ cmd: 'load', fixture: fx, mapJson });
  return { sim, cmd };
}

/** A car's time to the gate in WASM (null: never reached it, or left the road by more than the gate allows). */
function gateTime(wasm, fx, mapJson, car, gate) {
  const { sim, cmd } = world(wasm, fx, mapJson);
  const r = cmd({ cmd: 'until', until: { car, metric: gate.metric, min: gate.at }, maxTicks: fx.ticks });
  if (!r.held) {
    sim.free();
    return null;
  }
  // The road limit judges the whole run, as the native test does: play it out before reading the accumulators.
  cmd({ cmd: 'step', ticks: Math.max(0, fx.ticks - r.tick) });
  const sig = cmd({ cmd: 'outcome' }).signature.find((s) => s.car === car) ?? {};
  sim.free();
  if (gate.maxOffsetM !== undefined && (sig.maxRouteOffsetM ?? 0) > gate.maxOffsetM) return null;
  return r.tick / TICK_HZ;
}

const matching = (rows, pat) => (pat.endsWith('*') ? rows.filter((r) => r.label.startsWith(pat.slice(0, -1))) : rows.filter((r) => r.label === pat));

test('duels: WASM holds every ordering and matches the native hashes', { timeout: 1_800_000 }, async () => {
  const wasm = await import(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing.js'));
  wasm.initSync({ module: await readFile(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing_bg.wasm')) });
  const orderings = [];
  for (const f of (await readdir(join(repo, 'scenarios/duels/orderings'))).filter((x) => x.endsWith('.json')).sort()) {
    orderings.push(JSON.parse(await readFile(join(repo, 'scenarios/duels/orderings', f), 'utf8')));
  }
  assert.ok(orderings.length >= 7, 'every S09 duel has an ordering');
  const fixtureFiles = [...new Set(orderings.flatMap((o) => (o.fixture ? [o.fixture] : o.fixtures)))];
  const native = nativeHashes(fixtureFiles.map((f) => `scenarios/duels/${f}`));
  const failures = [];
  const table = [];
  for (const o of orderings) {
    const rows = [];
    const pairs = o.fixture ? o.labels.map((label, car) => ({ file: o.fixture, car, label })) : o.fixtures.map((file, i) => ({ file, car: 0, label: o.labels[i] }));
    for (const file of [...new Set(pairs.map((p) => p.file))]) {
      const fx = JSON.parse(await readFile(join(repo, 'scenarios/duels', file), 'utf8'));
      const mapJson = await readFile(join(repo, fx.map), 'utf8');
      const { sim, cmd } = world(wasm, fx, mapJson);
      cmd({ cmd: 'step', ticks: fx.ticks });
      const { stateHash } = cmd({ cmd: 'hash' });
      sim.free();
      if (stateHash !== native.get(fx.scenario)?.stateHash) failures.push(`${o.duel}/${file}: native and WASM full-state hashes differ`);
      for (const p of pairs.filter((q) => q.file === file)) rows.push({ label: p.label, time: gateTime(wasm, fx, mapJson, p.car, o.gate) });
    }
    for (const r of rows) table.push(`${o.duel} ${r.label} ${r.time === null ? 'DNF' : r.time.toFixed(2)}`);
    for (const b of o.beats) {
      const [fast, slow] = [matching(rows, b.faster), matching(rows, b.slower)];
      assert.ok(fast.length && slow.length, `${o.duel}: ${JSON.stringify(b)} matches no car`);
      for (const f of fast) {
        for (const s of slow) {
          const ok = f.time !== null && (s.time === null || s.time - f.time >= b.byS);
          if (!b.gap && !ok) failures.push(`${o.duel}: ${f.label} (${f.time}) must beat ${s.label} (${s.time}) by ${b.byS} s`);
          if (b.gap && ok) failures.push(`${o.duel}: the gap closed (${f.label} beats ${s.label}): delete its gap`);
        }
      }
    }
  }
  console.log(table.join('\n'));
  assert.deepEqual(failures, []);
});
