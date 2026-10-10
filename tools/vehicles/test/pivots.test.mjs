// br-nd1a (P1-V02 bug): every hinged part's pivot lies on its hinge line, for every roster vehicle (each art/vehicles/<id>/
// dir with a model.js, params.json and vehicle.json), at every LOD. A loose part turns about its hinge axis through its pivot
// (the contract), so a pivot at a panel's centre makes a door swing like a revolving door.
//   doors:  the front edge (max z, +z is forward) on the outer skin (max |x| on the door's own side), hinge axis +y
//   front:  its rear edge (min z) where it meets the body, at the shoulder line (upper half of its height), on the centre line
//   back:   its front edge (max z) where it meets the body, likewise, hinge axis +x
// node --test tools/vehicles/test/ (scripts/ci/checks.sh)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOT = path.join(REPO, 'art/vehicles');
const TOL = 0.02; // metres: the bake's pivots are exact; this absorbs float32 and nothing else

const roster = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()
  && ['model.js', 'params.json', 'vehicle.json'].every((f) => fs.existsSync(path.join(ROOT, d.name, f)))).map((d) => d.name);

/** The part's world-space bounds (its soup is expressed about its pivot). */
function bounds(part) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < part.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = part.positions[i + k] + part.pivot[k];
    lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
  }
  return { lo, hi };
}

/** Problems with one part's pivot against its hinge line; [] when it lies on it. */
function pivotProblems(id, pivot, { lo, hi }, tol = TOL) {
  const out = [], [x, y, z] = pivot;
  if (id.startsWith('door')) {
    const outer = (lo[0] + hi[0]) / 2 > 0 ? hi[0] : lo[0];
    if (Math.abs(z - hi[2]) > tol) out.push(`${id}: pivot z ${z.toFixed(3)} is not the front edge ${hi[2].toFixed(3)}`);
    if (Math.abs(x - outer) > tol) out.push(`${id}: pivot x ${x.toFixed(3)} is not the outer skin ${outer.toFixed(3)}`);
    if (y < lo[1] - tol || y > hi[1] + tol) out.push(`${id}: pivot y ${y.toFixed(3)} is outside the door's height`);
  } else if (id === 'front' || id === 'back') {
    const edge = id === 'front' ? lo[2] : hi[2];
    if (Math.abs(z - edge) > tol) out.push(`${id}: pivot z ${z.toFixed(3)} is not its body edge ${edge.toFixed(3)}`);
    if (Math.abs(x) > tol) out.push(`${id}: pivot x ${x.toFixed(3)} is off the centre line`);
    if (y < lo[1] + 0.5 * (hi[1] - lo[1]) - tol || y > hi[1] + tol) out.push(`${id}: pivot y ${y.toFixed(3)} is not at the top edge (${lo[1].toFixed(3)}..${hi[1].toFixed(3)})`);
  }
  return out;
}

test('the roster is found from the data and is not empty', () => assert.ok(roster.includes('cruz-missile'), roster.join()));

for (const id of roster) {
  const dir = path.join(ROOT, id);
  const P = JSON.parse(fs.readFileSync(path.join(dir, 'params.json'), 'utf8'));
  const V = JSON.parse(fs.readFileSync(path.join(dir, 'vehicle.json'), 'utf8'));
  const model = await import(pathToFileURL(path.join(dir, 'model.js')).href);
  const hinged = Object.keys(V.parts).filter((p) => /^(door|front$|back$)/.test(p));

  for (const lod of V.lods.keys()) {
    test(`${id} LOD${lod}: doors, front and back pivot on their hinge lines`, () => {
      const { parts } = model.soups(P, lod);
      assert.ok(hinged.length >= 6, `${id} has doors and front/back parts (${hinged})`);
      for (const p of hinged) assert.deepEqual(pivotProblems(p, parts[p].pivot, bounds(parts[p])), []);
    });
  }

  test(`${id}: the pivots are the same at every LOD and in the committed sidecar`, () => {
    const pv = model.pivots(P), side = JSON.parse(fs.readFileSync(path.join(dir, `${V.id}.asset.json`), 'utf8'));
    for (const lod of V.lods.keys()) for (const [p, part] of Object.entries(model.soups(P, lod).parts)) assert.deepEqual(part.pivot, pv[p], `${p} LOD${lod}`);
    for (const p of hinged) for (let k = 0; k < 3; k++) assert.ok(Math.abs(side.parts[p].pivot[k] - pv[p][k]) < 1e-9, `${p} sidecar pivot[${k}]`);
  });

  test(`${id}: defect injection, the check rejects a pivot moved to the panel centre or the wrong edge`, () => {
    const { parts } = model.soups(P, 0);
    for (const p of hinged) {
      const b = bounds(parts[p]), centre = b.lo.map((l, k) => (l + b.hi[k]) / 2);
      assert.notDeepEqual(pivotProblems(p, centre, b), [], `${p}: a centre pivot must be rejected`);
      if (p.startsWith('door')) {
        const rear = [...parts[p].pivot]; rear[2] = b.lo[2];
        assert.notDeepEqual(pivotProblems(p, rear, b), [], `${p}: a rear-edge pivot must be rejected`);
        const inner = [...parts[p].pivot]; inner[0] = (b.lo[0] + b.hi[0]) / 2;
        assert.notDeepEqual(pivotProblems(p, inner, b), [], `${p}: a mid-thickness pivot must be rejected`);
      }
    }
  });
}
