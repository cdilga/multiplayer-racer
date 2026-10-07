#!/usr/bin/env node
// Refresh scripts/ci/durations.json (the slot packer's estimates) from a CI run's `slot-timing:` lines.
//
// Usage: node scripts/ci/durations.mjs <run id>      (reads job logs with `tea api --login gitea-lan`)
// Only passing targets update; the SSE soak is never recorded (plan sizes it from the soak length).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const run = process.argv[2];
if (!run) {
  console.error('usage: durations.mjs <run id>');
  process.exit(2);
}
const repo = 'cdilga/multiplayer-racer';
const api = (path) => execFileSync('tea', ['api', '--login', 'gitea-lan', path], { encoding: 'utf8', maxBuffer: 1 << 28 });
const file = join(import.meta.dirname, 'durations.json');
const durations = JSON.parse(readFileSync(file, 'utf8'));
const jobs = JSON.parse(api(`/repos/${repo}/actions/runs/${run}/jobs?limit=100`)).jobs.filter((j) => j.name.startsWith('browser'));
let n = 0;
for (const j of jobs) {
  for (const m of api(`/repos/${repo}/actions/jobs/${j.id}/logs`).matchAll(/slot-timing: (\S+) ([\d.]+)s pass/g)) {
    if (m[1].endsWith('sse.test.mjs')) continue;
    durations[m[1]] = Math.round(Number(m[2]));
    n++;
  }
}
const sorted = Object.fromEntries(Object.entries(durations).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
console.log(`durations.json: ${n} targets updated from run ${run}`);
