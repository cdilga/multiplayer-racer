// Run in the CI image with the exact extracted CI3419 binary as argv[2].
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const bytes = readFileSync(process.argv[2]);
const r = spawnSync(process.argv[2], ['--version']);
console.log(JSON.stringify({ bytes: bytes.length, magic: bytes.subarray(0, 4).toString('hex'), sha256: createHash('sha256').update(bytes).digest('hex'), nonzeroBytes: bytes.reduce((n, v) => n + Number(v !== 0), 0), status: r.status, signal: r.signal, error: r.error?.message ?? null, stdoutBase64: r.stdout?.toString('base64'), stderrBase64: r.stderr?.toString('base64') }, null, 2));
