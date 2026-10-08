// P1-C09: the licence check passes on the committed list and fails on injected cases.   node --test tools/licences/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { licenceAllowed, problems } from './lib.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const inputs = () => ({
  list: JSON.parse(read('web/landing/credits/licences.json')),
  cargoLock: read('Cargo.lock'),
  npmLock: JSON.parse(read('web/package-lock.json')),
  policy: JSON.parse(read('tools/licences/policy.json')),
});

test('the committed list matches the lockfiles and every shipped dependency is within the policy', () => {
  assert.deepEqual(problems(inputs()), []);
});

test('a shipped dependency with no licence entry fails', () => {
  const i = inputs();
  i.list.rust.push({ name: 'mystery-crate', version: '1.0.0', licence: null, url: '' });
  i.cargoLock += '\n[[package]]\nname = "mystery-crate"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n';
  assert.deepEqual(problems(i), ['mystery-crate@1.0.0 ships with no licence entry']);
});

test('a dependency added to the lockfile but not to the list fails', () => {
  const i = inputs();
  i.cargoLock += '\n[[package]]\nname = "injected-crate"\nversion = "0.3.1"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n';
  const found = problems(i);
  assert.equal(found.length, 1);
  assert.match(found[0], /injected-crate@0\.3\.1 is locked but has no entry/);
  // A new web package, shipped or not, is caught the same way.
  const j = inputs();
  j.npmLock.packages['node_modules/left-pad'] = { version: '1.3.0', license: 'WTFPL' };
  assert.match(problems(j)[0], /left-pad@1\.3\.0 is locked but has no entry/);
});

test('a licence outside the policy fails, and an alternative inside it passes', () => {
  const i = inputs();
  i.list.web[0].licence = 'GPL-2.0-only';
  assert.match(problems(i)[0], /ships under GPL-2\.0-only, outside the policy/);
  assert.equal(licenceAllowed('GPL-2.0-only OR MIT', ['MIT']), true);
  assert.equal(licenceAllowed('(MIT OR Apache-2.0) AND Unicode-3.0', ['MIT', 'Unicode-3.0']), true);
  assert.equal(licenceAllowed('MIT AND GPL-2.0-only', ['MIT']), false);
  assert.equal(licenceAllowed('MIT/Apache-2.0', ['Apache-2.0']), true);
  assert.equal(licenceAllowed('MIT or Apache-2.0', ['MIT']), true);
  assert.equal(licenceAllowed('Apache-2.0 WITH LLVM-exception', ['Apache-2.0 WITH LLVM-exception']), true);
  assert.equal(licenceAllowed(null, ['MIT']), false);
});

test('an entry for a package that is no longer locked fails (the list never goes stale)', () => {
  const i = inputs();
  i.list.rust.push({ name: 'gone-crate', version: '2.0.0', licence: 'MIT', url: '' });
  assert.match(problems(i)[0], /gone-crate@2\.0\.0 is in the licence list but no longer locked/);
});
