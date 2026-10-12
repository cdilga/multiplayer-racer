#!/usr/bin/env node
// An archive checksum cannot detect a successfully archived, unusable executable (br-hytm).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkNative(dir) {
  const receipts = [];
  for (const name of ['jj', 'jj-server']) {
    const file = resolve(dir, name);
    const bytes = readFileSync(file);
    const magic = bytes.subarray(0, 4).toString('hex');
    const allowed = process.platform === 'darwin' ? ['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca'] : ['7f454c46'];
    assert.ok(allowed.includes(magic), `${file}: invalid native executable header ${magic} (${bytes.length} bytes)`);
    const env = { ...process.env, JJ_ROLE: 'turn-broker' };
    delete env.JJ_BROKER_KEY;
    const args = name === 'jj' ? ['--version'] : [];
    const r = spawnSync(file, args, { env, encoding: 'utf8', timeout: 10_000 });
    const diagnostic = JSON.stringify({ file, args, status: r.status, signal: r.signal, error: r.error?.message, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.error, undefined, diagnostic);
    assert.equal(r.signal, null, diagnostic);
    if (name === 'jj') {
      assert.equal(r.status, 0, diagnostic);
      assert.match(r.stdout, /^jj \d+\.\d+\.\d+\S*\n$/, diagnostic);
    } else {
      // This early configuration refusal proves the server runs without opening sockets or loading assets.
      assert.equal(r.status, 1, diagnostic);
      assert.match(r.stderr, /jj-server \(turn-broker\): JJ_BROKER_KEY is required/, diagnostic);
    }
    receipts.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), status: r.status, stdout: r.stdout, stderr: r.stderr });
  }
  return receipts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    let dir = process.argv[2] ?? '.ci-bin';
    if (dir === '--copy') {
      dir = process.argv[4];
      for (const name of ['jj', 'jj-server']) {
        // Explicit reads/writes avoid filesystem sparse/reflink copy shortcuts and verify the copied bytes.
        const bytes = readFileSync(resolve(process.argv[3], name));
        const destination = resolve(dir, name);
        writeFileSync(destination, bytes);
        chmodSync(destination, 0o755);
        assert.ok(bytes.equals(readFileSync(destination)), `${destination}: copied bytes differ`);
      }
    }
    console.log(JSON.stringify(checkNative(dir)));
  }
  catch (error) { console.error(`native-check: ${error.message}`); process.exitCode = 1; }
}
