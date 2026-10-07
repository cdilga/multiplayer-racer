// P1-C03 later: the Australian name button's logic (pure node, no browser):
//   node --test web/tests/journeys/c03-ausname.test.mjs
// The known-names sheet converts exactly, the rules are deterministic and validated, the on-device model path (stubbed) is
// used when it is available and falls back quietly when it is not, and nothing touches the network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ausName, byModel, byRules, fallback, validResult } from '../../controller/src/app/ausname.ts';
import sheet from '../../controller/src/app/ausname.json' with { type: 'json' };

const lm = (availability, reply) => ({
  availability: async () => availability,
  create: async () => ({ prompt: async () => (typeof reply === 'function' ? reply() : reply), destroy() {} }),
});

test('the known-names sheet converts exactly, and every sheet entry passes the validator', () => {
  for (const [typed, want] of [['David', 'Davo'], ['Steven', 'Stevo'], ['Gary', 'Gazza'], ['Sharon', 'Shazza'], ['Barry', 'Bazza'], ['Darren', 'Dazza'], ['Robert', 'Robbo']]) {
    assert.deepEqual(fallback(typed), { name: want, how: 'known' }, typed);
    assert.deepEqual(fallback(typed.toUpperCase()), { name: want, how: 'known' }, `${typed} in capitals`);
  }
  for (const [k, v] of Object.entries(sheet.known)) assert.ok(validResult(v), `${k} -> ${v}`);
});

test('any other name goes through the rules: deterministic, validated, never empty', () => {
  const names = ['Alice', 'Marlene', 'Xavier', 'Liam', 'Karl', 'Olivia', 'Matilda', 'Priya', 'Hamish', 'Ed', 'Bluey', 'Tommo'];
  for (const n of names) {
    const a = fallback(n);
    assert.deepEqual(fallback(n), a, `${n} is deterministic`);
    assert.ok(a.name.length > 0, `${n} is never empty`);
    assert.ok(validResult(a.name), `${n} -> ${a.name} validates`);
  }
  assert.equal(fallback('Bluey').how, 'same', 'already in the style');
  assert.equal(fallback('Hamish').how, 'rules');
  assert.notEqual(fallback('Hamish').name, 'Hamish');
  assert.equal(byRules('x'), null);
  assert.equal(byRules('Ng'), null, 'no vowel, no rule');
});

test('what the rules cannot or should not touch comes back as typed, never altered', () => {
  for (const odd of ['', '   ', 'Zoë', "O'Brien", 'A1', '<b>', 'é']) {
    const r = fallback(odd);
    assert.equal(r.name, odd.normalize('NFC').trim(), JSON.stringify(odd));
    assert.ok(['none', 'same', 'rules', 'known'].includes(r.how));
  }
  assert.equal(fallback('Nigel').how, 'none', 'a result containing a blocked fragment is refused');
});

test('the validator is the family-friendly filter on both paths', () => {
  assert.ok(validResult('Davo'));
  for (const bad of ['', ' Davo', 'Davo ', 'Da vo', 'Dav0', 'Fuckwit', 'Shitty', 'a'.repeat(33), 'é', 'Davo‮']) assert.equal(validResult(bad), false, JSON.stringify(bad));
});

test('the model path: used when available, validated, and every failure falls back quietly', async () => {
  assert.equal(await byModel('David', lm('available', 'Davo')), 'Davo');
  assert.equal(await byModel('David', lm('available', '  "Davo."  ')), 'Davo', 'quotes and the full stop are stripped');
  assert.deepEqual(await ausName('David', lm('available', 'Davvo')), { name: 'Davvo', how: 'model' });
  // Not available / downloading / downloadable / absent: the fallback, no waiting.
  for (const state of ['unavailable', 'downloadable', 'downloading']) assert.deepEqual(await ausName('David', lm(state, 'Nope')), { name: 'Davo', how: 'known' }, state);
  assert.deepEqual(await ausName('David', undefined), { name: 'Davo', how: 'known' });
  // A reply that fails validation: the fallback.
  for (const reply of ['', 'Dave the legend of the road', 'Fuckwit', 'D4vo', 'a'.repeat(40)]) assert.deepEqual(await ausName('David', lm('available', reply)), { name: 'Davo', how: 'known' }, JSON.stringify(reply));
  // A model that throws or hangs: the fallback.
  assert.deepEqual(await ausName('David', { availability: async () => { throw new Error('boom'); }, create: async () => ({}) }), { name: 'Davo', how: 'known' });
  assert.equal(await byModel('David', lm('available', () => new Promise(() => {})), 50), null, 'a hung model times out');
});

test('no network request is made by the feature', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => (calls.push(a), Promise.reject(new Error('no network')));
  try {
    await ausName('David', lm('available', 'Davo'));
    await ausName('Hamish');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(calls, []);
});
