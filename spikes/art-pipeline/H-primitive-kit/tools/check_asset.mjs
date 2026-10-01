#!/usr/bin/env node
// check_asset.mjs — single CI entry point for a code-defined vehicle asset (the counterpart of E-mesh-lint-rig/check_asset.sh).
//   node tools/check_asset.mjs [--bake] [--fast] [--selftest] [--asset asset/cruze]
//     (default)  contract+perf validator → physics gates → render gates (GLB via GLTFLoader) → replay determinism
//     --bake     rebuild the GLBs + sidecar from the code first (tools/bake.mjs)
//     --selftest also inject 26 defects and prove each gate catches its own (tools/selftest.mjs)
//     --fast     skip the browser stages (validator + physics only: ~2 s, no GPU needed)
// Starts a localhost-only static server on :8123 if none is running. Exits non-zero if any stage fails. One line per stage.
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), KIT = path.resolve(HERE, '..'), REPO = path.resolve(KIT, '../../..');
const args = process.argv.slice(2), has = (f) => args.includes(f), ASSET = path.resolve(KIT, args.includes('--asset') ? args[args.indexOf('--asset') + 1] : 'asset/cruze');
const ping = () => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port: 8123, path: '/spikes/art-pipeline/H-primitive-kit/index.html', timeout: 800 }, (x) => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });
let server = null;
if (!has('--fast') && !(await ping())) { server = spawn('python3', ['-m', 'http.server', '8123', '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1200)); }

const stages = []; let bad = 0; const t00 = Date.now();
function run(label, cmd, argv, { summary } = {}) {
  const t0 = Date.now(), p = spawnSync(cmd, argv, { cwd: KIT, encoding: 'utf8', maxBuffer: 1 << 26 }), out = (p.stdout ?? '') + (p.stderr ?? '');
  const ok = p.status === 0, line = [...out.split('\n')].reverse().find((l) => summary.test(l)) ?? '';
  stages.push({ label, ok, secs: (Date.now() - t0) / 1000, line: line.trim() }); if (!ok) { bad++; out.split('\n').filter((l) => /^FAIL|MISSED|PAGEERR|Error/.test(l)).slice(0, 12).forEach((l) => console.log('   ' + l)); }
  console.log(`${label.padEnd(22)} ${ok ? 'PASS' : 'FAIL'}  ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${line.trim()}`);
}
console.log(`=== check_asset: ${path.relative(KIT, ASSET)} ===`);
if (has('--bake')) run('bake', 'node', ['tools/bake.mjs', path.relative(KIT, ASSET)], { summary: /sidecar written/ });
run('validate (contract+perf)', 'node', ['tools/validate_asset.mjs', path.relative(KIT, ASSET)], { summary: /^--- \d+ PASS/ });
run('physics gates', 'node', ['tools/physics/gates.mjs', path.relative(KIT, ASSET)], { summary: /^--- physics/ });
if (!has('--fast')) {
  run('render gates (GLB)', 'node', ['tools/render_gates.mjs', path.relative(KIT, ASSET)], { summary: /^--- render gates/ });
  run('replay determinism', 'node', ['replay_test.mjs'], { summary: /identical/ });
}
if (has('--selftest')) run('selftest (26 defects)', 'node', ['tools/selftest.mjs', path.relative(KIT, ASSET)], { summary: /^--- selftest/ });
if (server) server.kill();
console.log(`=== RESULT: ${bad ? 'FAIL' : 'PASS'}  (${((Date.now() - t00) / 1000).toFixed(1)}s, ${stages.length} stages) ===`);
process.exit(bad ? 1 : 0);
