// The bake's mesh pass (br-8h3u.10): what a part's own shell hides is dropped, an inside-out face is flipped, and nothing
// visible changes. Run: node --test tools/vehicles/test/optimise.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { orientAndPrune } from '../optimise.mjs';

/** A closed axis-aligned box as an outward-wound (CCW from outside) triangle soup. */
function box(cx, cy, cz, h) {
  const v = (x, y, z) => [cx + x * h, cy + y * h, cz + z * h];
  const quads = [
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)], [v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)],
    [v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)], [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)],
    [v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)], [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)],
  ];
  const positions = [];
  for (const [a, b, c, d] of quads) positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  return positions;
}
const soup = (positions) => ({ positions, uvs: new Array((positions.length / 3) * 2).fill(0.5), tris: positions.length / 9 });

test('a box inside a closed shell is dropped; the shell is kept as it was', () => {
  const outer = box(0, 0, 0, 1), inner = box(0, 0, 0, 0.4);
  const out = orientAndPrune(soup([...outer, ...inner]));
  assert.equal(out.stats.dropped, 12);
  assert.equal(out.stats.flipped, 0);
  assert.deepEqual(out.positions, outer);
});

test('defect injection: an inside-out face on the shell is flipped back to face outwards', () => {
  const shell = box(0, 0, 0, 1), broken = shell.slice();
  // swap the 2nd and 3rd vertices of the first triangle: its front now faces into the box
  for (let k = 0; k < 3; k++) [broken[3 + k], broken[6 + k]] = [broken[6 + k], broken[3 + k]];
  const out = orientAndPrune(soup(broken));
  assert.equal(out.stats.flipped, 1);
  assert.equal(out.stats.dropped, 0);
  assert.deepEqual(out.positions.slice(0, 9), [...shell.slice(0, 3), ...shell.slice(3, 6), ...shell.slice(6, 9)]);
});

test('two separate boxes: nothing is hidden, nothing changes', () => {
  const positions = [...box(-2, 0, 0, 1), ...box(2, 0, 0, 1)];
  const out = orientAndPrune(soup(positions));
  assert.deepEqual(out.stats, { flipped: 0, dropped: 0 });
  assert.deepEqual(out.positions, positions);
});
