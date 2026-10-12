// br-oj4i: ordinary and concurrent runs cannot overwrite one another's receipts; recaptures require an explicit path.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const helper = new URL('./evidence.mjs', import.meta.url).href;
const probe = `
  import { evidencePath } from ${JSON.stringify(helper)};
  import { mkdirSync, writeFileSync } from 'node:fs';
  import { dirname } from 'node:path';
  const paths = [evidencePath('P1/receipt.json'), evidencePath('P2/receipt.json'),
    evidencePath('P3/receipt.json', 'JJ_EVIDENCE'), evidencePath('P4/capture', 'JJ_CAPTURE_DIR')];
  for (const path of paths.slice(0, 3)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'new receipt');
  }
  console.log(JSON.stringify(paths));
`;
const run = (overrides = {}) => {
  const env = { ...process.env };
  for (const name of ['JJ_EVIDENCE_DIR', 'JJ_EVIDENCE', 'JJ_CAPTURE_DIR']) delete env[name];
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env: { ...env, ...overrides }, encoding: 'utf8' }));
};

test('two default runs write isolated scratch receipts and leave an existing receipt untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-evidence-test-'));
  const sentinel = join(dir, 'receipt.json');
  writeFileSync(sentinel, 'reviewed receipt');
  const first = run(), second = run();
  try {
    assert.notEqual(first[0], second[0], 'concurrent suites have distinct output roots');
    for (const paths of [first, second]) for (const path of paths.slice(0, 3)) {
      assert.ok(path.startsWith(join(tmpdir(), 'jj-test-evidence-')));
      assert.equal(readFileSync(path, 'utf8'), 'new receipt');
    }
    assert.equal(readFileSync(sentinel, 'utf8'), 'reviewed receipt');
    const override = run({ JJ_EVIDENCE: sentinel, JJ_EVIDENCE_DIR: join(dir, 'directory'), JJ_CAPTURE_DIR: join(dir, 'captures') });
    assert.deepEqual(override, [join(dir, 'directory'), join(dir, 'directory'), sentinel, join(dir, 'captures')]);
    assert.equal(readFileSync(sentinel, 'utf8'), 'new receipt', 'explicit opt-in recaptures the selected receipt');
  } finally {
    for (const paths of [first, second]) rmSync(join(paths[0], '../..'), { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
