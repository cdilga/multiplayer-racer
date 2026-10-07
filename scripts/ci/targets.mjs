// Per-test CI targets (docs/infra/ci.md), shared by scripts/ci/plan.mjs (which packs them into slots) and
// scripts/ci/run-slot.mjs (which runs them). A long test file runs as one target per top-level test, so no slot waits
// on a whole long file:
//   `file`              the whole file;
//   `file::<name>`      one top-level test, run with an anchored --test-name-pattern;
//   `file::*rest`       every test of the file not named by a `file::<name>` target, run with one anchored
//                       --test-skip-pattern per known name, so a test added since the names were learned still runs.
// Names come from the source when every test is a top-level `test('literal', …)` call (complete, no rest target), or
// from earlier runs' logs, recorded by scripts/ci/durations.mjs as `file::<name>` keys (a rest target covers the rest).
// Files with subtests are never split (node matches a pattern against the whole name path).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REST = '*rest';

/** Top-level test names from the source, or null when it can't be read safely. */
export function sourceNames(repoRoot, file) {
  let src;
  try {
    src = readFileSync(join(repoRoot, file), 'utf8');
  } catch {
    return null;
  }
  if (/\b(describe|suite|it)\s*\(|\bt\.test\s*\(/.test(src)) return null;
  const calls = (src.match(/(?<![.\w])test\s*(\.\w+\s*)?\(/g) ?? []).length; // not regex.test(…)
  const found = [];
  for (const m of src.matchAll(/^test\(\s*(['"])/gm)) {
    const q = m[1];
    let i = m.index + m[0].length;
    let name = '';
    for (; i < src.length && src[i] !== q && src[i] !== '\n'; i++) name += src[i] === '\\' ? src[++i] : src[i];
    if (src[i] !== q) return null;
    found.push(name);
  }
  return found.length === calls && new Set(found).size === found.length ? found : null;
}

/** Names learned from earlier runs (durations.json keys), or []. */
export function learnedNames(durations, file) {
  const prefix = `${file}::`;
  return Object.keys(durations)
    .filter((k) => k.startsWith(prefix) && k !== prefix + REST)
    .map((k) => k.slice(prefix.length));
}

/** The targets for one file: itself, or one per test (plus a rest target for learned names). */
export function splitTargets(repoRoot, durations, file) {
  const src = sourceNames(repoRoot, file);
  if (src && src.length > 1) return src.map((n) => `${file}::${n}`);
  const learned = learnedNames(durations, file);
  if (!src && learned.length > 1) return [...learned.map((n) => `${file}::${n}`), `${file}::${REST}`];
  return [file];
}

const anchored = (name) => `^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`;

/** `node --test` arguments for a target. */
export function nodeArgs(durations, target, concurrency = true) {
  const at = target.indexOf('::');
  const file = at < 0 ? target : target.slice(0, at);
  const name = at < 0 ? null : target.slice(at + 2);
  const args = ['--test', ...(concurrency ? ['--test-concurrency=1'] : [])];
  if (name === REST) for (const n of learnedNames(durations, file)) args.push('--test-skip-pattern', anchored(n));
  else if (name !== null) args.push('--test-name-pattern', anchored(name));
  return [...args, file];
}

export const fileOf = (target) => (target.includes('::') ? target.slice(0, target.indexOf('::')) : target);
