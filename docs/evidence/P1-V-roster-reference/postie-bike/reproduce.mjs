// Run from repository root. Checks current source/export against the unchanged reference and original physics.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PNG } from 'pngjs';
import { loadCandidate, sourceContourChecks, projectFeatures, featureCheck } from '../../../../tools/vehicles/fit/likeness.mjs';
const root = 'docs/evidence/P1-V-roster-reference/postie-bike', dir = 'art/vehicles/postie-bike';
const read = file => JSON.parse(fs.readFileSync(file));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const original = read(`${root}/baseline-source/contract-physics.json`);
const current = read(`${dir}/postie-bike.asset.json`);
assert.deepEqual(current, original.sidecar, 'original sidecar: pivots, hinges, masses, anchors, materials and budgets');
const b = fs.readFileSync(`${dir}/postie-bike.lod0.glb`), length = b.readUInt32LE(12);
const gltf = JSON.parse(b.subarray(20, 20 + length)), bin = b.subarray(28 + length), colliders = {};
for (const node of gltf.nodes.filter(n => n.name.startsWith('collider_'))) {
  const a = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION], v = gltf.bufferViews[a.bufferView];
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  colliders[node.name] = { sha256: sha(bin.subarray(start, start + v.byteLength)), vertices: a.count };
}
assert.deepEqual(colliders, original.colliders, 'all original baked collider POSITION bytes');
const fixture = read(`${dir}/refs/likeness.json`), sheets = read(`${dir}/refs/sheets.json`), receipt = [];
// Side projection: point in actual triangle. A filled scooter wheel/frame must fail these daylight checks.
const inside = (p, t) => {
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(orient(...t)) < 1e-9) return false;
  const signs = t.map((a, i) => orient(a, t[(i + 1) % 3], p));
  return signs.every(x => x >= -1e-9) || signs.every(x => x <= 1e-9);
};
const covered = (part, z, y) => {
  for (let i = 0; i < part.positions.length; i += 9) {
    const t = [0, 3, 6].map(k => [part.positions[i + k + 2] + part.pivot[2], part.positions[i + k + 1] + part.pivot[1]]);
    if (inside([z, y], t)) return true;
  }
  return false;
};
for (const baseline of [false, true]) {
  const { model, P } = await loadCandidate('postie-bike', baseline ? { modelFile: `${root}/baseline-source/model.js`, paramsFile: `${root}/baseline-source/params.json` } : {});
  for (let lod = 0; lod < 3; lod++) {
    const parts = model.soups(P, lod).parts, projected = projectFeatures(parts, fixture.features, sheets);
    const holes = ['wheel_F', 'wheel_R'].map(name => {
      const p = parts[name], r = p.pivot[1];
      return { name: `${name}: daylight between spokes`, pass: !covered(p, p.pivot[2] + r * .20, r + r * .40) };
    });
    holes.push({ name: 'classic frame gap below seat/behind engine', pass: !covered(parts.core, -.55, .55) });
    const checks = [...holes, ...sourceContourChecks(parts, fixture, sheets, `${dir}/refs/masks`, lod), ...fixture.features.map(f => featureCheck(f, projected[f.name], lod))];
    assert.equal(checks.every(c => c.pass), !baseline, `${baseline ? 'baseline must fail' : 'current must pass'} LOD${lod}: ${JSON.stringify(checks.filter(c => !c.pass))}`);
    const defects = [];
    if (!baseline) for (const f of fixture.features) {
      const missing = !featureCheck(f, [], lod).pass;
      const moved = !featureCheck(f, projected[f.name].map(poly => poly.map(([x, y]) => [x + .25, y - .15])), lod).pass;
      assert.ok(missing && moved, `${f.name}: missing/displaced cue must fail`);
      defects.push({ name: f.name, missingDetected: missing, displacedDetected: moved });
    }
    receipt.push({ baseline, lod, pass: checks.every(c => c.pass), checks, defects });
  }
}
// Check the baked meshes through the actual loader, including fork/frame overlap, rather than
// trusting one source-only wheel sample. Probe between the eight detailed spoke rays at three radii.
const wheelOpenings = [];
for (let lod = 0; lod < 3; lod++) {
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'node_texture_stub', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const bytes = fs.readFileSync(`${dir}/postie-bike.lod${lod}.glb`);
  const gltf = await new Promise((resolve, reject) => loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject));
  const object = gltf.scene.children[0], meshes = [];
  object.traverse(o => {
    if (o.isMesh && !o.name.startsWith('collider_') && !o.name.startsWith('interior_')) {
      o.material.side = THREE.DoubleSide;
      meshes.push(o);
    }
  });
  object.updateMatrixWorld(true);
  for (const name of ['wheel_F', 'wheel_R']) for (const side of [1, -1]) {
    const wheel = object.getObjectByName(name), radius = wheel.position.y;
    let wheelHits = 0, clear = 0;
    const occluders = {};
    for (let a = 0; a < 8; a++) for (const fraction of [.35, .5, .65]) {
      const angle = (22.5 + 45 * a) * Math.PI / 180;
      const target = new THREE.Vector3(0, radius + Math.sin(angle) * radius * fraction, wheel.position.z + Math.cos(angle) * radius * fraction);
      const direction = new THREE.Vector3(-side * 9, -.1, 0).normalize(); // same slight downward angle as side captures
      const origin = target.clone().addScaledVector(direction, -5);
      const hits = new THREE.Raycaster(origin, direction).intersectObjects(meshes, false).filter(h => h.distance < 10);
      if (hits.some(h => h.object === wheel)) wheelHits++;
      if (!hits.length) clear++;
      else occluders[hits[0].object.name] = (occluders[hits[0].object.name] ?? 0) + 1;
    }
    assert.equal(wheelHits, 0, `LOD${lod} ${name} side ${side}: all sampled interspoke apertures open in baked wheel`);
    assert.ok(clear >= 16, `LOD${lod} ${name} side ${side}: most sampled apertures open through the whole bike`);
    wheelOpenings.push({ lod, name, side, probes: 24, wheelHits, clear, occluders });
  }
}
// The apparent pale disks in the side capture are the background seen through the open wheel.
const png = PNG.sync.read(fs.readFileSync(`${root}/views.png`));
const rgb = (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
const background = rgb(750, 100), screenshotSamples = [[800, 212], [800, 223], [789, 216], [800, 230]].map(([x, y]) => ({ x, y, rgb: rgb(x, y) }));
for (const p of screenshotSamples) assert.deepEqual(p.rgb, background, `wheel opening pixel ${p.x},${p.y} matches empty backdrop`);
const result = {
  originalCommit: original.sourceCommit, originalGlbOid: original.sourceGlbOid, sidecarEqual: true, colliderBytesEqual: true,
  sourceSha256: Object.fromEntries(['model.js', 'params.json', 'atlas.js'].map(f => [f, sha(fs.readFileSync(`${dir}/${f}`))])), receipt,
  bakedSha256: Object.fromEntries([0, 1, 2].map(lod => [`lod${lod}`, sha(fs.readFileSync(`${dir}/postie-bike.lod${lod}.glb`))])),
  wheelOpenings, screenshotBackground: background, screenshotSamples,
};
fs.writeFileSync(`${root}/source-checks.json`, JSON.stringify(result, null, 2) + '\n');
console.log('Postie: original sidecar and all six collider byte hashes unchanged; current LOD0/1/2 pass, old source fails each, missing/displaced cues rejected; 288 baked interspoke rays open and screenshot aperture pixels equal background');
