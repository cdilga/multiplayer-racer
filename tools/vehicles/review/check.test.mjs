// The review check must fail when any Vehicles-contract item is missing (R126, P1-D03b).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SITE, buildVehicle } from './build.mjs';
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
test('a bike (br-bwju.5) has every item, and fails item 3 without its rider', () => {
  const bike = JSON.parse(fs.readFileSync(path.join(SITE, 'postie-bike/review.json'), 'utf8'));
  assert.deepEqual(checkReview(bike, all), []);
  const r = structuredClone(bike); r.damage.parts = r.damage.parts.filter((p) => p.name !== 'rider');
  assert.ok(checkReview(r, all).some((b) => b.startsWith('item 3')));
});
// The large in-world capture, whatever its format (br-bwju.11 made the Cruz's PNG).
test('a missing image fails', () => assert.ok(checkReview(cruz, (f) => !/grid-1\.(png|jpe?g)$/.test(f)).length > 0));
test('missing handling fails', () => { const r = structuredClone(cruz); r.handling = null; assert.ok(checkReview(r, all).length > 0); });
test('a spec twin without its partner fails', () => {
  const r = structuredClone(cruz); r.specTwin = { id: 'lion-president', sharedSpec: 'x' };
  assert.ok(checkReview(r, all, {}).some((b) => b.startsWith('item 7')));
});

test('owner-measured reference replaces invented orthographic IoU only with complete passing evidence', () => {
  const ute = buildVehicle('tradie-ute', []);
  assert.equal(ute.reference.compare.length, 0);
  assert.equal(ute.reference.measured.kind, 'owner-measured');
  assert.deepEqual(checkReview(ute, all), []);
  const canopyWidth = ute.reference.measured.rows.find(r => r.label === 'Canopy width');
  assert.equal(canopyWidth.target, 1.772);
  assert.equal(canopyWidth.actual.length, ute.turntable.lods.length);
  assert.ok(canopyWidth.actual.every(a => Math.abs(a.value - 1.772) < .006));
  for (const field of ['oracle', 'report']) {
    assert.ok(checkReview(ute, f => f !== ute.reference.measured[field]).some(b => b.startsWith('item 1')));
  }
  for (const mutate of [
    r => { r.reference.measured = undefined; },
    r => { r.reference.measured.pass = false; },
    r => { r.reference.measured.lods[1].pass = false; },
    r => { r.reference.measured.lods[0].checks[0].pass = false; },
    r => { r.reference.measured.lods[0].checks = []; },
    r => { r.reference.measured.lods[0].injections[0].detected = false; },
    r => { r.reference.measured.lods.pop(); },
    r => { r.reference.measured.rows[0].actual[0].value = null; },
    r => { r.reference.measured.rows[0].actual[0].lod = 2; },
  ]) {
    const broken = structuredClone(ute); mutate(broken);
    assert.ok(checkReview(broken, all).some(b => b.startsWith('item 1')), 'missing or failed measured evidence must fail');
  }
});
