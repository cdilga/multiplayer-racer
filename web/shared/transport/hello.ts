// The walking skeleton's stick message (P1-G00 only): tag 0x48 ('H') + two i16 axes (−32767..32767), little-endian,
// on the `state` channel. The real controller (C02/G04) sends N06 StateBatches instead.

export function encodeHelloStick(x: number, y: number): ArrayBuffer {
  const buf = new ArrayBuffer(5);
  const v = new DataView(buf);
  v.setUint8(0, 0x48);
  v.setInt16(1, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true);
  v.setInt16(3, Math.round(Math.max(-1, Math.min(1, y)) * 32767), true);
  return buf;
}

export function decodeHelloStick(data: ArrayBuffer): { x: number; y: number } | null {
  if (!(data instanceof ArrayBuffer) || data.byteLength !== 5) return null;
  const v = new DataView(data);
  if (v.getUint8(0) !== 0x48) return null;
  return { x: v.getInt16(1, true) / 32767, y: v.getInt16(3, true) / 32767 };
}
