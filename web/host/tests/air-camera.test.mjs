// br-8h3u.1 (owner 2026-10-24, amending R125's air framing): "car disappears sort of out the bottom of the screen when it
// gets airborne. Should just remain in the normal screen position!" The real camera rig follows a car through a jump
// flight at three speeds, over three landings (flat, a drop, and ground rising towards the landing) and in wide, square
// and tall tiles; every airborne frame the car's projected centre stays within a small band of where it sat on the
// ground just before the lip, and the car stays in frame.
//   node --test web/host/tests/air-camera.test.mjs
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { rolldown } from 'rolldown';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';

const ROOT = resolve(import.meta.dirname, '../../..');
const bundle = await rolldown({ input: join(ROOT, 'web/host/src/camera/rig.ts'), external: ['three'], logLevel: 'silent' });
const file = join(ROOT, 'web/host/tests/.air-rig-bundle.mjs');
writeFileSync(file, (await bundle.generate({ format: 'esm' })).output[0].code);
await bundle.close();
const { CameraRig } = await import(file);

/** How far the projected centre may drift from its grounded place (NDC units, the tile is -1..1: 0.1 is 5 % of its height;
 *  ground rising towards the landing lifts the chase a little to keep its line of sight). */
const BAND = 0.1;
const LIP_Z = 60;
// The ground the car leaves from (flat to the lip at z 60, ride height 0.4 m), then each landing's own ground.
const landings = {
  flat: (z) => 0,
  drop: (z) => (z < LIP_Z ? 0 : -6),
  rising: (z) => (z < LIP_Z ? 0 : Math.min(5, (z - LIP_Z - 10) * 0.25)),
};

function fly(ground, speed, aspect) {
  const rig = new CameraRig();
  rig.groundAt = (x, z) => ground(z);
  // The jump's flight and landing (the map leaves them out of its recovery spans): from the lip to 45 m past it.
  rig.inFlight = (x, z) => z >= LIP_Z - 2 && z <= LIP_Z + 45;
  const cam = new PerspectiveCamera(58, aspect, 0.1, 1000);
  const car = { pos: new Vector3(0, 0.4, 0), rot: new Quaternion(), life: 1 };
  const dt = 1 / 60;
  let vy = 0, grounded = null, airborne = false, worst = 0, lost = 0, frames = 0;
  for (let f = 0; f < 60 * 8; f++) {
    car.pos.z += speed * dt;
    const g = ground(car.pos.z) + 0.4;
    if (car.pos.z < LIP_Z) {
      car.pos.y = g;
    } else {
      if (!airborne) { airborne = true; vy = 6; }
      vy -= 9.81 * dt;
      car.pos.y = Math.max(g, car.pos.y + vy * dt);
      if (car.pos.y === g && vy < 0) airborne = false;
    }
    rig.update(1, cam, car, dt);
    cam.updateMatrixWorld();
    const p = car.pos.clone().project(cam);
    if (car.pos.z < LIP_Z && car.pos.z > LIP_Z - 3) grounded = p.y;
    if (airborne && car.pos.y - g > 0.9) {
      frames++;
      worst = Math.max(worst, Math.abs(p.y - grounded));
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) lost++;
    }
    if (car.pos.z > LIP_Z && !airborne) break;
  }
  return { frames, worst: +worst.toFixed(3), lost, grounded: +grounded.toFixed(3) };
}

for (const [name, ground] of Object.entries(landings)) {
  for (const speed of [20, 28, 36]) {
    test(`air camera: a ${speed} m/s flight onto ${name} ground keeps the car at its grounded screen height in every tile`, () => {
      for (const [tile, aspect] of [['wide', 16 / 9], ['square', 1], ['tall', 9 / 16]]) {
        const r = fly(ground, speed, aspect);
        assert.ok(r.frames > 20, `${tile}: the car really flew (${r.frames} airborne frames)`);
        assert.equal(r.lost, 0, `${tile}: the car stays in frame`);
        assert.ok(r.worst <= BAND, `${tile}: the car's projected centre drifts ${r.worst} from its grounded ${r.grounded} (band ${BAND})`);
      }
    });
  }
}
