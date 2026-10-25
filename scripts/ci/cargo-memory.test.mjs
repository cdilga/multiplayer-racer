import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Replace only the cgroup read; exercise the sourced policy and its exported environment in a child shell.
function jobs(memory, explicit) {
  const env = { ...process.env, JJ_TEST_MEMORY: memory };
  delete env.CARGO_BUILD_JOBS;
  if (explicit !== undefined) env.CARGO_BUILD_JOBS = explicit;
  const child = spawnSync('bash', ['-c', `
    set -euo pipefail
    cat() { [[ $1 == /sys/fs/cgroup/memory.max ]] || return 2; [[ $JJ_TEST_MEMORY != absent ]] || return 1; printf '%s\\n' "$JJ_TEST_MEMORY"; }
    source scripts/ci/cargo-memory.sh
    bash -c 'printf "%s" "\${CARGO_BUILD_JOBS-unset}"'
  `], { env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout;
}

test('8 GiB job exports four compile jobs to Cargo children', () => {
  assert.equal(jobs(String(8 * 1024 ** 3)), '4');
});

test('12/16 GiB and unlimited runners retain Cargo default parallelism', () => {
  for (const memory of [String(12 * 1024 ** 3), String(16 * 1024 ** 3), 'max']) {
    assert.equal(jobs(memory), 'unset');
  }
});

test('machines without a cgroup memory file retain Cargo defaults', () => {
  assert.equal(jobs('absent'), 'unset');
});

test('explicit compile parallelism is preserved on small and large runners', () => {
  for (const memory of [String(8 * 1024 ** 3), String(16 * 1024 ** 3)]) {
    assert.equal(jobs(memory, '2'), '2');
  }
});
