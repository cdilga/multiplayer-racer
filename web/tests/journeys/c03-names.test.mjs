// P1-C03 data: the curated prefill names (web/controller/src/app/names.json). Pure node, no browser:
//   node --test web/tests/journeys/c03-names.test.mjs
// The host's duplicate-suffix rule is jj-session's (seats/tests.rs `names_follow_the_rules_and_duplicates_gain_the_number`);
// here: the file validates, the validator catches what it should, the join card offers only familyFriendly rows and draws
// from the whole list, and the list has no cap.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIMINUTIVE, MIN_DIMINUTIVES, NAMES_FILE, offered, prefillName, validateNames } from '../../controller/src/app/names.ts';

const row = (name, extra = {}) => ({ name, familyFriendly: true, style: 'plain', ...extra });
const dims = Array.from({ length: MIN_DIMINUTIVES }, (_, i) => row(`Zed${'abcdefghijkl'[i]}o`, { style: 'diminutive' }));

test("names.json validates, with at least 12 family-friendly diminutive names (the owner's examples among them)", () => {
  assert.deepEqual(validateNames(NAMES_FILE), []);
  const dim = NAMES_FILE.names.filter((n) => n.style === 'diminutive' && n.familyFriendly);
  assert.ok(dim.length >= MIN_DIMINUTIVES, `${dim.length} diminutives`);
  const have = new Set(NAMES_FILE.names.map((n) => n.name));
  for (const n of ['Davo', 'Stevo', 'Gazza', 'Shazza', 'Bazza', 'Macca', 'Robbo', 'Johnno', 'Smithy', 'Jonesy', 'Kazza', 'Dazza', 'Tez']) {
    assert.ok(have.has(n), `${n} is in the list`);
    assert.match(n, DIMINUTIVE);
  }
  assert.ok(NAMES_FILE.names.some((n) => n.style === 'plain'), 'mixed with plain names');
});

test('the validator catches what it must (defect injection)', () => {
  const bad = (rows) => validateNames({ schema: 'jj.names.v2', names: [...dims, ...rows] });
  assert.match(bad([row('Davo'), row('davo')]).join(), /duplicate/);
  assert.match(bad([row('')]).join(), /blank/);
  assert.match(bad([row(' Pad ')]).join(), /padded/);
  assert.match(bad([row('<b>Kev</b>')]).join(), /markup/);
  assert.match(bad([row('Kev‮')]).join(), /bidi/);
  assert.match(bad([row('a'.repeat(33))]).join(), /graphemes/);
  assert.match(bad([row('é')]).join(), /NFC/);
  assert.match(bad([{ name: 'Nope', familyFriendly: 'yes', style: 'plain' }]).join(), /familyFriendly/);
  assert.match(bad([row('Weird', { style: 'rude' })]).join(), /style/);
  assert.match(bad([row('Plain', { style: 'diminutive' })]).join(), /not in the/);
  assert.match(validateNames({ schema: 'jj.names.v2', names: dims.slice(0, 11) }).join(), /at least 12/);
  assert.match(validateNames({ schema: 'x', names: dims }).join(), /schema/);
  assert.deepEqual(validateNames({ schema: 'jj.names.v2', names: dims }), []);
});

test('only familyFriendly rows are offered, and the draw spans the whole list', () => {
  const rows = [row('Aaa'), row('Rude', { familyFriendly: false }), row('Bbb'), row('Ccc')];
  assert.deepEqual(offered(rows), ['Aaa', 'Bbb', 'Ccc']);
  assert.equal(prefillName(() => 0, rows), 'Aaa');
  assert.equal(prefillName(() => 0.5, rows), 'Bbb');
  assert.equal(prefillName(() => 0.999999, rows), 'Ccc');
  for (let i = 0; i < 200; i++) assert.notEqual(prefillName(Math.random, rows), 'Rude');
  // The real file: every offered name is reachable, first to last.
  const all = offered();
  assert.equal(all.length, NAMES_FILE.names.filter((n) => n.familyFriendly).length);
  const seen = new Set(all.map((_, i) => prefillName(() => (i + 0.5) / all.length)));
  assert.equal(seen.size, all.length);
  assert.equal(prefillName(() => 0, []), 'Mate', 'an empty list still gives a name');
});

test('the list has no cap', () => {
  const big = Array.from({ length: 5000 }, (_, i) => row(`Name${i.toString(36)}`));
  assert.deepEqual(validateNames({ schema: 'jj.names.v2', names: [...dims, ...big] }), []);
});
