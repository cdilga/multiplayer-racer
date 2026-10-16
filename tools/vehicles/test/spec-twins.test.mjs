// spec-twins.test.mjs (br-bwju.3, R123): roster cars that name the same `spec` in web/shared/src/roster.json are one spec
// with different bodies, so their profiles' handling (`tuning` in assets/profiles/<id>.json) must be identical. R123 names
// the Hawk Dash and the Lion President as such a pair; the geometry (hull, wheels, parts) is each body's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const roster = JSON.parse(fs.readFileSync(path.join(REPO, 'web/shared/src/roster.json'), 'utf8')).cars;
const tuning = (id) => JSON.parse(fs.readFileSync(path.join(REPO, 'assets/profiles', `${id}.json`), 'utf8')).tuning;

/** Roster ids grouped by their `spec`. */
function specs(cars) {
  const out = new Map();
  for (const c of cars) if (c.spec) out.set(c.spec, [...(out.get(c.spec) ?? []), c.id]);
  return out;
}

/** The first tuning key whose value differs between two profiles, or null. */
function divergence(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return k;
  return null;
}

test("R123's Hawk Dash and Lion President are one spec in the roster data", () => {
  const hawk = roster.find((c) => c.id === 'hawk-dash'), lion = roster.find((c) => c.id === 'lion-president');
  assert.ok(hawk && lion, 'both cars are roster rows');
  assert.ok(hawk.spec, 'the Hawk Dash names a spec');
  assert.equal(lion.spec, hawk.spec, 'the Lion President names the same spec');
  assert.deepEqual(lion.stats, hawk.stats, 'one spec, one set of stat bars');
});

test('every car sharing a spec has identical handling', () => {
  for (const [spec, ids] of specs(roster)) {
    assert.ok(ids.length > 1, `spec ${spec} is named by one car only (${ids[0]})`);
    const first = tuning(ids[0]);
    for (const id of ids.slice(1)) assert.equal(divergence(first, tuning(id)), null, `${id} diverges from ${ids[0]} (spec ${spec})`);
  }
});

test('defect injection: a changed tuning value is caught', () => {
  const a = tuning('hawk-dash'), b = structuredClone(a);
  b.max_engine_force += 1;
  assert.equal(divergence(a, b), 'max_engine_force');
  b.max_engine_force = a.max_engine_force;
  if (b.damage) { b.damage.k_door *= 2; assert.equal(divergence(a, b), 'damage'); }
});
