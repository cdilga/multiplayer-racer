#!/usr/bin/env node
// CI check (P1-C09): the committed licence list matches the lockfiles, and every shipped dependency has a licence the
// policy allows. Fails with one line per problem.   node tools/licences/check.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { problems } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const found = problems({
  list: JSON.parse(read('web/landing/credits/licences.json')),
  cargoLock: read('Cargo.lock'),
  npmLock: JSON.parse(read('web/package-lock.json')),
  policy: JSON.parse(read('tools/licences/policy.json')),
});
if (found.length) {
  for (const p of found) console.error(`licences: ${p}`);
  process.exit(1);
}
console.log('licences: every shipped dependency has an allowed licence and the list matches the lockfiles');
