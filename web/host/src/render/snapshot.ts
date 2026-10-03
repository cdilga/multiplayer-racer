// The JJS1 snapshot layout (`jj_wasm_host::host::write_snapshot`, the §4.4 ABI's `Snapshot{buf}`), read on the main
// thread into flat arrays, and written by the synthetic source (P1-R01) so the renderer can't tell the two apart.
//
// Header (40 B): magic u32, version u16, flags u16, tick u64, session_rev u32, pause mask u32, countdown ms u32,
// cars u32, debris u32, reserved u32. Car (64 B): car u32, life u32, position 3×f32, rotation 4×f32 (x, y, z, w),
// linvel 3×f32, steer f32, flags u32, boost f32, reserved u32. Debris (32 B): position 3×f32, rotation 4×f32, kind u32.

export const SNAPSHOT_MAGIC = 0x4a4a5331;
export const SNAPSHOT_HEADER = 40;
export const SNAPSHOT_CAR = 64;
export const SNAPSHOT_DEBRIS = 32;

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
}

/** Copies a snapshot out of its pooled buffer (so the buffer can go straight back to the worker). */
export function decodeSnapshot(view: DataView): Frame {
  if (view.getUint32(0, true) !== SNAPSHOT_MAGIC) throw new Error('not a JJS1 snapshot');
  const cars = view.getUint32(28, true);
  const debris = view.getUint32(32, true);
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
  for (let i = 0; i < debris; i++, at += SNAPSHOT_DEBRIS) {
    for (let k = 0; k < 3; k++) f.debrisPos[i * 3 + k] = view.getFloat32(at + k * 4, true);
    for (let k = 0; k < 4; k++) f.debrisRot[i * 4 + k] = view.getFloat32(at + 12 + k * 4, true);
    f.debrisKind[i] = view.getUint32(at + 28, true);
  }
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

export function snapshotBytes(cars: number, debris = 0): number {
  return SNAPSHOT_HEADER + SNAPSHOT_CAR * cars + SNAPSHOT_DEBRIS * debris;
}

/** Writes a JJS1 snapshot into `buf`; returns the bytes written, or 0 if it doesn't fit (like the worker). */
export function encodeSnapshot(buf: ArrayBuffer, tick: number, cars: CarPose[], sessionRev = 0): number {
  const need = snapshotBytes(cars.length);
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
  v.setUint32(36, 0, true);
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
  return need;
}
