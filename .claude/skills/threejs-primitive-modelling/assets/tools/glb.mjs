// glb.mjs — small, dependency-free GLB reader/writer used by every gate (validator, physics loader, selftest).
// Reads from the file itself: never trusts sidecar claims about triangles, positions or shapes.
import { readFileSync, writeFileSync } from 'node:fs';

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: bad GLB magic`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')); else if (type === 0x004e4942) bin = Buffer.from(data);
    off += 8 + len;
  }
  if (!json) throw new Error(`${path}: no JSON chunk`);
  return { json, bin: bin ?? Buffer.alloc(0), bytes: buf.length };
}
export function writeGlb(path, json, bin) {
  let js = Buffer.from(JSON.stringify(json), 'utf8'); const jpad = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(jpad, 0x20)]);
  const bpad = (4 - (bin.length % 4)) % 4, b = Buffer.concat([bin, Buffer.alloc(bpad)]);
  const total = 12 + 8 + js.length + 8 + b.length, out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4e4f534a, 16); js.copy(out, 20);
  const o2 = 20 + js.length; out.writeUInt32LE(b.length, o2); out.writeUInt32LE(0x004e4942, o2 + 4); b.copy(out, o2 + 8);
  writeFileSync(path, out); return total;
}
/** accessor → flat typed array (float32 for VEC3 etc.), honouring byteStride and normalized ints */
export function readAccessor(json, bin, index) {
  if (index == null) return null;
  const a = json.accessors[index], [Ctor, size] = COMP[a.componentType], n = NCOMP[a.type], bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = bv.byteStride || n * size, out = new (a.componentType === 5126 ? Float32Array : Ctor)(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), getter = { 5126: 'getFloat32', 5125: 'getUint32', 5123: 'getUint16', 5122: 'getInt16', 5121: 'getUint8', 5120: 'getInt8' }[a.componentType];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
    let v = dv[getter](base + i * stride + k * size, true);
    if (a.normalized && a.componentType !== 5126) v = Math.max(v / (2 ** (8 * size - (a.componentType === 5121 || a.componentType === 5123 ? 0 : 1)) - 1), -1);
    out[i * n + k] = v;
  }
  return out;
}
export function primTriangles(json, bin, prim) {
  const n = json.accessors[prim.attributes.POSITION].count, idx = prim.indices != null ? readAccessor(json, bin, prim.indices) : null, t = [];
  if (idx) for (let i = 0; i + 2 < idx.length; i += 3) t.push([idx[i], idx[i + 1], idx[i + 2]]); else for (let i = 0; i + 2 < n; i += 3) t.push([i, i + 1, i + 2]);
  return t;
}

// ── scene graph with world matrices (column-major 4×4) ───────────────────────────────────────────────────────
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function local(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation ?? [0, 0, 0], q = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1], [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], (2 * (xy + wz)) * s[0], (2 * (xz - wy)) * s[0], 0, (2 * (xy - wz)) * s[1], (1 - 2 * (xx + zz)) * s[1], (2 * (yz + wx)) * s[1], 0, (2 * (xz + wy)) * s[2], (2 * (yz - wx)) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
export const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
export class Glb {
  constructor(path) {
    Object.assign(this, readGlb(path)); this.path = path; const nodes = this.json.nodes ?? [];
    this.parent = new Array(nodes.length).fill(-1); nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (this.parent[c] = i)));
    this.world = new Array(nodes.length); const rec = (i, pm) => { this.world[i] = mul(pm, local(nodes[i])); (nodes[i].children ?? []).forEach((c) => rec(c, this.world[i])); };
    (this.json.scenes?.[this.json.scene ?? 0]?.nodes ?? []).forEach((r) => rec(r, ident()));
    this.byName = new Map(nodes.map((n, i) => [n.name, i]));
  }
  has(name) { return this.byName.has(name); }
  node(name) { return this.json.nodes[this.byName.get(name)]; }
  idx(name) { return this.byName.get(name); }
  extras(name) { return this.node(name)?.extras ?? {}; }
  worldPos(name) { const w = this.world[this.idx(name)]; return w ? [w[12], w[13], w[14]] : null; }
  descendants(name) { const out = [], rec = (i) => { out.push(i); (this.json.nodes[i].children ?? []).forEach(rec); }; rec(this.idx(name)); return out; }
  /** vertices of meshes on `name` (and optionally descendants), as world or node-local points */
  points(name, { descend = false, space = 'world', skipColliders = true } = {}) {
    const ids = descend ? this.descendants(name) : [this.idx(name)], pts = [];
    for (const i of ids) {
      const n = this.json.nodes[i]; if (n.mesh == null || (skipColliders && n.name.startsWith('col_'))) continue;
      const home = this.idx(name), inv = space === 'local' ? invertRigid(this.world[home]) : null, m = inv ? mul(inv, this.world[i]) : this.world[i];
      for (const prim of this.json.meshes[n.mesh].primitives) { const p = readAccessor(this.json, this.bin, prim.attributes.POSITION); for (let k = 0; k < p.length; k += 3) pts.push(apply(m, [p[k], p[k + 1], p[k + 2]])); }
    }
    return pts;
  }
  visualNodes() { return this.json.nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh != null && !n.name.startsWith('col_')); }
  triangles({ visualOnly = true } = {}) {
    let t = 0; for (const [n] of this.json.nodes.map((n) => [n])) { if (n.mesh == null || (visualOnly && n.name.startsWith('col_'))) continue; for (const p of this.json.meshes[n.mesh].primitives) t += (p.indices != null ? this.json.accessors[p.indices].count : this.json.accessors[p.attributes.POSITION].count) / 3; } return t;
  }
}
function invertRigid(m) { // rotation+translation (uniform scale 1) inverse
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]], t = [m[12], m[13], m[14]];
  return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]), -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]), -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]), 1];
}
export const bbox = (pts) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } return [mn, mx]; };
export const centre = ([mn, mx]) => [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
