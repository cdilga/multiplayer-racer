// P1-V02: the Cruz Missile bake (node --test tools/vehicles/test/).
// - Two bakes give identical bytes, and they are exactly the committed files (an LFS pointer counts by its sha256 oid).
// - Every LOD loads through three.js's GLTFLoader with the contract nodes, one shared atlas material, wheels resting on the
//   ground and triangle counts inside the sidecar's budgets (br-bwju.11 rebuilt the body against its sheet, so the old
//   comparison with Spike J's bounds and counts is gone; its evidence stays in spikes/art-pipeline/J-cruze-lowpoly/).

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
for (const lod of [0, 1, 2]) {
  test(`LOD${lod} loads in three.js with the contract nodes`, async () => {
    const gltf = await load(first.files.get(`cruz-missile.lod${lod}.glb`));
    const root = gltf.scene.children[0];
    assert.equal(root.name, 'cruz-missile');
    const names = root.children.map((c) => c.name);
    const colliders = lod === 0 ? PARTS.map((p) => `collider_${p}`) : [];
    const interiors = Object.keys(JSON.parse(new TextDecoder().decode(first.files.get('cruz-missile.asset.json'))).interiors ?? {}).map((b) => `interior_${b}`);
    assert.deepEqual(names, [...PARTS, ...interiors, ...ANCHORS, ...colliders]);

    // One material with the atlas and emissive map, shared by every part.
    const mats = new Set(PARTS.map((p) => root.getObjectByName(p).material));
    assert.equal(mats.size, 1);
    const [mat] = mats;
    assert.equal(mat.map?.name, 'atlas');
    assert.equal(mat.emissiveMap?.name, 'emissive');

    for (const p of PARTS.filter((q) => q.startsWith('wheel'))) {
      const mine = box(root.getObjectByName(p));
      assert.ok(Math.abs(mine.min.y) < 1e-5, `${p} rests on the ground (min y ${mine.min.y})`);
    }
    const all = new THREE.Box3();
    for (const p of PARTS) all.union(box(root.getObjectByName(p)));
    assert.ok(Math.abs(all.min.y) < 0.2 && all.max.y < 1.7, `the car stands ${all.min.y}..${all.max.y} m`);
    const tris = PARTS.reduce((t, p) => t + root.getObjectByName(p).geometry.attributes.position.count / 3, 0);
    const budget = JSON.parse(new TextDecoder().decode(first.files.get('cruz-missile.asset.json'))).lods[lod].maxTris;
    assert.ok(tris <= budget, `LOD${lod}: ${tris} triangles, budget ${budget}`);
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
