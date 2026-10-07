#!/usr/bin/env node
// Refresh scripts/ci/durations.json (the slot packer's estimates, and the per-test names it splits long files by) from
// a CI run's browser-slot logs.
//
// Usage: node scripts/ci/durations.mjs <run id>      (reads job logs with `tea api --login gitea-lan`)
// - Every passing target's `slot-timing` line sets that target's duration (the SSE soak is never recorded: plan sizes
//   it from the soak length).
// - A file run whole with two or more top-level tests and no subtests also records one `file::<name>` entry per test
//   (that test's time plus the file's measured setup overhead), replacing the file's earlier per-test entries. Those
//   names let plan.mjs split files whose tests it can't read from the source (scripts/ci/targets.mjs).
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
const strip = (l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(/\x1b\[[0-9;]*m/g, '');
let n = 0;
for (const j of jobs) {
  let target = null;
  let tests = [];
  let sub = false;
  let summary = false;
  for (const raw of api(`/repos/${repo}/actions/jobs/${j.id}/logs`).split('\n')) {
    const l = strip(raw);
    const g = /^::group::(.+)$/.exec(l);
    if (g) [target, tests, sub, summary] = [g[1], [], false, false];
    if (l.startsWith('✖ failing tests:')) summary = true;
    const r = !summary && target && /^(\s*)[✔✖] (.+) \((\d+(?:\.\d+)?)ms\)$/.exec(l);
    if (r) {
      if (r[1]) sub = true;
      else tests.push([r[2], Number(r[3]) / 1000]);
    }
    // `slot-timing: 12.3s pass <target>` (and the older `slot-timing: <target> 12.3s pass`)
    const t = /slot-timing: ([\d.]+)s (pass|FAIL) (.+)$/.exec(l) ?? ((m) => m && [m[0], m[2], m[3], m[1]])(/slot-timing: (\S+) ([\d.]+)s (pass|FAIL)$/.exec(l));
    if (!t || t[2] !== 'pass' || t[3].endsWith('sse.test.mjs')) continue;
    const [secs, name] = [Number(t[1]), t[3]];
    durations[name] = Math.round(secs);
    n++;
    if (!name.includes('::')) {
      for (const k of Object.keys(durations)) if (k.startsWith(`${name}::`)) delete durations[k];
      if (!sub && tests.length > 1) {
        const overhead = Math.max(0, secs - tests.reduce((a, [, s]) => a + s, 0));
        for (const [tn, s] of tests) durations[`${name}::${tn}`] = Math.round(s + overhead);
      }
    }
  }
}
const sorted = Object.fromEntries(Object.entries(durations).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
console.log(`durations.json: ${n} targets updated from run ${run}`);
