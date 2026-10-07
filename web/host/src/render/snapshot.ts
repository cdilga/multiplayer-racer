// The JJS1 snapshot layout (`jj_wasm_host::host::write_snapshot`, the §4.4 ABI's `Snapshot{buf}`), read on the main
// thread into flat arrays, and written by the synthetic source (P1-R01) so the renderer can't tell the two apart.
//
// Header (40 B): magic u32, version u16, flags u16, tick u64, session_rev u32, pause mask u32, countdown ms u32,
// cars u32, debris u32, parts u32. Car (64 B): car u32, life u32, position 3×f32, rotation 4×f32 (x, y, z, w),
// linvel 3×f32, steer f32, flags u32, boost f32, reserved u32. Debris (32 B): position 3×f32, rotation 4×f32, kind u32.
// Part (40 B, P1-R02), one per part that isn't intact: car u32, part u16 (its index in the vehicle sidecar's `parts`
// order), state u16 (PART_LOOSE, PART_DETACHED), hinge angle f32 (radians, loose), position 3×f32 and rotation 4×f32
// (the part's pivot frame in the world, detached). A debris record of kind 2 is a detached part's body: the decoder drops
// it (the part record draws it; the debris list holds only what is drawn as debris). The header's last u32 was reserved and written 0, so a worker that sends no part records
// still reads as "every part intact".

export const SNAPSHOT_MAGIC = 0x4a4a5331;
export const SNAPSHOT_HEADER = 40;
export const SNAPSHOT_CAR = 64;
export const SNAPSHOT_DEBRIS = 32;
export const SNAPSHOT_PART = 40;
export const PART_LOOSE = 1;
export const PART_DETACHED = 2;
/** A debris record of this kind is a detached car part (P1-S04b): drawn from its part record, so the frame leaves it out. */
export const DEBRIS_PART = 2;
/** A part record in this state is a piece drawn on its own (P1-S04c): a wrecked car's husk (part PIECE_HUSK, the vehicle
 *  frame) or a part that came off a car since wrecked and rebuilt (its pivot frame). The decoder moves these out of the
 *  part records into the pieces, so the fresh car of the same id isn't drawn as missing the part. */
export const PART_PIECE = 3;
export const PIECE_HUSK = 255;

export interface Frame {
  tick: number;
  sessionRev: number;
  pauseMask: number;
  cars: number;
  /** Per car: id, life (bumps on a respawn), flags. */
  id: Uint32Array;
  life: Uint32Array;
  flags: Uint32Array;
  /** Per car: position xyz, rotation xyzw, steer. */
  pos: Float32Array;
  rot: Float32Array;
  steer: Float32Array;
  debris: number;
  debrisPos: Float32Array;
  debrisRot: Float32Array;
  debrisKind: Uint32Array;
  parts: number;
  /** Per part record: car id, part index, state, hinge angle, world position xyz, world rotation xyzw. */
  partCar: Uint32Array;
  partIndex: Uint16Array;
  partState: Uint16Array;
  partAngle: Float32Array;
  partPos: Float32Array;
  partRot: Float32Array;
  /** Husks and orphaned parts (P1-S04c): owner car id, part index (PIECE_HUSK for a husk), world pose of the part's pivot
   *  frame (the vehicle frame for a husk). They stay for the round. */
  pieces: number;
  pieceCar: Uint32Array;
  piecePart: Uint8Array;
  piecePos: Float32Array;
  pieceRot: Float32Array;
}

