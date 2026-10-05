// P1-M02: runs the spike's WASM build (spike_generate) for every combination and seed the native bench ran, compares the
// canonical-bytes fingerprint with the native one, and times generation in WASM.
//   cargo build --release --lib --target wasm32-unknown-unknown && node wasm-check.mjs out
import fs from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'out';
const wasm = fs.readFileSync(new URL('./target/wasm32-unknown-unknown/release/jj_procgen_spike.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasm, {});
const { spike_generate, spike_out, memory } = instance.exports;
const native = JSON.parse(fs.readFileSync(join(out, 'bench-native.json'), 'utf8'));
const BIOMES = ['town', 'rocks', 'outback-dirt', 'outback-bitumen'];
const UND = ['flat', 'noise', 'route'];
const SC = ['poisson', 'blue', 'cluster'];
const rows = [];
let mismatches = 0;
for (const r of native) {
  const t0 = performance.now();
  const n = spike_generate(r.seed, 0, BIOMES.indexOf(r.biome), UND.indexOf(r.undulation), SC.indexOf(r.scatter));
  const ms = performance.now() - t0;
  const bytes = new Uint8Array(memory.buffer, spike_out(), n);
  const fnv = new TextDecoder().decode(bytes.subarray(0, 16));
  const same = fnv === r.fnv;
  if (!same) mismatches++;
  rows.push({ biome: r.biome, undulation: r.undulation, scatter: r.scatter, seed: r.seed, wasmGenMs: ms, nativeGenMs: r.genMs, fnv, same });
}
const worst = Math.max(...rows.map((r) => r.wasmGenMs));
fs.writeFileSync(join(out, 'bench-wasm.json'), JSON.stringify({ runtime: `Node ${process.version} (V8 WASM), ${process.platform}/${process.arch}`, mismatches, worstWasmGenMs: worst, rows }, null, 1));
console.log(`${rows.length} generations in WASM: ${mismatches} fingerprint mismatches with native; worst WASM generation ${worst.toFixed(1)} ms`);
process.exit(mismatches ? 1 : 0);
