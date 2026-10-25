// Focused acceptance for the wheel/body rebuild: inspect the shipped GLBs, not a copy of the model's calculations.
// node docs/evidence/P1-V-hawk-curves/verify.mjs > docs/evidence/P1-V-hawk-curves/geometry.json
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir = 'art/vehicles/hawk-dash', id = 'hawk-dash';
const asset = JSON.parse(fs.readFileSync(`${dir}/${id}.asset.json`));
const result = [];
for (const [lod, spec] of asset.lods.entries()) {
  const bytes = fs.readFileSync(`${dir}/${spec.file}`), len = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + len)), bin = bytes.subarray(28 + len);
  assert.equal(gltf.materials.length, 1);
  const read = (i) => { const a = gltf.accessors[i], v = gltf.bufferViews[a.bufferView], offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0); return Array.from({ length: a.count * 3 }, (_, k) => bin.readFloatLE(offset + k * 4)); };
  const parts = {};
  for (const n of gltf.nodes.filter((n) => n.mesh != null && asset.parts[n.name])) {
    const p = gltf.meshes[n.mesh].primitives[0], xyz = read(p.attributes.POSITION);
    assert.equal(p.material, 0);
    assert.ok(xyz.every(Number.isFinite), `${n.name}: finite vertices`);
    assert.ok(read(p.attributes.NORMAL).every(Number.isFinite), `${n.name}: finite normals`);
    parts[n.name] = xyz.length / 9;
    const edges = new Map();
    for (let i = 0; i < xyz.length; i += 9) {
      const vs = [0, 3, 6].map((k) => xyz.slice(i + k, i + k + 3));
      const a = vs[1].map((v, k) => v - vs[0][k]), b = vs[2].map((v, k) => v - vs[0][k]);
      assert.ok(Math.hypot(a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]) > 1e-10, `${n.name}: nonzero triangle ${i/9}`);
      if (n.name.startsWith('wheel_')) for (let k = 0; k < 3; k++) {
        const edge = [vs[k].join(','), vs[(k+1)%3].join(',')].sort().join('|'); edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    if (n.name.startsWith('wheel_')) {
      assert.ok([...edges.values()].every((v) => v === 2), `${n.name}: sealed manifold, including inner sidewall`);
      const minY = Math.min(...xyz.filter((_, k) => k % 3 === 1)) + n.translation[1];
      assert.ok(Math.abs(minY) < 1e-6, `${n.name}: rests on ground`);
      assert.deepEqual(n.translation, asset.parts[n.name].pivot);
    }
  }
  assert.equal(Object.keys(parts).length, 11);
  const tris = Object.values(parts).reduce((a, b) => a + b, 0), wheels = Object.entries(parts).filter(([k]) => k.startsWith('wheel')).reduce((a, [, n]) => a + n, 0);
  assert.ok(tris <= spec.maxTris, `LOD${lod}: ${tris} <= ${spec.maxTris}`);
  result.push({ lod, tris, budget: spec.maxTris, wheels, body: tris - wheels, parts, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sealedWheels: true, finiteNondegenerate: true, materials: 1 });
}
console.log(JSON.stringify(result, null, 2));
