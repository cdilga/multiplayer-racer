import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkNative } from './native-check.mjs';

test('snapshot the input helper with the other executables before validating the archive inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-native-copy-'));
  try {
    const source = join(dir, 'source'), destination = join(dir, 'destination');
    mkdirSync(source); mkdirSync(destination);
    // Deliberately invalid executables: the CLI must copy all inputs before validation refuses them.
    // Include zero-filled ranges to exercise the explicit byte-copy path used for native snapshots.
    const helper = Buffer.alloc(8192);
    helper.write('7f454c46', 0, 'hex');
    helper.write('input helper tail', helper.length - 32);
    for (const name of ['jj', 'jj-server', 'jj-input-helper']) {
      writeFileSync(join(source, name), name === 'jj-input-helper' ? helper : Buffer.alloc(4));
    }
    const r = spawnSync(process.execPath, ['scripts/ci/native-check.mjs', '--copy', source, destination], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'invalid fixture executables are refused');
    assert.match(r.stderr, /invalid native executable header/);
    assert.deepEqual(readFileSync(join(destination, 'jj-input-helper')), helper, 'the helper uses the verified byte snapshot too');
  } finally { rmSync(dir, { recursive: true }); }
});

test('reject the CI3419 all-zero executable even when it has the expected size and execute permission', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-native-zero-'));
  try {
    writeFileSync(join(dir, 'jj'), Buffer.alloc(37_334_096), { mode: 0o755 });
    assert.throws(() => checkNative(dir), /invalid native executable header 00000000 \(37334096 bytes\)/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a shell fallback that reports success is not a native CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-native-shell-'));
  try {
    writeFileSync(join(dir, 'jj'), '#!/bin/sh\necho "jj 0.2.0"\n', { mode: 0o755 });
    assert.throws(() => checkNative(dir), /invalid native executable header/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a native-looking truncated payload must execute with the expected response', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-native-truncated-'));
  try {
    writeFileSync(join(dir, 'jj'), Buffer.from(process.platform === 'darwin' ? 'cffaedfe' : '7f454c46', 'hex'), { mode: 0o755 });
    assert.throws(() => checkNative(dir));
  } finally { rmSync(dir, { recursive: true }); }
});
