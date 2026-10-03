#!/usr/bin/env node
// P1-F05b bundle check: the shipped host and controller bundles carry no test code. Everything the test surface needs
// (its chunk, worker and the `testing` WASM build) must sit under `test/` in the build output, which a production-realm
// server never serves. Fails if any file outside `test/` contains a test-only marker:
//   - the test surface's marker string (web/host/src/testing/testing.ts TEST_SURFACE_MARKER);
//   - the testing WASM build's exports and hooks (`debug_panic`, `controller_hello`, `describe_message`, the surface's
//     `"cmd"` dispatcher) in JS or WASM.
// It also fails if `test/` is missing the chunk, its worker or its WASM (the check would pass vacuously).
//
// Usage: node scripts/ci/bundle-check.mjs [web/dist]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dist = process.argv[2] ?? 'web/dist';
const MARKERS = ['jj-test-surface:v1', 'debug_panic', 'controller_hello', 'describe_message', 'bad test command'];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const problems = [];
const testFiles = [];
let scanned = 0;
for (const f of files(dist)) {
  const rel = relative(dist, f);
  if (rel.split(sep)[0] === 'test') {
    testFiles.push(rel);
    continue;
  }
  if (!/\.(js|mjs|html|wasm|css|json)$/.test(f)) continue;
  scanned++;
  const text = readFileSync(f).toString('latin1');
  for (const m of MARKERS) if (text.includes(m)) problems.push(`${rel} contains test-only "${m}"`);
}
for (const want of [/^test[/\\]testing-.*\.js$/, /^test[/\\]testing\.worker-.*\.js$/, /^test[/\\]jj_wasm_host_testing_bg-.*\.wasm$/]) {
  if (!testFiles.some((f) => want.test(f))) problems.push(`no ${want} under test/: the test surface wasn't built where the server can gate it`);
}
if (problems.length) {
  console.error(`bundle check: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`bundle check: ${scanned} shipped files carry no test code; ${testFiles.length} test files are under test/`);
