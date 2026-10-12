import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// Exercise the real polling shell, with only the store/API/archive commands replaced. The historical
// status response is deliberately failing: asking that endpoint reproduces CI3436's premature exit.
function fetchRun(conclusion, runId = '3436') {
  const root = mkdtempSync(join(tmpdir(), 'jj-fetch-run-'));
  try {
    mkdirSync(join(root, 'scripts/ci'), { recursive: true });
    mkdirSync(join(root, 'bin'));
    copyFileSync(new URL('./fetch-web.sh', import.meta.url), join(root, 'scripts/ci/fetch-web.sh'));
    const script = (path, body) => writeFileSync(join(root, path), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
    script('scripts/ci/build-key.sh', 'echo sample-key');
    script('scripts/ci/web-store.sh', `
      count=0; [[ ! -f "$FETCH_ROOT/count" ]] || count=$(cat "$FETCH_ROOT/count")
      echo $((count + 1)) > "$FETCH_ROOT/count"
      if [[ $count == 0 ]]; then exit 1; fi
      touch "$3"
    `);
    script('bin/curl', `
      echo "\${@: -1}" >> "$FETCH_ROOT/requests"
      if [[ "\${@: -1}" == */commits/* ]]; then
        echo '[{"context":"CI / build (push)","status":"failure"}]'
      else
        echo "$FETCH_RESPONSE"
      fi
    `);
    for (const name of ['sleep', 'tar', 'zstd', 'node']) script(`bin/${name}`, 'exit 0');
    const result = spawnSync('bash', ['scripts/ci/fetch-web.sh'], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, JJ_PREBUILT: join(root, 'cache'),
        FETCH_ROOT: root, GITHUB_RUN_ID: runId,
        FETCH_RESPONSE: JSON.stringify({ jobs: [{ name: 'build', status: conclusion ? 'completed' : 'in_progress', conclusion }] }) },
    });
    return { ...result, requests: readFileSync(join(root, 'requests'), 'utf8') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('pending current build waits for the artifact despite an older failed commit status', () => {
  const r = fetchRun(null);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sample-key ready/);
  assert.match(r.requests, /actions\/runs\/3436\/jobs/);
  assert.doesNotMatch(r.requests, /commits/);
});

test('current build success waits for store publication', () => {
  const r = fetchRun('success');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sample-key ready/);
});

for (const conclusion of ['failure', 'cancelled', 'timed_out']) test(`current build ${conclusion} stops the fetch`, () => {
  const r = fetchRun(conclusion);
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`build in run 3436 ended with ${conclusion}`));
});
