#!/usr/bin/env node
// Run one CI browser slot (docs/infra/ci.md): the node test targets scripts/ci/plan.mjs packed into this slot, one
// after another, each with the environment its suite always had in CI. Every target runs even if an earlier one fails;
// the slot fails if any did. Prints one `slot-timing` line per target, which is where plan durations come from.
//
// Usage: node scripts/ci/run-slot.mjs <slot> '<slots JSON from plan>'   (env: JJ_SOAK_S for the SSE soak)
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [slot, json] = process.argv.slice(2);
const targets = JSON.parse(json || '{}')[slot] ?? [];
if (!targets.length) {
  console.log(`slot ${slot}: nothing selected`);
  process.exit(0);
}
const bin = resolve('.ci-bin');
const base = { ...process.env, JJ_BIN: `${bin}/jj`, JJ_SERVER_BIN: `${bin}/jj-server` };
const envFor = (t) => {
  if (t.startsWith('web/host/tests/')) return { JJ_NO_WEBKIT: '1', JJ_NO_CAPTURES: '1' };
  if (t.startsWith('web/shared/transport/tests/')) return { JJ_COTURN_REQUIRED: '1' };
  if (t === 'crates/jj-server/tests/sse.test.mjs') return { JJ_SOAK_S: process.env.JJ_SOAK_S ?? '300' };
  return {};
};
// One file at a time within a slot: host pages render on the CPU (software GL) here, and parallel files starve each
// other's timers, so the timing tests would measure the runner, not the host.
let failed = 0;
for (const t of targets) {
  const start = Date.now();
  const args = ['--test', ...(t.endsWith('sse.test.mjs') ? [] : ['--test-concurrency=1']), t];
  console.log(`::group::${t}`);
  const r = spawnSync('node', args, { stdio: 'inherit', env: { ...base, ...envFor(t) } });
  console.log('::endgroup::');
  const s = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`slot-timing: ${t} ${s}s ${r.status === 0 ? 'pass' : 'FAIL'}`);
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
