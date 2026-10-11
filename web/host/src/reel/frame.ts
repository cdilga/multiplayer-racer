// P1-R09: independently decodable quantised presentation frames, never authoritative simulation state.
// Each frame owns its complete damage/debris baseline; keeping a clip cannot depend on an evicted ring frame.
import type { Frame } from '../render/snapshot';

const MAGIC = 0x4a4a4831; // JJH1
const HEADER = 44;
const scalars = ['sessionRev', 'pauseMask', 'cars', 'debris', 'parts', 'pieces', 'rails'] as const;
type Count = 'cars' | 'debris' | 'parts' | 'pieces' | 'rails';
type Storage = 'u32' | 'u16' | 'i32' | 'i16';
type Column = { field: keyof Frame; count: Count; width: number; storage: Storage; scale: number };
const columns: Column[] = [
  ...['id', 'life', 'flags'].map(field => ({ field, count: 'cars', width: 1, storage: 'u32', scale: 1 } as Column)),
  { field: 'pos', count: 'cars', width: 3, storage: 'i32', scale: 100 },
  { field: 'rot', count: 'cars', width: 4, storage: 'i16', scale: 32767 },
  { field: 'vel', count: 'cars', width: 3, storage: 'i32', scale: 1000 },
  { field: 'steer', count: 'cars', width: 1, storage: 'i16', scale: 10000 },
  { field: 'boost', count: 'cars', width: 1, storage: 'u16', scale: 65535 },
  { field: 'throttle', count: 'cars', width: 1, storage: 'i16', scale: 32767 },
  { field: 'debrisPos', count: 'debris', width: 3, storage: 'i32', scale: 100 },
  { field: 'debrisRot', count: 'debris', width: 4, storage: 'i16', scale: 32767 },
  { field: 'debrisKind', count: 'debris', width: 1, storage: 'u32', scale: 1 },
  { field: 'partCar', count: 'parts', width: 1, storage: 'u32', scale: 1 },
  { field: 'partIndex', count: 'parts', width: 1, storage: 'u16', scale: 1 },
  { field: 'partState', count: 'parts', width: 1, storage: 'u16', scale: 1 },
  { field: 'partAngle', count: 'parts', width: 1, storage: 'i32', scale: 10000 },
  { field: 'partPos', count: 'parts', width: 3, storage: 'i32', scale: 100 },
  { field: 'partRot', count: 'parts', width: 4, storage: 'i16', scale: 32767 },
  { field: 'pieceCar', count: 'pieces', width: 1, storage: 'u32', scale: 1 },
  { field: 'piecePart', count: 'pieces', width: 1, storage: 'u16', scale: 1 },
  { field: 'piecePos', count: 'pieces', width: 3, storage: 'i32', scale: 100 },
  { field: 'pieceRot', count: 'pieces', width: 4, storage: 'i16', scale: 32767 },
  { field: 'railDressing', count: 'rails', width: 1, storage: 'u32', scale: 1 },
  { field: 'railOffset', count: 'rails', width: 1, storage: 'i32', scale: 10000 },
];
const size = (storage: Storage) => storage.endsWith('32') ? 4 : 2;
export const packedFrameBytes = (f: Pick<Frame, Count>) => HEADER + columns.reduce((n, c) => n + f[c.count] * c.width * size(c.storage), 0);
const arrays = {
  id: Uint32Array, life: Uint32Array, flags: Uint32Array, debrisKind: Uint32Array, partCar: Uint32Array,
  partIndex: Uint16Array, partState: Uint16Array, pieceCar: Uint32Array, piecePart: Uint8Array, railDressing: Uint32Array,
};

/** Centimetre positions, millimetre/s velocities and ~3e-5 quaternion components. Out-of-range footage is unusable,
 * not clipped to an invented trajectory. The replay memory policy may drop footage, never live bodies. */
export function packFrame(f: Frame): ArrayBuffer {
  const buffer = new ArrayBuffer(packedFrameBytes(f));
  const v = new DataView(buffer);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, 1, true);
  v.setFloat64(8, f.tick, true);
  scalars.forEach((field, i) => v.setUint32(16 + i * 4, f[field], true));
  let at = HEADER;
  for (const c of columns) {
    const values = f[c.field] as ArrayLike<number>;
    const bits = size(c.storage) * 8;
    const unsigned = c.storage.startsWith('u');
    const low = unsigned ? 0 : -(2 ** (bits - 1));
    const high = unsigned ? 2 ** bits - 1 : 2 ** (bits - 1) - 1;
    for (let i = 0; i < f[c.count] * c.width; i++, at += size(c.storage)) {
      const value = Math.round(values[i]! * c.scale);
      if (!Number.isFinite(value) || value < low || value > high) throw new Error(`unrecordable reel ${c.field}`);
      if (c.storage === 'u32') v.setUint32(at, value, true);
      else if (c.storage === 'i32') v.setInt32(at, value, true);
      else if (c.storage === 'u16') v.setUint16(at, value, true);
      else v.setInt16(at, value, true);
    }
  }
  return buffer;
}

export function unpackFrame(buffer: ArrayBuffer): Frame {
  const v = new DataView(buffer);
  if (buffer.byteLength < HEADER || v.getUint32(0, true) !== MAGIC || v.getUint32(4, true) !== 1) throw new Error('not a JJH1 reel frame');
  const f = { tick: v.getFloat64(8, true) } as Frame;
  scalars.forEach((field, i) => { f[field] = v.getUint32(16 + i * 4, true); });
  if (packedFrameBytes(f) !== buffer.byteLength) throw new Error('invalid JJH1 reel frame length');
  let at = HEADER;
  for (const c of columns) {
    const ArrayType = arrays[c.field as keyof typeof arrays] ?? Float32Array;
    const values = new ArrayType(f[c.count] * c.width);
    for (let i = 0; i < values.length; i++, at += size(c.storage)) {
      const value = c.storage === 'u32' ? v.getUint32(at, true) : c.storage === 'i32' ? v.getInt32(at, true)
        : c.storage === 'u16' ? v.getUint16(at, true) : v.getInt16(at, true);
      values[i] = value / c.scale;
    }
    (f[c.field] as typeof values) = values;
  }
  return f;
}