/** Copies a snapshot out of its pooled buffer (so the buffer can go straight back to the worker). */
export function decodeSnapshot(view: DataView): Frame {
  if (view.getUint32(0, true) !== SNAPSHOT_MAGIC) throw new Error('not a JJS1 snapshot');
  const cars = view.getUint32(28, true);
  const debris = view.getUint32(32, true);
  const parts = view.getUint32(36, true);
  const f: Frame = {
    tick: Number(view.getBigUint64(8, true)),
    sessionRev: view.getUint32(16, true),
    pauseMask: view.getUint32(20, true),
    cars,
    id: new Uint32Array(cars),
    life: new Uint32Array(cars),
    flags: new Uint32Array(cars),
    pos: new Float32Array(cars * 3),
    rot: new Float32Array(cars * 4),
    steer: new Float32Array(cars),
    debris,
    debrisPos: new Float32Array(debris * 3),
    debrisRot: new Float32Array(debris * 4),
    debrisKind: new Uint32Array(debris),
    parts,
    partCar: new Uint32Array(parts),
    partIndex: new Uint16Array(parts),
    partState: new Uint16Array(parts),
    partAngle: new Float32Array(parts),
    partPos: new Float32Array(parts * 3),
    partRot: new Float32Array(parts * 4),
    pieces: 0,
    pieceCar: new Uint32Array(parts),
    piecePart: new Uint8Array(parts),
    piecePos: new Float32Array(parts * 3),
    pieceRot: new Float32Array(parts * 4),
  };
  let at = SNAPSHOT_HEADER;
  for (let i = 0; i < cars; i++, at += SNAPSHOT_CAR) {
    f.id[i] = view.getUint32(at, true);
    f.life[i] = view.getUint32(at + 4, true);
    for (let k = 0; k < 3; k++) f.pos[i * 3 + k] = view.getFloat32(at + 8 + k * 4, true);
    for (let k = 0; k < 4; k++) f.rot[i * 4 + k] = view.getFloat32(at + 20 + k * 4, true);
    f.steer[i] = view.getFloat32(at + 48, true);
    f.flags[i] = view.getUint32(at + 52, true);
  }
  let kept = 0;
  for (let i = 0; i < debris; i++, at += SNAPSHOT_DEBRIS) {
    const kind = view.getUint32(at + 28, true);
    if (kind === DEBRIS_PART) continue;
    for (let k = 0; k < 3; k++) f.debrisPos[kept * 3 + k] = view.getFloat32(at + k * 4, true);
    for (let k = 0; k < 4; k++) f.debrisRot[kept * 4 + k] = view.getFloat32(at + 12 + k * 4, true);
    f.debrisKind[kept++] = kind;
  }
  f.debris = kept;
  let living = 0;
  for (let i = 0; i < parts; i++, at += SNAPSHOT_PART) {
    if (view.getUint16(at + 6, true) === PART_PIECE) {
      const k = f.pieces++;
      f.pieceCar[k] = view.getUint32(at, true);
      f.piecePart[k] = view.getUint16(at + 4, true);
      for (let j = 0; j < 3; j++) f.piecePos[k * 3 + j] = view.getFloat32(at + 12 + j * 4, true);
      for (let j = 0; j < 4; j++) f.pieceRot[k * 4 + j] = view.getFloat32(at + 24 + j * 4, true);
      continue;
    }
    const n = living++;
    f.partCar[n] = view.getUint32(at, true);
    f.partIndex[n] = view.getUint16(at + 4, true);
    f.partState[n] = view.getUint16(at + 6, true);
    f.partAngle[n] = view.getFloat32(at + 8, true);
    for (let k = 0; k < 3; k++) f.partPos[n * 3 + k] = view.getFloat32(at + 12 + k * 4, true);
    for (let k = 0; k < 4; k++) f.partRot[n * 4 + k] = view.getFloat32(at + 24 + k * 4, true);
  }
  f.parts = living;
  return f;
}

export interface CarPose {
  id: number;
  life: number;
  pos: [number, number, number];
  rot: [number, number, number, number];
  steer?: number;
  flags?: number;
}

export interface PartPose {
  car: number;
  part: number;
  state: number;
  angle?: number;
  pos?: [number, number, number];
  rot?: [number, number, number, number];
}

export function snapshotBytes(cars: number, debris = 0, parts = 0): number {
  return SNAPSHOT_HEADER + SNAPSHOT_CAR * cars + SNAPSHOT_DEBRIS * debris + SNAPSHOT_PART * parts;
}

/** Writes a JJS1 snapshot into `buf`; returns the bytes written, or 0 if it doesn't fit (like the worker). */
export function encodeSnapshot(buf: ArrayBuffer, tick: number, cars: CarPose[], sessionRev = 0, parts: PartPose[] = []): number {
  const need = snapshotBytes(cars.length, 0, parts.length);
  if (buf.byteLength < need) return 0;
  const v = new DataView(buf);
  v.setUint32(0, SNAPSHOT_MAGIC, true);
  v.setUint16(4, 1, true);
  v.setUint16(6, 0, true);
  v.setBigUint64(8, BigInt(tick), true);
  v.setUint32(16, sessionRev, true);
  v.setUint32(20, 0, true);
  v.setUint32(24, 0, true);
  v.setUint32(28, cars.length, true);
  v.setUint32(32, 0, true);
  v.setUint32(36, parts.length, true);
  let at = SNAPSHOT_HEADER;
  for (const c of cars) {
    v.setUint32(at, c.id, true);
    v.setUint32(at + 4, c.life, true);
    c.pos.forEach((x, k) => v.setFloat32(at + 8 + k * 4, x, true));
    c.rot.forEach((x, k) => v.setFloat32(at + 20 + k * 4, x, true));
    for (let k = 0; k < 3; k++) v.setFloat32(at + 36 + k * 4, 0, true);
    v.setFloat32(at + 48, c.steer ?? 0, true);
    v.setUint32(at + 52, c.flags ?? 0, true);
    v.setFloat32(at + 56, 0, true);
    v.setUint32(at + 60, 0, true);
    at += SNAPSHOT_CAR;
  }
  for (const p of parts) {
    v.setUint32(at, p.car, true);
    v.setUint16(at + 4, p.part, true);
    v.setUint16(at + 6, p.state, true);
    v.setFloat32(at + 8, p.angle ?? 0, true);
    (p.pos ?? [0, 0, 0]).forEach((x, k) => v.setFloat32(at + 12 + k * 4, x, true));
    (p.rot ?? [0, 0, 0, 1]).forEach((x, k) => v.setFloat32(at + 24 + k * 4, x, true));
    at += SNAPSHOT_PART;
  }
  return need;
}
