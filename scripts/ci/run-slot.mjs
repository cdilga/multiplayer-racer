#!/usr/bin/env node
// Run one CI browser slot (docs/infra/ci.md): the targets scripts/ci/plan.mjs packed into this slot (whole files, or
// single tests of a long file: scripts/ci/targets.mjs), one after another, each with the environment its suite always
// had in CI. Every target runs even if an earlier one fails; the slot fails if any did. Prints one
// `slot-timing: <s>s <pass|FAIL> <target>` line per target, which scripts/ci/durations.mjs learns from.
//
// Usage: node scripts/ci/run-slot.mjs <slot> '<slots JSON from plan>'   (env: JJ_SOAK_S for the SSE soak)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileOf, nodeArgs } from './targets.mjs';

const [slot, json] = process.argv.slice(2);
const targets = JSON.parse(json || '{}')[slot] ?? [];
if (!targets.length) {
  console.log(`slot ${slot}: nothing selected`);
  process.exit(0);
}
let durations = {};
try {
  durations = JSON.parse(readFileSync(join(import.meta.dirname, 'durations.json'), 'utf8'));
} catch {}
const bin = resolve('.ci-bin');
const base = { ...process.env, JJ_BIN: `${bin}/jj`, JJ_SERVER_BIN: `${bin}/jj-server` };
const envFor = (f) => {
  if (f.startsWith('web/host/tests/')) return { JJ_NO_WEBKIT: '1', JJ_NO_CAPTURES: '1' };
  if (f.startsWith('web/shared/transport/tests/')) return { JJ_COTURN_REQUIRED: '1' };
  if (f === 'crates/jj-server/tests/sse.test.mjs') return { JJ_SOAK_S: process.env.JJ_SOAK_S ?? '300' };
  return {};
};
// One target at a time within a slot: host pages render on the CPU (software GL) here, and parallel files starve each
// other's timers, so the timing tests would measure the runner, not the host.
let failed = 0;
for (const t of targets) {
  const f = fileOf(t);
  const start = Date.now();
  console.log(`::group::${t}`);
  const r = spawnSync('node', nodeArgs(durations, t, !f.endsWith('sse.test.mjs')), { stdio: 'inherit', env: { ...base, ...envFor(f) } });
  console.log('::endgroup::');
  const s = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`slot-timing: ${s}s ${r.status === 0 ? 'pass' : 'FAIL'} ${t}`);
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
