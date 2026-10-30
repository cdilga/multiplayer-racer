// br-8h3u.2 (owner, 2026-10-24, amending R125's loop rule): the chase camera through a loop. A car rides the test map's
// loop along its helix (jj-map looping, the same centre line as render/map/loop.ts) and the real camera rig follows it,
// at three speeds and three tile shapes. Every frame: the car (its body and a point 1.2 m over it) is inside the
// frustum, the loop mesh doesn't hide it, and the camera is world-up (no roll). Eased into the loop the car is framed
// closer than the chase frames it on the road; after the exit the chase eases back out to that framing; no cut anywhere.
//   node --test web/host/tests/loop-camera.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { rolldown } from 'rolldown';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Frustum, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Raycaster, Vector3 } from 'three';

const ROOT = resolve(import.meta.dirname, '../../..');
const { loopFrame, loopMesh } = await import(join(ROOT, 'web/host/src/render/map/loop.ts'));
const bundle = await rolldown({ input: join(ROOT, 'web/host/src/camera/rig.ts'), external: ['three'], logLevel: 'silent' });
const file = join(ROOT, 'web/host/tests/.loop-rig-bundle.mjs');
writeFileSync(file, (await bundle.generate({ format: 'esm' })).output[0].code);
await bundle.close();
const { CameraRig, PROFILE } = await import(file);

const map = JSON.parse(readFileSync(join(ROOT, 'maps/test/loop.json'), 'utf8'));
const params = map.features.find((f) => f.kind === 'loop').params;
const fr = loopFrame(map, params);
const R = params.radiusMm / 1000;
const TAU = 2 * Math.PI;
const F = new Vector3(fr.forward[0], 0, fr.forward[1]);
const centre = (t) => {
  const along = fr.runOut * t + R * Math.sin(TAU * t), up = R * (1 - Math.cos(TAU * t)), lat = fr.shift * (t - Math.sin(TAU * t) / TAU);
  return new Vector3(fr.e[0] + fr.forward[0] * along + fr.left[0] * lat, fr.e[1] + (fr.yExit - fr.e[1]) * t + up, fr.e[2] + fr.forward[1] * along + fr.left[1] * lat);
};
// The ride: 30 m of road in, the loop, 50 m out; each sample has the car's position, up (the deck's normal) and forward.
const path = [];
for (let s = -30; s < 0; s += 0.02) path.push({ p: new Vector3(...fr.e).addScaledVector(F, s), up: new Vector3(0, 1, 0), fw: F.clone() });
for (let k = 0; k <= 8000; k++) {
  // The deck's normal from three samples inside the loop (one-sided at the ends would bend the wrong way).
  const t = k / 8000, h = 2e-3, m = Math.min(Math.max(t, h), 1 - h);
  const fw = centre(Math.min(t + 1e-4, 1)).sub(centre(Math.max(t - 1e-4, 0))).normalize();
  const bend = centre(m + h).sub(centre(m)).normalize().sub(centre(m).sub(centre(m - h)).normalize());
  path.push({ p: centre(t), up: bend.lengthSq() > 1e-12 ? bend.normalize() : new Vector3(0, 1, 0), fw });
}
for (let s = 0.02; s < 50; s += 0.02) path.push({ p: centre(1).addScaledVector(F, s), up: new Vector3(0, 1, 0), fw: F.clone() });

const loopMeshObject = (() => {
  const m = loopMesh(map, params), g = new BufferGeometry(), pos = [];
  for (const t of m.triangles) for (const i of t) pos.push(...m.vertices[i]);
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mesh = new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }));
  mesh.updateMatrixWorld();
  return mesh;
})();

function ride(speed, aspect) {
  const rig = new CameraRig();
  rig.loops = [{ entry: new Vector3(...fr.e), forward: F.clone(), left: new Vector3(fr.left[0], 0, fr.left[1]), runOut: fr.runOut, shift: fr.shift, radius: R, halfWidth: fr.halfWidth, rise: fr.yExit - fr.e[1] }];
  const cam = new PerspectiveCamera(60, aspect, 0.1, 2000), dt = 1 / 60, ray = new Raycaster();
  const frames = [];
  let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    travelled += path[i].p.distanceTo(path[i - 1].p);
    if (travelled < speed * dt) continue;
    travelled = 0;
    const { p, up, fw } = path[i];
    const rot = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(up, fw).normalize(), up, fw));
    rig.update(0, cam, { pos: p, rot, life: 1 }, dt);
    cam.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const inFrame = frustum.containsPoint(p) && frustum.containsPoint(p.clone().addScaledVector(up, 1.2));
    const aim = p.clone().addScaledVector(up, 0.7), toCar = aim.clone().sub(cam.position), d = toCar.length();
    ray.set(cam.position, toCar.normalize());
    ray.far = d - 0.6;
    const hidden = ray.intersectObject(loopMeshObject).length > 0;
    const s = rig.inspect()[0];
    frames.push({ inFrame, hidden, roll: Math.abs(s.rollDeg), loop: s.loop, loopIn: s.loopIn, zoomM: s.zoomM, cuts: s.cuts, maxGapM: s.maxGapM });
  }
  return frames;
}

for (const speed of [14, 20, 26]) for (const [name, aspect] of [['wide', 16 / 9], ['square', 1], ['tall', 9 / 16]]) {
  test(`loop camera at ${speed} m/s in a ${name} tile: in frame and unhidden every frame, world-up, zoomed in, eased back out`, () => {
    const f = ride(speed, aspect);
    const lost = f.flatMap((x, k) => (x.inFrame ? [] : [k])), hidden = f.flatMap((x, k) => (x.hidden ? [k] : []));
    assert.deepEqual(lost, [], `the car stays inside the frustum: ${JSON.stringify(lost.map((k) => [k, f[k].loopIn]))}`);
    assert.deepEqual(hidden, [], 'the loop never hides the car');
    assert.ok(Math.max(...f.map((x) => x.roll)) < 1e-6, 'the camera never rolls');
    assert.equal(f.at(-1).cuts, 0, 'no cut into or out of the loop');
    const road = f.filter((x) => x.loop === null && x.loopIn === 0), before = road[10], after = road.at(-1);
    const zoomed = f.filter((x) => x.loopIn > 0.9).map((x) => x.zoomM);
    assert.ok(zoomed.length > 0, 'the chase eases into the loop framing');
    assert.ok(Math.max(...zoomed) < before.zoomM - 1, `in the loop the car is framed closer (${Math.max(...zoomed)} m) than on the road (${before.zoomM} m)`);
    const settled = f.filter((x) => x.loopIn > 0.97).map((x) => x.zoomM);
    assert.ok(Math.max(...settled) <= PROFILE.loop.zoomM + 1, `eased fully in, about the loop's zoom (${PROFILE.loop.zoomM} m): ${Math.max(...settled)} m`);
    assert.ok(Math.abs(after.zoomM - before.zoomM) < 0.05, `after the exit the chase is back to its road framing (${after.zoomM} m)`);
  });
}
