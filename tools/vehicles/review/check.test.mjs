// The review check must fail when any Vehicles-contract item is missing (R126, P1-D03b).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SITE } from './build.mjs';
import { checkAll, checkReview } from './check.mjs';

const cruz = JSON.parse(fs.readFileSync(path.join(SITE, 'cruz-missile/review.json'), 'utf8'));
const all = () => true;

test('the committed roster passes', () => assert.deepEqual(checkAll().failures, []));
test('the Cruz Missile has every item', () => assert.deepEqual(checkReview(cruz, all), []));

const drop = {
  1: (r) => { r.reference.compare[0].iou.front = undefined; },
  2: (r) => { r.turntable.lods[2].tris = 700; r.turntable.lods[2].withinBudget = false; },
  3: (r) => { r.damage.parts = r.damage.parts.filter((p) => !p.name.startsWith('door_')); },
  4: (r) => { r.paints.colours = []; },
  5: (r) => { r.inWorld = r.inWorld.filter((w) => w.size !== 'overview'); },
  6: (r) => { r.gate.result = null; },
};
for (const [item, f] of Object.entries(drop)) {
  test(`a missing item ${item} fails`, () => {
    const r = structuredClone(cruz); f(r);
    assert.ok(checkReview(r, all).some((b) => b.startsWith(`item ${item}`)), `item ${item} not flagged`);
  });
}
test('a missing image fails', () => assert.ok(checkReview(cruz, (f) => !f.endsWith('grid-1.jpg')).length > 0));
test('missing handling fails', () => { const r = structuredClone(cruz); r.handling = null; assert.ok(checkReview(r, all).length > 0); });
test('a spec twin without its partner fails', () => {
  const r = structuredClone(cruz); r.specTwin = { id: 'lion-president', sharedSpec: 'x' };
  assert.ok(checkReview(r, all, {}).some((b) => b.startsWith('item 7')));
});
