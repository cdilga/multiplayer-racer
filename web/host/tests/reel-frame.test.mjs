// P1-R09: the codec is the lowest level that proves a retained frame owns a complete presentation baseline.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packFrame, unpackFrame } from '../src/reel/frame.ts';

function frame(cars = 2, debris = 3, parts = 2, pieces = 1, rails = 2) {
  const f = { tick: 240, sessionRev: 3, pauseMask: 0, cars, debris, parts, pieces, rails };
  for (const [count, fields] of [
    [cars, { id: [Uint32Array, 1], life: [Uint32Array, 1], flags: [Uint32Array, 1], pos: [Float32Array, 3],
      rot: [Float32Array, 4], vel: [Float32Array, 3], steer: [Float32Array, 1], boost: [Float32Array, 1], throttle: [Float32Array, 1] }],
    [debris, { debrisPos: [Float32Array, 3], debrisRot: [Float32Array, 4], debrisKind: [Uint32Array, 1] }],
    [parts, { partCar: [Uint32Array, 1], partIndex: [Uint16Array, 1], partState: [Uint16Array, 1],
      partAngle: [Float32Array, 1], partPos: [Float32Array, 3], partRot: [Float32Array, 4] }],
    [pieces, { pieceCar: [Uint32Array, 1], piecePart: [Uint8Array, 1], piecePos: [Float32Array, 3], pieceRot: [Float32Array, 4] }],
    [rails, { railDressing: [Uint32Array, 1], railOffset: [Float32Array, 1] }],
  ]) for (const [key, [ArrayType, width]] of Object.entries(fields)) f[key] = new ArrayType(count * width);
  for (let i = 0; i < cars; i++) {
    f.id[i] = 100 + i; f.life[i] = 1; f.flags[i] = 3 << 16;
    f.rot[i * 4 + 3] = 1; f.boost[i] = .75; f.throttle[i] = -.3;
  }
  return f;
}

test('a retained quantised frame restores identities, motion, detached baseline, husk and rail pose', () => {
  const f = frame();
  f.pos.set([123.4567, 3.14159, -999.999, -17.333, 2, 64]);
  f.vel.set([26.0004, -5.1234, 0, 0, 0, 0]);
  f.partCar.set([100, 101]); f.partIndex.set([3, 7]); f.partState.set([2, 1]);
  f.partAngle[1] = .65432; f.partPos.set([12, 2, 5, 19, 1, 9]);
  f.pieceCar[0] = 100; f.piecePart[0] = 255; f.piecePos.set([15, 1, 20]);
  f.debrisKind.set([1, 4, 1]); f.debrisPos.set([1, 2, 3, 10, 11, 12, -1, -2, -3]);
  f.railDressing.set([21, 22]); f.railOffset.set([.12345, -.5]);
  const kept = packFrame(f);
  f.pos.fill(0); f.partState.fill(0); f.debrisPos.fill(0);
  const restored = unpackFrame(kept);
  assert.equal(restored.tick, 240);
  assert.deepEqual([...restored.id], [100, 101]);
  assert.deepEqual([...restored.flags], [3 << 16, 3 << 16]);
  assert.ok(Math.abs(restored.pos[0] - 123.4567) <= .005);
  assert.ok(Math.abs(restored.vel[1] + 5.1234) <= .0005);
  assert.deepEqual([...restored.partState], [2, 1]);
  assert.deepEqual([...restored.partCar], [100, 101]);
  assert.deepEqual([...restored.piecePart], [255]);
  assert.deepEqual([...restored.debrisPos], [1, 2, 3, 10, 11, 12, -1, -2, -3]);
  assert.ok(Math.abs(restored.railOffset[0] - .12345) <= .000051);
  assert.ok(Math.abs(restored.throttle[0] + .3) <= 1 / 32767);
});

test('recording has no actor cap and accounts exact owned buffer bytes', () => {
  // A sample, never a limit. Excess backing-array capacity is not part of the active baseline.
  const f = frame(243, 1537, 89, 41, 131);
  f.partPos = new Float32Array(9000);
  const packed = packFrame(f);
  assert.equal(packed.byteLength, 44 + 243 * 50 + 1537 * 24 + 89 * 32 + 41 * 26 + 131 * 8);
  const restored = unpackFrame(packed);
  assert.equal(restored.cars, 243); assert.equal(restored.debris, 1537);
  assert.equal(restored.partPos.length, 89 * 3);
  assert.equal(restored.id.at(-1), 342);
});

test('unrepresentable footage is refused instead of inventing a clipped trajectory', () => {
  const f = frame();
  f.pos[0] = Infinity;
  assert.throws(() => packFrame(f), /unrecordable reel pos/);
  f.pos[0] = 30_000_000;
  assert.throws(() => packFrame(f), /unrecordable reel pos/);
});

test('corrupt or truncated frames fail before allocating arrays from untrusted counts', () => {
  const packed = packFrame(frame());
  assert.throws(() => unpackFrame(packed.slice(0, 20)), /not a JJH1/);
  assert.throws(() => unpackFrame(packed.slice(0, -1)), /length/);
  new DataView(packed).setUint32(24, 0xffffffff, true);
  assert.throws(() => unpackFrame(packed), /length/);
});
