// glb.mjs: a minimal, deterministic glTF 2.0 binary writer (P1-V02). The caller builds the JSON in a fixed order and
// adds buffers through `view()`; the bytes depend only on the input (no timestamps, no ids, no float formatting beyond
// JavaScript's spec-defined shortest form).

export class GlbBuilder {
  constructor() {
    this.chunks = [];
    this.length = 0;
    this.json = { asset: { version: '2.0', generator: 'jj tools/vehicles/bake.mjs' }, bufferViews: [], accessors: [] };
  }

  /** Appends bytes (4-byte aligned) as a bufferView; returns its index. */
  view(bytes, target) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const bv = { buffer: 0, byteOffset: this.length, byteLength: u8.byteLength };
    if (target) bv.target = target;
    this.chunks.push(u8); this.length += u8.byteLength;
    this.json.bufferViews.push(bv);
    return this.json.bufferViews.length - 1;
  }

  /** A float vector accessor (VEC2/VEC3) over `values`; POSITION gets min/max as the spec requires. */
  floats(values, type, withBounds = false) {
    const f = Float32Array.from(values), n = type === 'VEC3' ? 3 : 2;
    const acc = { bufferView: this.view(f, 34962), componentType: 5126, count: f.length / n, type };
    if (withBounds) {
      const min = Array(n).fill(Infinity), max = Array(n).fill(-Infinity);
      for (let i = 0; i < f.length; i++) { min[i % n] = Math.min(min[i % n], f[i]); max[i % n] = Math.max(max[i % n], f[i]); }
      acc.min = min; acc.max = max;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }

  bytes() {
    const enc = new TextEncoder();
    const bin = new Uint8Array(this.length + ((4 - (this.length % 4)) % 4));
    let o = 0;
    for (const c of this.chunks) { bin.set(c, o); o += c.byteLength; }
    this.json.buffers = [{ byteLength: bin.byteLength }];
    let js = enc.encode(JSON.stringify(this.json));
    const jsPad = (4 - (js.length % 4)) % 4;
    if (jsPad) { const p = new Uint8Array(js.length + jsPad); p.set(js); p.fill(0x20, js.length); js = p; }
    const total = 12 + 8 + js.length + 8 + bin.length;
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
    const b = 20 + js.length;
    dv.setUint32(b, bin.length, true); dv.setUint32(b + 4, 0x004e4942, true); out.set(bin, b + 8);
    return out;
  }
}
