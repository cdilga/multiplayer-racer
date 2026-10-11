import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkNative } from './native-check.mjs';

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
