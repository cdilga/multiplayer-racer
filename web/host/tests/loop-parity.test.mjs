// br-xlvx.6 (Loops): the host renderer's loop mesh (web/host/src/render/map/loop.ts) is the native collision mesh
// (jj-map::looping::loop_mesh), triangle for triangle: the same FNV-1a fingerprint over the uploaded f32 positions as
// jj_map::jump::render_fingerprint, held to the value crates/jj-map/tests/loops.rs commits (LOOP_FINGERPRINT).
//   node --test web/host/tests/loop-parity.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../../..');
const { loopMesh } = await import(join(ROOT, 'web/host/src/render/map/loop.ts'));
const map = JSON.parse(readFileSync(join(ROOT, 'maps/test/loop.json'), 'utf8'));
// tools/maps/loop.py's LOOP params (they move into the map as a Loop feature with FeatureKind::Loop).
const params = { entry: 64, exit: 79, radiusMm: 8000, thicknessMm: 400, barrierHeightMm: 900, barrierWidthMm: 400, segments: 48 };
// crates/jj-map/tests/loops.rs LOOP_FINGERPRINT.
const NATIVE = 0xd6db13fac573c8c8n;

function fingerprint(m) {
  let h = 0xcbf29ce484222325n;
  const f = new Float32Array(1), bytes = new Uint8Array(f.buffer);
  for (const t of m.triangles) for (const i of t) for (const c of m.vertices[i]) {
    f[0] = c;
    for (const b of bytes) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

test('the renderer draws the loop the sim collides with (fingerprint parity with jj-map)', () => {
  const m = loopMesh(map, params);
  assert.ok(m, 'the loop mesh builds');
  assert.equal(m.triangles.length, 3 * (params.segments * 8 + 4));
  assert.equal(m.surfaces.length, m.triangles.length);
  assert.equal(fingerprint(m), NATIVE, `fingerprint 0x${fingerprint(m).toString(16)}`);
});

test('a missing or broken param draws nothing', () => {
  assert.equal(loopMesh(map, { ...params, radiusMm: 0 }), null);
  assert.equal(loopMesh(map, { ...params, entry: 90 }), null);
});
