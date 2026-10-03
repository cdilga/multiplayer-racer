// P1-V02: the Cruz Missile bake (node --test tools/vehicles/test/).
// - Two bakes give identical bytes, and they are exactly the committed files (an LFS pointer counts by its sha256 oid).
// - Every LOD loads through three.js's GLTFLoader with the contract's nodes. Each part has the same bounds as Spike J's
//   own model, except the documented changes: tyres sized to rest on the ground, LOD2 without the whip's mount block, and
//   sides named physically (Spike J's door_FR / wheel_FR are on +X, the car's left: here door_FL / wheel_FL).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { bake, committedSha, PARTS } from '../bake.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = path.join(REPO, 'art/vehicles/cruz-missile');
const ANCHORS = ['cam_fp', 'cam_tp_target', 'com', 'roof_number', 'lplate_front', 'lplate_rear'];
const P = JSON.parse(fs.readFileSync(path.join(DIR, 'params.json'), 'utf8'));
const spike = await import(path.join(REPO, 'spikes/art-pipeline/J-cruze-lowpoly/model.js'));
const SPIKE_NAME = (p) => (/_[FR][LR]$/.test(p) ? p.slice(0, -1) + (p.endsWith('L') ? 'R' : 'L') : p);

const first = await bake(DIR);

test('two bakes give identical bytes, and they are the committed files', async () => {
  const second = await bake(DIR);
  assert.deepEqual([...first.files.keys()], [...second.files.keys()]);
  for (const [f, bytes] of first.files) {
    assert.ok(Buffer.from(bytes).equals(Buffer.from(second.files.get(f))), `${f} differs between two bakes`);
    assert.equal(committedSha(path.join(DIR, f)), first.report.files[f].sha256, `${f}: the committed file isn't this bake (rebake and commit)`);
  }
});

function load(bytes) {
  const loader = new GLTFLoader();
  // Node has no image decoder: stand textures in with empty ones (the PNGs are checked by the bake's own sha256).
  loader.register((parser) => ({
    name: 'jj_stub_textures',
    loadTexture: (index) => Promise.resolve(Object.assign(new THREE.Texture(), { name: parser.json.images[parser.json.textures[index].source].name })),
  }));
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));
}

const box = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); };
const near = (a, b, tol, what) => {
  for (const k of ['x', 'y', 'z']) for (const m of ['min', 'max']) assert.ok(Math.abs(a[m][k] - b[m][k]) <= tol, `${what} ${m}.${k}: ${a[m][k]} vs spike ${b[m][k]}`);
};

for (const lod of [0, 1, 2]) {
  test(`LOD${lod} loads in three.js with the contract nodes and Spike J's bounds`, async () => {
    const gltf = await load(first.files.get(`cruz-missile.lod${lod}.glb`));
    const root = gltf.scene.children[0];
    assert.equal(root.name, 'cruz-missile');
    const names = root.children.map((c) => c.name);
    const colliders = lod === 0 ? PARTS.map((p) => `collider_${p}`) : [];
    assert.deepEqual(names, [...PARTS, ...ANCHORS, ...colliders]);

    // One material with the atlas and emissive map, shared by every part.
    const mats = new Set(PARTS.map((p) => root.getObjectByName(p).material));
    assert.equal(mats.size, 1);
    const [mat] = mats;
    assert.equal(mat.map?.name, 'atlas');
    assert.equal(mat.emissiveMap?.name, 'emissive');

    const ref = spike.build(P, lod);
    const tyreGrowth = P.wheelR * (1 / Math.cos(Math.PI / spike.LODS[lod].wheelSeg) - 1);
    for (const p of PARTS) {
      const mine = box(root.getObjectByName(p)), theirs = box(ref.parts[SPIKE_NAME(p)]);
      if (p.startsWith('wheel')) {
        // The same wheel, its tyre grown so the bottom flat rests on the ground.
        assert.ok(Math.abs(mine.min.y) < 1e-5, `${p} rests on the ground (min y ${mine.min.y})`);
        for (const k of ['x', 'y', 'z']) {
          assert.ok(mine.min[k] <= theirs.min[k] + 1e-5 && mine.max[k] >= theirs.max[k] - 1e-5, `${p} contains Spike J's wheel`);
          assert.ok(theirs.min[k] - mine.min[k] <= tyreGrowth + 1e-5 && mine.max[k] - theirs.max[k] <= tyreGrowth + 1e-5, `${p} grows ≤ ${tyreGrowth}`);
        }
        assert.ok(Math.abs(mine.min.x - theirs.min.x) < 1e-5 && Math.abs(mine.max.x - theirs.max.x) < 1e-5, `${p} keeps its width`);
      } else {
        near(mine, theirs, 1e-5, `LOD${lod} ${p}`);
      }
    }
    // The whole car: Spike J's bounds, except that it now sits on the ground.
    const all = new THREE.Box3();
    for (const p of PARTS) all.union(box(root.getObjectByName(p)));
    const refAll = box(ref.group);
    assert.ok(Math.abs(all.min.y) < 1e-5);
    near({ min: { ...all.min, y: refAll.min.y }, max: all.max }, refAll, 1e-5, `LOD${lod} car`);

    // Triangles: Spike J's counts, minus LOD2's whip mount block.
    const tris = PARTS.reduce((t, p) => t + root.getObjectByName(p).geometry.attributes.position.count / 3, 0);
    assert.equal(tris, [1264, 890, 594][lod]);
    assert.equal(ref.stats.tris - tris, lod === 2 ? 12 : 0);
  });
}

test('the sidecar declares the pivots the GLBs carry, identical at every LOD', async () => {
  const sidecar = JSON.parse(new TextDecoder().decode(first.files.get('cruz-missile.asset.json')));
  for (const lod of [0, 1, 2]) {
    const root = (await load(first.files.get(`cruz-missile.lod${lod}.glb`))).scene.children[0];
    for (const p of PARTS) assert.deepEqual(root.getObjectByName(p).position.toArray(), sidecar.parts[p].pivot, `LOD${lod} ${p}`);
    for (const a of ANCHORS) assert.deepEqual(root.getObjectByName(a).position.toArray(), sidecar.anchors[a]);
  }
  const mass = Object.values(sidecar.parts).reduce((t, p) => t + p.massFraction, 0);
  assert.ok(Math.abs(mass - 1) < 1e-9, `mass fractions sum to ${mass}`);
  assert.ok(sidecar.parts.wheel_FL.pivot[0] > 0 && sidecar.parts.door_FL.pivot[0] > 0, '+X is the car’s left');
});
