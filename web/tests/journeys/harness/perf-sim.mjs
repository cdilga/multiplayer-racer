// P1-Q01: native vs WASM sim timing, worker snapshot cost and sim ms as debris grows (plan §13b.1, §15.2). Writes
// docs/evidence/P1-Q01/sim-timing-<host>.json naming hardware, build and cohort.
//
// The scene is one shared fixture, generated here: N cars on the greybox grid, every damageable part set to 0 at tick 30 so
// each car leaves 10 detached parts (plus its husk when the wheels go): debris grows to ~10 x N dynamic bodies and is never
// capped. The same fixture runs
//   - NATIVE: `jj sim --json` (release build; JJ_BIN), timed as the difference between a T+K and a T tick run so process start
//     and map load cancel (min of 3), and
//   - WASM: the host's worker build (jj-wasm-host, `testing`) in Node, stepping the same ticks through the test surface,
// and the two end on the same full-state hash (parity), so the timing compares one world. Snapshot cost is HostSim's
// snapshot_size / write_snapshot at the end of the run (what the worker posts to main).
//
//   scripts/build-host-wasm.sh && cargo build --release -p jj-tools --bin jj   (on eris via scripts/remote/eris.sh)
//   JJ_BIN=target/release/jj node web/tests/journeys/harness/perf-sim.mjs [--cars 1,2,4,8,16,24,48] [--out file]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../../..');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const cars = arg('--cars', '1,2,4,8,16,24,48').split(',').map(Number);
const BASE = 150; // ticks before the measured window: spawn, settle, the strip at tick 30
const WINDOW = 600; // measured ticks (5 s of play)
const PARTS = ['front', 'back', 'door_FL', 'door_FR', 'door_RL', 'door_RR', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
const bin = resolve(repo, process.env.JJ_BIN ?? 'target/release/jj');

const fixture = (n, ticks) => ({
  scenario: `perf-debris-${n}`,
  what: `P1-Q01 perf scene: ${n} cars on the greybox grid, every part stripped at tick 30 (debris grows, uncapped).`,
  map: 'maps/greybox-loop.json',
  seed: 7,
  ticks,
  grid: n,
  damage: Array.from({ length: n }, (_, car) => PARTS.map((part) => ({ tick: 30, car, part, health: 0 }))).flat(),
});

const tmp = join(os.tmpdir(), `jj-perf-sim-${process.pid}`);
mkdirSync(tmp, { recursive: true });
function native(n, ticks) {
  const file = join(tmp, `p-${n}-${ticks}.json`);
  writeFileSync(file, JSON.stringify(fixture(n, ticks)));
  const t0 = process.hrtime.bigint();
  let out;
  try {
    out = execFileSync(bin, ['sim', '--json', file], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    out = e.stdout;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, row: JSON.parse(out)[0] };
}

const wasm = await import(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing.js'));
wasm.initSync({ module: readFileSync(join(repo, 'web/host/src/testing/pkg/jj_wasm_host_testing_bg.wasm')) });
const mapJson = readFileSync(join(repo, 'maps/greybox-loop.json'), 'utf8');
function inWasm(n) {
  const fx = fixture(n, BASE + WINDOW);
  const sim = new wasm.HostSim(wasm.encode_init(wasm.canonical_map(mapJson), fx.seed));
  const cmd = (c) => JSON.parse(sim.test(JSON.stringify(c)));
  cmd({ cmd: 'hold', on: true });
  cmd({ cmd: 'load', fixture: fx, mapJson });
  cmd({ cmd: 'step', ticks: BASE });
  const chunks = [];
  for (let i = 0; i < WINDOW / 10; i++) {
    const t0 = performance.now();
    cmd({ cmd: 'step', ticks: 10 });
    chunks.push((performance.now() - t0) / 10);
  }
  const debris = cmd({ cmd: 'observe' }).debris?.length ?? null;
  const snapBytes = sim.snapshot_size();
  const buf = new Uint8Array(snapBytes);
  const snaps = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    sim.write_snapshot(buf);
    snaps.push(performance.now() - t0);
  }
  const hash = cmd({ cmd: 'hash' }).stateHash;
  sim.free();
  chunks.sort((a, b) => a - b);
  snaps.sort((a, b) => a - b);
  return {
    wasmMsPerTick: { mean: +(chunks.reduce((a, b) => a + b, 0) / chunks.length).toFixed(4), p95: +chunks[Math.floor(chunks.length * 0.95)].toFixed(4), max: +chunks.at(-1).toFixed(4) },
    debris,
    snapshotBytes: snapBytes,
    snapshotWriteMs: { median: +snaps[snaps.length >> 1].toFixed(4), max: +snaps.at(-1).toFixed(4) },
    hash,
  };
}

const rows = [];
for (const n of cars) {
  const w = inWasm(n);
  const best = (ticks) => Math.min(...[0, 1, 2].map(() => native(n, ticks).ms));
  const a = best(BASE);
  const b = best(BASE + WINDOW);
  const end = native(n, BASE + WINDOW).row;
  const nativeMs = (b - a) / WINDOW;
  const hashNative = end.stateHash ?? end.hash ?? end.finalHash ?? null;
  rows.push({
    cars: n,
    ...w,
    nativeMsPerTick: +nativeMs.toFixed(4),
    wasmOverNative: +(w.wasmMsPerTick.mean / nativeMs).toFixed(2),
    budgetMsPerTick: +(1000 / 120).toFixed(2),
    wasmHash: w.hash,
    nativeHash: hashNative,
    parity: hashNative ? hashNative === w.hash : 'native hash not in the jj sim row',
  });
  console.log(JSON.stringify(rows.at(-1)));
}
const receipt = {
  label: 'P1-Q01 sim timing (native vs WASM, snapshot cost, debris growth)',
  evidenceKind: 'ev:hardware (the machine below; headless is irrelevant to sim timing)',
  machine: { host: os.hostname(), cpu: os.cpus()[0]?.model, cpus: os.cpus().length, platform: `${os.platform()}/${os.arch()}`, node: process.version },
  build: process.env.JJ_BUILD ?? execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  nativeBinary: `${process.env.JJ_BIN ?? 'target/release/jj'} (release)`,
  wasm: 'jj-wasm-host testing build, run in Node (V8 WASM), not a browser worker; worker overhead and a browser JIT are not in these numbers',
  cohort: `fixture perf-debris-N: N cars on the greybox grid, all parts stripped at tick 30; measured ticks ${BASE}..${BASE + WINDOW}`,
  nativeMethod: 'wall time of `jj sim` at T+K ticks minus at T ticks (min of 3), so process start and map load cancel',
  takenAt: new Date().toISOString(),
  rows,
};
const out = resolve(repo, arg('--out', `docs/evidence/P1-Q01/sim-timing-${os.hostname().replace(/\..*/, '')}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`wrote ${out}`);
